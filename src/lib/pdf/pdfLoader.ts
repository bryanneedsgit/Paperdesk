import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  readFile,
  startAccessingSecurityScopedResource,
  stopAccessingSecurityScopedResource,
} from '@tauri-apps/plugin-fs';

import { createId } from '../utils/ids';
import { getFileNameFromPath } from '../utils/fileNames';
import { classifyPdfOpenError, logDeveloperError } from '../utils/errors';
import { ensurePdfJsWorker, pdfjsLib } from './pdfJs';
import { detectPdfFormFields } from './pdfForms';
import type { PdfDocumentSource } from './types';

const pdfFileFilters = [{ name: 'PDF', extensions: ['pdf'] }];
const pdfDialogOptions = { filters: pdfFileFilters, fileAccessMode: 'scoped' as const };

export class PdfLoadError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly cause?: unknown,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'PdfLoadError';
  }
}

export async function pickPdfPath(defaultPath?: string): Promise<string | null> {
  const selectedPath = await open({
    ...pdfDialogOptions,
    defaultPath,
    multiple: false,
  });

  return typeof selectedPath === 'string' ? selectedPath : null;
}

export async function pickPdfPaths(): Promise<string[]> {
  const selectedPaths = await open({
    ...pdfDialogOptions,
    multiple: true,
  });

  if (!selectedPaths) {
    return [];
  }

  return Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
}

export async function readPdfFile(path: string): Promise<Uint8Array> {
  let isAccessingScopedResource = false;

  try {
    try {
      await startAccessingSecurityScopedResource(path);
      isAccessingScopedResource = true;
    } catch (error) {
      logDeveloperError(`PDF file did not require security scoped access: ${path}`, error);
    }

    return await readFile(path);
  } catch (error) {
    logDeveloperError(`Unable to read PDF file with scoped plugin access: ${path}`, error);

    try {
      return new Uint8Array(await invoke<number[]>('read_pdf_file_bytes', { path }));
    } catch (fallbackError) {
      const friendlyError = classifyPdfOpenError(fallbackError);
      logDeveloperError(`Unable to read PDF file with native fallback: ${path}`, fallbackError);
      throw new PdfLoadError(
        'Unable to read PDF file.',
        friendlyError.userMessage,
        fallbackError,
        friendlyError.suggestion,
      );
    }
  } finally {
    if (isAccessingScopedResource) {
      await stopAccessingSecurityScopedResource(path).catch(() => undefined);
    }
  }
}

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

  try {
    await ensurePdfJsWorker();
    loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
    const pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;
    await loadingTask.destroy();

    return pageCount;
  } catch (error) {
    if (loadingTask) {
      await loadingTask.destroy().catch(() => undefined);
    }

    const friendlyError = classifyPdfOpenError(error);
    logDeveloperError('Invalid or unreadable PDF file.', error);
    throw new PdfLoadError(
      'Invalid or unreadable PDF file.',
      friendlyError.userMessage,
      error,
      friendlyError.suggestion,
    );
  }
}

export async function loadPdfFromPath(path: string): Promise<PdfDocumentSource> {
  const bytes = await readPdfFile(path);
  return loadPdfFromBytes({
    bytes,
    fileName: getFileNameFromPath(path),
    filePath: path,
  });
}

export async function loadPdfFromBytes({
  bytes,
  fileName,
  filePath,
}: {
  bytes: Uint8Array;
  fileName: string;
  filePath?: string;
}): Promise<PdfDocumentSource> {
  const pageCount = await getPdfPageCount(bytes);
  const formFields = await detectPdfFormFields(bytes).catch((error) => {
    logDeveloperError(`Unable to inspect form fields: ${fileName}`, error);
    return [];
  });

  return {
    id: createId('pdf'),
    fileName,
    filePath,
    bytes,
    pageCount,
    loadedAt: new Date().toISOString(),
    formFields,
  };
}

export async function loadPdfDocumentsFromPaths(paths: string[]): Promise<PdfDocumentSource[]> {
  const documents: PdfDocumentSource[] = [];

  for (const path of paths) {
    try {
      documents.push(await loadPdfFromPath(path));
    } catch (error) {
      if (error instanceof PdfLoadError) {
        throw new PdfLoadError(
          error.message,
          `${error.userMessage} (${getFileNameFromPath(path)})`,
          error.cause ?? error,
          error.suggestion,
        );
      }

      throw error;
    }
  }

  return documents;
}

export async function openPdfDocument(): Promise<PdfDocumentSource | null> {
  const path = await pickPdfPath();

  if (!path) {
    return null;
  }

  return loadPdfFromPath(path);
}

export async function openPdfDocuments(): Promise<PdfDocumentSource[]> {
  const paths = await pickPdfPaths();

  if (paths.length === 0) {
    return [];
  }

  return loadPdfDocumentsFromPaths(paths);
}

export function getPdfLoadErrorMessage(error: unknown): string {
  if (error instanceof PdfLoadError) {
    return error.userMessage;
  }

  return 'Paperdesk could not open the selected PDF.';
}
