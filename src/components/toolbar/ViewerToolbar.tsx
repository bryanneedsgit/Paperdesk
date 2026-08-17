import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Hand,
  LayoutGrid,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { PdfAnnotationTool, PdfWorkspace } from '../../lib/pdf/types';
import { AnnotationToolbar } from '../annotations/AnnotationToolbar';

type ViewerToolbarProps = {
  activePageNumber: number;
  canGoNext: boolean;
  canGoPrevious: boolean;
  canRotateSelection: boolean;
  hasSignatureImage: boolean;
  findActiveIndex: number;
  findQuery: string;
  findResultCount: number;
  findStatus: string;
  isAnnotating: boolean;
  isFindOpen: boolean;
  isHandToolActive: boolean;
  isActivePageBookmarked: boolean;
  isPageOverviewOpen: boolean;
  onGoNext: () => void;
  onGoPrevious: () => void;
  onChangeFindQuery: (query: string) => void;
  onCloseFind: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onPageNumberChange: (pageNumber: number) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onSelectAnnotationTool: (tool: PdfAnnotationTool) => void;
  onToggleAnnotating: () => void;
  onToggleActivePageBookmark: () => void;
  onToggleHandTool: () => void;
  onTogglePageOverview: () => void;
  pageCount: number;
  selectedAnnotationTool: PdfAnnotationTool;
  workspace: PdfWorkspace | null;
};

function IconButton({
  children,
  disabled,
  isPressed,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  isPressed?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={isPressed}
      className="viewer-icon-button"
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function FindBar({
  activeIndex,
  onChangeQuery,
  onClose,
  onNext,
  onPrevious,
  query,
  resultCount,
  status,
}: {
  activeIndex: number;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  query: string;
  resultCount: number;
  status: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="find-toolbar" role="search" aria-label="Find text in document">
      <input
        aria-label="Find text"
        onChange={(event) => onChangeQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();

            if (event.shiftKey) {
              onPrevious();
            } else {
              onNext();
            }
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find"
        ref={inputRef}
        type="search"
        value={query}
      />
      <span className="find-toolbar-status">
        {resultCount > 0 ? `${activeIndex + 1} of ${resultCount}` : status}
      </span>
      <button
        aria-label="Previous match"
        className="viewer-icon-button find-toolbar-button"
        data-tooltip="Previous match"
        disabled={resultCount === 0}
        onClick={onPrevious}
        type="button"
      >
        <ChevronLeft size={15} />
      </button>
      <button
        aria-label="Next match"
        className="viewer-icon-button find-toolbar-button"
        data-tooltip="Next match"
        disabled={resultCount === 0}
        onClick={onNext}
        type="button"
      >
        <ChevronRight size={15} />
      </button>
      <button className="find-toolbar-close" onClick={onClose} type="button">
        Close
      </button>
    </div>
  );
}

export function ViewerToolbar({
  activePageNumber,
  canGoNext,
  canGoPrevious,
  canRotateSelection,
  findActiveIndex,
  findQuery,
  findResultCount,
  findStatus,
  hasSignatureImage,
  isAnnotating,
  isFindOpen,
  isHandToolActive,
  isActivePageBookmarked,
  isPageOverviewOpen,
  onChangeFindQuery,
  onCloseFind,
  onFindNext,
  onFindPrevious,
  onGoNext,
  onGoPrevious,
  onPageNumberChange,
  onRotateLeft,
  onRotateRight,
  onSelectAnnotationTool,
  onToggleAnnotating,
  onToggleActivePageBookmark,
  onToggleHandTool,
  onTogglePageOverview,
  pageCount,
  selectedAnnotationTool,
  workspace,
}: ViewerToolbarProps) {
  const disabled = !workspace || pageCount === 0;
  const [pageInput, setPageInput] = useState(activePageNumber ? String(activePageNumber) : '');

  useEffect(() => {
    setPageInput(activePageNumber ? String(activePageNumber) : '');
  }, [activePageNumber]);

  const commitPageInput = () => {
    const nextPageNumber = Number.parseInt(pageInput, 10);

    if (!Number.isFinite(nextPageNumber)) {
      setPageInput(activePageNumber ? String(activePageNumber) : '');
      return;
    }

    const clampedPageNumber = Math.min(Math.max(nextPageNumber, 1), pageCount || 1);
    setPageInput(String(clampedPageNumber));
    onPageNumberChange(clampedPageNumber);
  };

  return (
    <div className="viewer-toolbar" aria-label="Viewer controls">
      <div className="viewer-toolbar-group" aria-label="Page navigation">
        <IconButton
          disabled={disabled || !canGoPrevious}
          label="Previous page"
          onClick={onGoPrevious}
        >
          <ChevronLeft size={17} />
        </IconButton>
        <label className="page-jump-control">
          <span className="sr-only">Page number</span>
          <input
            aria-label="Page number"
            disabled={disabled}
            inputMode="numeric"
            max={pageCount || undefined}
            min={1}
            onBlur={commitPageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            type="number"
            value={pageInput}
          />
          <span className="page-count-label">/ {pageCount || 0}</span>
        </label>
        <IconButton disabled={disabled || !canGoNext} label="Next page" onClick={onGoNext}>
          <ChevronRight size={17} />
        </IconButton>
        <span className="viewer-toolbar-separator" aria-hidden="true" />
        <IconButton
          disabled={disabled}
          isPressed={isActivePageBookmarked}
          label={
            isActivePageBookmarked
              ? `Remove bookmark from page ${activePageNumber}`
              : `Bookmark page ${activePageNumber}`
          }
          onClick={onToggleActivePageBookmark}
        >
          <Bookmark fill={isActivePageBookmarked ? 'currentColor' : 'none'} size={16} />
        </IconButton>
        <IconButton
          disabled={disabled}
          isPressed={isPageOverviewOpen}
          label={isPageOverviewOpen ? 'Close page overview' : 'Open page overview'}
          onClick={onTogglePageOverview}
        >
          <LayoutGrid size={16} />
        </IconButton>
      </div>

      <div className="viewer-toolbar-spacer">
        {isFindOpen ? (
          <FindBar
            activeIndex={findActiveIndex}
            onChangeQuery={onChangeFindQuery}
            onClose={onCloseFind}
            onNext={onFindNext}
            onPrevious={onFindPrevious}
            query={findQuery}
            resultCount={findResultCount}
            status={findStatus}
          />
        ) : isAnnotating && selectedAnnotationTool === 'text-note' ? (
          <div className="viewer-mode-hint" role="status">
            Drag over embedded PDF text to add a comment.
          </div>
        ) : isAnnotating && selectedAnnotationTool === 'edit-text' ? (
          <div className="viewer-mode-hint" role="status">
            Drag over embedded PDF text to create an editable replacement.
          </div>
        ) : null}
      </div>

      <div className="viewer-toolbar-group" aria-label="Page rotation and zoom controls">
        <IconButton
          disabled={disabled}
          isPressed={isHandToolActive}
          label={isHandToolActive ? 'Exit hand tool' : 'Hand tool'}
          onClick={onToggleHandTool}
        >
          <Hand size={16} />
        </IconButton>
        <span className="viewer-toolbar-separator" aria-hidden="true" />
        <AnnotationToolbar
          activeTool={selectedAnnotationTool}
          disabled={disabled}
          hasSignatureImage={hasSignatureImage}
          isAnnotating={isAnnotating}
          onSelectTool={onSelectAnnotationTool}
          onToggleAnnotating={onToggleAnnotating}
        />
        <span className="viewer-toolbar-separator" aria-hidden="true" />
        <IconButton
          disabled={disabled || !canRotateSelection}
          label="Rotate selected pages left"
          onClick={onRotateLeft}
        >
          <RotateCcw size={16} />
        </IconButton>
        <IconButton
          disabled={disabled || !canRotateSelection}
          label="Rotate selected pages right"
          onClick={onRotateRight}
        >
          <RotateCw size={16} />
        </IconButton>
      </div>
    </div>
  );
}
