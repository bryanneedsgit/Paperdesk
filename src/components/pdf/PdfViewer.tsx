import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  getPdfPageFontRawName,
  getPdfPageSize,
  renderPdfPageTextLayer,
  renderPdfPageToCanvas,
  type PdfRenderedPageSize,
} from '../../lib/pdf/pdfRenderer';
import {
  normalizeAnnotationFontSize,
  recognizePdfFontName,
  stripFontSubsetPrefix,
} from '../../lib/pdf/annotationFonts';
import { sampleCanvasBackgroundColor } from '../../lib/pdf/canvasSampling';
import type { EmbeddedTextBox } from '../../lib/pdf/embeddedText';
import {
  logEmbeddedTextPageDiagnostics,
  logEmbeddedTextSelectionDiagnostics,
} from '../../lib/pdf/embeddedTextDiagnostics';
import {
  clampPointToPage,
  clampRectToPage,
  emptyEmbeddedTextSelection,
  getCommentRectFromSelection,
  createEmbeddedTextSelectionFromItems,
  getSelectionArea,
  selectEmbeddedTextBoxes,
  selectWordAtEmbeddedTextPoint,
  type EmbeddedTextSelectionResult,
  type TextSelectionPoint,
  type TextSelectionRect,
} from '../../lib/pdf/embeddedTextSelection';
import {
  getDefaultAnnotationBorderColor,
  getDefaultAnnotationColor,
  getDefaultAnnotationFillColor,
  transparentAnnotationColor,
} from '../../lib/pdf/annotationColors';
import type { FreehandSensitivity } from '../../lib/pdf/annotationStroke';
import { getNonLayeredHighlightRects } from '../../lib/pdf/highlightRects';
import { getFormatterFontCssFamily, getResizeDimensions } from '../../lib/pdf/formatterOptions';
import { isGeneratedPageItem, isSourcePageItem } from '../../lib/pdf/pdfWorkspace';
import { AnnotationLayer } from '../annotations/AnnotationLayer';
import { FormFieldLayer } from '../forms/FormFieldLayer';
import type {
  PdfAnnotation,
  PdfAnnotationEraseReplacement,
  PdfAnnotationPasteTarget,
  PdfAnnotationId,
  PdfAnnotationTool,
  PdfDocumentSource,
  PdfFormFieldValue,
  PdfPageItem,
  PdfWorkspace,
} from '../../lib/pdf/types';
import type { PdfTextSearchResult } from '../../lib/pdf/pdfTextSearch';

const fitWidthHorizontalPadding = 72;
const maxRenderScale = 4;
const minRenderScale = 0.15;

type PdfViewerProps = {
  activeAnnotationTool: PdfAnnotationTool;
  annotationBorderColor: string;
  annotationColor: string;
  annotationFillColor: string;
  annotationStrokeWidth: number;
  eraserSize: number;
  freehandSensitivity: FreehandSensitivity;
  highlightBrushSize: number;
  highlightOpacity: number;
  isAnnotating: boolean;
  onChangeFormFieldValue: (
    sourceDocumentId: string,
    fieldName: string,
    value: PdfFormFieldValue,
  ) => void;
  onCommitAnnotationChange: (
    previousAnnotation: PdfAnnotation,
    nextAnnotation: PdfAnnotation,
  ) => void;
  onCreateAnnotation: (annotation: Omit<PdfAnnotation, 'createdAt' | 'id'>) => PdfAnnotationId;
  onEraseAnnotationPixels: (replacements: PdfAnnotationEraseReplacement[]) => void;
  onSelectAnnotation: (annotationId: PdfAnnotationId | null) => void;
  onUpdateAnnotationPasteTarget: (target: PdfAnnotationPasteTarget | null) => void;
  onUpdateAnnotation: (annotationId: PdfAnnotationId, patch: Partial<PdfAnnotation>) => void;
  selectedAnnotationId: PdfAnnotationId | null;
  spacebarFreehandEnabled: boolean;
  signatureImage: {
    bytes: number[];
    dataUrl: string;
    mimeType: 'image/png' | 'image/jpeg';
  } | null;
  textSearchActiveResult?: PdfTextSearchResult | null;
  textSearchQuery?: string;
  workspace: PdfWorkspace;
};

type RenderState = 'idle' | 'loading' | 'ready' | 'error';

type TextSelectionDrag = {
  input: 'mouse' | 'pointer';
  pointerId?: number;
  startClientPoint: TextSelectionPoint;
  startPoint: TextSelectionPoint;
};

function clampScale(scale: number): number {
  return Math.min(maxRenderScale, Math.max(minRenderScale, scale));
}

function getVisiblePages(workspace: PdfWorkspace): PdfPageItem[] {
  return workspace.pages.filter((page) => !page.deleted);
}

function resolveActivePage(workspace: PdfWorkspace): PdfPageItem | undefined {
  const visiblePages = getVisiblePages(workspace);

  return visiblePages.find((page) => page.id === workspace.activePageId) ?? visiblePages[0];
}

function resolveSourceDocument(
  workspace: PdfWorkspace,
  page: PdfPageItem | undefined,
): PdfDocumentSource | undefined {
  if (!page || !isSourcePageItem(page)) {
    return undefined;
  }

  return workspace.documents.find((document) => document.id === page.sourceDocumentId);
}

function getGeneratedPageSize(page: PdfPageItem | undefined): PdfRenderedPageSize | null {
  if (!page || !isGeneratedPageItem(page)) {
    return null;
  }

  return {
    width: page.width ?? 595.28,
    height: page.height ?? 841.89,
  };
}

function getPreviewPageNumber(workspace: PdfWorkspace, activePage: PdfPageItem): number | null {
  if (
    !workspace.formatterSettings.pageNumbersEnabled ||
    !shouldApplyFormatterToPage(workspace, activePage)
  ) {
    return null;
  }

  const selectedPageIds = new Set(workspace.selectedPageIds);
  let nextNumber = Math.max(1, Math.floor(workspace.formatterSettings.startNumber));

  for (const page of getVisiblePages(workspace)) {
    if (workspace.formatterSettings.applyScope === 'selected' && !selectedPageIds.has(page.id)) {
      continue;
    }

    if (page.id === activePage.id) {
      return nextNumber;
    }

    nextNumber += 1;
  }

  return null;
}

function shouldApplyFormatterToPage(workspace: PdfWorkspace, page: PdfPageItem): boolean {
  return (
    workspace.formatterSettings.applyScope === 'all' || workspace.selectedPageIds.includes(page.id)
  );
}

function FormatterPreviewOverlay({
  isFormatterApplied,
  pageNumber,
  pageSize,
  workspace,
}: {
  isFormatterApplied: boolean;
  pageNumber: number | null;
  pageSize: PdfRenderedPageSize;
  workspace: PdfWorkspace;
}) {
  if (!isFormatterApplied) {
    return null;
  }

  const settings = workspace.formatterSettings;
  const crop = settings.cropMargins;
  const headerText = settings.headerText.trim();
  const footerText = settings.footerText.trim();
  const watermarkText = settings.watermarkText.trim();
  const pageNumberPositionClass = `pdf-page-number-${settings.pageNumberPosition}`;
  const fontFamily = getFormatterFontCssFamily(settings.fontFamily);

  return (
    <div className="formatter-preview-layer" style={{ fontFamily }} aria-hidden="true">
      {headerText ? <div className="formatter-preview-header">{headerText}</div> : null}
      {footerText ? <div className="formatter-preview-footer">{footerText}</div> : null}
      {pageNumber !== null ? (
        <div className={`formatter-preview-page-number ${pageNumberPositionClass}`}>
          {pageNumber}
        </div>
      ) : null}
      {watermarkText ? (
        <div
          className="formatter-preview-watermark"
          style={{ opacity: Math.min(1, Math.max(0, settings.watermarkOpacity)) }}
        >
          {watermarkText}
        </div>
      ) : null}
      {crop.top || crop.right || crop.bottom || crop.left ? (
        <div
          className="formatter-preview-crop"
          style={{
            inset: `${(crop.top / pageSize.height) * 100}% ${(crop.right / pageSize.width) * 100}% ${(crop.bottom / pageSize.height) * 100}% ${(crop.left / pageSize.width) * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

function GeneratedPagePreview({ page }: { page: PdfPageItem }) {
  if (!isGeneratedPageItem(page)) {
    return null;
  }

  if (page.generatedPageType === 'blank') {
    return <div className="generated-page-preview" />;
  }

  return (
    <div className="generated-page-preview generated-cover-preview">
      <div>
        <h2>{page.coverTitle || 'Cover Page'}</h2>
        {page.coverSubtitle ? <p>{page.coverSubtitle}</p> : null}
      </div>
      {page.coverDate ? <span>{page.coverDate}</span> : null}
    </div>
  );
}

function getLayerPointFromClient(
  clientX: number,
  clientY: number,
  layer: HTMLDivElement,
  pageSize: PdfRenderedPageSize,
  scale: number,
): TextSelectionPoint {
  const layerRect = layer.getBoundingClientRect();

  return clampPointToPage(
    {
      x: (clientX - layerRect.left) / scale,
      y: (clientY - layerRect.top) / scale,
    },
    pageSize,
  );
}

function getLayerPoint(
  event: Pick<
    MouseEvent | ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
    'clientX' | 'clientY'
  >,
  layer: HTMLDivElement,
  pageSize: PdfRenderedPageSize,
  scale: number,
): TextSelectionPoint {
  return getLayerPointFromClient(event.clientX, event.clientY, layer, pageSize, scale);
}

function safelySetPointerCapture(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // WKWebView can reject pointer capture even when Pointer Events exist.
  }
}

function safelyReleasePointerCapture(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Pointer capture is a convenience; selection still works without it.
  }
}

// Locates the whitespace-delimited word under a client point using the
// rendered pdf.js text layer, whose spans carry exact per-glyph geometry.
// This stays accurate for proportional fonts where dividing an item's width
// evenly across its characters lands on the wrong word.
function getWordAtClientPoint(
  textLayer: HTMLDivElement,
  clientX: number,
  clientY: number,
): { rect: DOMRect; text: string; textBoxId?: string } | null {
  const range = document.createRange();

  for (const span of textLayer.querySelectorAll('span')) {
    const textNode = span.firstChild;

    if (!(textNode instanceof Text) || !textNode.data.trim()) {
      continue;
    }

    const spanRect = span.getBoundingClientRect();

    if (
      spanRect.width <= 0 ||
      spanRect.height <= 0 ||
      clientX < spanRect.left ||
      clientX > spanRect.right ||
      clientY < spanRect.top ||
      clientY > spanRect.bottom
    ) {
      continue;
    }

    const text = textNode.data;
    let hitIndex = -1;

    for (let index = 0; index < text.length; index += 1) {
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);

      const characterRect = range.getBoundingClientRect();

      if (clientX >= characterRect.left && clientX <= characterRect.right) {
        hitIndex = index;
        break;
      }
    }

    if (hitIndex < 0 || /\s/.test(text[hitIndex])) {
      continue;
    }

    let startIndex = hitIndex;
    let endIndex = hitIndex + 1;

    while (startIndex > 0 && !/\s/.test(text[startIndex - 1])) {
      startIndex -= 1;
    }

    while (endIndex < text.length && !/\s/.test(text[endIndex])) {
      endIndex += 1;
    }

    range.setStart(textNode, startIndex);
    range.setEnd(textNode, endIndex);

    return {
      rect: range.getBoundingClientRect(),
      text: text.slice(startIndex, endIndex),
      textBoxId: span.dataset.textBoxId,
    };
  }

  return null;
}

function countTextOccurrences(text: string, query: string): number {
  if (!query) {
    return 0;
  }

  let count = 0;
  let nextIndex = text.indexOf(query);

  while (nextIndex >= 0) {
    count += 1;
    nextIndex = text.indexOf(query, nextIndex + query.length);
  }

  return count;
}

function PdfTextLayer({
  layerRef,
  onCommentSelection,
  onEditTextSelection,
  pageNumber,
  pageSize,
  scale,
  shouldCreateComment,
  shouldCreateTextEdit,
  textBoxes,
}: {
  layerRef: { current: HTMLDivElement | null };
  onCommentSelection: (rects: TextSelectionRect[], text: string) => void;
  onEditTextSelection: (selection: EmbeddedTextSelectionResult) => void;
  pageNumber: number | null;
  pageSize: PdfRenderedPageSize;
  scale: number;
  shouldCreateComment: boolean;
  shouldCreateTextEdit: boolean;
  textBoxes: EmbeddedTextBox[];
}) {
  const dragSelectionRef = useRef<TextSelectionDrag | null>(null);
  const selectionLayerRef = useRef<HTMLDivElement | null>(null);
  const [dragSelectionRects, setDragSelectionRects] = useState<TextSelectionRect[]>([]);
  const shouldUsePointerSelection = shouldCreateComment || shouldCreateTextEdit;

  const getSelectionFromClient = useCallback(
    (
      clientX: number,
      clientY: number,
      layer: HTMLDivElement,
    ): {
      area: TextSelectionRect | null;
      selection: EmbeddedTextSelectionResult;
    } => {
      const dragSelection = dragSelectionRef.current;

      if (!dragSelection) {
        return {
          area: null,
          selection: emptyEmbeddedTextSelection,
        };
      }

      const currentPoint = getLayerPointFromClient(clientX, clientY, layer, pageSize, scale);
      const area = getSelectionArea(dragSelection.startPoint, currentPoint, pageSize);

      return {
        area,
        selection: selectEmbeddedTextBoxes({
          area,
          boxes: textBoxes,
          pageSize,
          scale,
        }),
      };
    },
    [pageSize, scale, textBoxes],
  );

  const clearPointerSelection = useCallback(() => {
    dragSelectionRef.current = null;
    setDragSelectionRects([]);
    selectionLayerRef.current?.classList.remove('selecting');
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!shouldUsePointerSelection || event.button !== 0 || dragSelectionRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragSelectionRef.current = {
        input: 'pointer',
        pointerId: event.pointerId,
        startClientPoint: { x: event.clientX, y: event.clientY },
        startPoint: getLayerPoint(event, event.currentTarget, pageSize, scale),
      };
      event.currentTarget.classList.add('selecting');
      safelySetPointerCapture(event.currentTarget, event.pointerId);
      setDragSelectionRects([]);
    },
    [pageSize, scale, shouldUsePointerSelection],
  );

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!shouldUsePointerSelection || event.button !== 0 || dragSelectionRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragSelectionRef.current = {
        input: 'mouse',
        startClientPoint: { x: event.clientX, y: event.clientY },
        startPoint: getLayerPoint(event, event.currentTarget, pageSize, scale),
      };
      event.currentTarget.classList.add('selecting');
      setDragSelectionRects([]);
    },
    [pageSize, scale, shouldUsePointerSelection],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragSelection = dragSelectionRef.current;

      if (
        !dragSelection ||
        dragSelection.input !== 'pointer' ||
        dragSelection.pointerId !== event.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setDragSelectionRects(
        getSelectionFromClient(event.clientX, event.clientY, event.currentTarget).selection.rects,
      );
    },
    [getSelectionFromClient],
  );

  const finishSelection = useCallback(
    ({ clientX, clientY, layer }: { clientX: number; clientY: number; layer: HTMLDivElement }) => {
      const dragSelection = dragSelectionRef.current;

      if (!dragSelection) {
        return;
      }

      const selectionSnapshot = getSelectionFromClient(clientX, clientY, layer);
      const selection = selectionSnapshot.selection;

      logEmbeddedTextSelectionDiagnostics({
        devicePixelRatio: window.devicePixelRatio || 1,
        dragEndClient: { x: clientX, y: clientY },
        dragStartClient: dragSelection.startClientPoint,
        intersectedBoxCount: selection.selectedBoxCount,
        pageLocalSelectionRect: selectionSnapshot.area,
        pageNumber,
        reconstructedTextLength: selection.text.length,
        scale,
      });

      clearPointerSelection();

      if (shouldCreateComment && selection.rects.length > 0) {
        onCommentSelection(selection.rects, selection.text);
      }

      if (shouldCreateTextEdit && selection.rects.length > 0 && selection.text) {
        onEditTextSelection(selection);
      }
    },
    [
      clearPointerSelection,
      getSelectionFromClient,
      onEditTextSelection,
      onCommentSelection,
      pageNumber,
      scale,
      shouldCreateComment,
      shouldCreateTextEdit,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragSelection = dragSelectionRef.current;

      if (
        !dragSelection ||
        dragSelection.input !== 'pointer' ||
        dragSelection.pointerId !== event.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
      finishSelection({
        clientX: event.clientX,
        clientY: event.clientY,
        layer: event.currentTarget,
      });
    },
    [finishSelection],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!shouldUsePointerSelection) {
        return;
      }

      // Estimated selection also supplies the font info for the exact match.
      let selection = selectWordAtEmbeddedTextPoint({
        boxes: textBoxes,
        pageSize,
        point: getLayerPoint(event, event.currentTarget, pageSize, scale),
        scale,
      });
      const textLayerElement = layerRef.current;
      const exactWord =
        textLayerElement && scale > 0
          ? getWordAtClientPoint(textLayerElement, event.clientX, event.clientY)
          : null;
      // Rotated runs stay on the geometric path: it emits a rect that carries
      // the run's rotation, while the DOM range only yields an axis-aligned
      // bounding box that smears diagonal text.
      const exactWordBox = exactWord?.textBoxId
        ? textBoxes.find((box) => box.id === exactWord.textBoxId)
        : undefined;
      const isExactWordRotated = Boolean(
        exactWordBox?.angle && Math.abs(exactWordBox.angle) >= 0.005,
      );

      if (exactWord && textLayerElement && !isExactWordRotated) {
        const layerRect = textLayerElement.getBoundingClientRect();
        const wordRect = clampRectToPage(
          {
            x: (exactWord.rect.left - layerRect.left) / scale,
            y: (exactWord.rect.top - layerRect.top) / scale,
            width: exactWord.rect.width / scale,
            height: exactWord.rect.height / scale,
          },
          pageSize,
        );

        if (wordRect.width > 0 && wordRect.height > 0) {
          selection = createEmbeddedTextSelectionFromItems(
            [
              {
                fontFallback: selection.font?.fallback,
                fontName: selection.font?.name,
                fontSize: selection.font?.size,
                rect: wordRect,
                text: exactWord.text,
              },
            ],
            pageSize,
          );
        }
      }

      if (selection.rects.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearPointerSelection();

      if (shouldCreateComment) {
        onCommentSelection(selection.rects, selection.text);
      }

      if (shouldCreateTextEdit && selection.text) {
        onEditTextSelection(selection);
      }
    },
    [
      clearPointerSelection,
      layerRef,
      onCommentSelection,
      onEditTextSelection,
      pageSize,
      scale,
      shouldCreateComment,
      shouldCreateTextEdit,
      shouldUsePointerSelection,
      textBoxes,
    ],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragSelection = dragSelectionRef.current;

      if (
        !dragSelection ||
        dragSelection.input !== 'pointer' ||
        dragSelection.pointerId !== event.pointerId
      ) {
        return;
      }

      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
      clearPointerSelection();
    },
    [clearPointerSelection],
  );

  useEffect(() => {
    const handleDocumentMouseMove = (event: MouseEvent) => {
      const dragSelection = dragSelectionRef.current;
      const layer = selectionLayerRef.current;

      if (!dragSelection || dragSelection.input !== 'mouse' || !layer) {
        return;
      }

      event.preventDefault();
      setDragSelectionRects(
        getSelectionFromClient(event.clientX, event.clientY, layer).selection.rects,
      );
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const dragSelection = dragSelectionRef.current;
      const layer = selectionLayerRef.current;

      if (!dragSelection || dragSelection.input !== 'mouse' || !layer) {
        return;
      }

      event.preventDefault();
      finishSelection({
        clientX: event.clientX,
        clientY: event.clientY,
        layer,
      });
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [finishSelection, getSelectionFromClient]);

  useEffect(() => {
    clearPointerSelection();
  }, [clearPointerSelection, shouldCreateComment, shouldCreateTextEdit, textBoxes]);

  const layerStyle = {
    height: `${pageSize.height * scale}px`,
    width: `${pageSize.width * scale}px`,
  };

  return (
    <>
      <div
        className="pdf-text-layer textLayer"
        data-annotation-selection={shouldUsePointerSelection ? 'true' : undefined}
        data-comment-mode={shouldCreateComment ? 'true' : undefined}
        data-text-edit-mode={shouldCreateTextEdit ? 'true' : undefined}
        ref={(element) => {
          layerRef.current = element;
        }}
        style={layerStyle}
      />
      {shouldUsePointerSelection ? (
        <div
          aria-hidden="true"
          className="pdf-text-selection-capture-layer"
          data-comment-mode={shouldCreateComment ? 'true' : undefined}
          data-text-edit-mode={shouldCreateTextEdit ? 'true' : undefined}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={selectionLayerRef}
          style={layerStyle}
        />
      ) : null}
      {dragSelectionRects.length > 0 ? (
        <div aria-hidden="true" className="pdf-text-selection-layer" style={layerStyle}>
          {dragSelectionRects.map((rect, index) => (
            <div
              className="pdf-text-selection-rect"
              key={`${index}-${rect.x}-${rect.y}-${rect.width}-${rect.height}`}
              style={{
                height: `${rect.height * scale}px`,
                left: `${rect.x * scale}px`,
                top: `${rect.y * scale}px`,
                transform: rect.rotation ? `rotate(${rect.rotation}deg)` : undefined,
                transformOrigin: rect.rotation ? 'top left' : undefined,
                width: `${rect.width * scale}px`,
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function PdfViewer({
  activeAnnotationTool,
  annotationBorderColor,
  annotationColor,
  annotationFillColor,
  annotationStrokeWidth,
  eraserSize,
  freehandSensitivity,
  highlightBrushSize,
  highlightOpacity,
  isAnnotating,
  onChangeFormFieldValue,
  onCommitAnnotationChange,
  onCreateAnnotation,
  onEraseAnnotationPixels,
  onSelectAnnotation,
  onUpdateAnnotationPasteTarget,
  onUpdateAnnotation,
  selectedAnnotationId,
  spacebarFreehandEnabled,
  signatureImage,
  textSearchActiveResult,
  textSearchQuery = '',
  workspace,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageSize, setPageSize] = useState<PdfRenderedPageSize | null>(null);
  const [hasTextLayer, setHasTextLayer] = useState(false);
  const [embeddedTextBoxes, setEmbeddedTextBoxes] = useState<EmbeddedTextBox[]>([]);
  const [renderState, setRenderState] = useState<RenderState>('idle');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [readyPageId, setReadyPageId] = useState<string | null>(null);

  const activePage = useMemo(() => resolveActivePage(workspace), [workspace]);
  const sourceDocument = useMemo(
    () => resolveSourceDocument(workspace, activePage),
    [activePage, workspace],
  );
  const isFormatterApplied = activePage ? shouldApplyFormatterToPage(workspace, activePage) : false;
  const displayPageSize = useMemo(() => {
    if (!activePage || !pageSize || !isFormatterApplied) {
      return pageSize;
    }

    return getResizeDimensions(workspace.formatterSettings, activePage) ?? pageSize;
  }, [activePage, isFormatterApplied, pageSize, workspace.formatterSettings]);

  const renderScale = useMemo(() => {
    if (workspace.formatterSettings.fitMode === 'actual-size') {
      return 1;
    }

    if (
      workspace.formatterSettings.fitMode === 'width' &&
      displayPageSize?.width &&
      containerWidth
    ) {
      return clampScale((containerWidth - fitWidthHorizontalPadding) / displayPageSize.width);
    }

    return clampScale(workspace.formatterSettings.zoom);
  }, [
    containerWidth,
    displayPageSize,
    workspace.formatterSettings.fitMode,
    workspace.formatterSettings.zoom,
  ]);
  const sourceContentScale = useMemo(() => {
    if (!activePage || !pageSize || !displayPageSize || isGeneratedPageItem(activePage)) {
      return 1;
    }

    return Math.min(
      displayPageSize.width / pageSize.width,
      displayPageSize.height / pageSize.height,
    );
  }, [activePage, displayPageSize, pageSize]);
  const sourceRenderScale = renderScale * sourceContentScale;

  useEffect(() => {
    const viewerElement = viewerRef.current;

    if (!viewerElement) {
      return undefined;
    }

    setContainerWidth(viewerElement.clientWidth);

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });

    resizeObserver.observe(viewerElement);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    let isStale = false;

    setHasTextLayer(false);
    setEmbeddedTextBoxes([]);

    if (!activePage) {
      setPageSize(null);
      return undefined;
    }

    const generatedPageSize = getGeneratedPageSize(activePage);

    if (generatedPageSize) {
      setPageSize(generatedPageSize);
      return undefined;
    }

    if (!sourceDocument || !isSourcePageItem(activePage)) {
      setPageSize(null);
      return undefined;
    }

    getPdfPageSize(sourceDocument, activePage)
      .then((size) => {
        if (!isStale) {
          setPageSize(size);
        }
      })
      .catch(() => {
        if (!isStale) {
          setPageSize(null);
        }
      });

    return () => {
      isStale = true;
    };
  }, [activePage, sourceDocument]);

  useEffect(() => {
    let isStale = false;
    const textLayerElement = textLayerRef.current;

    setHasTextLayer(false);
    setEmbeddedTextBoxes([]);

    if (
      !textLayerElement ||
      !pageSize ||
      !activePage ||
      !sourceDocument ||
      !isSourcePageItem(activePage)
    ) {
      return undefined;
    }

    renderPdfPageTextLayer({
      container: textLayerElement,
      page: activePage,
      scale: sourceRenderScale,
      sourceDocument,
    })
      .then((result) => {
        if (!isStale) {
          const textSpans = Array.from(textLayerElement.querySelectorAll('span'));
          const renderedTextSpansWithNonEmptyText = textSpans.filter((span) =>
            span.textContent?.trim(),
          ).length;
          const renderedTextSpansWithNonZeroRect = textSpans.filter((span) => {
            const rect = span.getBoundingClientRect();

            return rect.width > 0 && rect.height > 0;
          }).length;

          setEmbeddedTextBoxes(result.boxes);
          setHasTextLayer(result.boxes.length > 0);
          logEmbeddedTextPageDiagnostics({
            devicePixelRatio: window.devicePixelRatio || 1,
            firstTextStrings: result.firstTextStrings,
            getTextContentSucceeded: true,
            pageContainerRect: textLayerElement.getBoundingClientRect(),
            pageNumber: activePage.displayIndex,
            renderedTextBoxCount: result.boxes.length,
            renderedTextSpanCount: textSpans.length,
            renderedTextSpansWithNonEmptyText,
            renderedTextSpansWithNonZeroRect,
            scale: sourceRenderScale,
            textContentItemCount: result.itemCount,
            workerSrc: result.workerSrc,
          });
        }
      })
      .catch((error: unknown) => {
        if (!isStale) {
          textLayerElement.replaceChildren();
          setEmbeddedTextBoxes([]);
          setHasTextLayer(false);
          logEmbeddedTextPageDiagnostics({
            devicePixelRatio: window.devicePixelRatio || 1,
            error,
            firstTextStrings: [],
            getTextContentSucceeded: false,
            pageContainerRect: textLayerElement.getBoundingClientRect(),
            pageNumber: activePage.displayIndex,
            renderedTextBoxCount: 0,
            renderedTextSpanCount: 0,
            renderedTextSpansWithNonEmptyText: 0,
            renderedTextSpansWithNonZeroRect: 0,
            scale: sourceRenderScale,
            textContentItemCount: 0,
          });
        }
      });

    return () => {
      isStale = true;
      textLayerElement.replaceChildren();
    };
  }, [activePage, pageSize, sourceDocument, sourceRenderScale]);

  useEffect(() => {
    const textLayerElement = textLayerRef.current;
    const normalizedSearchQuery = textSearchQuery.trim().toLowerCase();

    if (!textLayerElement) {
      return;
    }

    const textSpans = Array.from(textLayerElement.querySelectorAll('span'));
    let pageMatchIndex = 0;

    for (const span of textSpans) {
      const spanText = (span.textContent ?? '').toLowerCase();
      const spanMatchCount = countTextOccurrences(spanText, normalizedSearchQuery);
      const isMatch = Boolean(normalizedSearchQuery) && spanMatchCount > 0;

      if (isMatch) {
        span.setAttribute('data-search-match', 'true');

        const activeSearchResult = textSearchActiveResult;
        const isActiveSearchMatch = activeSearchResult
          ? activeSearchResult.pageId === activePage?.id &&
            activeSearchResult.pageMatchIndex >= pageMatchIndex &&
            activeSearchResult.pageMatchIndex < pageMatchIndex + spanMatchCount
          : false;

        if (isActiveSearchMatch) {
          span.setAttribute('data-active-search-match', 'true');
        } else {
          span.removeAttribute('data-active-search-match');
        }

        pageMatchIndex += spanMatchCount;
      } else {
        span.removeAttribute('data-search-match');
        span.removeAttribute('data-active-search-match');
      }
    }
  }, [activePage?.id, hasTextLayer, textSearchActiveResult, textSearchQuery]);

  useEffect(() => {
    let isStale = false;
    const canvas = canvasRef.current;

    if (!canvas || !activePage) {
      return undefined;
    }

    if (isGeneratedPageItem(activePage)) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.width = '0';
      canvas.style.height = '0';
      setReadyPageId(activePage.id);
      setRenderState('ready');
      setRenderError(null);
      return undefined;
    }

    if (!sourceDocument) {
      return undefined;
    }

    setRenderState('loading');
    setRenderError(null);

    const draftCanvas = document.createElement('canvas');

    renderPdfPageToCanvas({
      canvas: draftCanvas,
      interactiveForms: true,
      page: activePage,
      scale: sourceRenderScale,
      sourceDocument,
    })
      .then(() => {
        if (isStale) {
          return;
        }

        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Unable to get 2D canvas context for PDF rendering.');
        }

        canvas.width = draftCanvas.width;
        canvas.height = draftCanvas.height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(draftCanvas, 0, 0);
        setReadyPageId(activePage.id);
        setRenderState('ready');
      })
      .catch(() => {
        if (!isStale) {
          setRenderState('error');
          setRenderError('Paperdesk could not render this page.');
        }
      });

    return () => {
      isStale = true;
    };
  }, [activePage, sourceDocument, sourceRenderScale]);

  if (!activePage || (!sourceDocument && !isGeneratedPageItem(activePage))) {
    return (
      <div className="workspace-state-card" role="status">
        <h2>No page selected</h2>
        <p>Select a page from the sidebar.</p>
      </div>
    );
  }

  const previewPageNumber = getPreviewPageNumber(workspace, activePage);
  const activePageAnnotations = workspace.annotations.filter(
    (annotation) => annotation.pageItemId === activePage.id,
  );
  const visibleRenderState =
    renderState === 'error' || readyPageId === activePage.id ? renderState : 'loading';
  const frameStyle = displayPageSize
    ? {
        height: `${displayPageSize.height * renderScale}px`,
        width: `${displayPageSize.width * renderScale}px`,
      }
    : undefined;
  const sourceLayerStyle =
    pageSize && displayPageSize && !isGeneratedPageItem(activePage)
      ? {
          height: `${pageSize.height * sourceRenderScale}px`,
          left: `${(displayPageSize.width * renderScale - pageSize.width * sourceRenderScale) / 2}px`,
          top: `${(displayPageSize.height * renderScale - pageSize.height * sourceRenderScale) / 2}px`,
          width: `${pageSize.width * sourceRenderScale}px`,
        }
      : undefined;
  const handleCommentTextSelection = (rects: TextSelectionRect[]) => {
    if (!activePage || !pageSize) {
      return;
    }

    const commentRect = getCommentRectFromSelection(rects, pageSize);

    if (!commentRect) {
      return;
    }

    const commentAnnotationId = onCreateAnnotation({
      pageItemId: activePage.id,
      type: 'text-note',
      ...commentRect,
      content: 'Comment',
      borderColor: getDefaultAnnotationBorderColor('text-note'),
      color: getDefaultAnnotationColor('text-note'),
      fillColor: getDefaultAnnotationFillColor('text-note'),
    });

    const highlightRects = getNonLayeredHighlightRects({
      // Freehand highlighter strokes carry a `points` path whose bounding
      // box overstates their actual ink coverage — only rect-shaped
      // highlights (this comment tool's own call-outs, or legacy saved
      // ones) represent solid coverage worth subtracting from.
      existingHighlights: activePageAnnotations.filter(
        (annotation) => annotation.type === 'highlight' && !annotation.points,
      ),
      pageSize,
      rects,
    });

    for (const rect of highlightRects) {
      onCreateAnnotation({
        pageItemId: activePage.id,
        type: 'highlight',
        ...rect,
        color: getDefaultAnnotationColor('highlight'),
        linkedCommentId: commentAnnotationId,
      });
    }

    onSelectAnnotation(commentAnnotationId);
  };
  const handleEditTextSelection = (selection: EmbeddedTextSelectionResult) => {
    if (!activePage || !pageSize || !selection.tightRect || !selection.text) {
      return;
    }

    // Pad slightly so the patch fully covers the original glyphs, including
    // antialiased edges, then keep the annotation aligned with the source
    // lines so the replacement reads as in-place text.
    const padding = 1.5;
    const rect = clampRectToPage(
      {
        x: selection.tightRect.x - padding,
        y: selection.tightRect.y - padding,
        width: selection.tightRect.width + padding * 2,
        height: selection.tightRect.height + padding * 2,
      },
      pageSize,
    );
    const canvas = canvasRef.current;
    const sampledBackground = canvas
      ? sampleCanvasBackgroundColor(canvas, selection.tightRect, pageSize)
      : null;
    const selectionFont = selection.font;
    const lineHeight =
      selection.lineCount > 0 ? selection.tightRect.height / selection.lineCount : undefined;

    void (async () => {
      const rawFontName =
        selectionFont?.name && sourceDocument && isSourcePageItem(activePage)
          ? await getPdfPageFontRawName(sourceDocument, activePage, selectionFont.name)
          : null;
      const recognizedFont = recognizePdfFontName(
        rawFontName ?? undefined,
        selectionFont?.fallback,
      );
      const annotationId = onCreateAnnotation({
        pageItemId: activePage.id,
        type: 'text-edit',
        ...rect,
        content: selection.text,
        borderColor: transparentAnnotationColor,
        color: annotationColor,
        fillColor: sampledBackground ?? '#ffffff',
        fontId: recognizedFont.fontId,
        fontBold: recognizedFont.bold,
        fontItalic: recognizedFont.italic,
        fontSize: normalizeAnnotationFontSize(selectionFont?.size),
        lineHeight,
        embeddedFontName: selectionFont?.name,
        sourceFontLabel: rawFontName ? stripFontSubsetPrefix(rawFontName) : undefined,
      });

      onSelectAnnotation(annotationId);
    })();
  };
  const handleSourcePagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pageSize) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    onUpdateAnnotationPasteTarget({
      pageItemId: activePage.id,
      point: {
        x: Math.min(
          pageSize.width,
          Math.max(0, ((event.clientX - rect.left) / rect.width) * pageSize.width),
        ),
        y: Math.min(
          pageSize.height,
          Math.max(0, ((event.clientY - rect.top) / rect.height) * pageSize.height),
        ),
      },
    });
  };

  return (
    <div className="pdf-viewer" ref={viewerRef}>
      {renderError ? (
        <div className="workspace-error compact" role="alert">
          <h2>Render failed</h2>
          <p>{renderError}</p>
        </div>
      ) : null}

      <div
        aria-busy={visibleRenderState === 'loading' ? 'true' : undefined}
        className="pdf-page-frame"
        data-render-state={visibleRenderState}
        style={frameStyle}
      >
        {isGeneratedPageItem(activePage) ? <GeneratedPagePreview page={activePage} /> : null}
        {!isGeneratedPageItem(activePage) ? (
          <div
            className="pdf-source-page-layer"
            onPointerMove={handleSourcePagePointerMove}
            style={sourceLayerStyle}
          >
            <canvas className="pdf-page-canvas" ref={canvasRef} />
            {pageSize ? (
              <PdfTextLayer
                layerRef={textLayerRef}
                onCommentSelection={handleCommentTextSelection}
                onEditTextSelection={handleEditTextSelection}
                pageNumber={activePage.displayIndex}
                pageSize={pageSize}
                scale={sourceRenderScale}
                shouldCreateComment={isAnnotating && activeAnnotationTool === 'text-note'}
                shouldCreateTextEdit={isAnnotating && activeAnnotationTool === 'edit-text'}
                textBoxes={embeddedTextBoxes}
              />
            ) : null}
            {pageSize && sourceDocument ? (
              <FormFieldLayer
                disabled={isAnnotating}
                onChangeFieldValue={(fieldName, value) =>
                  onChangeFormFieldValue(sourceDocument.id, fieldName, value)
                }
                page={activePage}
                scale={sourceRenderScale}
                sourceDocument={sourceDocument}
                values={workspace.formFieldValues[sourceDocument.id] ?? {}}
              />
            ) : null}
            {pageSize ? (
              <AnnotationLayer
                activeTool={activeAnnotationTool}
                annotationBorderColor={annotationBorderColor}
                annotationColor={annotationColor}
                annotationFillColor={annotationFillColor}
                annotationStrokeWidth={annotationStrokeWidth}
                annotations={activePageAnnotations}
                eraserSize={eraserSize}
                freehandSensitivity={freehandSensitivity}
                highlightBrushSize={highlightBrushSize}
                highlightOpacity={highlightOpacity}
                isAnnotating={isAnnotating}
                onCommitAnnotationChange={onCommitAnnotationChange}
                onCreateAnnotation={onCreateAnnotation}
                onEraseAnnotationPixels={onEraseAnnotationPixels}
                onSelectAnnotation={onSelectAnnotation}
                onUpdateAnnotation={onUpdateAnnotation}
                page={activePage}
                pageSize={pageSize}
                selectedAnnotationId={selectedAnnotationId}
                spacebarFreehandEnabled={spacebarFreehandEnabled}
                signatureImage={signatureImage}
              />
            ) : null}
          </div>
        ) : (
          <canvas className="pdf-page-canvas" ref={canvasRef} />
        )}
        {displayPageSize ? (
          <FormatterPreviewOverlay
            isFormatterApplied={isFormatterApplied}
            pageNumber={previewPageNumber}
            pageSize={displayPageSize}
            workspace={workspace}
          />
        ) : null}
      </div>
    </div>
  );
}
