use std::{collections::BTreeMap, sync::Arc};

use lopdf::{
    encryption::{
        crypt_filters::{Aes256CryptFilter, CryptFilter},
        DecryptionError,
    },
    Document, EncryptionState, EncryptionVersion, Error as LopdfError, LoadOptions, Permissions,
};
use serde::Serialize;
use zeroize::Zeroizing;

const MAX_DECOMPRESSED_STREAM_BYTES: usize = 256 * 1024 * 1024;
const MAX_PASSWORD_BYTES: usize = 127;

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PdfOpenSecurityOutcome {
    Unprotected,
    PasswordRequired,
    IncorrectPassword,
    UnsupportedEncryption,
    Unlocked { bytes: Vec<u8> },
}

fn load_options(password: Option<&str>) -> LoadOptions {
    LoadOptions {
        password: password.map(str::to_owned),
        max_decompressed_size: Some(MAX_DECOMPRESSED_STREAM_BYTES),
        ..LoadOptions::default()
    }
}

fn is_unsupported_encryption(error: &LopdfError) -> bool {
    matches!(
        error,
        LopdfError::Decryption(
            DecryptionError::UnsupportedEncryption
                | DecryptionError::UnsupportedRevision
                | DecryptionError::UnsupportedVersion
        ) | LopdfError::Unimplemented(_)
    )
}

fn serialize_document(document: &mut Document) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    document
        .save_to(&mut output)
        .map_err(|error| format!("Unable to serialize PDF: {error}"))?;
    Ok(output)
}

pub fn prepare_pdf_for_open_impl(
    bytes: &[u8],
    password: Option<String>,
) -> Result<PdfOpenSecurityOutcome, String> {
    let password = password.map(Zeroizing::new);
    let mut document = match Document::load_mem_with_options(
        bytes,
        load_options(password.as_deref().map(String::as_str)),
    ) {
        Ok(document) => document,
        Err(LopdfError::InvalidPassword) => return Ok(PdfOpenSecurityOutcome::IncorrectPassword),
        Err(error) if is_unsupported_encryption(&error) => {
            return Ok(PdfOpenSecurityOutcome::UnsupportedEncryption)
        }
        Err(error) => return Err(format!("Unable to inspect PDF security: {error}")),
    };

    if document.is_encrypted() {
        return Ok(PdfOpenSecurityOutcome::PasswordRequired);
    }

    if !document.was_encrypted() {
        return Ok(PdfOpenSecurityOutcome::Unprotected);
    }

    Ok(PdfOpenSecurityOutcome::Unlocked {
        bytes: serialize_document(&mut document)?,
    })
}

fn validate_password(password: &str) -> Result<(), String> {
    let password_length = password.len();

    if password_length == 0 {
        return Err("Enter a password before protecting the PDF.".to_string());
    }

    if password_length > MAX_PASSWORD_BYTES {
        return Err(format!(
            "PDF passwords must be at most {MAX_PASSWORD_BYTES} UTF-8 bytes."
        ));
    }

    Ok(())
}

fn random_hex_secret(byte_length: usize) -> Result<Zeroizing<String>, String> {
    let mut bytes = Zeroizing::new(vec![0u8; byte_length]);
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Unable to generate PDF encryption key: {error}"))?;

    let mut value = Zeroizing::new(String::with_capacity(byte_length * 2));
    for byte in bytes.iter() {
        use std::fmt::Write as _;
        write!(value, "{byte:02x}").map_err(|_| "Unable to encode encryption key.".to_string())?;
    }

    Ok(value)
}

pub fn protect_pdf_bytes_impl(bytes: &[u8], password: String) -> Result<Vec<u8>, String> {
    let password = Zeroizing::new(password);
    validate_password(password.as_str())?;

    let mut document = Document::load_mem_with_options(bytes, load_options(None))
        .map_err(|error| format!("Unable to prepare PDF for protection: {error}"))?;

    if document.is_encrypted() || document.was_encrypted() {
        return Err("Protect PDF expects an unlocked PDF document.".to_string());
    }

    let owner_password = random_hex_secret(32)?;
    let mut file_encryption_key = Zeroizing::new([0u8; 32]);
    getrandom::fill(&mut *file_encryption_key)
        .map_err(|error| format!("Unable to generate PDF encryption key: {error}"))?;

    let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
    let encryption_state = EncryptionState::try_from(EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
        file_encryption_key: &*file_encryption_key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: owner_password.as_str(),
        user_password: password.as_str(),
        permissions: Permissions::all(),
    })
    .map_err(|error| format!("Unable to configure PDF protection: {error}"))?;

    document.version = "2.0".to_string();
    document
        .encrypt(&encryption_state)
        .map_err(|error| format!("Unable to protect PDF: {error}"))?;

    serialize_document(&mut document)
}

#[tauri::command]
pub fn prepare_pdf_for_open(
    bytes: Vec<u8>,
    password: Option<String>,
) -> Result<PdfOpenSecurityOutcome, String> {
    prepare_pdf_for_open_impl(&bytes, password)
}

#[tauri::command]
pub fn protect_pdf_bytes(bytes: Vec<u8>, password: String) -> Result<Vec<u8>, String> {
    protect_pdf_bytes_impl(&bytes, password)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn sample_pdf() -> Vec<u8> {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let page_id = document.add_object(lopdf::dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });

        document.objects.insert(
            pages_id,
            lopdf::Object::Dictionary(lopdf::dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = document.add_object(lopdf::dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);

        serialize_document(&mut document).unwrap()
    }

    #[test]
    fn leaves_unprotected_pdfs_unchanged() {
        let result = prepare_pdf_for_open_impl(&sample_pdf(), None).unwrap();

        assert!(matches!(result, PdfOpenSecurityOutcome::Unprotected));
    }

    #[test]
    fn protects_and_unlocks_a_pdf_with_a_user_password() {
        let sample_pdf = sample_pdf();
        let protected = protect_pdf_bytes_impl(&sample_pdf, "correct horse".to_string()).unwrap();
        let encrypted = Document::load_mem(&protected).unwrap();
        let encryption_dictionary = encrypted.get_encrypted().unwrap();

        assert_eq!(
            encryption_dictionary.get(b"V").unwrap().as_i64().unwrap(),
            5
        );
        assert_eq!(
            encryption_dictionary.get(b"R").unwrap().as_i64().unwrap(),
            6
        );

        assert!(matches!(
            prepare_pdf_for_open_impl(&protected, None).unwrap(),
            PdfOpenSecurityOutcome::PasswordRequired
        ));
        assert!(matches!(
            prepare_pdf_for_open_impl(&protected, Some("wrong".to_string())).unwrap(),
            PdfOpenSecurityOutcome::IncorrectPassword
        ));

        let unlocked =
            prepare_pdf_for_open_impl(&protected, Some("correct horse".to_string())).unwrap();
        let PdfOpenSecurityOutcome::Unlocked { bytes } = unlocked else {
            panic!("expected unlocked PDF bytes");
        };

        let original = Document::load_mem(&sample_pdf).unwrap();
        let unlocked = Document::load_mem(&bytes).unwrap();

        assert!(!unlocked.is_encrypted());
        assert_eq!(unlocked.get_pages().len(), original.get_pages().len());
    }

    #[test]
    fn rejects_empty_and_oversized_protection_passwords() {
        let sample_pdf = sample_pdf();

        assert!(protect_pdf_bytes_impl(&sample_pdf, String::new()).is_err());
        assert!(protect_pdf_bytes_impl(&sample_pdf, "x".repeat(128)).is_err());
    }
}
