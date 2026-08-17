import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import {
  PdfPasswordCancelledError,
  PdfSecurityError,
  getPdfPasswordValidationError,
  preparePdfBytesForOpen,
  protectPdfBytes,
} from './pdfSecurity';

describe('pdfSecurity', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('prompts again after an incorrect password and returns unlocked bytes', async () => {
    invoke
      .mockResolvedValueOnce({ status: 'password-required' })
      .mockResolvedValueOnce({ status: 'incorrect-password' })
      .mockResolvedValueOnce({ status: 'unlocked', bytes: [9, 8, 7] });
    const requestPassword = vi
      .fn()
      .mockResolvedValueOnce('wrong password')
      .mockResolvedValueOnce('correct password');

    await expect(
      preparePdfBytesForOpen({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: 'locked.pdf',
        requestPassword,
      }),
    ).resolves.toEqual({
      bytes: new Uint8Array([9, 8, 7]),
      password: 'correct password',
      wasEncrypted: true,
    });
    expect(requestPassword).toHaveBeenNthCalledWith(1, {
      fileName: 'locked.pdf',
      reason: 'required',
    });
    expect(requestPassword).toHaveBeenNthCalledWith(2, {
      fileName: 'locked.pdf',
      reason: 'incorrect',
    });
  });

  it('uses a typed cancellation error when password entry is cancelled', async () => {
    invoke.mockResolvedValueOnce({ status: 'password-required' });

    await expect(
      preparePdfBytesForOpen({
        bytes: new Uint8Array([1]),
        fileName: 'locked.pdf',
        requestPassword: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toBeInstanceOf(PdfPasswordCancelledError);
  });

  it('reports unsupported PDF encryption with a useful error', async () => {
    invoke.mockResolvedValueOnce({ status: 'unsupported-encryption' });

    await expect(
      preparePdfBytesForOpen({
        bytes: new Uint8Array([1]),
        fileName: 'legacy.pdf',
      }),
    ).rejects.toMatchObject({
      userMessage: 'This PDF uses an encryption method Paperdesk does not support.',
    });
  });

  it('validates protection passwords before invoking native encryption', async () => {
    expect(getPdfPasswordValidationError('')).toBe('Enter a password.');
    expect(getPdfPasswordValidationError('x'.repeat(128))).toContain('127');

    await expect(protectPdfBytes(new Uint8Array([1]), '')).rejects.toBeInstanceOf(PdfSecurityError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns AES-protected bytes produced by the native command', async () => {
    invoke.mockResolvedValueOnce([4, 5, 6]);

    await expect(protectPdfBytes(new Uint8Array([1, 2]), 'session secret')).resolves.toEqual(
      new Uint8Array([4, 5, 6]),
    );
    expect(invoke).toHaveBeenCalledWith('protect_pdf_bytes', {
      bytes: [1, 2],
      password: 'session secret',
    });
  });
});
