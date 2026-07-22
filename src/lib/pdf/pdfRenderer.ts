import { ensurePdfJsWorker, pdfjsLib } from './pdfJs';
import { mapWidgetAnnotationsToFormWidgets, type PdfFormWidget } from './pdfFormWidgets';
import type { PdfDocumentSource, PdfPageItem } from './types';
import {
  createEmbeddedTextBoxes,
  type EmbeddedTextBox,
  type EmbeddedTextItem,
} from './embeddedText';

type PdfViewport = {
  convertToViewportRectangle(rect: number[]): number[];
  height: number;
  rawDims: {
    pageHeight: number;
    pageWidth: number;
    pageX: number;
    pageY: number;
  };
  scale: number;
  transform: number[];
  width: number;
};

// pdf.js AnnotationMode.ENABLE_FORMS: interactive form widgets are excluded
// from the canvas so they can be rendered as live HTML controls instead.
const annotationModeEnableForms = 2;

export type PdfTextLayerItem = EmbeddedTextItem;

type PdfJsRenderTask = {
  promise: Promise<void>;
};

type PdfJsTextStyle = {
  ascent?: number;
  descent?: number;
  fontFamily?: string;
  vertical?: boolean;
};

type PdfJsTextContent = {
  items: unknown[];
  styles: Record<string, PdfJsTextStyle>;
};

type PdfJsPage = {
  commonObjs: {
    has(objId: string): boolean;
    get(objId: string): unknown;
  };
  rotate?: number;
  getAnnotations(): Promise<unknown[]>;
  getViewport(options: { rotation?: number; scale: number }): PdfViewport;
  getTextContent(): Promise<unknown>;
  render(options: {
    annotationMode?: number;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): PdfJsRenderTask;
};

type PdfJsDocument = {
  getPage(pageNumber: number): Promise<PdfJsPage>;
  numPages: number;
};

type PdfDocumentCacheEntry = {
  bytes: Uint8Array;
  loadedAt: string;
  promise: Promise<PdfJsDocument>;
};

export type PdfRenderedPageSize = {
  height: number;
  width: number;
};

export type PdfCanvasRenderOptions = {
  canvas: HTMLCanvasElement;
  interactiveForms?: boolean;
  outputScale?: number;
  page: PdfPageItem;
  scale: number;
  sourceDocument: PdfDocumentSource;
};

export type PdfTextLayerRenderOptions = {
  container: HTMLElement;
  page: PdfPageItem;
  scale: number;
  sourceDocument: PdfDocumentSource;
};

export type PdfTextLayerRenderResult = {
  boxes: EmbeddedTextBox[];
  firstTextStrings: string[];
  itemCount: number;
  workerSrc?: string;
};

export type PdfThumbnailRenderResult = PdfRenderedPageSize & {
  dataUrl: string;
};

const documentCache = new Map<string, PdfDocumentCacheEntry>();

function getDocumentCacheKey(sourceDocument: PdfDocumentSource): string {
  return `${sourceDocument.id}:${sourceDocument.loadedAt}`;
}

function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

function normalizePdfRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function getRenderRotation(pdfPage: PdfJsPage, page: PdfPageItem): number {
  return normalizePdfRotation((pdfPage.rotate ?? 0) + page.rotation);
}

function getSourcePageIndex(page: PdfPageItem): number {
  if (page.kind === 'generated') {
    throw new Error('Generated pages do not have source PDF page indexes.');
  }

  return page.sourcePageIndex;
}

async function getPdfDocument(sourceDocument: PdfDocumentSource): Promise<PdfJsDocument> {
  const cacheKey = getDocumentCacheKey(sourceDocument);
  const cachedDocument = documentCache.get(cacheKey);

  if (
    cachedDocument &&
    cachedDocument.bytes === sourceDocument.bytes &&
    cachedDocument.loadedAt === sourceDocument.loadedAt
  ) {
    return cachedDocument.promise;
  }

  const promise = ensurePdfJsWorker().then(
    () =>
      pdfjsLib.getDocument({ data: sourceDocument.bytes.slice() })
        .promise as unknown as Promise<PdfJsDocument>,
  );

  documentCache.set(cacheKey, {
    bytes: sourceDocument.bytes,
    loadedAt: sourceDocument.loadedAt,
    promise,
  });

  return promise;
}

async function getPdfPage(
  sourceDocument: PdfDocumentSource,
  page: PdfPageItem,
): Promise<PdfJsPage> {
  const pdfDocument = await getPdfDocument(sourceDocument);
  const pageNumber = getSourcePageIndex(page) + 1;

  if (pageNumber < 1 || pageNumber > pdfDocument.numPages) {
    throw new Error(`Page ${pageNumber} is outside the source document page range.`);
  }

  return pdfDocument.getPage(pageNumber);
}

export async function getPdfPageSize(
  sourceDocument: PdfDocumentSource,
  page: PdfPageItem,
): Promise<PdfRenderedPageSize> {
  const pdfPage = await getPdfPage(sourceDocument, page);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: getRenderRotation(pdfPage, page) });

  return {
    height: viewport.height,
    width: viewport.width,
  };
}

export async function renderPdfPageToCanvas({
  canvas,
  interactiveForms = false,
  outputScale = getDevicePixelRatio(),
  page,
  scale,
  sourceDocument,
}: PdfCanvasRenderOptions): Promise<PdfRenderedPageSize> {
  const pdfPage = await getPdfPage(sourceDocument, page);
  const viewport = pdfPage.getViewport({ scale, rotation: getRenderRotation(pdfPage, page) });
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to get 2D canvas context for PDF rendering.');
  }

  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  await pdfPage.render({
    annotationMode: interactiveForms ? annotationModeEnableForms : undefined,
    canvasContext: context,
    viewport,
  }).promise;

  return {
    height: viewport.height,
    width: viewport.width,
  };
}

// Resolves the raw font name (e.g. "ABCDEF+Arial-BoldMT") behind a pdf.js
// loaded font name (e.g. "g_d0_f1"). Fonts only appear in commonObjs after
// the page has rendered at least once, so callers must treat null as "not
// known", not "no font".
export async function getPdfPageFontRawName(
  sourceDocument: PdfDocumentSource,
  page: PdfPageItem,
  loadedFontName: string,
): Promise<string | null> {
  try {
    const pdfPage = await getPdfPage(sourceDocument, page);

    if (!pdfPage.commonObjs.has(loadedFontName)) {
      return null;
    }

    const fontObject = pdfPage.commonObjs.get(loadedFontName);

    if (
      typeof fontObject === 'object' &&
      fontObject !== null &&
      'name' in fontObject &&
      typeof fontObject.name === 'string'
    ) {
      return fontObject.name;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getPdfPageFormWidgets(
  sourceDocument: PdfDocumentSource,
  page: PdfPageItem,
): Promise<PdfFormWidget[]> {
  const pdfPage = await getPdfPage(sourceDocument, page);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: getRenderRotation(pdfPage, page) });
  const annotations = await pdfPage.getAnnotations();

  return mapWidgetAnnotationsToFormWidgets(annotations, (rect) => {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);

    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  });
}

export async function renderPdfPageTextLayer({
  container,
  page,
  scale,
  sourceDocument,
}: PdfTextLayerRenderOptions): Promise<PdfTextLayerRenderResult> {
  const pdfPage = await getPdfPage(sourceDocument, page);
  const viewport = pdfPage.getViewport({ scale, rotation: getRenderRotation(pdfPage, page) });
  const textContent = (await pdfPage.getTextContent()) as PdfJsTextContent;
  const boxes = createEmbeddedTextBoxes({
    items: textContent.items,
    styles: textContent.styles,
    viewport,
  });
  const textFragment = document.createDocumentFragment();
  const spans: Array<{ box: EmbeddedTextBox; span: HTMLSpanElement }> = [];

  container.replaceChildren();
  container.style.height = `${viewport.height}px`;
  container.style.width = `${viewport.width}px`;

  for (const box of boxes) {
    const span = createTextLayerSpan(box);

    spans.push({ box, span });
    textFragment.append(span);
  }

  container.append(textFragment);
  applyTextLayerHorizontalScale(container, spans);

  return {
    boxes,
    firstTextStrings: getFirstTextStrings(textContent.items),
    itemCount: textContent.items.length,
    workerSrc: pdfjsLib.GlobalWorkerOptions.workerSrc,
  };
}

function getFirstTextStrings(items: unknown[]): string[] {
  return items
    .map((item) => {
      if (typeof item !== 'object' || item === null || !('str' in item)) {
        return '';
      }

      return typeof item.str === 'string' ? item.str : '';
    })
    .filter((text) => text.trim().length > 0)
    .slice(0, 5);
}

// Spans are placed like pdf.js's own text layer: anchored at the unrotated
// run origin, rotated via the stylesheet's --rotate hook, and stretched with
// --scale-x so the fallback font's glyph run spans exactly the same width as
// the document glyphs. Selection and word lookup measure these spans, so the
// closer they sit to the real glyphs, the more accurate highlighting is.
function createTextLayerSpan(box: EmbeddedTextBox): HTMLSpanElement {
  const textSpan = document.createElement('span');
  const rect = box.localRect ?? box.rect;

  textSpan.dir = box.dir;
  textSpan.textContent = box.text;
  textSpan.dataset.textBoxId = box.id;
  textSpan.setAttribute('role', 'presentation');
  textSpan.style.left = `${rect.x}px`;
  textSpan.style.top = `${rect.y}px`;
  textSpan.style.fontSize = `${rect.height}px`;
  textSpan.style.lineHeight = '1';

  if (box.angle) {
    textSpan.style.setProperty('--rotate', `${(box.angle * 180) / Math.PI}deg`);
  }

  return textSpan;
}

function applyTextLayerHorizontalScale(
  container: HTMLElement,
  spans: Array<{ box: EmbeddedTextBox; span: HTMLSpanElement }>,
): void {
  const measureContext = document.createElement('canvas').getContext('2d');

  if (!measureContext) {
    return;
  }

  const fontFamily = window.getComputedStyle(container).fontFamily || 'sans-serif';

  for (const { box, span } of spans) {
    const rect = box.localRect ?? box.rect;

    measureContext.font = `${rect.height}px ${fontFamily}`;

    const measuredWidth = measureContext.measureText(box.text).width;

    if (measuredWidth > 0 && rect.width > 0) {
      span.style.setProperty('--scale-x', `${rect.width / measuredWidth}`);
    }
  }
}

export async function renderPdfThumbnailToDataUrl({
  page,
  scale = 0.18,
  sourceDocument,
}: {
  page: PdfPageItem;
  scale?: number;
  sourceDocument: PdfDocumentSource;
}): Promise<PdfThumbnailRenderResult> {
  const canvas = document.createElement('canvas');
  const size = await renderPdfPageToCanvas({
    canvas,
    outputScale: 1,
    page,
    scale,
    sourceDocument,
  });

  return {
    ...size,
    dataUrl: canvas.toDataURL('image/png'),
  };
}

export function clearPdfDocumentCache(): void {
  documentCache.clear();
}
