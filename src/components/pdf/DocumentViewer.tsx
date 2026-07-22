import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import type {
  PdfAnnotation,
  PdfAnnotationEraseReplacement,
  PdfAnnotationPasteTarget,
  PdfAnnotationId,
  PdfAnnotationTool,
  PdfFormFieldValue,
  PdfWorkspace,
} from '../../lib/pdf/types';
import type { FreehandSensitivity } from '../../lib/pdf/annotationStroke';
import type { PdfTextSearchResult } from '../../lib/pdf/pdfTextSearch';
import { EmptyWorkspace } from './EmptyWorkspace';
import { PdfViewer } from './PdfViewer';

type DocumentViewerProps = {
  activeAnnotationTool: PdfAnnotationTool;
  annotationBorderColor: string;
  annotationColor: string;
  annotationFillColor: string;
  annotationStrokeWidth: number;
  canGoNext: boolean;
  canGoPrevious: boolean;
  error: string | null;
  eraserSize: number;
  freehandSensitivity: FreehandSensitivity;
  highlightBrushSize: number;
  highlightOpacity: number;
  isAnnotating: boolean;
  isHandToolActive: boolean;
  isLoading: boolean;
  loadingMessage: string;
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
  onNavigatePage: (direction: -1 | 1) => void;
  onSelectAnnotation: (annotationId: PdfAnnotationId | null) => void;
  onUpdateAnnotationPasteTarget: (target: PdfAnnotationPasteTarget | null) => void;
  onUpdateAnnotation: (annotationId: PdfAnnotationId, patch: Partial<PdfAnnotation>) => void;
  onWheelZoom: (deltaY: number) => void;
  onZoomByFactor: (zoomFactor: number) => void;
  selectedAnnotationId: PdfAnnotationId | null;
  spacebarFreehandEnabled: boolean;
  signatureImage: {
    bytes: number[];
    dataUrl: string;
    mimeType: 'image/png' | 'image/jpeg';
  } | null;
  textSearchActiveResult?: PdfTextSearchResult | null;
  textSearchQuery?: string;
  workspace: PdfWorkspace | null;
};

const edgeScrollTolerance = 2;
const wheelNavigationCooldownMs = 260;
const wheelNavigationThreshold = 36;
const wheelDeltaLineMode = 1;
const wheelDeltaPageMode = 2;
const wheelLineHeight = 16;
const trackpadZoomEventOptions = { capture: true, passive: false };

type TrackpadGestureEvent = Event & {
  clientX?: number;
  clientY?: number;
  scale?: number;
};

type WheelDeltaEvent = {
  deltaX?: number;
  deltaMode: number;
  deltaY: number;
};

type ZoomFocusPoint = {
  clientX?: number;
  clientY?: number;
};

type ZoomAnchor = {
  contentX: number;
  contentY: number;
  viewportX: number;
  viewportY: number;
  zoom: number;
};

type HandPanDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

function getNormalizedWheelDelta(event: WheelDeltaEvent, viewportHeight: number): number {
  if (event.deltaMode === wheelDeltaLineMode) {
    return event.deltaY * wheelLineHeight;
  }

  if (event.deltaMode === wheelDeltaPageMode) {
    return event.deltaY * viewportHeight;
  }

  return event.deltaY;
}

function isEventInsideElement(event: Event, element: HTMLElement): boolean {
  const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : [];

  if (composedPath.includes(element)) {
    return true;
  }

  return event.target instanceof Node && element.contains(event.target);
}

function getEventFocusPoint(event: ZoomFocusPoint): ZoomFocusPoint {
  return {
    clientX: Number.isFinite(event.clientX) ? event.clientX : undefined,
    clientY: Number.isFinite(event.clientY) ? event.clientY : undefined,
  };
}

function scrollViewerTo(viewer: HTMLElement, top: number, behavior: ScrollBehavior = 'auto') {
  if (typeof viewer.scrollTo !== 'function') {
    viewer.scrollTop = top;
    return;
  }

  viewer.scrollTo({
    behavior,
    left: viewer.scrollLeft,
    top,
  });
}

function setViewerPointerCapture(viewer: HTMLElement, pointerId: number) {
  if (typeof viewer.setPointerCapture !== 'function') {
    return;
  }

  try {
    viewer.setPointerCapture(pointerId);
  } catch {
    // Some test and embedded webview environments expose incomplete pointer capture support.
  }
}

function releaseViewerPointerCapture(viewer: HTMLElement, pointerId: number) {
  if (typeof viewer.releasePointerCapture !== 'function') {
    return;
  }

  try {
    if (typeof viewer.hasPointerCapture === 'function' && !viewer.hasPointerCapture(pointerId)) {
      return;
    }

    viewer.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already be gone after cancellation or window-level interruption.
  }
}

function PdfOpenError({ error }: { error: string }) {
  return (
    <div className="workspace-error" role="alert">
      <h2>Could not open PDF</h2>
      <p>{error}</p>
    </div>
  );
}

export function DocumentViewer({
  activeAnnotationTool,
  annotationBorderColor,
  annotationColor,
  annotationFillColor,
  annotationStrokeWidth,
  canGoNext,
  canGoPrevious,
  error,
  eraserSize,
  freehandSensitivity,
  highlightBrushSize,
  highlightOpacity,
  isAnnotating,
  isHandToolActive,
  isLoading,
  loadingMessage,
  onChangeFormFieldValue,
  onCommitAnnotationChange,
  onCreateAnnotation,
  onEraseAnnotationPixels,
  onNavigatePage,
  onSelectAnnotation,
  onUpdateAnnotationPasteTarget,
  onUpdateAnnotation,
  onWheelZoom,
  onZoomByFactor,
  selectedAnnotationId,
  spacebarFreehandEnabled,
  signatureImage,
  textSearchActiveResult,
  textSearchQuery,
  workspace,
}: DocumentViewerProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const handPanDragRef = useRef<HandPanDrag | null>(null);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const workspaceZoom = workspace?.formatterSettings.zoom;
  const workspaceZoomRef = useRef(workspaceZoom);
  const hasWorkspace = Boolean(workspace);
  const [isHandDragging, setIsHandDragging] = useState(false);
  const wheelNavigationRef = useRef({
    accumulatedDelta: 0,
    lastDirection: 0 as -1 | 0 | 1,
    lastNavigatedAt: 0,
    pendingScrollPosition: null as 'bottom' | 'top' | null,
  });
  const wheelZoomRef = useRef({
    accumulatedDelta: 0,
    animationFrameId: null as number | null,
    focusPoint: null as ZoomFocusPoint | null,
  });
  const trackpadGestureRef = useRef({
    accumulatedScaleFactor: 1,
    animationFrameId: null as number | null,
    focusPoint: null as ZoomFocusPoint | null,
    isActive: false,
    lastScale: 1,
  });

  const resetWheelNavigation = useCallback(() => {
    if (wheelNavigationRef.current.pendingScrollPosition) {
      wheelNavigationRef.current.pendingScrollPosition = null;
    }

    wheelNavigationRef.current.accumulatedDelta = 0;
    wheelNavigationRef.current.lastDirection = 0;
  }, []);

  useEffect(() => {
    workspaceZoomRef.current = workspaceZoom;
  }, [workspaceZoom]);

  // Reads the zoom through a ref so this callback (and the wheel/gesture
  // listeners built on it) stays stable across zoom updates. Re-registering
  // the trackpad gesture listeners mid-pinch resets the gesture tracking
  // state, which turns WebKit's cumulative gesture scale into runaway zoom.
  const captureZoomAnchor = useCallback((focusPoint: ZoomFocusPoint | null) => {
    const viewer = viewerRef.current;
    const zoom = workspaceZoomRef.current;

    if (!viewer || !Number.isFinite(zoom) || zoom === undefined || zoom <= 0) {
      return;
    }

    const rect = viewer.getBoundingClientRect();
    const viewportX =
      focusPoint?.clientX !== undefined ? focusPoint.clientX - rect.left : viewer.clientWidth / 2;
    const viewportY =
      focusPoint?.clientY !== undefined ? focusPoint.clientY - rect.top : viewer.clientHeight / 2;

    pendingZoomAnchorRef.current = {
      contentX: viewer.scrollLeft + viewportX,
      contentY: viewer.scrollTop + viewportY,
      viewportX,
      viewportY,
      zoom,
    };
  }, []);

  const queueWheelZoom = useCallback(
    (deltaY: number, focusPoint: ZoomFocusPoint | null) => {
      if (!Number.isFinite(deltaY) || deltaY === 0) {
        return;
      }

      const wheelZoom = wheelZoomRef.current;
      wheelZoom.accumulatedDelta += deltaY;
      wheelZoom.focusPoint = focusPoint;

      if (wheelZoom.animationFrameId === null) {
        wheelZoom.animationFrameId = window.requestAnimationFrame(() => {
          const accumulatedDeltaY = wheelZoom.accumulatedDelta;
          const accumulatedFocusPoint = wheelZoom.focusPoint;
          wheelZoom.accumulatedDelta = 0;
          wheelZoom.animationFrameId = null;
          wheelZoom.focusPoint = null;
          captureZoomAnchor(accumulatedFocusPoint);
          onWheelZoom(accumulatedDeltaY);
        });
      }
    },
    [captureZoomAnchor, onWheelZoom],
  );

  const applyTrackpadGestureZoom = useCallback(() => {
    const gesture = trackpadGestureRef.current;
    const zoomFactor = gesture.accumulatedScaleFactor;
    const focusPoint = gesture.focusPoint;
    gesture.accumulatedScaleFactor = 1;
    gesture.animationFrameId = null;

    if (!Number.isFinite(zoomFactor) || zoomFactor <= 0 || zoomFactor === 1) {
      return;
    }

    captureZoomAnchor(focusPoint);
    onZoomByFactor(zoomFactor);
  }, [captureZoomAnchor, onZoomByFactor]);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const viewer = viewerRef.current;
    const nextZoom = workspace?.formatterSettings.zoom;

    if (
      !anchor ||
      !viewer ||
      !Number.isFinite(nextZoom) ||
      nextZoom === undefined ||
      nextZoom <= 0
    ) {
      return;
    }

    pendingZoomAnchorRef.current = null;

    const zoomRatio = nextZoom / anchor.zoom;

    if (!Number.isFinite(zoomRatio) || zoomRatio <= 0 || zoomRatio === 1) {
      return;
    }

    viewer.scrollLeft = anchor.contentX * zoomRatio - anchor.viewportX;
    viewer.scrollTop = anchor.contentY * zoomRatio - anchor.viewportY;
  }, [workspace?.formatterSettings.zoom]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (workspace && !event.defaultPrevented && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();

        queueWheelZoom(
          getNormalizedWheelDelta(event, event.currentTarget.clientHeight),
          getEventFocusPoint(event),
        );
        resetWheelNavigation();
        return;
      }

      if (
        !workspace ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) {
        return;
      }

      const viewer = event.currentTarget;
      const maxScrollTop = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
      const direction: -1 | 1 = event.deltaY > 0 ? 1 : -1;
      const canNavigate = direction > 0 ? canGoNext : canGoPrevious;
      const isAtScrollEdge =
        direction > 0
          ? viewer.scrollTop >= maxScrollTop - edgeScrollTolerance
          : viewer.scrollTop <= edgeScrollTolerance;

      if (!canNavigate || !isAtScrollEdge) {
        wheelNavigationRef.current.accumulatedDelta = 0;
        wheelNavigationRef.current.lastDirection = 0;
        return;
      }

      const wheelNavigation = wheelNavigationRef.current;

      if (wheelNavigation.lastDirection !== direction) {
        wheelNavigation.accumulatedDelta = 0;
        wheelNavigation.lastDirection = direction;
      }

      const normalizedDeltaY = getNormalizedWheelDelta(event, viewer.clientHeight);

      event.preventDefault();
      wheelNavigation.accumulatedDelta += normalizedDeltaY;

      if (Math.abs(wheelNavigation.accumulatedDelta) < wheelNavigationThreshold) {
        return;
      }

      const now = window.performance.now();

      if (now - wheelNavigation.lastNavigatedAt < wheelNavigationCooldownMs) {
        event.preventDefault();
        return;
      }

      wheelNavigation.accumulatedDelta = 0;
      wheelNavigation.lastNavigatedAt = now;
      wheelNavigation.pendingScrollPosition = direction > 0 ? 'top' : 'bottom';
      onNavigatePage(direction);
    },
    [canGoNext, canGoPrevious, onNavigatePage, queueWheelZoom, resetWheelNavigation, workspace],
  );

  const endHandPanDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = handPanDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    releaseViewerPointerCapture(event.currentTarget, drag.pointerId);
    handPanDragRef.current = null;
    setIsHandDragging(false);
  }, []);

  const handleHandPanPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isHandToolActive || !workspace || event.button !== 0 || event.isPrimary === false) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const viewer = event.currentTarget;
      handPanDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollLeft: viewer.scrollLeft,
        startScrollTop: viewer.scrollTop,
      };
      setViewerPointerCapture(viewer, event.pointerId);
      setIsHandDragging(true);
      resetWheelNavigation();
    },
    [isHandToolActive, resetWheelNavigation, workspace],
  );

  const handleHandPanPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = handPanDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const viewer = event.currentTarget;
    viewer.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startClientX);
    viewer.scrollTop = drag.startScrollTop - (event.clientY - drag.startClientY);
  }, []);

  useEffect(() => {
    if (isHandToolActive) {
      return;
    }

    handPanDragRef.current = null;
    setIsHandDragging(false);
  }, [isHandToolActive]);

  useEffect(() => {
    const viewer = viewerRef.current;

    if (!hasWorkspace || !viewer) {
      return undefined;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        (!event.ctrlKey && !event.metaKey) ||
        !isEventInsideElement(event, viewer)
      ) {
        return;
      }

      event.preventDefault();
      queueWheelZoom(
        getNormalizedWheelDelta(event, viewer.clientHeight),
        getEventFocusPoint(event),
      );
      resetWheelNavigation();
    };

    window.addEventListener('wheel', handleNativeWheel, trackpadZoomEventOptions);

    return () => {
      window.removeEventListener('wheel', handleNativeWheel, trackpadZoomEventOptions);
    };
  }, [hasWorkspace, queueWheelZoom, resetWheelNavigation]);

  useEffect(() => {
    const wheelZoom = wheelZoomRef.current;
    const trackpadGesture = trackpadGestureRef.current;

    return () => {
      const wheelAnimationFrameId = wheelZoom.animationFrameId;

      if (wheelAnimationFrameId !== null) {
        window.cancelAnimationFrame(wheelAnimationFrameId);
      }

      wheelZoom.focusPoint = null;

      const gestureAnimationFrameId = trackpadGesture.animationFrameId;

      if (gestureAnimationFrameId !== null) {
        window.cancelAnimationFrame(gestureAnimationFrameId);
      }

      pendingZoomAnchorRef.current = null;
      trackpadGesture.focusPoint = null;
      trackpadGesture.isActive = false;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;

    if (!hasWorkspace || !viewer) {
      return undefined;
    }

    const gesture = trackpadGestureRef.current;

    const handleGestureStart = (event: Event) => {
      if (!isEventInsideElement(event, viewer)) {
        return;
      }

      const scale = (event as TrackpadGestureEvent).scale;

      if (!Number.isFinite(scale) || scale === undefined || scale <= 0) {
        return;
      }

      event.preventDefault();
      gesture.accumulatedScaleFactor = 1;
      gesture.focusPoint = getEventFocusPoint(event as TrackpadGestureEvent);
      gesture.isActive = true;
      gesture.lastScale = scale;
      resetWheelNavigation();
    };

    const handleGestureChange = (event: Event) => {
      if (!gesture.isActive && !isEventInsideElement(event, viewer)) {
        return;
      }

      const scale = (event as TrackpadGestureEvent).scale;

      if (!Number.isFinite(scale) || scale === undefined || scale <= 0) {
        return;
      }

      event.preventDefault();

      // WebKit gesture scale is cumulative since gesturestart, so the applied
      // factor must always be relative to the last observed scale, even if
      // the listener was re-registered mid-gesture.
      const previousScale = gesture.lastScale > 0 ? gesture.lastScale : 1;
      gesture.isActive = true;
      gesture.focusPoint = getEventFocusPoint(event as TrackpadGestureEvent);
      const scaleFactor = scale / previousScale;
      gesture.lastScale = scale;

      if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || scaleFactor === 1) {
        return;
      }

      gesture.accumulatedScaleFactor *= scaleFactor;

      if (gesture.animationFrameId === null) {
        gesture.animationFrameId = window.requestAnimationFrame(applyTrackpadGestureZoom);
      }

      resetWheelNavigation();
    };

    const handleGestureEnd = (event: Event) => {
      if (!gesture.isActive && !isEventInsideElement(event, viewer)) {
        return;
      }

      event.preventDefault();

      if (gesture.animationFrameId !== null) {
        window.cancelAnimationFrame(gesture.animationFrameId);
        applyTrackpadGestureZoom();
      }

      gesture.accumulatedScaleFactor = 1;
      gesture.focusPoint = null;
      gesture.isActive = false;
      gesture.lastScale = 1;
    };

    window.addEventListener('gesturestart', handleGestureStart, trackpadZoomEventOptions);
    window.addEventListener('gesturechange', handleGestureChange, trackpadZoomEventOptions);
    window.addEventListener('gestureend', handleGestureEnd, trackpadZoomEventOptions);
    window.addEventListener('gesturecancel', handleGestureEnd, trackpadZoomEventOptions);

    return () => {
      window.removeEventListener('gesturestart', handleGestureStart, trackpadZoomEventOptions);
      window.removeEventListener('gesturechange', handleGestureChange, trackpadZoomEventOptions);
      window.removeEventListener('gestureend', handleGestureEnd, trackpadZoomEventOptions);
      window.removeEventListener('gesturecancel', handleGestureEnd, trackpadZoomEventOptions);

      if (gesture.animationFrameId !== null) {
        window.cancelAnimationFrame(gesture.animationFrameId);
        gesture.animationFrameId = null;
      }

      gesture.focusPoint = null;
      gesture.isActive = false;
    };
  }, [applyTrackpadGestureZoom, hasWorkspace, resetWheelNavigation]);

  useEffect(() => {
    const pendingScrollPosition = wheelNavigationRef.current.pendingScrollPosition;
    const viewer = viewerRef.current;

    if (!pendingScrollPosition || !viewer) {
      return undefined;
    }

    wheelNavigationRef.current.pendingScrollPosition = null;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const scrollToPendingPosition = (behavior: ScrollBehavior) => {
      const targetScrollTop = pendingScrollPosition === 'bottom' ? viewer.scrollHeight : 0;
      scrollViewerTo(viewer, targetScrollTop, behavior);
    };

    let timeoutId: number | undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      scrollToPendingPosition(prefersReducedMotion ? 'auto' : 'smooth');
      timeoutId = window.setTimeout(() => scrollToPendingPosition('auto'), 80);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [workspace?.activePageId]);

  if (isLoading) {
    return (
      <section className="document-viewer" aria-label="Main document viewer" aria-busy="true">
        <div className="workspace-state-card">
          <div className="loading-spinner" aria-hidden="true" />
          <h2>Loading PDFs</h2>
          <p>{loadingMessage}</p>
        </div>
      </section>
    );
  }

  if (workspace) {
    return (
      <section
        className="document-viewer document-viewer-with-document"
        aria-label="Main document viewer"
        data-hand-dragging={isHandDragging ? 'true' : undefined}
        data-hand-tool={isHandToolActive ? 'true' : undefined}
        onLostPointerCaptureCapture={endHandPanDrag}
        onPointerCancelCapture={endHandPanDrag}
        onPointerDownCapture={handleHandPanPointerDown}
        onPointerMoveCapture={handleHandPanPointerMove}
        onPointerUpCapture={endHandPanDrag}
        onWheel={handleWheel}
        ref={viewerRef}
      >
        {error ? <PdfOpenError error={error} /> : null}
        <PdfViewer
          activeAnnotationTool={activeAnnotationTool}
          annotationBorderColor={annotationBorderColor}
          annotationColor={annotationColor}
          annotationFillColor={annotationFillColor}
          annotationStrokeWidth={annotationStrokeWidth}
          eraserSize={eraserSize}
          freehandSensitivity={freehandSensitivity}
          highlightBrushSize={highlightBrushSize}
          highlightOpacity={highlightOpacity}
          isAnnotating={isAnnotating}
          onChangeFormFieldValue={onChangeFormFieldValue}
          onCommitAnnotationChange={onCommitAnnotationChange}
          onCreateAnnotation={onCreateAnnotation}
          onEraseAnnotationPixels={onEraseAnnotationPixels}
          onSelectAnnotation={onSelectAnnotation}
          onUpdateAnnotationPasteTarget={onUpdateAnnotationPasteTarget}
          onUpdateAnnotation={onUpdateAnnotation}
          selectedAnnotationId={selectedAnnotationId}
          spacebarFreehandEnabled={spacebarFreehandEnabled}
          signatureImage={signatureImage}
          textSearchActiveResult={textSearchActiveResult}
          textSearchQuery={textSearchQuery}
          workspace={workspace}
        />
      </section>
    );
  }

  return (
    <section className="document-viewer" aria-label="Main document viewer" ref={viewerRef}>
      {error ? <PdfOpenError error={error} /> : null}
      <EmptyWorkspace />
    </section>
  );
}
