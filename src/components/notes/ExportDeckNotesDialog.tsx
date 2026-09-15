import { FileText, Image, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  getDeckNotesExportFileName,
  type DeckNotesExportFormat,
  type DeckNotesExportOptions,
} from '../../lib/notes/deckNotesExport';
import { getNotedPageCount, hasPageNoteContent } from '../../lib/notes/pageNotes';
import type { PdfWorkspace } from '../../lib/pdf/types';

type ExportDeckNotesDialogProps = {
  isExporting: boolean;
  onClose: () => void;
  onExport: (options: DeckNotesExportOptions) => void;
  workspace: PdfWorkspace;
};

export function ExportDeckNotesDialog({
  isExporting,
  onClose,
  onExport,
  workspace,
}: ExportDeckNotesDialogProps) {
  const [format, setFormat] = useState<DeckNotesExportFormat>('pdf');
  const [includeEmptySlides, setIncludeEmptySlides] = useState(false);
  const visiblePages = useMemo(
    () => workspace.pages.filter((page) => !page.deleted),
    [workspace.pages],
  );
  const visiblePageCount = visiblePages.length;
  const notedPageCount = getNotedPageCount(workspace);
  const exportSlideCount = includeEmptySlides ? visiblePageCount : notedPageCount;
  const fileName = getDeckNotesExportFileName(workspace, format);
  const firstExportedSlideNumber = includeEmptySlides
    ? 1
    : visiblePages.findIndex((page) => hasPageNoteContent(workspace.pageNotes?.[page.id])) + 1;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isExporting) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExporting, onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="export-deck-notes-title"
        aria-modal="true"
        className="export-deck-notes-dialog"
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <span className="modal-eyebrow">Private workspace notes</span>
            <h2 id="export-deck-notes-title">Export deck notes</h2>
          </div>
          <button
            aria-label="Close"
            className="modal-close-button"
            disabled={isExporting}
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={14} />
          </button>
        </header>

        <div className="deck-notes-export-body">
          <div className="deck-notes-export-settings">
            <section aria-labelledby="deck-notes-format-label">
              <div className="deck-notes-export-section-heading">
                <h3 id="deck-notes-format-label">Format</h3>
                <span>
                  {notedPageCount} of {visiblePageCount} slides have notes
                </span>
              </div>
              <div className="deck-notes-format-selector" role="group" aria-label="Export format">
                <button
                  aria-pressed={format === 'pdf'}
                  disabled={isExporting}
                  onClick={() => setFormat('pdf')}
                  type="button"
                >
                  <FileText size={16} />
                  <span>
                    <strong>PDF</strong>
                    <small>Ready to print</small>
                  </span>
                </button>
                <button
                  aria-pressed={format === 'docx'}
                  disabled={isExporting}
                  onClick={() => setFormat('docx')}
                  type="button"
                >
                  <FileText size={16} />
                  <span>
                    <strong>DOCX</strong>
                    <small>Continue editing</small>
                  </span>
                </button>
              </div>
            </section>

            <section aria-labelledby="deck-notes-content-label">
              <h3 id="deck-notes-content-label">Slides</h3>
              <label className="deck-notes-include-empty">
                <input
                  checked={includeEmptySlides}
                  disabled={isExporting}
                  onChange={(event) => setIncludeEmptySlides(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>Include slides without notes</strong>
                  <small>They will be labeled “No notes for this slide.”</small>
                </span>
              </label>
            </section>

            <div className="deck-notes-export-file">
              <span>File name</span>
              <strong title={fileName}>{fileName}</strong>
            </div>

            {exportSlideCount === 0 ? (
              <p className="modal-validation-message" role="alert">
                Add notes to at least one slide or include slides without notes.
              </p>
            ) : null}
          </div>

          <aside className="deck-notes-export-preview" aria-label="Export layout preview">
            <div className="deck-notes-preview-sheet">
              <span className="deck-notes-preview-deck-name">{workspace.name}</span>
              <strong>Slide {Math.max(1, firstExportedSlideNumber)}</strong>
              <span className="deck-notes-preview-slide">
                <Image aria-hidden="true" size={22} />
              </span>
              <span className="deck-notes-preview-line wide" />
              <span className="deck-notes-preview-line" />
              <span className="deck-notes-preview-line short" />
            </div>
            <p>Each section keeps its slide image and formatted notes together.</p>
          </aside>
        </div>

        <footer className="modal-actions">
          <span className="deck-notes-export-count">
            {exportSlideCount} {exportSlideCount === 1 ? 'slide' : 'slides'} will be exported
          </span>
          <button
            className="cancel-action-button"
            disabled={isExporting}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={isExporting || exportSlideCount === 0}
            onClick={() => onExport({ format, includeEmptySlides })}
            type="button"
          >
            {isExporting ? 'Exporting…' : `Export ${format.toUpperCase()}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
