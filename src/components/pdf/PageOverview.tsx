import { Bookmark, LayoutGrid, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { renderPdfThumbnailToDataUrl } from '../../lib/pdf/pdfRenderer';
import { isGeneratedPageItem, isSourcePageItem } from '../../lib/pdf/pdfWorkspace';
import type { PdfDocumentSource, PdfPageId, PdfPageItem, PdfWorkspace } from '../../lib/pdf/types';

const overviewThumbnailScale = 0.58;
const overviewThumbnailCache = new WeakMap<PdfDocumentSource, Map<string, string>>();

function getOverviewThumbnailCacheKey(page: PdfPageItem): string {
  return `${page.id}:${page.rotation}`;
}

function getCachedOverviewThumbnail(
  page: PdfPageItem,
  sourceDocument?: PdfDocumentSource,
): string | undefined {
  return sourceDocument
    ? overviewThumbnailCache.get(sourceDocument)?.get(getOverviewThumbnailCacheKey(page))
    : undefined;
}

function cacheOverviewThumbnail(
  page: PdfPageItem,
  sourceDocument: PdfDocumentSource,
  thumbnailDataUrl: string,
): void {
  const documentCache = overviewThumbnailCache.get(sourceDocument) ?? new Map<string, string>();

  documentCache.set(getOverviewThumbnailCacheKey(page), thumbnailDataUrl);
  overviewThumbnailCache.set(sourceDocument, documentCache);
}

function getKnownPageAspectRatio(page: PdfPageItem): number | null {
  if (!page.width || !page.height) {
    return null;
  }

  return page.rotation === 90 || page.rotation === 270
    ? page.height / page.width
    : page.width / page.height;
}

type PageOverviewProps = {
  onActivatePage: (pageId: PdfPageId) => void;
  onClose: () => void;
  onThumbnailRendered: (pageId: PdfPageId, thumbnailDataUrl: string) => void;
  onTogglePageBookmark: (pageId: PdfPageId) => void;
  workspace: PdfWorkspace;
};

type OverviewPageThumbnailProps = {
  onThumbnailRendered: (pageId: PdfPageId, thumbnailDataUrl: string) => void;
  page: PdfPageItem;
  sourceDocument?: PdfDocumentSource;
};

const OverviewPageThumbnail = memo(function OverviewPageThumbnail({
  onThumbnailRendered,
  page,
  sourceDocument,
}: OverviewPageThumbnailProps) {
  const isGeneratedPage = isGeneratedPageItem(page);
  const cachedOverviewThumbnail = getCachedOverviewThumbnail(page, sourceDocument);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState(
    cachedOverviewThumbnail ?? page.thumbnailDataUrl ?? null,
  );
  const [hasOverviewThumbnail, setHasOverviewThumbnail] = useState(
    Boolean(cachedOverviewThumbnail),
  );
  const [isVisible, setIsVisible] = useState(Boolean(cachedOverviewThumbnail) || isGeneratedPage);
  const [renderFailed, setRenderFailed] = useState(false);
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(getKnownPageAspectRatio(page));
  const thumbnailRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const nextCachedOverviewThumbnail = getCachedOverviewThumbnail(page, sourceDocument);

    setThumbnailDataUrl(nextCachedOverviewThumbnail ?? page.thumbnailDataUrl ?? null);
    setHasOverviewThumbnail(Boolean(nextCachedOverviewThumbnail));
    setIsVisible(Boolean(nextCachedOverviewThumbnail) || isGeneratedPageItem(page));
    setRenderFailed(false);
    setThumbnailAspectRatio((currentAspectRatio) =>
      nextCachedOverviewThumbnail ? currentAspectRatio : getKnownPageAspectRatio(page),
    );
  }, [page, sourceDocument]);

  useEffect(() => {
    if (!hasOverviewThumbnail && page.thumbnailDataUrl) {
      setThumbnailDataUrl(page.thumbnailDataUrl);
    }
  }, [hasOverviewThumbnail, page.thumbnailDataUrl]);

  useEffect(() => {
    const element = thumbnailRef.current;

    if (!element || hasOverviewThumbnail || isGeneratedPage) {
      setIsVisible(true);
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '320px' },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [hasOverviewThumbnail, isGeneratedPage]);

  useEffect(() => {
    let isStale = false;

    if (hasOverviewThumbnail || !isVisible || isGeneratedPage) {
      return undefined;
    }

    if (!sourceDocument) {
      setRenderFailed(true);
      return undefined;
    }

    setRenderFailed(false);

    renderPdfThumbnailToDataUrl({ page, scale: overviewThumbnailScale, sourceDocument })
      .then((result) => {
        if (isStale) {
          return;
        }

        cacheOverviewThumbnail(page, sourceDocument, result.dataUrl);
        setThumbnailDataUrl(result.dataUrl);
        setHasOverviewThumbnail(true);
        setThumbnailAspectRatio(result.width / result.height);
        onThumbnailRendered(page.id, result.dataUrl);
      })
      .catch(() => {
        if (!isStale) {
          setRenderFailed(true);
        }
      });

    return () => {
      isStale = true;
    };
  }, [hasOverviewThumbnail, isGeneratedPage, isVisible, onThumbnailRendered, page, sourceDocument]);

  return (
    <span
      className="page-overview-thumbnail-frame"
      ref={thumbnailRef}
      style={thumbnailAspectRatio ? { aspectRatio: thumbnailAspectRatio } : undefined}
    >
      {thumbnailDataUrl ? (
        <img
          alt=""
          className="page-overview-thumbnail-image"
          onLoad={(event) => {
            const { naturalHeight, naturalWidth } = event.currentTarget;

            if (naturalHeight > 0 && naturalWidth > 0) {
              setThumbnailAspectRatio(naturalWidth / naturalHeight);
            }
          }}
          src={thumbnailDataUrl}
        />
      ) : isGeneratedPageItem(page) ? (
        <span className="page-overview-thumbnail-placeholder generated-thumbnail">
          <span>{page.generatedPageType === 'cover' ? 'Cover' : 'Blank'}</span>
        </span>
      ) : (
        <span
          className="page-overview-thumbnail-placeholder"
          data-error={renderFailed ? 'true' : undefined}
        >
          {renderFailed ? <span>Preview unavailable</span> : null}
        </span>
      )}
    </span>
  );
});

type OverviewPageCardProps = {
  isActive: boolean;
  isBookmarked: boolean;
  onActivatePage: (pageId: PdfPageId) => void;
  onClose: () => void;
  onThumbnailRendered: (pageId: PdfPageId, thumbnailDataUrl: string) => void;
  onTogglePageBookmark: (pageId: PdfPageId) => void;
  page: PdfPageItem;
  pageNumber: number;
  showSourceLabel: boolean;
  sourceDocument?: PdfDocumentSource;
};

const OverviewPageCard = memo(function OverviewPageCard({
  isActive,
  isBookmarked,
  onActivatePage,
  onClose,
  onThumbnailRendered,
  onTogglePageBookmark,
  page,
  pageNumber,
  showSourceLabel,
  sourceDocument,
}: OverviewPageCardProps) {
  const sourceLabel = isSourcePageItem(page) ? page.sourceFileName : 'Generated page';

  const handleOpenPage = () => {
    onActivatePage(page.id);
    onClose();
  };

  return (
    <article
      aria-current={isActive ? 'page' : undefined}
      className="page-overview-card"
      data-active={isActive ? 'true' : undefined}
      role="listitem"
    >
      <div className="page-overview-card-surface">
        <button
          aria-label={`Open page ${pageNumber}`}
          className="page-overview-open-page"
          onClick={handleOpenPage}
          type="button"
        >
          <OverviewPageThumbnail
            onThumbnailRendered={onThumbnailRendered}
            page={page}
            sourceDocument={sourceDocument}
          />
        </button>
        <button
          aria-label={
            isBookmarked ? `Remove bookmark from page ${pageNumber}` : `Bookmark page ${pageNumber}`
          }
          aria-pressed={isBookmarked}
          className="page-overview-bookmark"
          onClick={() => onTogglePageBookmark(page.id)}
          title={isBookmarked ? 'Bookmarked' : `Bookmark page ${pageNumber}`}
          type="button"
        >
          <Bookmark aria-hidden="true" fill={isBookmarked ? 'currentColor' : 'none'} size={14} />
          {isBookmarked ? <span>Saved</span> : null}
        </button>
        {isActive ? <span className="page-overview-current-badge">Current</span> : null}
      </div>
      <div className="page-overview-card-meta">
        <strong>Page {pageNumber}</strong>
        {showSourceLabel ? <span title={sourceLabel}>{sourceLabel}</span> : null}
      </div>
    </article>
  );
});

export function PageOverview({
  onActivatePage,
  onClose,
  onThumbnailRendered,
  onTogglePageBookmark,
  workspace,
}: PageOverviewProps) {
  const overviewRef = useRef<HTMLElement | null>(null);
  const pages = useMemo(() => workspace.pages.filter((page) => !page.deleted), [workspace.pages]);
  const bookmarkedPageIds = useMemo(
    () => new Set(workspace.bookmarkedPageIds),
    [workspace.bookmarkedPageIds],
  );
  const documentsById = useMemo(
    () => new Map(workspace.documents.map((document) => [document.id, document])),
    [workspace.documents],
  );
  const bookmarkedPageCount = pages.reduce(
    (count, page) => count + (bookmarkedPageIds.has(page.id) ? 1 : 0),
    0,
  );
  const showSourceLabels = workspace.documents.length > 1;

  useEffect(() => {
    overviewRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <section
      aria-label={`Page overview for ${workspace.name}`}
      className="page-overview"
      ref={overviewRef}
      tabIndex={-1}
    >
      <header className="page-overview-header">
        <div className="page-overview-heading">
          <span className="page-overview-heading-icon" aria-hidden="true">
            <LayoutGrid size={17} />
          </span>
          <div>
            <h2>Page overview</h2>
            <p>
              <span title={workspace.name}>{workspace.name}</span>
              <span aria-hidden="true"> · </span>
              <span>{pages.length === 1 ? '1 page' : `${pages.length} pages`}</span>
              <span aria-hidden="true"> · </span>
              <span>
                {bookmarkedPageCount === 1 ? '1 bookmarked' : `${bookmarkedPageCount} bookmarked`}
              </span>
            </p>
          </div>
        </div>
        <button
          aria-label="Close page overview"
          className="viewer-icon-button"
          onClick={onClose}
          title="Close page overview"
          type="button"
        >
          <X size={16} />
        </button>
      </header>

      <div className="page-overview-scroll">
        {pages.length ? (
          <div
            aria-label={`${workspace.name} pages`}
            className="page-overview-grid"
            data-column-count="4"
            role="list"
          >
            {pages.map((page, pageIndex) => (
              <OverviewPageCard
                isActive={workspace.activePageId === page.id}
                isBookmarked={bookmarkedPageIds.has(page.id)}
                key={page.id}
                onActivatePage={onActivatePage}
                onClose={onClose}
                onThumbnailRendered={onThumbnailRendered}
                onTogglePageBookmark={onTogglePageBookmark}
                page={page}
                pageNumber={pageIndex + 1}
                showSourceLabel={showSourceLabels}
                sourceDocument={
                  isSourcePageItem(page) ? documentsById.get(page.sourceDocumentId) : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className="page-overview-empty-state">
            <LayoutGrid aria-hidden="true" size={24} />
            <strong>No pages to show</strong>
            <span>Add or restore a page to use the overview.</span>
          </div>
        )}
      </div>
    </section>
  );
}
