import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfDocumentSource } from '../lib/pdf/types';
import type { PdfLoadOptions } from '../lib/pdf/pdfLoader';
import { AppShell } from './AppShell';

const {
  exportWorkspaceToPdfBytes,
  loadPdfDocumentsFromPaths,
  pickPdfPath,
  protectPdfBytes,
  saveWorkspacePdf,
  saveWorkspacePdfBytes,
} = vi.hoisted(() => ({
  exportWorkspaceToPdfBytes: vi.fn(),
  loadPdfDocumentsFromPaths: vi.fn(),
  pickPdfPath: vi.fn(),
  protectPdfBytes: vi.fn(),
  saveWorkspacePdf: vi.fn(),
  saveWorkspacePdfBytes: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
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

vi.mock('../components/sidebar/ThumbnailSidebar', () => ({
  CollapsedThumbnailSidebar: () => null,
  ThumbnailSidebar: () => null,
}));

vi.mock('../components/layout/ToolsPanel', () => ({
  ToolsPanel: () => null,
}));

vi.mock('../components/toolbar/ViewerToolbar', () => ({
  ViewerToolbar: () => null,
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

    pickPdfPath.mockReset();
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

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
    await screen.findByRole('tab', { name: /first\.pdf/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

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

  it('shows failed opens as an auto-dismissing toast instead of permanent viewer content', async () => {
    vi.useFakeTimers();
    pickPdfPath.mockResolvedValueOnce('/tmp/locked.pdf');
    loadPdfDocumentsFromPaths.mockRejectedValueOnce(new Error('PasswordException: NeedPassword'));

    render(<AppShell />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

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
});
