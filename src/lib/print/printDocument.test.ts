import { describe, expect, it, vi } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import { createWorkspaceFromDocument } from '../pdf/pdfWorkspace';
import { preparePrintRequest } from './printDocument';

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 300]);
  pdf.addPage([400, 500]);
  pdf.addPage([600, 700]);
  const field = pdf.getForm().createTextField('name');
  field.setText('Original');
  field.addToPage(pdf.getPage(0), { x: 20, y: 20, width: 100, height: 25 });
  return createWorkspaceFromDocument({
    id: 'print-source',
    fileName: 'Print.pdf',
    loadedAt: 'now',
    pageCount: 3,
    bytes: await pdf.save(),
    formFields: [
      {
        id: 'name',
        name: 'name',
        type: 'text',
        value: 'Original',
        pageNumbers: [1],
        supported: true,
      },
    ],
  });
}

describe('print snapshot', () => {
  it('uses edited order and visible numbering, flattens forms, and leaves the workspace untouched', async () => {
    const workspace = await fixture();
    const [first, second, third] = workspace.pages;
    workspace.pages = [{ ...third, rotation: 90 }, { ...second, deleted: true }, first];
    workspace.activePageId = first.id;
    workspace.selectedPageIds = [first.id, second.id, third.id];
    workspace.formFieldValues = { 'print-source': { name: 'Edited' } };
    const before = structuredClone(workspace);
    const request = await preparePrintRequest(workspace);
    const pdf = await PDFDocument.load(new Uint8Array(request.markedPdf));
    expect(request.currentPage).toBe(2);
    expect(request.selectedPages).toEqual([1, 2]);
    expect(request.cleanPdf).toBeNull();
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 600, height: 700 });
    expect(pdf.getPage(0).getRotation()).toEqual(degrees(90));
    expect(pdf.getForm().getFields()).toHaveLength(0);
    expect(workspace).toEqual(before);
  });

  it('prepares a clean variant only when PaperDesk annotations exist', async () => {
    const workspace = await fixture();
    workspace.annotations = [
      {
        id: 'mark',
        pageItemId: workspace.pages[0].id,
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 40,
        height: 40,
        color: '#ff0000',
        createdAt: 'now',
      },
    ];
    const request = await preparePrintRequest(workspace);
    expect(request.cleanPdf).not.toBeNull();
    expect(request.cleanPdf).not.toEqual(request.markedPdf);
    const clean = await PDFDocument.load(new Uint8Array(request.cleanPdf!));
    expect(clean.getPageCount()).toBe(3);
    expect(workspace.annotations).toHaveLength(1);
  });

  it('rejects empty documents', async () => {
    const workspace = await fixture();
    workspace.pages = [];
    await expect(preparePrintRequest(workspace)).rejects.toThrow('There are no pages to print.');
  });
});
