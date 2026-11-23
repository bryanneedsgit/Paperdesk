import { useEffect } from 'react';
import type { PdfWorkspace } from '../pdf/types';
import type { DocumentSaveState } from '../project/documentSaveState';
import { logDeveloperError } from '../utils/errors';
import { writeAutosavedWorkspace, writeAutosavedWorkspaceSources } from './workspaceStorage';

export function useWorkspaceAutosave(
  workspace: PdfWorkspace | null,
  saveState: DocumentSaveState | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (enabled && workspace) writeAutosavedWorkspace(workspace, saveState);
  }, [enabled, workspace, saveState]);

  // Page navigation, zoom, notes, annotations and thumbnails do not change source PDFs.
  // Keep recovery metadata current without copying every source buffer into IndexedDB again.
  const documents = workspace?.documents;
  useEffect(() => {
    if (!enabled || !documents) return;
    void writeAutosavedWorkspaceSources({ documents }).catch((error) => {
      logDeveloperError('Unable to cache autosaved source PDFs.', error);
    });
  }, [enabled, documents]);
}
