import type { PdfAnnotation } from './types';

export const defaultPenStrokeWidth = 3;
export const minPenStrokeWidth = 1;
export const maxPenStrokeWidth = 12;
export const defaultEraserSize = 18;
export const minEraserSize = 6;
export const maxEraserSize = 64;
export const defaultHighlightBrushSize = 14;
export const minHighlightBrushSize = 6;
export const maxHighlightBrushSize = 32;
export const defaultHighlightOpacity = 0.42;
export const minHighlightOpacity = 0.15;
export const maxHighlightOpacity = 0.85;
export type FreehandSensitivity = 'low' | 'medium' | 'high';

export const defaultFreehandSensitivity: FreehandSensitivity = 'medium';

export const freehandSensitivityOptions: Array<{
  id: FreehandSensitivity;
  label: string;
}> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Normal' },
  { id: 'high', label: 'High' },
];

const freehandSensitivitySpacingCssPx: Record<FreehandSensitivity, number> = {
  low: 14,
  medium: 8,
  high: 4,
};

export function normalizePenStrokeWidth(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultPenStrokeWidth;
  }

  return Math.min(maxPenStrokeWidth, Math.max(minPenStrokeWidth, Math.round(value)));
}

export function normalizeEraserSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultEraserSize;
  }

  return Math.min(maxEraserSize, Math.max(minEraserSize, Math.round(value)));
}

export function normalizeHighlightBrushSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultHighlightBrushSize;
  }

  return Math.min(maxHighlightBrushSize, Math.max(minHighlightBrushSize, Math.round(value)));
}

export function normalizeHighlightOpacity(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultHighlightOpacity;
  }

  return Math.min(maxHighlightOpacity, Math.max(minHighlightOpacity, value));
}

export function getAnnotationStrokeWidth(
  annotation: Pick<PdfAnnotation, 'strokeWidth' | 'type'>,
): number {
  if (annotation.type === 'pen') {
    return normalizePenStrokeWidth(annotation.strokeWidth);
  }

  if (annotation.type === 'highlight') {
    return normalizeHighlightBrushSize(annotation.strokeWidth);
  }

  return defaultPenStrokeWidth;
}

export function getAnnotationOpacity(annotation: Pick<PdfAnnotation, 'opacity'>): number {
  return normalizeHighlightOpacity(annotation.opacity);
}

// A freehand highlighter stroke is a `highlight` annotation carrying a
// `points` path, same shape as a pen stroke. Legacy rect-shaped highlights
// (text-selection snaps, comment call-outs, older saved files) have no
// `points` and stay rect-rendered/exported instead. Single source of truth
// for this distinction — every render, interaction, export, and
// copy/paste code path should call this instead of re-deriving the check.
// Deliberately NOT a type predicate (`x is T`): callers pass both bare
// PdfAnnotation values and PdfAnnotation | undefined, and a predicate whose
// asserted type equals the argument's own static type collapses the
// negative branch to `never` at every bare-value call site.
export function isFreehandHighlightAnnotation(
  annotation: Pick<PdfAnnotation, 'points' | 'type'> | undefined,
): boolean {
  return Boolean(annotation && annotation.type === 'highlight' && annotation.points?.length);
}

export function isFreehandStrokeAnnotation(
  annotation: Pick<PdfAnnotation, 'points' | 'type'> | undefined,
): boolean {
  return (
    Boolean(annotation && annotation.type === 'pen') || isFreehandHighlightAnnotation(annotation)
  );
}

export function normalizeFreehandSensitivity(value: unknown): FreehandSensitivity {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : defaultFreehandSensitivity;
}

export function getFreehandSensitivitySpacingCssPx(sensitivity: FreehandSensitivity): number {
  return freehandSensitivitySpacingCssPx[normalizeFreehandSensitivity(sensitivity)];
}
