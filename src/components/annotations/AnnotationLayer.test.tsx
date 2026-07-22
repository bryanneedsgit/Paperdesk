import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfAnnotation, PdfPageItem } from '../../lib/pdf/types';
import { AnnotationLayer } from './AnnotationLayer';

const page: PdfPageItem = {
  deleted: false,
  displayIndex: 0,
  generatedPageType: 'blank',
  id: 'page-1',
  kind: 'generated',
  rotation: 0,
};

const textAnnotation: PdfAnnotation = {
  color: '#1f2937',
  content: 'Move me',
  createdAt: '2026-06-29T10:00:00.000Z',
  height: 30,
  id: 'annotation-1',
  pageItemId: 'page-1',
  type: 'free-text',
  width: 80,
  x: 20,
  y: 24,
};

const penAnnotation: PdfAnnotation = {
  color: '#1f2937',
  createdAt: '2026-06-29T10:05:00.000Z',
  height: 20,
  id: 'annotation-pen',
  pageItemId: 'page-1',
  points: [
    { x: 20, y: 20 },
    { x: 40, y: 40 },
  ],
  strokeWidth: 3,
  type: 'pen',
  width: 20,
  x: 20,
  y: 20,
};

const highlightAnnotation: PdfAnnotation = {
  color: '#ffe600',
  createdAt: '2026-07-09T18:20:00.000Z',
  height: 24,
  id: 'annotation-highlight',
  opacity: 0.42,
  pageItemId: 'page-1',
  points: [
    { x: 20, y: 42 },
    { x: 80, y: 54 },
  ],
  strokeWidth: 14,
  type: 'highlight',
  width: 60,
  x: 20,
  y: 42,
};

const commentAnnotation: PdfAnnotation = {
  borderColor: '#d97706',
  color: '#1f2937',
  content: 'Comment',
  createdAt: '2026-07-06T10:00:00.000Z',
  fillColor: '#fff3bf',
  height: 42,
  id: 'comment-1',
  pageItemId: 'page-1',
  type: 'text-note',
  width: 116,
  x: 20,
  y: 24,
};

function renderAnnotationLayer(
  overrides: Partial<React.ComponentProps<typeof AnnotationLayer>> = {},
) {
  return render(
    <AnnotationLayer
      activeTool="select"
      annotationBorderColor="#28666e"
      annotationColor="#1f2937"
      annotationFillColor="#ffffff"
      annotationStrokeWidth={3}
      annotations={[]}
      eraserSize={18}
      freehandSensitivity="medium"
      highlightBrushSize={14}
      highlightOpacity={0.42}
      isAnnotating
      onCommitAnnotationChange={vi.fn()}
      onCreateAnnotation={vi.fn()}
      onEraseAnnotationPixels={vi.fn()}
      onSelectAnnotation={vi.fn()}
      onUpdateAnnotation={vi.fn()}
      page={page}
      pageSize={{ height: 200, width: 200 }}
      selectedAnnotationId={null}
      spacebarFreehandEnabled={false}
      signatureImage={null}
      {...overrides}
    />,
  );
}

describe('AnnotationLayer', () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 200,
      height: 200,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens a selected comment note for typing while the comment tool is active', () => {
    const onCommitAnnotationChange = vi.fn();
    const onUpdateAnnotation = vi.fn();

    renderAnnotationLayer({
      activeTool: 'text-note',
      annotations: [commentAnnotation],
      onCommitAnnotationChange,
      onUpdateAnnotation,
      selectedAnnotationId: 'comment-1',
    });

    const editor = screen.getByRole('textbox');

    fireEvent.change(editor, { target: { value: 'Needs a source citation.' } });

    expect(onUpdateAnnotation).toHaveBeenCalledWith('comment-1', {
      content: 'Needs a source citation.',
    });

    fireEvent.blur(editor);

    expect(onCommitAnnotationChange).toHaveBeenCalledWith(
      commentAnnotation,
      expect.objectContaining({
        content: 'Needs a source citation.',
      }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('moves a text box while the text box tool is active', () => {
    const onUpdateAnnotation = vi.fn();

    renderAnnotationLayer({
      activeTool: 'free-text',
      annotations: [textAnnotation],
      onUpdateAnnotation,
    });

    const textBox = screen.getByRole('button');
    const annotationLayer = document.querySelector('.annotation-layer');

    expect(annotationLayer).not.toBeNull();

    fireEvent.pointerDown(textBox, {
      button: 0,
      clientX: 30,
      clientY: 34,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(annotationLayer as SVGSVGElement, {
      clientX: 50,
      clientY: 64,
      pointerId: 1,
    });

    expect(onUpdateAnnotation).toHaveBeenCalledWith('annotation-1', {
      x: 40,
      y: 54,
    });
  });

  it('moves a pen annotation by translating its stored path points', () => {
    const onUpdateAnnotation = vi.fn();

    renderAnnotationLayer({
      annotations: [penAnnotation],
      onUpdateAnnotation,
      selectedAnnotationId: penAnnotation.id,
    });

    const penHitTarget = document.querySelector('.annotation-pen-hit-target');
    const annotationLayer = document.querySelector('.annotation-layer');

    expect(penHitTarget).not.toBeNull();
    expect(annotationLayer).not.toBeNull();

    fireEvent.pointerDown(penHitTarget as SVGPathElement, {
      button: 0,
      clientX: 30,
      clientY: 30,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(annotationLayer as SVGSVGElement, {
      clientX: 45,
      clientY: 55,
      pointerId: 1,
    });

    const [annotationId, patch] = onUpdateAnnotation.mock.calls[0] as [
      string,
      Partial<PdfAnnotation>,
    ];

    expect(annotationId).toBe('annotation-pen');
    expect(patch.x).toBeCloseTo(35);
    expect(patch.y).toBeCloseTo(45);
    expect(patch.points?.[0].x).toBeCloseTo(35);
    expect(patch.points?.[0].y).toBeCloseTo(45);
    expect(patch.points?.[1]).toEqual({ x: 55, y: 65 });
  });

  it('ignores secondary contacts and right-click style input while drawing with the pen', () => {
    const onCreateAnnotation = vi.fn(() => 'annotation-pen');

    renderAnnotationLayer({
      activeTool: 'pen',
      onCreateAnnotation,
    });

    const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

    fireEvent.pointerDown(annotationLayer, {
      button: 2,
      clientX: 30,
      clientY: 34,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerDown(annotationLayer, {
      button: 0,
      clientX: 40,
      clientY: 44,
      isPrimary: false,
      pointerId: 2,
    });

    expect(onCreateAnnotation).not.toHaveBeenCalled();
  });

  it('only extends a pen stroke from the pointer that started it', () => {
    const onCreateAnnotation = vi.fn(() => 'annotation-pen');
    const onUpdateAnnotation = vi.fn();

    renderAnnotationLayer({
      activeTool: 'pen',
      onCreateAnnotation,
      onUpdateAnnotation,
    });

    const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

    fireEvent.pointerDown(annotationLayer, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(annotationLayer, {
      clientX: 120,
      clientY: 120,
      isPrimary: false,
      pointerId: 2,
    });

    expect(onUpdateAnnotation).not.toHaveBeenCalled();

    fireEvent.pointerMove(annotationLayer, {
      clientX: 20,
      clientY: 20,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onUpdateAnnotation).toHaveBeenCalledTimes(1);
    expect(onUpdateAnnotation).toHaveBeenCalledWith(
      'annotation-pen',
      expect.objectContaining({
        height: 10,
        width: 10,
        x: 10,
        y: 10,
      }),
    );
  });

  it('draws a freehand highlighter stroke anywhere on the page, not just over text', () => {
    const onCreateAnnotation = vi.fn(() => 'annotation-highlight');
    const onSelectAnnotation = vi.fn();
    const onUpdateAnnotation = vi.fn();

    renderAnnotationLayer({
      activeTool: 'highlight',
      annotationColor: '#ffe600',
      highlightBrushSize: 20,
      highlightOpacity: 0.55,
      onCreateAnnotation,
      onSelectAnnotation,
      onUpdateAnnotation,
    });

    const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

    fireEvent.pointerDown(annotationLayer, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        color: '#ffe600',
        opacity: 0.55,
        strokeWidth: 20,
        type: 'highlight',
      }),
    );
    expect(onSelectAnnotation).toHaveBeenLastCalledWith(null);

    fireEvent.pointerMove(annotationLayer, {
      clientX: 120,
      clientY: 120,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onUpdateAnnotation).toHaveBeenCalledWith(
      'annotation-highlight',
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({ x: 10, y: 10 }),
          expect.objectContaining({ x: 120, y: 120 }),
        ]),
      }),
    );
  });

  it('keeps a freehand highlighter stroke unfilled and free of selection chrome while drawing', () => {
    renderAnnotationLayer({
      activeTool: 'highlight',
      annotations: [highlightAnnotation],
      selectedAnnotationId: highlightAnnotation.id,
    });

    const hitTarget = document.querySelector('.annotation-pen-hit-target');
    const stroke = document.querySelector('.annotation-highlight-stroke');

    expect(hitTarget).not.toBeNull();
    expect(hitTarget?.classList.contains('annotation-highlight')).toBe(false);
    expect(hitTarget?.getAttribute('fill')).toBe('none');
    expect(hitTarget?.getAttribute('stroke')).toBe('transparent');
    expect(stroke?.getAttribute('fill')).toBe('none');
    expect(document.querySelector('.annotation-selection-box')).toBeNull();
  });

  it('keeps freehand highlight selection available from the Select tool', () => {
    renderAnnotationLayer({
      annotations: [highlightAnnotation],
      selectedAnnotationId: highlightAnnotation.id,
    });

    expect(document.querySelector('.annotation-selection-box')).not.toBeNull();
  });

  it('still draws when pointer capture is rejected by an embedded webview', () => {
    const onCreateAnnotation = vi.fn(() => 'annotation-highlight');
    const onUpdateAnnotation = vi.fn();

    Element.prototype.setPointerCapture = vi.fn(() => {
      throw new Error('Pointer capture is unavailable');
    });

    renderAnnotationLayer({
      activeTool: 'highlight',
      onCreateAnnotation,
      onUpdateAnnotation,
    });

    const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

    fireEvent.pointerDown(annotationLayer, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(annotationLayer, {
      clientX: 40,
      clientY: 24,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
    expect(onUpdateAnnotation).toHaveBeenCalledWith(
      'annotation-highlight',
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({ x: 10, y: 10 }),
          expect.objectContaining({ x: 40, y: 24 }),
        ]),
      }),
    );
  });

  it('pixel-erases intersected pen segments as one committed eraser action', () => {
    const onEraseAnnotationPixels = vi.fn();

    renderAnnotationLayer({
      activeTool: 'eraser',
      annotations: [penAnnotation],
      onEraseAnnotationPixels,
      selectedAnnotationId: penAnnotation.id,
    });

    const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

    fireEvent.pointerDown(annotationLayer, {
      button: 0,
      clientX: 30,
      clientY: 30,
      isPrimary: true,
      pointerId: 1,
    });

    expect(document.querySelectorAll('.annotation-pen-hit-target').length).toBeGreaterThan(0);
    expect(onEraseAnnotationPixels).not.toHaveBeenCalled();

    fireEvent.pointerUp(annotationLayer, {
      clientX: 30,
      clientY: 30,
      pointerId: 1,
    });

    expect(onEraseAnnotationPixels).toHaveBeenCalledTimes(1);
    expect(onEraseAnnotationPixels).toHaveBeenCalledWith([
      expect.objectContaining({
        originalAnnotation: penAnnotation,
        segments: expect.arrayContaining([expect.objectContaining({ points: expect.any(Array) })]),
      }),
    ]);
  });

  it('draws a pen stroke from cursor movement while Space is held', () => {
    const onCreateAnnotation = vi.fn(() => 'annotation-pen');
    const onUpdateAnnotation = vi.fn();

    renderAnnotationLayer({
      activeTool: 'pen',
      annotationStrokeWidth: 6,
      onCreateAnnotation,
      onUpdateAnnotation,
      spacebarFreehandEnabled: true,
    });

    const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

    fireEvent.pointerMove(annotationLayer, {
      clientX: 40,
      clientY: 44,
      pointerId: 1,
    });
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.pointerMove(annotationLayer, {
      clientX: 45,
      clientY: 49,
      pointerId: 1,
    });
    fireEvent.keyUp(window, { code: 'Space', key: ' ' });

    expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
    expect(onCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        pageItemId: 'page-1',
        points: [{ x: 40, y: 44 }],
        strokeWidth: 6,
        type: 'pen',
        x: 40,
        y: 44,
      }),
    );
    expect(onUpdateAnnotation).toHaveBeenCalledWith(
      'annotation-pen',
      expect.objectContaining({
        height: 5,
        points: [
          { x: 40, y: 44 },
          { x: 45, y: 49 },
        ],
        width: 5,
        x: 40,
        y: 44,
      }),
    );
  });

  it('uses the freehand sensitivity setting to control sampled point spacing', () => {
    const drawWithSensitivity = (freehandSensitivity: 'low' | 'high') => {
      const onCreateAnnotation = vi.fn(() => `annotation-${freehandSensitivity}`);
      const onUpdateAnnotation = vi.fn();
      const { unmount } = renderAnnotationLayer({
        activeTool: 'pen',
        freehandSensitivity,
        onCreateAnnotation,
        onUpdateAnnotation,
      });
      const annotationLayer = document.querySelector('.annotation-layer') as SVGSVGElement;

      fireEvent.pointerDown(annotationLayer, {
        button: 0,
        clientX: 10,
        clientY: 10,
        isPrimary: true,
        pointerId: 1,
      });
      fireEvent.pointerMove(annotationLayer, {
        clientX: 50,
        clientY: 10,
        isPrimary: true,
        pointerId: 1,
      });

      const patch = onUpdateAnnotation.mock.calls.at(-1)?.[1] as Partial<PdfAnnotation> | undefined;

      unmount();

      return patch?.points?.length ?? 0;
    };

    expect(drawWithSensitivity('high')).toBeGreaterThan(drawWithSensitivity('low'));
  });

  it('prevents Space from scrolling while Spacebar freehand is available', () => {
    renderAnnotationLayer({
      activeTool: 'pen',
      spacebarFreehandEnabled: true,
    });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
