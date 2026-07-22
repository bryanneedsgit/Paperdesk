import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import {
  clearPdfExportCache,
  exportPageSubset,
  exportWorkspaceToPdf,
  parsePageRanges,
} from './pdfExporter';
import { detectPdfFormFields, getResolvedFormFieldValue } from './pdfForms';
import {
  createAnnotation,
  createDefaultFormatterSettings,
  createWorkspaceFromDocument,
  createWorkspaceFromDocuments,
  isSourcePageItem,
  deleteAnnotation,
  deletePages,
  movePage,
  rotatePages,
  updateAnnotation,
  updateWorkspaceFormFieldValue,
  updateWorkspaceFormSettings,
} from './pdfWorkspace';
import {
  commitWorkspaceHistory,
  createWorkspaceHistory,
  redoWorkspaceHistory,
  undoWorkspaceHistory,
} from './workspaceHistory';
import {
  countPdfDrawnText,
  createDifferentPageSizesPdf,
  createFormFieldPdf,
  createRotationTestPdf,
  createSecondTwoPagePdf,
  createSingleThreePagePdf,
  createTestPdfSource,
  expectPdfDrawnText,
} from './pdfTestFixtures';
import type { PdfPageId, PdfWorkspace } from './types';

function visiblePages(workspace: PdfWorkspace) {
  return workspace.pages.filter((page) => !page.deleted);
}

function visiblePageIds(workspace: PdfWorkspace): PdfPageId[] {
  return visiblePages(workspace).map((page) => page.id);
}

function pageSizes(document: PDFDocument): Array<[number, number]> {
  return document.getPages().map((page) => {
    const size = page.getSize();

    return [size.width, size.height];
  });
}

function pageRotations(document: PDFDocument): number[] {
  return document.getPages().map((page) => page.getRotation().angle);
}

async function loadExportedWorkspace(workspace: PdfWorkspace): Promise<PDFDocument> {
  return PDFDocument.load(await exportWorkspaceToPdf(workspace));
}

describe('PDF app data operations with generated fixtures', () => {
  beforeEach(() => {
    clearPdfExportCache();
  });

  it('loads a generated 3-page PDF and creates a workspace', async () => {
    const source = await createSingleThreePagePdf();
    const workspace = createWorkspaceFromDocument(source);

    expect((await PDFDocument.load(source.bytes)).getPageCount()).toBe(3);
    expect(workspace.name).toBe('single-3-page.pdf');
    expect(workspace.documents).toHaveLength(1);
    expect(visiblePages(workspace)).toHaveLength(3);
    expect(
      visiblePages(workspace)
        .filter(isSourcePageItem)
        .map((page) => page.sourcePageIndex),
    ).toEqual([0, 1, 2]);
    expect(workspace.activePageId).toBe(workspace.pages[0].id);
    expect(workspace.selectedPageIds).toEqual([workspace.pages[0].id]);
  });

  it('merges two PDFs into one workspace and preserves source labels', async () => {
    const first = await createSingleThreePagePdf();
    const second = await createSecondTwoPagePdf();
    const workspace = createWorkspaceFromDocuments([first, second]);

    expect(workspace.name).toBe('Merged document');
    expect(workspace.documents.map((document) => document.id)).toEqual([first.id, second.id]);
    expect(visiblePages(workspace)).toHaveLength(5);
    expect(
      visiblePages(workspace)
        .filter(isSourcePageItem)
        .map((page) => page.sourceFileName),
    ).toEqual([first.fileName, first.fileName, first.fileName, second.fileName, second.fileName]);
  });

  it('deletes pages after merge and exports only visible pages', async () => {
    const workspace = createWorkspaceFromDocuments([
      await createSingleThreePagePdf(),
      await createSecondTwoPagePdf(),
    ]);
    const pageIdsToDelete = [workspace.pages[1].id, workspace.pages[3].id];
    const editedWorkspace = deletePages(workspace, pageIdsToDelete);
    const exportedDocument = await loadExportedWorkspace(editedWorkspace);

    expect(visiblePages(editedWorkspace)).toHaveLength(3);
    expect(visiblePages(editedWorkspace).map((page) => page.displayIndex)).toEqual([1, 2, 3]);
    expect(exportedDocument.getPageCount()).toBe(3);
  });

  it('rearranges pages after merge and exports in workspace order', async () => {
    const first = await createSingleThreePagePdf();
    const second = await createSecondTwoPagePdf();
    const workspace = createWorkspaceFromDocuments([first, second]);
    const movedWorkspace = movePage(workspace, workspace.pages[4].id, workspace.pages[0].id);
    const exportedDocument = await loadExportedWorkspace(movedWorkspace);

    expect(visiblePages(movedWorkspace)[0]).toMatchObject({
      sourceDocumentId: second.id,
      sourcePageIndex: 1,
    });
    expect(pageSizes(exportedDocument)).toEqual([
      [360, 500],
      [300, 420],
      [300, 420],
      [300, 420],
      [360, 500],
    ]);
  });

  it('rotates pages and combines source rotation during export', async () => {
    const source = await createRotationTestPdf();
    const workspace = createWorkspaceFromDocument(source);
    const rotatedWorkspace = rotatePages(
      workspace,
      [workspace.pages[0].id, workspace.pages[1].id],
      'clockwise',
    );
    const exportedDocument = await loadExportedWorkspace(rotatedWorkspace);

    expect(visiblePages(rotatedWorkspace).map((page) => page.rotation)).toEqual([90, 90]);
    expect(pageRotations(exportedDocument)).toEqual([90, 180]);
  });

  it('exports selected pages without including unselected pages', async () => {
    const source = await createDifferentPageSizesPdf();
    const workspace = createWorkspaceFromDocument(source);
    const selectedPageIds = [workspace.pages[0].id, workspace.pages[2].id];
    const exportedDocument = await PDFDocument.load(
      await exportPageSubset(workspace, selectedPageIds),
    );

    expect(exportedDocument.getPageCount()).toBe(2);
    expect(pageSizes(exportedDocument)).toEqual([
      [240, 360],
      [500, 300],
    ]);
  });

  it('parses page ranges for split/export workflows', () => {
    expect(parsePageRanges('1-2, 4, 5-6', 6)).toEqual([
      { label: '1-2', pageNumbers: [1, 2] },
      { label: '4', pageNumbers: [4] },
      { label: '5-6', pageNumbers: [5, 6] },
    ]);
    expect(() => parsePageRanges('3-1', 6)).toThrow('Page range start is after its end.');
    expect(() => parsePageRanges('1-7', 6)).toThrow('Page range exceeds visible page count.');
  });

  it('burns formatter page numbers into exported pages', async () => {
    const source = await createSingleThreePagePdf();
    const workspace: PdfWorkspace = {
      ...createWorkspaceFromDocument(source),
      formatterSettings: {
        ...createDefaultFormatterSettings(),
        pageNumbersEnabled: true,
        startNumber: 7,
      },
    };
    const exportedBytes = await exportWorkspaceToPdf(workspace);

    expectPdfDrawnText(exportedBytes, '7');
    expectPdfDrawnText(exportedBytes, '8');
    expectPdfDrawnText(exportedBytes, '9');
  });

  it('burns watermark text into each exported page', async () => {
    const source = await createSecondTwoPagePdf();
    const workspace: PdfWorkspace = {
      ...createWorkspaceFromDocument(source),
      formatterSettings: {
        ...createDefaultFormatterSettings(),
        watermarkText: 'CONFIDENTIAL',
      },
    };
    const exportedBytes = await exportWorkspaceToPdf(workspace);

    expect(countPdfDrawnText(exportedBytes, 'CONFIDENTIAL')).toBe(2);
  });

  it('undoes and redoes delete, rearrange, and rotate operations', async () => {
    const workspace = createWorkspaceFromDocuments([
      await createSingleThreePagePdf(),
      await createSecondTwoPagePdf(),
    ]);
    const deletedWorkspace = deletePages(workspace, [workspace.pages[1].id]);
    const movedWorkspace = movePage(
      deletedWorkspace,
      deletedWorkspace.pages[4].id,
      deletedWorkspace.pages[0].id,
    );
    const rotatedWorkspace = rotatePages(movedWorkspace, [movedWorkspace.pages[0].id], 'clockwise');
    const historyAfterDelete = commitWorkspaceHistory(
      createWorkspaceHistory(workspace),
      deletedWorkspace,
    );
    const historyAfterMove = commitWorkspaceHistory(historyAfterDelete, movedWorkspace);
    const historyAfterRotate = commitWorkspaceHistory(historyAfterMove, rotatedWorkspace);

    expect(visiblePages(historyAfterRotate.present)).toHaveLength(4);
    expect(historyAfterRotate.present.pages[0].rotation).toBe(90);

    const undoRotate = undoWorkspaceHistory(historyAfterRotate);
    expect(undoRotate.present.pages[0].rotation).toBe(0);

    const undoMove = undoWorkspaceHistory(undoRotate);
    expect(visiblePageIds(undoMove.present)).toEqual(visiblePageIds(deletedWorkspace));

    const undoDelete = undoWorkspaceHistory(undoMove);
    expect(visiblePages(undoDelete.present)).toHaveLength(5);

    const redoDelete = redoWorkspaceHistory(undoDelete);
    const redoMove = redoWorkspaceHistory(redoDelete);
    const redoRotate = redoWorkspaceHistory(redoMove);
    expect(visiblePageIds(redoRotate.present)).toEqual(visiblePageIds(rotatedWorkspace));
    expect(redoRotate.present.pages[0].rotation).toBe(90);
  });

  it('exports the full 3-PDF edited workspace journey exactly as arranged', async () => {
    const first = await createDifferentPageSizesPdf();
    const second = await createTestPdfSource({
      id: 'journey-second',
      fileName: 'journey-second.pdf',
      pageSpecs: [
        { width: 360, height: 500, label: 'journey second page 1' },
        { width: 390, height: 510, label: 'journey second page 2' },
      ],
    });
    const formSource = await createFormFieldPdf();
    const formFields = await detectPdfFormFields(formSource.bytes);
    const formDocument = { ...formSource, formFields };
    const originalBytes = new Map([
      [first.id, Array.from(first.bytes)],
      [second.id, Array.from(second.bytes)],
      [formDocument.id, Array.from(formDocument.bytes)],
    ]);
    const workspace = createWorkspaceFromDocuments([first, second, formDocument]);
    const formPageId = workspace.pages[5].id;
    const movedWorkspace = movePage(workspace, formPageId, workspace.pages[1].id);
    const deletedWorkspace = deletePages(movedWorkspace, [
      workspace.pages[2].id,
      workspace.pages[3].id,
    ]);
    const rotatedWorkspace = rotatePages(deletedWorkspace, [workspace.pages[0].id], 'clockwise');
    const formattedWorkspace: PdfWorkspace = {
      ...rotatedWorkspace,
      formatterSettings: {
        ...createDefaultFormatterSettings(),
        footerText: 'Paperdesk footer',
        headerText: 'Paperdesk header',
        pageNumbersEnabled: true,
        startNumber: 10,
        watermarkOpacity: 0.2,
        watermarkText: 'INTEGRATION WATERMARK',
      },
    };
    const formEditedWorkspace = updateWorkspaceFormFieldValue({
      workspace: updateWorkspaceFormSettings(formattedWorkspace, { flattenOnExport: true }),
      sourceDocumentId: formDocument.id,
      fieldName: 'fixture.name',
      value: 'Journey Form Name',
    });
    const finalWorkspace = createAnnotation(formEditedWorkspace, {
      id: 'journey-annotation',
      pageItemId: formPageId,
      type: 'free-text',
      x: 40,
      y: 56,
      width: 160,
      height: 40,
      content: 'Journey annotation',
    });
    const exportedBytes = await exportWorkspaceToPdf(finalWorkspace);
    const exportedDocument = await PDFDocument.load(exportedBytes);

    expect(visiblePages(finalWorkspace).map((page) => page.id)).toEqual([
      workspace.pages[0].id,
      formPageId,
      workspace.pages[1].id,
      workspace.pages[4].id,
    ]);
    expect(exportedDocument.getPageCount()).toBe(4);
    expect(pageSizes(exportedDocument)).toEqual([
      [240, 360],
      [420, 520],
      [612, 792],
      [390, 510],
    ]);
    expect(pageRotations(exportedDocument)).toEqual([90, 0, 0, 0]);
    expect(countPdfDrawnText(exportedBytes, 'INTEGRATION WATERMARK')).toBe(4);
    expect(countPdfDrawnText(exportedBytes, 'Paperdesk header')).toBe(4);
    expect(countPdfDrawnText(exportedBytes, 'Paperdesk footer')).toBe(4);
    expectPdfDrawnText(exportedBytes, '10');
    expectPdfDrawnText(exportedBytes, '11');
    expectPdfDrawnText(exportedBytes, '12');
    expectPdfDrawnText(exportedBytes, '13');
    expectPdfDrawnText(exportedBytes, 'Journey annotation');
    expectPdfDrawnText(exportedBytes, 'Journey Form Name');
    expect(Array.from(first.bytes)).toEqual(originalBytes.get(first.id));
    expect(Array.from(second.bytes)).toEqual(originalBytes.get(second.id));
    expect(Array.from(formDocument.bytes)).toEqual(originalBytes.get(formDocument.id));
  });

  it('models form field edits separately from source document bytes', async () => {
    const source = await createFormFieldPdf();
    const formFields = await detectPdfFormFields(source.bytes);
    const sourceWithFields = { ...source, formFields };
    const workspace = createWorkspaceFromDocument(sourceWithFields);
    const nameField = formFields.find((field) => field.name === 'fixture.name');

    if (!nameField) {
      throw new Error('Expected generated form fixture to include fixture.name.');
    }

    const editedWorkspace = updateWorkspaceFormFieldValue({
      workspace,
      sourceDocumentId: source.id,
      fieldName: 'fixture.name',
      value: 'Edited Locally',
    });

    expect(getResolvedFormFieldValue(editedWorkspace, source.id, nameField)).toBe('Edited Locally');
    expect(source.bytes).toBe(sourceWithFields.bytes);
    expect(editedWorkspace.formFieldValues[source.id]).toEqual({
      'fixture.name': 'Edited Locally',
    });
  });

  it('models annotation create, move, and delete operations', async () => {
    const workspace = createWorkspaceFromDocument(await createSingleThreePagePdf());
    const annotatedWorkspace = createAnnotation(workspace, {
      id: 'annotation-fixture',
      pageItemId: workspace.pages[0].id,
      type: 'free-text',
      x: 20,
      y: 30,
      width: 140,
      height: 32,
      content: 'Review note',
    });
    const movedWorkspace = updateAnnotation(annotatedWorkspace, 'annotation-fixture', {
      x: 80,
      y: 90,
    });
    const deletedWorkspace = deleteAnnotation(movedWorkspace, 'annotation-fixture');

    expect(annotatedWorkspace.annotations[0]).toMatchObject({
      content: 'Review note',
      x: 20,
      y: 30,
    });
    expect(movedWorkspace.annotations[0]).toMatchObject({ x: 80, y: 90 });
    expect(deletedWorkspace.annotations).toHaveLength(0);
  });
});
