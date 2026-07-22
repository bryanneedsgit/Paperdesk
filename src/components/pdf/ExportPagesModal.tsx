import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import {
  getPdfExportErrorMessage,
  parsePageRanges,
  type PdfPageRange,
} from '../../lib/pdf/pdfExporter';

export type ExportPagesModalMode = 'selected' | 'ranges';

type ExportPagesModalProps = {
  isExporting: boolean;
  mode: ExportPagesModalMode;
  onClose: () => void;
  onExportSelectedPages: () => void;
  onSplitRanges: (ranges: PdfPageRange[]) => void;
  pageCount: number;
  selectedPageCount: number;
};

function getInitialRangeInput(pageCount: number): string {
  if (pageCount <= 0) {
    return '';
  }

  return pageCount >= 3 ? '1-3' : `1-${pageCount}`;
}

export function ExportPagesModal({
  isExporting,
  mode,
  onClose,
  onExportSelectedPages,
  onSplitRanges,
  pageCount,
  selectedPageCount,
}: ExportPagesModalProps) {
  const [rangeInput, setRangeInput] = useState(() => getInitialRangeInput(pageCount));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const parsedRanges = useMemo(() => {
    if (mode !== 'ranges') {
      return [];
    }

    try {
      return parsePageRanges(rangeInput, pageCount);
    } catch {
      return [];
    }
  }, [mode, pageCount, rangeInput]);

  useEffect(() => {
    setValidationMessage(null);
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isExporting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExporting, onClose]);

  const handleSubmit = () => {
    if (mode === 'selected') {
      if (selectedPageCount === 0) {
        setValidationMessage('Select at least one page in the thumbnail sidebar first.');
        return;
      }

      onExportSelectedPages();
      return;
    }

    try {
      const ranges = parsePageRanges(rangeInput, pageCount);
      setValidationMessage(null);
      onSplitRanges(ranges);
    } catch (error) {
      setValidationMessage(getPdfExportErrorMessage(error));
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="export-pages-modal-title"
        aria-modal="true"
        className="export-pages-modal"
        role="dialog"
      >
        <header className="modal-header">
          <h2 id="export-pages-modal-title">
            {mode === 'selected' ? 'Export selected pages' : 'Split by ranges'}
          </h2>
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

        {mode === 'selected' ? (
          <div className="modal-body">
            <p>
              {selectedPageCount
                ? `${selectedPageCount} selected ${selectedPageCount === 1 ? 'page' : 'pages'} will be exported as a new PDF.`
                : 'No pages are selected.'}
            </p>
          </div>
        ) : (
          <div className="modal-body">
            <label className="range-input-control">
              <span>Page ranges</span>
              <input
                autoFocus
                disabled={isExporting}
                onChange={(event) => {
                  setRangeInput(event.target.value);
                  setValidationMessage(null);
                }}
                placeholder="1-3,5,8-10"
                value={rangeInput}
              />
            </label>
            <p className="modal-help-text">
              Use visible workspace page numbers from 1 to {pageCount}. Each comma-separated range
              exports as a separate PDF.
            </p>
            {parsedRanges.length ? (
              <p className="modal-help-text">
                {parsedRanges.length} {parsedRanges.length === 1 ? 'PDF' : 'PDFs'} will be saved.
              </p>
            ) : null}
          </div>
        )}

        {validationMessage ? (
          <p className="modal-validation-message" role="alert">
            {validationMessage}
          </p>
        ) : null}

        <footer className="modal-actions">
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
            disabled={
              isExporting || pageCount === 0 || (mode === 'selected' && selectedPageCount === 0)
            }
            onClick={handleSubmit}
            type="button"
          >
            {isExporting
              ? 'Exporting...'
              : mode === 'selected'
                ? 'Export selected pages'
                : 'Split and export'}
          </button>
        </footer>
      </section>
    </div>
  );
}
