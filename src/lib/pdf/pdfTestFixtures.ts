import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import type { PdfDocumentSource } from './types';

export type TestPdfPageSpec = {
  height: number;
  label?: string;
  rotation?: 0 | 90 | 180 | 270;
  width: number;
};

export type TestPdfSource = PdfDocumentSource & {
  pageSpecs: TestPdfPageSpec[];
};

export async function createTestPdfSource({
  fileName,
  id,
  pageSpecs,
  withFormFields = false,
}: {
  fileName: string;
  id: string;
  pageSpecs: TestPdfPageSpec[];
  withFormFields?: boolean;
}): Promise<TestPdfSource> {
  const pdfDocument = await PDFDocument.create({ updateMetadata: false });
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);

  for (const [pageIndex, pageSpec] of pageSpecs.entries()) {
    const page = pdfDocument.addPage([pageSpec.width, pageSpec.height]);

    if (pageSpec.rotation) {
      page.setRotation(degrees(pageSpec.rotation));
    }

    page.drawText(pageSpec.label ?? `${fileName} page ${pageIndex + 1}`, {
      x: 24,
      y: pageSpec.height - 42,
      size: 12,
      font,
      color: rgb(0.12, 0.16, 0.2),
    });
  }

  if (withFormFields) {
    const page = pdfDocument.getPage(0);
    const form = pdfDocument.getForm();
    const nameField = form.createTextField('fixture.name');
    const consentField = form.createCheckBox('fixture.consent');
    const planField = form.createDropdown('fixture.plan');

    nameField.setText('Original Name');
    nameField.addToPage(page, { x: 48, y: 220, width: 180, height: 22 });
    consentField.check();
    consentField.addToPage(page, { x: 48, y: 184, width: 18, height: 18 });
    planField.setOptions(['Basic', 'Pro']);
    planField.select('Basic');
    planField.addToPage(page, { x: 48, y: 144, width: 110, height: 22 });
  }

  return {
    id,
    fileName,
    bytes: await pdfDocument.save(),
    loadedAt: `2026-06-22T12:00:00.000Z-${id}`,
    pageCount: pageSpecs.length,
    pageSpecs,
  };
}

export function createSingleThreePagePdf(): Promise<TestPdfSource> {
  return createTestPdfSource({
    id: 'fixture-single-3',
    fileName: 'single-3-page.pdf',
    pageSpecs: [
      { width: 300, height: 420, label: 'single page 1' },
      { width: 300, height: 420, label: 'single page 2' },
      { width: 300, height: 420, label: 'single page 3' },
    ],
  });
}

export function createSecondTwoPagePdf(): Promise<TestPdfSource> {
  return createTestPdfSource({
    id: 'fixture-second-2',
    fileName: 'second-2-page.pdf',
    pageSpecs: [
      { width: 360, height: 500, label: 'second page 1' },
      { width: 360, height: 500, label: 'second page 2' },
    ],
  });
}

export function createDifferentPageSizesPdf(): Promise<TestPdfSource> {
  return createTestPdfSource({
    id: 'fixture-different-sizes',
    fileName: 'different-page-sizes.pdf',
    pageSpecs: [
      { width: 240, height: 360, label: 'small portrait' },
      { width: 612, height: 792, label: 'letter portrait' },
      { width: 500, height: 300, label: 'wide landscape' },
    ],
  });
}

export function createFormFieldPdf(): Promise<TestPdfSource> {
  return createTestPdfSource({
    id: 'fixture-form-fields',
    fileName: 'form-fields.pdf',
    pageSpecs: [{ width: 420, height: 520, label: 'form fixture' }],
    withFormFields: true,
  });
}

export function createRotationTestPdf(): Promise<TestPdfSource> {
  return createTestPdfSource({
    id: 'fixture-rotation',
    fileName: 'rotation-test.pdf',
    pageSpecs: [
      { width: 320, height: 460, label: 'rotation base 0' },
      { width: 320, height: 460, label: 'rotation base 90', rotation: 90 },
    ],
  });
}

export function decodePdfStreams(bytes: Uint8Array): string {
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

export function countPdfDrawnText(bytes: Uint8Array, text: string): number {
  const hexText = Buffer.from(text, 'latin1').toString('hex').toUpperCase();
  const matches = decodePdfStreams(bytes).match(new RegExp(`<${hexText}> Tj`, 'g'));

  return matches?.length ?? 0;
}

export function expectPdfDrawnText(bytes: Uint8Array, text: string): void {
  const hexText = Buffer.from(text, 'latin1').toString('hex').toUpperCase();

  expect(decodePdfStreams(bytes)).toContain(`<${hexText}> Tj`);
}
