import { describe, expect, it } from 'vitest';

import { classifyPdfExportError, classifyPdfOpenError, getFriendlyErrorSuggestion } from './errors';

describe('friendly PDF error classification', () => {
  it('maps password-protected open failures to the password message', () => {
    const error = classifyPdfOpenError(new Error('PasswordException: NeedPassword'));

    expect(error.code).toBe('password-protected');
    expect(error.userMessage).toBe(
      'This PDF appears to be password-protected. Password support is not available yet.',
    );
    expect(error.suggestion).toContain('Remove the password');
  });

  it('maps corrupted PDF parse failures to a recovery suggestion', () => {
    const error = classifyPdfOpenError(new Error('Invalid PDF structure: xref trailer missing'));

    expect(error.code).toBe('corrupted-pdf');
    expect(error.userMessage).toBe('This PDF appears to be damaged or corrupted.');
    expect(error.suggestion).toContain('saving a fresh copy');
  });

  it('maps write permission export failures to a different-location message', () => {
    const error = classifyPdfExportError(new Error('EACCES: permission denied'));

    expect(error.code).toBe('permission-denied');
    expect(error.userMessage).toBe(
      'Could not export the PDF. Please choose a different save location.',
    );
  });

  it('maps missing source export failures to relink guidance', () => {
    const error = classifyPdfExportError(new Error('Missing source PDF document.'));

    expect(error.code).toBe('missing-source');
    expect(error.userMessage).toBe('One source file is missing. Relink it before exporting.');
    expect(getFriendlyErrorSuggestion({ suggestion: error.suggestion })).toBe(
      'Relink missing source files, then export again.',
    );
  });

  it('maps memory pressure to large PDF guidance', () => {
    const error = classifyPdfOpenError(new RangeError('Array buffer allocation failed'));

    expect(error.code).toBe('large-pdf');
    expect(error.userMessage).toBe(
      'This PDF is very large and could not be processed on this device.',
    );
  });
});
