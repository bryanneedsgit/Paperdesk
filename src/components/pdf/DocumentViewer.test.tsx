import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { createDefaultFormatterSettings } from '../../lib/pdf/pdfWorkspace';
import type { PdfWorkspace } from '../../lib/pdf/types';
import { DocumentViewer } from './DocumentViewer';

vi.mock('./EmptyWorkspace', () => ({
  EmptyWorkspace: () => <div data-testid="empty-workspace" />,
}));

vi.mock('./PdfViewer', () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

type DocumentViewerTestProps = ComponentProps<typeof DocumentViewer>;

let animationFrames: Map<number, FrameRequestCallback>;
let nextAnimationFrameId: number;

function flushAnimationFrames() {
  const pendingFrames = Array.from(animationFrames.values());
  animationFrames.clear();

  for (const callback of pendingFrames) {
    callback(window.performance.now());
  }
}

function createWorkspace(zoom = 1): PdfWorkspace {
  return {
    annotations: [],
    documents: [],
    formFieldValues: {},
    formSettings: {
      flattenOnExport: false,
    },
    formatterSettings: {
      ...createDefaultFormatterSettings(),
      fitMode: 'page',
      zoom,
    },
    id: 'workspace-1',
    name: 'Trackpad test',
    pages: [],
    selectedPageIds: [],
  };
}

function createWheelEvent({
  clientX,
  clientY,
  ctrlKey = false,
  deltaX = 0,
  deltaMode = 0,
  deltaY,
  metaKey = false,
}: {
  clientX?: number;
  clientY?: number;
  ctrlKey?: boolean;
  deltaX?: number;
  deltaMode?: number;
  deltaY: number;
  metaKey?: boolean;
}) {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;

  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    ctrlKey: { value: ctrlKey },
    deltaX: { value: deltaX },
    deltaMode: { value: deltaMode },
    deltaY: { value: deltaY },
    metaKey: { value: metaKey },
  });

  return event;
}

function createGestureEvent(type: string, scale?: number, clientX?: number, clientY?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
  });

  if (scale !== undefined) {
    Object.defineProperty(event, 'scale', { value: scale });
  }

  return event;
}

function createDocumentViewerProps(
  overrides: Partial<DocumentViewerTestProps> = {},
): DocumentViewerTestProps {
  return {
    activeAnnotationTool: 'select',
    annotationBorderColor: '#28666e',
    annotationColor: '#ffcc00',
    annotationFillColor: '#ffffff',
    annotationStrokeWidth: 3,
    canGoNext: false,
    canGoPrevious: false,
    error: null,
    eraserSize: 18,
    freehandSensitivity: 'medium',
    highlightBrushSize: 14,
    highlightOpacity: 0.42,
    isAnnotating: false,
    isHandToolActive: false,
    isLoading: false,
    loadingMessage: 'Loading',
    onChangeFormFieldValue: vi.fn(),
    onCommitAnnotationChange: vi.fn(),
    onCreateAnnotation: vi.fn(),
    onEraseAnnotationPixels: vi.fn(),
    onNavigatePage: vi.fn(),
    onSelectAnnotation: vi.fn(),
    onUpdateAnnotationPasteTarget: vi.fn(),
    onUpdateAnnotation: vi.fn(),
    onWheelZoom: vi.fn(),
    onZoomByFactor: vi.fn(),
    selectedAnnotationId: null,
    spacebarFreehandEnabled: false,
    signatureImage: null,
    workspace: createWorkspace(),
    ...overrides,
  };
}

function renderDocumentViewer(overrides: Partial<DocumentViewerTestProps> = {}) {
  const props = createDocumentViewerProps(overrides);

  return render(<DocumentViewer {...props} />);
}

function setViewerLayout(
  viewer: HTMLElement,
  {
    clientHeight = 300,
    clientWidth = 400,
    scrollHeight = 900,
    scrollWidth = 900,
    scrollLeft = 0,
    scrollTop = 0,
  }: {
    clientHeight?: number;
    clientWidth?: number;
    scrollHeight?: number;
    scrollWidth?: number;
    scrollLeft?: number;
    scrollTop?: number;
  } = {},
) {
  Object.defineProperties(viewer, {
    clientHeight: { configurable: true, value: clientHeight },
    clientWidth: { configurable: true, value: clientWidth },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollWidth: { configurable: true, value: scrollWidth },
    scrollLeft: { configurable: true, value: scrollLeft, writable: true },
    scrollTop: { configurable: true, value: scrollTop, writable: true },
  });

  vi.spyOn(viewer, 'getBoundingClientRect').mockReturnValue({
    bottom: clientHeight,
    height: clientHeight,
    left: 0,
    right: clientWidth,
    toJSON: () => undefined,
    top: 0,
    width: clientWidth,
    x: 0,
    y: 0,
  });
}

describe('DocumentViewer trackpad zoom gestures', () => {
  beforeEach(() => {
    animationFrames = new Map();
    nextAnimationFrameId = 1;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const animationFrameId = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(animationFrameId, callback);

      return animationFrameId;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((animationFrameId) => {
      animationFrames.delete(animationFrameId);
    });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: '',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('pans the document when the hand tool is dragged', () => {
    renderDocumentViewer({ isHandToolActive: true });

    const viewer = screen.getByLabelText('Main document viewer') as HTMLElement;
    setViewerLayout(viewer, {
      scrollLeft: 100,
      scrollTop: 200,
    });

    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(viewer, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
      setPointerCapture: { configurable: true, value: setPointerCapture },
    });

    fireEvent.pointerDown(viewer, {
      button: 0,
      clientX: 120,
      clientY: 140,
      isPrimary: true,
      pointerId: 7,
    });
    fireEvent.pointerMove(viewer, {
      clientX: 90,
      clientY: 100,
      isPrimary: true,
      pointerId: 7,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(viewer.scrollLeft).toBe(130);
    expect(viewer.scrollTop).toBe(240);

    fireEvent.pointerUp(viewer, { pointerId: 7 });

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('zooms from native ctrl wheel events inside the viewer', () => {
    const onWheelZoom = vi.fn();
    renderDocumentViewer({ onWheelZoom });

    const viewer = screen.getByLabelText('Main document viewer');
    const event = createWheelEvent({ ctrlKey: true, deltaY: -72 });

    viewer.dispatchEvent(event);
    flushAnimationFrames();

    expect(event.defaultPrevented).toBe(true);
    expect(onWheelZoom).toHaveBeenCalledTimes(1);
    expect(onWheelZoom).toHaveBeenCalledWith(-72);
  });

  it('keeps the zoom focus point anchored after the zoomed page rerenders', () => {
    const onWheelZoom = vi.fn();
    const workspace = createWorkspace(1);
    const props = createDocumentViewerProps({ onWheelZoom, workspace });
    const { rerender } = render(<DocumentViewer {...props} />);

    const viewer = screen.getByLabelText('Main document viewer') as HTMLElement;
    setViewerLayout(viewer, {
      clientHeight: 300,
      clientWidth: 400,
      scrollLeft: 100,
      scrollTop: 200,
    });

    viewer.dispatchEvent(
      createWheelEvent({ clientX: 100, clientY: 100, ctrlKey: true, deltaY: -72 }),
    );
    flushAnimationFrames();

    rerender(
      <DocumentViewer
        {...props}
        workspace={{
          ...workspace,
          formatterSettings: {
            ...workspace.formatterSettings,
            zoom: 2,
          },
        }}
      />,
    );

    expect(viewer.scrollLeft).toBe(300);
    expect(viewer.scrollTop).toBe(500);
  });

  it('does not treat ctrl wheel outside the viewer as document zoom', () => {
    const onWheelZoom = vi.fn();
    renderDocumentViewer({ onWheelZoom });

    const outsideButton = document.createElement('button');
    document.body.append(outsideButton);

    const event = createWheelEvent({ ctrlKey: true, deltaY: -72 });
    outsideButton.dispatchEvent(event);
    flushAnimationFrames();

    expect(event.defaultPrevented).toBe(false);
    expect(onWheelZoom).not.toHaveBeenCalled();

    outsideButton.remove();
  });

  it('flushes a pending gesture zoom when gestureend arrives before animation frame', () => {
    const onZoomByFactor = vi.fn();
    renderDocumentViewer({ onZoomByFactor });

    const viewer = screen.getByLabelText('Main document viewer');
    viewer.dispatchEvent(createGestureEvent('gesturestart', 1));
    viewer.dispatchEvent(createGestureEvent('gesturechange', 1.25));

    expect(onZoomByFactor).not.toHaveBeenCalled();

    const endEvent = createGestureEvent('gestureend');
    viewer.dispatchEvent(endEvent);
    flushAnimationFrames();

    expect(endEvent.defaultPrevented).toBe(true);
    expect(onZoomByFactor).toHaveBeenCalledTimes(1);
    expect(onZoomByFactor).toHaveBeenCalledWith(1.25);
  });

  it('keeps WebKit gesture scale incremental across a mid-pinch rerender', () => {
    const firstOnZoomByFactor = vi.fn();
    const nextOnZoomByFactor = vi.fn();
    const workspace = createWorkspace(1);
    const props = createDocumentViewerProps({ onZoomByFactor: firstOnZoomByFactor, workspace });
    const { rerender } = render(<DocumentViewer {...props} />);

    const viewer = screen.getByLabelText('Main document viewer');
    viewer.dispatchEvent(createGestureEvent('gesturestart', 1));
    viewer.dispatchEvent(createGestureEvent('gesturechange', 1.2));
    flushAnimationFrames();

    expect(firstOnZoomByFactor).toHaveBeenCalledTimes(1);
    expect(firstOnZoomByFactor).toHaveBeenCalledWith(1.2);

    rerender(
      <DocumentViewer
        {...props}
        onZoomByFactor={nextOnZoomByFactor}
        workspace={{
          ...workspace,
          formatterSettings: {
            ...workspace.formatterSettings,
            zoom: 1.2,
          },
        }}
      />,
    );

    viewer.dispatchEvent(createGestureEvent('gesturechange', 1.5));
    flushAnimationFrames();

    expect(nextOnZoomByFactor).toHaveBeenCalledTimes(1);
    expect(nextOnZoomByFactor).toHaveBeenCalledWith(1.25);
  });

  it('navigates pages from a short intentional wheel spillover at the scroll edge', () => {
    const onNavigatePage = vi.fn();
    renderDocumentViewer({ canGoNext: true, onNavigatePage });

    const viewer = screen.getByLabelText('Main document viewer') as HTMLElement;
    setViewerLayout(viewer, {
      clientHeight: 300,
      scrollHeight: 900,
      scrollTop: 600,
    });

    const event = createWheelEvent({ deltaMode: 1, deltaY: 3 });
    viewer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onNavigatePage).toHaveBeenCalledTimes(1);
    expect(onNavigatePage).toHaveBeenCalledWith(1);
  });

  it('smoothly settles the viewer after a wheel page navigation changes the active page', () => {
    const onNavigatePage = vi.fn();
    const workspace = {
      ...createWorkspace(),
      activePageId: 'page-1',
    };
    const props = createDocumentViewerProps({ canGoNext: true, onNavigatePage, workspace });
    const { rerender } = render(<DocumentViewer {...props} />);

    const viewer = screen.getByLabelText('Main document viewer') as HTMLElement;
    setViewerLayout(viewer, {
      clientHeight: 300,
      scrollHeight: 900,
      scrollTop: 600,
    });
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      viewer.scrollTop = Number(top);
    });
    Object.defineProperty(viewer, 'scrollTo', { configurable: true, value: scrollTo });

    viewer.dispatchEvent(createWheelEvent({ deltaY: 48 }));
    rerender(
      <DocumentViewer
        {...props}
        workspace={{
          ...workspace,
          activePageId: 'page-2',
        }}
      />,
    );
    flushAnimationFrames();

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: 'smooth',
      left: 0,
      top: 0,
    });
  });
});
