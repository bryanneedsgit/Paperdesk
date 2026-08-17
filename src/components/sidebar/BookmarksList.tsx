import { Bookmark, X } from 'lucide-react';
import { useMemo } from 'react';

import { isSourcePageItem } from '../../lib/pdf/pdfWorkspace';
import type { PdfPageId, PdfWorkspace } from '../../lib/pdf/types';

type BookmarksListProps = {
  onActivatePage: (pageId: PdfPageId) => void;
  onRemoveBookmark: (pageId: PdfPageId) => void;
  workspace: PdfWorkspace;
};

export function BookmarksList({ onActivatePage, onRemoveBookmark, workspace }: BookmarksListProps) {
  const bookmarkedPages = useMemo(() => {
    const bookmarkedPageIds = new Set(workspace.bookmarkedPageIds);

    return workspace.pages.filter((page) => !page.deleted && bookmarkedPageIds.has(page.id));
  }, [workspace.bookmarkedPageIds, workspace.pages]);
  const showSourceLabels = workspace.documents.length > 1;

  if (bookmarkedPages.length === 0) {
    return (
      <div className="bookmarks-empty-state" role="status">
        <Bookmark aria-hidden="true" size={22} />
        <strong>No bookmarked pages</strong>
        <span>Use the bookmark button beside the page controls to save one.</span>
      </div>
    );
  }

  return (
    <div className="bookmarks-list" aria-label="Bookmarked pages" role="list">
      {bookmarkedPages.map((page) => (
        <div
          className="bookmark-list-item"
          data-active={workspace.activePageId === page.id ? 'true' : undefined}
          key={page.id}
          role="listitem"
        >
          <button
            aria-current={workspace.activePageId === page.id ? 'page' : undefined}
            className="bookmark-jump-button"
            onClick={() => onActivatePage(page.id)}
            type="button"
          >
            <Bookmark aria-hidden="true" fill="currentColor" size={16} />
            <span className="bookmark-page-copy">
              <strong>Page {page.displayIndex}</strong>
              {showSourceLabels ? (
                <span>{isSourcePageItem(page) ? page.sourceFileName : 'Generated page'}</span>
              ) : null}
            </span>
          </button>
          <button
            aria-label={`Remove bookmark from page ${page.displayIndex}`}
            className="bookmark-remove-button"
            data-tooltip="Remove bookmark"
            onClick={() => onRemoveBookmark(page.id)}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
