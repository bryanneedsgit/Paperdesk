// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import type { PdfDocumentSource, PdfPageItem, PdfRotation } from './types';

// Use the installed PDF.js implementation; only replace browser worker setup.
vi.mock('./pdfJs', async () => ({
  pdfjsLib: await import('pdfjs-dist/legacy/build/pdf.mjs'),
  ensurePdfJsWorker: async () => {},
}));
import { clearPdfDocumentCache, getPdfPageWebLinks, getPdfPageFormWidgets } from './pdfRenderer';

afterEach(clearPdfDocumentCache);

async function createFixture(): Promise<{ source: PdfDocumentSource; page: PdfPageItem }> {
  const pdf = await PDFDocument.create();
  const pdfPage = pdf.addPage([200, 300]);
  const link = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [20, 30, 100, 50],
      A: { S: 'URI', URI: PDFString.of('https://example.org/paper') },
    }),
  );
  pdfPage.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
  pdf
    .getForm()
    .createTextField('Name')
    .addToPage(pdfPage, { x: 20, y: 100, width: 100, height: 20, borderWidth: 0 });
  const source: PdfDocumentSource = {
    id: crypto.randomUUID(),
    loadedAt: 'test',
    fileName: 'links.pdf',
    pageCount: 1,
    bytes: await pdf.save(),
  };
  return {
    source,
    page: {
      id: 'page',
      sourceDocumentId: source.id,
      sourceFileName: source.fileName,
      sourcePageIndex: 0,
      displayIndex: 1,
      deleted: false,
      rotation: 0,
    },
  };
}

describe('real PDF.js annotation geometry', () => {
  it.each([
    [0, { x: 20, y: 250, width: 80, height: 20 }],
    [90, { x: 30, y: 20, width: 20, height: 80 }],
    [180, { x: 100, y: 30, width: 80, height: 20 }],
    [270, { x: 250, y: 100, width: 20, height: 80 }],
  ] as const)('loads embedded web links at rotation %i', async (rotation, rect) => {
    const { source, page } = await createFixture();
    const links = await getPdfPageWebLinks(source, { ...page, rotation: rotation as PdfRotation });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ url: 'https://example.org/paper', rect });
  });

  it('loads form widgets with the same real viewport API', async () => {
    const { source, page } = await createFixture();
    const widgets = await getPdfPageFormWidgets(source, page);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      fieldName: 'Name',
      rect: { x: 20, y: 180, width: 100, height: 20 },
    });
  });
});
