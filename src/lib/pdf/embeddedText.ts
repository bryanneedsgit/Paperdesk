export type EmbeddedTextRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type EmbeddedTextBox = {
  // Rotation of the text run in display space: radians, clockwise, about the
  // top-left corner of localRect. Zero for ordinary horizontal text.
  angle?: number;
  dir: string;
  fontFallback?: string;
  fontName?: string;
  fontSize?: number;
  hasEOL?: boolean;
  id: string;
  index: number;
  // Axis-aligned bounding box of the (possibly rotated) run, clamped to the
  // page. Cheap intersection tests and line grouping use this.
  rect: EmbeddedTextRect;
  // The unrotated run rect: place at (x, y), then rotate by angle about that
  // corner to reach the glyphs' true footprint. Equals rect when angle is 0.
  localRect?: EmbeddedTextRect;
  text: string;
};

export type EmbeddedTextViewport = {
  height: number;
  scale: number;
  transform: number[];
  width: number;
};

export type EmbeddedTextItem = {
  dir?: string;
  fontName: string;
  hasEOL?: boolean;
  height: number;
  str: string;
  transform: number[];
  width: number;
};

export type EmbeddedTextStyle = {
  ascent?: number;
  descent?: number;
  fontFamily?: string;
  vertical?: boolean;
};

type TextBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function transformMatrix(firstMatrix: number[], secondMatrix: number[]): number[] {
  return [
    firstMatrix[0] * secondMatrix[0] + firstMatrix[2] * secondMatrix[1],
    firstMatrix[1] * secondMatrix[0] + firstMatrix[3] * secondMatrix[1],
    firstMatrix[0] * secondMatrix[2] + firstMatrix[2] * secondMatrix[3],
    firstMatrix[1] * secondMatrix[2] + firstMatrix[3] * secondMatrix[3],
    firstMatrix[0] * secondMatrix[4] + firstMatrix[2] * secondMatrix[5] + firstMatrix[4],
    firstMatrix[1] * secondMatrix[4] + firstMatrix[3] * secondMatrix[5] + firstMatrix[5],
  ];
}

function isEmbeddedTextItem(item: unknown): item is EmbeddedTextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof item.str === 'string' &&
    'transform' in item &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    'width' in item &&
    typeof item.width === 'number' &&
    'height' in item &&
    typeof item.height === 'number' &&
    'fontName' in item &&
    typeof item.fontName === 'string'
  );
}

function getTextStyleAscent(style: EmbeddedTextStyle | undefined): number {
  if (typeof style?.ascent === 'number') {
    return style.ascent;
  }

  if (typeof style?.descent === 'number') {
    return 1 + style.descent;
  }

  return 0.8;
}

function getTextBounds({
  angle,
  height,
  left,
  top,
  width,
}: {
  angle: number;
  height: number;
  left: number;
  top: number;
  width: number;
}): TextBounds {
  if (Math.abs(angle) < 0.0001) {
    return {
      height,
      left,
      top,
      width,
    };
  }

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((point) => ({
    x: left + point.x * cos - point.y * sin,
    y: top + point.x * sin + point.y * cos,
  }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    height: maxY - minY,
    left: minX,
    top: minY,
    width: maxX - minX,
  };
}

export function getEmbeddedTextBoxFromItem({
  index,
  item,
  style,
  viewport,
}: {
  index: number;
  item: EmbeddedTextItem;
  style: EmbeddedTextStyle | undefined;
  viewport: EmbeddedTextViewport;
}): EmbeddedTextBox | null {
  if (!item.str.trim()) {
    return null;
  }

  const transformed = transformMatrix(viewport.transform, item.transform);
  let angle = Math.atan2(transformed[1], transformed[0]);

  if (style?.vertical) {
    angle += Math.PI / 2;
  }

  const fontHeight = Math.max(1, Math.hypot(transformed[2], transformed[3]));
  const fontAscent = fontHeight * getTextStyleAscent(style);
  const left =
    Math.abs(angle) < 0.0001 ? transformed[4] : transformed[4] + fontAscent * Math.sin(angle);
  const top =
    Math.abs(angle) < 0.0001
      ? transformed[5] - fontAscent
      : transformed[5] - fontAscent * Math.cos(angle);
  const width = Math.max(1, (style?.vertical ? item.height : item.width) * viewport.scale);
  const height = fontHeight;
  const bounds = getTextBounds({
    angle,
    height,
    left,
    top,
    width,
  });
  const pageWidth = Math.max(1, viewport.width);
  const pageHeight = Math.max(1, viewport.height);
  const clampedLeft = Math.min(Math.max(bounds.left, 0), pageWidth);
  const clampedTop = Math.min(Math.max(bounds.top, 0), pageHeight);
  const clampedWidth = Math.min(Math.max(bounds.width, 1), pageWidth - clampedLeft);
  const clampedHeight = Math.min(Math.max(bounds.height, 1), pageHeight - clampedTop);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return {
    angle,
    dir: item.dir ?? 'ltr',
    fontFallback: style?.fontFamily,
    fontName: item.fontName,
    fontSize: fontHeight / Math.max(0.0001, viewport.scale),
    hasEOL: item.hasEOL,
    id: `text-box-${index}`,
    index,
    rect: {
      height: clampedHeight,
      width: clampedWidth,
      x: clampedLeft,
      y: clampedTop,
    },
    localRect: {
      height,
      width,
      x: left,
      y: top,
    },
    text: item.str,
  };
}

export function createEmbeddedTextBoxes({
  items,
  styles,
  viewport,
}: {
  items: unknown[];
  styles: Record<string, EmbeddedTextStyle>;
  viewport: EmbeddedTextViewport;
}): EmbeddedTextBox[] {
  return items
    .map((item, index) => {
      if (!isEmbeddedTextItem(item)) {
        return null;
      }

      return getEmbeddedTextBoxFromItem({
        index,
        item,
        style: styles[item.fontName],
        viewport,
      });
    })
    .filter((box): box is EmbeddedTextBox => Boolean(box));
}
