import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultFormSettings,
  createDefaultFormatterSettings,
} from '../../lib/pdf/pdfWorkspace';
import type { PdfWorkspace } from '../../lib/pdf/types';
import { PageOverview } from './PageOverview';

const { renderPdfThumbnailToDataUrl } = vi.hoisted(() => ({
  renderPdfThumbnailToDataUrl: vi.fn(),
}));

vi.mock('../../lib/pdf/pdfRenderer', () => ({
  renderPdfThumbnailToDataUrl,
}));

function createGeneratedWorkspace(): PdfWorkspace {
  const pages = Array.from({ length: 7 }, (_, pageIndex) => ({
    deleted: false,
    displayIndex: pageIndex + 1,
    generatedPageType: 'blank' as const,
    id: `page-${pageIndex + 1}`,
    kind: 'generated' as const,
    rotation: 0 as const,
  }));

  return {
    activePageId: 'page-7',
    annotations: [],
    bookmarkedPageIds: ['page-2'],
    documents: [],
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    formatterSettings: createDefaultFormatterSettings(),
    id: 'workspace-overview',
    name: 'Lecture notes.pdf',
    pages,
    selectedPageIds: ['page-7'],
  };
}

function createSourceWorkspace(): PdfWorkspace {
  return {
    activePageId: 'source-page-1',
    annotations: [],
    bookmarkedPageIds: [],
    documents: [
      {
        bytes: new Uint8Array([1]),
        fileName: 'source.pdf',
        id: 'source-document',
        loadedAt: '2026-08-17T00:00:00.000Z',
        pageCount: 1,
      },
    ],
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    formatterSettings: createDefaultFormatterSettings(),
    id: 'workspace-source-overview',
    name: 'source.pdf',
    pages: [
      {
        deleted: false,
        displayIndex: 1,
        id: 'source-page-1',
        rotation: 0,
        sourceDocumentId: 'source-document',
        sourceFileName: 'source.pdf',
        sourcePageIndex: 0,
      },
    ],
    selectedPageIds: ['source-page-1'],
  };
}

describe('PageOverview', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderPdfThumbnailToDataUrl.mockReset();
    renderPdfThumbnailToDataUrl.mockResolvedValue({
      dataUrl: 'data:image/png;base64,overview',
      height: 160,
      width: 110,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a four-column page grid with current and bookmarked page indicators', () => {
    const onActivatePage = vi.fn();
    const onClose = vi.fn();
    const onTogglePageBookmark = vi.fn();

    render(
      <PageOverview
        onActivatePage={onActivatePage}
        onClose={onClose}
        onThumbnailRendered={vi.fn()}
        onTogglePageBookmark={onTogglePageBookmark}
        workspace={createGeneratedWorkspace()}
      />,
    );

    const grid = screen.getByRole('list', { name: 'Lecture notes.pdf pages' });

    expect(grid.getAttribute('data-column-count')).toBe('4');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('7 pages')).not.toBeNull();
    expect(screen.getByText('1 bookmarked')).not.toBeNull();
    expect(screen.getByText('Saved')).not.toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Remove bookmark from page 2' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Open page 7' }).closest('[aria-current="page"]'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark page 1' }));
    expect(onTogglePageBookmark).toHaveBeenCalledWith('page-1');
    expect(onActivatePage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open page 3' }));
    expect(onActivatePage).toHaveBeenCalledWith('page-3');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('filters the overview to bookmarked pages without changing their page numbers', () => {
    render(
      <PageOverview
        onActivatePage={vi.fn()}
        onClose={vi.fn()}
        onThumbnailRendered={vi.fn()}
        onTogglePageBookmark={vi.fn()}
        workspace={createGeneratedWorkspace()}
      />,
    );

    const allPagesButton = screen.getByRole('button', { name: 'All pages' });
    const bookmarkedButton = screen.getByRole('button', { name: 'Bookmarked' });

    expect(allPagesButton.getAttribute('aria-pressed')).toBe('true');
    expect(bookmarkedButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(bookmarkedButton);

    expect(bookmarkedButton.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('list', { name: 'Bookmarked pages in Lecture notes.pdf' }),
    ).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open page 2' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Open page 1' })).toBeNull();

    fireEvent.click(allPagesButton);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('offers a path back to all pages when there are no bookmarks', () => {
    const workspace = createGeneratedWorkspace();
    workspace.bookmarkedPageIds = [];

    render(
      <PageOverview
        onActivatePage={vi.fn()}
        onClose={vi.fn()}
        onThumbnailRendered={vi.fn()}
        onTogglePageBookmark={vi.fn()}
        workspace={workspace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bookmarked' }));

    expect(screen.getByRole('status').textContent).toContain('No bookmarked pages');
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all pages' }));
    expect(screen.getByRole('list', { name: 'Lecture notes.pdf pages' })).not.toBeNull();
  });

  it('renders source thumbnails on demand and caches the result in the workspace', async () => {
    const onThumbnailRendered = vi.fn();
    renderPdfThumbnailToDataUrl.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,overview',
      height: 180,
      width: 320,
    });

    const { container } = render(
      <PageOverview
        onActivatePage={vi.fn()}
        onClose={vi.fn()}
        onThumbnailRendered={onThumbnailRendered}
        onTogglePageBookmark={vi.fn()}
        workspace={createSourceWorkspace()}
      />,
    );

    await waitFor(() => expect(renderPdfThumbnailToDataUrl).toHaveBeenCalledTimes(1));
    expect(renderPdfThumbnailToDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        page: expect.objectContaining({ id: 'source-page-1' }),
        scale: 0.58,
        sourceDocument: expect.objectContaining({ id: 'source-document' }),
      }),
    );
    await waitFor(() =>
      expect(onThumbnailRendered).toHaveBeenCalledWith(
        'source-page-1',
        'data:image/png;base64,overview',
      ),
    );
    expect(
      Number.parseFloat(
        (container.querySelector('.page-overview-thumbnail-frame') as HTMLElement).style
          .aspectRatio,
      ),
    ).toBeCloseTo(320 / 180);
  });

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn();

    render(
      <PageOverview
        onActivatePage={vi.fn()}
        onClose={onClose}
        onThumbnailRendered={vi.fn()}
        onTogglePageBookmark={vi.fn()}
        workspace={createGeneratedWorkspace()}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
