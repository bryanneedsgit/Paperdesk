use tauri_plugin_opener::OpenerExt;

fn validate_web_link(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "Invalid web link".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS web links are supported".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn open_pdf_web_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = validate_web_link(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Unable to open the default browser".into())
}

#[cfg(test)]
mod tests {
    use super::validate_web_link;

    #[test]
    fn accepts_web_links_and_preserves_their_destination() {
        for value in [
            "https://example.com/paper?q=one%20two#section",
            "http://example.org/",
        ] {
            assert_eq!(validate_web_link(value).unwrap().as_str(), value);
        }
    }

    #[test]
    fn rejects_executable_local_and_credential_bearing_links() {
        for value in [
            "javascript:alert(1)",
            "data:text/html,hello",
            "file:///tmp/example.pdf",
            "mailto:test@example.com",
            "ms-settings:display",
            "https://user:secret@example.com",
            "not a url",
        ] {
            assert!(validate_web_link(value).is_err(), "{value}");
        }
    }
}
