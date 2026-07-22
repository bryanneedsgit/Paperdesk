import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultFormSettings, createDefaultFormatterSettings } from '../pdf/pdfWorkspace';
import type { PdfDocumentSource, PdfWorkspace } from '../pdf/types';
import {
  clearAutosavedWorkspaceSources,
  createAutosavedWorkspaceSnapshot,
  createWorkspaceFromAutosave,
  readAutosavedWorkspaceSource,
  readWorkspaceStorageSettings,
  writeAutosavedWorkspaceSources,
  writeWorkspaceStorageSettings,
} from './workspaceStorage';

function createDocument(id: string, fileName: string, bytes: number[]): PdfDocumentSource {
  return {
    id,
    fileName,
    filePath: `/tmp/${fileName}`,
    bytes: new Uint8Array(bytes),
    pageCount: bytes.length,
    loadedAt: '2026-06-22T00:00:00.000Z',
  };
}

describe('workspaceStorage', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await clearAutosavedWorkspaceSources();
  });

  it('defaults spacebar freehand annotation on for existing storage settings', () => {
    window.localStorage.setItem(
      'paperdesk.storageSettings.v1',
      JSON.stringify({
        autosaveWorkspace: false,
        rememberRecentFiles: false,
      }),
    );

    expect(readWorkspaceStorageSettings()).toEqual({
      autosaveWorkspace: false,
      rememberRecentFiles: false,
      spacebarFreehandAnnotation: true,
    });
  });

  it('migrates the previous freehand trackpad assist preference', () => {
    window.localStorage.setItem(
      'paperdesk.storageSettings.v1',
      JSON.stringify({
        autosaveWorkspace: true,
        freehandTrackpadAssist: false,
        rememberRecentFiles: true,
      }),
    );

    expect(readWorkspaceStorageSettings().spacebarFreehandAnnotation).toBe(false);
  });

  it('persists spacebar freehand annotation preferences', () => {
    writeWorkspaceStorageSettings({
      autosaveWorkspace: true,
      rememberRecentFiles: true,
      spacebarFreehandAnnotation: false,
    });

    expect(readWorkspaceStorageSettings().spacebarFreehandAnnotation).toBe(false);
  });

  it('stores autosave metadata without original PDF bytes or thumbnails', () => {
    const document = createDocument('doc-1', 'source.pdf', [1, 2]);
    const workspace: PdfWorkspace = {
      id: 'workspace-1',
      name: 'Recovered workspace',
      documents: [document],
      pages: [
        {
          id: 'page-1',
          sourceDocumentId: document.id,
          sourceFileName: document.fileName,
          sourcePageIndex: 0,
          displayIndex: 1,
          rotation: 90,
          deleted: false,
          thumbnailDataUrl: 'data:image/png;base64,thumbnail',
        },
      ],
      selectedPageIds: ['page-1'],
      activePageId: 'page-1',
      formatterSettings: createDefaultFormatterSettings(),
      formFieldValues: {
        [document.id]: { Name: 'Ada' },
      },
      formSettings: createDefaultFormSettings(),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'page-1',
          type: 'text-note',
          x: 10,
          y: 20,
          width: 100,
          height: 40,
          content: 'Local note',
          createdAt: '2026-06-22T00:00:01.000Z',
        },
      ],
    };

    const snapshot = createAutosavedWorkspaceSnapshot(workspace);

    expect('bytes' in snapshot.workspace.documents[0]).toBe(false);
    expect(snapshot.workspace.pages[0].thumbnailDataUrl).toBeUndefined();
    expect(snapshot.workspace.pages[0]).toMatchObject({
      id: 'page-1',
      rotation: 90,
      deleted: false,
    });
    expect(snapshot.workspace.formFieldValues[document.id].Name).toBe('Ada');
    expect(snapshot.workspace.annotations[0]).toMatchObject({
      id: 'annotation-1',
      content: 'Local note',
    });
  });

  it('rehydrates autosave metadata with locally reloaded source documents', () => {
    const originalDocument = createDocument('doc-1', 'source.pdf', [1, 2]);
    const reloadedDocument = {
      ...createDocument('temporary-id', 'source.pdf', [9, 9]),
      id: originalDocument.id,
    };
    const workspace: PdfWorkspace = {
      id: 'workspace-1',
      name: 'Recovered workspace',
      documents: [originalDocument],
      pages: [
        {
          id: 'page-1',
          sourceDocumentId: originalDocument.id,
          sourceFileName: originalDocument.fileName,
          sourcePageIndex: 0,
          displayIndex: 1,
          rotation: 0,
          deleted: false,
        },
      ],
      selectedPageIds: ['page-1'],
      activePageId: 'page-1',
      formatterSettings: createDefaultFormatterSettings(),
      formFieldValues: {},
      formSettings: createDefaultFormSettings(),
      annotations: [],
    };

    const snapshot = createAutosavedWorkspaceSnapshot(workspace);
    const recoveredWorkspace = createWorkspaceFromAutosave(snapshot, [reloadedDocument]);

    expect(recoveredWorkspace.documents[0].bytes).toBe(reloadedDocument.bytes);
    expect(recoveredWorkspace.pages[0]).toMatchObject({
      id: 'page-1',
      sourceDocumentId: originalDocument.id,
    });
  });

  it('stores source PDF bytes separately for seamless recovery', async () => {
    if (!window.indexedDB) {
      expect(window.indexedDB).toBeUndefined();
      return;
    }

    const document = createDocument('doc-1', 'source.pdf', [1, 2, 3]);
    const workspace: PdfWorkspace = {
      id: 'workspace-1',
      name: 'Recovered workspace',
      documents: [document],
      pages: [],
      selectedPageIds: [],
      activePageId: undefined,
      formatterSettings: createDefaultFormatterSettings(),
      formFieldValues: {},
      formSettings: createDefaultFormSettings(),
      annotations: [],
    };

    await writeAutosavedWorkspaceSources(workspace);

    const cachedDocument = await readAutosavedWorkspaceSource(document.id);

    expect(cachedDocument?.fileName).toBe('source.pdf');
    expect(Array.from(new Uint8Array(cachedDocument?.bytes ?? new ArrayBuffer(0)))).toEqual([
      1, 2, 3,
    ]);
  });
});
