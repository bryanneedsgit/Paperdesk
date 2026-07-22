import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

import { logDeveloperError } from '../utils/errors';

// WKWebView (macOS/iOS) has not shipped async iteration of ReadableStream,
// but pdf.js getTextContent() relies on `for await` over its text content
// stream, which throws a TypeError there and leaves pages without any
// embedded text. Install the standard async-iterator protocol when missing.
export function ensureReadableStreamAsyncIteration(
  prototype: object = ReadableStream.prototype,
): void {
  if (Symbol.asyncIterator in prototype) {
    return;
  }

  Object.defineProperty(prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value(this: ReadableStream<unknown>): AsyncIterator<unknown> {
      const reader = this.getReader();

      return {
        next: () => reader.read() as Promise<IteratorResult<unknown>>,
        return: async (value?: unknown) => {
          await reader.cancel(value).catch(() => undefined);
          reader.releaseLock();

          return { done: true, value };
        },
      };
    },
  });
}

ensureReadableStreamAsyncIteration();

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

let workerSetupPromise: Promise<void> | null = null;

// WKWebView (macOS/iOS) does not route Web Worker script loads through
// Tauri's custom tauri:// protocol handler, so the pdf.js worker never
// starts when the app is served from a non-http origin. Page-context
// fetches do go through the handler, so load the worker script manually
// and hand pdf.js a blob: URL instead (allowed by the CSP's worker-src).
export function isBlobWorkerSourceRequired(protocol: string): boolean {
  return !/^https?:$/.test(protocol);
}

async function createBlobWorkerSource(workerUrl: string): Promise<string> {
  const response = await fetch(workerUrl);

  if (!response.ok) {
    throw new Error(`Unable to fetch the PDF worker script (status ${response.status}).`);
  }

  const workerScript = await response.blob();

  return URL.createObjectURL(new Blob([workerScript], { type: 'text/javascript' }));
}

export function ensurePdfJsWorker(
  useBlobWorkerSource = typeof window !== 'undefined' &&
    isBlobWorkerSourceRequired(window.location.protocol),
): Promise<void> {
  workerSetupPromise ??= !useBlobWorkerSource
    ? Promise.resolve()
    : createBlobWorkerSource(pdfWorkerSrc)
        .then((blobWorkerSrc) => {
          pdfjsLib.GlobalWorkerOptions.workerSrc = blobWorkerSrc;
        })
        .catch((error) => {
          // Keep the direct asset URL so pdf.js can still try its own fallback.
          logDeveloperError('Unable to prepare the PDF worker blob source.', error);
        });

  return workerSetupPromise;
}

export { pdfjsLib };
