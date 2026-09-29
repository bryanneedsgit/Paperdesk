import type { PdfWorkspace } from '../pdf/types';
import { normalizePageNotes } from '../notes/pageNotes';

export type DocumentSaveState = {
  format: 'pdf' | 'ppd';
  filePath?: string;
  savedContent: string;
};

/** UI navigation and render caches must not make a document dirty. */
export function documentContentKey(workspace: PdfWorkspace): string {
  const formatterSettings = { ...workspace.formatterSettings, zoom: undefined, fitMode: undefined };
  return JSON.stringify({
    name: workspace.name,
    documents: workspace.documents.map(({ id, fileName, pageCount }) => ({
      id,
      fileName,
      pageCount,
    })),
    pages: workspace.pages.map((page) => {
      return {
        ...page,
        thumbnailDataUrl: undefined,
        width: page.kind === 'generated' ? page.width : undefined,
        height: page.kind === 'generated' ? page.height : undefined,
      };
    }),
    bookmarkedPageIds: workspace.bookmarkedPageIds,
    formatterSettings,
    selectedPageIds: formatterSettings.applyScope === 'selected' ? workspace.selectedPageIds : [],
    annotations: workspace.annotations,
    formFieldValues: workspace.formFieldValues,
    formSettings: workspace.formSettings,
    pageNotes: normalizePageNotes(
      workspace.pageNotes,
      new Set(workspace.pages.filter((p) => !p.deleted).map((p) => p.id)),
    ),
  });
}

export function createDocumentSaveState(
  workspace: PdfWorkspace,
  filePath?: string,
): DocumentSaveState {
  return {
    format: filePath?.toLowerCase().endsWith('.ppd') ? 'ppd' : 'pdf',
    filePath,
    savedContent: documentContentKey(workspace),
  };
}

export function isDocumentDirty(workspace: PdfWorkspace, state: DocumentSaveState): boolean {
  return documentContentKey(workspace) !== state.savedContent;
}
