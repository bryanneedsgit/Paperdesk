import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { exportWorkspaceToPdf } from './pdfExporter';
import { applyPdfFormValues, detectPdfFormFields } from './pdfForms';
import { createDefaultFormSettings, createDefaultFormatterSettings } from './pdfWorkspace';
import type { PdfDocumentSource, PdfPageItem, PdfWorkspace } from './types';

async function createFormPdf(): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.create({ updateMetadata: false });
  const page = pdfDocument.addPage([420, 520]);
  const form = pdfDocument.getForm();
  const nameField = form.createTextField('applicant.name');
  const consentField = form.createCheckBox('applicant.consent');
  const planField = form.createDropdown('applicant.plan');
  const contactField = form.createRadioGroup('applicant.contact');

  nameField.setText('Existing Name');
  nameField.addToPage(page, { x: 60, y: 430, width: 220, height: 24 });
  consentField.check();
  consentField.addToPage(page, { x: 60, y: 390, width: 18, height: 18 });
  planField.setOptions(['Basic', 'Pro']);
  planField.select('Basic');
  planField.addToPage(page, { x: 60, y: 340, width: 120, height: 24 });
  contactField.addOptionToPage('Email', page, { x: 60, y: 290, width: 18, height: 18 });
  contactField.addOptionToPage('Phone', page, { x: 120, y: 290, width: 18, height: 18 });
  contactField.select('Email');

  return pdfDocument.save();
}

function createWorkspace(sourceDocument: PdfDocumentSource): PdfWorkspace {
  const page: PdfPageItem = {
    id: 'form-page-1',
    sourceDocumentId: sourceDocument.id,
    sourceFileName: sourceDocument.fileName,
    sourcePageIndex: 0,
    displayIndex: 1,
    rotation: 0,
    deleted: false,
  };

  return {
    id: 'forms-workspace',
    name: sourceDocument.fileName,
    documents: [sourceDocument],
    bookmarkedPageIds: [],
    pages: [page],
    selectedPageIds: [page.id],
    activePageId: page.id,
    formatterSettings: createDefaultFormatterSettings(),
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    annotations: [],
  };
}

function decodePdfStreams(bytes: Uint8Array): string {
  const pdfContent = Buffer.from(bytes).toString('latin1');
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const decodedStreams: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(pdfContent))) {
    try {
      decodedStreams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch {
      decodedStreams.push(match[1]);
    }
  }

  return decodedStreams.join('\n');
}

function expectPdfDrawnText(bytes: Uint8Array, text: string): void {
  const hexText = Buffer.from(text, 'latin1').toString('hex').toUpperCase();

  expect(decodePdfStreams(bytes)).toContain(`<${hexText}> Tj`);
}

describe('pdfForms', () => {
  it('detects supported AcroForm fields with values and page numbers', async () => {
    const fields = await detectPdfFormFields(await createFormPdf());

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'applicant.name',
          type: 'text',
          value: 'Existing Name',
          pageNumbers: [1],
          supported: true,
        }),
        expect.objectContaining({
          name: 'applicant.consent',
          type: 'checkbox',
          value: true,
          pageNumbers: [1],
          supported: true,
        }),
        expect.objectContaining({
          name: 'applicant.plan',
          type: 'dropdown',
          value: ['Basic'],
          options: ['Basic', 'Pro'],
          pageNumbers: [1],
          supported: true,
        }),
        expect.objectContaining({
          name: 'applicant.contact',
          type: 'radio',
          value: 'Email',
          options: ['Email', 'Phone'],
          pageNumbers: [1],
          supported: true,
        }),
      ]),
    );
  });

  it('applies edited form values before workspace export', async () => {
    const bytes = await createFormPdf();
    const sourceDocument: PdfDocumentSource = {
      id: 'source-form',
      fileName: 'form.pdf',
      bytes,
      loadedAt: '2026-06-22T10:00:00.000Z',
      pageCount: 1,
      formFields: await detectPdfFormFields(bytes),
    };
    const workspace: PdfWorkspace = {
      ...createWorkspace(sourceDocument),
      formFieldValues: {
        [sourceDocument.id]: {
          'applicant.name': 'Exported Name',
        },
      },
    };

    expectPdfDrawnText(await exportWorkspaceToPdf(workspace), 'Exported Name');
  });

  it('preserves fillable fields on direct single-document export when flattening is off', async () => {
    const bytes = await createFormPdf();
    const sourceDocument: PdfDocumentSource = {
      id: 'source-form',
      fileName: 'form.pdf',
      bytes,
      loadedAt: '2026-06-22T10:00:00.000Z',
      pageCount: 1,
      formFields: await detectPdfFormFields(bytes),
    };
    const workspace: PdfWorkspace = {
      ...createWorkspace(sourceDocument),
      formFieldValues: {
        [sourceDocument.id]: {
          'applicant.name': 'Interactive Name',
        },
      },
    };
    const exportedDocument = await PDFDocument.load(await exportWorkspaceToPdf(workspace));
    const textField = exportedDocument.getForm().getTextField('applicant.name');

    expect(textField.getText()).toBe('Interactive Name');
  });

  it('can flatten form fields after applying values', async () => {
    const pdfDocument = await PDFDocument.load(await createFormPdf(), { updateMetadata: false });

    applyPdfFormValues(pdfDocument, { 'applicant.name': 'Flattened Name' }, true);

    expect(pdfDocument.getForm().getFields()).toHaveLength(0);
  });
});
