import type { PdfDocumentSource, PdfPageItem, PdfWorkspace } from './types';

const maxHistoryEntries = 100;

type PdfDocumentSourceSnapshot = Omit<PdfDocumentSource, 'bytes'>;
type PdfPageItemSnapshot = PdfPageItem & { thumbnailDataUrl?: undefined };

export type WorkspaceHistorySnapshot = Omit<PdfWorkspace, 'documents' | 'pages'> & {
  documents: PdfDocumentSourceSnapshot[];
  pages: PdfPageItemSnapshot[];
};

export type WorkspaceHistoryState = {
  past: WorkspaceHistorySnapshot[];
  present: PdfWorkspace;
  future: WorkspaceHistorySnapshot[];
};

const sourceDocumentBytesById = new Map<string, Uint8Array>();

function registerSourceDocumentBytes(workspace: PdfWorkspace): void {
  for (const document of workspace.documents) {
    if (!sourceDocumentBytesById.has(document.id)) {
      sourceDocumentBytesById.set(document.id, document.bytes);
    }
  }
}

function toDocumentSnapshot(document: PdfDocumentSource): PdfDocumentSourceSnapshot {
  return {
    id: document.id,
    fileName: document.fileName,
    filePath: document.filePath,
    pageCount: document.pageCount,
    loadedAt: document.loadedAt,
    formFields: document.formFields,
  };
}

function toPageSnapshot(page: PdfPageItem): PdfPageItemSnapshot {
  const snapshot = { ...page };

  delete snapshot.thumbnailDataUrl;

  return snapshot as PdfPageItemSnapshot;
}

export function createWorkspaceSnapshot(workspace: PdfWorkspace): WorkspaceHistorySnapshot {
  registerSourceDocumentBytes(workspace);

  return cloneSnapshot({
    ...workspace,
    documents: workspace.documents.map(toDocumentSnapshot),
    pages: workspace.pages.map(toPageSnapshot),
  });
}

export function restoreWorkspaceSnapshot(snapshot: WorkspaceHistorySnapshot): PdfWorkspace {
  return {
    ...snapshot,
    documents: snapshot.documents.map((document) => {
      const bytes = sourceDocumentBytesById.get(document.id);

      if (!bytes) {
        throw new Error(`Missing source bytes for PDF document ${document.id}.`);
      }

      return {
        ...document,
        bytes,
      };
    }),
    pages: snapshot.pages.map((page) => ({ ...page })),
  };
}

function snapshotsAreEqual(
  firstSnapshot: WorkspaceHistorySnapshot,
  secondSnapshot: WorkspaceHistorySnapshot,
): boolean {
  return JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot);
}

function cloneSnapshot(snapshot: WorkspaceHistorySnapshot): WorkspaceHistorySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceHistorySnapshot;
}

function trimPast(past: WorkspaceHistorySnapshot[]): WorkspaceHistorySnapshot[] {
  return past.length > maxHistoryEntries ? past.slice(past.length - maxHistoryEntries) : past;
}

export function createWorkspaceHistory(present: PdfWorkspace): WorkspaceHistoryState {
  registerSourceDocumentBytes(present);

  return {
    past: [],
    present,
    future: [],
  };
}

export function updateWorkspaceHistoryPresent(
  history: WorkspaceHistoryState,
  present: PdfWorkspace,
): WorkspaceHistoryState {
  registerSourceDocumentBytes(present);

  return {
    ...history,
    present,
  };
}

export function commitWorkspaceHistory(
  history: WorkspaceHistoryState,
  nextPresent: PdfWorkspace,
): WorkspaceHistoryState {
  registerSourceDocumentBytes(history.present);
  registerSourceDocumentBytes(nextPresent);

  const previousSnapshot = createWorkspaceSnapshot(history.present);
  const nextSnapshot = createWorkspaceSnapshot(nextPresent);

  if (snapshotsAreEqual(previousSnapshot, nextSnapshot)) {
    return updateWorkspaceHistoryPresent(history, nextPresent);
  }

  return {
    past: trimPast([...history.past, previousSnapshot]),
    present: nextPresent,
    future: [],
  };
}

export function commitWorkspaceHistoryFromPrevious(
  history: WorkspaceHistoryState,
  previousPresent: PdfWorkspace,
  nextPresent: PdfWorkspace,
): WorkspaceHistoryState {
  registerSourceDocumentBytes(previousPresent);
  registerSourceDocumentBytes(nextPresent);

  const previousSnapshot = createWorkspaceSnapshot(previousPresent);
  const nextSnapshot = createWorkspaceSnapshot(nextPresent);

  if (snapshotsAreEqual(previousSnapshot, nextSnapshot)) {
    return updateWorkspaceHistoryPresent(history, nextPresent);
  }

  return {
    past: trimPast([...history.past, previousSnapshot]),
    present: nextPresent,
    future: [],
  };
}

export function undoWorkspaceHistory(history: WorkspaceHistoryState): WorkspaceHistoryState {
  const previousSnapshot = history.past[history.past.length - 1];

  if (!previousSnapshot) {
    return history;
  }

  const presentSnapshot = createWorkspaceSnapshot(history.present);

  return {
    past: history.past.slice(0, -1),
    present: restoreWorkspaceSnapshot(previousSnapshot),
    future: [presentSnapshot, ...history.future],
  };
}

export function redoWorkspaceHistory(history: WorkspaceHistoryState): WorkspaceHistoryState {
  const nextSnapshot = history.future[0];

  if (!nextSnapshot) {
    return history;
  }

  const presentSnapshot = createWorkspaceSnapshot(history.present);

  return {
    past: trimPast([...history.past, presentSnapshot]),
    present: restoreWorkspaceSnapshot(nextSnapshot),
    future: history.future.slice(1),
  };
}

export function canUndoWorkspaceHistory(history: WorkspaceHistoryState | null): boolean {
  return Boolean(history?.past.length);
}

export function canRedoWorkspaceHistory(history: WorkspaceHistoryState | null): boolean {
  return Boolean(history?.future.length);
}
