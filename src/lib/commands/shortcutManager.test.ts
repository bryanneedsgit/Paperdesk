import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerWorkspaceShortcuts } from './shortcutManager';

type ShortcutHandlers = Parameters<typeof registerWorkspaceShortcuts>[0];

function createHandlers(overrides: Partial<ShortcutHandlers> = {}): ShortcutHandlers {
  return {
    canCopyAnnotation: () => false,
    canDeletePages: () => false,
    canExportPdf: () => false,
    canNavigatePages: () => false,
    canPasteAnnotation: () => false,
    canRedo: () => false,
    canUndo: () => false,
    copyAnnotation: vi.fn(),
    deleteSelectedPages: vi.fn(),
    exportPdf: vi.fn(),
    navigatePage: vi.fn(),
    openPdf: vi.fn(),
    pasteAnnotation: vi.fn(),
    redo: vi.fn(),
    undo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    ...overrides,
  };
}

describe('registerWorkspaceShortcuts clipboard annotations', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('copies a selected annotation with the primary copy shortcut', () => {
    const copyAnnotation = vi.fn();
    const unregister = registerWorkspaceShortcuts(
      createHandlers({
        canCopyAnnotation: () => true,
        copyAnnotation,
      }),
    );
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'c',
    });

    window.dispatchEvent(event);
    unregister();

    expect(event.defaultPrevented).toBe(true);
    expect(copyAnnotation).toHaveBeenCalledTimes(1);
  });

  it('pastes a copied annotation with the primary paste shortcut', () => {
    const pasteAnnotation = vi.fn();
    const unregister = registerWorkspaceShortcuts(
      createHandlers({
        canPasteAnnotation: () => true,
        pasteAnnotation,
      }),
    );
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      key: 'v',
    });

    window.dispatchEvent(event);
    unregister();

    expect(event.defaultPrevented).toBe(true);
    expect(pasteAnnotation).toHaveBeenCalledTimes(1);
  });

  it('leaves native copy and paste alone inside editable fields', () => {
    const copyAnnotation = vi.fn();
    const pasteAnnotation = vi.fn();
    const input = document.createElement('input');
    const unregister = registerWorkspaceShortcuts(
      createHandlers({
        canCopyAnnotation: () => true,
        canPasteAnnotation: () => true,
        copyAnnotation,
        pasteAnnotation,
      }),
    );

    document.body.append(input);
    input.focus();

    const copyEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'c',
    });
    const pasteEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'v',
    });

    input.dispatchEvent(copyEvent);
    input.dispatchEvent(pasteEvent);
    unregister();

    expect(copyEvent.defaultPrevented).toBe(false);
    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(copyAnnotation).not.toHaveBeenCalled();
    expect(pasteAnnotation).not.toHaveBeenCalled();
  });
});
