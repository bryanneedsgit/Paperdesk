import type { EmbeddedTextBox } from './embeddedText';

export type TextSelectionRect = {
  height: number;
  width: number;
  x: number;
  y: number;
  // Degrees, clockwise, about (x, y). Present when the rect follows rotated
  // embedded text; spreads straight into a highlight annotation's rotation.
  rotation?: number;
};

export type TextSelectionPoint = {
  x: number;
  y: number;
};

export type TextSelectionPageSize = {
  height: number;
  width: number;
};

export type TextSelectionItem = {
  fontFallback?: string;
  fontName?: string;
  fontSize?: number;
  // Axis-aligned bounding box of the selected run portion, used for line
  // grouping, reading order, and the tight bounding rect.
  rect: TextSelectionRect;
  // Pre-built rotated output rect for runs of rotated text. When present it
  // bypasses axis-aligned line merging and is emitted as-is.
  highlightRect?: TextSelectionRect;
  text: string;
};

type TextSelectionLine = {
  bottom: number;
  centerY: number;
  items: TextSelectionItem[];
  top: number;
};

export type SelectionFontInfo = {
  fallback?: string;
  name?: string;
  size: number;
};

export type EmbeddedTextSelectionResult = {
  font: SelectionFontInfo | null;
  lineCount: number;
  rects: TextSelectionRect[];
  selectedBoxCount: number;
  text: string;
  tightRect: TextSelectionRect | null;
};

export const emptyEmbeddedTextSelection: EmbeddedTextSelectionResult = {
  font: null,
  lineCount: 0,
  rects: [],
  selectedBoxCount: 0,
  text: '',
  tightRect: null,
};

export function getDominantSelectionFont(items: TextSelectionItem[]): SelectionFontInfo | null {
  const weights = new Map<
    string,
    { fallback?: string; name?: string; size: number; weight: number }
  >();

  for (const item of items) {
    if (typeof item.fontSize !== 'number' || item.fontSize <= 0) {
      continue;
    }

    const weight = Math.max(1, item.text.trim().length);
    const key = `${item.fontName ?? ''}@${Math.round(item.fontSize * 10)}`;
    const entry = weights.get(key);

    if (entry) {
      entry.weight += weight;
    } else {
      weights.set(key, {
        fallback: item.fontFallback,
        name: item.fontName,
        size: item.fontSize,
        weight,
      });
    }
  }

  let dominant: { fallback?: string; name?: string; size: number; weight: number } | null = null;

  for (const entry of weights.values()) {
    if (!dominant || entry.weight > dominant.weight) {
      dominant = entry;
    }
  }

  return dominant
    ? { fallback: dominant.fallback, name: dominant.name, size: dominant.size }
    : null;
}

const minimumTextSelectionDistance = 3;

export function clampRectToPage(
  rect: TextSelectionRect,
  pageSize: TextSelectionPageSize,
): TextSelectionRect {
  const x = Math.min(Math.max(rect.x, 0), pageSize.width);
  const y = Math.min(Math.max(rect.y, 0), pageSize.height);

  return {
    x,
    y,
    width: Math.min(Math.max(rect.width, 0), pageSize.width - x),
    height: Math.min(Math.max(rect.height, 0), pageSize.height - y),
  };
}

export function clampPointToPage(
  point: TextSelectionPoint,
  pageSize: TextSelectionPageSize,
): TextSelectionPoint {
  return {
    x: Math.min(Math.max(point.x, 0), pageSize.width),
    y: Math.min(Math.max(point.y, 0), pageSize.height),
  };
}

export function getSelectionArea(
  startPoint: TextSelectionPoint,
  currentPoint: TextSelectionPoint,
  pageSize: TextSelectionPageSize,
): TextSelectionRect | null {
  const left = Math.min(startPoint.x, currentPoint.x);
  const top = Math.min(startPoint.y, currentPoint.y);
  const width = Math.abs(currentPoint.x - startPoint.x);
  const height = Math.abs(currentPoint.y - startPoint.y);

  if (width < minimumTextSelectionDistance && height < minimumTextSelectionDistance) {
    return null;
  }

  return clampRectToPage({ x: left, y: top, width, height }, pageSize);
}

export function mergeSelectionRects(
  rects: TextSelectionRect[],
  pageSize: TextSelectionPageSize,
): TextSelectionRect | null {
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));

  return clampRectToPage(
    {
      x: Math.max(0, left - 3),
      y: Math.max(0, top - 5),
      width: Math.min(pageSize.width, right - left + 8),
      height: Math.max(24, Math.min(pageSize.height, bottom - top + 12)),
    },
    pageSize,
  );
}

export function getCommentRectFromSelection(
  rects: TextSelectionRect[],
  pageSize: TextSelectionPageSize,
): TextSelectionRect | null {
  const selectionRect = mergeSelectionRects(rects, pageSize);

  if (!selectionRect) {
    return null;
  }

  const width = Math.min(190, Math.max(124, pageSize.width - 24));
  const height = Math.min(84, Math.max(58, pageSize.height - 24));
  const preferredX = selectionRect.x + selectionRect.width + 12;
  const x =
    preferredX + width <= pageSize.width
      ? preferredX
      : Math.min(Math.max(selectionRect.x, 0), Math.max(0, pageSize.width - width));
  const y = Math.min(Math.max(selectionRect.y, 0), Math.max(0, pageSize.height - height));

  return clampRectToPage(
    {
      x,
      y,
      width,
      height,
    },
    pageSize,
  );
}

function rectsIntersect(firstRect: TextSelectionRect, secondRect: TextSelectionRect): boolean {
  return (
    firstRect.x < secondRect.x + secondRect.width &&
    firstRect.x + firstRect.width > secondRect.x &&
    firstRect.y < secondRect.y + secondRect.height &&
    firstRect.y + firstRect.height > secondRect.y
  );
}

function rectCenterY(rect: TextSelectionRect): number {
  return rect.y + rect.height / 2;
}

function createTextSelectionLines(items: TextSelectionItem[]): TextSelectionLine[] {
  const lines: TextSelectionLine[] = [];
  const sortedItems = [...items].sort((firstItem, secondItem) => {
    const verticalDelta = rectCenterY(firstItem.rect) - rectCenterY(secondItem.rect);

    return Math.abs(verticalDelta) > 3 ? verticalDelta : firstItem.rect.x - secondItem.rect.x;
  });

  for (const item of sortedItems) {
    const itemCenterY = rectCenterY(item.rect);
    const line = lines.find((candidateLine) => {
      const lineHeight = Math.max(1, candidateLine.bottom - candidateLine.top);
      const itemHeight = Math.max(1, item.rect.height);
      const tolerance = Math.max(3, Math.min(lineHeight, itemHeight) * 0.7);
      // Superscripts, mixed font sizes, and jittery PDF baselines shift item
      // centers apart even on one visual line, so substantial vertical
      // overlap also counts as the same line.
      const verticalOverlap =
        Math.min(candidateLine.bottom, item.rect.y + item.rect.height) -
        Math.max(candidateLine.top, item.rect.y);
      const overlapRatio = verticalOverlap / Math.min(lineHeight, itemHeight);

      return overlapRatio >= 0.5 || Math.abs(candidateLine.centerY - itemCenterY) <= tolerance;
    });

    if (line) {
      line.items.push(item);
      line.top = Math.min(line.top, item.rect.y);
      line.bottom = Math.max(line.bottom, item.rect.y + item.rect.height);
      line.centerY = (line.top + line.bottom) / 2;
      continue;
    }

    lines.push({
      bottom: item.rect.y + item.rect.height,
      centerY: itemCenterY,
      items: [item],
      top: item.rect.y,
    });
  }

  return lines.sort((firstLine, secondLine) => firstLine.centerY - secondLine.centerY);
}

export function mergeSelectionItemsByLine(
  items: TextSelectionItem[],
  pageSize: TextSelectionPageSize,
): TextSelectionRect[] {
  return createTextSelectionLines(items).map((line) => {
    const lineItems = line.items;
    const left = Math.min(...lineItems.map((item) => item.rect.x));
    const top = Math.min(...lineItems.map((item) => item.rect.y));
    const right = Math.max(...lineItems.map((item) => item.rect.x + item.rect.width));
    const bottom = Math.max(...lineItems.map((item) => item.rect.y + item.rect.height));

    return clampRectToPage(
      {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      },
      pageSize,
    );
  });
}

function shouldInsertSpaceBetweenTextItems(
  previousItem: TextSelectionItem,
  currentItem: TextSelectionItem,
): boolean {
  const gap = currentItem.rect.x - (previousItem.rect.x + previousItem.rect.width);
  const previousTextLength = previousItem.text.replace(/\s+/g, '').length;
  const previousCharacterWidth =
    previousTextLength > 0 ? previousItem.rect.width / previousTextLength : previousItem.rect.width;

  return (
    gap > Math.max(2, previousCharacterWidth * 0.45) &&
    !/\s$/.test(previousItem.text) &&
    !/^[\s,.;:!?)]/.test(currentItem.text)
  );
}

const ligatureExpansions: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'ft',
  ﬆ: 'st',
};

// PDF text extraction emits codepoints that garble once shown in a regular
// UI font: ligature presentation forms, exotic spaces, zero-width marks, and
// Private Use Area charcodes from fonts without a usable Unicode mapping.
export function normalizeExtractedPdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\uFB00-\uFB06]/g, (ligature) => ligatureExpansions[ligature] ?? ligature)
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\p{Cc}/gu, (control) => (control === '\n' || control === '\t' ? control : ''));
}

export function createSelectedText(items: TextSelectionItem[]): string {
  return createTextSelectionLines(items)
    .map((line) => {
      const lineItems = [...line.items].sort(
        (firstItem, secondItem) => firstItem.rect.x - secondItem.rect.x,
      );
      let lineText = '';

      lineItems.forEach((item, itemIndex) => {
        const text = normalizeExtractedPdfText(item.text).replace(/\s+/g, ' ');

        if (!text.trim()) {
          return;
        }

        const previousItem = lineItems[itemIndex - 1];

        if (previousItem && shouldInsertSpaceBetweenTextItems(previousItem, item)) {
          lineText += ' ';
        }

        lineText += text;
      });

      return lineText.trim();
    })
    .filter(Boolean)
    .join('\n');
}

function getPageLocalRectFromTextBox(box: EmbeddedTextBox, scale: number): TextSelectionRect {
  const cssScale = scale > 0 ? scale : 1;

  return {
    x: box.rect.x / cssScale,
    y: box.rect.y / cssScale,
    width: box.rect.width / cssScale,
    height: box.rect.height / cssScale,
  };
}

const significantRotationRadians = 0.005;

function getPageLocalRunRect(box: EmbeddedTextBox, scale: number): TextSelectionRect | null {
  if (!box.localRect) {
    return null;
  }

  const cssScale = scale > 0 ? scale : 1;

  return {
    x: box.localRect.x / cssScale,
    y: box.localRect.y / cssScale,
    width: box.localRect.width / cssScale,
    height: box.localRect.height / cssScale,
  };
}

// Rotates clockwise in display space (y grows downward) about the origin.
function rotatePointAround(
  point: TextSelectionPoint,
  origin: TextSelectionPoint,
  angle: number,
): TextSelectionPoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const deltaX = point.x - origin.x;
  const deltaY = point.y - origin.y;

  return {
    x: origin.x + deltaX * cos - deltaY * sin,
    y: origin.y + deltaY * cos + deltaX * sin,
  };
}

function getRectCorners(rect: TextSelectionRect): TextSelectionPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function getBoundingRectOfPoints(points: TextSelectionPoint[]): TextSelectionRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

// Clips a rotated run against the drag area by unrotating the area into the
// run's own frame, clipping there like straight text, then emitting a rect
// that carries the run's rotation so the highlight hugs the rotated glyphs.
function clipRotatedSelectionItem({
  angle,
  area,
  box,
  pageSize,
  runRect,
}: {
  angle: number;
  area: TextSelectionRect;
  box: EmbeddedTextBox;
  pageSize: TextSelectionPageSize;
  runRect: TextSelectionRect;
}): TextSelectionItem | null {
  const origin = { x: runRect.x, y: runRect.y };
  const localArea = getBoundingRectOfPoints(
    getRectCorners(area).map((corner) => rotatePointAround(corner, origin, -angle)),
  );

  if (!rectsIntersect(localArea, runRect)) {
    return null;
  }

  const clipped = clipSelectionItemToArea(
    {
      fontFallback: box.fontFallback,
      fontName: box.fontName,
      fontSize: box.fontSize,
      rect: runRect,
      text: box.text,
    },
    localArea,
  );

  if (!clipped) {
    return null;
  }

  const rotatedCorners = getRectCorners(clipped.rect).map((corner) =>
    rotatePointAround(corner, origin, angle),
  );
  const topLeft = rotatedCorners[0];

  return {
    ...clipped,
    rect: clampRectToPage(getBoundingRectOfPoints(rotatedCorners), pageSize),
    highlightRect: {
      x: topLeft.x,
      y: topLeft.y,
      width: clipped.rect.width,
      height: clipped.rect.height,
      rotation: (angle * 180) / Math.PI,
    },
  };
}

// PDF text items frequently span a whole line, so intersecting boxes must be
// clipped to the dragged area or any selection snaps to full lines. Glyph
// positions are approximated by dividing the item width evenly across its
// characters; a character is selected when its center falls inside the area.
function clipSelectionItemToArea(
  item: TextSelectionItem,
  area: TextSelectionRect,
): TextSelectionItem | null {
  const coverageEpsilon = 0.01;
  const itemRight = item.rect.x + item.rect.width;
  const areaRight = area.x + area.width;

  if (area.x <= item.rect.x + coverageEpsilon && areaRight >= itemRight - coverageEpsilon) {
    return item;
  }

  const characterCount = item.text.length;

  if (characterCount === 0) {
    return null;
  }

  const characterWidth = item.rect.width / characterCount;
  let startIndex = characterCount;
  let endIndex = 0;

  for (let index = 0; index < characterCount; index += 1) {
    const characterCenterX = item.rect.x + (index + 0.5) * characterWidth;

    if (characterCenterX >= area.x && characterCenterX <= areaRight) {
      startIndex = Math.min(startIndex, index);
      endIndex = Math.max(endIndex, index + 1);
    }
  }

  if (endIndex <= startIndex) {
    return null;
  }

  const text = item.text.slice(startIndex, endIndex);

  if (!text.trim()) {
    return null;
  }

  return {
    ...item,
    rect: {
      x: item.rect.x + startIndex * characterWidth,
      y: item.rect.y,
      width: (endIndex - startIndex) * characterWidth,
      height: item.rect.height,
    },
    text,
  };
}

export function createEmbeddedTextSelectionFromItems(
  selectedItems: TextSelectionItem[],
  pageSize: TextSelectionPageSize,
): EmbeddedTextSelectionResult {
  // Rotated runs keep their own rotation-carrying rect; merging them into
  // axis-aligned line rects would smear a diagonal run into a huge box.
  const straightItems = selectedItems.filter((item) => !item.highlightRect);
  const rotatedItems = selectedItems.filter((item) => item.highlightRect);
  const rects = [
    ...mergeSelectionItemsByLine(straightItems, pageSize),
    ...rotatedItems.map((item) => item.highlightRect as TextSelectionRect),
  ];

  return {
    font: getDominantSelectionFont(selectedItems),
    lineCount: rects.length,
    rects,
    selectedBoxCount: selectedItems.length,
    text: createSelectedText(selectedItems),
    tightRect: getTightBoundingRect(selectedItems.map((item) => item.rect)),
  };
}

function getTightBoundingRect(rects: TextSelectionRect[]): TextSelectionRect | null {
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectEmbeddedTextBoxes({
  area,
  boxes,
  pageSize,
  scale,
}: {
  area: TextSelectionRect | null;
  boxes: EmbeddedTextBox[];
  pageSize: TextSelectionPageSize;
  scale: number;
}): EmbeddedTextSelectionResult {
  if (!area) {
    return emptyEmbeddedTextSelection;
  }

  const selectedItems = boxes
    .map((box): TextSelectionItem | null => {
      const rect = clampRectToPage(getPageLocalRectFromTextBox(box, scale), pageSize);

      if (!rectsIntersect(area, rect)) {
        return null;
      }

      const angle = box.angle ?? 0;
      const runRect = getPageLocalRunRect(box, scale);

      if (Math.abs(angle) >= significantRotationRadians && runRect) {
        return clipRotatedSelectionItem({ angle, area, box, pageSize, runRect });
      }

      return clipSelectionItemToArea(
        {
          fontFallback: box.fontFallback,
          fontName: box.fontName,
          fontSize: box.fontSize,
          rect,
          text: box.text,
        },
        area,
      );
    })
    .filter((item): item is TextSelectionItem => Boolean(item));

  return createEmbeddedTextSelectionFromItems(selectedItems, pageSize);
}

type WordHit = {
  angle: number;
  box: EmbeddedTextBox;
  localPoint: TextSelectionPoint;
  runRect: TextSelectionRect;
};

export function selectWordAtEmbeddedTextPoint({
  boxes,
  pageSize,
  point,
  scale,
}: {
  boxes: EmbeddedTextBox[];
  pageSize: TextSelectionPageSize;
  point: TextSelectionPoint;
  scale: number;
}): EmbeddedTextSelectionResult {
  let bestHit: WordHit | null = null;

  for (const box of boxes) {
    const angle = box.angle ?? 0;
    const isRotated = Math.abs(angle) >= significantRotationRadians;
    const runRect =
      getPageLocalRunRect(box, scale) ??
      clampRectToPage(getPageLocalRectFromTextBox(box, scale), pageSize);
    // The run rect is axis-aligned in its own frame, so containment is
    // checked with the point unrotated into that frame.
    const localPoint = isRotated
      ? rotatePointAround(point, { x: runRect.x, y: runRect.y }, -angle)
      : point;
    const containsPoint =
      localPoint.x >= runRect.x &&
      localPoint.x <= runRect.x + runRect.width &&
      localPoint.y >= runRect.y &&
      localPoint.y <= runRect.y + runRect.height;

    if (!containsPoint) {
      continue;
    }

    if (
      !bestHit ||
      runRect.width * runRect.height < bestHit.runRect.width * bestHit.runRect.height
    ) {
      bestHit = { angle: isRotated ? angle : 0, box, localPoint, runRect };
    }
  }

  if (!bestHit || bestHit.box.text.length === 0) {
    return emptyEmbeddedTextSelection;
  }

  const { angle, box, localPoint, runRect } = bestHit;
  const text = box.text;
  const characterWidth = runRect.width / text.length;
  const pointedIndex = Math.min(
    text.length - 1,
    Math.max(0, Math.floor((localPoint.x - runRect.x) / Math.max(0.0001, characterWidth))),
  );

  if (/\s/.test(text[pointedIndex])) {
    return emptyEmbeddedTextSelection;
  }

  let startIndex = pointedIndex;
  let endIndex = pointedIndex + 1;

  while (startIndex > 0 && !/\s/.test(text[startIndex - 1])) {
    startIndex -= 1;
  }

  while (endIndex < text.length && !/\s/.test(text[endIndex])) {
    endIndex += 1;
  }

  const localWordRect: TextSelectionRect = {
    x: runRect.x + startIndex * characterWidth,
    y: runRect.y,
    width: (endIndex - startIndex) * characterWidth,
    height: runRect.height,
  };
  const wordItem: TextSelectionItem = {
    fontFallback: box.fontFallback,
    fontName: box.fontName,
    fontSize: box.fontSize,
    rect: clampRectToPage(localWordRect, pageSize),
    text: text.slice(startIndex, endIndex),
  };

  if (angle !== 0) {
    const origin = { x: runRect.x, y: runRect.y };
    const rotatedCorners = getRectCorners(localWordRect).map((corner) =>
      rotatePointAround(corner, origin, angle),
    );

    wordItem.rect = clampRectToPage(getBoundingRectOfPoints(rotatedCorners), pageSize);
    wordItem.highlightRect = {
      x: rotatedCorners[0].x,
      y: rotatedCorners[0].y,
      width: localWordRect.width,
      height: localWordRect.height,
      rotation: (angle * 180) / Math.PI,
    };
  }

  return createEmbeddedTextSelectionFromItems([wordItem], pageSize);
}
