import { describe, expect, it } from 'vitest';

import type { PdfDocumentSource, PdfPageId, PdfPageItem, PdfRotation, PdfWorkspace } from './types';
import {
  appendDocumentsToWorkspace,
  createAnnotation,
  createDefaultFormSettings,
  createDefaultFormatterSettings,
  createWorkspaceFromDocuments,
  deleteAnnotation,
  deletePages,
  movePage,
  moveSelectedPages,
  recordAnnotationMove,
  rotatePages,
  togglePageBookmark,
  updateAnnotation,
} from './pdfWorkspace';
import {
  commitWorkspaceHistory,
  commitWorkspaceHistoryFromPrevious,
  createWorkspaceHistory,
  redoWorkspaceHistory,
  undoWorkspaceHistory,
} from './workspaceHistory';

function createDocument(id: string, fileName: string, pageCount: number): PdfDocumentSource {
  return {
    id,
    fileName,
    bytes: new Uint8Array([pageCount]),
    pageCount,
    loadedAt: `2026-06-21T00:00:0${pageCount}.000Z`,
  };
}

type PageSpec = {
  deleted?: boolean;
  document: PdfDocumentSource;
  id: PdfPageId;
  rotation?: PdfRotation;
  sourcePageIndex: number;
};

const alphaDocument = createDocument('doc-alpha', 'alpha.pdf', 3);
const betaDocument = createDocument('doc-beta', 'beta.pdf', 3);
const gammaDocument = createDocument('doc-gamma', 'gamma.pdf', 1);

function createPage(spec: PageSpec, displayIndex: number): PdfPageItem {
  return {
    id: spec.id,
    sourceDocumentId: spec.document.id,
    sourceFileName: spec.document.fileName,
    sourcePageIndex: spec.sourcePageIndex,
    displayIndex,
    rotation: spec.rotation ?? 0,
    deleted: Boolean(spec.deleted),
  };
}

function createWorkspace({
  activePageId = 'alpha-1',
  pageSpecs,
  selectedPageIds = [],
}: {
  activePageId?: PdfPageId;
  pageSpecs: PageSpec[];
  selectedPageIds?: PdfPageId[];
}): PdfWorkspace {
  let displayIndex = 1;
  const pages = pageSpecs.map((spec) => {
    const page = createPage(spec, displayIndex);

    if (!spec.deleted) {
      displayIndex += 1;
    }

    return page;
  });

  return {
    id: 'workspace-test',
    name: 'Merged document',
    documents: [alphaDocument, betaDocument, gammaDocument],
    bookmarkedPageIds: [],
    pages,
    selectedPageIds,
    activePageId,
    formatterSettings: createDefaultFormatterSettings(),
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    annotations: [],
  };
}

function createMergedWorkspace(selectedPageIds: PdfPageId[] = []): PdfWorkspace {
  return createWorkspace({
    selectedPageIds,
    pageSpecs: [
      { id: 'alpha-1', document: alphaDocument, sourcePageIndex: 0 },
      { id: 'alpha-2', document: alphaDocument, sourcePageIndex: 1 },
      { id: 'beta-1', document: betaDocument, sourcePageIndex: 0 },
      { id: 'beta-2', document: betaDocument, sourcePageIndex: 1 },
      { id: 'gamma-1', document: gammaDocument, sourcePageIndex: 0 },
    ],
  });
}

function visiblePageIds(workspace: PdfWorkspace): PdfPageId[] {
  return workspace.pages.filter((page) => !page.deleted).map((page) => page.id);
}

function visibleDisplayIndexes(workspace: PdfWorkspace): number[] {
  return workspace.pages.filter((page) => !page.deleted).map((page) => page.displayIndex);
}

function rotationByPageId(workspace: PdfWorkspace, pageId: PdfPageId): PdfRotation | undefined {
  return workspace.pages.find((page) => page.id === pageId)?.rotation;
}

describe('pdfWorkspace page rearranging', () => {
  it('moves one page in a merged workspace without changing its source reference', () => {
    const workspace = createMergedWorkspace();
    const movedWorkspace = movePage(workspace, 'beta-1', 'alpha-2');

    expect(visiblePageIds(movedWorkspace)).toEqual([
      'alpha-1',
      'beta-1',
      'alpha-2',
      'beta-2',
      'gamma-1',
    ]);
    expect(visibleDisplayIndexes(movedWorkspace)).toEqual([1, 2, 3, 4, 5]);

    const movedPage = movedWorkspace.pages.find((page) => page.id === 'beta-1');
    expect(movedPage).toMatchObject({
      sourceDocumentId: betaDocument.id,
      sourceFileName: betaDocument.fileName,
      sourcePageIndex: 0,
    });
  });

  it('moves selected pages from multiple source PDFs as one ordered group', () => {
    const workspace = createMergedWorkspace(['alpha-2', 'beta-1']);
    const movedWorkspace = moveSelectedPages(workspace, ['alpha-2', 'beta-1'], 'gamma-1');

    expect(visiblePageIds(movedWorkspace)).toEqual([
      'alpha-1',
      'beta-2',
      'gamma-1',
      'alpha-2',
      'beta-1',
    ]);
    expect(movedWorkspace.selectedPageIds).toEqual(['alpha-2', 'beta-1']);
    expect(movedWorkspace.pages.find((page) => page.id === 'alpha-2')).toMatchObject({
      sourceDocumentId: alphaDocument.id,
      sourcePageIndex: 1,
    });
    expect(movedWorkspace.pages.find((page) => page.id === 'beta-1')).toMatchObject({
      sourceDocumentId: betaDocument.id,
      sourcePageIndex: 0,
    });
  });

  it('rearranges only visible pages when deleted pages exist', () => {
    const workspace = createWorkspace({
      pageSpecs: [
        { id: 'alpha-1', document: alphaDocument, sourcePageIndex: 0 },
        { id: 'alpha-2', document: alphaDocument, sourcePageIndex: 1, deleted: true },
        { id: 'beta-1', document: betaDocument, sourcePageIndex: 0 },
        { id: 'beta-2', document: betaDocument, sourcePageIndex: 1 },
      ],
    });
    const movedWorkspace = movePage(workspace, 'beta-2', 'alpha-1');

    expect(visiblePageIds(movedWorkspace)).toEqual(['beta-2', 'alpha-1', 'beta-1']);
    expect(visibleDisplayIndexes(movedWorkspace)).toEqual([1, 2, 3]);
    expect(movedWorkspace.pages[movedWorkspace.pages.length - 1]).toMatchObject({
      id: 'alpha-2',
      deleted: true,
    });
  });

  it('undoes a page rearrange and restores active page and selection', () => {
    const workspace = createWorkspace({
      activePageId: 'beta-1',
      selectedPageIds: ['alpha-2', 'beta-1'],
      pageSpecs: [
        { id: 'alpha-1', document: alphaDocument, sourcePageIndex: 0 },
        { id: 'alpha-2', document: alphaDocument, sourcePageIndex: 1 },
        { id: 'beta-1', document: betaDocument, sourcePageIndex: 0 },
        { id: 'beta-2', document: betaDocument, sourcePageIndex: 1 },
      ],
    });
    const movedWorkspace = moveSelectedPages(workspace, ['alpha-2', 'beta-1'], 'beta-2');
    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), movedWorkspace);
    const restoredWorkspace = undoWorkspaceHistory(history).present;

    expect(visiblePageIds(restoredWorkspace)).toEqual(['alpha-1', 'alpha-2', 'beta-1', 'beta-2']);
    expect(restoredWorkspace.activePageId).toBe('beta-1');
    expect(restoredWorkspace.selectedPageIds).toEqual(['alpha-2', 'beta-1']);
  });
});

describe('pdfWorkspace page bookmarks', () => {
  it('toggles bookmarks only for visible workspace pages', () => {
    const workspace = createMergedWorkspace();
    const bookmarkedWorkspace = togglePageBookmark(workspace, 'beta-1');

    expect(bookmarkedWorkspace.bookmarkedPageIds).toEqual(['beta-1']);
    expect(togglePageBookmark(bookmarkedWorkspace, 'beta-1').bookmarkedPageIds).toEqual([]);
    expect(togglePageBookmark(workspace, 'missing-page')).toBe(workspace);

    const workspaceWithDeletedPage = createWorkspace({
      pageSpecs: [
        { id: 'alpha-1', document: alphaDocument, sourcePageIndex: 0 },
        { id: 'alpha-2', document: alphaDocument, sourcePageIndex: 1, deleted: true },
      ],
    });

    expect(togglePageBookmark(workspaceWithDeletedPage, 'alpha-2')).toBe(workspaceWithDeletedPage);
  });

  it('keeps bookmarks through reordering and removes them with deleted pages', () => {
    const workspace: PdfWorkspace = {
      ...createMergedWorkspace(),
      bookmarkedPageIds: ['alpha-2', 'beta-1'],
    };
    const movedWorkspace = movePage(workspace, 'beta-1', 'alpha-1');

    expect(movedWorkspace.bookmarkedPageIds).toEqual(['alpha-2', 'beta-1']);

    const deletedWorkspace = deletePages(movedWorkspace, ['alpha-2']);

    expect(deletedWorkspace.bookmarkedPageIds).toEqual(['beta-1']);
  });
});

describe('pdfWorkspace page rotation', () => {
  it('rotates multiple selected pages without changing workspace order', () => {
    const workspace = createMergedWorkspace(['alpha-2', 'beta-1']);
    const rotatedWorkspace = rotatePages(workspace, ['alpha-2', 'beta-1'], 'clockwise');

    expect(visiblePageIds(rotatedWorkspace)).toEqual([
      'alpha-1',
      'alpha-2',
      'beta-1',
      'beta-2',
      'gamma-1',
    ]);
    expect(visibleDisplayIndexes(rotatedWorkspace)).toEqual([1, 2, 3, 4, 5]);
    expect(rotationByPageId(rotatedWorkspace, 'alpha-2')).toBe(90);
    expect(rotationByPageId(rotatedWorkspace, 'beta-1')).toBe(90);
    expect(rotationByPageId(rotatedWorkspace, 'alpha-1')).toBe(0);
    expect(rotatedWorkspace.selectedPageIds).toEqual(['alpha-2', 'beta-1']);
  });

  it('normalizes counterclockwise rotation to allowed PDF rotation values', () => {
    const workspace = createWorkspace({
      selectedPageIds: ['alpha-1', 'beta-1'],
      pageSpecs: [
        { id: 'alpha-1', document: alphaDocument, sourcePageIndex: 0 },
        { id: 'beta-1', document: betaDocument, sourcePageIndex: 0, rotation: 90 },
        { id: 'beta-2', document: betaDocument, sourcePageIndex: 1, deleted: true },
      ],
    });
    const rotatedWorkspace = rotatePages(
      workspace,
      ['alpha-1', 'beta-1', 'beta-2'],
      'counterclockwise',
    );

    expect(rotationByPageId(rotatedWorkspace, 'alpha-1')).toBe(270);
    expect(rotationByPageId(rotatedWorkspace, 'beta-1')).toBe(0);
    expect(rotationByPageId(rotatedWorkspace, 'beta-2')).toBe(0);
    expect(visiblePageIds(rotatedWorkspace)).toEqual(['alpha-1', 'beta-1']);
  });

  it('undoes page rotation and restores active page and selection', () => {
    const workspace = createWorkspace({
      activePageId: 'beta-1',
      selectedPageIds: ['alpha-2', 'beta-1'],
      pageSpecs: [
        { id: 'alpha-1', document: alphaDocument, sourcePageIndex: 0 },
        { id: 'alpha-2', document: alphaDocument, sourcePageIndex: 1 },
        { id: 'beta-1', document: betaDocument, sourcePageIndex: 0, rotation: 180 },
      ],
    });
    const rotatedWorkspace = rotatePages(workspace, ['alpha-2', 'beta-1'], 'clockwise');
    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), rotatedWorkspace);
    const restoredWorkspace = undoWorkspaceHistory(history).present;

    expect(rotationByPageId(restoredWorkspace, 'alpha-2')).toBe(0);
    expect(rotationByPageId(restoredWorkspace, 'beta-1')).toBe(180);
    expect(restoredWorkspace.activePageId).toBe('beta-1');
    expect(restoredWorkspace.selectedPageIds).toEqual(['alpha-2', 'beta-1']);
  });
});

describe('workspaceHistory', () => {
  it('undoes and redoes deleted pages with compact snapshots', () => {
    const workspace = createMergedWorkspace(['alpha-2']);
    const deletedWorkspace = deletePages(workspace, ['alpha-2', 'beta-1']);
    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), deletedWorkspace);

    expect(visiblePageIds(history.present)).toEqual(['alpha-1', 'beta-2', 'gamma-1']);
    expect('bytes' in history.past[0].documents[0]).toBe(false);

    const undoneHistory = undoWorkspaceHistory(history);
    expect(visiblePageIds(undoneHistory.present)).toEqual([
      'alpha-1',
      'alpha-2',
      'beta-1',
      'beta-2',
      'gamma-1',
    ]);
    expect(undoneHistory.present.documents[0].bytes).toBe(alphaDocument.bytes);

    const redoneHistory = redoWorkspaceHistory(undoneHistory);
    expect(visiblePageIds(redoneHistory.present)).toEqual(['alpha-1', 'beta-2', 'gamma-1']);
  });

  it('undoes and redoes page rearranging', () => {
    const workspace = createMergedWorkspace(['alpha-2', 'beta-1']);
    const movedWorkspace = moveSelectedPages(workspace, ['alpha-2', 'beta-1'], 'gamma-1');
    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), movedWorkspace);

    expect(visiblePageIds(history.present)).toEqual([
      'alpha-1',
      'beta-2',
      'gamma-1',
      'alpha-2',
      'beta-1',
    ]);

    const undoneHistory = undoWorkspaceHistory(history);
    expect(visiblePageIds(undoneHistory.present)).toEqual([
      'alpha-1',
      'alpha-2',
      'beta-1',
      'beta-2',
      'gamma-1',
    ]);

    expect(visiblePageIds(redoWorkspaceHistory(undoneHistory).present)).toEqual([
      'alpha-1',
      'beta-2',
      'gamma-1',
      'alpha-2',
      'beta-1',
    ]);
  });

  it('undoes and redoes page rotation', () => {
    const workspace = createMergedWorkspace(['alpha-2', 'beta-1']);
    const rotatedWorkspace = rotatePages(workspace, ['alpha-2', 'beta-1'], 'clockwise');
    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), rotatedWorkspace);

    expect(rotationByPageId(history.present, 'alpha-2')).toBe(90);
    expect(rotationByPageId(history.present, 'beta-1')).toBe(90);

    const undoneHistory = undoWorkspaceHistory(history);
    expect(rotationByPageId(undoneHistory.present, 'alpha-2')).toBe(0);
    expect(rotationByPageId(undoneHistory.present, 'beta-1')).toBe(0);

    const redoneHistory = redoWorkspaceHistory(undoneHistory);
    expect(rotationByPageId(redoneHistory.present, 'alpha-2')).toBe(90);
    expect(rotationByPageId(redoneHistory.present, 'beta-1')).toBe(90);
  });

  it('undoes and redoes adding PDFs without duplicating source bytes in snapshots', () => {
    const workspace = createWorkspaceFromDocuments([alphaDocument]);
    const mergedWorkspace = appendDocumentsToWorkspace(workspace, [betaDocument]);
    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), mergedWorkspace);

    expect(history.present.documents.map((document) => document.id)).toEqual([
      alphaDocument.id,
      betaDocument.id,
    ]);
    expect(history.past[0].documents).toHaveLength(1);
    expect('bytes' in history.past[0].documents[0]).toBe(false);

    const undoneHistory = undoWorkspaceHistory(history);
    expect(undoneHistory.present.documents.map((document) => document.id)).toEqual([
      alphaDocument.id,
    ]);
    expect(undoneHistory.present.pages).toHaveLength(alphaDocument.pageCount);

    const redoneHistory = redoWorkspaceHistory(undoneHistory);
    expect(redoneHistory.present.documents.map((document) => document.id)).toEqual([
      alphaDocument.id,
      betaDocument.id,
    ]);
    expect(redoneHistory.present.documents[1].bytes).toBe(betaDocument.bytes);
    expect(redoneHistory.present.pages).toHaveLength(
      alphaDocument.pageCount + betaDocument.pageCount,
    );
  });
});

describe('pdfWorkspace annotations', () => {
  it('undoes annotation creation', () => {
    const workspace = createMergedWorkspace();
    const annotatedWorkspace = createAnnotation(workspace, {
      id: 'annotation-1',
      pageItemId: 'alpha-1',
      type: 'highlight',
      x: 10,
      y: 20,
      width: 100,
      height: 30,
    });

    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), annotatedWorkspace);

    expect(annotatedWorkspace.annotations).toHaveLength(1);
    expect(undoWorkspaceHistory(history).present.annotations).toHaveLength(0);
  });

  it('undoes annotation deletion', () => {
    const workspace = createAnnotation(createMergedWorkspace(), {
      id: 'annotation-1',
      pageItemId: 'alpha-1',
      type: 'free-text',
      x: 10,
      y: 20,
      width: 100,
      height: 30,
      content: 'Keep me',
    });
    const deletedWorkspace = deleteAnnotation(workspace, 'annotation-1');

    const history = commitWorkspaceHistory(createWorkspaceHistory(workspace), deletedWorkspace);

    expect(deletedWorkspace.annotations).toHaveLength(0);
    expect(undoWorkspaceHistory(history).present.annotations[0]).toMatchObject({
      id: 'annotation-1',
      content: 'Keep me',
    });
  });

  it('deletes highlights linked to a comment annotation', () => {
    const workspaceWithComment = createAnnotation(createMergedWorkspace(), {
      id: 'comment-1',
      pageItemId: 'alpha-1',
      type: 'text-note',
      x: 120,
      y: 20,
      width: 120,
      height: 72,
      content: 'Comment',
    });
    const workspaceWithLinkedHighlight = createAnnotation(workspaceWithComment, {
      id: 'highlight-1',
      pageItemId: 'alpha-1',
      type: 'highlight',
      x: 10,
      y: 20,
      width: 90,
      height: 14,
      linkedCommentId: 'comment-1',
    });
    const workspaceWithIndependentHighlight = createAnnotation(workspaceWithLinkedHighlight, {
      id: 'highlight-2',
      pageItemId: 'alpha-1',
      type: 'highlight',
      x: 10,
      y: 42,
      width: 90,
      height: 14,
    });

    const deletedWorkspace = deleteAnnotation(workspaceWithIndependentHighlight, 'comment-1');

    expect(deletedWorkspace.annotations.map((annotation) => annotation.id)).toEqual([
      'highlight-2',
    ]);
  });

  it('undoes annotation movement', () => {
    const workspace = createAnnotation(createMergedWorkspace(), {
      id: 'annotation-1',
      pageItemId: 'alpha-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 100,
      height: 30,
    });
    const previousAnnotation = workspace.annotations[0];
    const movedWorkspace = updateAnnotation(workspace, 'annotation-1', { x: 50, y: 60 });
    const movedAnnotation = movedWorkspace.annotations[0];
    const committedWorkspace = recordAnnotationMove(
      movedWorkspace,
      previousAnnotation,
      movedAnnotation,
    );
    const history = commitWorkspaceHistoryFromPrevious(
      createWorkspaceHistory(workspace),
      workspace,
      committedWorkspace,
    );

    expect(undoWorkspaceHistory(history).present.annotations[0]).toMatchObject({
      x: 10,
      y: 20,
    });
  });
});
