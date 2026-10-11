import { invoke, isTauri } from '@tauri-apps/api/core';
import { exportWorkspaceToPdfBytes } from '../pdf/pdfExporter';
import type { PdfWorkspace } from '../pdf/types';

export type PrintOutcome = 'submitted' | 'cancelled';
export type PrintRequest = {
  markedPdf: number[];
  cleanPdf: number[] | null;
  title: string;
  currentPage: number;
  selectedPages: number[];
};

export async function preparePrintRequest(workspace: PdfWorkspace): Promise<PrintRequest> {
  const pages = workspace.pages.filter((page) => !page.deleted);
  if (!pages.length) throw new Error('There are no pages to print.');
  const selected = new Set(workspace.selectedPageIds);
  // Flatten form widgets into the print snapshot; never mutate the editable workspace.
  const snapshot = {
    ...workspace,
    formSettings: { ...workspace.formSettings, flattenOnExport: true },
  };
  const markedPdf = await exportWorkspaceToPdfBytes(snapshot);
  const cleanPdf = workspace.annotations.length
    ? await exportWorkspaceToPdfBytes({ ...snapshot, annotations: [] })
    : null;
  return {
    markedPdf: Array.from(markedPdf),
    cleanPdf: cleanPdf ? Array.from(cleanPdf) : null,
    title: workspace.name,
    currentPage: Math.max(1, pages.findIndex((page) => page.id === workspace.activePageId) + 1),
    selectedPages: pages.flatMap((page, index) => (selected.has(page.id) ? [index + 1] : [])),
  };
}

export async function printDocument(workspace: PdfWorkspace): Promise<PrintOutcome> {
  if (!isTauri()) throw new Error('Printing is available in the PaperDesk desktop app.');
  const request = await preparePrintRequest(workspace);
  return invoke<PrintOutcome>('print_document', { request });
}
