export type CanvasSampleRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type RgbColor = { b: number; g: number; r: number };

function toHexChannel(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHexColor(color: RgbColor): string {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

export function getMedianColor(samples: RgbColor[]): RgbColor | null {
  if (samples.length === 0) {
    return null;
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((first, second) => first - second);

    return sorted[Math.floor(sorted.length / 2)];
  };

  return {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
}

// Sample points ringed just outside the rect: the pixels around replaced text
// are almost always the page background the patch needs to blend into.
export function getSamplePointsAroundRect(
  rect: CanvasSampleRect,
  offset: number,
): Array<{ x: number; y: number }> {
  const left = rect.x - offset;
  const right = rect.x + rect.width + offset;
  const top = rect.y - offset;
  const bottom = rect.y + rect.height + offset;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: left, y: centerY },
    { x: right, y: centerY },
    { x: left, y: bottom },
    { x: centerX, y: bottom },
    { x: right, y: bottom },
  ];
}

export function sampleCanvasBackgroundColor(
  canvas: HTMLCanvasElement,
  pageRect: CanvasSampleRect,
  pageSize: { height: number; width: number },
): string | null {
  if (canvas.width < 2 || canvas.height < 2 || pageSize.width <= 0 || pageSize.height <= 0) {
    return null;
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return null;
  }

  const scaleX = canvas.width / pageSize.width;
  const scaleY = canvas.height / pageSize.height;
  const canvasRect: CanvasSampleRect = {
    x: pageRect.x * scaleX,
    y: pageRect.y * scaleY,
    width: pageRect.width * scaleX,
    height: pageRect.height * scaleY,
  };
  const offset = Math.max(2, 3 * scaleX);
  const samples: RgbColor[] = [];

  try {
    for (const point of getSamplePointsAroundRect(canvasRect, offset)) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(point.x)));
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(point.y)));
      const pixel = context.getImageData(x, y, 1, 1).data;

      if (pixel[3] > 0) {
        samples.push({ r: pixel[0], g: pixel[1], b: pixel[2] });
      }
    }
  } catch {
    return null;
  }

  const median = getMedianColor(samples);

  return median ? rgbToHexColor(median) : null;
}
