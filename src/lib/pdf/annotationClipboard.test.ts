import { describe, expect, it } from 'vitest';

import type { PdfAnnotation } from './types';
import { cloneFreehandAnnotationsForPaste } from './annotationClipboard';

const copiedAnnotation: PdfAnnotation = {
  color: '#111111',
  createdAt: '2026-07-07T10:00:00.000Z',
  height: 20,
  id: 'annotation-source',
  pageItemId: 'page-1',
  points: [
    { x: 20, y: 30 },
    { x: 60, y: 50 },
  ],
  strokeWidth: 3,
  type: 'pen',
  width: 40,
  x: 20,
  y: 30,
};

describe('cloneFreehandAnnotationsForPaste', () => {
  it('centers copied freehand annotations over the cursor target', () => {
    const [pastedAnnotation] = cloneFreehandAnnotationsForPaste({
      annotations: [copiedAnnotation],
      createAnnotationId: () => 'annotation-paste',
      createdAt: '2026-07-07T10:01:00.000Z',
      fallbackOffset: 14,
      fallbackPageItemId: 'page-1',
      target: {
        pageItemId: 'page-2',
        point: { x: 120, y: 140 },
      },
    });

    expect(pastedAnnotation).toMatchObject({
      createdAt: '2026-07-07T10:01:00.000Z',
      id: 'annotation-paste',
      pageItemId: 'page-2',
      x: 100,
      y: 130,
    });
    expect(pastedAnnotation.points).toEqual([
      { x: 100, y: 130 },
      { x: 140, y: 150 },
    ]);
  });

  it('uses the existing offset fallback when no cursor target is available', () => {
    const [pastedAnnotation] = cloneFreehandAnnotationsForPaste({
      annotations: [copiedAnnotation],
      createAnnotationId: () => 'annotation-paste',
      createdAt: '2026-07-07T10:01:00.000Z',
      fallbackOffset: 14,
      fallbackPageItemId: 'page-3',
      target: null,
    });

    expect(pastedAnnotation).toMatchObject({
      pageItemId: 'page-3',
      x: 34,
      y: 44,
    });
    expect(pastedAnnotation.points).toEqual([
      { x: 34, y: 44 },
      { x: 74, y: 64 },
    ]);
  });

  it('copies freehand highlighter strokes the same as pen strokes', () => {
    const highlightAnnotation: PdfAnnotation = {
      ...copiedAnnotation,
      id: 'annotation-highlight-source',
      opacity: 0.42,
      type: 'highlight',
    };

    const [pastedAnnotation] = cloneFreehandAnnotationsForPaste({
      annotations: [highlightAnnotation],
      createAnnotationId: () => 'annotation-paste',
      createdAt: '2026-07-07T10:01:00.000Z',
      fallbackOffset: 14,
      fallbackPageItemId: 'page-1',
      target: {
        pageItemId: 'page-2',
        point: { x: 120, y: 140 },
      },
    });

    expect(pastedAnnotation).toMatchObject({
      id: 'annotation-paste',
      opacity: 0.42,
      pageItemId: 'page-2',
      type: 'highlight',
      x: 100,
      y: 130,
    });
    expect(pastedAnnotation.points).toEqual([
      { x: 100, y: 130 },
      { x: 140, y: 150 },
    ]);
  });

  it('excludes rect-shaped highlights (no points) from freehand copy/paste', () => {
    const rectHighlight: PdfAnnotation = {
      color: '#ffe600',
      createdAt: '2026-07-07T10:00:00.000Z',
      height: 14,
      id: 'annotation-rect-highlight',
      pageItemId: 'page-1',
      type: 'highlight',
      width: 80,
      x: 20,
      y: 30,
    };

    const pastedAnnotations = cloneFreehandAnnotationsForPaste({
      annotations: [rectHighlight],
      createAnnotationId: () => 'annotation-paste',
      createdAt: '2026-07-07T10:01:00.000Z',
      fallbackOffset: 14,
      fallbackPageItemId: 'page-1',
      target: null,
    });

    expect(pastedAnnotations).toEqual([]);
  });
});
