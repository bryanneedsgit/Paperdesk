import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { inflateSync } from 'node:zlib';
import { degrees, PDFDocument } from 'pdf-lib';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(),
}));

import {
  createDefaultFormSettings,
  createDefaultFormatterSettings,
  deletePages,
  movePage,
  rotatePages,
} from './pdfWorkspace';
import type { PdfDocumentSource, PdfPageItem, PdfWorkspace } from './types';
import {
  clearPdfExportCache,
  exportWorkspaceToPdf,
  parsePageRanges,
  saveWorkspacePdf,
} from './pdfExporter';

type SourcePageSpec = {
  height: number;
  rotation?: number;
  width: number;
};

type TestSourceDocument = PdfDocumentSource & {
  pageSpecs: SourcePageSpec[];
};

function createPageItem(
  sourceDocument: PdfDocumentSource,
  sourcePageIndex: number,
  displayIndex: number,
): PdfPageItem {
  return {
    id: `${sourceDocument.id}-page-${sourcePageIndex}`,
    sourceDocumentId: sourceDocument.id,
    sourceFileName: sourceDocument.fileName,
    sourcePageIndex,
    displayIndex,
    rotation: 0,
    deleted: false,
  };
}

async function createSourceDocument({
  fileName,
  id,
  pageSpecs,
}: {
  fileName: string;
  id: string;
  pageSpecs: SourcePageSpec[];
}): Promise<TestSourceDocument> {
  const pdfDocument = await PDFDocument.create({ updateMetadata: false });

  for (const pageSpec of pageSpecs) {
    const page = pdfDocument.addPage([pageSpec.width, pageSpec.height]);

    if (pageSpec.rotation) {
      page.setRotation(degrees(pageSpec.rotation));
    }
  }

  return {
    id,
    fileName,
    bytes: await pdfDocument.save(),
    loadedAt: `2026-06-21T18:00:00.000Z-${id}`,
    pageCount: pageSpecs.length,
    pageSpecs,
  };
}

function createWorkspace(documents: PdfDocumentSource[]): PdfWorkspace {
  const pages = documents.flatMap((document) =>
    Array.from({ length: document.pageCount }, (_, pageIndex) =>
      createPageItem(document, pageIndex, 0),
    ),
  );

  return {
    id: 'workspace-export-test',
    name: documents.length === 1 ? documents[0].fileName : 'Merged document',
    documents,
    pages: pages.map((page, pageIndex) => ({
      ...page,
      displayIndex: pageIndex + 1,
    })),
    selectedPageIds: pages[0] ? [pages[0].id] : [],
    activePageId: pages[0]?.id,
    formatterSettings: createDefaultFormatterSettings(),
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    annotations: [],
  };
}

async function loadExportedDocument(workspace: PdfWorkspace): Promise<PDFDocument> {
  return PDFDocument.load(await exportWorkspaceToPdf(workspace));
}

function decodePdfStreams(bytes: Uint8Array): string {
  const pdfContent = Buffer.from(bytes).toString('latin1');
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const decodedStreams: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(pdfContent))) {
    try {
      decodedStreams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch {
      decodedStreams.push(match[1]);
    }
  }

  return decodedStreams.join('\n');
}

function expectPdfDrawnText(bytes: Uint8Array, text: string): void {
  const hexText = Buffer.from(text, 'latin1').toString('hex').toUpperCase();

  expect(decodePdfStreams(bytes)).toContain(`<${hexText}> Tj`);
}

function countPdfDrawnText(bytes: Uint8Array, text: string): number {
  const hexText = Buffer.from(text, 'latin1').toString('hex').toUpperCase();
  const matches = decodePdfStreams(bytes).match(new RegExp(`<${hexText}> Tj`, 'g'));

  return matches?.length ?? 0;
}

function pageSizes(document: PDFDocument): Array<[number, number]> {
  return document.getPages().map((page) => {
    const size = page.getSize();
    return [size.width, size.height];
  });
}

function pageRotations(document: PDFDocument): number[] {
  return document.getPages().map((page) => page.getRotation().angle);
}

describe('pdfExporter', () => {
  beforeEach(() => {
    clearPdfExportCache();
    vi.clearAllMocks();
  });

  it('does not overwrite an original source PDF unless the user confirms', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace = createWorkspace([
      {
        ...sourceDocument,
        filePath: '/Users/test/Documents/source-a.pdf',
      },
    ]);

    vi.mocked(save).mockResolvedValue('/Users/test/Documents/source-a.pdf');
    vi.mocked(confirm).mockResolvedValue(false);

    await expect(saveWorkspacePdf(workspace)).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledWith(
      'This will overwrite one of the original source PDFs. Continue?',
      {
        kind: 'warning',
        title: 'Overwrite original PDF?',
      },
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('exports a single PDF without workspace changes', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [
        { width: 210, height: 300 },
        { width: 220, height: 310 },
      ],
    });
    const exportedDocument = await loadExportedDocument(createWorkspace([sourceDocument]));

    expect(exportedDocument.getPageCount()).toBe(2);
    expect(pageSizes(exportedDocument)).toEqual([
      [210, 300],
      [220, 310],
    ]);
    expect(pageRotations(exportedDocument)).toEqual([0, 0]);
  });

  it('exports merged pages from multiple source PDFs in workspace order', async () => {
    const sourceA = await createSourceDocument({
      id: 'source-a',
      fileName: 'alpha.pdf',
      pageSpecs: [
        { width: 110, height: 210 },
        { width: 120, height: 220 },
      ],
    });
    const sourceB = await createSourceDocument({
      id: 'source-b',
      fileName: 'beta.pdf',
      pageSpecs: [{ width: 310, height: 410 }],
    });
    const workspace = createWorkspace([sourceA, sourceB]);
    const pagesById = new Map(workspace.pages.map((page) => [page.id, page]));
    const mergedWorkspace: PdfWorkspace = {
      ...workspace,
      pages: [
        pagesById.get('source-a-page-1'),
        pagesById.get('source-b-page-0'),
        pagesById.get('source-a-page-0'),
      ].map((page, pageIndex) => ({
        ...page!,
        displayIndex: pageIndex + 1,
      })),
    };
    const exportedDocument = await loadExportedDocument(mergedWorkspace);

    expect(exportedDocument.getPageCount()).toBe(3);
    expect(pageSizes(exportedDocument)).toEqual([
      [120, 220],
      [310, 410],
      [110, 210],
    ]);
  });

  it('excludes deleted pages during export', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [
        { width: 110, height: 210 },
        { width: 120, height: 220 },
        { width: 130, height: 230 },
      ],
    });
    const workspace = deletePages(createWorkspace([sourceDocument]), ['source-a-page-1']);
    const exportedDocument = await loadExportedDocument(workspace);

    expect(exportedDocument.getPageCount()).toBe(2);
    expect(pageSizes(exportedDocument)).toEqual([
      [110, 210],
      [130, 230],
    ]);
  });

  it('exports rearranged pages in current workspace order', async () => {
    const sourceA = await createSourceDocument({
      id: 'source-a',
      fileName: 'alpha.pdf',
      pageSpecs: [
        { width: 110, height: 210 },
        { width: 120, height: 220 },
      ],
    });
    const sourceB = await createSourceDocument({
      id: 'source-b',
      fileName: 'beta.pdf',
      pageSpecs: [{ width: 310, height: 410 }],
    });
    const workspace = movePage(
      createWorkspace([sourceA, sourceB]),
      'source-b-page-0',
      'source-a-page-0',
    );
    const exportedDocument = await loadExportedDocument(workspace);

    expect(pageSizes(exportedDocument)).toEqual([
      [310, 410],
      [110, 210],
      [120, 220],
    ]);
  });

  it('applies workspace page rotations during export', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [
        { width: 110, height: 210 },
        { width: 120, height: 220, rotation: 90 },
      ],
    });
    const workspace = rotatePages(
      createWorkspace([sourceDocument]),
      ['source-a-page-0', 'source-a-page-1'],
      'clockwise',
    );
    const exportedDocument = await loadExportedDocument(workspace);

    expect(pageRotations(exportedDocument)).toEqual([90, 180]);
  });

  it('burns page numbers into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [
        { width: 210, height: 300 },
        { width: 210, height: 300 },
      ],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      formatterSettings: {
        ...createDefaultFormatterSettings(),
        pageNumbersEnabled: true,
        pageNumberPosition: 'bottom-right',
        startNumber: 42,
      },
    };
    const exportedBytes = await exportWorkspaceToPdf(workspace);

    expectPdfDrawnText(exportedBytes, '42');
    expectPdfDrawnText(exportedBytes, '43');
  });

  it('burns watermark text into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      formatterSettings: {
        ...createDefaultFormatterSettings(),
        watermarkOpacity: 0.35,
        watermarkText: 'DRAFT WATERMARK',
      },
    };
    const exportedBytes = await exportWorkspaceToPdf(workspace);

    expectPdfDrawnText(exportedBytes, 'DRAFT WATERMARK');
  });

  it('applies formatter output only to selected pages when scoped to selected', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [
        { width: 210, height: 300 },
        { width: 210, height: 300 },
      ],
    });
    const workspace = createWorkspace([sourceDocument]);
    const exportedBytes = await exportWorkspaceToPdf({
      ...workspace,
      selectedPageIds: ['source-a-page-0'],
      formatterSettings: {
        ...createDefaultFormatterSettings(),
        applyScope: 'selected',
        watermarkText: 'SELECTED ONLY',
      },
    });

    expect(countPdfDrawnText(exportedBytes, 'SELECTED ONLY')).toBe(1);
  });

  it('burns text annotations into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'free-text',
          x: 30,
          y: 40,
          width: 120,
          height: 36,
          content: 'Annotation Export',
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    expectPdfDrawnText(await exportWorkspaceToPdf(workspace), 'Annotation Export');
  });

  it('burns custom annotation colors into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'rectangle',
          x: 30,
          y: 40,
          width: 120,
          height: 36,
          color: '#ff0000',
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    expect(decodePdfStreams(await exportWorkspaceToPdf(workspace))).toContain('1 0 0 RG');
  });

  it('burns custom pen thickness into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'pen',
          x: 30,
          y: 40,
          width: 90,
          height: 30,
          color: '#ff0000',
          points: [
            { x: 30, y: 40 },
            { x: 120, y: 70 },
          ],
          strokeWidth: 7,
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    const streams = decodePdfStreams(await exportWorkspaceToPdf(workspace));

    expect(streams).toContain('7 w');
  });

  it('burns a freehand highlighter stroke as a thick translucent line, not a rectangle', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'highlight',
          x: 30,
          y: 40,
          width: 90,
          height: 30,
          color: '#ffe600',
          opacity: 0.5,
          points: [
            { x: 30, y: 40 },
            { x: 120, y: 70 },
          ],
          strokeWidth: 20,
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    const streams = decodePdfStreams(await exportWorkspaceToPdf(workspace));

    expect(streams).toContain('20 w');
    expect(streams).not.toContain(' re');
  });

  it('does not export a click-without-drag highlighter stroke (single point, nothing on screen)', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'highlight',
          x: 30,
          y: 40,
          width: 1,
          height: 1,
          color: '#ffe600',
          opacity: 0.5,
          points: [{ x: 30, y: 40 }],
          strokeWidth: 20,
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    const streams = decodePdfStreams(await exportWorkspaceToPdf(workspace));

    // A single-point stroke renders invisibly on screen (no line segment to
    // draw); it must not fall through to the legacy rect-highlight branch
    // and draw a small rectangle nobody asked for.
    expect(streams).not.toContain('20 w');
    expect(streams).not.toContain(' re');
  });

  it('burns text box fill and border colors separately into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'free-text',
          x: 30,
          y: 40,
          width: 120,
          height: 36,
          content: 'Styled text box',
          color: '#0000ff',
          fillColor: '#00ff00',
          borderColor: '#ff0000',
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    const streams = decodePdfStreams(await exportWorkspaceToPdf(workspace));

    expect(streams).toContain('0 1 0 rg');
    expect(streams).toContain('1 0 0 RG');
    expect(streams).toContain('0 0 1 rg');
  });

  it('burns text edit overlays into exported pages', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [{ width: 210, height: 300 }],
    });
    const workspace: PdfWorkspace = {
      ...createWorkspace([sourceDocument]),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-0',
          type: 'text-edit',
          x: 30,
          y: 40,
          width: 120,
          height: 28,
          content: 'Edited PDF Text',
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    expectPdfDrawnText(await exportWorkspaceToPdf(workspace), 'Edited PDF Text');
  });

  it('keeps annotations tied to page item ids after page rearranging', async () => {
    const sourceDocument = await createSourceDocument({
      id: 'source-a',
      fileName: 'source-a.pdf',
      pageSpecs: [
        { width: 210, height: 300 },
        { width: 210, height: 300 },
      ],
    });
    const workspace: PdfWorkspace = {
      ...movePage(createWorkspace([sourceDocument]), 'source-a-page-1', 'source-a-page-0'),
      annotations: [
        {
          id: 'annotation-1',
          pageItemId: 'source-a-page-1',
          type: 'free-text',
          x: 30,
          y: 40,
          width: 120,
          height: 36,
          content: 'Moved Page Note',
          createdAt: '2026-06-22T10:00:00.000Z',
        },
      ],
    };

    expectPdfDrawnText(await exportWorkspaceToPdf(workspace), 'Moved Page Note');
  });
});

describe('parsePageRanges', () => {
  it('parses a continuous page range', () => {
    expect(parsePageRanges('1-3', 10)).toEqual([
      {
        label: '1-3',
        pageNumbers: [1, 2, 3],
      },
    ]);
  });

  it('parses mixed ranges and individual pages', () => {
    expect(parsePageRanges('1-3,5,8-10', 10)).toEqual([
      {
        label: '1-3',
        pageNumbers: [1, 2, 3],
      },
      {
        label: '5',
        pageNumbers: [5],
      },
      {
        label: '8-10',
        pageNumbers: [8, 9, 10],
      },
    ]);
  });

  it('parses comma-separated individual pages', () => {
    expect(parsePageRanges('1,3,5', 5)).toEqual([
      {
        label: '1',
        pageNumbers: [1],
      },
      {
        label: '3',
        pageNumbers: [3],
      },
      {
        label: '5',
        pageNumbers: [5],
      },
    ]);
  });

  it('validates empty input', () => {
    expect(() => parsePageRanges('   ', 5)).toThrow('Page range input is empty.');
  });

  it('validates malformed range input', () => {
    expect(() => parsePageRanges('1--3', 5)).toThrow('Page range has invalid syntax.');
  });

  it('validates ranges against the visible page count', () => {
    expect(() => parsePageRanges('1-6', 5)).toThrow('Page range exceeds visible page count.');
  });

  it('validates backward ranges', () => {
    expect(() => parsePageRanges('5-3', 5)).toThrow('Page range start is after its end.');
  });
});
