import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkspace, insertBlankPage } from '../../lib/pdf/pdfWorkspace';
import { ViewerToolbar } from './ViewerToolbar';

type ViewerToolbarProps = ComponentProps<typeof ViewerToolbar>;

function createProps(overrides: Partial<ViewerToolbarProps> = {}): ViewerToolbarProps {
  return {
    activePageNumber: 1,
    canGoNext: false,
    canGoPrevious: false,
    canRotateSelection: true,
    findActiveIndex: 0,
    findQuery: '',
    findResultCount: 0,
    findStatus: 'Find text',
    hasSignatureImage: false,
    isActivePageBookmarked: false,
    isAnnotating: false,
    isFindOpen: false,
    isHandToolActive: false,
    isPageOverviewOpen: false,
    onChangeFindQuery: vi.fn(),
    onCloseFind: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onGoNext: vi.fn(),
    onGoPrevious: vi.fn(),
    onPageNumberChange: vi.fn(),
    onRotateLeft: vi.fn(),
    onRotateRight: vi.fn(),
    onSelectAnnotationTool: vi.fn(),
    onToggleActivePageBookmark: vi.fn(),
    onToggleAnnotating: vi.fn(),
    onToggleHandTool: vi.fn(),
    onTogglePageOverview: vi.fn(),
    pageCount: 1,
    selectedAnnotationTool: 'select',
    workspace: insertBlankPage(createEmptyWorkspace()),
    ...overrides,
  };
}

describe('ViewerToolbar bookmarks', () => {
  afterEach(cleanup);

  it('toggles the active page bookmark with an accessible pressed state', () => {
    const onToggleActivePageBookmark = vi.fn();
    const props = createProps({ onToggleActivePageBookmark });
    const { rerender } = render(<ViewerToolbar {...props} />);

    const addButton = screen.getByRole('button', { name: 'Bookmark page 1' });

    expect(addButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(addButton);
    expect(onToggleActivePageBookmark).toHaveBeenCalledTimes(1);

    rerender(<ViewerToolbar {...props} isActivePageBookmarked />);

    expect(
      screen
        .getByRole('button', { name: 'Remove bookmark from page 1' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('opens and closes the active PDF page overview', () => {
    const onTogglePageOverview = vi.fn();
    const props = createProps({ onTogglePageOverview });
    const { rerender } = render(<ViewerToolbar {...props} />);

    const openButton = screen.getByRole('button', { name: 'Open page overview' });

    expect(openButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(openButton);
    expect(onTogglePageOverview).toHaveBeenCalledTimes(1);

    rerender(<ViewerToolbar {...props} isPageOverviewOpen />);

    expect(
      screen.getByRole('button', { name: 'Close page overview' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
