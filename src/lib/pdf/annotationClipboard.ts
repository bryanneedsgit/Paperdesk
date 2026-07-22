import { isFreehandStrokeAnnotation } from './annotationStroke';
import type {
  PdfAnnotation,
  PdfAnnotationPasteTarget,
  PdfAnnotationPoint,
  PdfPageId,
} from './types';

type AnnotationBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type CloneFreehandAnnotationsForPasteOptions = {
  annotations: PdfAnnotation[];
  createAnnotationId: () => string;
  createdAt: string;
  fallbackOffset: number;
  fallbackPageItemId: PdfPageId;
  target: PdfAnnotationPasteTarget | null;
};

function getAnnotationBounds(annotation: PdfAnnotation): AnnotationBounds {
  const points = annotation.points ?? [];

  if (points.length === 0) {
    return {
      height: annotation.height,
      width: annotation.width,
      x: annotation.x,
      y: annotation.y,
    };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  };
}

function getGroupBounds(annotations: PdfAnnotation[]): AnnotationBounds {
  const bounds = annotations.map(getAnnotationBounds);
  const minX = Math.min(...bounds.map((annotationBounds) => annotationBounds.x));
  const minY = Math.min(...bounds.map((annotationBounds) => annotationBounds.y));
  const maxX = Math.max(
    ...bounds.map((annotationBounds) => annotationBounds.x + annotationBounds.width),
  );
  const maxY = Math.max(
    ...bounds.map((annotationBounds) => annotationBounds.y + annotationBounds.height),
  );

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function translatePoint(point: PdfAnnotationPoint, deltaX: number, deltaY: number) {
  return {
    x: point.x + deltaX,
    y: point.y + deltaY,
  };
}

export function cloneFreehandAnnotationsForPaste({
  annotations,
  createAnnotationId,
  createdAt,
  fallbackOffset,
  fallbackPageItemId,
  target,
}: CloneFreehandAnnotationsForPasteOptions): PdfAnnotation[] {
  const freehandAnnotations = annotations.filter(isFreehandStrokeAnnotation);

  if (freehandAnnotations.length === 0) {
    return [];
  }

  const groupBounds = getGroupBounds(freehandAnnotations);
  const groupCenter = {
    x: groupBounds.x + groupBounds.width / 2,
    y: groupBounds.y + groupBounds.height / 2,
  };
  const delta = target
    ? {
        x: target.point.x - groupCenter.x,
        y: target.point.y - groupCenter.y,
      }
    : {
        x: fallbackOffset,
        y: fallbackOffset,
      };
  const pageItemId = target?.pageItemId ?? fallbackPageItemId;

  return freehandAnnotations.map((annotation) => ({
    ...annotation,
    id: createAnnotationId(),
    pageItemId,
    createdAt,
    x: annotation.x + delta.x,
    y: annotation.y + delta.y,
    points: annotation.points?.map((point) => translatePoint(point, delta.x, delta.y)),
  }));
}
