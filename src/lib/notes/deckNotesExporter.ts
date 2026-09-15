import { confirm, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import fontkit from '@pdf-lib/fontkit';
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
  type ParagraphChild,
} from 'docx';
import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import carlitoBoldUrl from '../../assets/fonts/Carlito-Bold.ttf?url';
import carlitoBoldItalicUrl from '../../assets/fonts/Carlito-BoldItalic.ttf?url';
import carlitoItalicUrl from '../../assets/fonts/Carlito-Italic.ttf?url';
import carlitoRegularUrl from '../../assets/fonts/Carlito-Regular.ttf?url';
import { exportWorkspaceToPdfBytes } from '../pdf/pdfExporter';
import { renderPdfThumbnailToDataUrl } from '../pdf/pdfRenderer';
import type {
  PageNoteBlock,
  PageNoteRun,
  PdfDocumentSource,
  PdfWorkspace,
  SourcePdfPageItem,
} from '../pdf/types';
import { classifyPdfExportError, logDeveloperError } from '../utils/errors';
import { hasPageNoteContent, normalizePageNoteHref } from './pageNotes';
import {
  getDeckNotesBaseName,
  getDeckNotesExportFileName,
  getDeckNotesSections,
  type DeckNotesExportFormat,
  type DeckNotesExportOptions,
  type DeckNotesSaveResult,
  type DeckNotesSection,
} from './deckNotesExport';

export class DeckNotesExportError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DeckNotesExportError';
  }
}

type PdfNoteFonts = {
  bold: PDFFont;
  boldItalic: PDFFont;
  italic: PDFFont;
  regular: PDFFont;
};

type PdfLineRun = {
  font: PDFFont;
  href?: string;
  text: string;
};

const exportFilters: Record<
  DeckNotesExportFormat,
  Array<{ extensions: string[]; name: string }>
> = {
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  docx: [{ name: 'Word document', extensions: ['docx'] }],
};
const notePdfPageSize: [number, number] = [595.28, 841.89];
const notePdfMargin = 48;
const notePdfBodySize = 11;
const notePdfLineHeight = 16;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);

  if (!match) {
    throw new DeckNotesExportError(
      'Rendered slide is not a PNG data URL.',
      'Paperdesk could not prepare a slide image for notes export.',
    );
  }

  const binary = window.atob(match[1]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function renderDeckNotesSections(
  workspace: PdfWorkspace,
  includeEmptySlides: boolean,
): Promise<DeckNotesSection[]> {
  const sections = getDeckNotesSections(workspace, includeEmptySlides);

  if (sections.length === 0) {
    throw new DeckNotesExportError(
      'No slides qualify for notes export.',
      'Add notes to at least one slide or include slides without notes.',
    );
  }

  const visiblePages = workspace.pages.filter((page) => !page.deleted);
  const exportedDeckBytes = await exportWorkspaceToPdfBytes(workspace);
  const renderedSource: PdfDocumentSource = {
    bytes: exportedDeckBytes,
    fileName: `${getDeckNotesBaseName(workspace)}.pdf`,
    id: `notes-export-${workspace.id}`,
    loadedAt: new Date().toISOString(),
    pageCount: visiblePages.length,
  };
  const renderedPages: SourcePdfPageItem[] = visiblePages.map((page, pageIndex) => ({
    deleted: false,
    displayIndex: pageIndex + 1,
    id: `notes-export-page-${page.id}`,
    rotation: 0,
    sourceDocumentId: renderedSource.id,
    sourceFileName: renderedSource.fileName,
    sourcePageIndex: pageIndex,
  }));

  const renderedSections: DeckNotesSection[] = [];

  // Render sequentially so a large deck does not ask PDF.js to rasterize every slide at once.
  for (const section of sections) {
    const page = renderedPages[section.slideNumber - 1];
    const rendered = await renderPdfThumbnailToDataUrl({
      page,
      scale: 0.9,
      sourceDocument: renderedSource,
    });

    renderedSections.push({
      ...section,
      image: {
        bytes: dataUrlToBytes(rendered.dataUrl),
        height: rendered.height,
        width: rendered.width,
      },
    });
  }

  return renderedSections;
}

async function embedNoteFonts(document: PDFDocument): Promise<PdfNoteFonts> {
  document.registerFontkit(fontkit);
  const [regular, bold, italic, boldItalic] = await Promise.all(
    [carlitoRegularUrl, carlitoBoldUrl, carlitoItalicUrl, carlitoBoldItalicUrl].map(async (url) => {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Unable to load bundled notes font (${response.status}).`);
      }

      return document.embedFont(await response.arrayBuffer(), { subset: true });
    }),
  );

  return { regular, bold, italic, boldItalic };
}

function getRunFont(run: Pick<PageNoteRun, 'bold' | 'italic'>, fonts: PdfNoteFonts): PDFFont {
  if (run.bold && run.italic) {
    return fonts.boldItalic;
  }

  if (run.bold) {
    return fonts.bold;
  }

  if (run.italic) {
    return fonts.italic;
  }

  return fonts.regular;
}

function getFontSafeText(text: string, font: PDFFont): string {
  const characters = new Set(font.getCharacterSet());

  return Array.from(text)
    .map((character) => (characters.has(character.codePointAt(0) ?? -1) ? character : '□'))
    .join('');
}

function splitLongToken(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = '';

  for (const character of Array.from(text)) {
    const candidate = `${piece}${character}`;

    if (piece && font.widthOfTextAtSize(getFontSafeText(candidate, font), size) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }

  if (piece) {
    pieces.push(piece);
  }

  return pieces;
}

function wrapPdfRuns(runs: PageNoteRun[], fonts: PdfNoteFonts, maxWidth: number): PdfLineRun[][] {
  const lines: PdfLineRun[][] = [];
  let line: PdfLineRun[] = [];
  let lineWidth = 0;

  const pushLine = () => {
    lines.push(line);
    line = [];
    lineWidth = 0;
  };

  for (const run of runs) {
    const font = getRunFont(run, fonts);
    const href = normalizePageNoteHref(run.href);

    for (const token of run.text.split(/(\n|[ \t]+)/u).filter(Boolean)) {
      if (token === '\n') {
        pushLine();
        continue;
      }

      const tokenParts =
        font.widthOfTextAtSize(getFontSafeText(token, font), notePdfBodySize) > maxWidth
          ? splitLongToken(token, font, notePdfBodySize, maxWidth)
          : [token];

      for (const tokenPart of tokenParts) {
        const isWhitespace = /^\s+$/u.test(tokenPart);
        const safeText = getFontSafeText(tokenPart, font);
        const tokenWidth = font.widthOfTextAtSize(safeText, notePdfBodySize);

        if (line.length > 0 && lineWidth + tokenWidth > maxWidth && !isWhitespace) {
          pushLine();
        }

        if (line.length === 0 && isWhitespace) {
          continue;
        }

        line.push({ font, href, text: safeText });
        lineWidth += tokenWidth;
      }
    }
  }

  if (line.length > 0 || lines.length === 0) {
    pushLine();
  }

  return lines;
}

function addPdfLinkAnnotation(
  document: PDFDocument,
  page: PDFPage,
  href: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const annotation = document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(href),
    },
  });
  const annotationReference = document.context.register(annotation);
  const existingAnnotations = page.node.lookup(PDFName.of('Annots'));

  if (existingAnnotations && 'push' in existingAnnotations) {
    (existingAnnotations as { push: (value: unknown) => void }).push(annotationReference);
  } else {
    page.node.set(PDFName.of('Annots'), document.context.obj([annotationReference]));
  }
}

function drawPdfLine(
  document: PDFDocument,
  page: PDFPage,
  runs: PdfLineRun[],
  x: number,
  y: number,
): void {
  let cursorX = x;

  for (const run of runs) {
    const width = run.font.widthOfTextAtSize(run.text, notePdfBodySize);
    const href = normalizePageNoteHref(run.href);

    page.drawText(run.text, {
      color: href ? rgb(0.18, 0.37, 0.45) : rgb(0.12, 0.15, 0.18),
      font: run.font,
      size: notePdfBodySize,
      x: cursorX,
      y,
    });

    if (href && width > 0) {
      page.drawLine({
        color: rgb(0.18, 0.37, 0.45),
        end: { x: cursorX + width, y: y - 1 },
        start: { x: cursorX, y: y - 1 },
        thickness: 0.5,
      });
      addPdfLinkAnnotation(document, page, href, cursorX, y - 2, width, notePdfLineHeight);
    }

    cursorX += width;
  }
}

export async function createDeckNotesPdf(
  workspace: PdfWorkspace,
  sections: DeckNotesSection[],
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const fonts = await embedNoteFonts(document);
  let page = document.addPage(notePdfPageSize);
  let y = notePdfPageSize[1] - notePdfMargin;
  let activeSlideNumber: number | null = null;

  const addPage = (continued = false) => {
    page = document.addPage(notePdfPageSize);
    y = notePdfPageSize[1] - notePdfMargin;

    if (continued && activeSlideNumber) {
      page.drawText(`Slide ${activeSlideNumber} notes — continued`, {
        color: rgb(0.18, 0.37, 0.45),
        font: fonts.bold,
        size: 11,
        x: notePdfMargin,
        y,
      });
      y -= 26;
    }
  };

  page.drawText(getFontSafeText(workspace.name, fonts.bold), {
    color: rgb(0.09, 0.13, 0.17),
    font: fonts.bold,
    size: 22,
    x: notePdfMargin,
    y,
  });
  y -= 22;
  page.drawText('Deck notes', {
    color: rgb(0.36, 0.41, 0.46),
    font: fonts.regular,
    size: 11,
    x: notePdfMargin,
    y,
  });
  y -= 34;

  for (const section of sections) {
    activeSlideNumber = section.slideNumber;
    const embeddedImage = await document.embedPng(section.image.bytes);
    const imageScale = Math.min(
      (notePdfPageSize[0] - notePdfMargin * 2) / section.image.width,
      265 / section.image.height,
      1,
    );
    const imageWidth = section.image.width * imageScale;
    const imageHeight = section.image.height * imageScale;
    const sectionStartHeight = 34 + imageHeight + 26;

    if (y - sectionStartHeight < notePdfMargin) {
      addPage(false);
    }

    page.drawText(`Slide ${section.slideNumber}`, {
      color: rgb(0.18, 0.37, 0.45),
      font: fonts.bold,
      size: 16,
      x: notePdfMargin,
      y,
    });
    y -= 25;
    page.drawImage(embeddedImage, {
      height: imageHeight,
      width: imageWidth,
      x: notePdfMargin,
      y: y - imageHeight,
    });
    y -= imageHeight + 22;

    const noteBlocks = section.note?.blocks ?? [];

    if (!hasPageNoteContent(section.note)) {
      page.drawText('No notes for this slide', {
        color: rgb(0.42, 0.46, 0.5),
        font: fonts.italic,
        size: notePdfBodySize,
        x: notePdfMargin,
        y,
      });
      y -= 28;
    } else {
      let numberedItem = 0;

      for (const block of noteBlocks) {
        numberedItem = block.type === 'number' ? numberedItem + 1 : 0;
        const prefix =
          block.type === 'bullet' ? '• ' : block.type === 'number' ? `${numberedItem}. ` : '';
        const prefixWidth = prefix ? fonts.regular.widthOfTextAtSize(prefix, notePdfBodySize) : 0;
        const lines = wrapPdfRuns(
          block.runs,
          fonts,
          notePdfPageSize[0] - notePdfMargin * 2 - prefixWidth,
        );

        for (const [lineIndex, line] of lines.entries()) {
          if (y - notePdfLineHeight < notePdfMargin) {
            addPage(true);
          }

          if (lineIndex === 0 && prefix) {
            page.drawText(prefix, {
              color: rgb(0.12, 0.15, 0.18),
              font: fonts.regular,
              size: notePdfBodySize,
              x: notePdfMargin,
              y,
            });
          }

          drawPdfLine(document, page, line, notePdfMargin + prefixWidth, y);
          y -= notePdfLineHeight;
        }

        y -= block.type === 'paragraph' ? 6 : 2;
      }
    }

    if (y > notePdfMargin + 18) {
      page.drawLine({
        color: rgb(0.85, 0.87, 0.89),
        end: { x: notePdfPageSize[0] - notePdfMargin, y },
        start: { x: notePdfMargin, y },
        thickness: 0.7,
      });
      y -= 24;
    }
  }

  return document.save();
}

function createDocxInlineRuns(runs: PageNoteRun[]): ParagraphChild[] {
  return runs.reduce<ParagraphChild[]>((children, run) => {
    const href = normalizePageNoteHref(run.href);
    const textRuns = run.text.split('\n').map(
      (text, index) =>
        new TextRun({
          bold: run.bold,
          break: index > 0 ? 1 : undefined,
          color: href ? '2F5F73' : '17212B',
          font: 'Arial',
          italics: run.italic,
          size: 22,
          text,
          underline: href ? { type: UnderlineType.SINGLE } : undefined,
        }),
    );

    if (href) {
      children.push(new ExternalHyperlink({ children: textRuns, link: href }));
    } else {
      children.push(...textRuns);
    }

    return children;
  }, []);
}

function createDocxNoteParagraph(block: PageNoteBlock, numberedListInstance: number): Paragraph {
  return new Paragraph({
    bullet: block.type === 'bullet' ? { level: 0 } : undefined,
    children: createDocxInlineRuns(block.runs),
    numbering:
      block.type === 'number'
        ? { instance: numberedListInstance, level: 0, reference: 'deck-notes-numbered' }
        : undefined,
    spacing: { after: block.type === 'paragraph' ? 140 : 60, line: 300 },
  });
}

export async function createDeckNotesDocx(
  workspace: PdfWorkspace,
  sections: DeckNotesSection[],
): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ bold: true, color: '17212B', font: 'Arial', size: 40, text: workspace.name }),
      ],
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ color: '5D6876', font: 'Arial', size: 22, text: 'Deck notes' })],
      spacing: { after: 360 },
    }),
  ];
  let numberedListInstance = 0;

  for (const section of sections) {
    const scale = Math.min(520 / section.image.width, 320 / section.image.height, 1);

    children.push(
      new Paragraph({
        border: {
          bottom: { color: 'DBE1E7', size: 6, space: 8, style: BorderStyle.SINGLE },
        },
        children: [
          new TextRun({
            bold: true,
            color: '2F5F73',
            font: 'Arial',
            size: 30,
            text: `Slide ${section.slideNumber}`,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        keepNext: true,
        spacing: { before: 220, after: 180 },
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new ImageRun({
            altText: {
              description: `Slide ${section.slideNumber}`,
              name: `Slide ${section.slideNumber}`,
              title: `Slide ${section.slideNumber}`,
            },
            data: section.image.bytes,
            transformation: {
              height: Math.round(section.image.height * scale),
              width: Math.round(section.image.width * scale),
            },
            type: 'png',
          }),
        ],
        keepNext: true,
        spacing: { after: 240 },
      }),
    );

    if (!hasPageNoteContent(section.note)) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              color: '6B7280',
              font: 'Arial',
              italics: true,
              size: 22,
              text: 'No notes for this slide',
            }),
          ],
          spacing: { after: 220 },
        }),
      );
      continue;
    }

    let wasNumbered = false;

    for (const block of section.note?.blocks ?? []) {
      if (block.type === 'number' && !wasNumbered) {
        numberedListInstance += 1;
      }

      children.push(createDocxNoteParagraph(block, numberedListInstance));
      wasNumbered = block.type === 'number';
    }
  }

  const document = new DocxDocument({
    creator: 'Paperdesk',
    description: 'Deck notes exported from Paperdesk',
    numbering: {
      config: [
        {
          levels: [
            {
              alignment: AlignmentType.LEFT,
              format: LevelFormat.DECIMAL,
              level: 0,
              style: {
                paragraph: { indent: { hanging: 360, left: 720 } },
                run: { font: 'Arial', size: 22 },
              },
              text: '%1.',
            },
          ],
          reference: 'deck-notes-numbered',
        },
      ],
    },
    sections: [
      {
        children,
        properties: {
          page: {
            margin: { bottom: 720, left: 720, right: 720, top: 720 },
          },
        },
      },
    ],
    subject: 'Deck notes',
    title: `${workspace.name} — Deck notes`,
  });
  const arrayBuffer = await Packer.toArrayBuffer(document);

  return new Uint8Array(arrayBuffer);
}

function ensureExtension(filePath: string, format: DeckNotesExportFormat): string {
  return filePath.toLowerCase().endsWith(`.${format}`) ? filePath : `${filePath}.${format}`;
}

function normalizePathForComparison(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

export async function saveDeckNotes(
  workspace: PdfWorkspace,
  options: DeckNotesExportOptions,
): Promise<DeckNotesSaveResult | null> {
  const selectedPath = await save({
    canCreateDirectories: true,
    defaultPath: getDeckNotesExportFileName(workspace, options.format),
    filters: exportFilters[options.format],
    title: 'Export deck notes',
  });

  if (!selectedPath) {
    return null;
  }

  const filePath = ensureExtension(selectedPath, options.format);
  const matchesSource = workspace.documents.some(
    (source) =>
      source.filePath &&
      normalizePathForComparison(source.filePath) === normalizePathForComparison(filePath),
  );

  if (
    matchesSource &&
    !(await confirm('This will overwrite an original source PDF. Continue?', {
      kind: 'warning',
      title: 'Overwrite original PDF?',
    }))
  ) {
    return null;
  }

  try {
    const sections = await renderDeckNotesSections(workspace, options.includeEmptySlides);
    const bytes =
      options.format === 'pdf'
        ? await createDeckNotesPdf(workspace, sections)
        : await createDeckNotesDocx(workspace, sections);

    await writeFile(filePath, bytes);

    return {
      filePath,
      format: options.format,
      slideCount: sections.length,
    };
  } catch (error) {
    if (error instanceof DeckNotesExportError) {
      throw error;
    }

    const friendlyError = classifyPdfExportError(error);
    logDeveloperError(`Unable to export deck notes: ${filePath}`, error);
    throw new DeckNotesExportError(
      'Unable to export deck notes.',
      friendlyError.userMessage || 'Paperdesk could not export the deck notes.',
      error,
    );
  }
}
