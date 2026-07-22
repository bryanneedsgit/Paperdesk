import { createId } from '../utils/ids';
import { mergeImportedFormData, type PdfFormDataJson } from './pdfForms';
import type {
  FormatterSettings,
  GeneratedPageItem,
  PdfAnnotation,
  PdfAnnotationId,
  PdfDocumentId,
  PdfDocumentSource,
  PdfFormFieldValue,
  PdfFormSettings,
  PdfFormatterSettings,
  PdfPageId,
  PdfPageItem,
  PdfRotation,
  PdfRotationDirection,
  PdfWorkspace,
} from './types';

export const generatedPageSizes = {
  a4Portrait: { width: 595.28, height: 841.89 },
  letterPortrait: { width: 612, height: 792 },
};

export function createDefaultFormatterSettings(): PdfFormatterSettings {
  return {
    zoom: 1,
    fitMode: 'page',
    applyScope: 'all',
    coverDate: new Date().toLocaleDateString(),
    coverSubtitle: '',
    coverTitle: 'Cover Page',
    cropMargins: {
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    },
    footerText: '',
    fontFamily: 'helvetica',
    headerText: '',
    pageNumberPosition: 'bottom-center',
    pageNumbersEnabled: false,
    resizePageSize: 'keep-original',
    startNumber: 1,
    watermarkOpacity: 0.18,
    watermarkText: '',
  };
}

export function createDefaultFormSettings(): PdfFormSettings {
  return {
    flattenOnExport: false,
  };
}

export function isGeneratedPageItem(page: PdfPageItem): page is GeneratedPageItem {
  return page.kind === 'generated';
}

export function isSourcePageItem(page: PdfPageItem): page is PdfPageItem & {
  sourceDocumentId: PdfDocumentId;
  sourceFileName: string;
  sourcePageIndex: number;
} {
  return page.kind !== 'generated';
}

function getVisiblePages(pages: PdfPageItem[]): PdfPageItem[] {
  return pages.filter((page) => !page.deleted);
}

function createWorkspaceName(documents: PdfDocumentSource[]): string {
  if (documents.length === 1) {
    return documents[0].fileName;
  }

  return 'Merged document';
}

function reindexPages(pages: PdfPageItem[]): PdfPageItem[] {
  let displayIndex = 1;

  return pages.map((page) => {
    if (page.deleted) {
      return page;
    }

    const nextPage = {
      ...page,
      displayIndex,
    };

    displayIndex += 1;
    return nextPage;
  });
}

function normalizeRotation(rotation: number): PdfRotation {
  const normalized = ((rotation % 360) + 360) % 360;

  return normalized as PdfRotation;
}

function getNearestPageAfterDeletion(
  visiblePagesBeforeDelete: PdfPageItem[],
  visiblePagesAfterDelete: PdfPageItem[],
  deletedPageIds: Set<PdfPageId>,
  preferredPageId?: PdfPageId,
): PdfPageItem | undefined {
  if (preferredPageId && !deletedPageIds.has(preferredPageId)) {
    return visiblePagesAfterDelete.find((page) => page.id === preferredPageId);
  }

  const firstDeletedIndex = visiblePagesBeforeDelete.findIndex((page) =>
    deletedPageIds.has(page.id),
  );

  if (firstDeletedIndex < 0) {
    return visiblePagesAfterDelete[0];
  }

  return (
    visiblePagesAfterDelete[Math.min(firstDeletedIndex, visiblePagesAfterDelete.length - 1)] ??
    visiblePagesAfterDelete[firstDeletedIndex - 1]
  );
}

function getVisiblePageIds(workspace: PdfWorkspace): Set<PdfPageId> {
  return new Set(getVisiblePages(workspace.pages).map((page) => page.id));
}

function hasSamePageOrder(firstPages: PdfPageItem[], secondPages: PdfPageItem[]): boolean {
  if (firstPages.length !== secondPages.length) {
    return false;
  }

  return firstPages.every((page, pageIndex) => page.id === secondPages[pageIndex]?.id);
}

function getRotationDelta(direction: PdfRotationDirection | 90 | -90): 90 | -90 {
  return direction === 'clockwise' || direction === 90 ? 90 : -90;
}

function getSelectionForPages(
  selectedPageIds: PdfPageId[],
  pages: PdfPageItem[],
  fallbackActivePageId?: PdfPageId,
): PdfPageId[] {
  const visiblePageIds = new Set(getVisiblePages(pages).map((page) => page.id));
  const nextSelectedPageIds = selectedPageIds.filter((pageId) => visiblePageIds.has(pageId));

  if (nextSelectedPageIds.length) {
    return nextSelectedPageIds;
  }

  return fallbackActivePageId && visiblePageIds.has(fallbackActivePageId)
    ? [fallbackActivePageId]
    : [];
}

function annotationsAreEquivalent(first: PdfAnnotation, second: PdfAnnotation): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function createEmptyWorkspace(name = 'Untitled workspace'): PdfWorkspace {
  return {
    id: createId('workspace'),
    name,
    documents: [],
    pages: [],
    selectedPageIds: [],
    formatterSettings: createDefaultFormatterSettings(),
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    annotations: [],
  };
}

export function createPageItemsForDocument(
  document: PdfDocumentSource,
  displayIndexOffset = 0,
): PdfPageItem[] {
  return Array.from({ length: document.pageCount }, (_, pageIndex) => ({
    id: createId('page'),
    sourceDocumentId: document.id,
    sourceFileName: document.fileName,
    sourcePageIndex: pageIndex,
    displayIndex: displayIndexOffset + pageIndex + 1,
    rotation: 0,
    deleted: false,
  }));
}

function createGeneratedPageItem(
  generatedPageType: GeneratedPageItem['generatedPageType'],
  displayIndex: number,
  values: Partial<GeneratedPageItem> = {},
): GeneratedPageItem {
  return {
    id: createId('page'),
    kind: 'generated',
    generatedPageType,
    displayIndex,
    rotation: 0,
    deleted: false,
    width: generatedPageSizes.a4Portrait.width,
    height: generatedPageSizes.a4Portrait.height,
    ...values,
  };
}

export function createPageItemsForDocuments(documents: PdfDocumentSource[]): PdfPageItem[] {
  const pages: PdfPageItem[] = [];

  for (const document of documents) {
    pages.push(...createPageItemsForDocument(document, pages.length));
  }

  return pages;
}

export function createWorkspaceFromDocument(document: PdfDocumentSource): PdfWorkspace {
  return createWorkspaceFromDocuments([document]);
}

export function createWorkspaceFromDocuments(documents: PdfDocumentSource[]): PdfWorkspace {
  const pages = createPageItemsForDocuments(documents);
  const activePageId = pages[0]?.id;

  return {
    id: createId('workspace'),
    name: createWorkspaceName(documents),
    documents,
    pages,
    selectedPageIds: activePageId ? [activePageId] : [],
    activePageId,
    formatterSettings: createDefaultFormatterSettings(),
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    annotations: [],
  };
}

export function appendDocumentsToWorkspace(
  workspace: PdfWorkspace,
  documents: PdfDocumentSource[],
): PdfWorkspace {
  if (documents.length === 0) {
    return workspace;
  }

  const currentVisiblePageCount = getVisiblePages(workspace.pages).length;
  const appendedPages = documents.flatMap((document, documentIndex) => {
    const previousAppendedPageCount = documents
      .slice(0, documentIndex)
      .reduce((count, sourceDocument) => count + sourceDocument.pageCount, 0);

    return createPageItemsForDocument(
      document,
      currentVisiblePageCount + previousAppendedPageCount,
    );
  });
  const nextPages = reindexPages([...workspace.pages, ...appendedPages]);
  const activePageId = workspace.activePageId ?? appendedPages[0]?.id;

  return {
    ...workspace,
    name: createWorkspaceName([...workspace.documents, ...documents]),
    documents: [...workspace.documents, ...documents],
    pages: nextPages,
    selectedPageIds: activePageId ? [activePageId] : [],
    activePageId,
  };
}

export function updateWorkspaceFormatterSettings(
  workspace: PdfWorkspace,
  settings: Partial<FormatterSettings>,
): PdfWorkspace {
  return {
    ...workspace,
    formatterSettings: {
      ...workspace.formatterSettings,
      ...settings,
      cropMargins: settings.cropMargins
        ? {
            ...workspace.formatterSettings.cropMargins,
            ...settings.cropMargins,
          }
        : workspace.formatterSettings.cropMargins,
    },
  };
}

export function updateWorkspaceFormSettings(
  workspace: PdfWorkspace,
  settings: Partial<PdfFormSettings>,
): PdfWorkspace {
  return {
    ...workspace,
    formSettings: {
      ...workspace.formSettings,
      ...settings,
    },
  };
}

export function updateWorkspaceFormFieldValue({
  fieldName,
  sourceDocumentId,
  value,
  workspace,
}: {
  fieldName: string;
  sourceDocumentId: PdfDocumentId;
  value: PdfFormFieldValue;
  workspace: PdfWorkspace;
}): PdfWorkspace {
  return {
    ...workspace,
    formFieldValues: {
      ...workspace.formFieldValues,
      [sourceDocumentId]: {
        ...(workspace.formFieldValues[sourceDocumentId] ?? {}),
        [fieldName]: value,
      },
    },
  };
}

export function importWorkspaceFormData(
  workspace: PdfWorkspace,
  formData: PdfFormDataJson,
): PdfWorkspace {
  return {
    ...workspace,
    formFieldValues: mergeImportedFormData(workspace, formData),
  };
}

export function getIncludedPageCountByDocument(
  workspace: PdfWorkspace,
): Map<PdfDocumentId, number> {
  const countsByDocument = new Map<PdfDocumentId, number>();

  for (const page of workspace.pages) {
    if (page.deleted || !isSourcePageItem(page)) {
      continue;
    }

    countsByDocument.set(
      page.sourceDocumentId,
      (countsByDocument.get(page.sourceDocumentId) ?? 0) + 1,
    );
  }

  return countsByDocument;
}

export function insertBlankPage(workspace: PdfWorkspace): PdfWorkspace {
  const visiblePages = getVisiblePages(workspace.pages);
  const generatedPage = createGeneratedPageItem('blank', visiblePages.length + 1);
  const pages = reindexPages([...workspace.pages, generatedPage]);

  return {
    ...workspace,
    pages,
    activePageId: generatedPage.id,
    selectedPageIds: [generatedPage.id],
  };
}

export function insertCoverPage(workspace: PdfWorkspace): PdfWorkspace {
  const generatedPage = createGeneratedPageItem('cover', 1, {
    coverDate: workspace.formatterSettings.coverDate,
    coverSubtitle: workspace.formatterSettings.coverSubtitle,
    coverTitle: workspace.formatterSettings.coverTitle,
  });
  const pages = reindexPages([generatedPage, ...workspace.pages]);

  return {
    ...workspace,
    pages,
    activePageId: generatedPage.id,
    selectedPageIds: [generatedPage.id],
  };
}

export function getWorkspacePageSummary(workspace: PdfWorkspace): {
  documentCount: number;
  pageCount: number;
} {
  return {
    documentCount: workspace.documents.length,
    pageCount: getVisiblePages(workspace.pages).length,
  };
}

export function canExportWorkspace(workspace: PdfWorkspace | null): boolean {
  return Boolean(workspace && getVisiblePages(workspace.pages).length > 0);
}

export function recalculateDisplayIndexes(workspace: PdfWorkspace): PdfWorkspace {
  return {
    ...workspace,
    pages: reindexPages(workspace.pages),
  };
}

export function updateActivePage(workspace: PdfWorkspace, pageId: PdfPageId): PdfWorkspace {
  if (!workspace.pages.some((page) => page.id === pageId && !page.deleted)) {
    return workspace;
  }

  return {
    ...workspace,
    activePageId: pageId,
    selectedPageIds: [pageId],
  };
}

export function updateSelectedPages(
  workspace: PdfWorkspace,
  selectedPageIds: PdfPageId[],
): PdfWorkspace {
  const visiblePageIds = getVisiblePageIds(workspace);
  const nextSelectedPageIds = Array.from(new Set(selectedPageIds)).filter((pageId) =>
    visiblePageIds.has(pageId),
  );
  const activePageId =
    nextSelectedPageIds.find((pageId) => pageId === workspace.activePageId) ??
    nextSelectedPageIds[0] ??
    workspace.activePageId;

  return {
    ...workspace,
    activePageId,
    selectedPageIds: nextSelectedPageIds,
  };
}

export function clearPageSelection(workspace: PdfWorkspace): PdfWorkspace {
  return {
    ...workspace,
    selectedPageIds: [],
  };
}

export function selectAllPages(workspace: PdfWorkspace): PdfWorkspace {
  const selectedPageIds = getVisiblePages(workspace.pages).map((page) => page.id);

  return {
    ...workspace,
    selectedPageIds,
    activePageId: workspace.activePageId ?? selectedPageIds[0],
  };
}

export function deletePages(workspace: PdfWorkspace, pageIds: PdfPageId[]): PdfWorkspace {
  const visiblePagesBeforeDelete = getVisiblePages(workspace.pages);
  const visiblePageIds = new Set(visiblePagesBeforeDelete.map((page) => page.id));
  const pageIdsToDelete = Array.from(new Set(pageIds)).filter((pageId) =>
    visiblePageIds.has(pageId),
  );

  if (pageIdsToDelete.length === 0) {
    return workspace;
  }

  const deletedPageIds = new Set(pageIdsToDelete);
  const pages = reindexPages(
    workspace.pages.map((page) =>
      deletedPageIds.has(page.id)
        ? {
            ...page,
            deleted: true,
          }
        : page,
    ),
  );
  const visiblePagesAfterDelete = getVisiblePages(pages);
  const nextActivePage = getNearestPageAfterDeletion(
    visiblePagesBeforeDelete,
    visiblePagesAfterDelete,
    deletedPageIds,
    workspace.activePageId,
  );

  return {
    ...workspace,
    pages,
    activePageId: nextActivePage?.id,
    selectedPageIds: nextActivePage ? [nextActivePage.id] : [],
  };
}

export function deletePageFromWorkspace(workspace: PdfWorkspace, pageId: PdfPageId): PdfWorkspace {
  return deletePages(workspace, [pageId]);
}

export function moveSelectedPages(
  workspace: PdfWorkspace,
  pageIds: PdfPageId[],
  overPageId: PdfPageId,
): PdfWorkspace {
  const visiblePages = getVisiblePages(workspace.pages);
  const visiblePageIds = new Set(visiblePages.map((page) => page.id));
  const movingPageIds = Array.from(new Set(pageIds)).filter((pageId) => visiblePageIds.has(pageId));

  if (
    movingPageIds.length === 0 ||
    !visiblePageIds.has(overPageId) ||
    movingPageIds.includes(overPageId)
  ) {
    return workspace;
  }

  const movingPageIdSet = new Set(movingPageIds);
  const firstMovingIndex = visiblePages.findIndex((page) => movingPageIdSet.has(page.id));
  const overIndex = visiblePages.findIndex((page) => page.id === overPageId);
  const movingPages = visiblePages.filter((page) => movingPageIdSet.has(page.id));
  const stationaryPages = visiblePages.filter((page) => !movingPageIdSet.has(page.id));
  const overIndexInStationaryPages = stationaryPages.findIndex((page) => page.id === overPageId);

  if (firstMovingIndex < 0 || overIndex < 0 || overIndexInStationaryPages < 0) {
    return workspace;
  }

  const insertIndex =
    firstMovingIndex < overIndex ? overIndexInStationaryPages + 1 : overIndexInStationaryPages;
  const reorderedVisiblePages = [...stationaryPages];
  reorderedVisiblePages.splice(insertIndex, 0, ...movingPages);

  if (hasSamePageOrder(visiblePages, reorderedVisiblePages)) {
    return workspace;
  }

  const deletedPages = workspace.pages.filter((page) => page.deleted);
  const pages = reindexPages([...reorderedVisiblePages, ...deletedPages]);
  const nextVisiblePageIds = new Set(getVisiblePages(pages).map((page) => page.id));
  const selectedPageIds = workspace.selectedPageIds.filter((pageId) =>
    nextVisiblePageIds.has(pageId),
  );
  const activePageId =
    workspace.activePageId && nextVisiblePageIds.has(workspace.activePageId)
      ? workspace.activePageId
      : getVisiblePages(pages)[0]?.id;

  return {
    ...workspace,
    pages,
    activePageId,
    selectedPageIds,
  };
}

export function movePage(
  workspace: PdfWorkspace,
  pageId: PdfPageId,
  overPageId: PdfPageId,
): PdfWorkspace {
  return moveSelectedPages(workspace, [pageId], overPageId);
}

export function movePageInWorkspace(
  workspace: PdfWorkspace,
  pageId: PdfPageId,
  direction: -1 | 1,
): PdfWorkspace {
  const visiblePages = getVisiblePages(workspace.pages);
  const currentIndex = visiblePages.findIndex((page) => page.id === pageId);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= visiblePages.length) {
    return workspace;
  }

  return movePage(workspace, pageId, visiblePages[nextIndex].id);
}

export function rotatePages(
  workspace: PdfWorkspace,
  pageIds: PdfPageId[],
  direction: PdfRotationDirection | 90 | -90,
): PdfWorkspace {
  const visiblePageIds = getVisiblePageIds(workspace);
  const pageIdsToRotate = Array.from(new Set(pageIds)).filter((pageId) =>
    visiblePageIds.has(pageId),
  );

  if (pageIdsToRotate.length === 0) {
    return workspace;
  }

  const rotationDelta = getRotationDelta(direction);
  const pageIdSet = new Set(pageIdsToRotate);
  const pages = workspace.pages.map((page) => {
    if (!pageIdSet.has(page.id) || page.deleted) {
      return page;
    }

    return {
      ...page,
      height: undefined,
      rotation: normalizeRotation(page.rotation + rotationDelta),
      thumbnailDataUrl: undefined,
      width: undefined,
    };
  });
  const visiblePageIdsAfterRotation = new Set(getVisiblePages(pages).map((page) => page.id));
  const activePageId =
    workspace.activePageId && visiblePageIdsAfterRotation.has(workspace.activePageId)
      ? workspace.activePageId
      : getVisiblePages(pages)[0]?.id;

  return {
    ...workspace,
    pages,
    activePageId,
    selectedPageIds: getSelectionForPages(workspace.selectedPageIds, pages, activePageId),
  };
}

export function rotatePageInWorkspace(
  workspace: PdfWorkspace,
  pageId: PdfPageId,
  delta: 90 | -90,
): PdfWorkspace {
  return rotatePages(workspace, [pageId], delta);
}

export function createAnnotation(
  workspace: PdfWorkspace,
  annotation: Omit<PdfAnnotation, 'createdAt' | 'id'> & { id?: PdfAnnotationId },
): PdfWorkspace {
  const nextAnnotation: PdfAnnotation = {
    ...annotation,
    id: annotation.id ?? createId('annotation'),
    createdAt: new Date().toISOString(),
  };

  return {
    ...workspace,
    annotations: [...workspace.annotations, nextAnnotation],
  };
}

export function deleteAnnotation(
  workspace: PdfWorkspace,
  annotationId: PdfAnnotationId,
): PdfWorkspace {
  const annotation = workspace.annotations.find(
    (candidateAnnotation) => candidateAnnotation.id === annotationId,
  );

  if (!annotation) {
    return workspace;
  }

  const annotationIdsToDelete = new Set<PdfAnnotationId>([annotation.id]);

  if (annotation.type === 'text-note') {
    for (const candidateAnnotation of workspace.annotations) {
      if (candidateAnnotation.linkedCommentId === annotation.id) {
        annotationIdsToDelete.add(candidateAnnotation.id);
      }
    }
  }

  return {
    ...workspace,
    annotations: workspace.annotations.filter(
      (candidateAnnotation) => !annotationIdsToDelete.has(candidateAnnotation.id),
    ),
  };
}

export function updateAnnotation(
  workspace: PdfWorkspace,
  annotationId: PdfAnnotationId,
  patch: Partial<PdfAnnotation>,
): PdfWorkspace {
  let didUpdate = false;

  const annotations = workspace.annotations.map((annotation) => {
    if (annotation.id !== annotationId) {
      return annotation;
    }

    didUpdate = true;
    return {
      ...annotation,
      ...patch,
      id: annotation.id,
      pageItemId: annotation.pageItemId,
      type: annotation.type,
      createdAt: annotation.createdAt,
    };
  });

  return didUpdate ? { ...workspace, annotations } : workspace;
}

export function recordAnnotationMove(
  workspace: PdfWorkspace,
  previousAnnotation: PdfAnnotation,
  nextAnnotation: PdfAnnotation,
): PdfWorkspace {
  if (annotationsAreEquivalent(previousAnnotation, nextAnnotation)) {
    return workspace;
  }

  return {
    ...workspace,
  };
}
