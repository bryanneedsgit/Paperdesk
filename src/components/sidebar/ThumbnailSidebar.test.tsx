import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkspace, insertBlankPage } from '../../lib/pdf/pdfWorkspace';
import { ThumbnailSidebar } from './ThumbnailSidebar';

describe('ThumbnailSidebar bookmarks view', () => {
  afterEach(cleanup);

  it('opens bookmarked pages and removes bookmarks from the sidebar', () => {
    const workspaceWithPage = insertBlankPage(createEmptyWorkspace());
    const pageId = workspaceWithPage.activePageId!;
    const workspace = {
      ...workspaceWithPage,
      bookmarkedPageIds: [pageId],
    };
    const onActivatePage = vi.fn();
    const onTogglePageBookmark = vi.fn();

    render(
      <ThumbnailSidebar
        onActivatePage={onActivatePage}
        onClearSelection={vi.fn()}
        onDeletePages={vi.fn()}
        onMovePage={vi.fn()}
        onReorderPages={vi.fn()}
        onRotatePages={vi.fn()}
        onSelectAllPages={vi.fn()}
        onSelectPage={vi.fn()}
        onSetSelectedPages={vi.fn()}
        onThumbnailRendered={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onTogglePageBookmark={onTogglePageBookmark}
        onTogglePageSelection={vi.fn()}
        selectedPageIds={workspace.selectedPageIds}
        workspace={workspace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Bookmarks 1/ }));

    expect(screen.getByRole('heading', { name: 'Bookmarks' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(onActivatePage).toHaveBeenCalledWith(pageId);

    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark from page 1' }));
    expect(onTogglePageBookmark).toHaveBeenCalledWith(pageId);
  });
});
