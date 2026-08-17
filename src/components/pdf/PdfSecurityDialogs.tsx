import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LockKeyhole, ShieldCheck, X } from 'lucide-react';

import { getPdfPasswordValidationError } from '../../lib/pdf/pdfSecurity';

export type PdfPasswordDialogRequest =
  | {
      fileName: string;
      id: string;
      kind: 'open';
      reason: 'incorrect' | 'required';
    }
  | {
      description: string;
      id: string;
      kind: 'create';
      submitLabel: string;
      title: string;
    };

type PdfPasswordDialogProps = {
  onCancel: () => void;
  onSubmit: (password: string) => void;
  request: PdfPasswordDialogRequest;
};

export type ProtectedPdfExportChoice = 'protected' | 'unlocked';

type ProtectedPdfExportDialogProps = {
  onCancel: () => void;
  onChoose: (choice: ProtectedPdfExportChoice) => void;
};

function useModalFocusTrap<T extends HTMLElement>(onCancel: () => void) {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog) {
      return;
    }

    const getFocusableElements = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    if (!dialog.contains(document.activeElement)) {
      const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
      (initialFocus ?? getFocusableElements()[0])?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [onCancel]);

  return dialogRef;
}

export function PdfPasswordDialog({ onCancel, onSubmit, request }: PdfPasswordDialogProps) {
  const passwordId = useId();
  const confirmationId = useId();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    request.kind === 'open' && request.reason === 'incorrect'
      ? 'That password did not unlock this PDF. Try again.'
      : null,
  );
  const dialogRef = useModalFocusTrap<HTMLFormElement>(onCancel);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const passwordError = getPdfPasswordValidationError(password);

    if (passwordError) {
      setValidationMessage(passwordError);
      return;
    }

    if (request.kind === 'create' && password !== confirmation) {
      setValidationMessage('Passwords do not match.');
      return;
    }

    setPassword('');
    setConfirmation('');
    onSubmit(password);
  };

  const title = request.kind === 'open' ? `Unlock ${request.fileName}` : request.title;
  const description =
    request.kind === 'open'
      ? 'Enter the password to open and edit this PDF. Paperdesk keeps it in memory only for this session.'
      : request.description;

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        aria-describedby="pdf-password-dialog-description"
        aria-labelledby="pdf-password-dialog-title"
        aria-modal="true"
        className="app-dialog pdf-security-dialog"
        onSubmit={handleSubmit}
        ref={dialogRef}
        role="dialog"
      >
        <header className="modal-header">
          <div className="pdf-security-dialog-heading">
            <span className="pdf-security-dialog-icon" aria-hidden="true">
              <LockKeyhole size={17} />
            </span>
            <div>
              <h2 id="pdf-password-dialog-title">{title}</h2>
              <p id="pdf-password-dialog-description">{description}</p>
            </div>
          </div>
          <button
            aria-label="Close"
            className="modal-close-button"
            onClick={onCancel}
            title="Close"
            type="button"
          >
            <X size={14} />
          </button>
        </header>

        <div className="modal-body pdf-password-fields">
          <div className="range-input-control">
            <label htmlFor={passwordId}>
              {request.kind === 'open' ? 'PDF password' : 'Password'}
            </label>
            <span className="pdf-password-input">
              <input
                autoComplete={request.kind === 'open' ? 'current-password' : 'new-password'}
                autoFocus
                data-dialog-initial-focus
                id={passwordId}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setValidationMessage(null);
                }}
                spellCheck={false}
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
                type="button"
              >
                {isPasswordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </div>

          {request.kind === 'create' ? (
            <label className="range-input-control" htmlFor={confirmationId}>
              <span>Confirm password</span>
              <input
                autoComplete="new-password"
                id={confirmationId}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setValidationMessage(null);
                }}
                spellCheck={false}
                type={isPasswordVisible ? 'text' : 'password'}
                value={confirmation}
              />
            </label>
          ) : null}

          {request.kind === 'create' ? (
            <p className="modal-help-text">
              Paperdesk cannot recover this password. The saved copy will use AES-256 encryption.
            </p>
          ) : null}
        </div>

        {validationMessage ? (
          <p className="modal-validation-message" role="alert">
            {validationMessage}
          </p>
        ) : null}

        <footer className="modal-actions">
          <button className="cancel-action-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary" type="submit">
            {request.kind === 'open' ? 'Unlock PDF' : request.submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function ProtectedPdfExportDialog({ onCancel, onChoose }: ProtectedPdfExportDialogProps) {
  const dialogRef = useModalFocusTrap<HTMLElement>(onCancel);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="protected-export-description"
        aria-labelledby="protected-export-title"
        aria-modal="true"
        className="app-dialog pdf-security-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="modal-header">
          <div className="pdf-security-dialog-heading">
            <span className="pdf-security-dialog-icon" aria-hidden="true">
              <ShieldCheck size={17} />
            </span>
            <div>
              <h2 id="protected-export-title">Export protected PDF?</h2>
              <p id="protected-export-description">
                This workspace contains a PDF that was opened with a password. Choose how to save
                the exported file.
              </p>
            </div>
          </div>
          <button
            aria-label="Close"
            className="modal-close-button"
            onClick={onCancel}
            title="Close"
            type="button"
          >
            <X size={14} />
          </button>
        </header>

        <div className="pdf-export-security-choices">
          <button data-dialog-initial-focus onClick={() => onChoose('protected')} type="button">
            <strong>Keep protected</strong>
            <span>Require a password when the exported PDF is opened.</span>
          </button>
          <button onClick={() => onChoose('unlocked')} type="button">
            <strong>Export unlocked</strong>
            <span>Save a copy that opens without a password.</span>
          </button>
        </div>

        <footer className="modal-actions">
          <button className="cancel-action-button" onClick={onCancel} type="button">
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
