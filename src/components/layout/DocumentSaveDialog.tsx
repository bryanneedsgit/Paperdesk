import { useCallback } from 'react';
import { useModalFocusTrap } from './useModalFocusTrap';

export type DocumentSaveChoice = 'ppd' | 'pdf' | 'save' | 'discard' | null;
export type DocumentSaveRequest = { kind: 'format' | 'close'; name: string };

export function DocumentSaveDialog({
  request,
  onChoose,
}: {
  request: DocumentSaveRequest;
  onChoose: (choice: DocumentSaveChoice) => void;
}) {
  const onCancel = useCallback(() => onChoose(null), [onChoose]);
  const dialogRef = useModalFocusTrap<HTMLDivElement>(onCancel);
  const isFormatChoice = request.kind === 'format';
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-save-title"
        aria-describedby="document-save-description"
        className="app-dialog pdf-security-dialog"
      >
        <header className="modal-header pdf-security-dialog-heading">
          <div>
            <h2 id="document-save-title">
              {isFormatChoice
                ? 'Save your notes with this document?'
                : `Save changes to “${request.name}”?`}
            </h2>
            <p id="document-save-description">
              {isFormatChoice
                ? 'A PaperDesk (.ppd) file keeps your document, editable changes, and notes together. Exporting a PDF excludes notes.'
                : 'Save your changes before closing this document.'}
            </p>
          </div>
        </header>
        <div className="pdf-export-security-choices">
          <button
            data-dialog-initial-focus
            type="button"
            onClick={() => onChoose(isFormatChoice ? 'ppd' : 'save')}
          >
            <strong>{isFormatChoice ? 'Save as .ppd' : 'Save'}</strong>
            {isFormatChoice && <span>Recommended for documents with notes</span>}
          </button>
          <button type="button" onClick={() => onChoose(isFormatChoice ? 'pdf' : 'discard')}>
            <strong>{isFormatChoice ? 'Export PDF' : 'Discard'}</strong>
            {isFormatChoice && <span>Notes stay in PaperDesk and are excluded from the PDF</span>}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
