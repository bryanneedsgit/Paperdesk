import { invoke } from '@tauri-apps/api/core';

export const maxPdfPasswordBytes = 127;

export type PdfPasswordRequest = {
  fileName: string;
  reason: 'incorrect' | 'required';
};

export type PdfPasswordProvider = (request: PdfPasswordRequest) => Promise<string | null>;

type PdfOpenSecurityOutcome =
  | { status: 'incorrect-password' }
  | { status: 'password-required' }
  | { status: 'unprotected' }
  | { status: 'unlocked'; bytes: number[] }
  | { status: 'unsupported-encryption' };

export type PreparedPdfBytes = {
  bytes: Uint8Array;
  password?: string;
  wasEncrypted: boolean;
};

export class PdfPasswordCancelledError extends Error {
  constructor() {
    super('PDF password entry was cancelled.');
    this.name = 'PdfPasswordCancelledError';
  }
}

export class PdfSecurityError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PdfSecurityError';
  }
}

function toByteArray(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

async function inspectPdfSecurity(
  bytes: Uint8Array,
  password?: string,
): Promise<PdfOpenSecurityOutcome> {
  return invoke<PdfOpenSecurityOutcome>('prepare_pdf_for_open', {
    bytes: toByteArray(bytes),
    password: password ?? null,
  });
}

export async function preparePdfBytesForOpen({
  bytes,
  fileName,
  requestPassword,
}: {
  bytes: Uint8Array;
  fileName: string;
  requestPassword?: PdfPasswordProvider;
}): Promise<PreparedPdfBytes> {
  let password: string | undefined;
  let outcome = await inspectPdfSecurity(bytes);

  while (outcome.status === 'password-required' || outcome.status === 'incorrect-password') {
    if (!requestPassword) {
      throw new PdfSecurityError(
        'A password is required to open this PDF.',
        'This PDF is password-protected.',
        'Enter its password to open and edit it locally.',
      );
    }

    const nextPassword = await requestPassword({
      fileName,
      reason: outcome.status === 'incorrect-password' ? 'incorrect' : 'required',
    });

    if (nextPassword === null) {
      throw new PdfPasswordCancelledError();
    }

    password = nextPassword;
    outcome = await inspectPdfSecurity(bytes, password);
  }

  if (outcome.status === 'unsupported-encryption') {
    throw new PdfSecurityError(
      'The PDF encryption scheme is not supported.',
      'This PDF uses an encryption method Paperdesk does not support.',
      'Try saving a password-protected copy with a modern PDF application.',
    );
  }

  if (outcome.status === 'unlocked') {
    return {
      bytes: new Uint8Array(outcome.bytes),
      password: password ?? '',
      wasEncrypted: true,
    };
  }

  return { bytes, wasEncrypted: false };
}

export function getPdfPasswordValidationError(password: string): string | null {
  const passwordByteLength = new TextEncoder().encode(password).byteLength;

  if (passwordByteLength === 0) {
    return 'Enter a password.';
  }

  if (passwordByteLength > maxPdfPasswordBytes) {
    return `Use at most ${maxPdfPasswordBytes} UTF-8 bytes.`;
  }

  return null;
}

export async function protectPdfBytes(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const validationError = getPdfPasswordValidationError(password);

  if (validationError) {
    throw new PdfSecurityError(validationError, validationError);
  }

  try {
    const protectedBytes = await invoke<number[]>('protect_pdf_bytes', {
      bytes: toByteArray(bytes),
      password,
    });

    return new Uint8Array(protectedBytes);
  } catch {
    throw new PdfSecurityError(
      'Unable to protect PDF bytes.',
      'Paperdesk could not password-protect this PDF.',
      'Try another password or export an unlocked copy.',
    );
  }
}

export function getPdfSecurityErrorMessage(error: unknown): string {
  return error instanceof PdfSecurityError
    ? error.userMessage
    : 'Paperdesk could not update this PDF’s password protection.';
}

export function isPdfPasswordCancelledError(error: unknown): boolean {
  return error instanceof PdfPasswordCancelledError;
}
