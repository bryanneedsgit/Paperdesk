import type { PdfAnnotation, PdfAnnotationType } from './types';

export const defaultAnnotationColor = '#ffe600';
export const defaultTextAnnotationColor = '#000000';
export const transparentAnnotationColor = 'transparent';

export const annotationColorPalette = [
  '#ffe600',
  '#ff922b',
  '#f03e3e',
  '#cc5de8',
  '#5c7cfa',
  '#15aabf',
  '#2f9e44',
  '#1f2937',
] as const;

const hexColorPattern = /^#[0-9a-f]{6}$/i;

const defaultColorsByType: Record<PdfAnnotationType, string> = {
  'free-text': defaultTextAnnotationColor,
  highlight: defaultAnnotationColor,
  image: defaultAnnotationColor,
  pen: '#1f2937',
  rectangle: '#d9480f',
  signature: '#1f2937',
  'text-edit': defaultTextAnnotationColor,
  'text-note': defaultTextAnnotationColor,
};

const defaultFillColorsByType: Record<PdfAnnotationType, string> = {
  'free-text': '#ffffff',
  highlight: defaultAnnotationColor,
  image: transparentAnnotationColor,
  pen: transparentAnnotationColor,
  rectangle: transparentAnnotationColor,
  signature: transparentAnnotationColor,
  'text-edit': '#ffffff',
  'text-note': '#fff3bf',
};

const defaultBorderColorsByType: Record<PdfAnnotationType, string> = {
  'free-text': '#28666e',
  highlight: defaultAnnotationColor,
  image: transparentAnnotationColor,
  pen: transparentAnnotationColor,
  rectangle: '#d9480f',
  signature: transparentAnnotationColor,
  'text-edit': '#2f5f73',
  'text-note': '#d8a800',
};

export type RgbColor = {
  b: number;
  g: number;
  r: number;
};

export function normalizeAnnotationColor(
  value: string | undefined,
  fallback = defaultAnnotationColor,
): string {
  if (value && hexColorPattern.test(value)) {
    return value.toLowerCase();
  }

  return hexColorPattern.test(fallback) ? fallback.toLowerCase() : defaultAnnotationColor;
}

export function normalizeAnnotationPaintColor(value: string | undefined, fallback: string): string {
  if (value === transparentAnnotationColor) {
    return transparentAnnotationColor;
  }

  if (value && hexColorPattern.test(value)) {
    return value.toLowerCase();
  }

  if (fallback === transparentAnnotationColor) {
    return transparentAnnotationColor;
  }

  return normalizeAnnotationColor(fallback);
}

export function getDefaultAnnotationColor(type: PdfAnnotationType): string {
  return defaultColorsByType[type];
}

export function getDefaultAnnotationFillColor(type: PdfAnnotationType): string {
  return defaultFillColorsByType[type];
}

export function getDefaultAnnotationBorderColor(type: PdfAnnotationType): string {
  return defaultBorderColorsByType[type];
}

export function getAnnotationColor(annotation: Pick<PdfAnnotation, 'color' | 'type'>): string {
  return normalizeAnnotationColor(annotation.color, getDefaultAnnotationColor(annotation.type));
}

export function getAnnotationFillColor(
  annotation: Pick<PdfAnnotation, 'fillColor' | 'type'>,
): string {
  return normalizeAnnotationPaintColor(
    annotation.fillColor,
    getDefaultAnnotationFillColor(annotation.type),
  );
}

export function getAnnotationBorderColor(
  annotation: Pick<PdfAnnotation, 'borderColor' | 'type'>,
): string {
  return normalizeAnnotationPaintColor(
    annotation.borderColor,
    getDefaultAnnotationBorderColor(annotation.type),
  );
}

export function isTransparentAnnotationColor(color: string): boolean {
  return color === transparentAnnotationColor;
}

export function getAnnotationRgbColor(annotation: Pick<PdfAnnotation, 'color' | 'type'>): RgbColor {
  const color = getAnnotationColor(annotation);

  return getRgbColor(color);
}

export function getAnnotationRgbPaintColor(color: string): RgbColor | null {
  if (isTransparentAnnotationColor(color)) {
    return null;
  }

  return getRgbColor(color);
}

function getRgbColor(color: string): RgbColor {
  return {
    r: Number.parseInt(color.slice(1, 3), 16) / 255,
    g: Number.parseInt(color.slice(3, 5), 16) / 255,
    b: Number.parseInt(color.slice(5, 7), 16) / 255,
  };
}
