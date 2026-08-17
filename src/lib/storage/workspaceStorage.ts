import type { PdfDocumentSource, PdfPageItem, PdfWorkspace } from '../pdf/types';

const workspaceAutosaveKey = 'paperdesk.workspaceAutosave.v1';
const workspaceStorageSettingsKey = 'paperdesk.storageSettings.v1';
const workspaceSourceDbName = 'paperdesk.workspaceSources.v1';
const workspaceSourceStoreName = 'documents';

export type WorkspaceStorageSettings = {
  autosaveWorkspace: boolean;
  rememberRecentFiles: boolean;
  spacebarFreehandAnnotation: boolean;
};

export type AutosavedWorkspaceDocument = Pick<
  PdfDocumentSource,
  'fileName' | 'filePath' | 'id' | 'loadedAt' | 'pageCount' | 'security'
>;

type AutosavedPageItem = PdfPageItem & { thumbnailDataUrl?: undefined };

export type AutosavedWorkspaceData = Omit<PdfWorkspace, 'documents' | 'pages'> & {
  documents: AutosavedWorkspaceDocument[];
  pages: AutosavedPageItem[];
};

export type AutosavedWorkspaceSnapshot = {
  savedAt: string;
  version: 1;
  workspace: AutosavedWorkspaceData;
};

type StoredWorkspaceSourceDocument = {
  bytes: ArrayBuffer;
  fileName: string;
  filePath?: string;
  id: string;
  loadedAt: string;
  pageCount: number;
  savedAt: string;
};

const defaultWorkspaceStorageSettings: WorkspaceStorageSettings = {
  autosaveWorkspace: true,
  rememberRecentFiles: true,
  spacebarFreehandAnnotation: true,
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toAutosavedDocument(document: PdfDocumentSource): AutosavedWorkspaceDocument {
  return {
    id: document.id,
    fileName: document.fileName,
    filePath: document.filePath,
    pageCount: document.pageCount,
    loadedAt: document.loadedAt,
    security: document.security,
  };
}

function toAutosavedPage(page: PdfPageItem): AutosavedPageItem {
  const snapshot = { ...page };

  delete snapshot.thumbnailDataUrl;

  return snapshot as AutosavedPageItem;
}

function isAutosavedWorkspaceSnapshot(value: unknown): value is AutosavedWorkspaceSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AutosavedWorkspaceSnapshot>;

  return (
    candidate.version === 1 &&
    typeof candidate.savedAt === 'string' &&
    Boolean(candidate.workspace) &&
    Array.isArray(candidate.workspace?.documents) &&
    Array.isArray(candidate.workspace?.pages)
  );
}

export function createAutosavedWorkspaceSnapshot(
  workspace: PdfWorkspace,
): AutosavedWorkspaceSnapshot {
  return cloneJson({
    version: 1,
    savedAt: new Date().toISOString(),
    workspace: {
      ...workspace,
      documents: workspace.documents.map(toAutosavedDocument),
      pages: workspace.pages.map(toAutosavedPage),
    },
  });
}

export function readWorkspaceStorageSettings(): WorkspaceStorageSettings {
  const rawValue = window.localStorage.getItem(workspaceStorageSettingsKey);

  if (!rawValue) {
    return defaultWorkspaceStorageSettings;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<WorkspaceStorageSettings> & {
      freehandTrackpadAssist?: unknown;
    };

    return {
      autosaveWorkspace:
        typeof parsed.autosaveWorkspace === 'boolean'
          ? parsed.autosaveWorkspace
          : defaultWorkspaceStorageSettings.autosaveWorkspace,
      rememberRecentFiles:
        typeof parsed.rememberRecentFiles === 'boolean'
          ? parsed.rememberRecentFiles
          : defaultWorkspaceStorageSettings.rememberRecentFiles,
      spacebarFreehandAnnotation:
        typeof parsed.spacebarFreehandAnnotation === 'boolean'
          ? parsed.spacebarFreehandAnnotation
          : typeof parsed.freehandTrackpadAssist === 'boolean'
            ? parsed.freehandTrackpadAssist
            : defaultWorkspaceStorageSettings.spacebarFreehandAnnotation,
    };
  } catch {
    return defaultWorkspaceStorageSettings;
  }
}

export function writeWorkspaceStorageSettings(settings: WorkspaceStorageSettings): void {
  window.localStorage.setItem(workspaceStorageSettingsKey, JSON.stringify(settings));
}

export function readAutosavedWorkspace(): AutosavedWorkspaceSnapshot | null {
  const rawValue = window.localStorage.getItem(workspaceAutosaveKey);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    return isAutosavedWorkspaceSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAutosavedWorkspace(workspace: PdfWorkspace): void {
  window.localStorage.setItem(
    workspaceAutosaveKey,
    JSON.stringify(createAutosavedWorkspaceSnapshot(workspace)),
  );
}

export function clearAutosavedWorkspace(): void {
  window.localStorage.removeItem(workspaceAutosaveKey);
  void clearAutosavedWorkspaceSources();
}

export function clearWorkspaceLocalData(): void {
  clearAutosavedWorkspace();
}

export function createWorkspaceFromAutosave(
  snapshot: AutosavedWorkspaceSnapshot,
  documents: PdfDocumentSource[],
): PdfWorkspace {
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  return {
    ...snapshot.workspace,
    documents: snapshot.workspace.documents.map((document) => {
      const hydratedDocument = documentsById.get(document.id);

      if (!hydratedDocument) {
        throw new Error(`Missing source PDF for ${document.fileName}.`);
      }

      return hydratedDocument;
    }),
    pages: snapshot.workspace.pages.map((page) => ({ ...page })),
  };
}

function openWorkspaceSourceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(workspaceSourceDbName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(workspaceSourceStoreName)) {
        database.createObjectStore(workspaceSourceStoreName, { keyPath: 'id' });
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open source cache.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function runSourceStoreTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openWorkspaceSourceDatabase().then(
    (database) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = database.transaction(workspaceSourceStoreName, mode);
        const store = transaction.objectStore(workspaceSourceStoreName);
        const request = action(store);
        let result: T | undefined;

        if (request) {
          request.onsuccess = () => {
            result = request.result;
          };
          request.onerror = () => reject(request.error ?? new Error('Source cache failed.'));
        }

        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Source cache transaction failed.'));
        };
      }),
  );
}

export async function writeAutosavedWorkspaceSources(workspace: PdfWorkspace): Promise<void> {
  await openWorkspaceSourceDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(workspaceSourceStoreName, 'readwrite');
        const store = transaction.objectStore(workspaceSourceStoreName);
        const cacheableDocumentIds = new Set(
          workspace.documents
            .filter((document) => !document.security?.wasEncrypted)
            .map((document) => document.id),
        );

        store.getAllKeys().onsuccess = (event) => {
          const keys = (event.target as IDBRequest<IDBValidKey[]>).result;

          for (const key of keys) {
            if (typeof key === 'string' && !cacheableDocumentIds.has(key)) {
              store.delete(key);
            }
          }
        };

        for (const document of workspace.documents) {
          if (document.security?.wasEncrypted) {
            continue;
          }

          const storedDocument: StoredWorkspaceSourceDocument = {
            bytes: document.bytes.slice().buffer,
            fileName: document.fileName,
            filePath: document.filePath,
            id: document.id,
            loadedAt: document.loadedAt,
            pageCount: document.pageCount,
            savedAt: new Date().toISOString(),
          };

          store.put(storedDocument);
        }

        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Unable to write source cache.'));
        };
      }),
  );
}

export async function readAutosavedWorkspaceSource(
  documentId: string,
): Promise<StoredWorkspaceSourceDocument | null> {
  const storedDocument = await runSourceStoreTransaction<StoredWorkspaceSourceDocument>(
    'readonly',
    (store) => store.get(documentId),
  );

  return storedDocument ?? null;
}

export async function clearAutosavedWorkspaceSources(): Promise<void> {
  await runSourceStoreTransaction('readwrite', (store) => store.clear()).catch(() => undefined);
}
