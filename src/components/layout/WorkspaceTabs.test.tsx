import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTabs } from './WorkspaceTabs';

afterEach(cleanup);
function setup() {
  const onMoveTabs = vi.fn();
  render(
    <WorkspaceTabs
      activeWorkspaceId="a"
      isBusy={false}
      onChangeWorkspaceColor={vi.fn()}
      onChangeWorkspaceFont={vi.fn()}
      onCloseWorkspace={vi.fn()}
      onOpenPdf={vi.fn()}
      onRenameWorkspace={vi.fn()}
      onSelectWorkspace={vi.fn()}
      onMoveTabs={onMoveTabs}
      tabs={['a', 'b', 'c'].map((id) => ({
        id,
        color: '#123456',
        documentCount: 1,
        fontFamily: 'Arial',
        isEdited: false,
        name: id,
        pageCount: 1,
      }))}
    />,
  );
  return { onMoveTabs };
}
function drag(tab: HTMLElement) {
  tab.setPointerCapture = vi.fn();
  fireEvent.pointerDown(tab, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(tab, { pointerId: 1, clientX: 150, clientY: 100 });
}

describe('tab dragging and selection', () => {
  it('moves the Ctrl-selected group outside the window', () => {
    const { onMoveTabs } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /^b / }), { ctrlKey: true });
    const tab = screen.getByRole('tab', { name: /^a / });
    drag(tab);
    fireEvent.pointerUp(tab, { pointerId: 1, clientX: -20, clientY: 100 });
    expect(onMoveTabs).toHaveBeenCalledWith(['a', 'b'], false, { x: -20, y: 100 });
  });

  it('supports a Shift-selected range via the new window action', () => {
    const { onMoveTabs } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /^a / }));
    fireEvent.click(screen.getByRole('tab', { name: /^c / }), { shiftKey: true });
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^b / }));
    fireEvent.click(screen.getByRole('button', { name: 'Move 3 tabs to new window' }));
    expect(onMoveTabs).toHaveBeenCalledWith(['a', 'b', 'c'], true);
  });

  it('does not detach when released inside the window or cancelled with Escape', () => {
    const { onMoveTabs } = setup();
    const tab = screen.getByRole('tab', { name: /^a / });
    drag(tab);
    fireEvent.pointerUp(tab, { pointerId: 1, clientX: 200, clientY: 100 });
    drag(tab);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(tab, { pointerId: 1, clientX: -20, clientY: 100 });
    expect(onMoveTabs).not.toHaveBeenCalled();
  });
});
