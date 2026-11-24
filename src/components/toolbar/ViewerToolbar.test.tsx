import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { findTextMatches } from '../../lib/pdf/pdfTextSearch';
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
    isPageNotesOpen: false,
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
    onTogglePageNotes: vi.fn(),
    pageCount: 1,
    selectedAnnotationTool: 'select',
    workspace: insertBlankPage(createEmptyWorkspace()),
    ...overrides,
  };
}

describe('ViewerToolbar bookmarks', () => {
  afterEach(cleanup);

  it('shows and toggles exact matching in both directions', () => {
    function SearchHarness() {
      const [exact, setExact] = useState(false);
      return (
        <ViewerToolbar
          {...createProps({
            isFindOpen: true,
            findQuery: 'cat',
            findExact: exact,
            onChangeFindExact: setExact,
            findResultCount: findTextMatches('cat category', 'cat', exact).length,
          })}
        />
      );
    }
    render(<SearchHarness />);
    const off = screen.getByRole('button', { name: 'Exact match: Off' });
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('1 of 2')).toBeTruthy();
    fireEvent.click(off);
    const on = screen.getByRole('button', { name: 'Exact match: On' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 of 1')).toBeTruthy();
    fireEvent.click(on);
    expect(
      screen.getByRole('button', { name: 'Exact match: Off' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

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

  it('opens and closes notes for the active page', () => {
    const onTogglePageNotes = vi.fn();
    const props = createProps({ onTogglePageNotes });
    const { rerender } = render(<ViewerToolbar {...props} />);

    const openButton = screen.getByRole('button', { name: 'Show notes for page 1' });

    expect(openButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(openButton);
    expect(onTogglePageNotes).toHaveBeenCalledTimes(1);

    rerender(<ViewerToolbar {...props} isPageNotesOpen />);
    expect(
      screen.getByRole('button', { name: 'Close page notes' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
