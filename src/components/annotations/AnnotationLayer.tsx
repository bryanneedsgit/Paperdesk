import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  PdfAnnotation,
  PdfAnnotationEraseReplacement,
  PdfAnnotationEraseSegment,
  PdfAnnotationId,
  PdfAnnotationPoint,
  PdfAnnotationTool,
  PdfPageItem,
} from '../../lib/pdf/types';
import {
  getAnnotationBorderColor,
  getAnnotationColor,
  getAnnotationFillColor,
  isTransparentAnnotationColor,
} from '../../lib/pdf/annotationColors';
import {
  defaultAnnotationFontId,
  defaultAnnotationFontSize,
  getAnnotationFontCssFamily,
} from '../../lib/pdf/annotationFonts';
import {
  getAnnotationOpacity,
  getAnnotationStrokeWidth,
  getFreehandSensitivitySpacingCssPx,
  isFreehandHighlightAnnotation,
  isFreehandStrokeAnnotation,
  type FreehandSensitivity,
} from '../../lib/pdf/annotationStroke';
import type { PdfRenderedPageSize } from '../../lib/pdf/pdfRenderer';

type SignatureImage = {
  bytes: number[];
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
};

type AnnotationLayerProps = {
  activeTool: PdfAnnotationTool;
  annotationBorderColor: string;
  annotationColor: string;
  annotationFillColor: string;
  annotationStrokeWidth: number;
  annotations: PdfAnnotation[];
  eraserSize: number;
  freehandSensitivity: FreehandSensitivity;
  highlightBrushSize: number;
  highlightOpacity: number;
  isAnnotating: boolean;
  onCommitAnnotationChange: (
    previousAnnotation: PdfAnnotation,
    nextAnnotation: PdfAnnotation,
  ) => void;
  onCreateAnnotation: (annotation: Omit<PdfAnnotation, 'createdAt' | 'id'>) => PdfAnnotationId;
  onEraseAnnotationPixels: (replacements: PdfAnnotationEraseReplacement[]) => void;
  onSelectAnnotation: (annotationId: PdfAnnotationId | null) => void;
  onUpdateAnnotation: (annotationId: PdfAnnotationId, patch: Partial<PdfAnnotation>) => void;
  page: PdfPageItem;
  pageSize: PdfRenderedPageSize;
  selectedAnnotationId: PdfAnnotationId | null;
  spacebarFreehandEnabled: boolean;
  signatureImage: SignatureImage | null;
};

type ClientPoint = {
  clientX: number;
  clientY: number;
};

type InteractionState =
  | {
      annotationId: PdfAnnotationId;
      kind: 'move' | 'resize';
      lastPoint: PdfAnnotationPoint;
      pointerId: number;
      previousAnnotation: PdfAnnotation;
      skipMoveUndo?: boolean;
    }
  | {
      annotationId: PdfAnnotationId;
      kind: 'draw';
      pointerId: number | null;
      previousAnnotation: PdfAnnotation;
      skipMoveUndo?: boolean;
      source: 'pointer' | 'spacebar';
    }
  | {
      eraserPoints: PdfAnnotationPoint[];
      kind: 'erase';
      pointerId: number;
      replacements: PdfAnnotationEraseReplacement[];
    }
  | null;

type TextEditState = {
  annotationId: PdfAnnotationId;
  previousAnnotation: PdfAnnotation;
  value: string;
};

const minimumAnnotationSize = 18;
const minimumEraserSampleSpacing = 0.75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getDistance(firstPoint: PdfAnnotationPoint, secondPoint: PdfAnnotationPoint): number {
  return Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
}

function getPageUnitsPerCssPx(svgElement: SVGSVGElement, pageSize: PdfRenderedPageSize): number {
  const rect = svgElement.getBoundingClientRect();
  const horizontalScale = rect.width > 0 ? pageSize.width / rect.width : 1;
  const verticalScale = rect.height > 0 ? pageSize.height / rect.height : 1;

  return Math.max(horizontalScale, verticalScale);
}

function getFreehandPointSpacing(
  sensitivity: FreehandSensitivity,
  svgElement: SVGSVGElement,
  pageSize: PdfRenderedPageSize,
): number {
  return (
    getFreehandSensitivitySpacingCssPx(sensitivity) * getPageUnitsPerCssPx(svgElement, pageSize)
  );
}

function getEraserRadiusPageUnits(
  eraserSize: number,
  svgElement: SVGSVGElement,
  pageSize: PdfRenderedPageSize,
): number {
  return (eraserSize / 2) * getPageUnitsPerCssPx(svgElement, pageSize);
}

function interpolatePointsBySpacing(
  startPoint: PdfAnnotationPoint,
  endPoint: PdfAnnotationPoint,
  spacing: number,
): PdfAnnotationPoint[] {
  const distance = getDistance(startPoint, endPoint);

  if (distance === 0) {
    return [];
  }

  const segmentCount = Math.max(1, Math.ceil(distance / Math.max(1, spacing)));

  return Array.from({ length: segmentCount }, (_, pointIndex) => {
    const progress = (pointIndex + 1) / segmentCount;

    return {
      x: startPoint.x + (endPoint.x - startPoint.x) * progress,
      y: startPoint.y + (endPoint.y - startPoint.y) * progress,
    };
  });
}

function isTextAnnotation(annotation: PdfAnnotation): boolean {
  return (
    annotation.type === 'text-note' ||
    annotation.type === 'free-text' ||
    annotation.type === 'text-edit'
  );
}

function isTextBoxTool(tool: PdfAnnotationTool): boolean {
  return tool === 'text-note' || tool === 'free-text';
}

function canMoveAnnotationWithTool(annotation: PdfAnnotation, tool: PdfAnnotationTool): boolean {
  return tool === 'select' || isTextAnnotation(annotation);
}

function isPrimaryActivationPointer(event: React.PointerEvent): boolean {
  return event.button === 0 && event.isPrimary !== false;
}

function safelySetPointerCapture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is an enhancement. Some embedded WebViews can reject
    // it even though they support Pointer Events, so starting a stroke must
    // not fail.
  }
}

function getPointerPoint(
  event: { clientX: number; clientY: number },
  svgElement: SVGSVGElement,
  pageSize: PdfRenderedPageSize,
): PdfAnnotationPoint {
  const rect = svgElement.getBoundingClientRect();

  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * pageSize.width, 0, pageSize.width),
    y: clamp(((event.clientY - rect.top) / rect.height) * pageSize.height, 0, pageSize.height),
  };
}

function isClientPointInsideSvg(point: ClientPoint, svgElement: SVGSVGElement): boolean {
  const rect = svgElement.getBoundingClientRect();

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top &&
    point.clientY <= rect.bottom
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
  );
}

function isSpacebarEvent(event: KeyboardEvent): boolean {
  return event.code === 'Space' || event.key === ' ';
}

function getPenAnnotationPatch(
  points: PdfAnnotationPoint[],
): Pick<PdfAnnotation, 'height' | 'points' | 'width' | 'x' | 'y'> {
  const xs = points.map((candidatePoint) => candidatePoint.x);
  const ys = points.map((candidatePoint) => candidatePoint.y);

  return {
    points,
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
  };
}

function getSampledPenPoints(points: PdfAnnotationPoint[], spacing: number): PdfAnnotationPoint[] {
  if (points.length <= 1) {
    return points;
  }

  const sampledPoints = [points[0]];

  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
    sampledPoints.push(
      ...interpolatePointsBySpacing(points[pointIndex], points[pointIndex + 1], spacing),
    );
  }

  return sampledPoints;
}

function isPointInsideEraserPath(
  point: PdfAnnotationPoint,
  eraserPoints: PdfAnnotationPoint[],
  threshold: number,
): boolean {
  return eraserPoints.some((eraserPoint) => getDistance(point, eraserPoint) <= threshold);
}

function getPenSegmentsAfterErasing({
  annotation,
  eraserPoints,
  eraserRadius,
  samplingSpacing,
}: {
  annotation: PdfAnnotation;
  eraserPoints: PdfAnnotationPoint[];
  eraserRadius: number;
  samplingSpacing: number;
}): PdfAnnotationEraseSegment[] | null {
  if (
    !isFreehandStrokeAnnotation(annotation) ||
    !annotation.points?.length ||
    eraserPoints.length === 0
  ) {
    return null;
  }

  const threshold = eraserRadius + getAnnotationStrokeWidth(annotation) / 2;

  if (
    !eraserPoints.some(
      (eraserPoint) =>
        eraserPoint.x >= annotation.x - threshold &&
        eraserPoint.x <= annotation.x + annotation.width + threshold &&
        eraserPoint.y >= annotation.y - threshold &&
        eraserPoint.y <= annotation.y + annotation.height + threshold,
    )
  ) {
    return null;
  }

  const sampledPoints = getSampledPenPoints(annotation.points, samplingSpacing);
  const segments: PdfAnnotationEraseSegment[] = [];
  let currentSegment: PdfAnnotationPoint[] = [];
  let didErase = false;

  for (const point of sampledPoints) {
    if (isPointInsideEraserPath(point, eraserPoints, threshold)) {
      didErase = true;

      if (currentSegment.length > 1) {
        segments.push(getPenAnnotationPatch(currentSegment));
      }

      currentSegment = [];
      continue;
    }

    currentSegment.push(point);
  }

  if (currentSegment.length > 1) {
    segments.push(getPenAnnotationPatch(currentSegment));
  }

  return didErase ? segments : null;
}

function buildEraserReplacements({
  annotations,
  eraserPoints,
  eraserSize,
  pageSize,
  svgElement,
}: {
  annotations: PdfAnnotation[];
  eraserPoints: PdfAnnotationPoint[];
  eraserSize: number;
  pageSize: PdfRenderedPageSize;
  svgElement: SVGSVGElement;
}): PdfAnnotationEraseReplacement[] {
  const eraserRadius = getEraserRadiusPageUnits(eraserSize, svgElement, pageSize);
  const samplingSpacing = Math.max(
    minimumEraserSampleSpacing,
    Math.min(eraserRadius / 2, getPageUnitsPerCssPx(svgElement, pageSize) * 2),
  );
  const replacements: PdfAnnotationEraseReplacement[] = [];

  for (const annotation of annotations) {
    const segments = getPenSegmentsAfterErasing({
      annotation,
      eraserPoints,
      eraserRadius,
      samplingSpacing,
    });

    if (segments) {
      replacements.push({
        originalAnnotation: annotation,
        segments,
      });
    }
  }

  return replacements;
}

function buildEraserPreviewAnnotations(
  annotations: PdfAnnotation[],
  replacements: PdfAnnotationEraseReplacement[],
): PdfAnnotation[] {
  if (replacements.length === 0) {
    return annotations;
  }

  const replacementsByAnnotationId = new Map(
    replacements.map((replacement) => [replacement.originalAnnotation.id, replacement] as const),
  );
  const previewAnnotations: PdfAnnotation[] = [];

  for (const annotation of annotations) {
    const replacement = replacementsByAnnotationId.get(annotation.id);

    if (!replacement) {
      previewAnnotations.push(annotation);
      continue;
    }

    replacement.segments.forEach((segment, segmentIndex) => {
      previewAnnotations.push({
        ...replacement.originalAnnotation,
        ...segment,
        id:
          segmentIndex === 0
            ? replacement.originalAnnotation.id
            : `${replacement.originalAnnotation.id}-eraser-preview-${segmentIndex}`,
      });
    });
  }

  return previewAnnotations;
}

function getTranslatedPenAnnotationPatch(
  annotation: PdfAnnotation,
  deltaX: number,
  deltaY: number,
  pageSize: PdfRenderedPageSize,
): Pick<PdfAnnotation, 'points' | 'x' | 'y'> {
  const nextX = clamp(annotation.x + deltaX, 0, pageSize.width - annotation.width);
  const nextY = clamp(annotation.y + deltaY, 0, pageSize.height - annotation.height);
  const appliedDeltaX = nextX - annotation.x;
  const appliedDeltaY = nextY - annotation.y;

  return {
    x: nextX,
    y: nextY,
    points: (annotation.points ?? []).map((point) => ({
      x: point.x + appliedDeltaX,
      y: point.y + appliedDeltaY,
    })),
  };
}

function makeAnnotationForTool({
  borderColor,
  color,
  fillColor,
  highlightBrushSize,
  highlightOpacity,
  page,
  point,
  signatureImage,
  strokeWidth,
  tool,
}: {
  borderColor: string;
  color: string;
  fillColor: string;
  highlightBrushSize: number;
  highlightOpacity: number;
  page: PdfPageItem;
  point: PdfAnnotationPoint;
  signatureImage: SignatureImage | null;
  strokeWidth: number;
  tool: PdfAnnotationTool;
}): Omit<PdfAnnotation, 'createdAt' | 'id'> | null {
  if (tool === 'select') {
    return null;
  }

  if (tool === 'pen') {
    return {
      pageItemId: page.id,
      type: 'pen',
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      points: [point],
      color,
      strokeWidth,
    };
  }

  if (tool === 'highlight') {
    // A real highlighter is a thick translucent marker dragged freehand, not
    // a rectangle bound to a detected text run — this mirrors the pen tool's
    // stroke shape so it works over images and blank space too.
    return {
      pageItemId: page.id,
      type: 'highlight',
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      points: [point],
      color,
      strokeWidth: highlightBrushSize,
      opacity: highlightOpacity,
    };
  }

  if (tool === 'rectangle') {
    return {
      pageItemId: page.id,
      type: 'rectangle',
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      color,
    };
  }

  if (tool === 'text-note') {
    return {
      pageItemId: page.id,
      type: 'text-note',
      x: point.x,
      y: point.y,
      width: 116,
      height: 72,
      content: 'Comment',
      borderColor,
      color,
      fillColor,
    };
  }

  if (tool === 'free-text') {
    return {
      pageItemId: page.id,
      type: 'free-text',
      x: point.x,
      y: point.y,
      width: 180,
      height: 58,
      content: 'Text',
      borderColor,
      color,
      fillColor,
      fontId: defaultAnnotationFontId,
      fontSize: defaultAnnotationFontSize,
    };
  }

  if ((tool === 'signature' || tool === 'image') && signatureImage) {
    return {
      pageItemId: page.id,
      type: tool,
      x: point.x,
      y: point.y,
      width: tool === 'signature' ? 190 : 160,
      height: tool === 'signature' ? 72 : 120,
      imageBytes: signatureImage.bytes,
      imageDataUrl: signatureImage.dataUrl,
      imageMimeType: signatureImage.mimeType,
    };
  }

  return null;
}

function getAnnotationPath(points: PdfAnnotationPoint[] | undefined): string {
  if (!points?.length) {
    return '';
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

function normalizeDraftRect(
  startPoint: PdfAnnotationPoint,
  currentPoint: PdfAnnotationPoint,
): Pick<PdfAnnotation, 'height' | 'width' | 'x' | 'y'> {
  const x = Math.min(startPoint.x, currentPoint.x);
  const y = Math.min(startPoint.y, currentPoint.y);

  return {
    x,
    y,
    width: Math.max(minimumAnnotationSize, Math.abs(currentPoint.x - startPoint.x)),
    height: Math.max(minimumAnnotationSize, Math.abs(currentPoint.y - startPoint.y)),
  };
}

export function AnnotationLayer({
  activeTool,
  annotationBorderColor,
  annotationColor,
  annotationFillColor,
  annotationStrokeWidth,
  annotations,
  eraserSize,
  freehandSensitivity,
  highlightBrushSize,
  highlightOpacity,
  isAnnotating,
  onCommitAnnotationChange,
  onCreateAnnotation,
  onEraseAnnotationPixels,
  onSelectAnnotation,
  onUpdateAnnotation,
  page,
  pageSize,
  selectedAnnotationId,
  spacebarFreehandEnabled,
  signatureImage,
}: AnnotationLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interactionRef = useRef<InteractionState>(null);
  const currentAnnotationRef = useRef<PdfAnnotation | null>(null);
  const draftStartPointRef = useRef<PdfAnnotationPoint | null>(null);
  const lastPointerClientPointRef = useRef<ClientPoint | null>(null);
  const autoEditingKeyRef = useRef<string | null>(null);
  const [editingText, setEditingText] = useState<TextEditState | null>(null);
  const [eraserPreviewAnnotations, setEraserPreviewAnnotations] = useState<PdfAnnotation[] | null>(
    null,
  );
  const [eraserCursorPoint, setEraserCursorPoint] = useState<PdfAnnotationPoint | null>(null);
  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedAnnotationId),
    [annotations, selectedAnnotationId],
  );
  const isSpacebarFreehandAvailable =
    spacebarFreehandEnabled && isAnnotating && activeTool === 'pen';

  const beginTextEdit = useCallback(
    (annotation: PdfAnnotation) => {
      if (!isTextAnnotation(annotation)) {
        return;
      }

      onSelectAnnotation(annotation.id);
      setEditingText({
        annotationId: annotation.id,
        previousAnnotation: annotation,
        value: annotation.content ?? '',
      });
    },
    [onSelectAnnotation],
  );

  useEffect(() => {
    const shouldAutoEditSelectedText =
      (activeTool === 'edit-text' && selectedAnnotation?.type === 'text-edit') ||
      (activeTool === 'text-note' && selectedAnnotation?.type === 'text-note');

    if (!shouldAutoEditSelectedText || !selectedAnnotation) {
      autoEditingKeyRef.current = null;
      return;
    }

    const autoEditingKey = `${activeTool}:${selectedAnnotation.id}`;

    if (editingText || autoEditingKeyRef.current === autoEditingKey) {
      return;
    }

    autoEditingKeyRef.current = autoEditingKey;
    beginTextEdit(selectedAnnotation);
  }, [activeTool, beginTextEdit, editingText, selectedAnnotation]);

  useEffect(() => {
    if (activeTool === 'eraser') {
      return;
    }

    setEraserCursorPoint(null);
    setEraserPreviewAnnotations(null);
  }, [activeTool]);

  const commitTextEdit = () => {
    if (!editingText) {
      return;
    }

    const nextValue = editingText.value;
    const previousValue = editingText.previousAnnotation.content ?? '';

    if (nextValue !== previousValue) {
      onCommitAnnotationChange(editingText.previousAnnotation, {
        ...editingText.previousAnnotation,
        content: nextValue,
      });
    }

    setEditingText(null);
  };

  const cancelTextEdit = () => {
    if (!editingText) {
      return;
    }

    onUpdateAnnotation(editingText.annotationId, {
      content: editingText.previousAnnotation.content,
    });
    setEditingText(null);
  };

  const commitInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    const nextAnnotation = currentAnnotationRef.current;

    if (
      interaction &&
      interaction.kind !== 'erase' &&
      nextAnnotation &&
      !interaction.skipMoveUndo
    ) {
      onCommitAnnotationChange(interaction.previousAnnotation, nextAnnotation);
    }

    interactionRef.current = null;
    currentAnnotationRef.current = null;
    draftStartPointRef.current = null;
  }, [onCommitAnnotationChange]);

  const commitEraseInteraction = useCallback(() => {
    const interaction = interactionRef.current;

    if (interaction?.kind !== 'erase') {
      return;
    }

    const replacements = interaction.replacements;

    interactionRef.current = null;
    currentAnnotationRef.current = null;
    draftStartPointRef.current = null;
    setEraserPreviewAnnotations(null);

    if (replacements.length) {
      onEraseAnnotationPixels(replacements);
    }
  }, [onEraseAnnotationPixels]);

  const updateEraserInteraction = useCallback(
    (clientPoint: ClientPoint) => {
      const interaction = interactionRef.current;
      const svgElement = svgRef.current;

      if (interaction?.kind !== 'erase' || !svgElement) {
        return;
      }

      const point = getPointerPoint(clientPoint, svgElement, pageSize);
      const eraserPoints = [...interaction.eraserPoints, point];
      const replacements = buildEraserReplacements({
        annotations,
        eraserPoints,
        eraserSize,
        pageSize,
        svgElement,
      });

      interactionRef.current = {
        ...interaction,
        eraserPoints,
        replacements,
      };
      setEraserCursorPoint(point);
      setEraserPreviewAnnotations(buildEraserPreviewAnnotations(annotations, replacements));
    },
    [annotations, eraserSize, pageSize],
  );

  const appendPointToDrawInteraction = useCallback(
    (clientPoint: ClientPoint, options: { forceEndpoint?: boolean } = {}) => {
      const interaction = interactionRef.current;
      const currentAnnotation = currentAnnotationRef.current;

      if (!interaction || interaction.kind !== 'draw' || !currentAnnotation || !svgRef.current) {
        return;
      }

      const svgElement = svgRef.current;
      const point = getPointerPoint(clientPoint, svgElement, pageSize);
      const currentPoints = currentAnnotation.points ?? [];
      const lastPoint = currentPoints[currentPoints.length - 1];

      if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) {
        return;
      }

      if (!lastPoint) {
        const patch = getPenAnnotationPatch([point]);
        const nextAnnotation = { ...currentAnnotation, ...patch };

        currentAnnotationRef.current = nextAnnotation;
        onUpdateAnnotation(currentAnnotation.id, patch);
        return;
      }

      const pointSpacing = getFreehandPointSpacing(freehandSensitivity, svgElement, pageSize);
      const distanceFromLastPoint = getDistance(lastPoint, point);

      if (
        !options.forceEndpoint &&
        currentPoints.length > 1 &&
        distanceFromLastPoint < pointSpacing
      ) {
        return;
      }

      const nextPoints =
        distanceFromLastPoint < pointSpacing
          ? [...currentPoints, point]
          : [...currentPoints, ...interpolatePointsBySpacing(lastPoint, point, pointSpacing)];
      const patch = getPenAnnotationPatch(nextPoints);
      const nextAnnotation = { ...currentAnnotation, ...patch };

      currentAnnotationRef.current = nextAnnotation;
      onUpdateAnnotation(currentAnnotation.id, patch);
    },
    [freehandSensitivity, onUpdateAnnotation, pageSize],
  );

  const beginSpacebarFreehandStroke = useCallback(() => {
    const clientPoint = lastPointerClientPointRef.current;
    const svgElement = svgRef.current;

    if (
      !isSpacebarFreehandAvailable ||
      !clientPoint ||
      !svgElement ||
      interactionRef.current ||
      !isClientPointInsideSvg(clientPoint, svgElement)
    ) {
      return;
    }

    const point = getPointerPoint(clientPoint, svgElement, pageSize);
    const annotation = makeAnnotationForTool({
      page,
      point,
      signatureImage,
      tool: 'pen',
      borderColor: annotationBorderColor,
      color: annotationColor,
      fillColor: annotationFillColor,
      highlightBrushSize,
      highlightOpacity,
      strokeWidth: annotationStrokeWidth,
    });

    if (!annotation) {
      return;
    }

    const annotationId = onCreateAnnotation(annotation);
    const createdAnnotation: PdfAnnotation = {
      ...annotation,
      id: annotationId,
      createdAt: new Date().toISOString(),
    };

    onSelectAnnotation(annotationId);
    interactionRef.current = {
      annotationId,
      kind: 'draw',
      pointerId: null,
      previousAnnotation: createdAnnotation,
      skipMoveUndo: true,
      source: 'spacebar',
    };
    currentAnnotationRef.current = createdAnnotation;
    draftStartPointRef.current = point;
  }, [
    annotationBorderColor,
    annotationColor,
    annotationFillColor,
    annotationStrokeWidth,
    highlightBrushSize,
    highlightOpacity,
    isSpacebarFreehandAvailable,
    onCreateAnnotation,
    onSelectAnnotation,
    page,
    pageSize,
    signatureImage,
  ]);

  const finishSpacebarFreehandStroke = useCallback(() => {
    const interaction = interactionRef.current;

    if (interaction?.kind === 'draw' && interaction.source === 'spacebar') {
      const clientPoint = lastPointerClientPointRef.current;

      if (clientPoint) {
        appendPointToDrawInteraction(clientPoint, { forceEndpoint: true });
      }

      commitInteraction();
    }
  }, [appendPointToDrawInteraction, commitInteraction]);

  useEffect(() => {
    if (isSpacebarFreehandAvailable) {
      return;
    }

    finishSpacebarFreehandStroke();
  }, [finishSpacebarFreehandStroke, isSpacebarFreehandAvailable]);

  useEffect(() => {
    if (!isSpacebarFreehandAvailable) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isSpacebarEvent(event) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();

      if (!event.repeat) {
        beginSpacebarFreehandStroke();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const isSpacebarStrokeActive =
        interactionRef.current?.kind === 'draw' && interactionRef.current.source === 'spacebar';

      if (
        !isSpacebarEvent(event) ||
        (!isSpacebarStrokeActive && isEditableKeyboardTarget(event.target))
      ) {
        return;
      }

      event.preventDefault();
      finishSpacebarFreehandStroke();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', finishSpacebarFreehandStroke);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', finishSpacebarFreehandStroke);
      finishSpacebarFreehandStroke();
    };
  }, [beginSpacebarFreehandStroke, finishSpacebarFreehandStroke, isSpacebarFreehandAvailable]);

  const handleCreatePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    lastPointerClientPointRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };

    if (!isAnnotating || activeTool === 'select' || !svgRef.current) {
      if (isPrimaryActivationPointer(event)) {
        onSelectAnnotation(null);
      }
      return;
    }

    if (isTextBoxTool(activeTool) || activeTool === 'edit-text') {
      return;
    }

    if (!isPrimaryActivationPointer(event)) {
      return;
    }

    if (interactionRef.current) {
      return;
    }

    if (activeTool === 'eraser') {
      event.preventDefault();
      safelySetPointerCapture(event.currentTarget, event.pointerId);
      onSelectAnnotation(null);
      interactionRef.current = {
        eraserPoints: [],
        kind: 'erase',
        pointerId: event.pointerId,
        replacements: [],
      };
      updateEraserInteraction(event);
      return;
    }

    const point = getPointerPoint(event, svgRef.current, pageSize);
    const annotation = makeAnnotationForTool({
      page,
      point,
      signatureImage,
      tool: activeTool,
      borderColor: annotationBorderColor,
      color: annotationColor,
      fillColor: annotationFillColor,
      highlightBrushSize,
      highlightOpacity,
      strokeWidth: annotationStrokeWidth,
    });

    if (!annotation) {
      return;
    }

    event.preventDefault();
    safelySetPointerCapture(event.currentTarget, event.pointerId);

    const annotationId = onCreateAnnotation(annotation);
    const createdAnnotation: PdfAnnotation = {
      ...annotation,
      id: annotationId,
      createdAt: new Date().toISOString(),
    };

    // GoodNotes-style marker strokes stay ready for the next drag instead of
    // becoming selected and showing resize chrome after every stroke.
    onSelectAnnotation(activeTool === 'highlight' ? null : annotationId);
    interactionRef.current =
      activeTool === 'pen' || activeTool === 'highlight'
        ? {
            annotationId,
            kind: 'draw',
            pointerId: event.pointerId,
            previousAnnotation: createdAnnotation,
            skipMoveUndo: true,
            source: 'pointer',
          }
        : {
            annotationId,
            kind: 'resize',
            lastPoint: point,
            pointerId: event.pointerId,
            previousAnnotation: createdAnnotation,
            skipMoveUndo: true,
          };
    currentAnnotationRef.current = createdAnnotation;
    draftStartPointRef.current = point;

    if (isTextAnnotation(createdAnnotation)) {
      setEditingText({
        annotationId,
        previousAnnotation: createdAnnotation,
        value: createdAnnotation.content ?? '',
      });
    }
  };

  const handleCreateContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!isAnnotating || activeTool !== 'free-text' || !svgRef.current) {
      return;
    }

    const point = getPointerPoint(event, svgRef.current, pageSize);
    const annotation = makeAnnotationForTool({
      page,
      point,
      signatureImage,
      tool: activeTool,
      borderColor: annotationBorderColor,
      color: annotationColor,
      fillColor: annotationFillColor,
      highlightBrushSize,
      highlightOpacity,
      strokeWidth: annotationStrokeWidth,
    });

    if (!annotation) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const annotationId = onCreateAnnotation(annotation);

    onSelectAnnotation(annotationId);
  };

  const handleAnnotationPointerDown = (
    event: React.PointerEvent<SVGElement>,
    annotation: PdfAnnotation,
    kind: 'move' | 'resize',
  ) => {
    if (
      !isPrimaryActivationPointer(event) ||
      !isAnnotating ||
      !canMoveAnnotationWithTool(annotation, activeTool) ||
      !svgRef.current ||
      editingText
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    safelySetPointerCapture(event.currentTarget, event.pointerId);

    const point = getPointerPoint(event, svgRef.current, pageSize);

    onSelectAnnotation(annotation.id);
    interactionRef.current = {
      annotationId: annotation.id,
      kind,
      lastPoint: point,
      pointerId: event.pointerId,
      previousAnnotation: annotation,
    };
    currentAnnotationRef.current = annotation;
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    lastPointerClientPointRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };

    if (activeTool === 'eraser' && svgRef.current) {
      setEraserCursorPoint(getPointerPoint(event, svgRef.current, pageSize));
    }

    const interaction = interactionRef.current;

    if (!interaction || !svgRef.current) {
      return;
    }

    if (interaction.kind === 'erase') {
      if (interaction.pointerId !== event.pointerId) {
        return;
      }

      updateEraserInteraction(event);
      return;
    }

    const currentAnnotation = currentAnnotationRef.current;

    if (!currentAnnotation) {
      return;
    }

    if (interaction.kind !== 'draw' && interaction.pointerId !== event.pointerId) {
      return;
    }

    if (
      interaction.kind === 'draw' &&
      interaction.source === 'pointer' &&
      interaction.pointerId !== event.pointerId
    ) {
      return;
    }

    if (interaction.kind === 'draw') {
      appendPointToDrawInteraction(event);
      return;
    }

    const point = getPointerPoint(event, svgRef.current, pageSize);

    if (draftStartPointRef.current && interaction.kind === 'resize') {
      const patch = normalizeDraftRect(draftStartPointRef.current, point);
      const nextAnnotation = { ...currentAnnotation, ...patch };

      currentAnnotationRef.current = nextAnnotation;
      onUpdateAnnotation(currentAnnotation.id, patch);
      return;
    }

    const deltaX = point.x - interaction.lastPoint.x;
    const deltaY = point.y - interaction.lastPoint.y;
    const patch =
      interaction.kind === 'move'
        ? isFreehandStrokeAnnotation(currentAnnotation)
          ? getTranslatedPenAnnotationPatch(currentAnnotation, deltaX, deltaY, pageSize)
          : {
              x: clamp(currentAnnotation.x + deltaX, 0, pageSize.width - currentAnnotation.width),
              y: clamp(currentAnnotation.y + deltaY, 0, pageSize.height - currentAnnotation.height),
            }
        : {
            width: clamp(currentAnnotation.width + deltaX, minimumAnnotationSize, pageSize.width),
            height: clamp(
              currentAnnotation.height + deltaY,
              minimumAnnotationSize,
              pageSize.height,
            ),
          };
    const nextAnnotation = { ...currentAnnotation, ...patch };

    interactionRef.current = {
      ...interaction,
      lastPoint: point,
    };
    currentAnnotationRef.current = nextAnnotation;
    onUpdateAnnotation(currentAnnotation.id, patch);
  };

  const handlePointerEnd = (event: React.PointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;

    if (interaction?.kind === 'draw' && interaction.source === 'spacebar') {
      return;
    }

    if (interaction?.kind === 'erase') {
      if (interaction.pointerId !== event.pointerId) {
        return;
      }

      commitEraseInteraction();
      return;
    }

    if (interaction && interaction.pointerId !== event.pointerId) {
      return;
    }

    if (interaction?.kind === 'draw' && interaction.source === 'pointer') {
      appendPointToDrawInteraction(event, { forceEndpoint: true });
    }

    commitInteraction();
  };

  const handlePointerLeave = () => {
    lastPointerClientPointRef.current = null;
    setEraserCursorPoint(null);
    finishSpacebarFreehandStroke();
  };

  const renderTextAnnotation = (annotation: PdfAnnotation, commonProps: object) => {
    const fallback =
      annotation.type === 'text-note' ? 'Comment' : annotation.type === 'text-edit' ? '' : 'Text';
    const isEditing = editingText?.annotationId === annotation.id;
    const isSeamlessTextEdit = annotation.type === 'text-edit';
    const color = getAnnotationColor(annotation);
    const fillColor = getAnnotationFillColor(annotation);
    const borderColor = getAnnotationBorderColor(annotation);
    const hasFill = !isTransparentAnnotationColor(fillColor);
    const hasBorder = !isTransparentAnnotationColor(borderColor);
    const isWysiwygText = annotation.type === 'free-text' || annotation.type === 'text-edit';
    // Seamless text edits align exactly with the replaced document text: the
    // annotation rect was padded by 1.5 page units at creation, so the same
    // inset puts the replacement glyphs back on the original baseline.
    const textInset = isSeamlessTextEdit ? 1.5 : 6;
    const textStyle = {
      color,
      fontFamily: getAnnotationFontCssFamily(annotation),
      fontSize: `${annotation.fontSize ?? 12}px`,
      fontStyle: annotation.fontItalic ? 'italic' : 'normal',
      fontWeight: annotation.fontBold ? 700 : 400,
      lineHeight: annotation.lineHeight ? `${annotation.lineHeight}px` : 1.25,
      padding: `${textInset}px`,
    };

    return (
      <g {...commonProps}>
        <rect
          className="annotation-hit-target"
          fill="transparent"
          height={annotation.height}
          pointerEvents="all"
          stroke="none"
          width={annotation.width}
          x={annotation.x}
          y={annotation.y}
        />
        <rect
          className="annotation-text-background"
          fill={hasFill ? fillColor : 'none'}
          height={annotation.height}
          rx={annotation.type === 'text-note' ? 3 : isSeamlessTextEdit ? 0 : 2}
          stroke={hasBorder ? borderColor : 'none'}
          strokeDasharray={annotation.type === 'text-edit' && hasBorder ? '4 3' : undefined}
          strokeWidth={hasBorder ? (annotation.type === 'free-text' ? 1.5 : 1) : 0}
          width={annotation.width}
          x={annotation.x}
          y={annotation.y}
        />
        {!isEditing && !isWysiwygText ? (
          <text
            style={{ fill: color }}
            x={annotation.x + 8}
            y={annotation.y + (annotation.type === 'text-note' ? 18 : 20)}
          >
            {(annotation.content || fallback).slice(0, 80)}
          </text>
        ) : null}
        {!isEditing && isWysiwygText ? (
          <foreignObject
            height={annotation.height}
            pointerEvents="none"
            width={annotation.width}
            x={annotation.x}
            y={annotation.y}
          >
            <div
              className="annotation-text-display"
              data-seamless={isSeamlessTextEdit ? 'true' : undefined}
              style={textStyle}
            >
              {annotation.content || fallback}
            </div>
          </foreignObject>
        ) : null}
        {isEditing ? (
          <foreignObject
            height={annotation.height}
            width={annotation.width}
            x={annotation.x}
            y={annotation.y}
          >
            <textarea
              autoFocus
              className="annotation-text-editor"
              data-seamless={isSeamlessTextEdit ? 'true' : undefined}
              onBlur={commitTextEdit}
              onChange={(event) => {
                const value = event.target.value;

                setEditingText((currentEdit) =>
                  currentEdit?.annotationId === annotation.id
                    ? {
                        ...currentEdit,
                        value,
                      }
                    : currentEdit,
                );
                onUpdateAnnotation(annotation.id, { content: value });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelTextEdit();
                }

                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || event.shiftKey)) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              onFocus={(event) => {
                if (event.currentTarget.value === fallback) {
                  event.currentTarget.select();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              spellCheck={false}
              wrap={isSeamlessTextEdit ? 'off' : undefined}
              style={
                isWysiwygText
                  ? { ...textStyle, backgroundColor: hasFill ? fillColor : 'transparent' }
                  : { backgroundColor: hasFill ? fillColor : 'transparent', color }
              }
              value={editingText?.value ?? annotation.content ?? ''}
            />
          </foreignObject>
        ) : null}
      </g>
    );
  };

  const renderAnnotation = (annotation: PdfAnnotation) => {
    const isSelected = annotation.id === selectedAnnotationId;
    const shouldShowSelectionChrome = isSelected && activeTool !== 'highlight';
    const color = getAnnotationColor(annotation);
    const isHighlightStroke = isFreehandHighlightAnnotation(annotation);
    const rotationTransform = annotation.rotation
      ? `rotate(${annotation.rotation} ${annotation.x} ${annotation.y})`
      : undefined;
    const commonProps = {
      className: `annotation-item annotation-${annotation.type}`,
      onDoubleClick: () => beginTextEdit(annotation),
      onPointerDown: (event: React.PointerEvent<SVGElement>) =>
        handleAnnotationPointerDown(event, annotation, 'move'),
      role: 'button',
      tabIndex: 0,
    };

    if (annotation.type === 'pen' || isHighlightStroke) {
      const strokeWidth = getAnnotationStrokeWidth(annotation);
      const hitStrokeWidth = Math.max(strokeWidth + 10, 12);
      const pathData = getAnnotationPath(annotation.points);

      return (
        <g key={annotation.id}>
          <path
            {...commonProps}
            className={
              isHighlightStroke
                ? 'annotation-item annotation-freehand-highlight-hit-target annotation-pen-hit-target'
                : `${commonProps.className} annotation-pen-hit-target`
            }
            d={pathData}
            fill="none"
            pointerEvents="stroke"
            stroke="transparent"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={hitStrokeWidth}
          />
          <path
            className={isHighlightStroke ? 'annotation-highlight-stroke' : 'annotation-pen-stroke'}
            d={pathData}
            fill="none"
            pointerEvents="none"
            strokeLinecap={isHighlightStroke ? 'butt' : 'round'}
            strokeLinejoin="round"
            strokeWidth={strokeWidth}
            style={
              isHighlightStroke
                ? {
                    stroke: color,
                    strokeOpacity: getAnnotationOpacity(annotation),
                    mixBlendMode: 'multiply',
                  }
                : { stroke: color }
            }
          />
          {shouldShowSelectionChrome ? (
            <rect
              className="annotation-selection-box"
              height={annotation.height}
              width={annotation.width}
              x={annotation.x}
              y={annotation.y}
            />
          ) : null}
        </g>
      );
    }

    return (
      <g key={annotation.id}>
        {annotation.type === 'highlight' ? (
          <rect
            {...commonProps}
            height={annotation.height}
            rx={2}
            style={{ fill: color, fillOpacity: 0.42, stroke: color }}
            transform={rotationTransform}
            width={annotation.width}
            x={annotation.x}
            y={annotation.y}
          />
        ) : null}
        {annotation.type === 'rectangle' ? (
          <rect
            {...commonProps}
            fill="none"
            height={annotation.height}
            rx={2}
            style={{ stroke: color }}
            width={annotation.width}
            x={annotation.x}
            y={annotation.y}
          />
        ) : null}
        {isTextAnnotation(annotation) ? renderTextAnnotation(annotation, commonProps) : null}
        {(annotation.type === 'signature' || annotation.type === 'image') &&
        annotation.imageDataUrl ? (
          <image
            {...commonProps}
            height={annotation.height}
            href={annotation.imageDataUrl}
            preserveAspectRatio="xMidYMid meet"
            width={annotation.width}
            x={annotation.x}
            y={annotation.y}
          />
        ) : null}
        {shouldShowSelectionChrome ? (
          <>
            <rect
              className="annotation-selection-box"
              height={annotation.height}
              transform={rotationTransform}
              width={annotation.width}
              x={annotation.x}
              y={annotation.y}
            />
            <rect
              className="annotation-resize-handle"
              height={10}
              onPointerDown={(event) => handleAnnotationPointerDown(event, annotation, 'resize')}
              transform={rotationTransform}
              width={10}
              x={annotation.x + annotation.width - 5}
              y={annotation.y + annotation.height - 5}
            />
          </>
        ) : null}
      </g>
    );
  };

  const visibleAnnotations = eraserPreviewAnnotations ?? annotations;
  const visibleSelectedAnnotation = visibleAnnotations.find(
    (annotation) => annotation.id === selectedAnnotationId,
  );
  const eraserCursorRadius =
    eraserCursorPoint && svgRef.current
      ? getEraserRadiusPageUnits(eraserSize, svgRef.current, pageSize)
      : 0;

  return (
    <svg
      className="annotation-layer"
      data-active-tool={activeTool}
      data-annotating={isAnnotating ? 'true' : undefined}
      data-editing-text={editingText ? 'true' : undefined}
      data-spacebar-freehand={isSpacebarFreehandAvailable ? 'true' : undefined}
      onContextMenu={handleCreateContextMenu}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handleCreatePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      ref={svgRef}
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
    >
      {visibleAnnotations.map(renderAnnotation)}
      {activeTool === 'eraser' && eraserCursorPoint ? (
        <circle
          className="annotation-eraser-cursor"
          cx={eraserCursorPoint.x}
          cy={eraserCursorPoint.y}
          r={eraserCursorRadius}
        />
      ) : null}
      {visibleSelectedAnnotation ? <title>{visibleSelectedAnnotation.type}</title> : null}
    </svg>
  );
}
