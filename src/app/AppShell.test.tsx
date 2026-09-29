import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfDocumentSource, PdfPageId, PdfWorkspace } from '../lib/pdf/types';
import type { PdfLoadOptions } from '../lib/pdf/pdfLoader';
import { createWorkspaceFromDocuments } from '../lib/pdf/pdfWorkspace';
import { updatePageNote } from '../lib/notes/pageNotes';
import { AppShell } from './AppShell';

const {
  exportWorkspaceToPdfBytes,
  savePpd,
  openPpd,
  invoke,
  listen,
  loadPdfDocumentsFromPaths,
  pickPdfPath,
  protectPdfBytes,
  saveWorkspacePdf,
  saveWorkspacePdfBytes,
} = vi.hoisted(() => ({
  exportWorkspaceToPdfBytes: vi.fn(),
  savePpd: vi.fn(),
  openPpd: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  loadPdfDocumentsFromPaths: vi.fn(),
  pickPdfPath: vi.fn(),
  protectPdfBytes: vi.fn(),
  saveWorkspacePdf: vi.fn(),
  saveWorkspacePdfBytes: vi.fn(),
}));

vi.mock('../lib/project/ppdFiles', () => ({ savePpd, openPpd }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen,
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => undefined),
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => undefined),
    onCloseRequested: vi.fn().mockResolvedValue(() => undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../lib/pdf/pdfLoader', () => ({
  getPdfLoadErrorMessage: () => 'Paperdesk could not open the selected PDF.',
  loadPdfDocumentsFromPaths,
  loadPdfFromBytes: vi.fn(),
  loadPdfFromPath: vi.fn(),
  openPdfDocuments: vi.fn().mockResolvedValue([]),
  pickPdfPath,
}));

vi.mock('../lib/pdf/pdfExporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pdf/pdfExporter')>()),
  exportWorkspaceToPdfBytes,
  saveWorkspacePdf,
  saveWorkspacePdfBytes,
}));

vi.mock('../lib/pdf/pdfSecurity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pdf/pdfSecurity')>()),
  protectPdfBytes,
}));

vi.mock('../components/pdf/DocumentViewer', () => ({
  DocumentViewer: () => <div data-testid="document-viewer" />,
}));

vi.mock('../components/pdf/PageOverview', () => ({
  PageOverview: ({
    onActivatePage,
    onClose,
    workspace,
  }: {
    onActivatePage: (pageId: PdfPageId) => void;
    onClose: () => void;
    workspace: PdfWorkspace;
  }) => (
    <section aria-label={`Page overview for ${workspace.name}`}>
      <span>{workspace.name}</span>
      <button
        onClick={() => {
          onActivatePage(workspace.pages[0].id);
          onClose();
        }}
        type="button"
      >
        Open first overview page
      </button>
    </section>
  ),
}));

vi.mock('../components/sidebar/ThumbnailSidebar', () => ({
  CollapsedThumbnailSidebar: () => null,
  ThumbnailSidebar: () => null,
}));

vi.mock('../components/layout/ToolsPanel', () => ({
  ToolsPanel: () => null,
}));

vi.mock('../components/toolbar/ViewerToolbar', () => ({
  ViewerToolbar: ({
    isActivePageBookmarked,
    isPageOverviewOpen,
    isPageNotesOpen,
    onToggleActivePageBookmark,
    onTogglePageOverview,
    onTogglePageNotes,
  }: {
    isActivePageBookmarked: boolean;
    isPageOverviewOpen: boolean;
    isPageNotesOpen: boolean;
    onToggleActivePageBookmark: () => void;
    onTogglePageOverview: () => void;
    onTogglePageNotes: () => void;
  }) => (
    <div>
      <button
        aria-label={
          isActivePageBookmarked ? 'Remove current page bookmark' : 'Bookmark current page'
        }
        aria-pressed={isActivePageBookmarked}
        onClick={onToggleActivePageBookmark}
        type="button"
      >
        Bookmark
      </button>
      <button
        aria-label={isPageOverviewOpen ? 'Close current PDF overview' : 'Open current PDF overview'}
        aria-pressed={isPageOverviewOpen}
        onClick={onTogglePageOverview}
        type="button"
      >
        Overview
      </button>
      <button
        aria-label={isPageNotesOpen ? 'Close current page notes' : 'Open current page notes'}
        aria-pressed={isPageNotesOpen}
        onClick={onTogglePageNotes}
        type="button"
      >
        Notes
      </button>
    </div>
  ),
}));

function createDocument(id: string, fileName: string, filePath: string): PdfDocumentSource {
  return {
    bytes: new Uint8Array([1]),
    fileName,
    filePath,
    formFields: [],
    id,
    loadedAt: '2026-08-16T00:00:00.000Z',
    pageCount: 1,
  };
}

describe('AppShell PDF opening', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'paperdesk.storageSettings.v1',
      JSON.stringify({
        autosaveWorkspace: false,
        rememberRecentFiles: false,
        spacebarFreehandAnnotation: true,
      }),
    );

    savePpd.mockReset().mockResolvedValue('/tmp/notes.ppd');
    openPpd.mockReset();
    pickPdfPath.mockReset();
    invoke.mockReset();
    invoke.mockResolvedValue([]);
    listen.mockReset();
    listen.mockResolvedValue(() => undefined);
    loadPdfDocumentsFromPaths.mockReset();
    saveWorkspacePdf.mockReset();
    saveWorkspacePdf.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filePath: '/tmp/exported.pdf',
      pageCount: 1,
    });
    exportWorkspaceToPdfBytes.mockReset();
    exportWorkspaceToPdfBytes.mockResolvedValue(new Uint8Array([2]));
    protectPdfBytes.mockReset();
    protectPdfBytes.mockResolvedValue(new Uint8Array([3]));
    saveWorkspacePdfBytes.mockReset();
    saveWorkspacePdfBytes.mockResolvedValue({
      bytes: new Uint8Array([3]),
      filePath: '/tmp/protected.pdf',
      pageCount: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('prompts for a destination when another PDF is opened from the workspace tabs', async () => {
    const firstDocument = createDocument('pdf-first', 'first.pdf', '/tmp/first.pdf');
    const secondDocument = createDocument('pdf-second', 'second.pdf', '/tmp/second.pdf');

    pickPdfPath
      .mockResolvedValueOnce(firstDocument.filePath)
      .mockResolvedValueOnce(secondDocument.filePath);
    loadPdfDocumentsFromPaths
      .mockResolvedValueOnce([firstDocument])
      .mockResolvedValueOnce([secondDocument]);

    render(<AppShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByRole('tab', { name: /first\.pdf/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));

    const prompt = await screen.findByRole('dialog', { name: 'Open PDF?' });

    expect(loadPdfDocumentsFromPaths).toHaveBeenCalledTimes(1);
    expect(prompt.textContent).toContain('second.pdf');
    expect(screen.getByRole('button', { name: /Current workspace/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New workspace' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Current workspace/ }));

    await waitFor(() => expect(loadPdfDocumentsFromPaths).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('tab', { name: /2 pages \/ 2 PDFs/ })).not.toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('drains PDFs opened by the system after the OS listener is ready', async () => {
    const firstDocument = createDocument('pdf-first', 'first.pdf', '/tmp/first.pdf');
    const secondDocument = createDocument('pdf-second', 'second.pdf', '/tmp/second.pdf');
    const pendingSystemPaths: string[] = [];
    const listenerRegistrations: Array<() => void> = [];

    invoke.mockImplementation(async (command: string) => {
      if (command !== 'drain_pending_open_paths') {
        return [];
      }

      return pendingSystemPaths.splice(0, pendingSystemPaths.length);
    });
    listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          listenerRegistrations.push(() => resolve(() => undefined));
        }),
    );
    pickPdfPath.mockResolvedValueOnce(firstDocument.filePath);
    loadPdfDocumentsFromPaths
      .mockResolvedValueOnce([firstDocument])
      .mockResolvedValueOnce([secondDocument]);

    render(<AppShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByRole('tab', { name: /first\.pdf/ });
    await waitFor(() => expect(listenerRegistrations.length).toBeGreaterThan(0));

    pendingSystemPaths.push('/tmp/second.pdf');
    await act(async () => {
      listenerRegistrations.at(-1)?.();
      await Promise.resolve();
    });

    const prompt = await screen.findByRole('dialog', { name: 'Open PDF from system?' });

    expect(prompt.textContent).toContain('second.pdf');
    expect(loadPdfDocumentsFromPaths).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Current workspace/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New workspace' })).not.toBeNull();
  });

  it('prompts for a protected PDF password before opening the workspace', async () => {
    const protectedDocument = {
      ...createDocument('pdf-locked', 'locked.pdf', '/tmp/locked.pdf'),
      security: { wasEncrypted: true as const },
    };

    pickPdfPath.mockResolvedValueOnce(protectedDocument.filePath);
    loadPdfDocumentsFromPaths.mockImplementationOnce(
      async (_paths: string[], options: PdfLoadOptions = {}) => {
        const password = await options.requestPassword?.({
          fileName: protectedDocument.fileName,
          reason: 'required',
        });

        if (password === null || password === undefined) {
          return [];
        }

        options.onPasswordAccepted?.(password);
        return [protectedDocument];
      },
    );

    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));

    const passwordDialog = await screen.findByRole('dialog', {
      name: 'Unlock locked.pdf',
    });
    expect(passwordDialog.textContent).toContain('memory only for this session');

    fireEvent.change(screen.getByLabelText('PDF password'), {
      target: { value: 'correct password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock PDF' }));

    expect(await screen.findByRole('tab', { name: /locked\.pdf/ })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('dialog', { name: 'Export protected PDF?' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Export unlocked/ }));

    await waitFor(() => expect(saveWorkspacePdf).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    fireEvent.click(await screen.findByRole('button', { name: /Keep protected/ }));

    await waitFor(() =>
      expect(protectPdfBytes).toHaveBeenCalledWith(new Uint8Array([2]), 'correct password'),
    );
    expect(saveWorkspacePdfBytes).toHaveBeenCalledTimes(1);
  });

  it('toggles a bookmark for the active page from the viewer toolbar', async () => {
    const document = createDocument('pdf-bookmark', 'bookmark.pdf', '/tmp/bookmark.pdf');
    const secondDocument = createDocument('pdf-second', 'second.pdf', '/tmp/second.pdf');

    pickPdfPath
      .mockResolvedValueOnce(document.filePath)
      .mockResolvedValueOnce(secondDocument.filePath);
    loadPdfDocumentsFromPaths
      .mockResolvedValueOnce([document])
      .mockResolvedValueOnce([secondDocument]);

    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));

    await screen.findByRole('tab', { name: /bookmark\.pdf/ });

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark current page' }));

    expect(
      screen
        .getByRole('button', { name: 'Remove current page bookmark' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Bookmarked page 1.');

    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }));

    await screen.findByRole('tab', { name: /second\.pdf/ });
    expect(
      screen.getByRole('button', { name: 'Bookmark current page' }).getAttribute('aria-pressed'),
    ).toBe('false');

    fireEvent.click(screen.getByRole('tab', { name: /bookmark\.pdf/ }));
    expect(
      screen
        .getByRole('button', { name: 'Remove current page bookmark' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Remove current page bookmark' }));

    expect(
      screen.getByRole('button', { name: 'Bookmark current page' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('keeps the page overview scoped to the active PDF workspace', async () => {
    const firstDocument = createDocument('pdf-first', 'first.pdf', '/tmp/first.pdf');
    const secondDocument = createDocument('pdf-second', 'second.pdf', '/tmp/second.pdf');

    pickPdfPath
      .mockResolvedValueOnce(firstDocument.filePath)
      .mockResolvedValueOnce(secondDocument.filePath);
    loadPdfDocumentsFromPaths
      .mockResolvedValueOnce([firstDocument])
      .mockResolvedValueOnce([secondDocument]);

    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByRole('tab', { name: /first\.pdf/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }));
    await screen.findByRole('tab', { name: /second\.pdf/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open current PDF overview' }));
    expect(screen.getByRole('region', { name: 'Page overview for second.pdf' })).not.toBeNull();
    expect(screen.queryByTestId('document-viewer')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /first\.pdf/ }));

    await waitFor(() => expect(screen.queryByRole('region', { name: /Page overview/ })).toBeNull());
    expect(screen.getByTestId('document-viewer')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open current PDF overview' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open current PDF overview' }));
    expect(screen.getByRole('region', { name: 'Page overview for first.pdf' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open first overview page' }));
    expect(screen.queryByRole('region', { name: /Page overview/ })).toBeNull();
    expect(screen.getByTestId('document-viewer')).not.toBeNull();
  });

  it('adds private notes for the active page and opens the deck export interface', async () => {
    const sourceDocument = createDocument('pdf-notes', 'notes.pdf', '/tmp/notes.pdf');

    pickPdfPath.mockResolvedValueOnce(sourceDocument.filePath);
    loadPdfDocumentsFromPaths.mockResolvedValueOnce([sourceDocument]);

    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByRole('tab', { name: /notes\.pdf/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open current page notes' }));
    const editor = screen.getByRole('textbox', { name: 'Notes for page 1' });

    editor.replaceChildren(document.createTextNode('Remember the customer story.'));
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Close page notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open current page notes' }));

    expect(screen.getByRole('textbox', { name: 'Notes for page 1' }).textContent).toContain(
      'Remember the customer story.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export notes' }));

    expect(screen.getByRole('dialog', { name: 'Export deck notes' })).not.toBeNull();
    expect(screen.getByText('1 of 1 slides have notes')).not.toBeNull();
  });

  it('shows failed opens as an auto-dismissing toast instead of permanent viewer content', async () => {
    vi.useFakeTimers();
    pickPdfPath.mockResolvedValueOnce('/tmp/locked.pdf');
    loadPdfDocumentsFromPaths.mockRejectedValueOnce(new Error('PasswordException: NeedPassword'));

    render(<AppShell />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open document' }));

      for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
      }
    });

    expect(screen.getByRole('status').textContent).toContain(
      'Paperdesk could not open the selected PDF.',
    );
    expect(document.querySelector('.app-toast')?.getAttribute('data-auto-dismiss')).toBe('true');
    expect(screen.queryByText('Could not open PDF')).toBeNull();

    act(() => vi.advanceTimersByTime(4000));

    expect(screen.queryByRole('status')).toBeNull();
  });
  async function openNotesFixture() {
    pickPdfPath.mockResolvedValueOnce('/tmp/notes.pdf');
    loadPdfDocumentsFromPaths.mockResolvedValueOnce([
      createDocument('notes', 'notes.pdf', '/tmp/notes.pdf'),
    ]);
    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByRole('tab', { name: /notes\.pdf/ });
    fireEvent.click(screen.getByRole('button', { name: 'Open current page notes' }));
    return screen.getByRole('textbox', { name: 'Notes for page 1' });
  }

  it('keeps saves as PDF for unused, blank, and cleared notes', async () => {
    const editor = await openNotesFixture();
    for (const text of ['', '   ', '']) {
      editor.textContent = text;
      fireEvent.input(editor);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false),
      );
    }
    expect(saveWorkspacePdf).toHaveBeenCalledTimes(3);
    expect(savePpd).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', { name: 'Save your notes with this document?' }),
    ).toBeNull();
  });

  it('flushes notes on save, offers PPD, then updates that file and supports Save As', async () => {
    const editor = await openNotesFixture();
    editor.textContent = 'Pending input'; // Save must read even an input not yet dispatched.
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    expect(
      await screen.findByRole('dialog', { name: 'Save your notes with this document?' }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save as .ppd/ }));
    await waitFor(() => expect(savePpd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Edited')).toBeNull());
    expect(JSON.stringify(savePpd.mock.calls[0][0].pageNotes)).toContain('Pending input');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePpd).toHaveBeenCalledTimes(2));
    expect(savePpd.mock.calls[1][1]).toBe('/tmp/notes.ppd');
    expect(savePpd.mock.calls[1][2]).toBe(false);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save As' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }));
    await waitFor(() => expect(savePpd).toHaveBeenCalledTimes(3));
    expect(savePpd.mock.calls[2][2]).toBe(true);
  });

  it('keeps note changes unsaved after PDF export, cancellation, or a failed PPD save', async () => {
    const editor = await openNotesFixture();
    editor.textContent = 'Keep me';
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: /Export PDF Notes stay/ }));
    await waitFor(() => expect(saveWorkspacePdf).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false),
    );
    expect(screen.getByText('Edited')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(savePpd).not.toHaveBeenCalled();
    savePpd.mockRejectedValueOnce(new Error('Disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: /Save as .ppd/ }));
    await screen.findByText('Disk full');
    expect(screen.getByText('Edited')).not.toBeNull();
    expect(editor.textContent).toBe('Keep me');
  });

  it('retains edits made while saving and warns when closing note-only changes', async () => {
    const editor = await openNotesFixture();
    editor.textContent = 'First';
    fireEvent.input(editor);
    let finishSave: (path: string) => void = () => undefined;
    savePpd.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishSave = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: /Save as .ppd/ }));
    await waitFor(() => expect(savePpd).toHaveBeenCalledTimes(1));
    editor.textContent = 'Newer';
    fireEvent.input(editor);
    await act(async () => {
      finishSave('/tmp/notes.ppd');
    });
    expect(screen.getByText('Edited')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.pdf' }));
    const dialog = await screen.findByRole('dialog', { name: /Save changes to/ });
    expect(dialog.textContent).toContain('notes.pdf');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.getByRole('tab', { name: /notes\.pdf/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.pdf' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /notes\.pdf/ })).toBeNull());
  });

  it('opens PPD in its own tab and keeps the format after clearing its notes', async () => {
    await openNotesFixture();
    let project = createWorkspaceFromDocuments([createDocument('project', 'project.pdf', '')]);
    project = updatePageNote(project, project.pages[0].id, {
      version: 1,
      blocks: [{ type: 'paragraph', runs: [{ text: 'Project note' }] }],
    });
    pickPdfPath.mockResolvedValueOnce('/tmp/project.ppd');
    openPpd.mockResolvedValueOnce(project);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByRole('tab', { name: /project\.pdf/ });
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    const editor = screen.getByRole('textbox', { name: 'Notes for page 1' });
    editor.textContent = '';
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePpd).toHaveBeenCalledTimes(1));
    expect(savePpd.mock.calls[0][1]).toBe('/tmp/project.ppd');
    expect(savePpd.mock.calls[0][0].pageNotes).toEqual({});
  });
  it('does not suggest PPD for a PDF when only another tab has notes', async () => {
    const editor = await openNotesFixture();
    editor.textContent = 'Notes in the first tab';
    fireEvent.input(editor);
    pickPdfPath.mockResolvedValueOnce('/tmp/second.pdf');
    loadPdfDocumentsFromPaths.mockResolvedValueOnce([
      createDocument('second', 'second.pdf', '/tmp/second.pdf'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }));
    await screen.findByRole('tab', { name: /second\.pdf/ });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveWorkspacePdf).toHaveBeenCalledTimes(1));
    expect(savePpd).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a closing document open after cancelling its save location', async () => {
    const editor = await openNotesFixture();
    editor.textContent = 'Unsaved note';
    fireEvent.input(editor);
    savePpd.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.pdf' }));
    const dialog = await screen.findByRole('dialog', { name: /Save changes to/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: /Save as .ppd/ }));
    await waitFor(() => expect(savePpd).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tab', { name: /notes\.pdf/ })).not.toBeNull();
    expect(screen.getByText('Edited')).not.toBeNull();
  });

  it('preserves the current document if opening a PPD fails', async () => {
    const editor = await openNotesFixture();
    editor.textContent = 'Keep current notes';
    fireEvent.input(editor);
    pickPdfPath.mockResolvedValueOnce('/tmp/broken.ppd');
    openPpd.mockRejectedValueOnce(new Error('Invalid PaperDesk document'));
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
    await screen.findByText('Invalid PaperDesk document');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(editor.textContent).toBe('Keep current notes');
  });
});
