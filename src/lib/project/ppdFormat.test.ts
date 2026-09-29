import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  createWorkspaceFromDocuments,
  insertBlankPage,
  rotatePages,
  updateWorkspaceFormFieldValue,
} from '../pdf/pdfWorkspace';
import { updatePageNote } from '../notes/pageNotes';
import { decodePpd, encodePpd, hydratePpd } from './ppdFormat';
import { createDocumentSaveState, documentContentKey, isDocumentDirty } from './documentSaveState';
import {
  createWorkspaceHistory,
  commitWorkspaceHistory,
  undoWorkspaceHistory,
} from '../pdf/workspaceHistory';
import type { PdfDocumentSource } from '../pdf/types';

async function loadSource(bytes: Uint8Array, fileName: string): Promise<PdfDocumentSource> {
  const pdf = await PDFDocument.load(bytes);
  return {
    bytes,
    id: 'source',
    fileName,
    loadedAt: new Date().toISOString(),
    pageCount: pdf.getPageCount(),
  };
}
async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const source = {
    ...(await loadSource(await pdf.save(), 'original.pdf')),
    filePath: '/private/original.pdf',
    security: { wasEncrypted: true as const },
  };
  const other = { ...source, id: 'second', fileName: 'second.pdf' };
  let workspace = createWorkspaceFromDocuments([source, other]);
  workspace = updatePageNote(workspace, workspace.pages[0].id, {
    version: 1,
    blocks: [
      {
        type: 'bullet',
        runs: [{ text: 'Remember this', bold: true, italic: true, href: 'https://example.com/' }],
      },
    ],
  });
  workspace.bookmarkedPageIds = [workspace.pages[0].id];
  workspace = updateWorkspaceFormFieldValue({
    workspace,
    sourceDocumentId: 'source',
    fieldName: 'Name',
    value: 'Ada',
  });
  workspace.annotations = [
    {
      id: 'annotation',
      pageItemId: workspace.pages[0].id,
      type: 'text-note',
      x: 10,
      y: 20,
      width: 40,
      height: 30,
      content: 'Comment',
      createdAt: 'today',
    },
  ];
  workspace.pages[0].thumbnailDataUrl = 'cached-thumbnail';
  workspace.pages.reverse();
  workspace = insertBlankPage(workspace);
  workspace.formatterSettings.headerText = 'Research';
  return workspace;
}

function mutateArchive(
  bytes: Uint8Array,
  change: (manifest: ReturnType<typeof decodePpd>['manifest']) => void,
) {
  const entries = unzipSync(bytes);
  const manifest = decodePpd(bytes).manifest;
  change(manifest);
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}

describe('PaperDesk portable documents', () => {
  it('round-trips multiple sources and editable content with no original files or caches', async () => {
    const workspace = await fixture();
    const bytes = encodePpd(workspace);
    const { manifest } = decodePpd(bytes);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('/private/');
    expect(serialized).not.toContain('thumbnailDataUrl');
    expect(serialized).not.toContain('wasEncrypted');
    const opened = await hydratePpd(decodePpd(bytes), loadSource);
    expect(opened.documents).toHaveLength(2);
    expect(opened.pages.map((p) => p.kind)).toEqual(workspace.pages.map((p) => p.kind));
    expect(opened.documents.every((d) => !d.filePath)).toBe(true);
    expect(Object.values(opened.pageNotes!)).toEqual(Object.values(workspace.pageNotes!));
    expect(Object.values(opened.formFieldValues)).toEqual(Object.values(workspace.formFieldValues));
    expect(opened.annotations[0].content).toBe('Comment');
    expect(opened.bookmarkedPageIds).toEqual([opened.annotations[0].pageItemId]);
    expect(opened.formatterSettings.headerText).toBe('Research');
    const second = await hydratePpd(decodePpd(bytes), loadSource);
    expect(second.id).not.toBe(opened.id);
    expect(second.documents[0].id).not.toBe(opened.documents[0].id);
    expect(second.pages[0].id).not.toBe(opened.pages[0].id);
    expect(second.annotations[0].id).not.toBe(opened.annotations[0].id);
  });

  it('rejects damaged files, unsupported versions and invalid references', async () => {
    const bytes = encodePpd(await fixture());
    expect(() => decodePpd(bytes.subarray(0, 30))).toThrow(/invalid/);
    expect(() =>
      decodePpd(
        mutateArchive(bytes, (m) => {
          Object.assign(m, { version: 99 });
        }),
      ),
    ).toThrow(/unsupported/);
    expect(() =>
      decodePpd(
        mutateArchive(bytes, (m) => {
          m.workspace.annotations[0].pageItemId = 'missing';
        }),
      ),
    ).toThrow();
    expect(() =>
      decodePpd(
        mutateArchive(bytes, (m) => {
          m.workspace.pages[1].id = m.workspace.pages[0].id;
        }),
      ),
    ).toThrow();
    expect(() =>
      decodePpd(
        mutateArchive(bytes, (m) => {
          m.workspace.documents[0].entry = 'sources/999.pdf';
        }),
      ),
    ).toThrow();
    await expect(
      hydratePpd(
        decodePpd(
          mutateArchive(bytes, (m) => {
            m.workspace.documents[0].pageCount = 2;
          }),
        ),
        loadSource,
      ),
    ).rejects.toThrow();
  });

  it('rejects archive paths and oversized entries before inflation', async () => {
    const entries = unzipSync(encodePpd(await fixture()));
    entries['../outside.pdf'] = new Uint8Array([1]);
    expect(() => decodePpd(zipSync(entries))).toThrow();
    delete entries['../outside.pdf'];
    const bytes = zipSync(entries, { level: 0 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 600 * 1024 * 1024, true);
        break;
      }
    }
    expect(() => decodePpd(bytes)).toThrow();
  });

  it('sanitizes note links and rejects executable image URLs', async () => {
    const bytes = encodePpd(await fixture());
    const decoded = decodePpd(
      mutateArchive(bytes, (m) => {
        Object.values(m.workspace.pageNotes)[0].blocks[0].runs[0].href = 'javascript:alert(1)';
      }),
    );
    expect(
      Object.values(decoded.manifest.workspace.pageNotes)[0].blocks[0].runs[0].href,
    ).toBeUndefined();
    expect(() =>
      decodePpd(
        mutateArchive(bytes, (m) => {
          m.workspace.annotations[0].imageDataUrl = 'https://remote.example/track';
        }),
      ),
    ).toThrow();
  });

  it('tracks note edits and undo against the saved content, ignoring navigation and caches', async () => {
    const workspace = await fixture();
    const state = createDocumentSaveState(workspace, '/tmp/notes.ppd');
    const navigation = {
      ...workspace,
      activePageId: workspace.pages[1].id,
      selectedPageIds: [],
      formatterSettings: { ...workspace.formatterSettings, zoom: 2 },
    };
    expect(isDocumentDirty(navigation, state)).toBe(false);
    const changed = updatePageNote(workspace, workspace.pages[0].id, {
      version: 1,
      blocks: [{ type: 'paragraph', runs: [{ text: 'New note' }] }],
    });
    expect(isDocumentDirty(changed, state)).toBe(true);
    const history = commitWorkspaceHistory(
      createWorkspaceHistory(workspace),
      rotatePages(workspace, [workspace.pages[0].id], 'clockwise'),
    );
    expect(isDocumentDirty(history.present, state)).toBe(true);
    expect(isDocumentDirty(undoWorkspaceHistory(history).present, state)).toBe(false);
    expect(documentContentKey(workspace)).toBe(state.savedContent);
  });
});
