import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X } from 'lucide-react';

import { TopToolbar } from '../components/layout/TopToolbar';
import { ExportPagesModal, type ExportPagesModalMode } from '../components/pdf/ExportPagesModal';
import {
  PdfPasswordDialog,
  ProtectedPdfExportDialog,
  type PdfPasswordDialogRequest,
  type ProtectedPdfExportChoice,
} from '../components/pdf/PdfSecurityDialogs';
import { FeatureGuideDialog } from '../components/guide/FeatureGuideDialog';
import { ToolsPanel, type ToolPanelId } from '../components/layout/ToolsPanel';
import type { AnnotationFontPatch } from '../components/annotations/AnnotationsPanel';
import { WorkspaceTabs, type WorkspaceTabItem } from '../components/layout/WorkspaceTabs';
import { DocumentViewer } from '../components/pdf/DocumentViewer';
import { PageOverview } from '../components/pdf/PageOverview';
import {
  CollapsedThumbnailSidebar,
  ThumbnailSidebar,
} from '../components/sidebar/ThumbnailSidebar';
import { ViewerToolbar } from '../components/toolbar/ViewerToolbar';
import {
  getDefaultAnnotationBorderColor,
  getDefaultAnnotationColor,
  getDefaultAnnotationFillColor,
  normalizeAnnotationColor,
  normalizeAnnotationPaintColor,
} from '../lib/pdf/annotationColors';
import {
  defaultEraserSize,
  defaultFreehandSensitivity,
  defaultHighlightBrushSize,
  defaultHighlightOpacity,
  defaultPenStrokeWidth,
  isFreehandHighlightAnnotation,
  isFreehandStrokeAnnotation,
  normalizeEraserSize,
  normalizeFreehandSensitivity,
  normalizeHighlightBrushSize,
  normalizeHighlightOpacity,
  normalizePenStrokeWidth,
  type FreehandSensitivity,
} from '../lib/pdf/annotationStroke';
import { cloneFreehandAnnotationsForPaste } from '../lib/pdf/annotationClipboard';
import {
  exportWorkspaceToPdfBytes,
  getDefaultExportFileName,
  getPdfExportErrorMessage,
  getSuffixedExportFileName,
  savePageSubsetPdf,
  saveWorkspacePageRanges,
  saveWorkspacePdf,
  saveWorkspacePdfBytes,
  type PdfPageRange,
} from '../lib/pdf/pdfExporter';
import {
  getPdfLoadErrorMessage,
  loadPdfFromPath,
  loadPdfDocumentsFromPaths,
  loadPdfFromBytes,
  openPdfDocuments,
  pickPdfPath,
  type PdfLoadOptions,
} from '../lib/pdf/pdfLoader';
import {
  getPdfSecurityErrorMessage,
  isPdfPasswordCancelledError,
  PdfSecurityError,
  protectPdfBytes,
  type PdfPasswordProvider,
} from '../lib/pdf/pdfSecurity';
import { searchWorkspaceText, type PdfTextSearchResult } from '../lib/pdf/pdfTextSearch';
import {
  appendDocumentsToWorkspace,
  canExportWorkspace,
  clearPageSelection,
  createAnnotation,
  createWorkspaceFromDocuments,
  deleteAnnotation,
  deletePages,
  insertBlankPage,
  insertCoverPage,
  importWorkspaceFormData,
  movePageInWorkspace,
  moveSelectedPages,
  recordAnnotationMove,
  rotatePages,
  selectAllPages,
  togglePageBookmark,
  updateAnnotation,
  updateWorkspaceFormFieldValue,
  updateWorkspaceFormSettings,
  updateWorkspaceFormatterSettings,
  updateActivePage,
  updateSelectedPages,
} from '../lib/pdf/pdfWorkspace';
import type { PdfFormDataJson } from '../lib/pdf/pdfForms';
import {
  canRedoWorkspaceHistory,
  canUndoWorkspaceHistory,
  commitWorkspaceHistory,
  commitWorkspaceHistoryFromPrevious,
  createWorkspaceHistory,
  redoWorkspaceHistory,
  undoWorkspaceHistory,
  updateWorkspaceHistoryPresent,
  type WorkspaceHistoryState,
} from '../lib/pdf/workspaceHistory';
import { registerWorkspaceShortcuts } from '../lib/commands/shortcutManager';
import {
  addRecentPdfFiles,
  clearRecentPdfFiles,
  readRecentPdfFiles,
  writeRecentPdfFiles,
} from '../lib/storage/recentFilesStorage';
import {
  clearAutosavedWorkspace,
  createWorkspaceFromAutosave,
  readAutosavedWorkspace,
  readWorkspaceStorageSettings,
  writeAutosavedWorkspace,
  readAutosavedWorkspaceSource,
  writeAutosavedWorkspaceSources,
  writeWorkspaceStorageSettings,
  type AutosavedWorkspaceDocument,
  type AutosavedWorkspaceSnapshot,
  type WorkspaceStorageSettings,
} from '../lib/storage/workspaceStorage';
import { getFriendlyErrorSuggestion, logDeveloperError } from '../lib/utils/errors';
import { getFileNameFromPath } from '../lib/utils/fileNames';
import { createId } from '../lib/utils/ids';
import type {
  FormatterSettings,
  PdfAnnotation,
  PdfAnnotationEraseReplacement,
  PdfAnnotationId,
  PdfAnnotationPasteTarget,
  PdfAnnotationTool,
  PdfDocumentSource,
  PdfFormFieldValue,
  PdfFormSettings,
  PdfPageId,
  PdfPageItem,
  PdfRotationDirection,
  PdfWorkspace,
} from '../lib/pdf/types';

const minZoom = 0.25;
const maxZoom = 4;
const zoomStep = 0.15;
const wheelZoomSensitivity = 0.002;
const confirmDeletePageThreshold = 5;
const toastDismissDelayMs = 4000;
const toastActionDismissDelayMs = 6500;
const themeStorageKey = 'paperdesk.theme.v1';
const openPdfsEventName = 'paperdesk://open-pdfs';
const workspaceTabColors = ['#2f5f73', '#7c3aed', '#b45309', '#047857', '#be123c', '#4f46e5'];
const defaultWorkspaceTabFont = 'Montserrat, var(--font-ui)';

type WorkspaceToast = {
  action?: 'undo';
  id: string;
  message: string;
  tone?: 'error' | 'info' | 'success';
};

type SignatureImage = {
  bytes: number[];
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
};

type AppTheme = 'system' | 'light' | 'dark';

type WorkspaceTab = {
  color?: string;
  fontFamily?: string;
  history: WorkspaceHistoryState;
  id: string;
};

type PendingPdfImportSource = 'drop' | 'file-picker' | 'os-open' | 'recent';

type PendingPdfImportRequest = {
  fileNames: string[];
  id: string;
  source: PendingPdfImportSource;
  suggestedWorkspaceId: string | null;
};

type PdfImportTarget =
  | {
      kind: 'new';
    }
  | {
      kind: 'workspace';
      workspaceId: string;
    };

function readAppTheme(): AppTheme {
  const value = window.localStorage.getItem(themeStorageKey);

  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function getActiveSourceFileName(workspace: PdfWorkspace | null): string {
  if (!workspace?.activePageId) {
    return 'No source';
  }

  const page = workspace.pages.find((candidatePage) => candidatePage.id === workspace.activePageId);

  if (!page || page.deleted) {
    return 'No source';
  }

  return 'sourceFileName' in page ? page.sourceFileName : 'Generated page';
}

function getVisiblePages(workspace: PdfWorkspace | null): PdfPageItem[] {
  return workspace?.pages.filter((page) => !page.deleted) ?? [];
}

function getWorkspaceTabColor(index: number): string {
  return workspaceTabColors[index % workspaceTabColors.length];
}

function getDefaultColorForAnnotationTool(tool: PdfAnnotationTool): string | null {
  if (tool === 'free-text') {
    return getDefaultAnnotationColor('free-text');
  }

  if (tool === 'text-note') {
    return getDefaultAnnotationColor('text-note');
  }

  if (tool === 'edit-text') {
    return getDefaultAnnotationColor('text-edit');
  }

  if (tool === 'highlight' || tool === 'pen' || tool === 'rectangle') {
    return getDefaultAnnotationColor(tool);
  }

  return null;
}

function getDefaultFillColorForAnnotationTool(tool: PdfAnnotationTool): string | null {
  if (tool === 'free-text') {
    return getDefaultAnnotationFillColor('free-text');
  }

  if (tool === 'text-note') {
    return getDefaultAnnotationFillColor('text-note');
  }

  if (tool === 'edit-text') {
    return getDefaultAnnotationFillColor('text-edit');
  }

  return null;
}

function getDefaultBorderColorForAnnotationTool(tool: PdfAnnotationTool): string | null {
  if (tool === 'free-text') {
    return getDefaultAnnotationBorderColor('free-text');
  }

  if (tool === 'text-note') {
    return getDefaultAnnotationBorderColor('text-note');
  }

  if (tool === 'edit-text') {
    return getDefaultAnnotationBorderColor('text-edit');
  }

  return null;
}

function createWorkspaceTab(history: WorkspaceHistoryState, color?: string): WorkspaceTab {
  return {
    color,
    fontFamily: defaultWorkspaceTabFont,
    id: history.present.id,
    history,
  };
}

function createWorkspaceTabSummary(tab: WorkspaceTab, index: number): WorkspaceTabItem {
  const workspace = tab.history.present;
  const visiblePageCount = getVisiblePages(workspace).length;

  return {
    color: tab.color ?? getWorkspaceTabColor(index),
    id: tab.id,
    fontFamily: tab.fontFamily ?? defaultWorkspaceTabFont,
    name: workspace.name,
    documentCount: workspace.documents.length,
    pageCount: visiblePageCount,
    isEdited: tab.history.past.length > 0,
  };
}

function getImportPromptTitle(source: PendingPdfImportSource): string {
  if (source === 'drop') {
    return 'Add dropped PDFs?';
  }

  if (source === 'os-open') {
    return 'Open PDF from system?';
  }

  if (source === 'recent') {
    return 'Open recent PDF?';
  }

  return 'Open PDF?';
}

function getImportPromptDescription(source: PendingPdfImportSource): string {
  if (source === 'drop') {
    return 'Choose whether these PDFs join an open workspace or start a new workspace.';
  }

  if (source === 'os-open') {
    return 'Choose an open workspace for this PDF, or open it as a new workspace.';
  }

  return 'Choose where Paperdesk should place the selected PDF.';
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  return Math.min(Math.max(pageIndex, 0), Math.max(pageCount - 1, 0));
}

function clampZoom(zoom: number): number {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

function formatPageActionMessage(
  action: 'Deleted' | 'Moved' | 'Rotated',
  pageCount: number,
): string {
  return `${action} ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`;
}

function formatRecoveryDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function hydrateRecoveredDocument(
  source: AutosavedWorkspaceDocument,
  document: PdfDocumentSource,
): PdfDocumentSource {
  return {
    ...document,
    id: source.id,
    loadedAt: source.loadedAt,
  };
}

function validateRecoveredDocument(
  source: AutosavedWorkspaceDocument,
  document: PdfDocumentSource,
): PdfDocumentSource {
  if (document.pageCount !== source.pageCount) {
    throw new Error('The selected source PDF has a different page count.');
  }

  return hydrateRecoveredDocument(source, document);
}

async function loadRecoveredDocumentFromCache(
  source: AutosavedWorkspaceDocument,
  options: PdfLoadOptions = {},
): Promise<PdfDocumentSource | null> {
  const cachedSource = await readAutosavedWorkspaceSource(source.id);

  if (!cachedSource) {
    return null;
  }

  return validateRecoveredDocument(
    source,
    await loadPdfFromBytes({
      bytes: new Uint8Array(cachedSource.bytes),
      fileName: cachedSource.fileName,
      filePath: cachedSource.filePath,
      ...options,
    }),
  );
}

export function AppShell() {
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [storageSettings, setStorageSettings] = useState<WorkspaceStorageSettings>(
    readWorkspaceStorageSettings,
  );
  const [recoverySnapshot, setRecoverySnapshot] = useState<AutosavedWorkspaceSnapshot | null>(
    () => {
      const settings = readWorkspaceStorageSettings();

      return settings.autosaveWorkspace ? readAutosavedWorkspace() : null;
    },
  );
  const [recoveryMissingSourceIds, setRecoveryMissingSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [recoveryRelinkedDocuments, setRecoveryRelinkedDocuments] = useState<
    Record<string, PdfDocumentSource>
  >({});
  const [recoveryCachedSourceIds, setRecoveryCachedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isRecoveringWorkspace, setIsRecoveringWorkspace] = useState(false);
  const [isOpeningPdf, setIsOpeningPdf] = useState(false);
  const [isAddingPdfs, setIsAddingPdfs] = useState(false);
  const [isDraggingPdfs, setIsDraggingPdfs] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportModalMode, setExportModalMode] = useState<ExportPagesModalMode | null>(null);
  const [workspaceToast, setWorkspaceToast] = useState<WorkspaceToast | null>(null);
  const [activeToolPanel, setActiveToolPanel] = useState<ToolPanelId>('document');
  const [isToolsPanelCollapsed, setIsToolsPanelCollapsed] = useState(false);
  const [isThumbnailSidebarCollapsed, setIsThumbnailSidebarCollapsed] = useState(false);
  const [isPageOverviewOpen, setIsPageOverviewOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [isHandToolActive, setIsHandToolActive] = useState(false);
  const [selectedAnnotationTool, setSelectedAnnotationTool] = useState<PdfAnnotationTool>('select');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<PdfAnnotationId | null>(null);
  const [signatureImage, setSignatureImage] = useState<SignatureImage | null>(null);
  const [recentFiles, setRecentFiles] = useState(() =>
    readWorkspaceStorageSettings().rememberRecentFiles ? readRecentPdfFiles() : [],
  );
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStatusZoomOpen, setIsStatusZoomOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState<PdfTextSearchResult[]>([]);
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [isFindingText, setIsFindingText] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [annotationColor, setAnnotationColor] = useState(getDefaultAnnotationColor('free-text'));
  const [annotationFillColor, setAnnotationFillColor] = useState(
    getDefaultAnnotationFillColor('free-text'),
  );
  const [annotationBorderColor, setAnnotationBorderColor] = useState(
    getDefaultAnnotationBorderColor('free-text'),
  );
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState(defaultPenStrokeWidth);
  const [eraserSize, setEraserSize] = useState(defaultEraserSize);
  const [freehandSensitivity, setFreehandSensitivity] = useState<FreehandSensitivity>(
    defaultFreehandSensitivity,
  );
  const [highlightBrushSize, setHighlightBrushSize] = useState(defaultHighlightBrushSize);
  const [highlightOpacity, setHighlightOpacity] = useState(defaultHighlightOpacity);
  const [copiedFreehandAnnotations, setCopiedFreehandAnnotations] = useState<PdfAnnotation[]>([]);
  const [appTheme, setAppTheme] = useState<AppTheme>(readAppTheme);
  const [pendingPdfImportRequest, setPendingPdfImportRequest] =
    useState<PendingPdfImportRequest | null>(null);
  const [pendingPdfPasswordRequest, setPendingPdfPasswordRequest] =
    useState<PdfPasswordDialogRequest | null>(null);
  const [isProtectedExportChoiceOpen, setIsProtectedExportChoiceOpen] = useState(false);
  const pendingPdfImportResolverRef = useRef<((target: PdfImportTarget | null) => void) | null>(
    null,
  );
  const pendingPdfPasswordResolverRef = useRef<((password: string | null) => void) | null>(null);
  const pendingProtectedExportResolverRef = useRef<
    ((choice: ProtectedPdfExportChoice | null) => void) | null
  >(null);
  const documentPasswordsRef = useRef<Map<string, string>>(new Map());
  const annotationPasteTargetRef = useRef<PdfAnnotationPasteTarget | null>(null);
  const activeWorkspaceTab = useMemo(
    () =>
      activeWorkspaceId
        ? (workspaceTabs.find((tab) => tab.id === activeWorkspaceId) ?? null)
        : null,
    [activeWorkspaceId, workspaceTabs],
  );
  const workspaceHistory = activeWorkspaceTab?.history ?? null;
  const workspace = workspaceHistory?.present ?? null;
  const workspaceRef = useRef<PdfWorkspace | null>(workspace);
  const workspaceTabSummaries = useMemo(
    () => workspaceTabs.map(createWorkspaceTabSummary),
    [workspaceTabs],
  );

  const visiblePages = useMemo(() => getVisiblePages(workspace), [workspace]);
  const findSearchKey = useMemo(() => {
    if (!workspace) {
      return '';
    }

    return JSON.stringify({
      documents: workspace.documents.map((document) => ({
        id: document.id,
        byteLength: document.bytes.byteLength,
        loadedAt: document.loadedAt,
        pageCount: document.pageCount,
      })),
      pages: workspace.pages.map((page) => ({
        id: page.id,
        deleted: page.deleted,
        displayIndex: page.displayIndex,
        sourceDocumentId: 'sourceDocumentId' in page ? page.sourceDocumentId : null,
        sourcePageIndex: 'sourcePageIndex' in page ? page.sourcePageIndex : null,
      })),
    });
  }, [workspace]);
  const visiblePageIds = useMemo(
    () => new Set(visiblePages.map((page) => page.id)),
    [visiblePages],
  );
  const selectedVisiblePageIds = useMemo(
    () => workspace?.selectedPageIds.filter((pageId) => visiblePageIds.has(pageId)) ?? [],
    [visiblePageIds, workspace?.selectedPageIds],
  );
  const activePageIndex = useMemo(() => {
    if (!workspace?.activePageId) {
      return visiblePages.length ? 0 : -1;
    }

    const pageIndex = visiblePages.findIndex((page) => page.id === workspace.activePageId);

    return pageIndex >= 0 ? pageIndex : visiblePages.length ? 0 : -1;
  }, [visiblePages, workspace?.activePageId]);

  const activePageNumber = activePageIndex >= 0 ? activePageIndex + 1 : 0;
  const activePage = activePageIndex >= 0 ? visiblePages[activePageIndex] : undefined;
  const isActivePageBookmarked = Boolean(
    activePage && workspace?.bookmarkedPageIds.includes(activePage.id),
  );
  const pageCount = visiblePages.length;
  const zoomPercent = workspace ? Math.round(workspace.formatterSettings.zoom * 100) : 100;
  const isLoadingPdf = isOpeningPdf || isAddingPdfs;
  const canExportPdf = canExportWorkspace(workspace) && !isExportingPdf;
  const canUndoWorkspaceEdit = canUndoWorkspaceHistory(workspaceHistory);
  const canRedoWorkspaceEdit = canRedoWorkspaceHistory(workspaceHistory);
  const activeSourceFileName = getActiveSourceFileName(workspace);
  const hasUnsavedChanges = canUndoWorkspaceEdit;
  const loadingMessage = isAddingPdfs
    ? 'Adding PDFs to the current workspace.'
    : 'Reading the selected file locally.';
  const trimmedFindQuery = findQuery.trim();
  const isSpacebarFreehandEnabled =
    storageSettings.spacebarFreehandAnnotation &&
    !isAboutOpen &&
    !isSettingsOpen &&
    !isShortcutHelpOpen &&
    !pendingPdfImportRequest &&
    !pendingPdfPasswordRequest &&
    !isProtectedExportChoiceOpen &&
    !exportModalMode;
  const selectedAnnotation = useMemo(
    () => workspace?.annotations.find((annotation) => annotation.id === selectedAnnotationId),
    [selectedAnnotationId, workspace?.annotations],
  );
  const activePastePage = activePageIndex >= 0 ? visiblePages[activePageIndex] : visiblePages[0];
  const canCopySelectedFreehandAnnotation = isFreehandStrokeAnnotation(selectedAnnotation);
  const canPasteFreehandAnnotation = Boolean(
    workspace && activePastePage && copiedFreehandAnnotations.length,
  );

  useEffect(() => {
    if (!workspace || pageCount === 0) {
      setIsStatusZoomOpen(false);
    }
  }, [pageCount, workspace]);

  useEffect(() => {
    setIsPageOverviewOpen(false);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (pageCount === 0) {
      setIsPageOverviewOpen(false);
    }
  }, [pageCount]);

  const findStatus = !workspace
    ? 'Open a PDF'
    : isFindingText
      ? 'Searching'
      : findError
        ? 'Search failed'
        : trimmedFindQuery && findResults.length === 0
          ? 'No results'
          : 'Find text';

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (workspaceTabs.length === 0) {
      if (activeWorkspaceId) {
        setActiveWorkspaceId(null);
      }
      return;
    }

    if (!activeWorkspaceId || !workspaceTabs.some((tab) => tab.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaceTabs[0].id);
    }
  }, [activeWorkspaceId, workspaceTabs]);

  useEffect(() => {
    setSelectedAnnotationId(null);
    annotationPasteTargetRef.current = null;
  }, [activeWorkspaceId]);

  useEffect(() => {
    annotationPasteTargetRef.current = null;
  }, [workspace?.activePageId]);

  useEffect(() => {
    if (workspace) {
      return;
    }

    setIsHandToolActive(false);
  }, [workspace]);

  const rememberRecentFiles = useCallback(
    (filePaths: string[]) => {
      if (!storageSettings.rememberRecentFiles || filePaths.length === 0) {
        return;
      }

      setRecentFiles((currentFiles) => {
        const nextFiles = addRecentPdfFiles(currentFiles, filePaths);
        writeRecentPdfFiles(nextFiles);
        return nextFiles;
      });
    },
    [storageSettings.rememberRecentFiles],
  );

  const replaceWorkspace = useCallback(
    (nextWorkspace: PdfWorkspace) => {
      const nextHistory = createWorkspaceHistory(nextWorkspace);

      setWorkspaceTabs((currentTabs) => {
        if (!activeWorkspaceId || !currentTabs.some((tab) => tab.id === activeWorkspaceId)) {
          return [
            ...currentTabs,
            createWorkspaceTab(nextHistory, getWorkspaceTabColor(currentTabs.length)),
          ];
        }

        return currentTabs.map((tab, tabIndex) =>
          tab.id === activeWorkspaceId
            ? {
                ...createWorkspaceTab(nextHistory, tab.color ?? getWorkspaceTabColor(tabIndex)),
                fontFamily: tab.fontFamily ?? defaultWorkspaceTabFont,
              }
            : tab,
        );
      });
      setActiveWorkspaceId(nextHistory.present.id);
    },
    [activeWorkspaceId],
  );

  const openWorkspaceInNewTab = useCallback((nextWorkspace: PdfWorkspace) => {
    const nextTab = createWorkspaceTab(createWorkspaceHistory(nextWorkspace));

    setWorkspaceTabs((currentTabs) => [
      ...currentTabs,
      { ...nextTab, color: getWorkspaceTabColor(currentTabs.length) },
    ]);
    setActiveWorkspaceId(nextTab.id);
  }, []);

  const updateActiveWorkspaceHistory = useCallback(
    (update: (history: WorkspaceHistoryState) => WorkspaceHistoryState) => {
      if (!activeWorkspaceId) {
        return;
      }

      setWorkspaceTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeWorkspaceId ? { ...tab, history: update(tab.history) } : tab,
        ),
      );
    },
    [activeWorkspaceId],
  );

  const updateWorkspaceTabHistory = useCallback(
    (workspaceId: string, update: (history: WorkspaceHistoryState) => WorkspaceHistoryState) => {
      setWorkspaceTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === workspaceId ? { ...tab, history: update(tab.history) } : tab,
        ),
      );
    },
    [],
  );

  const updatePresentWorkspace = useCallback(
    (update: (workspace: PdfWorkspace) => PdfWorkspace) => {
      updateActiveWorkspaceHistory((currentHistory) =>
        updateWorkspaceHistoryPresent(currentHistory, update(currentHistory.present)),
      );
    },
    [updateActiveWorkspaceHistory],
  );

  const commitWorkspaceEdit = useCallback(
    (update: (workspace: PdfWorkspace) => PdfWorkspace) => {
      updateActiveWorkspaceHistory((currentHistory) =>
        commitWorkspaceHistory(currentHistory, update(currentHistory.present)),
      );
    },
    [updateActiveWorkspaceHistory],
  );

  const selectPage = useCallback(
    (pageId: PdfPageId) => {
      updatePresentWorkspace((currentWorkspace) =>
        currentWorkspace ? updateActivePage(currentWorkspace, pageId) : currentWorkspace,
      );
    },
    [updatePresentWorkspace],
  );

  const activatePage = useCallback(
    (pageId: PdfPageId) => {
      updatePresentWorkspace((currentWorkspace) => {
        if (!currentWorkspace?.pages.some((page) => page.id === pageId && !page.deleted)) {
          return currentWorkspace;
        }

        return {
          ...currentWorkspace,
          activePageId: pageId,
        };
      });
    },
    [updatePresentWorkspace],
  );

  const selectPageByIndex = useCallback(
    (pageIndex: number) => {
      updatePresentWorkspace((currentWorkspace) => {
        const currentVisiblePages = getVisiblePages(currentWorkspace);

        if (!currentWorkspace || currentVisiblePages.length === 0) {
          return currentWorkspace;
        }

        const nextPage = currentVisiblePages[clampPageIndex(pageIndex, currentVisiblePages.length)];

        return updateActivePage(currentWorkspace, nextPage.id);
      });
    },
    [updatePresentWorkspace],
  );

  const selectPages = useCallback(
    (pageIds: PdfPageId[]) => {
      updatePresentWorkspace((currentWorkspace) =>
        currentWorkspace ? updateSelectedPages(currentWorkspace, pageIds) : currentWorkspace,
      );
    },
    [updatePresentWorkspace],
  );

  const togglePageSelection = useCallback(
    (pageId: PdfPageId, selected: boolean) => {
      updatePresentWorkspace((currentWorkspace) => {
        if (!currentWorkspace) {
          return currentWorkspace;
        }

        const selectedPageIds = new Set(currentWorkspace.selectedPageIds);

        if (selected) {
          selectedPageIds.add(pageId);
        } else {
          selectedPageIds.delete(pageId);
        }

        return updateSelectedPages(currentWorkspace, Array.from(selectedPageIds));
      });
    },
    [updatePresentWorkspace],
  );

  const clearSelection = useCallback(() => {
    updatePresentWorkspace((currentWorkspace) =>
      currentWorkspace ? clearPageSelection(currentWorkspace) : currentWorkspace,
    );
  }, [updatePresentWorkspace]);

  const selectAllVisiblePages = useCallback(() => {
    updatePresentWorkspace((currentWorkspace) =>
      currentWorkspace ? selectAllPages(currentWorkspace) : currentWorkspace,
    );
  }, [updatePresentWorkspace]);

  const showToast = useCallback((message: string, tone: WorkspaceToast['tone'] = 'info') => {
    setWorkspaceToast({
      id: crypto.randomUUID(),
      message,
      tone,
    });
  }, []);
  const showErrorToast = useCallback((message: string, error: unknown) => {
    const suggestion = getFriendlyErrorSuggestion(error);

    setWorkspaceToast({
      id: crypto.randomUUID(),
      message: suggestion ? `${message} ${suggestion}` : message,
      tone: 'error',
    });
  }, []);

  const showUndoToast = useCallback((message: string) => {
    setWorkspaceToast({
      action: 'undo',
      id: crypto.randomUUID(),
      message,
      tone: 'info',
    });
  }, []);

  const handleTogglePageBookmark = useCallback(
    (pageId: PdfPageId) => {
      const currentWorkspace = workspaceRef.current;
      const page = currentWorkspace?.pages.find(
        (candidatePage) => candidatePage.id === pageId && !candidatePage.deleted,
      );

      if (!currentWorkspace || !page) {
        return;
      }

      const isBookmarked = currentWorkspace.bookmarkedPageIds.includes(pageId);

      updatePresentWorkspace((currentWorkspace) => togglePageBookmark(currentWorkspace, pageId));
      showToast(
        isBookmarked
          ? `Removed bookmark from page ${page.displayIndex}.`
          : `Bookmarked page ${page.displayIndex}.`,
        'success',
      );
    },
    [showToast, updatePresentWorkspace],
  );

  const handleToggleActivePageBookmark = useCallback(() => {
    if (activePage) {
      handleTogglePageBookmark(activePage.id);
    }
  }, [activePage, handleTogglePageBookmark]);

  const handleTogglePageOverview = useCallback(() => {
    if (!activeWorkspaceId || pageCount === 0) {
      return;
    }

    setIsPageOverviewOpen((currentValue) => !currentValue);
  }, [activeWorkspaceId, pageCount]);

  const closePageOverview = useCallback(() => {
    setIsPageOverviewOpen(false);
  }, []);

  const resolvePendingPdfPassword = useCallback((password: string | null) => {
    const resolver = pendingPdfPasswordResolverRef.current;
    pendingPdfPasswordResolverRef.current = null;
    setPendingPdfPasswordRequest(null);
    resolver?.(password);
  }, []);

  const requestPdfPassword = useCallback<PdfPasswordProvider>((request) => {
    pendingPdfPasswordResolverRef.current?.(null);

    return new Promise((resolve) => {
      pendingPdfPasswordResolverRef.current = resolve;
      setPendingPdfPasswordRequest({
        ...request,
        id: crypto.randomUUID(),
        kind: 'open',
      });
    });
  }, []);

  const requestNewPdfPassword = useCallback(
    ({
      description,
      submitLabel,
      title,
    }: {
      description: string;
      submitLabel: string;
      title: string;
    }): Promise<string | null> => {
      pendingPdfPasswordResolverRef.current?.(null);

      return new Promise((resolve) => {
        pendingPdfPasswordResolverRef.current = resolve;
        setPendingPdfPasswordRequest({
          description,
          id: crypto.randomUUID(),
          kind: 'create',
          submitLabel,
          title,
        });
      });
    },
    [],
  );

  const resolveProtectedExportChoice = useCallback((choice: ProtectedPdfExportChoice | null) => {
    const resolver = pendingProtectedExportResolverRef.current;
    pendingProtectedExportResolverRef.current = null;
    setIsProtectedExportChoiceOpen(false);
    resolver?.(choice);
  }, []);

  const requestProtectedExportChoice = useCallback((): Promise<ProtectedPdfExportChoice | null> => {
    pendingProtectedExportResolverRef.current?.(null);

    return new Promise((resolve) => {
      pendingProtectedExportResolverRef.current = resolve;
      setIsProtectedExportChoiceOpen(true);
    });
  }, []);

  const rememberAcceptedPasswords = useCallback(
    (documents: PdfDocumentSource[], acceptedPasswords: string[]) => {
      let passwordIndex = 0;

      for (const document of documents) {
        if (!document.security?.wasEncrypted) {
          continue;
        }

        documentPasswordsRef.current.set(document.id, acceptedPasswords[passwordIndex] ?? '');
        passwordIndex += 1;
      }
    },
    [],
  );

  const loadPdfDocumentsForSession = useCallback(
    async (paths: string[]): Promise<PdfDocumentSource[]> => {
      const acceptedPasswords: string[] = [];
      const documents = await loadPdfDocumentsFromPaths(paths, {
        onPasswordAccepted: (password) => acceptedPasswords.push(password),
        requestPassword: requestPdfPassword,
      });

      rememberAcceptedPasswords(documents, acceptedPasswords);
      return documents;
    },
    [rememberAcceptedPasswords, requestPdfPassword],
  );

  const openPdfDocumentsForSession = useCallback(async (): Promise<PdfDocumentSource[]> => {
    const acceptedPasswords: string[] = [];
    const documents = await openPdfDocuments({
      onPasswordAccepted: (password) => acceptedPasswords.push(password),
      requestPassword: requestPdfPassword,
    });

    rememberAcceptedPasswords(documents, acceptedPasswords);
    return documents;
  }, [rememberAcceptedPasswords, requestPdfPassword]);

  const loadPdfPathForSession = useCallback(
    async (path: string, sessionDocumentId?: string): Promise<PdfDocumentSource> => {
      let acceptedPassword = '';
      let wasPasswordAccepted = false;
      const document = await loadPdfFromPath(path, {
        onPasswordAccepted: (password) => {
          acceptedPassword = password;
          wasPasswordAccepted = true;
        },
        requestPassword: requestPdfPassword,
      });

      if (wasPasswordAccepted) {
        documentPasswordsRef.current.set(sessionDocumentId ?? document.id, acceptedPassword);
      }

      return document;
    },
    [requestPdfPassword],
  );

  const loadRecoveredDocumentFromCacheForSession = useCallback(
    async (source: AutosavedWorkspaceDocument): Promise<PdfDocumentSource | null> => {
      let acceptedPassword = '';
      let wasPasswordAccepted = false;
      const document = await loadRecoveredDocumentFromCache(source, {
        onPasswordAccepted: (password) => {
          acceptedPassword = password;
          wasPasswordAccepted = true;
        },
        requestPassword: requestPdfPassword,
      });

      if (document && wasPasswordAccepted) {
        documentPasswordsRef.current.set(source.id, acceptedPassword);
      }

      return document;
    },
    [requestPdfPassword],
  );

  useEffect(
    () => () => {
      const passwordResolver = pendingPdfPasswordResolverRef.current;
      const exportResolver = pendingProtectedExportResolverRef.current;
      pendingPdfPasswordResolverRef.current = null;
      pendingProtectedExportResolverRef.current = null;
      passwordResolver?.(null);
      exportResolver?.(null);
      documentPasswordsRef.current.clear();
    },
    [],
  );

  const handleChangeStorageSettings = useCallback(
    (settingsPatch: Partial<WorkspaceStorageSettings>) => {
      setStorageSettings((currentSettings) => {
        const nextSettings = {
          ...currentSettings,
          ...settingsPatch,
        };

        writeWorkspaceStorageSettings(nextSettings);

        if (!nextSettings.rememberRecentFiles) {
          clearRecentPdfFiles();
          setRecentFiles([]);
        }

        if (!nextSettings.autosaveWorkspace) {
          clearAutosavedWorkspace();
          setRecoverySnapshot(null);
          setRecoveryMissingSourceIds(new Set());
          setRecoveryRelinkedDocuments({});
          setRecoveryCachedSourceIds(new Set());
        } else if (workspace) {
          writeAutosavedWorkspace(workspace);
          void writeAutosavedWorkspaceSources(workspace).catch((error) => {
            logDeveloperError('Unable to cache autosaved source PDFs.', error);
          });
        }

        return nextSettings;
      });
    },
    [workspace],
  );

  const handleClearLocalData = useCallback(() => {
    clearRecentPdfFiles();
    clearAutosavedWorkspace();
    setRecentFiles([]);
    setRecoverySnapshot(null);
    setRecoveryMissingSourceIds(new Set());
    setRecoveryRelinkedDocuments({});
    setRecoveryCachedSourceIds(new Set());
    showToast('Cleared local autosave metadata and recent files.', 'success');
  }, [showToast]);

  const handleDismissRecovery = useCallback(() => {
    clearAutosavedWorkspace();
    setRecoverySnapshot(null);
    setRecoveryMissingSourceIds(new Set());
    setRecoveryRelinkedDocuments({});
    setRecoveryCachedSourceIds(new Set());
  }, []);

  const handleChangeAppTheme = useCallback((theme: AppTheme) => {
    setAppTheme(theme);
    window.localStorage.setItem(themeStorageKey, theme);
  }, []);

  const handleRecoverWorkspace = useCallback(async () => {
    if (!recoverySnapshot) {
      return;
    }

    setIsRecoveringWorkspace(true);
    try {
      const documents: PdfDocumentSource[] = [];
      const missingSourceIds: string[] = [];

      for (const source of recoverySnapshot.workspace.documents) {
        const relinkedDocument = recoveryRelinkedDocuments[source.id];

        if (relinkedDocument) {
          documents.push(relinkedDocument);
          continue;
        }

        if (source.filePath) {
          try {
            const document = validateRecoveredDocument(
              source,
              await loadPdfPathForSession(source.filePath, source.id),
            );

            documents.push(document);
            continue;
          } catch (error) {
            if (isPdfPasswordCancelledError(error)) {
              throw error;
            }

            logDeveloperError(`Recovered source unavailable: ${source.fileName}`, error);
          }
        }

        try {
          const document = await loadRecoveredDocumentFromCacheForSession(source);

          if (!document) {
            missingSourceIds.push(source.id);
            continue;
          }

          documents.push(document);
        } catch (error) {
          if (isPdfPasswordCancelledError(error)) {
            throw error;
          }

          logDeveloperError(`Cached recovered source unavailable: ${source.fileName}`, error);
          missingSourceIds.push(source.id);
        }
      }

      if (missingSourceIds.length > 0) {
        setRecoveryMissingSourceIds(new Set(missingSourceIds));
        showToast('Relink missing source files to recover this workspace.', 'error');
        return;
      }

      replaceWorkspace(createWorkspaceFromAutosave(recoverySnapshot, documents));
      setRecoverySnapshot(null);
      setRecoveryMissingSourceIds(new Set());
      setRecoveryRelinkedDocuments({});
      setRecoveryCachedSourceIds(new Set());
      rememberRecentFiles(
        documents.flatMap((document) => (document.filePath ? [document.filePath] : [])),
      );
      showToast('Recovered previous workspace.', 'success');
    } catch (error) {
      if (isPdfPasswordCancelledError(error)) {
        return;
      }

      logDeveloperError('Workspace recovery failed.', error);
      showErrorToast(getPdfLoadErrorMessage(error), error);
    } finally {
      setIsRecoveringWorkspace(false);
    }
  }, [
    recoveryRelinkedDocuments,
    recoverySnapshot,
    loadPdfPathForSession,
    loadRecoveredDocumentFromCacheForSession,
    rememberRecentFiles,
    replaceWorkspace,
    showErrorToast,
    showToast,
  ]);

  const handleRelinkRecoverySource = useCallback(
    async (sourceDocumentId: string) => {
      if (!recoverySnapshot) {
        return;
      }

      const source = recoverySnapshot.workspace.documents.find(
        (document) => document.id === sourceDocumentId,
      );

      if (!source) {
        return;
      }

      const filePath = await pickPdfPath(source.filePath);

      if (!filePath) {
        return;
      }

      setIsRecoveringWorkspace(true);
      try {
        const document = validateRecoveredDocument(
          source,
          await loadPdfPathForSession(filePath, source.id),
        );

        setRecoveryRelinkedDocuments((currentDocuments) => ({
          ...currentDocuments,
          [source.id]: document,
        }));
        setRecoveryMissingSourceIds((currentSourceIds) => {
          const nextSourceIds = new Set(currentSourceIds);
          nextSourceIds.delete(source.id);
          return nextSourceIds;
        });
        rememberRecentFiles(document.filePath ? [document.filePath] : []);
        showToast(`Relinked ${source.fileName}.`, 'success');
      } catch (error) {
        if (isPdfPasswordCancelledError(error)) {
          return;
        }

        logDeveloperError('Recovery source relink failed.', error);
        showErrorToast(getPdfLoadErrorMessage(error), error);
      } finally {
        setIsRecoveringWorkspace(false);
      }
    },
    [loadPdfPathForSession, recoverySnapshot, rememberRecentFiles, showErrorToast, showToast],
  );

  const deletePageSelection = useCallback(
    (pageIds: PdfPageId[]) => {
      if (!workspace || pageIds.length === 0) {
        return;
      }

      const pageIdSet = new Set(pageIds);
      const pageIdsToDelete = getVisiblePages(workspace)
        .filter((page) => pageIdSet.has(page.id))
        .map((page) => page.id);

      if (pageIdsToDelete.length === 0) {
        return;
      }

      if (
        pageIdsToDelete.length > confirmDeletePageThreshold &&
        !window.confirm(`Delete ${pageIdsToDelete.length} selected pages? This can be undone.`)
      ) {
        return;
      }

      const nextWorkspace = deletePages(workspace, pageIdsToDelete);

      if (nextWorkspace !== workspace) {
        commitWorkspaceEdit(() => nextWorkspace);
        showUndoToast(formatPageActionMessage('Deleted', pageIdsToDelete.length));
      }
    },
    [commitWorkspaceEdit, showUndoToast, workspace],
  );

  const undoLastWorkspaceEdit = useCallback(() => {
    updateActiveWorkspaceHistory(undoWorkspaceHistory);
    setWorkspaceToast(null);
  }, [updateActiveWorkspaceHistory]);

  const redoLastWorkspaceEdit = useCallback(() => {
    updateActiveWorkspaceHistory(redoWorkspaceHistory);
    setWorkspaceToast(null);
  }, [updateActiveWorkspaceHistory]);

  const openFindBar = useCallback(() => {
    setIsFindOpen(true);
  }, []);

  const closeFindBar = useCallback(() => {
    setIsFindOpen(false);
    setFindError(null);
  }, []);

  const goToFindResult = useCallback(
    (nextIndex: number) => {
      if (findResults.length === 0) {
        return;
      }

      const normalizedIndex = (nextIndex + findResults.length) % findResults.length;
      const result = findResults[normalizedIndex];

      setFindActiveIndex(normalizedIndex);
      activatePage(result.pageId);
    },
    [activatePage, findResults],
  );

  const goToNextFindResult = useCallback(() => {
    goToFindResult(findActiveIndex + 1);
  }, [findActiveIndex, goToFindResult]);

  const goToPreviousFindResult = useCallback(() => {
    goToFindResult(findActiveIndex - 1);
  }, [findActiveIndex, goToFindResult]);

  const openDocumentsInNewWorkspace = useCallback(
    (documents: PdfDocumentSource[]) => {
      openWorkspaceInNewTab(createWorkspaceFromDocuments(documents));
      rememberRecentFiles(
        documents.flatMap((document) => (document.filePath ? [document.filePath] : [])),
      );
    },
    [openWorkspaceInNewTab, rememberRecentFiles],
  );

  const addDocumentsToWorkspaceTab = useCallback(
    (workspaceId: string, documents: PdfDocumentSource[]) => {
      updateWorkspaceTabHistory(workspaceId, (currentHistory) =>
        commitWorkspaceHistory(
          currentHistory,
          appendDocumentsToWorkspace(currentHistory.present, documents),
        ),
      );
      setActiveWorkspaceId(workspaceId);
      rememberRecentFiles(
        documents.flatMap((document) => (document.filePath ? [document.filePath] : [])),
      );
    },
    [rememberRecentFiles, updateWorkspaceTabHistory],
  );

  const addDocumentsToCurrentWorkspace = useCallback(
    (documents: PdfDocumentSource[]) => {
      if (!activeWorkspaceId) {
        openDocumentsInNewWorkspace(documents);
        return;
      }

      addDocumentsToWorkspaceTab(activeWorkspaceId, documents);
    },
    [activeWorkspaceId, addDocumentsToWorkspaceTab, openDocumentsInNewWorkspace],
  );

  const requestPdfImportTarget = useCallback(
    ({
      paths,
      source,
    }: {
      paths: string[];
      source: PendingPdfImportSource;
    }): Promise<PdfImportTarget | null> => {
      if (workspaceTabs.length === 0) {
        return Promise.resolve({ kind: 'new' });
      }

      pendingPdfImportResolverRef.current?.(null);

      return new Promise((resolve) => {
        pendingPdfImportResolverRef.current = resolve;
        setPendingPdfImportRequest({
          id: crypto.randomUUID(),
          fileNames: paths.map(getFileNameFromPath),
          source,
          suggestedWorkspaceId: activeWorkspaceId ?? workspaceTabs[0]?.id ?? null,
        });
      });
    },
    [activeWorkspaceId, workspaceTabs],
  );

  const resolvePendingPdfImportTarget = useCallback((target: PdfImportTarget | null) => {
    pendingPdfImportResolverRef.current?.(target);
    pendingPdfImportResolverRef.current = null;
    setPendingPdfImportRequest(null);
  }, []);

  const handlePdfPathsWithPrompt = useCallback(
    async (paths: string[], source: PendingPdfImportSource) => {
      const pdfPaths = paths.filter(isPdfPath);

      if (pdfPaths.length === 0) {
        showToast('Choose one or more PDF files.', 'error');
        return;
      }

      setWorkspaceToast(null);
      setIsDraggingPdfs(false);

      const target = await requestPdfImportTarget({ paths: pdfPaths, source });

      if (!target) {
        return;
      }

      if (target.kind === 'workspace') {
        setIsAddingPdfs(true);
      } else {
        setIsOpeningPdf(true);
      }

      try {
        const documents = await loadPdfDocumentsForSession(pdfPaths);

        if (target.kind === 'workspace') {
          addDocumentsToWorkspaceTab(target.workspaceId, documents);
          showToast(
            `Added ${documents.length} ${documents.length === 1 ? 'PDF' : 'PDFs'} to the workspace.`,
            'success',
          );
        } else {
          openDocumentsInNewWorkspace(documents);
          showToast(
            `Opened ${documents.length} ${documents.length === 1 ? 'PDF' : 'PDFs'} in a new workspace.`,
            'success',
          );
        }
      } catch (error) {
        if (isPdfPasswordCancelledError(error)) {
          return;
        }

        logDeveloperError('PDF import failed.', error);
        showErrorToast(getPdfLoadErrorMessage(error), error);
      } finally {
        setIsAddingPdfs(false);
        setIsOpeningPdf(false);
      }
    },
    [
      addDocumentsToWorkspaceTab,
      loadPdfDocumentsForSession,
      openDocumentsInNewWorkspace,
      requestPdfImportTarget,
      showErrorToast,
      showToast,
    ],
  );

  const handleOpenPdf = useCallback(async () => {
    const path = await pickPdfPath();

    if (!path) {
      return;
    }

    await handlePdfPathsWithPrompt([path], 'file-picker');
  }, [handlePdfPathsWithPrompt]);

  const handleSelectWorkspaceTab = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  }, []);

  const handleCloseWorkspaceTab = useCallback(
    (workspaceId: string) => {
      const tabToClose = workspaceTabs.find((tab) => tab.id === workspaceId);

      if (!tabToClose) {
        return;
      }

      if (
        tabToClose.history.past.length > 0 &&
        !window.confirm(
          `Close "${tabToClose.history.present.name}"? Unsaved edits will be removed.`,
        )
      ) {
        return;
      }

      const tabIndex = workspaceTabs.findIndex((tab) => tab.id === workspaceId);
      const nextTabs = workspaceTabs.filter((tab) => tab.id !== workspaceId);

      for (const document of tabToClose.history.present.documents) {
        documentPasswordsRef.current.delete(document.id);
      }

      setWorkspaceTabs(nextTabs);

      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspaceId(nextTabs[Math.min(tabIndex, nextTabs.length - 1)]?.id ?? null);
      }
    },
    [activeWorkspaceId, workspaceTabs],
  );

  const handleRenameWorkspaceTab = useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim() || 'Untitled workspace';

    setWorkspaceTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === workspaceId
          ? {
              ...tab,
              history: updateWorkspaceHistoryPresent(tab.history, {
                ...tab.history.present,
                name: nextName,
              }),
            }
          : tab,
      ),
    );
  }, []);

  const handleChangeWorkspaceTabColor = useCallback((workspaceId: string, color: string) => {
    setWorkspaceTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === workspaceId ? { ...tab, color } : tab)),
    );
  }, []);

  const handleChangeWorkspaceTabFont = useCallback((workspaceId: string, fontFamily: string) => {
    setWorkspaceTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === workspaceId ? { ...tab, fontFamily } : tab)),
    );
  }, []);

  const handleExportPdf = useCallback(async () => {
    if (!workspace || !canExportWorkspace(workspace)) {
      showToast('Paperdesk cannot export an empty document.', 'error');
      return;
    }

    const protectedDocuments = workspace.documents.filter(
      (document) => document.security?.wasEncrypted,
    );
    let protectionChoice: ProtectedPdfExportChoice = 'unlocked';
    let protectionPassword: string | null = null;

    if (protectedDocuments.length > 0) {
      const requestedChoice = await requestProtectedExportChoice();

      if (!requestedChoice) {
        return;
      }

      protectionChoice = requestedChoice;

      if (protectionChoice === 'protected') {
        const sessionPasswords = new Set(
          protectedDocuments
            .map((document) => documentPasswordsRef.current.get(document.id))
            .filter((password): password is string => Boolean(password)),
        );

        if (sessionPasswords.size === 1) {
          protectionPassword = Array.from(sessionPasswords)[0];
        } else {
          protectionPassword = await requestNewPdfPassword({
            description:
              'Set the password that will open this exported copy. The workspace may contain sources with different passwords.',
            submitLabel: 'Continue to export',
            title: 'Set export password',
          });
        }

        if (protectionPassword === null) {
          return;
        }
      }
    }

    setIsExportingPdf(true);
    showToast('Exporting PDF...', 'info');

    try {
      const result =
        protectionChoice === 'protected' && protectionPassword !== null
          ? await saveWorkspacePdfBytes({
              bytes: await protectPdfBytes(
                await exportWorkspaceToPdfBytes(workspace),
                protectionPassword,
              ),
              defaultPath: getDefaultExportFileName(workspace),
              title: 'Export Protected PDF',
              workspace,
            })
          : await saveWorkspacePdf(workspace);

      if (!result) {
        setWorkspaceToast(null);
        return;
      }

      showToast(
        `Exported ${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'} to PDF.`,
        'success',
      );
    } catch (error) {
      logDeveloperError('Export PDF failed.', error);
      showErrorToast(
        error instanceof PdfSecurityError
          ? getPdfSecurityErrorMessage(error)
          : getPdfExportErrorMessage(error),
        error,
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [requestNewPdfPassword, requestProtectedExportChoice, showErrorToast, showToast, workspace]);

  const handleLockPdf = useCallback(async () => {
    if (!workspace || !canExportWorkspace(workspace)) {
      showToast('Paperdesk cannot lock an empty document.', 'error');
      return;
    }

    const password = await requestNewPdfPassword({
      description:
        'Set an open password for a new protected copy. Your current workspace will remain unlocked for editing.',
      submitLabel: 'Choose save location',
      title: 'Lock PDF copy',
    });

    if (password === null) {
      return;
    }

    setIsExportingPdf(true);
    showToast('Protecting PDF...', 'info');

    try {
      const protectedBytes = await protectPdfBytes(
        await exportWorkspaceToPdfBytes(workspace),
        password,
      );
      const result = await saveWorkspacePdfBytes({
        bytes: protectedBytes,
        defaultPath: getSuffixedExportFileName(workspace, 'protected'),
        title: 'Save Protected PDF Copy',
        workspace,
      });

      if (!result) {
        setWorkspaceToast(null);
        return;
      }

      showToast(
        `Saved a protected copy with ${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'}.`,
        'success',
      );
    } catch (error) {
      logDeveloperError('Protect PDF failed.', error);
      showErrorToast(
        error instanceof PdfSecurityError
          ? getPdfSecurityErrorMessage(error)
          : getPdfExportErrorMessage(error),
        error,
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [requestNewPdfPassword, showErrorToast, showToast, workspace]);

  const handleSaveUnlockedPdf = useCallback(async () => {
    if (!workspace || !canExportWorkspace(workspace)) {
      showToast('Paperdesk cannot save an empty document.', 'error');
      return;
    }

    setIsExportingPdf(true);
    showToast('Preparing unlocked copy...', 'info');

    try {
      const result = await saveWorkspacePdfBytes({
        bytes: await exportWorkspaceToPdfBytes(workspace),
        defaultPath: getSuffixedExportFileName(workspace, 'unlocked'),
        title: 'Save Unlocked PDF Copy',
        workspace,
      });

      if (!result) {
        setWorkspaceToast(null);
        return;
      }

      showToast(
        `Saved an unlocked copy with ${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'}.`,
        'success',
      );
    } catch (error) {
      logDeveloperError('Save unlocked PDF failed.', error);
      showErrorToast(getPdfExportErrorMessage(error), error);
    } finally {
      setIsExportingPdf(false);
    }
  }, [showErrorToast, showToast, workspace]);

  const handleExportSelectedPages = useCallback(async () => {
    if (!workspace || selectedVisiblePageIds.length === 0) {
      showToast('Select at least one page before exporting selected pages.', 'error');
      return;
    }

    setIsExportingPdf(true);
    showToast('Exporting selected pages...', 'info');

    try {
      const result = await savePageSubsetPdf(workspace, selectedVisiblePageIds);

      if (!result) {
        setWorkspaceToast(null);
        return;
      }

      setExportModalMode(null);
      showToast(
        `Exported ${result.pageCount} selected ${result.pageCount === 1 ? 'page' : 'pages'} to PDF.`,
        'success',
      );
    } catch (error) {
      logDeveloperError('Export selected pages failed.', error);
      showErrorToast(getPdfExportErrorMessage(error), error);
    } finally {
      setIsExportingPdf(false);
    }
  }, [selectedVisiblePageIds, showErrorToast, showToast, workspace]);

  const handleSplitPageRanges = useCallback(
    async (ranges: PdfPageRange[]) => {
      if (!workspace || ranges.length === 0) {
        showToast('Enter one or more page ranges before splitting.', 'error');
        return;
      }

      setIsExportingPdf(true);
      showToast('Splitting PDF...', 'info');

      try {
        const results = await saveWorkspacePageRanges(workspace, ranges);

        if (results.length === 0) {
          setWorkspaceToast(null);
          return;
        }

        setExportModalMode(null);
        showToast(
          results.length === 1
            ? `Exported pages ${results[0].range.label} to PDF.`
            : `Exported ${results.length} split PDFs.`,
          'success',
        );
      } catch (error) {
        logDeveloperError('Split page ranges failed.', error);
        showErrorToast(getPdfExportErrorMessage(error), error);
      } finally {
        setIsExportingPdf(false);
      }
    },
    [showErrorToast, showToast, workspace],
  );

  const handleAddPdfs = useCallback(async () => {
    setIsAddingPdfs(true);
    try {
      const documents = await openPdfDocumentsForSession();

      if (documents.length === 0) {
        return;
      }

      addDocumentsToCurrentWorkspace(documents);
    } catch (error) {
      if (isPdfPasswordCancelledError(error)) {
        return;
      }

      logDeveloperError('Add PDFs failed.', error);
      showErrorToast(getPdfLoadErrorMessage(error), error);
    } finally {
      setIsAddingPdfs(false);
    }
  }, [addDocumentsToCurrentWorkspace, openPdfDocumentsForSession, showErrorToast]);

  const handleDroppedPdfPaths = useCallback(
    async (paths: string[]) => {
      const pdfPaths = paths.filter(isPdfPath);

      if (pdfPaths.length === 0) {
        showToast('Drop one or more PDF files to open them.', 'error');
        return;
      }

      await handlePdfPathsWithPrompt(pdfPaths, 'drop');
    },
    [handlePdfPathsWithPrompt, showToast],
  );

  const handleOpenPdfPathsFromOs = useCallback(
    async (paths: string[]) => {
      const pdfPaths = paths.filter(isPdfPath);

      if (pdfPaths.length === 0) {
        return;
      }

      await handlePdfPathsWithPrompt(pdfPaths, 'os-open');
    },
    [handlePdfPathsWithPrompt],
  );

  const handleOpenRecentFile = useCallback(
    async (filePath: string) => {
      await handlePdfPathsWithPrompt([filePath], 'recent');
    },
    [handlePdfPathsWithPrompt],
  );

  const handleChangeFormatterSettings = useCallback(
    (settings: Partial<FormatterSettings>) => {
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateWorkspaceFormatterSettings(currentWorkspace, settings)
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleInsertBlankPage = useCallback(() => {
    commitWorkspaceEdit((currentWorkspace) =>
      currentWorkspace ? insertBlankPage(currentWorkspace) : currentWorkspace,
    );
    showToast('Inserted blank page.', 'success');
  }, [commitWorkspaceEdit, showToast]);

  const handleInsertCoverPage = useCallback(() => {
    commitWorkspaceEdit((currentWorkspace) =>
      currentWorkspace ? insertCoverPage(currentWorkspace) : currentWorkspace,
    );
    showToast('Inserted cover page.', 'success');
  }, [commitWorkspaceEdit, showToast]);

  const handleChangeFormFieldValue = useCallback(
    (sourceDocumentId: string, fieldName: string, value: PdfFormFieldValue) => {
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateWorkspaceFormFieldValue({
              fieldName,
              sourceDocumentId,
              value,
              workspace: currentWorkspace,
            })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeFormSettings = useCallback(
    (settings: Partial<PdfFormSettings>) => {
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateWorkspaceFormSettings(currentWorkspace, settings)
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleImportFormData = useCallback(
    (formData: PdfFormDataJson) => {
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace ? importWorkspaceFormData(currentWorkspace, formData) : currentWorkspace,
      );
      showToast('Imported form data JSON.', 'success');
    },
    [commitWorkspaceEdit, showToast],
  );

  const handleToggleAnnotating = useCallback(() => {
    setIsAnnotating((currentValue) => {
      const nextValue = !currentValue;

      if (nextValue) {
        setIsHandToolActive(false);
      }

      if (!nextValue) {
        setSelectedAnnotationTool('select');
        setSelectedAnnotationId(null);
      }

      return nextValue;
    });
  }, []);

  const handleToggleHandTool = useCallback(() => {
    setIsHandToolActive((currentValue) => {
      const nextValue = !currentValue;

      if (nextValue) {
        setIsAnnotating(false);
        setSelectedAnnotationTool('select');
        setSelectedAnnotationId(null);
      }

      return nextValue;
    });
  }, []);

  const handleSelectAnnotationTool = useCallback(
    (tool: PdfAnnotationTool) => {
      const isSwitchingTool = selectedAnnotationTool !== tool;

      setIsHandToolActive(false);
      setIsAnnotating(true);
      setSelectedAnnotationTool(tool);
      const defaultColor = getDefaultColorForAnnotationTool(tool);
      const defaultFillColor = getDefaultFillColorForAnnotationTool(tool);
      const defaultBorderColor = getDefaultBorderColorForAnnotationTool(tool);

      if (isSwitchingTool && defaultColor) {
        setAnnotationColor(defaultColor);
      }

      if (isSwitchingTool && defaultFillColor) {
        setAnnotationFillColor(defaultFillColor);
      }

      if (isSwitchingTool && defaultBorderColor) {
        setAnnotationBorderColor(defaultBorderColor);
      }

      if (tool === 'pen') {
        setActiveToolPanel('annotations');
        setIsToolsPanelCollapsed(false);
      }

      if (tool === 'eraser' || tool === 'highlight') {
        setSelectedAnnotationId(null);
      }

      if (tool === 'edit-text') {
        showToast('Drag over embedded PDF text to create an editable replacement overlay.', 'info');
      }
      if (tool === 'text-note') {
        showToast('Drag over embedded PDF text to add a comment.', 'info');
      }
      if (tool === 'free-text') {
        showToast('Right-click to place the text box. Double-click the box to edit text.', 'info');
      }
    },
    [selectedAnnotationTool, showToast],
  );

  const handleCreateAnnotation = useCallback(
    (annotation: Omit<PdfAnnotation, 'createdAt' | 'id'>): PdfAnnotationId => {
      const annotationId = createId('annotation');

      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? createAnnotation(currentWorkspace, {
              ...annotation,
              id: annotationId,
            })
          : currentWorkspace,
      );
      // A freehand highlighter remains a drawing tool after each stroke. It
      // should not be implicitly selected or show selection chrome until the
      // user explicitly switches to Select.
      if (!isFreehandHighlightAnnotation(annotation)) {
        setSelectedAnnotationId(annotationId);
      }

      return annotationId;
    },
    [commitWorkspaceEdit],
  );

  const handleUpdateAnnotation = useCallback(
    (annotationId: PdfAnnotationId, patch: Partial<PdfAnnotation>) => {
      updatePresentWorkspace((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, patch)
          : currentWorkspace,
      );
    },
    [updatePresentWorkspace],
  );

  const handleChangeAnnotationColor = useCallback((color: string) => {
    setAnnotationColor(normalizeAnnotationColor(color));
  }, []);

  const handleChangeAnnotationFillColor = useCallback((color: string) => {
    setAnnotationFillColor(
      normalizeAnnotationPaintColor(color, getDefaultAnnotationFillColor('free-text')),
    );
  }, []);

  const handleChangeAnnotationBorderColor = useCallback((color: string) => {
    setAnnotationBorderColor(
      normalizeAnnotationPaintColor(color, getDefaultAnnotationBorderColor('free-text')),
    );
  }, []);

  const handleChangeSelectedAnnotationColor = useCallback(
    (annotationId: PdfAnnotationId, color: string) => {
      const nextColor = normalizeAnnotationColor(color);

      setAnnotationColor(nextColor);
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, { color: nextColor })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeSelectedAnnotationFillColor = useCallback(
    (annotationId: PdfAnnotationId, color: string) => {
      const nextColor = normalizeAnnotationPaintColor(
        color,
        getDefaultAnnotationFillColor('free-text'),
      );

      setAnnotationFillColor(nextColor);
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, { fillColor: nextColor })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeSelectedAnnotationBorderColor = useCallback(
    (annotationId: PdfAnnotationId, color: string) => {
      const nextColor = normalizeAnnotationPaintColor(
        color,
        getDefaultAnnotationBorderColor('free-text'),
      );

      setAnnotationBorderColor(nextColor);
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, { borderColor: nextColor })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeSelectedAnnotationFont = useCallback(
    (annotationId: PdfAnnotationId, patch: AnnotationFontPatch) => {
      // Picking a family explicitly overrides the document-matched embedded
      // font, otherwise the exact FontFace would keep winning on screen.
      const nextPatch: AnnotationFontPatch =
        'fontId' in patch ? { ...patch, embeddedFontName: undefined } : patch;

      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, nextPatch)
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeAnnotationStrokeWidth = useCallback((strokeWidth: number) => {
    setAnnotationStrokeWidth(normalizePenStrokeWidth(strokeWidth));
  }, []);

  const handleChangeEraserSize = useCallback((nextEraserSize: number) => {
    setEraserSize(normalizeEraserSize(nextEraserSize));
  }, []);

  const handleChangeHighlightBrushSize = useCallback((brushSize: number) => {
    setHighlightBrushSize(normalizeHighlightBrushSize(brushSize));
  }, []);

  const handleChangeHighlightOpacity = useCallback((opacity: number) => {
    setHighlightOpacity(normalizeHighlightOpacity(opacity));
  }, []);

  const handleChangeFreehandSensitivity = useCallback((sensitivity: FreehandSensitivity) => {
    setFreehandSensitivity(normalizeFreehandSensitivity(sensitivity));
  }, []);

  const handleUpdateAnnotationPasteTarget = useCallback(
    (target: PdfAnnotationPasteTarget | null) => {
      annotationPasteTargetRef.current = target;
    },
    [],
  );

  const handleCopySelectedFreehandAnnotation = useCallback(() => {
    const currentWorkspace = workspaceRef.current;
    const annotation = currentWorkspace?.annotations.find(
      (candidateAnnotation) => candidateAnnotation.id === selectedAnnotationId,
    );

    if (!annotation || !isFreehandStrokeAnnotation(annotation)) {
      return;
    }

    setCopiedFreehandAnnotations([
      {
        ...annotation,
        points: annotation.points?.map((point) => ({ ...point })),
      },
    ]);
    showToast('Copied freehand annotation.', 'success');
  }, [selectedAnnotationId, showToast]);

  const handlePasteFreehandAnnotation = useCallback(() => {
    const currentWorkspace = workspaceRef.current;
    const visibleWorkspacePages = currentWorkspace ? getVisiblePages(currentWorkspace) : [];
    const currentPasteTarget = annotationPasteTargetRef.current;
    const targetPage =
      currentPasteTarget &&
      visibleWorkspacePages.some((page) => page.id === currentPasteTarget.pageItemId)
        ? visibleWorkspacePages.find((page) => page.id === currentPasteTarget.pageItemId)
        : (visibleWorkspacePages.find((page) => page.id === currentWorkspace?.activePageId) ??
          visibleWorkspacePages[0]);

    if (!currentWorkspace || !targetPage || copiedFreehandAnnotations.length === 0) {
      return;
    }

    const pasteOffset = 14;
    const createdAt = new Date().toISOString();
    const pasteTarget =
      currentPasteTarget && currentPasteTarget.pageItemId === targetPage.id
        ? currentPasteTarget
        : null;
    const pastedAnnotations = cloneFreehandAnnotationsForPaste({
      annotations: copiedFreehandAnnotations,
      createAnnotationId: () => createId('annotation'),
      createdAt,
      fallbackOffset: pasteOffset,
      fallbackPageItemId: targetPage.id,
      target: pasteTarget,
    });

    if (pastedAnnotations.length === 0) {
      return;
    }

    commitWorkspaceEdit((workspaceToUpdate) =>
      workspaceToUpdate
        ? {
            ...workspaceToUpdate,
            activePageId: targetPage.id,
            annotations: [...workspaceToUpdate.annotations, ...pastedAnnotations],
          }
        : workspaceToUpdate,
    );
    setIsAnnotating(true);
    setSelectedAnnotationTool('select');
    setSelectedAnnotationId(pastedAnnotations[pastedAnnotations.length - 1].id);
    showUndoToast(
      pastedAnnotations.length === 1
        ? 'Pasted freehand annotation.'
        : `Pasted ${pastedAnnotations.length} freehand annotations.`,
    );
  }, [commitWorkspaceEdit, copiedFreehandAnnotations, showUndoToast]);

  const handleChangeSelectedAnnotationStrokeWidth = useCallback(
    (annotationId: PdfAnnotationId, strokeWidth: number) => {
      const nextStrokeWidth = normalizePenStrokeWidth(strokeWidth);

      setAnnotationStrokeWidth(nextStrokeWidth);
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, { strokeWidth: nextStrokeWidth })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeSelectedAnnotationHighlightBrushSize = useCallback(
    (annotationId: PdfAnnotationId, brushSize: number) => {
      const nextBrushSize = normalizeHighlightBrushSize(brushSize);

      setHighlightBrushSize(nextBrushSize);
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, { strokeWidth: nextBrushSize })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleChangeSelectedAnnotationOpacity = useCallback(
    (annotationId: PdfAnnotationId, opacity: number) => {
      const nextOpacity = normalizeHighlightOpacity(opacity);

      setHighlightOpacity(nextOpacity);
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace
          ? updateAnnotation(currentWorkspace, annotationId, { opacity: nextOpacity })
          : currentWorkspace,
      );
    },
    [commitWorkspaceEdit],
  );

  const handleCommitAnnotationChange = useCallback(
    (previousAnnotation: PdfAnnotation, nextAnnotation: PdfAnnotation) => {
      updateActiveWorkspaceHistory((currentHistory) => {
        const currentWorkspace = currentHistory.present;
        const previousWorkspace = {
          ...currentWorkspace,
          annotations: currentWorkspace.annotations.map((annotation) =>
            annotation.id === previousAnnotation.id ? previousAnnotation : annotation,
          ),
        };
        const nextWorkspace = recordAnnotationMove(
          currentWorkspace,
          previousAnnotation,
          nextAnnotation,
        );

        return commitWorkspaceHistoryFromPrevious(currentHistory, previousWorkspace, nextWorkspace);
      });
    },
    [updateActiveWorkspaceHistory],
  );

  const handleDeleteAnnotation = useCallback(
    (annotationId: PdfAnnotationId) => {
      commitWorkspaceEdit((currentWorkspace) =>
        currentWorkspace ? deleteAnnotation(currentWorkspace, annotationId) : currentWorkspace,
      );
      setSelectedAnnotationId(null);
      showUndoToast('Deleted annotation.');
    },
    [commitWorkspaceEdit, showUndoToast],
  );

  const handleEraseAnnotationPixels = useCallback(
    (replacements: PdfAnnotationEraseReplacement[]) => {
      if (!replacements.length) {
        return;
      }

      const replacementsByAnnotationId = new Map(
        replacements.map(
          (replacement) => [replacement.originalAnnotation.id, replacement] as const,
        ),
      );
      const selectedReplacement = selectedAnnotationId
        ? replacementsByAnnotationId.get(selectedAnnotationId)
        : undefined;
      const createdAt = new Date().toISOString();

      commitWorkspaceEdit((currentWorkspace) => {
        if (!currentWorkspace) {
          return currentWorkspace;
        }

        const nextAnnotations = currentWorkspace.annotations.flatMap((annotation) => {
          const replacement = replacementsByAnnotationId.get(annotation.id);

          if (!replacement) {
            return [annotation];
          }

          return replacement.segments.map((segment, segmentIndex) => ({
            ...annotation,
            ...segment,
            id: segmentIndex === 0 ? annotation.id : createId('annotation'),
            createdAt: segmentIndex === 0 ? annotation.createdAt : createdAt,
          }));
        });

        return {
          ...currentWorkspace,
          annotations: nextAnnotations,
        };
      });

      if (selectedReplacement?.segments.length === 0) {
        setSelectedAnnotationId(null);
      }

      showUndoToast('Erased freehand pixels.');
    },
    [commitWorkspaceEdit, selectedAnnotationId, showUndoToast],
  );

  const handleGoPrevious = useCallback(() => {
    selectPageByIndex(activePageIndex - 1);
  }, [activePageIndex, selectPageByIndex]);

  const handleGoNext = useCallback(() => {
    selectPageByIndex(activePageIndex + 1);
  }, [activePageIndex, selectPageByIndex]);

  const handlePageNumberChange = useCallback(
    (pageNumber: number) => {
      selectPageByIndex(pageNumber - 1);
    },
    [selectPageByIndex],
  );

  const handleZoomIn = useCallback(() => {
    updatePresentWorkspace((currentWorkspace) => {
      if (!currentWorkspace) {
        return currentWorkspace;
      }

      const nextZoom = clampZoom(currentWorkspace.formatterSettings.zoom + zoomStep);

      return {
        ...currentWorkspace,
        formatterSettings: {
          ...currentWorkspace.formatterSettings,
          fitMode: 'page',
          zoom: nextZoom,
        },
      };
    });
  }, [updatePresentWorkspace]);

  const handleZoomOut = useCallback(() => {
    updatePresentWorkspace((currentWorkspace) => {
      if (!currentWorkspace) {
        return currentWorkspace;
      }

      const nextZoom = clampZoom(currentWorkspace.formatterSettings.zoom - zoomStep);

      return {
        ...currentWorkspace,
        formatterSettings: {
          ...currentWorkspace.formatterSettings,
          fitMode: 'page',
          zoom: nextZoom,
        },
      };
    });
  }, [updatePresentWorkspace]);

  const handleZoomPercentChange = useCallback(
    (zoomPercentValue: number) => {
      if (!Number.isFinite(zoomPercentValue)) {
        return;
      }

      updatePresentWorkspace((currentWorkspace) => {
        if (!currentWorkspace) {
          return currentWorkspace;
        }

        const nextZoom = clampZoom(zoomPercentValue / 100);

        if (nextZoom === currentWorkspace.formatterSettings.zoom) {
          return currentWorkspace;
        }

        return {
          ...currentWorkspace,
          formatterSettings: {
            ...currentWorkspace.formatterSettings,
            fitMode: 'page',
            zoom: nextZoom,
          },
        };
      });
    },
    [updatePresentWorkspace],
  );

  const handleZoomByFactor = useCallback(
    (zoomFactor: number) => {
      if (!Number.isFinite(zoomFactor) || zoomFactor <= 0 || zoomFactor === 1) {
        return;
      }

      updatePresentWorkspace((currentWorkspace) => {
        if (!currentWorkspace) {
          return currentWorkspace;
        }

        const nextZoom = clampZoom(currentWorkspace.formatterSettings.zoom * zoomFactor);

        if (nextZoom === currentWorkspace.formatterSettings.zoom) {
          return currentWorkspace;
        }

        return {
          ...currentWorkspace,
          formatterSettings: {
            ...currentWorkspace.formatterSettings,
            fitMode: 'page',
            zoom: nextZoom,
          },
        };
      });
    },
    [updatePresentWorkspace],
  );

  const handleWheelZoom = useCallback(
    (deltaY: number) => {
      if (!Number.isFinite(deltaY) || deltaY === 0) {
        return;
      }

      handleZoomByFactor(Math.exp(-deltaY * wheelZoomSensitivity));
    },
    [handleZoomByFactor],
  );

  const handleToggleThumbnailSidebar = useCallback(() => {
    setIsThumbnailSidebarCollapsed((currentValue) => !currentValue);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const appWindow = getCurrentWindow();

    try {
      const nextFullscreenState = !(await appWindow.isFullscreen());

      await appWindow.setFullscreen(nextFullscreenState);
      setIsFullscreen(nextFullscreenState);
    } catch (error) {
      logDeveloperError('Toggle fullscreen failed.', error);
      showToast('Fullscreen could not be changed.', 'error');
    }
  }, [showToast]);

  const handleThumbnailRendered = useCallback(
    (pageId: PdfPageId, thumbnailDataUrl: string) => {
      updatePresentWorkspace((currentWorkspace) => {
        if (!currentWorkspace) {
          return currentWorkspace;
        }

        let didUpdate = false;
        const pages = currentWorkspace.pages.map((page) => {
          if (page.id !== pageId || page.thumbnailDataUrl === thumbnailDataUrl) {
            return page;
          }

          didUpdate = true;
          return {
            ...page,
            thumbnailDataUrl,
          };
        });

        return didUpdate ? { ...currentWorkspace, pages } : currentWorkspace;
      });
    },
    [updatePresentWorkspace],
  );

  const handleMovePage = useCallback(
    (pageId: PdfPageId, direction: -1 | 1) => {
      if (!workspace) {
        return;
      }

      const nextWorkspace = movePageInWorkspace(workspace, pageId, direction);

      if (nextWorkspace !== workspace) {
        commitWorkspaceEdit(() => nextWorkspace);
        showUndoToast(formatPageActionMessage('Moved', 1));
      }
    },
    [commitWorkspaceEdit, showUndoToast, workspace],
  );

  const handleReorderPages = useCallback(
    (activePageId: PdfPageId, overPageId: PdfPageId) => {
      if (!workspace || activePageId === overPageId) {
        return;
      }

      const pageIdsToMove = selectedVisiblePageIds.includes(activePageId)
        ? selectedVisiblePageIds
        : [activePageId];
      const nextWorkspace = moveSelectedPages(workspace, pageIdsToMove, overPageId);

      if (nextWorkspace !== workspace) {
        commitWorkspaceEdit(() => nextWorkspace);
        showUndoToast(formatPageActionMessage('Moved', pageIdsToMove.length));
      }
    },
    [commitWorkspaceEdit, selectedVisiblePageIds, showUndoToast, workspace],
  );

  const rotatePageSelection = useCallback(
    (pageIds: PdfPageId[], direction: PdfRotationDirection) => {
      if (!workspace || pageIds.length === 0) {
        return;
      }

      const pageIdSet = new Set(pageIds);
      const pageIdsToRotate = getVisiblePages(workspace)
        .filter((page) => pageIdSet.has(page.id))
        .map((page) => page.id);

      if (pageIdsToRotate.length === 0) {
        return;
      }

      const nextWorkspace = rotatePages(workspace, pageIdsToRotate, direction);

      if (nextWorkspace !== workspace) {
        commitWorkspaceEdit(() => nextWorkspace);
        showUndoToast(formatPageActionMessage('Rotated', pageIdsToRotate.length));
      }
    },
    [commitWorkspaceEdit, showUndoToast, workspace],
  );

  const handleRotateSelectedPagesLeft = useCallback(() => {
    rotatePageSelection(selectedVisiblePageIds, 'counterclockwise');
  }, [rotatePageSelection, selectedVisiblePageIds]);

  const handleRotateSelectedPagesRight = useCallback(() => {
    rotatePageSelection(selectedVisiblePageIds, 'clockwise');
  }, [rotatePageSelection, selectedVisiblePageIds]);

  const handleShortcutDelete = useCallback(() => {
    if (selectedAnnotationId) {
      handleDeleteAnnotation(selectedAnnotationId);
      return;
    }

    deletePageSelection(selectedVisiblePageIds);
  }, [deletePageSelection, handleDeleteAnnotation, selectedAnnotationId, selectedVisiblePageIds]);

  useEffect(() => {
    if (!storageSettings.rememberRecentFiles) {
      clearRecentPdfFiles();
      setRecentFiles([]);
    }
  }, [storageSettings.rememberRecentFiles]);

  useEffect(() => {
    if (!recoverySnapshot) {
      setRecoveryCachedSourceIds(new Set());
      return;
    }

    let isStale = false;

    Promise.all(
      recoverySnapshot.workspace.documents.map(async (source) => ({
        id: source.id,
        hasCache: Boolean(await readAutosavedWorkspaceSource(source.id)),
      })),
    )
      .then((cachedSources) => {
        if (!isStale) {
          setRecoveryCachedSourceIds(
            new Set(cachedSources.filter((source) => source.hasCache).map((source) => source.id)),
          );
        }
      })
      .catch((error) => {
        logDeveloperError('Unable to inspect autosaved source cache.', error);
      });

    return () => {
      isStale = true;
    };
  }, [recoverySnapshot]);

  useEffect(() => {
    if (!storageSettings.autosaveWorkspace || !workspace) {
      return;
    }

    writeAutosavedWorkspace(workspace);
    void writeAutosavedWorkspaceSources(workspace).catch((error) => {
      logDeveloperError('Unable to cache autosaved source PDFs.', error);
    });
  }, [storageSettings.autosaveWorkspace, workspace]);

  useEffect(() => {
    if (!workspaceToast) {
      return undefined;
    }

    const dismissDelay =
      workspaceToast.action === 'undo' ? toastActionDismissDelayMs : toastDismissDelayMs;
    const timeoutId = window.setTimeout(() => {
      setWorkspaceToast((currentToast) =>
        currentToast?.id === workspaceToast.id ? null : currentToast,
      );
    }, dismissDelay);

    return () => window.clearTimeout(timeoutId);
  }, [workspaceToast]);

  useEffect(() => {
    const appWindow = getCurrentWindow();

    void appWindow
      .isFullscreen()
      .then(setIsFullscreen)
      .catch(() => undefined);

    const unlistenPromise = appWindow.onResized(() => {
      void appWindow
        .isFullscreen()
        .then(setIsFullscreen)
        .catch(() => undefined);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    return registerWorkspaceShortcuts({
      canCopyAnnotation: () => canCopySelectedFreehandAnnotation,
      canDeletePages: () => Boolean(selectedAnnotationId || selectedVisiblePageIds.length),
      canExportPdf: () => canExportWorkspace(workspace) && !isExportingPdf,
      canNavigatePages: () => pageCount > 0,
      canPasteAnnotation: () => canPasteFreehandAnnotation,
      canRedo: () => canRedoWorkspaceHistory(workspaceHistory),
      canUndo: () => canUndoWorkspaceHistory(workspaceHistory),
      copyAnnotation: handleCopySelectedFreehandAnnotation,
      deleteSelectedPages: handleShortcutDelete,
      exportPdf: handleExportPdf,
      navigatePage: (direction) => selectPageByIndex(activePageIndex + direction),
      openPdf: handleOpenPdf,
      pasteAnnotation: handlePasteFreehandAnnotation,
      redo: redoLastWorkspaceEdit,
      undo: undoLastWorkspaceEdit,
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
    });
  }, [
    activePageIndex,
    canCopySelectedFreehandAnnotation,
    canPasteFreehandAnnotation,
    handleCopySelectedFreehandAnnotation,
    handleExportPdf,
    handleOpenPdf,
    handlePasteFreehandAnnotation,
    handleShortcutDelete,
    handleZoomIn,
    handleZoomOut,
    isExportingPdf,
    pageCount,
    redoLastWorkspaceEdit,
    selectPageByIndex,
    selectedAnnotationId,
    selectedVisiblePageIds,
    undoLastWorkspaceEdit,
    workspace,
    workspaceHistory,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isDisposed = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter') {
          setIsDraggingPdfs(event.payload.paths.some(isPdfPath));
          return;
        }

        if (event.payload.type === 'over') {
          return;
        }

        if (event.payload.type === 'drop') {
          void handleDroppedPdfPaths(event.payload.paths);
          return;
        }

        setIsDraggingPdfs(false);
      })
      .then((nextUnlisten) => {
        if (isDisposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        logDeveloperError('Unable to register PDF drag and drop.', error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [handleDroppedPdfPaths]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isDisposed = false;

    const drainPendingOpenPaths = () => {
      invoke<string[]>('drain_pending_open_paths')
        .then((paths) => {
          if (!isDisposed) {
            void handleOpenPdfPathsFromOs(paths);
          }
        })
        .catch((error) => {
          logDeveloperError('Unable to drain pending OS-opened PDFs.', error);
        });
    };

    drainPendingOpenPaths();

    listen<string[]>(openPdfsEventName, () => {
      drainPendingOpenPaths();
    })
      .then((nextUnlisten) => {
        if (isDisposed) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        logDeveloperError('Unable to listen for OS-opened PDFs.', error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [handleOpenPdfPathsFromOs]);

  useEffect(() => {
    const searchWorkspace = workspaceRef.current;

    if (!isFindOpen || !searchWorkspace || !trimmedFindQuery) {
      setFindResults([]);
      setFindActiveIndex(0);
      setIsFindingText(false);
      setFindError(null);
      return;
    }

    let isDisposed = false;
    const searchTimeout = window.setTimeout(() => {
      setIsFindingText(true);
      setFindError(null);

      searchWorkspaceText(searchWorkspace, trimmedFindQuery)
        .then((results) => {
          if (isDisposed) {
            return;
          }

          setFindResults(results);
          setFindActiveIndex(0);

          if (results[0]) {
            activatePage(results[0].pageId);
          }
        })
        .catch((error) => {
          if (isDisposed) {
            return;
          }

          logDeveloperError('PDF text search failed.', error);
          setFindResults([]);
          setFindActiveIndex(0);
          setFindError('Search failed.');
        })
        .finally(() => {
          if (!isDisposed) {
            setIsFindingText(false);
          }
        });
    }, 180);

    return () => {
      isDisposed = true;
      window.clearTimeout(searchTimeout);
    };
  }, [activatePage, findSearchKey, isFindOpen, trimmedFindQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openFindBar();
        return;
      }

      if (event.key === 'Escape' && workspace?.selectedPageIds.length) {
        event.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, openFindBar, workspace?.selectedPageIds.length]);

  return (
    <div className="app-shell" data-theme={appTheme}>
      <TopToolbar
        canExportPdf={canExportPdf}
        canRedo={canRedoWorkspaceEdit}
        canUndo={canUndoWorkspaceEdit}
        canUseWorkspaceControls={pageCount > 0}
        isAddingPdfs={isAddingPdfs}
        isExportingPdf={isExportingPdf}
        isFullscreen={isFullscreen}
        isOpeningPdf={isOpeningPdf}
        onAbout={() => setIsAboutOpen(true)}
        onExportPdf={handleExportPdf}
        onHelp={() => setIsShortcutHelpOpen(true)}
        onRedo={redoLastWorkspaceEdit}
        onSettings={() => setIsSettingsOpen(true)}
        onToggleFullscreen={handleToggleFullscreen}
        onUndo={undoLastWorkspaceEdit}
        onZoomPercentChange={handleZoomPercentChange}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        workspace={workspace}
        zoomPercent={zoomPercent}
      />
      <WorkspaceTabs
        activeWorkspaceId={activeWorkspaceId}
        isBusy={isLoadingPdf || isExportingPdf}
        onChangeWorkspaceColor={handleChangeWorkspaceTabColor}
        onChangeWorkspaceFont={handleChangeWorkspaceTabFont}
        onCloseWorkspace={handleCloseWorkspaceTab}
        onOpenPdf={handleOpenPdf}
        onRenameWorkspace={handleRenameWorkspaceTab}
        onSelectWorkspace={handleSelectWorkspaceTab}
        tabs={workspaceTabSummaries}
      />
      {isDraggingPdfs ? (
        <div className="drop-overlay" role="status">
          <div>
            <strong>{workspace ? 'Choose where to open PDFs' : 'Open PDFs'}</strong>
            <span>
              {workspace
                ? 'Drop to add them to an open workspace or start a new one.'
                : 'Drop to open them in a new workspace.'}
            </span>
          </div>
        </div>
      ) : null}
      <ViewerToolbar
        activePageNumber={activePageNumber}
        canGoNext={activePageIndex >= 0 && activePageIndex < pageCount - 1}
        canGoPrevious={activePageIndex > 0}
        canRotateSelection={selectedVisiblePageIds.length > 0}
        findActiveIndex={findActiveIndex}
        findQuery={findQuery}
        findResultCount={findResults.length}
        findStatus={findStatus}
        hasSignatureImage={Boolean(signatureImage)}
        isAnnotating={isAnnotating}
        isFindOpen={isFindOpen}
        isHandToolActive={isHandToolActive}
        isActivePageBookmarked={isActivePageBookmarked}
        isPageOverviewOpen={isPageOverviewOpen}
        onChangeFindQuery={setFindQuery}
        onCloseFind={closeFindBar}
        onFindNext={goToNextFindResult}
        onFindPrevious={goToPreviousFindResult}
        onGoNext={handleGoNext}
        onGoPrevious={handleGoPrevious}
        onPageNumberChange={handlePageNumberChange}
        onRotateLeft={handleRotateSelectedPagesLeft}
        onRotateRight={handleRotateSelectedPagesRight}
        onSelectAnnotationTool={handleSelectAnnotationTool}
        onToggleAnnotating={handleToggleAnnotating}
        onToggleActivePageBookmark={handleToggleActivePageBookmark}
        onToggleHandTool={handleToggleHandTool}
        onTogglePageOverview={handleTogglePageOverview}
        pageCount={pageCount}
        selectedAnnotationTool={selectedAnnotationTool}
        workspace={workspace}
      />

      <main
        className="workspace-grid"
        aria-label="Paperdesk workspace"
        data-sidebar-collapsed={isThumbnailSidebarCollapsed ? 'true' : undefined}
        data-tools-collapsed={isToolsPanelCollapsed ? 'true' : undefined}
      >
        {isThumbnailSidebarCollapsed ? (
          <CollapsedThumbnailSidebar onToggleCollapsed={handleToggleThumbnailSidebar} />
        ) : (
          <ThumbnailSidebar
            onActivatePage={activatePage}
            onClearSelection={clearSelection}
            onDeletePages={deletePageSelection}
            onMovePage={handleMovePage}
            onReorderPages={handleReorderPages}
            onRotatePages={rotatePageSelection}
            onSelectAllPages={selectAllVisiblePages}
            onSelectPage={selectPage}
            onSetSelectedPages={selectPages}
            onThumbnailRendered={handleThumbnailRendered}
            onToggleCollapsed={handleToggleThumbnailSidebar}
            onTogglePageBookmark={handleTogglePageBookmark}
            onTogglePageSelection={togglePageSelection}
            selectedPageIds={selectedVisiblePageIds}
            workspace={workspace}
          />
        )}
        {isPageOverviewOpen && workspace ? (
          <PageOverview
            onActivatePage={activatePage}
            onClose={closePageOverview}
            onThumbnailRendered={handleThumbnailRendered}
            onTogglePageBookmark={handleTogglePageBookmark}
            workspace={workspace}
          />
        ) : (
          <DocumentViewer
            activeAnnotationTool={selectedAnnotationTool}
            annotationBorderColor={annotationBorderColor}
            annotationColor={annotationColor}
            annotationFillColor={annotationFillColor}
            annotationStrokeWidth={annotationStrokeWidth}
            canGoNext={activePageIndex >= 0 && activePageIndex < pageCount - 1}
            canGoPrevious={activePageIndex > 0}
            isHandToolActive={isHandToolActive}
            isAnnotating={isAnnotating}
            isLoading={isLoadingPdf}
            loadingMessage={loadingMessage}
            eraserSize={eraserSize}
            freehandSensitivity={freehandSensitivity}
            highlightBrushSize={highlightBrushSize}
            highlightOpacity={highlightOpacity}
            onChangeFormFieldValue={handleChangeFormFieldValue}
            onCommitAnnotationChange={handleCommitAnnotationChange}
            onCreateAnnotation={handleCreateAnnotation}
            onEraseAnnotationPixels={handleEraseAnnotationPixels}
            onNavigatePage={(direction) => selectPageByIndex(activePageIndex + direction)}
            onSelectAnnotation={setSelectedAnnotationId}
            onUpdateAnnotationPasteTarget={handleUpdateAnnotationPasteTarget}
            onUpdateAnnotation={handleUpdateAnnotation}
            onWheelZoom={handleWheelZoom}
            onZoomByFactor={handleZoomByFactor}
            selectedAnnotationId={selectedAnnotationId}
            spacebarFreehandEnabled={isSpacebarFreehandEnabled}
            signatureImage={signatureImage}
            textSearchActiveResult={findResults[findActiveIndex] ?? null}
            textSearchQuery={isFindOpen ? findQuery : ''}
            workspace={workspace}
          />
        )}
        <ToolsPanel
          activePanel={activeToolPanel}
          annotationBorderColor={annotationBorderColor}
          annotationColor={annotationColor}
          annotationFillColor={annotationFillColor}
          annotationStrokeWidth={annotationStrokeWidth}
          canCopySelectedFreehandAnnotation={canCopySelectedFreehandAnnotation}
          canPasteFreehandAnnotation={canPasteFreehandAnnotation}
          eraserSize={eraserSize}
          freehandSensitivity={freehandSensitivity}
          highlightBrushSize={highlightBrushSize}
          highlightOpacity={highlightOpacity}
          isCollapsed={isToolsPanelCollapsed}
          isAddingPdfs={isAddingPdfs}
          isPdfSecurityBusy={isExportingPdf}
          onAddPdfs={handleAddPdfs}
          onChangeEraserSize={handleChangeEraserSize}
          onChangeFreehandSensitivity={handleChangeFreehandSensitivity}
          onChangeHighlightBrushSize={handleChangeHighlightBrushSize}
          onChangeHighlightOpacity={handleChangeHighlightOpacity}
          onChangeFormatterSettings={handleChangeFormatterSettings}
          onChangeFormFieldValue={handleChangeFormFieldValue}
          onChangeFormSettings={handleChangeFormSettings}
          onChangeAnnotationColor={handleChangeAnnotationColor}
          onChangeAnnotationBorderColor={handleChangeAnnotationBorderColor}
          onChangeAnnotationFillColor={handleChangeAnnotationFillColor}
          onChangeAnnotationStrokeWidth={handleChangeAnnotationStrokeWidth}
          onChangeSelectedAnnotationBorderColor={handleChangeSelectedAnnotationBorderColor}
          onChangeSelectedAnnotationColor={handleChangeSelectedAnnotationColor}
          onChangeSelectedAnnotationFillColor={handleChangeSelectedAnnotationFillColor}
          onChangeSelectedAnnotationFont={handleChangeSelectedAnnotationFont}
          onChangeSelectedAnnotationStrokeWidth={handleChangeSelectedAnnotationStrokeWidth}
          onChangeSelectedAnnotationHighlightBrushSize={
            handleChangeSelectedAnnotationHighlightBrushSize
          }
          onChangeSelectedAnnotationOpacity={handleChangeSelectedAnnotationOpacity}
          onCopySelectedFreehandAnnotation={handleCopySelectedFreehandAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onInsertBlankPage={handleInsertBlankPage}
          onInsertCoverPage={handleInsertCoverPage}
          onLockPdf={handleLockPdf}
          onImportFormData={handleImportFormData}
          onOpenRecentFile={handleOpenRecentFile}
          onPasteFreehandAnnotation={handlePasteFreehandAnnotation}
          onSetSignatureImage={setSignatureImage}
          onSaveUnlockedPdf={handleSaveUnlockedPdf}
          onToggleCollapsed={() => setIsToolsPanelCollapsed((currentValue) => !currentValue)}
          recentFiles={recentFiles}
          selectedAnnotationId={selectedAnnotationId}
          selectedAnnotationTool={selectedAnnotationTool}
          setActivePanel={setActiveToolPanel}
          signatureImage={signatureImage}
          workspace={workspace}
        />
      </main>

      <footer className="status-bar" aria-label="Document status">
        <span>
          Page {activePageNumber || 0} of {pageCount}
        </span>
        <div className="status-zoom-control">
          <button
            aria-expanded={isStatusZoomOpen}
            aria-haspopup="dialog"
            className="status-zoom-button"
            disabled={!workspace || pageCount === 0}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setIsStatusZoomOpen(false);
              }
            }}
            onClick={() => setIsStatusZoomOpen((isOpen) => !isOpen)}
            type="button"
          >
            {zoomPercent}%
          </button>
          {isStatusZoomOpen && workspace && pageCount > 0 ? (
            <div className="status-zoom-popover" role="dialog" aria-label="Zoom slider">
              <label>
                <span>Zoom</span>
                <strong>{zoomPercent}%</strong>
              </label>
              <input
                aria-label="Zoom percentage"
                max={maxZoom * 100}
                min={minZoom * 100}
                onChange={(event) => handleZoomPercentChange(event.target.valueAsNumber)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setIsStatusZoomOpen(false);
                  }
                }}
                step={5}
                type="range"
                value={zoomPercent}
              />
            </div>
          ) : null}
        </div>
        <span title={activeSourceFileName}>{activeSourceFileName}</span>
        <span data-unsaved={hasUnsavedChanges ? 'true' : undefined}>
          {hasUnsavedChanges ? 'Edited' : 'Saved locally'}
        </span>
      </footer>

      {exportModalMode ? (
        <ExportPagesModal
          isExporting={isExportingPdf}
          mode={exportModalMode}
          onClose={() => setExportModalMode(null)}
          onExportSelectedPages={handleExportSelectedPages}
          onSplitRanges={handleSplitPageRanges}
          pageCount={pageCount}
          selectedPageCount={selectedVisiblePageIds.length}
        />
      ) : null}

      {pendingPdfPasswordRequest ? (
        <PdfPasswordDialog
          key={pendingPdfPasswordRequest.id}
          onCancel={() => resolvePendingPdfPassword(null)}
          onSubmit={resolvePendingPdfPassword}
          request={pendingPdfPasswordRequest}
        />
      ) : null}

      {isProtectedExportChoiceOpen ? (
        <ProtectedPdfExportDialog
          onCancel={() => resolveProtectedExportChoice(null)}
          onChoose={resolveProtectedExportChoice}
        />
      ) : null}

      {pendingPdfImportRequest ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="pdf-import-route-title"
            aria-modal="true"
            className="app-dialog pdf-import-dialog"
            role="dialog"
          >
            <header className="modal-header">
              <div>
                <h2 id="pdf-import-route-title">
                  {getImportPromptTitle(pendingPdfImportRequest.source)}
                </h2>
                <p>{getImportPromptDescription(pendingPdfImportRequest.source)}</p>
              </div>
              <button
                aria-label="Close"
                className="modal-close-button"
                onClick={() => resolvePendingPdfImportTarget(null)}
                title="Close"
                type="button"
              >
                <X size={14} />
              </button>
            </header>

            <div className="pdf-import-file-list" aria-label="PDFs to open">
              {pendingPdfImportRequest.fileNames.slice(0, 4).map((fileName, index) => (
                <span key={`${pendingPdfImportRequest.id}-${fileName}-${index}`}>{fileName}</span>
              ))}
              {pendingPdfImportRequest.fileNames.length > 4 ? (
                <span>+{pendingPdfImportRequest.fileNames.length - 4} more</span>
              ) : null}
            </div>

            {workspaceTabSummaries.length ? (
              <div className="pdf-import-target-list" role="list" aria-label="Open workspaces">
                {workspaceTabSummaries.map((tab) => {
                  const isSuggested = tab.id === pendingPdfImportRequest.suggestedWorkspaceId;
                  const pageLabel = tab.pageCount === 1 ? 'page' : 'pages';
                  const documentLabel = tab.documentCount === 1 ? 'PDF' : 'PDFs';

                  return (
                    <button
                      className="pdf-import-target-button"
                      data-suggested={isSuggested ? 'true' : undefined}
                      key={tab.id}
                      onClick={() =>
                        resolvePendingPdfImportTarget({ kind: 'workspace', workspaceId: tab.id })
                      }
                      type="button"
                    >
                      <span>
                        <strong>{isSuggested ? 'Current workspace' : tab.name}</strong>
                        {isSuggested ? <small>{tab.name}</small> : null}
                      </span>
                      <small>
                        {tab.pageCount} {pageLabel} / {tab.documentCount} {documentLabel}
                      </small>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="modal-actions">
              <button
                className="cancel-action-button"
                onClick={() => resolvePendingPdfImportTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => resolvePendingPdfImportTarget({ kind: 'new' })}
                type="button"
              >
                New workspace
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isShortcutHelpOpen ? (
        <FeatureGuideDialog onClose={() => setIsShortcutHelpOpen(false)} />
      ) : null}

      {isAboutOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <header className="modal-header">
              <h2 id="about-title">About Paperdesk</h2>
              <button
                aria-label="Close"
                className="modal-close-button"
                onClick={() => setIsAboutOpen(false)}
                title="Close"
                type="button"
              >
                <X size={14} />
              </button>
            </header>
            <div className="dialog-copy">
              <p>Paperdesk is an offline desktop PDF reader and editor for page-level workflows.</p>
              <p>
                PDF rendering, merging, annotation, form edits, and export all run locally on this
                device.
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header className="modal-header">
              <h2 id="settings-title">Settings</h2>
              <button
                aria-label="Close"
                className="modal-close-button"
                onClick={() => setIsSettingsOpen(false)}
                title="Close"
                type="button"
              >
                <X size={14} />
              </button>
            </header>
            <div className="settings-dialog-body">
              <label className="settings-toggle-row">
                <span>
                  <strong>Remember recent files</strong>
                  <small>Store local file paths for quick reopening.</small>
                </span>
                <input
                  checked={storageSettings.rememberRecentFiles}
                  onChange={(event) =>
                    handleChangeStorageSettings({ rememberRecentFiles: event.target.checked })
                  }
                  type="checkbox"
                />
              </label>
              <label className="settings-toggle-row">
                <span>
                  <strong>Autosave workspace</strong>
                  <small>Store workspace metadata and source PDFs locally for recovery.</small>
                </span>
                <input
                  checked={storageSettings.autosaveWorkspace}
                  onChange={(event) =>
                    handleChangeStorageSettings({ autosaveWorkspace: event.target.checked })
                  }
                  type="checkbox"
                />
              </label>
              <label className="settings-toggle-row">
                <span>
                  <strong>Spacebar freehand annotation</strong>
                  <small>
                    With the pen selected, hold Space and move the cursor to draw without clicking.
                  </small>
                </span>
                <input
                  checked={storageSettings.spacebarFreehandAnnotation}
                  onChange={(event) =>
                    handleChangeStorageSettings({
                      spacebarFreehandAnnotation: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
              </label>
              <label className="formatter-field">
                <span>Appearance</span>
                <select
                  onChange={(event) => handleChangeAppTheme(event.target.value as AppTheme)}
                  value={appTheme}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <button
                className="secondary-action-button danger-action-button"
                onClick={handleClearLocalData}
                type="button"
              >
                Clear local data
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {recoverySnapshot && !workspace ? (
        <div className="recovery-overlay" role="presentation">
          <section
            aria-labelledby="recovery-title"
            aria-modal="true"
            className="recovery-dialog"
            role="dialog"
          >
            <div className="recovery-dialog-heading">
              <span className="document-kicker">Autosave recovery</span>
              <h2 id="recovery-title">Recover previous workspace?</h2>
              <p>{recoverySnapshot.workspace.name}</p>
              <p>Last edited {formatRecoveryDate(recoverySnapshot.savedAt)}</p>
            </div>

            <div className="recovery-source-list" aria-label="Source files required">
              <h3>Source files required</h3>
              {recoverySnapshot.workspace.documents.map((source) => {
                const isRelinked = Boolean(recoveryRelinkedDocuments[source.id]);
                const isCached = recoveryCachedSourceIds.has(source.id);
                const isMissing =
                  !isRelinked &&
                  !isCached &&
                  (recoveryMissingSourceIds.has(source.id) || !source.filePath);
                const status = isRelinked
                  ? 'Relinked'
                  : isCached
                    ? 'Cached'
                    : isMissing
                      ? 'Permission needed'
                      : 'Ready';

                return (
                  <div className="recovery-source-row" key={source.id}>
                    <div>
                      <strong>{source.fileName}</strong>
                      <span title={source.filePath}>{source.filePath ?? 'No saved path'}</span>
                    </div>
                    <div className="recovery-source-actions">
                      <span data-status={isMissing ? 'missing' : 'ready'}>{status}</span>
                      {isMissing ? (
                        <button
                          disabled={isRecoveringWorkspace}
                          onClick={() => handleRelinkRecoverySource(source.id)}
                          type="button"
                        >
                          Relink
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="recovery-actions">
              <button
                className="secondary-action-button cancel-action-button"
                disabled={isRecoveringWorkspace}
                onClick={handleDismissRecovery}
                type="button"
              >
                Discard
              </button>
              <button
                className="secondary-action-button primary-recovery-action"
                disabled={isRecoveringWorkspace}
                onClick={handleRecoverWorkspace}
                type="button"
              >
                {isRecoveringWorkspace ? 'Recovering...' : 'Recover workspace'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {workspaceToast ? (
        <div className="toast-region" role="status" aria-live="polite">
          <div
            className="app-toast"
            data-auto-dismiss="true"
            data-tone={workspaceToast.tone}
            key={workspaceToast.id}
            style={
              {
                '--toast-dismiss-duration': `${
                  workspaceToast.action === 'undo' ? toastActionDismissDelayMs : toastDismissDelayMs
                }ms`,
              } as CSSProperties
            }
          >
            <span>{workspaceToast.message}</span>
            {workspaceToast.action === 'undo' ? (
              <button onClick={undoLastWorkspaceEdit} type="button">
                Undo
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
