import type { DocumentSaveState } from '../project/documentSaveState';
import {
  getWorkspaceHistorySources,
  registerWorkspaceHistorySources,
  type WorkspaceHistoryState,
} from '../pdf/workspaceHistory';

export type WorkspaceTab = {
  saveState: DocumentSaveState;
  color?: string;
  fontFamily?: string;
  history: WorkspaceHistoryState;
  id: string;
};

export function encodeWorkspaceTransfer(
  tabs: WorkspaceTab[],
  passwords: Map<string, string>,
): string {
  const sources = getWorkspaceHistorySources(tabs.map((tab) => tab.history));
  return JSON.stringify(
    {
      version: 1,
      tabs: tabs.map((tab) => ({
        ...tab,
        history: {
          ...tab.history,
          present: {
            ...tab.history.present,
            documents: tab.history.present.documents.map((document) => ({
              ...document,
              bytes: undefined,
            })),
            pages: tab.history.present.pages.map((page) => ({
              ...page,
              thumbnailDataUrl: undefined,
            })),
          },
        },
      })),
      sources,
      passwords: [...passwords].filter(([id]) => sources.some(([sourceId]) => sourceId === id)),
    },
    (_key, value: unknown) => {
      if (!(value instanceof Uint8Array)) return value;
      let binary = '';
      for (let i = 0; i < value.length; i += 8192) {
        binary += String.fromCharCode(...value.subarray(i, i + 8192));
      }
      return { paperdeskBytes: btoa(binary) };
    },
  );
}

export function decodeWorkspaceTransfer(payload: string): {
  tabs: WorkspaceTab[];
  passwords: [string, string][];
} {
  const data = JSON.parse(payload, (_key, value) => {
    if (value && typeof value === 'object' && typeof value.paperdeskBytes === 'string') {
      return Uint8Array.from(atob(value.paperdeskBytes), (char) => char.charCodeAt(0));
    }
    return value;
  });
  if (
    data.version !== 1 ||
    !Array.isArray(data.tabs) ||
    !data.tabs.length ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.passwords) ||
    data.tabs.some(
      (tab: WorkspaceTab) => !tab.id || tab.history?.present?.id !== tab.id || !tab.saveState,
    )
  ) {
    throw new Error('Invalid workspace transfer.');
  }
  const sources = new Map<string, Uint8Array>(data.sources);
  for (const tab of data.tabs as WorkspaceTab[]) {
    tab.history.present.documents = tab.history.present.documents.map((document) => {
      const bytes = sources.get(document.id);
      if (!(bytes instanceof Uint8Array))
        throw new Error('Missing PDF source in workspace transfer.');
      return { ...document, bytes };
    });
  }
  registerWorkspaceHistorySources(data.sources);
  return data;
}
