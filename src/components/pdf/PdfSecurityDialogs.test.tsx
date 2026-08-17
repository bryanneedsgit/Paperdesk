import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfPasswordDialog, ProtectedPdfExportDialog } from './PdfSecurityDialogs';

afterEach(cleanup);

describe('PdfPasswordDialog', () => {
  it('shows an incorrect-password retry and submits the next password', () => {
    const onSubmit = vi.fn();

    render(
      <PdfPasswordDialog
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        request={{
          fileName: 'locked.pdf',
          id: 'request-1',
          kind: 'open',
          reason: 'incorrect',
        }}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('did not unlock');
    fireEvent.change(screen.getByLabelText('PDF password'), {
      target: { value: 'correct password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock PDF' }));

    expect(onSubmit).toHaveBeenCalledWith('correct password');
  });

  it('requires matching passwords when creating protection', () => {
    const onSubmit = vi.fn();

    render(
      <PdfPasswordDialog
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        request={{
          description: 'Protect a copy.',
          id: 'request-2',
          kind: 'create',
          submitLabel: 'Protect PDF',
          title: 'Lock PDF copy',
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'first value' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Protect PDF' }));

    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'first value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Protect PDF' }));

    expect(onSubmit).toHaveBeenCalledWith('first value');
  });
});

describe('ProtectedPdfExportDialog', () => {
  it('returns the explicit protection choice', () => {
    const onChoose = vi.fn();

    render(<ProtectedPdfExportDialog onCancel={vi.fn()} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: /Keep protected/ }));

    expect(onChoose).toHaveBeenCalledWith('protected');
  });
});
