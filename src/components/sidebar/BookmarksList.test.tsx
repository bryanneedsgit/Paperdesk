import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultFormSettings,
  createDefaultFormatterSettings,
} from '../../lib/pdf/pdfWorkspace';
import type { PdfWorkspace } from '../../lib/pdf/types';
import { BookmarksList } from './BookmarksList';

function createWorkspace(bookmarkedPageIds: string[]): PdfWorkspace {
  return {
    activePageId: 'page-3',
    annotations: [],
    bookmarkedPageIds,
    documents: [],
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    formatterSettings: createDefaultFormatterSettings(),
    id: 'workspace-bookmarks',
    name: 'Bookmarks',
    pages: [
      {
        deleted: false,
        displayIndex: 1,
        generatedPageType: 'blank',
        id: 'page-1',
        kind: 'generated',
        rotation: 0,
      },
      {
        deleted: true,
        displayIndex: 2,
        generatedPageType: 'blank',
        id: 'page-2',
        kind: 'generated',
        rotation: 0,
      },
      {
        deleted: false,
        displayIndex: 2,
        generatedPageType: 'blank',
        id: 'page-3',
        kind: 'generated',
        rotation: 0,
      },
    ],
    selectedPageIds: ['page-3'],
  };
}

describe('BookmarksList', () => {
  afterEach(cleanup);

  it('explains how to add the first bookmark', () => {
    render(
      <BookmarksList
        onActivatePage={vi.fn()}
        onRemoveBookmark={vi.fn()}
        workspace={createWorkspace([])}
      />,
    );

    expect(screen.getByText('No bookmarked pages')).not.toBeNull();
    expect(screen.getByText(/bookmark button beside the page controls/i)).not.toBeNull();
  });

  it('lists visible bookmarks in page order and supports jump and remove actions', () => {
    const onActivatePage = vi.fn();
    const onRemoveBookmark = vi.fn();

    render(
      <BookmarksList
        onActivatePage={onActivatePage}
        onRemoveBookmark={onRemoveBookmark}
        workspace={createWorkspace(['page-3', 'page-2', 'page-1', 'missing-page'])}
      />,
    );

    const bookmarkButtons = screen.getAllByRole('button', { name: /Page [12]/ });

    expect(bookmarkButtons.map((button) => button.textContent)).toEqual(['Page 1', 'Page 2']);

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(onActivatePage).toHaveBeenCalledWith('page-3');

    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark from page 1' }));
    expect(onRemoveBookmark).toHaveBeenCalledWith('page-1');
  });
});
