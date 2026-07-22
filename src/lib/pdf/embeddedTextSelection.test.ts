import { describe, expect, it } from 'vitest';

import type { EmbeddedTextBox } from './embeddedText';
import {
  emptyEmbeddedTextSelection,
  getCommentRectFromSelection,
  getDominantSelectionFont,
  getSelectionArea,
  mergeSelectionRects,
  normalizeExtractedPdfText,
  selectEmbeddedTextBoxes,
  selectWordAtEmbeddedTextPoint,
  type TextSelectionRect,
} from './embeddedTextSelection';

const pageSize = { height: 200, width: 300 };
const scale = 2;

function createTextBox(index: number, text: string, rect: TextSelectionRect): EmbeddedTextBox {
  return {
    dir: 'ltr',
    id: `text-box-${index}`,
    index,
    rect,
    text,
  };
}

const textBoxes: EmbeddedTextBox[] = [
  createTextBox(0, 'Hello', { height: 20, width: 50, x: 40, y: 24 }),
  createTextBox(1, 'World', { height: 20, width: 60, x: 120, y: 24 }),
  createTextBox(2, 'Second', { height: 20, width: 70, x: 40, y: 72 }),
  createTextBox(3, 'line', { height: 20, width: 50, x: 120, y: 72 }),
];

describe('embedded text selection', () => {
  it('selects stored text boxes by page-local drag rectangle without native browser selection', () => {
    const selection = selectEmbeddedTextBoxes({
      area: { height: 15, width: 85, x: 15, y: 10 },
      boxes: textBoxes,
      pageSize,
      scale,
    });

    expect(selection.selectedBoxCount).toBe(2);
    expect(selection.rects).toEqual([{ height: 10, width: 70, x: 20, y: 12 }]);
    expect(selection.text).toBe('Hello World');
  });

  it('reconstructs selected text in reading order across lines', () => {
    const selection = selectEmbeddedTextBoxes({
      area: { height: 42, width: 85, x: 15, y: 10 },
      boxes: textBoxes,
      pageSize,
      scale,
    });

    expect(selection.selectedBoxCount).toBe(4);
    expect(selection.rects).toEqual([
      { height: 10, width: 70, x: 20, y: 12 },
      { height: 10, width: 65, x: 20, y: 36 },
    ]);
    expect(selection.text).toBe('Hello World\nSecond line');
  });

  it('uses CSS viewport scale, not devicePixelRatio, when selecting boxes', () => {
    const selection = selectEmbeddedTextBoxes({
      area: { height: 10, width: 25, x: 20, y: 12 },
      boxes: [textBoxes[0]],
      pageSize,
      scale,
    });

    expect(selection.selectedBoxCount).toBe(1);
    expect(selection.rects).toEqual([{ height: 10, width: 25, x: 20, y: 12 }]);
    expect(selection.text).toBe('Hello');
  });

  it('creates highlight, comment, and edit-text annotation rectangles from selected boxes', () => {
    const selection = selectEmbeddedTextBoxes({
      area: { height: 15, width: 85, x: 15, y: 10 },
      boxes: textBoxes,
      pageSize,
      scale,
    });
    const highlightAnnotation = {
      pageItemId: 'page-1',
      type: 'highlight',
      ...selection.rects[0],
    };
    const editTextRect = mergeSelectionRects(selection.rects, pageSize);
    const commentRect = getCommentRectFromSelection(selection.rects, pageSize);

    expect(highlightAnnotation).toMatchObject({
      height: 10,
      type: 'highlight',
      width: 70,
      x: 20,
      y: 12,
    });
    expect(editTextRect).toEqual({ height: 24, width: 78, x: 17, y: 7 });
    expect(commentRect).toEqual({ height: 84, width: 190, x: 107, y: 7 });
  });

  it('returns no selection for pointer movement below the drag threshold', () => {
    const area = getSelectionArea({ x: 12, y: 12 }, { x: 14, y: 14 }, pageSize);

    expect(area).toBeNull();
    expect(
      selectEmbeddedTextBoxes({
        area,
        boxes: textBoxes,
        pageSize,
        scale,
      }),
    ).toEqual(emptyEmbeddedTextSelection);
  });

  it('reports the dominant selection font, line count, and tight bounding rect', () => {
    const boxes: EmbeddedTextBox[] = [
      {
        ...createTextBox(0, 'Heading', { height: 20, width: 50, x: 40, y: 24 }),
        fontFallback: 'serif',
        fontName: 'g_d0_f1',
        fontSize: 10,
      },
      {
        ...createTextBox(1, 'Body text that is much longer', {
          height: 20,
          width: 60,
          x: 120,
          y: 24,
        }),
        fontFallback: 'sans-serif',
        fontName: 'g_d0_f2',
        fontSize: 9,
      },
    ];
    const selection = selectEmbeddedTextBoxes({
      area: { height: 15, width: 120, x: 15, y: 10 },
      boxes,
      pageSize,
      scale,
    });

    expect(selection.font).toEqual({ fallback: 'sans-serif', name: 'g_d0_f2', size: 9 });
    expect(selection.lineCount).toBe(1);
    expect(selection.tightRect).toEqual({ height: 10, width: 70, x: 20, y: 12 });
  });

  it('returns no dominant font when boxes carry no font sizes', () => {
    expect(
      getDominantSelectionFont([{ rect: { x: 0, y: 0, width: 5, height: 5 }, text: 'x' }]),
    ).toBeNull();
  });

  it('clips partially covered boxes to the dragged characters instead of whole lines', () => {
    const selection = selectEmbeddedTextBoxes({
      // Covers only the first two character cells of "Hello" (x 20..30).
      area: { height: 15, width: 10, x: 20, y: 10 },
      boxes: [textBoxes[0]],
      pageSize,
      scale,
    });

    expect(selection.text).toBe('He');
    expect(selection.rects).toEqual([{ height: 10, width: 10, x: 20, y: 12 }]);
  });

  it('drops boxes whose covered characters are only whitespace', () => {
    const boxes = [createTextBox(0, 'a   b', { height: 20, width: 100, x: 40, y: 24 })];
    const selection = selectEmbeddedTextBoxes({
      // Covers only the middle whitespace cells (page-local x 30..40).
      area: { height: 15, width: 10, x: 30, y: 10 },
      boxes,
      pageSize,
      scale,
    });

    expect(selection.selectedBoxCount).toBe(0);
    expect(selection.text).toBe('');
  });

  it('groups items with shifted baselines but strong vertical overlap into one line', () => {
    const boxes = [
      createTextBox(0, 'Hello', { height: 20, width: 50, x: 40, y: 24 }),
      // Superscript-like run: shorter and shifted up on the same visual line.
      createTextBox(1, 'World', { height: 10, width: 40, x: 120, y: 20 }),
    ];
    const selection = selectEmbeddedTextBoxes({
      area: { height: 30, width: 100, x: 15, y: 5 },
      boxes,
      pageSize,
      scale,
    });

    expect(selection.lineCount).toBe(1);
    expect(selection.text).toBe('Hello World');
  });

  it('selects the word under a point for double-click highlighting', () => {
    const boxes = [createTextBox(0, 'Hello World', { height: 20, width: 110, x: 40, y: 24 })];
    const selection = selectWordAtEmbeddedTextPoint({
      boxes,
      pageSize,
      // Page-local box is x 20..75 with 5px character cells; x 52 is inside "W".
      point: { x: 52, y: 15 },
      scale,
    });

    expect(selection.text).toBe('World');
    expect(selection.rects).toEqual([{ height: 10, width: 25, x: 50, y: 12 }]);
  });

  it('normalizes extracted PDF text that garbles in UI fonts', () => {
    expect(normalizeExtractedPdfText('o\uFB03ce and con\uFB01g')).toBe('office and config');
    expect(normalizeExtractedPdfText('hy\u00ADphen\u200Bated')).toBe('hyphenated');
    expect(normalizeExtractedPdfText('wide\u2003space\u00A0here')).toBe('wide space here');
    expect(normalizeExtractedPdfText('pua\uE123\uF8FFgone')).toBe('puagone');
    expect(normalizeExtractedPdfText('keep\nnewline\tand tab')).toBe('keep\nnewline\tand tab');
  });

  it('normalizes ligatures inside selected text reconstruction', () => {
    const boxes = [createTextBox(0, 'di\uFB03cult', { height: 20, width: 80, x: 40, y: 24 })];
    const selection = selectEmbeddedTextBoxes({
      area: { height: 20, width: 60, x: 15, y: 10 },
      boxes,
      pageSize,
      scale,
    });

    expect(selection.text).toBe('difficult');
  });

  it('emits rotation-carrying rects for selections over rotated text runs', () => {
    // 90° clockwise run: local rect (device px) {100,40,60,20} pivoting about
    // its top-left, so the page-local view footprint is {40,20,10,30}.
    const rotatedBox: EmbeddedTextBox = {
      ...createTextBox(0, 'Rot', { height: 60, width: 20, x: 80, y: 40 }),
      angle: Math.PI / 2,
      localRect: { height: 20, width: 60, x: 100, y: 40 },
    };
    const selection = selectEmbeddedTextBoxes({
      area: { height: 40, width: 20, x: 35, y: 15 },
      boxes: [rotatedBox],
      pageSize,
      scale,
    });

    expect(selection.text).toBe('Rot');
    expect(selection.rects).toHaveLength(1);
    expect(selection.rects[0].rotation).toBeCloseTo(90);
    expect(selection.rects[0].x).toBeCloseTo(50);
    expect(selection.rects[0].y).toBeCloseTo(20);
    expect(selection.rects[0].width).toBeCloseTo(30);
    expect(selection.rects[0].height).toBeCloseTo(10);
    // The tight rect stays axis-aligned for downstream annotation sizing.
    expect(selection.tightRect?.x).toBeCloseTo(40);
    expect(selection.tightRect?.width).toBeCloseTo(10);
    expect(selection.tightRect?.height).toBeCloseTo(30);
  });

  it('selects words on rotated runs with a rotation-carrying rect', () => {
    const rotatedBox: EmbeddedTextBox = {
      ...createTextBox(0, 'Rot', { height: 60, width: 20, x: 80, y: 40 }),
      angle: Math.PI / 2,
      localRect: { height: 20, width: 60, x: 100, y: 40 },
    };
    const selection = selectWordAtEmbeddedTextPoint({
      boxes: [rotatedBox],
      pageSize,
      point: { x: 45, y: 25 },
      scale,
    });

    expect(selection.text).toBe('Rot');
    expect(selection.rects).toHaveLength(1);
    expect(selection.rects[0].rotation).toBeCloseTo(90);
    expect(selection.rects[0].x).toBeCloseTo(50);
    expect(selection.rects[0].y).toBeCloseTo(20);
  });

  it('returns an empty selection when double-clicking whitespace or empty space', () => {
    const boxes = [createTextBox(0, 'Hello World', { height: 20, width: 110, x: 40, y: 24 })];

    expect(
      selectWordAtEmbeddedTextPoint({ boxes, pageSize, point: { x: 47, y: 15 }, scale }),
    ).toEqual(emptyEmbeddedTextSelection);
    expect(
      selectWordAtEmbeddedTextPoint({ boxes, pageSize, point: { x: 150, y: 150 }, scale }),
    ).toEqual(emptyEmbeddedTextSelection);
  });
});
