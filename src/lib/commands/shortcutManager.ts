type ShortcutHandlers = {
  canDeletePages: () => boolean;
  canCopyAnnotation: () => boolean;
  canExportPdf: () => boolean;
  canNavigatePages: () => boolean;
  canPasteAnnotation: () => boolean;
  canRedo: () => boolean;
  canUndo: () => boolean;
  copyAnnotation: () => void;
  deleteSelectedPages: () => void;
  exportPdf: () => void;
  navigatePage: (direction: -1 | 1) => void;
  openPdf: () => void;
  pasteAnnotation: () => void;
  redo: () => void;
  undo: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
  );
}

function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function preventAndRun(event: KeyboardEvent, command: () => void): void {
  event.preventDefault();
  command();
}

export function registerWorkspaceShortcuts(handlers: ShortcutHandlers): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const primaryModifier = hasPrimaryModifier(event);
    const editableTarget = isEditableTarget(event.target);

    if (primaryModifier && key === 'o') {
      preventAndRun(event, handlers.openPdf);
      return;
    }

    if (primaryModifier && key === 's') {
      preventAndRun(event, () => {
        if (handlers.canExportPdf()) {
          handlers.exportPdf();
        }
      });
      return;
    }

    if (primaryModifier && key === 'c') {
      if (editableTarget) {
        return;
      }

      if (handlers.canCopyAnnotation()) {
        preventAndRun(event, handlers.copyAnnotation);
      }
      return;
    }

    if (primaryModifier && key === 'v') {
      if (editableTarget) {
        return;
      }

      if (handlers.canPasteAnnotation()) {
        preventAndRun(event, handlers.pasteAnnotation);
      }
      return;
    }

    if (primaryModifier && key === 'z' && !event.shiftKey) {
      if (editableTarget) {
        return;
      }

      if (handlers.canUndo()) {
        preventAndRun(event, handlers.undo);
      }
      return;
    }

    if ((primaryModifier && event.shiftKey && key === 'z') || (primaryModifier && key === 'y')) {
      if (editableTarget) {
        return;
      }

      if (handlers.canRedo()) {
        preventAndRun(event, handlers.redo);
      }
      return;
    }

    if ((primaryModifier && key === '+') || (primaryModifier && key === '=')) {
      preventAndRun(event, handlers.zoomIn);
      return;
    }

    if (primaryModifier && key === '-') {
      preventAndRun(event, handlers.zoomOut);
      return;
    }

    if (editableTarget) {
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && handlers.canDeletePages()) {
      preventAndRun(event, handlers.deleteSelectedPages);
      return;
    }

    if (event.key === 'ArrowUp' && handlers.canNavigatePages()) {
      preventAndRun(event, () => handlers.navigatePage(-1));
      return;
    }

    if (event.key === 'ArrowDown' && handlers.canNavigatePages()) {
      preventAndRun(event, () => handlers.navigatePage(1));
    }
  };

  window.addEventListener('keydown', handleKeyDown);

  return () => window.removeEventListener('keydown', handleKeyDown);
}
