import { confirm, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import fontkit from '@pdf-lib/fontkit';
import {
  BlendMode,
  degrees,
  LineCapStyle,
  PDFDocument,
  PDFPage,
  rgb,
  StandardFonts,
  type PDFFont,
} from 'pdf-lib';

import { classifyPdfExportError, logDeveloperError } from '../utils/errors';
import {
  getAnnotationFontOption,
  getBundledFontUrlForVariant,
  getStandardFontForVariant,
} from './annotationFonts';
import { getAnnotationOpacity, getAnnotationStrokeWidth } from './annotationStroke';
import {
  getAnnotationBorderColor,
  getAnnotationFillColor,
  getAnnotationRgbColor,
  getAnnotationRgbPaintColor,
} from './annotationColors';
import { applyPdfFormValues, getFormEditsForDocument, hasFormExportWork } from './pdfForms';
import { getResizeDimensions } from './formatterOptions';
import { isGeneratedPageItem, isSourcePageItem } from './pdfWorkspace';
import type {
  FormatterSettings,
  PdfAnnotation,
  PdfAnnotationPoint,
  PdfDocumentSource,
  PdfPageId,
  PdfPageItem,
  PdfWorkspace,
  SourcePdfPageItem,
} from './types';

const pdfFileFilters = [{ name: 'PDF', extensions: ['pdf'] }];

type PdfDocumentCacheEntry = {
  bytes: Uint8Array;
  document: PDFDocument;
  loadedAt: string;
};

type PdfPageBox = {
  bottom: number;
  height: number;
  left: number;
  width: number;
};

export type PdfPageRange = {
  label: string;
  pageNumbers: number[];
};

export type PdfSaveResult = {
  bytes: Uint8Array;
  filePath: string;
  pageCount: number;
};

export type PdfRangeSaveResult = PdfSaveResult & {
  range: PdfPageRange;
};

export type PdfRangeExportResult = {
  bytes: Uint8Array;
  pageCount: number;
  range: PdfPageRange;
};

export class PdfExportError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly cause?: unknown,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PdfExportError';
  }
}

const sourcePdfDocumentCache = new Map<string, PdfDocumentCacheEntry>();

function getVisiblePages(workspace: PdfWorkspace): PdfPageItem[] {
  return workspace.pages.filter((page) => !page.deleted);
}

function hasFormatterExportWork(workspace: PdfWorkspace): boolean {
  const settings = workspace.formatterSettings;
  const crop = settings.cropMargins;

  return (
    settings.pageNumbersEnabled ||
    Boolean(settings.headerText.trim()) ||
    Boolean(settings.footerText.trim()) ||
    Boolean(settings.watermarkText.trim()) ||
    settings.resizePageSize !== 'keep-original' ||
    crop.top > 0 ||
    crop.right > 0 ||
    crop.bottom > 0 ||
    crop.left > 0
  );
}

function hasAnnotationExportWork(workspace: PdfWorkspace): boolean {
  return workspace.annotations.length > 0;
}

function normalizePdfRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function getSourceDocument(workspace: PdfWorkspace, page: SourcePdfPageItem): PdfDocumentSource {
  const sourceDocument = workspace.documents.find(
    (document) => document.id === page.sourceDocumentId,
  );

  if (!sourceDocument) {
    throw new PdfExportError(
      'Missing source PDF document.',
      'One source file is missing. Relink it before exporting.',
      undefined,
      'Use the recovery dialog or reopen the source PDF before exporting.',
    );
  }

  return sourceDocument;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

type FontVariant = { bold?: boolean; italic?: boolean };

const documentFontCache = new WeakMap<PDFDocument, Map<string, PDFFont>>();

// Standard families map to the built-in PDF fonts; bundled families embed the
// shipped TTF (subset) so exports look identical to the on-screen text.
async function embedWorkspaceFont(
  outputDocument: PDFDocument,
  fontId: string | undefined,
  variant: FontVariant,
): Promise<PDFFont> {
  const option = getAnnotationFontOption(fontId);
  const cacheKey = `${option.id}:${variant.bold ? 'b' : ''}${variant.italic ? 'i' : ''}`;
  let cache = documentFontCache.get(outputDocument);

  if (!cache) {
    cache = new Map();
    documentFontCache.set(outputDocument, cache);
  }

  const cachedFont = cache.get(cacheKey);

  if (cachedFont) {
    return cachedFont;
  }

  let font: PDFFont;
  const standardFont = getStandardFontForVariant(option, variant);

  if (standardFont) {
    font = await outputDocument.embedFont(standardFont);
  } else {
    try {
      const fontUrl = getBundledFontUrlForVariant(option, variant);

      if (!fontUrl) {
        throw new Error(`No bundled font file for ${option.id}.`);
      }

      const response = await fetch(fontUrl);

      if (!response.ok) {
        throw new Error(`Unable to fetch bundled font (status ${response.status}).`);
      }

      outputDocument.registerFontkit(fontkit);
      font = await outputDocument.embedFont(await response.arrayBuffer(), { subset: true });
    } catch (error) {
      logDeveloperError(`Unable to embed bundled font "${option.id}".`, error);
      font = await outputDocument.embedFont(
        variant.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
      );
    }
  }

  cache.set(cacheKey, font);

  return font;
}

function measureTextWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.55;
  }
}

function wrapAnnotationLines(
  content: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const wrappedLines: string[] = [];

  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const words = line.split(/[ \t]+/).filter(Boolean);

    if (words.length === 0) {
      wrappedLines.push('');
      continue;
    }

    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (currentLine && measureTextWidth(font, candidate, size) > maxWidth) {
        wrappedLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }

    wrappedLines.push(currentLine);
  }

  return wrappedLines;
}

function getCropBox(page: PDFPage, settings: FormatterSettings): PdfPageBox {
  const { width, height } = page.getSize();
  const top = clampNumber(settings.cropMargins.top, 0, Math.max(0, height - 1));
  const bottom = clampNumber(settings.cropMargins.bottom, 0, Math.max(0, height - top - 1));
  const left = clampNumber(settings.cropMargins.left, 0, Math.max(0, width - 1));
  const right = clampNumber(settings.cropMargins.right, 0, Math.max(0, width - left - 1));

  return {
    left,
    bottom,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
}

function applyResizeAndCrop(
  pdfPage: PDFPage,
  page: PdfPageItem,
  settings: FormatterSettings,
): PdfPageBox {
  const targetSize = getResizeDimensions(settings, page);

  if (targetSize) {
    const originalSize = pdfPage.getSize();
    const scale = Math.min(
      targetSize.width / originalSize.width,
      targetSize.height / originalSize.height,
    );
    const scaledWidth = originalSize.width * scale;
    const scaledHeight = originalSize.height * scale;

    pdfPage.scaleContent(scale, scale);
    pdfPage.translateContent(
      (targetSize.width - scaledWidth) / 2,
      (targetSize.height - scaledHeight) / 2,
    );
    pdfPage.setSize(targetSize.width, targetSize.height);
  }

  const cropBox = getCropBox(pdfPage, settings);
  pdfPage.setCropBox(cropBox.left, cropBox.bottom, cropBox.width, cropBox.height);

  return cropBox;
}

async function drawGeneratedPageContent(
  outputDocument: PDFDocument,
  pdfPage: PDFPage,
  page: PdfPageItem,
): Promise<void> {
  if (!isGeneratedPageItem(page) || page.generatedPageType !== 'cover') {
    return;
  }

  const titleFont = await outputDocument.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await outputDocument.embedFont(StandardFonts.Helvetica);
  const { width, height } = pdfPage.getSize();
  const title = normalizeText(page.coverTitle || 'Cover Page', 120);
  const subtitle = normalizeText(page.coverSubtitle || '', 160);
  const date = normalizeText(page.coverDate || '', 80);
  const titleSize = 32;
  const subtitleSize = 15;
  const dateSize = 12;

  pdfPage.drawText(title, {
    x: Math.max(48, (width - titleFont.widthOfTextAtSize(title, titleSize)) / 2),
    y: height * 0.62,
    size: titleSize,
    font: titleFont,
    color: rgb(0.12, 0.16, 0.2),
  });

  if (subtitle) {
    pdfPage.drawText(subtitle, {
      x: Math.max(48, (width - bodyFont.widthOfTextAtSize(subtitle, subtitleSize)) / 2),
      y: height * 0.62 - 34,
      size: subtitleSize,
      font: bodyFont,
      color: rgb(0.32, 0.37, 0.43),
    });
  }

  if (date) {
    pdfPage.drawText(date, {
      x: Math.max(48, (width - bodyFont.widthOfTextAtSize(date, dateSize)) / 2),
      y: height * 0.24,
      size: dateSize,
      font: bodyFont,
      color: rgb(0.4, 0.45, 0.52),
    });
  }
}

async function drawFormatterOverlays({
  outputDocument,
  pageNumber,
  pdfPage,
  settings,
  visibleBox,
}: {
  outputDocument: PDFDocument;
  pageNumber?: number;
  pdfPage: PDFPage;
  settings: FormatterSettings;
  visibleBox: PdfPageBox;
}): Promise<void> {
  const font = await embedWorkspaceFont(outputDocument, settings.fontFamily, {});
  const watermarkFont = await embedWorkspaceFont(outputDocument, settings.fontFamily, {
    bold: true,
  });
  const headerText = normalizeText(settings.headerText, 140);
  const footerText = normalizeText(settings.footerText, 140);
  const watermarkText = normalizeText(settings.watermarkText, 80);
  const margin = 28;

  if (headerText) {
    const size = 11;
    pdfPage.drawText(headerText, {
      x: visibleBox.left + (visibleBox.width - font.widthOfTextAtSize(headerText, size)) / 2,
      y: visibleBox.bottom + visibleBox.height - margin,
      size,
      font,
      color: rgb(0.18, 0.22, 0.27),
    });
  }

  if (footerText) {
    const size = 11;
    pdfPage.drawText(footerText, {
      x: visibleBox.left + (visibleBox.width - font.widthOfTextAtSize(footerText, size)) / 2,
      y: visibleBox.bottom + 20,
      size,
      font,
      color: rgb(0.18, 0.22, 0.27),
    });
  }

  if (settings.pageNumbersEnabled && pageNumber !== undefined) {
    const text = String(pageNumber);
    const size = 10;
    const textWidth = font.widthOfTextAtSize(text, size);
    const x =
      settings.pageNumberPosition === 'bottom-left'
        ? visibleBox.left + margin
        : settings.pageNumberPosition === 'bottom-right'
          ? visibleBox.left + visibleBox.width - margin - textWidth
          : visibleBox.left + (visibleBox.width - textWidth) / 2;

    pdfPage.drawText(text, {
      x,
      y: visibleBox.bottom + 20,
      size,
      font,
      color: rgb(0.18, 0.22, 0.27),
    });
  }

  if (watermarkText) {
    const size = Math.max(34, Math.min(64, visibleBox.width / 8));
    const opacity = clampNumber(settings.watermarkOpacity, 0, 1);

    pdfPage.drawText(watermarkText, {
      x: visibleBox.left + visibleBox.width * 0.2,
      y: visibleBox.bottom + visibleBox.height * 0.42,
      size,
      font: watermarkFont,
      color: rgb(0.25, 0.29, 0.34),
      opacity,
      rotate: degrees(35),
    });
  }
}

function getFormatterPageNumbers(
  workspace: PdfWorkspace,
  pages: PdfPageItem[],
): Map<PdfPageId, number> {
  const pageNumbers = new Map<PdfPageId, number>();
  let nextNumber = Math.max(1, Math.floor(workspace.formatterSettings.startNumber));

  for (const page of pages) {
    if (!shouldApplyFormatterToPage(workspace, page)) {
      continue;
    }

    pageNumbers.set(page.id, nextNumber);
    nextNumber += 1;
  }

  return pageNumbers;
}

function shouldApplyFormatterToPage(workspace: PdfWorkspace, page: PdfPageItem): boolean {
  return (
    workspace.formatterSettings.applyScope === 'all' || workspace.selectedPageIds.includes(page.id)
  );
}

function getFullPageBox(pdfPage: PDFPage): PdfPageBox {
  const { width, height } = pdfPage.getSize();

  return {
    bottom: 0,
    height,
    left: 0,
    width,
  };
}

function getNormalizedRotationAngle(pdfPage: PDFPage): number {
  return normalizePdfRotation(pdfPage.getRotation().angle);
}

function mapDisplayPointToPdfPoint(
  point: PdfAnnotationPoint,
  pdfPage: PDFPage,
): PdfAnnotationPoint {
  const { width, height } = pdfPage.getSize();

  switch (getNormalizedRotationAngle(pdfPage)) {
    case 90:
      return {
        x: point.y,
        y: height - point.x,
      };
    case 180:
      return {
        x: width - point.x,
        y: point.y,
      };
    case 270:
      return {
        x: width - point.y,
        y: point.x,
      };
    default:
      return {
        x: point.x,
        y: height - point.y,
      };
  }
}

function mapDisplayRectToPdfBox(annotation: PdfAnnotation, pdfPage: PDFPage): PdfPageBox {
  const corners = [
    { x: annotation.x, y: annotation.y },
    { x: annotation.x + annotation.width, y: annotation.y },
    { x: annotation.x, y: annotation.y + annotation.height },
    { x: annotation.x + annotation.width, y: annotation.y + annotation.height },
  ].map((point) => mapDisplayPointToPdfPoint(point, pdfPage));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const bottom = Math.min(...ys);
  const top = Math.max(...ys);

  return {
    left,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, top - bottom),
  };
}

async function drawAnnotationOverlay({
  annotation,
  outputDocument,
  pdfPage,
}: {
  annotation: PdfAnnotation;
  outputDocument: PDFDocument;
  pdfPage: PDFPage;
}): Promise<void> {
  const annotationRgb = getAnnotationRgbColor(annotation);
  const annotationColor = rgb(annotationRgb.r, annotationRgb.g, annotationRgb.b);

  // A freehand highlighter stroke is recognized by carrying `points` at all
  // (set at creation, even before a drag produces a second point) — never by
  // length, or a click-without-drag stroke that renders as invisible on
  // screen would fall through to the legacy rect branch below and export as
  // a small opaque rectangle in the wrong color/opacity.
  if (annotation.type === 'highlight' && annotation.points) {
    if (annotation.points.length > 1) {
      // Drawn like a pen stroke, just thick, translucent, and blended so
      // overlapping ink darkens like real marker ink instead of stacking to
      // full opacity.
      const opacity = getAnnotationOpacity(annotation);
      const thickness = getAnnotationStrokeWidth(annotation);

      for (let index = 1; index < annotation.points.length; index += 1) {
        const start = mapDisplayPointToPdfPoint(annotation.points[index - 1], pdfPage);
        const end = mapDisplayPointToPdfPoint(annotation.points[index], pdfPage);

        pdfPage.drawLine({
          start,
          end,
          thickness,
          color: annotationColor,
          opacity,
          lineCap: LineCapStyle.Round,
          blendMode: BlendMode.Multiply,
        });
      }
    }
    return;
  }

  const box = mapDisplayRectToPdfBox(annotation, pdfPage);

  if (annotation.type === 'highlight') {
    const highlightStyle = {
      color: annotationColor,
      opacity: 0.38,
      borderColor: annotationColor,
      borderOpacity: 0.45,
      borderWidth: 0.8,
    };

    if (annotation.rotation) {
      // The display rect rotates clockwise about its top-left corner, while
      // pdf-lib rotates counterclockwise about the rect's bottom-left anchor.
      // Mapping the rotated bottom-left corner and the run direction through
      // the page rotation yields the anchor and angle in PDF space.
      const theta = (annotation.rotation * Math.PI) / 180;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const anchor = mapDisplayPointToPdfPoint(
        {
          x: annotation.x - sin * annotation.height,
          y: annotation.y + cos * annotation.height,
        },
        pdfPage,
      );
      const origin = mapDisplayPointToPdfPoint({ x: annotation.x, y: annotation.y }, pdfPage);
      const alongRun = mapDisplayPointToPdfPoint(
        { x: annotation.x + cos, y: annotation.y + sin },
        pdfPage,
      );
      const pdfAngle = Math.atan2(alongRun.y - origin.y, alongRun.x - origin.x);

      pdfPage.drawRectangle({
        x: anchor.x,
        y: anchor.y,
        width: annotation.width,
        height: annotation.height,
        rotate: degrees((pdfAngle * 180) / Math.PI),
        ...highlightStyle,
      });
      return;
    }

    pdfPage.drawRectangle({
      x: box.left,
      y: box.bottom,
      width: box.width,
      height: box.height,
      ...highlightStyle,
    });
    return;
  }

  if (annotation.type === 'rectangle') {
    pdfPage.drawRectangle({
      x: box.left,
      y: box.bottom,
      width: box.width,
      height: box.height,
      borderColor: annotationColor,
      borderWidth: 2,
      opacity: 1,
    });
    return;
  }

  if (
    annotation.type === 'text-note' ||
    annotation.type === 'free-text' ||
    annotation.type === 'text-edit'
  ) {
    const font = await embedWorkspaceFont(outputDocument, annotation.fontId, {
      bold: annotation.fontBold,
      italic: annotation.fontItalic,
    });
    const isTextEdit = annotation.type === 'text-edit';
    const content =
      annotation.type === 'text-note'
        ? normalizeText(annotation.content ?? '', 180)
        : (annotation.content ?? '').replace(/\r\n?/g, '\n');
    const fillRgb = getAnnotationRgbPaintColor(getAnnotationFillColor(annotation));
    const borderRgb = getAnnotationRgbPaintColor(getAnnotationBorderColor(annotation));

    if (fillRgb || borderRgb) {
      pdfPage.drawRectangle({
        x: box.left,
        y: box.bottom,
        width: box.width,
        height: box.height,
        color: fillRgb ? rgb(fillRgb.r, fillRgb.g, fillRgb.b) : undefined,
        opacity: fillRgb ? 1 : undefined,
        borderColor: borderRgb ? rgb(borderRgb.r, borderRgb.g, borderRgb.b) : undefined,
        borderWidth: borderRgb ? 1 : 0,
      });
    }

    if (content.trim()) {
      const fontSize = annotation.fontSize ?? 11;
      const lineHeight = annotation.lineHeight ?? fontSize * 1.25;
      const inset = isTextEdit ? 1.5 : 7;
      const maxWidth = Math.max(10, box.width - inset * 2);
      const textLines = wrapAnnotationLines(content, font, fontSize, maxWidth);
      // Mirror the on-screen CSS line box: the first baseline sits half the
      // leading plus ~0.8em below the top edge of the annotation.
      const firstBaselineY =
        box.bottom + box.height - inset - (lineHeight - fontSize) / 2 - fontSize * 0.8;
      const drawOptions = {
        x: box.left + inset,
        y: firstBaselineY,
        size: fontSize,
        font,
        color: annotationColor,
        lineHeight,
      };

      try {
        pdfPage.drawText(textLines.join('\n'), drawOptions);
      } catch {
        // Standard fonts only encode WinAnsi; retry with unsupported
        // characters replaced instead of failing the whole export.
        pdfPage.drawText(textLines.join('\n').replace(/[^\x20-\x7e\n]/g, '?'), drawOptions);
      }
    }
    return;
  }

  if (annotation.type === 'pen' && annotation.points && annotation.points.length > 1) {
    for (let index = 1; index < annotation.points.length; index += 1) {
      const start = mapDisplayPointToPdfPoint(annotation.points[index - 1], pdfPage);
      const end = mapDisplayPointToPdfPoint(annotation.points[index], pdfPage);

      pdfPage.drawLine({
        start,
        end,
        thickness: getAnnotationStrokeWidth(annotation),
        color: annotationColor,
      });
    }
    return;
  }

  if (
    (annotation.type === 'signature' || annotation.type === 'image') &&
    annotation.imageBytes?.length
  ) {
    const imageBytes = new Uint8Array(annotation.imageBytes);
    const image =
      annotation.imageMimeType === 'image/png'
        ? await outputDocument.embedPng(imageBytes)
        : await outputDocument.embedJpg(imageBytes);

    pdfPage.drawImage(image, {
      x: box.left,
      y: box.bottom,
      width: box.width,
      height: box.height,
    });
  }
}

async function drawAnnotationOverlays({
  annotations,
  outputDocument,
  pdfPage,
}: {
  annotations: PdfAnnotation[];
  outputDocument: PDFDocument;
  pdfPage: PDFPage;
}): Promise<void> {
  for (const annotation of annotations) {
    await drawAnnotationOverlay({ annotation, outputDocument, pdfPage });
  }
}

function canExportSingleSourceDocumentDirectly(workspace: PdfWorkspace): boolean {
  if (
    workspace.documents.length !== 1 ||
    hasFormatterExportWork(workspace) ||
    hasAnnotationExportWork(workspace)
  ) {
    return false;
  }

  const sourceDocument = workspace.documents[0];
  const pages = getVisiblePages(workspace);

  if (pages.length !== sourceDocument.pageCount) {
    return false;
  }

  return pages.every(
    (page, pageIndex) =>
      isSourcePageItem(page) &&
      page.sourceDocumentId === sourceDocument.id &&
      page.sourcePageIndex === pageIndex &&
      page.rotation === 0,
  );
}

async function exportSingleSourceDocumentDirectly(workspace: PdfWorkspace): Promise<Uint8Array> {
  const sourceDocument = workspace.documents[0];

  if (!hasFormExportWork(workspace, sourceDocument)) {
    return sourceDocument.bytes.slice();
  }

  const document = await PDFDocument.load(sourceDocument.bytes.slice(), {
    updateMetadata: false,
  });

  applyPdfFormValues(
    document,
    getFormEditsForDocument(workspace, sourceDocument),
    workspace.formSettings.flattenOnExport,
  );

  return savePdfDocument(document);
}

function getPdfDocumentCacheKey(sourceDocument: PdfDocumentSource): string {
  return `${sourceDocument.id}:${sourceDocument.loadedAt}`;
}

function getDefaultExportFileName(workspace: PdfWorkspace): string {
  if (workspace.documents.length === 1) {
    return ensurePdfExtension(workspace.documents[0].fileName);
  }

  return 'merged-paperdesk.pdf';
}

function ensurePdfExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.pdf') ? filePath : `${filePath}.pdf`;
}

function normalizePathForComparison(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'pages';
}

function isOriginalSourcePath(workspace: PdfWorkspace, filePath: string): boolean {
  const normalizedFilePath = normalizePathForComparison(filePath);

  return workspace.documents.some(
    (document) =>
      document.filePath && normalizePathForComparison(document.filePath) === normalizedFilePath,
  );
}

function createSubsetWorkspace(workspace: PdfWorkspace, pageIds: PdfPageId[]): PdfWorkspace {
  const pageIdSet = new Set(pageIds);
  const pages = getVisiblePages(workspace)
    .filter((page) => pageIdSet.has(page.id))
    .map((page, pageIndex) => ({
      ...page,
      displayIndex: pageIndex + 1,
    }));

  if (pages.length === 0) {
    throw new PdfExportError(
      'Cannot export an empty page subset.',
      'Select at least one visible page before exporting selected pages.',
    );
  }

  return {
    ...workspace,
    pages,
    selectedPageIds: pages.map((page) => page.id),
    activePageId: pages[0]?.id,
  };
}

function getPageIdsForRange(workspace: PdfWorkspace, range: PdfPageRange): PdfPageId[] {
  const visiblePages = getVisiblePages(workspace);

  return range.pageNumbers.map((pageNumber) => visiblePages[pageNumber - 1].id);
}

async function loadSourcePdfDocument(sourceDocument: PdfDocumentSource): Promise<PDFDocument> {
  const cacheKey = getPdfDocumentCacheKey(sourceDocument);
  const cachedDocument = sourcePdfDocumentCache.get(cacheKey);

  if (
    cachedDocument &&
    cachedDocument.bytes === sourceDocument.bytes &&
    cachedDocument.loadedAt === sourceDocument.loadedAt
  ) {
    return cachedDocument.document;
  }

  try {
    const document = await PDFDocument.load(sourceDocument.bytes.slice(), {
      updateMetadata: false,
    });

    sourcePdfDocumentCache.set(cacheKey, {
      bytes: sourceDocument.bytes,
      document,
      loadedAt: sourceDocument.loadedAt,
    });

    return document;
  } catch (error) {
    const friendlyError = classifyPdfExportError(error);
    logDeveloperError(`Unable to load source PDF for export: ${sourceDocument.fileName}`, error);
    throw new PdfExportError(
      'Unable to load source PDF for export.',
      friendlyError.userMessage,
      error,
      friendlyError.suggestion,
    );
  }
}

async function loadSourcePdfDocumentForExport(
  workspace: PdfWorkspace,
  sourceDocument: PdfDocumentSource,
): Promise<PDFDocument> {
  if (!hasFormExportWork(workspace, sourceDocument)) {
    return loadSourcePdfDocument(sourceDocument);
  }

  try {
    const document = await PDFDocument.load(sourceDocument.bytes.slice(), {
      updateMetadata: false,
    });

    applyPdfFormValues(
      document,
      getFormEditsForDocument(workspace, sourceDocument),
      workspace.formSettings.flattenOnExport,
    );

    return document;
  } catch (error) {
    const friendlyError = classifyPdfExportError(error);
    logDeveloperError(
      `Unable to apply PDF form values for export: ${sourceDocument.fileName}`,
      error,
    );
    throw new PdfExportError(
      'Unable to apply PDF form values for export.',
      friendlyError.userMessage,
      error,
      friendlyError.suggestion,
    );
  }
}

async function chooseExportPath({
  defaultPath,
  title,
}: {
  defaultPath: string;
  title: string;
}): Promise<string | null> {
  const selectedPath = await save({
    canCreateDirectories: true,
    defaultPath,
    filters: pdfFileFilters,
    title,
  });

  return selectedPath ? ensurePdfExtension(selectedPath) : null;
}

async function writeExportedPdf({
  bytes,
  filePath,
  pageCount,
  workspace,
}: {
  bytes: Uint8Array;
  filePath: string;
  pageCount: number;
  workspace: PdfWorkspace;
}): Promise<PdfSaveResult | null> {
  if (isOriginalSourcePath(workspace, filePath)) {
    const confirmed = await confirm(
      'This will overwrite one of the original source PDFs. Continue?',
      {
        kind: 'warning',
        title: 'Overwrite original PDF?',
      },
    );

    if (!confirmed) {
      return null;
    }
  }

  try {
    await writeFile(filePath, bytes);
  } catch (error) {
    const friendlyError = classifyPdfExportError(error);
    logDeveloperError(`Unable to write exported PDF: ${filePath}`, error);
    throw new PdfExportError(
      'Unable to write exported PDF.',
      friendlyError.userMessage,
      error,
      friendlyError.suggestion,
    );
  }

  return {
    bytes,
    filePath,
    pageCount,
  };
}

export function parsePageRanges(input: string, pageCount: number): PdfPageRange[] {
  if (pageCount < 1) {
    throw new PdfExportError(
      'Cannot parse page ranges for an empty document.',
      'There are no pages to split. Add or restore pages first.',
    );
  }

  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new PdfExportError(
      'Page range input is empty.',
      'Enter one or more page ranges, such as 1-3,5,8-10.',
    );
  }

  return trimmedInput.split(',').map((rawPart) => {
    const part = rawPart.trim();

    if (!part) {
      throw new PdfExportError(
        'Page range contains an empty segment.',
        'Remove empty range segments. Use examples like 1-3,5,8-10.',
      );
    }

    const singlePageMatch = /^(\d+)$/.exec(part);
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);

    if (!singlePageMatch && !rangeMatch) {
      throw new PdfExportError(
        'Page range has invalid syntax.',
        `“${part}” is not a valid page range. Use a page number or a range like 2-5.`,
      );
    }

    const start = Number(singlePageMatch?.[1] ?? rangeMatch?.[1]);
    const end = Number(singlePageMatch?.[1] ?? rangeMatch?.[2]);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      throw new PdfExportError(
        'Page range has invalid page numbers.',
        'Page ranges must use positive page numbers.',
      );
    }

    if (start > end) {
      throw new PdfExportError(
        'Page range start is after its end.',
        `“${part}” is backwards. Use ${end}-${start} instead.`,
      );
    }

    if (end > pageCount) {
      throw new PdfExportError(
        'Page range exceeds visible page count.',
        `“${part}” is outside this document. Enter pages from 1 to ${pageCount}.`,
      );
    }

    return {
      label: start === end ? String(start) : `${start}-${end}`,
      pageNumbers: Array.from({ length: end - start + 1 }, (_, index) => start + index),
    };
  });
}

export async function loadPdfForExport(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  } catch (error) {
    const friendlyError = classifyPdfExportError(error);
    logDeveloperError('Unable to load PDF for export.', error);
    throw new PdfExportError(
      'Unable to load PDF for export.',
      friendlyError.userMessage,
      error,
      friendlyError.suggestion,
    );
  }
}

export async function savePdfDocument(document: PDFDocument): Promise<Uint8Array> {
  try {
    return await document.save();
  } catch (error) {
    const friendlyError = classifyPdfExportError(error);
    logDeveloperError('Unable to serialize PDF document.', error);
    throw new PdfExportError(
      'Unable to serialize PDF document.',
      friendlyError.userMessage,
      error,
      friendlyError.suggestion,
    );
  }
}

export async function exportWorkspaceToPdf(workspace: PdfWorkspace): Promise<Uint8Array> {
  const pages = getVisiblePages(workspace);

  if (pages.length === 0) {
    throw new PdfExportError(
      'Cannot export an empty PDF workspace.',
      'Paperdesk cannot export an empty document. Add or restore at least one page first.',
    );
  }

  if (canExportSingleSourceDocumentDirectly(workspace)) {
    return exportSingleSourceDocumentDirectly(workspace);
  }

  const outputDocument = await PDFDocument.create({ updateMetadata: false });
  const pageNumbers = getFormatterPageNumbers(workspace, pages);

  for (const page of pages) {
    let outputPage: PDFPage | null = null;
    const shouldApplyFormatter = shouldApplyFormatterToPage(workspace, page);

    if (isGeneratedPageItem(page)) {
      const pageSize = shouldApplyFormatter
        ? getResizeDimensions(workspace.formatterSettings, page)
        : null;
      const generatedPageSize = pageSize ?? {
        width: page.width ?? 595.28,
        height: page.height ?? 841.89,
      };

      outputPage = outputDocument.addPage([generatedPageSize.width, generatedPageSize.height]);
      outputPage.setRotation(degrees(page.rotation));
      await drawGeneratedPageContent(outputDocument, outputPage, page);
    } else if (isSourcePageItem(page)) {
      const sourceDocument = getSourceDocument(workspace, page);
      const sourcePdfDocument = await loadSourcePdfDocumentForExport(workspace, sourceDocument);

      if (page.sourcePageIndex < 0 || page.sourcePageIndex >= sourcePdfDocument.getPageCount()) {
        throw new PdfExportError(
          'Source page index is outside the source PDF page range.',
          `Paperdesk could not export page ${page.displayIndex} because its source page is missing.`,
        );
      }

      try {
        const [copiedPage] = await outputDocument.copyPages(sourcePdfDocument, [
          page.sourcePageIndex,
        ]);
        const existingRotation = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees(normalizePdfRotation(existingRotation + page.rotation)));
        outputPage = outputDocument.addPage(copiedPage);
      } catch (error) {
        const friendlyError = classifyPdfExportError(error);
        logDeveloperError(`Unable to copy source page ${page.displayIndex}.`, error);
        throw new PdfExportError(
          'Unable to copy source page into output PDF.',
          friendlyError.userMessage,
          error,
          friendlyError.suggestion,
        );
      }
    }

    if (!outputPage) {
      throw new PdfExportError(
        'Unsupported workspace page type.',
        `Paperdesk could not export page ${page.displayIndex}.`,
      );
    }

    await drawAnnotationOverlays({
      annotations: workspace.annotations.filter((annotation) => annotation.pageItemId === page.id),
      outputDocument,
      pdfPage: outputPage,
    });

    const visibleBox = shouldApplyFormatter
      ? applyResizeAndCrop(outputPage, page, workspace.formatterSettings)
      : getFullPageBox(outputPage);

    if (shouldApplyFormatter) {
      await drawFormatterOverlays({
        outputDocument,
        pageNumber: pageNumbers.get(page.id),
        pdfPage: outputPage,
        settings: workspace.formatterSettings,
        visibleBox,
      });
    }
  }

  return savePdfDocument(outputDocument);
}

export async function exportWorkspaceToPdfBytes(workspace: PdfWorkspace): Promise<Uint8Array> {
  return exportWorkspaceToPdf(workspace);
}

export async function exportPageSubset(
  workspace: PdfWorkspace,
  pageIds: PdfPageId[],
): Promise<Uint8Array> {
  return exportWorkspaceToPdf(createSubsetWorkspace(workspace, pageIds));
}

export async function exportPageRanges(
  workspace: PdfWorkspace,
  ranges: PdfPageRange[],
): Promise<PdfRangeExportResult[]> {
  if (ranges.length === 0) {
    throw new PdfExportError(
      'Cannot export empty page ranges.',
      'Enter one or more page ranges before splitting.',
    );
  }

  const results: PdfRangeExportResult[] = [];

  for (const range of ranges) {
    const bytes = await exportPageSubset(workspace, getPageIdsForRange(workspace, range));

    results.push({
      bytes,
      pageCount: range.pageNumbers.length,
      range,
    });
  }

  return results;
}

export async function saveWorkspacePdf(workspace: PdfWorkspace): Promise<PdfSaveResult | null> {
  const filePath = await chooseExportPath({
    defaultPath: getDefaultExportFileName(workspace),
    title: 'Export PDF',
  });

  if (!filePath) {
    return null;
  }

  return writeExportedPdf({
    bytes: await exportWorkspaceToPdf(workspace),
    filePath,
    pageCount: getVisiblePages(workspace).length,
    workspace,
  });
}

export async function savePageSubsetPdf(
  workspace: PdfWorkspace,
  pageIds: PdfPageId[],
): Promise<PdfSaveResult | null> {
  const filePath = await chooseExportPath({
    defaultPath: 'selected-pages-paperdesk.pdf',
    title: 'Export Selected Pages',
  });

  if (!filePath) {
    return null;
  }

  const subsetWorkspace = createSubsetWorkspace(workspace, pageIds);
  const pageCount = getVisiblePages(subsetWorkspace).length;

  return writeExportedPdf({
    bytes: await exportWorkspaceToPdf(subsetWorkspace),
    filePath,
    pageCount,
    workspace,
  });
}

export async function saveWorkspacePageRanges(
  workspace: PdfWorkspace,
  ranges: PdfPageRange[],
): Promise<PdfRangeSaveResult[]> {
  const savedResults: PdfRangeSaveResult[] = [];

  for (const range of ranges) {
    const filePath = await chooseExportPath({
      defaultPath: `paperdesk-pages-${sanitizeFileNamePart(range.label)}.pdf`,
      title: `Export Pages ${range.label}`,
    });

    if (!filePath) {
      break;
    }

    const pageIds = getPageIdsForRange(workspace, range);
    const bytes = await exportPageSubset(workspace, pageIds);
    const savedResult = await writeExportedPdf({
      bytes,
      filePath,
      pageCount: range.pageNumbers.length,
      workspace,
    });

    if (!savedResult) {
      break;
    }

    savedResults.push({
      ...savedResult,
      range,
    });
  }

  return savedResults;
}

export function getPdfExportErrorMessage(error: unknown): string {
  if (error instanceof PdfExportError) {
    return error.userMessage;
  }

  return 'Paperdesk could not export this PDF.';
}

export function clearPdfExportCache(): void {
  sourcePdfDocumentCache.clear();
}
