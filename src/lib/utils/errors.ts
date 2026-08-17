export type FriendlyErrorCode =
  | 'cancelled'
  | 'corrupted-pdf'
  | 'encrypted-pdf'
  | 'export-failed'
  | 'large-pdf'
  | 'missing-source'
  | 'password-protected'
  | 'permission-denied'
  | 'unknown'
  | 'unsupported-form-fields';

export type FriendlyError = {
  code: FriendlyErrorCode;
  developerMessage?: string;
  suggestion?: string;
  userMessage: string;
};

export class AppFriendlyError extends Error {
  readonly code: FriendlyErrorCode;
  readonly suggestion?: string;

  constructor(
    readonly friendlyError: FriendlyError,
    readonly cause?: unknown,
  ) {
    super(friendlyError.developerMessage ?? friendlyError.userMessage);
    this.name = 'AppFriendlyError';
    this.code = friendlyError.code;
    this.suggestion = friendlyError.suggestion;
  }

  get userMessage(): string {
    return this.friendlyError.userMessage;
  }
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function includesAny(value: string, patterns: string[]): boolean {
  const normalizedValue = value.toLowerCase();

  return patterns.some((pattern) => normalizedValue.includes(pattern));
}

export function classifyPdfOpenError(error: unknown): FriendlyError {
  const text = getErrorText(error);

  if (
    includesAny(text, [
      'allocation',
      'array buffer',
      'heap',
      'maximum call stack',
      'out of memory',
      'rangeerror',
      'too large',
    ])
  ) {
    return {
      code: 'large-pdf',
      developerMessage: text,
      suggestion: 'Try closing other apps, splitting the PDF first, or opening a smaller file.',
      userMessage: 'This PDF is very large and could not be processed on this device.',
    };
  }

  if (includesAny(text, ['password', 'passwordexception', 'needpassword', 'incorrect password'])) {
    return {
      code: 'password-protected',
      developerMessage: text,
      suggestion: 'Check the password and try again, or save an unlocked copy in another PDF app.',
      userMessage: 'This password-protected PDF could not be unlocked.',
    };
  }

  if (includesAny(text, ['encrypt', 'encrypted', 'ignoreencryption'])) {
    return {
      code: 'encrypted-pdf',
      developerMessage: text,
      suggestion: 'Try saving a modern password-protected or unlocked copy in another PDF app.',
      userMessage: 'This PDF uses encryption that Paperdesk could not unlock.',
    };
  }

  if (
    includesAny(text, [
      'permission',
      'denied',
      'notallowed',
      'eacces',
      'eperm',
      'operation not permitted',
    ])
  ) {
    return {
      code: 'permission-denied',
      developerMessage: text,
      suggestion:
        'Check file permissions. On macOS, grant file access when prompted; on Windows, close other apps that may be locking the file.',
      userMessage: 'Paperdesk does not have permission to read this PDF.',
    };
  }

  if (includesAny(text, ['invalid pdf', 'corrupt', 'corrupted', 'xref', 'trailer', 'parse'])) {
    return {
      code: 'corrupted-pdf',
      developerMessage: text,
      suggestion: 'Try opening the file in another PDF app and saving a fresh copy.',
      userMessage: 'This PDF appears to be damaged or corrupted.',
    };
  }

  if (includesAny(text, ['not found', 'enoent', 'cannot find', 'missing'])) {
    return {
      code: 'missing-source',
      developerMessage: text,
      suggestion: 'Choose the file again or relink the missing source.',
      userMessage: 'One source file is missing. Relink it before exporting.',
    };
  }

  return {
    code: 'unknown',
    developerMessage: text,
    suggestion: 'Try a different PDF or save a fresh copy from the source application.',
    userMessage: 'Paperdesk could not open the selected PDF.',
  };
}

export function classifyPdfExportError(error: unknown): FriendlyError {
  const text = getErrorText(error);

  if (
    includesAny(text, [
      'allocation',
      'array buffer',
      'heap',
      'maximum call stack',
      'out of memory',
      'rangeerror',
      'too large',
    ])
  ) {
    return {
      code: 'large-pdf',
      developerMessage: text,
      suggestion: 'Try exporting fewer pages or splitting the workspace into smaller PDFs.',
      userMessage: 'This export is too large to finish on this device.',
    };
  }

  if (
    includesAny(text, [
      'permission',
      'denied',
      'notallowed',
      'eacces',
      'eperm',
      'operation not permitted',
    ])
  ) {
    return {
      code: 'permission-denied',
      developerMessage: text,
      suggestion: 'Choose a folder where you have write access, such as Documents or Desktop.',
      userMessage: 'Could not export the PDF. Please choose a different save location.',
    };
  }

  if (includesAny(text, ['not found', 'enoent', 'cannot find', 'missing source'])) {
    return {
      code: 'missing-source',
      developerMessage: text,
      suggestion: 'Relink missing source files, then export again.',
      userMessage: 'One source file is missing. Relink it before exporting.',
    };
  }

  if (includesAny(text, ['password', 'passwordexception', 'encrypt', 'encrypted'])) {
    return {
      code: includesAny(text, ['password']) ? 'password-protected' : 'encrypted-pdf',
      developerMessage: text,
      suggestion: 'Try exporting an unlocked copy, then protect it again from the Document panel.',
      userMessage: 'Paperdesk could not apply this PDF’s password protection.',
    };
  }

  if (includesAny(text, ['corrupt', 'corrupted', 'invalid pdf', 'xref', 'trailer', 'parse'])) {
    return {
      code: 'corrupted-pdf',
      developerMessage: text,
      suggestion: 'Try saving a repaired copy in another PDF app.',
      userMessage: 'Could not export the PDF because one source appears damaged.',
    };
  }

  return {
    code: 'export-failed',
    developerMessage: text,
    suggestion: 'Try a different save location or export fewer pages.',
    userMessage: 'Could not export the PDF. Please choose a different save location.',
  };
}

export function createFriendlyError(fallback: FriendlyError, cause?: unknown): AppFriendlyError {
  return new AppFriendlyError(fallback, cause);
}

export function getFriendlyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppFriendlyError) {
    return error.userMessage;
  }

  if (error && typeof error === 'object' && 'userMessage' in error) {
    const userMessage = (error as { userMessage?: unknown }).userMessage;

    if (typeof userMessage === 'string') {
      return userMessage;
    }
  }

  return fallback;
}

export function getFriendlyErrorSuggestion(error: unknown): string | undefined {
  if (error instanceof AppFriendlyError) {
    return error.suggestion;
  }

  if (error && typeof error === 'object' && 'suggestion' in error) {
    const suggestion = (error as { suggestion?: unknown }).suggestion;

    return typeof suggestion === 'string' ? suggestion : undefined;
  }

  return undefined;
}

export function logDeveloperError(context: string, error: unknown): void {
  console.error(`[Paperdesk] ${context}`, error);
}
