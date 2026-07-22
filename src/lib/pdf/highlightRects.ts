import type { PdfRenderedPageSize } from './pdfRenderer';
import type { PdfAnnotation } from './types';

export type HighlightRect = Pick<PdfAnnotation, 'height' | 'rotation' | 'width' | 'x' | 'y'>;

function clampRectToPage(rect: HighlightRect, pageSize: PdfRenderedPageSize): HighlightRect {
  const x = Math.min(Math.max(rect.x, 0), pageSize.width);
  const y = Math.min(Math.max(rect.y, 0), pageSize.height);

  return {
    x,
    y,
    width: Math.min(Math.max(rect.width, 0), pageSize.width - x),
    height: Math.min(Math.max(rect.height, 0), pageSize.height - y),
  };
}

function rectsIntersect(firstRect: HighlightRect, secondRect: HighlightRect): boolean {
  return (
    firstRect.x < secondRect.x + secondRect.width &&
    firstRect.x + firstRect.width > secondRect.x &&
    firstRect.y < secondRect.y + secondRect.height &&
    firstRect.y + firstRect.height > secondRect.y
  );
}

function getRectVerticalOverlap(firstRect: HighlightRect, secondRect: HighlightRect): number {
  return Math.max(
    0,
    Math.min(firstRect.y + firstRect.height, secondRect.y + secondRect.height) -
      Math.max(firstRect.y, secondRect.y),
  );
}

function getRectVerticalOverlapRatio(firstRect: HighlightRect, secondRect: HighlightRect): number {
  const overlap = getRectVerticalOverlap(firstRect, secondRect);
  const baselineHeight = Math.max(1, Math.min(firstRect.height, secondRect.height));

  return overlap / baselineHeight;
}

function subtractHighlightOverlapsFromRect({
  existingHighlights,
  pageSize,
  rect,
}: {
  existingHighlights: PdfAnnotation[];
  pageSize: PdfRenderedPageSize;
  rect: HighlightRect;
}): HighlightRect[] {
  const overlaps = existingHighlights
    .filter((highlight) => rectsIntersect(rect, highlight))
    .filter((highlight) => getRectVerticalOverlapRatio(rect, highlight) >= 0.45)
    .map((highlight) => ({
      left: Math.max(rect.x, highlight.x),
      right: Math.min(rect.x + rect.width, highlight.x + highlight.width),
    }))
    .filter((overlap) => overlap.right - overlap.left > 1)
    .sort((firstOverlap, secondOverlap) => firstOverlap.left - secondOverlap.left);

  if (overlaps.length === 0) {
    return [rect];
  }

  const mergedOverlaps: Array<{ left: number; right: number }> = [];

  for (const overlap of overlaps) {
    const previousOverlap = mergedOverlaps[mergedOverlaps.length - 1];

    if (previousOverlap && overlap.left <= previousOverlap.right + 1) {
      previousOverlap.right = Math.max(previousOverlap.right, overlap.right);
      continue;
    }

    mergedOverlaps.push({ ...overlap });
  }

  const remainingRects: HighlightRect[] = [];
  let nextLeft = rect.x;
  const rectRight = rect.x + rect.width;

  for (const overlap of mergedOverlaps) {
    if (overlap.left - nextLeft > 2) {
      remainingRects.push(
        clampRectToPage(
          {
            x: nextLeft,
            y: rect.y,
            width: overlap.left - nextLeft,
            height: rect.height,
          },
          pageSize,
        ),
      );
    }

    nextLeft = Math.max(nextLeft, overlap.right);
  }

  if (rectRight - nextLeft > 2) {
    remainingRects.push(
      clampRectToPage(
        {
          x: nextLeft,
          y: rect.y,
          width: rectRight - nextLeft,
          height: rect.height,
        },
        pageSize,
      ),
    );
  }

  return remainingRects.filter(
    (remainingRect) => remainingRect.width > 2 && remainingRect.height > 2,
  );
}

export function getNonLayeredHighlightRects({
  existingHighlights,
  pageSize,
  rects,
}: {
  existingHighlights: PdfAnnotation[];
  pageSize: PdfRenderedPageSize;
  rects: HighlightRect[];
}): HighlightRect[] {
  // The overlap subtraction is axis-aligned math: rotated rects pass through
  // unchanged and rotated existing highlights never act as subtractors.
  const straightExistingHighlights = existingHighlights.filter((highlight) => !highlight.rotation);

  return rects.flatMap((rect) =>
    rect.rotation
      ? [rect]
      : subtractHighlightOverlapsFromRect({
          existingHighlights: straightExistingHighlights,
          pageSize,
          rect: clampRectToPage(rect, pageSize),
        }),
  );
}
