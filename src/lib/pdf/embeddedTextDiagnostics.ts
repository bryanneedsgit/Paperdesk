import type { TextSelectionRect } from './embeddedTextSelection';

type RectSnapshot = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
  x: number;
  y: number;
};

export type EmbeddedTextPageDiagnostics = {
  devicePixelRatio: number;
  error?: unknown;
  firstTextStrings: string[];
  getTextContentSucceeded: boolean;
  pageContainerRect: DOMRect | null;
  pageNumber: number | null;
  renderedTextBoxCount: number;
  renderedTextSpanCount: number;
  renderedTextSpansWithNonEmptyText: number;
  renderedTextSpansWithNonZeroRect: number;
  scale: number;
  textContentItemCount: number;
  workerSrc?: string;
};

export type EmbeddedTextSelectionDiagnostics = {
  devicePixelRatio: number;
  dragEndClient: { x: number; y: number };
  dragStartClient: { x: number; y: number };
  intersectedBoxCount: number;
  pageLocalSelectionRect: TextSelectionRect | null;
  pageNumber: number | null;
  reconstructedTextLength: number;
  scale: number;
};

type EmbeddedTextPageDiagnosticsSnapshot = Omit<
  EmbeddedTextPageDiagnostics,
  'pageContainerRect'
> & {
  pageContainerRect: RectSnapshot | null;
};

declare global {
  interface Window {
    __PAPERDESK_EMBEDDED_TEXT_DIAGNOSTICS__?: {
      pages: EmbeddedTextPageDiagnosticsSnapshot[];
      selections: EmbeddedTextSelectionDiagnostics[];
    };
  }
}

export function isEmbeddedTextDebugEnabled(): boolean {
  return import.meta.env.VITE_PAPERDESK_TEXT_DEBUG === 'true';
}

function snapshotRect(rect: DOMRect | null): RectSnapshot | null {
  if (!rect) {
    return null;
  }

  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  };
}

function getDiagnosticsStore() {
  window.__PAPERDESK_EMBEDDED_TEXT_DIAGNOSTICS__ ??= {
    pages: [],
    selections: [],
  };

  return window.__PAPERDESK_EMBEDDED_TEXT_DIAGNOSTICS__;
}

export function logEmbeddedTextPageDiagnostics(data: EmbeddedTextPageDiagnostics): void {
  if (!isEmbeddedTextDebugEnabled()) {
    return;
  }

  const diagnostic: EmbeddedTextPageDiagnosticsSnapshot = {
    ...data,
    pageContainerRect: snapshotRect(data.pageContainerRect),
  };

  getDiagnosticsStore().pages.push(diagnostic);
  console.info('[Paperdesk embedded text page]', diagnostic);
}

export function logEmbeddedTextSelectionDiagnostics(data: EmbeddedTextSelectionDiagnostics): void {
  if (!isEmbeddedTextDebugEnabled()) {
    return;
  }

  getDiagnosticsStore().selections.push(data);
  console.info('[Paperdesk embedded text selection]', data);
}
