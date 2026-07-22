import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPdfDocumentCache,
  renderPdfPageTextLayer,
  type PdfTextLayerItem,
} from './pdfRenderer';
import type { PdfDocumentSource, PdfPageItem } from './types';

const pdfJsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  TextLayer: vi.fn(),
}));

vi.mock('./pdfJs', () => ({
  ensurePdfJsWorker: vi.fn(() => Promise.resolve()),
  pdfjsLib: {
    GlobalWorkerOptions: {},
    getDocument: pdfJsMocks.getDocument,
    TextLayer: pdfJsMocks.TextLayer,
  },
}));

const sourceDocument: PdfDocumentSource = {
  id: 'document-renderer',
  fileName: 'renderer.pdf',
  bytes: new Uint8Array([1, 2, 3]),
  loadedAt: '2026-06-28T00:00:00.000Z',
  pageCount: 1,
};

const sourcePage: PdfPageItem = {
  id: 'page-renderer',
  displayIndex: 1,
  rotation: 0,
  deleted: false,
  sourceDocumentId: sourceDocument.id,
  sourceFileName: sourceDocument.fileName,
  sourcePageIndex: 0,
};

function createTextItem(patch: Partial<PdfTextLayerItem> = {}): PdfTextLayerItem {
  return {
    dir: 'ltr',
    fontName: 'font-main',
    height: 10,
    str: 'Hello',
    transform: [10, 0, 0, 10, 20, 80],
    width: 25,
    ...patch,
  };
}

describe('PDF renderer', () => {
  beforeEach(() => {
    clearPdfDocumentCache();
    pdfJsMocks.getDocument.mockReset();
    pdfJsMocks.TextLayer.mockReset();
  });

  it('renders text spans directly from PDF text content without PDF.js TextLayer', async () => {
    const getPage = vi.fn(async () => ({
      rotate: 0,
      getTextContent: vi.fn(async () => ({
        items: [
          createTextItem(),
          createTextItem({ str: ' ', transform: [10, 0, 0, 10, 45, 80], width: 5 }),
          createTextItem({ str: 'World', transform: [10, 0, 0, 10, 60, 80], width: 30 }),
        ],
        styles: {
          'font-main': {
            ascent: 0.8,
            fontFamily: 'Helvetica',
          },
        },
      })),
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        height: 100 * scale,
        rawDims: {
          pageHeight: 100,
          pageWidth: 200,
          pageX: 0,
          pageY: 0,
        },
        scale,
        transform: [scale, 0, 0, -scale, 0, 100 * scale],
        width: 200 * scale,
      })),
    }));

    pdfJsMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage,
        numPages: 1,
      }),
    });

    const container = document.createElement('div');

    const result = await renderPdfPageTextLayer({
      container,
      page: sourcePage,
      scale: 2,
      sourceDocument,
    });

    const spans = Array.from(container.querySelectorAll('span'));

    expect(pdfJsMocks.TextLayer).not.toHaveBeenCalled();
    expect(container.style.height).toBe('200px');
    expect(container.style.width).toBe('400px');
    expect(result.itemCount).toBe(3);
    expect(result.firstTextStrings).toEqual(['Hello', 'World']);
    expect(result.boxes.map((box) => box.text)).toEqual(['Hello', 'World']);
    expect(spans.map((span) => span.textContent)).toEqual(['Hello', 'World']);
    expect(spans[0].dataset.textBoxId).toBe('text-box-0');
    expect(spans[0].style.left).toBe('40px');
    expect(spans[0].style.top).toBe('24px');
    // Spans size naturally from their font so the stylesheet's --scale-x
    // stretch can align the glyph run with the document glyphs.
    expect(spans[0].style.width).toBe('');
    expect(spans[0].style.fontSize).toBe('20px');
    expect(spans[0].style.getPropertyValue('--rotate')).toBe('');
    expect(spans[1].style.left).toBe('120px');
  });
});
