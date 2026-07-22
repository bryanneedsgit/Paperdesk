import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';

import type {
  PdfDocumentSource,
  PdfFormField,
  PdfFormFieldType,
  PdfFormFieldValue,
  PdfFormFieldValuesByDocument,
  PdfFormFieldValuesByName,
  PdfWorkspace,
} from './types';

export type PdfFormDataJson = {
  documents: Array<{
    fields: PdfFormFieldValuesByName;
    fileName: string;
    sourceDocumentId: string;
  }>;
  version: 1;
};

type FieldWithWidgets = PDFField & {
  acroField: PDFField['acroField'] & {
    getWidgets(): Array<{
      P(): { toString(): string } | undefined;
    }>;
  };
};

function getFieldType(field: PDFField): PdfFormFieldType {
  if (field instanceof PDFTextField) {
    return 'text';
  }

  if (field instanceof PDFCheckBox) {
    return 'checkbox';
  }

  if (field instanceof PDFRadioGroup) {
    return 'radio';
  }

  if (field instanceof PDFDropdown) {
    return 'dropdown';
  }

  if (field instanceof PDFOptionList) {
    return 'option-list';
  }

  return field.constructor.name.replace(/^PDF/, '').toLowerCase() as PdfFormFieldType;
}

function isSupportedFieldType(type: PdfFormFieldType): boolean {
  return (
    type === 'text' ||
    type === 'checkbox' ||
    type === 'radio' ||
    type === 'dropdown' ||
    type === 'option-list'
  );
}

function getFieldValue(field: PDFField): PdfFormFieldValue {
  if (field instanceof PDFTextField) {
    return field.getText() ?? '';
  }

  if (field instanceof PDFCheckBox) {
    return field.isChecked();
  }

  if (field instanceof PDFRadioGroup) {
    return field.getSelected() ?? '';
  }

  if (field instanceof PDFDropdown) {
    return field.getSelected();
  }

  if (field instanceof PDFOptionList) {
    return field.getSelected();
  }

  return '';
}

function getFieldOptions(field: PDFField): string[] | undefined {
  if (
    field instanceof PDFRadioGroup ||
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList
  ) {
    return field.getOptions();
  }

  return undefined;
}

function getFieldPageNumbers(pdfDocument: PDFDocument, field: PDFField): number[] | undefined {
  const pagesByRef = new Map(
    pdfDocument.getPages().map((page, pageIndex) => [page.ref.toString(), pageIndex + 1]),
  );
  const pageNumbers = new Set<number>();
  const widgets = (field as FieldWithWidgets).acroField.getWidgets();

  for (const widget of widgets) {
    const pageRef = widget.P()?.toString();
    const pageNumber = pageRef ? pagesByRef.get(pageRef) : undefined;

    if (pageNumber) {
      pageNumbers.add(pageNumber);
    }
  }

  return pageNumbers.size ? Array.from(pageNumbers).sort((a, b) => a - b) : undefined;
}

function normalizeFormValue(value: unknown): PdfFormFieldValue {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function applyFieldValue(field: PDFField, value: PdfFormFieldValue): void {
  if (field instanceof PDFTextField) {
    field.setText(Array.isArray(value) ? value.join(', ') : String(value));
    return;
  }

  if (field instanceof PDFCheckBox) {
    if (value === true || value === 'true' || value === 'yes' || value === 'on') {
      field.check();
    } else {
      field.uncheck();
    }
    return;
  }

  if (field instanceof PDFRadioGroup) {
    const selectedValue = Array.isArray(value) ? value[0] : String(value);

    if (!selectedValue) {
      field.clear();
      return;
    }

    field.select(selectedValue);
    return;
  }

  if (field instanceof PDFDropdown) {
    const selectedValue = Array.isArray(value) ? value : String(value);

    if ((Array.isArray(selectedValue) && selectedValue.length === 0) || selectedValue === '') {
      field.clear();
      return;
    }

    field.select(selectedValue);
    return;
  }

  if (field instanceof PDFOptionList) {
    const selectedValues = Array.isArray(value) ? value : String(value) ? [String(value)] : [];

    if (selectedValues.length === 0) {
      field.clear();
      return;
    }

    field.select(selectedValues);
  }
}

export async function detectPdfFormFields(bytes: Uint8Array): Promise<PdfFormField[]> {
  const pdfDocument = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const form = pdfDocument.getForm();

  return form.getFields().map((field) => {
    const type = getFieldType(field);
    const name = field.getName();

    return {
      id: name,
      name,
      type,
      value: getFieldValue(field),
      multiline: field instanceof PDFTextField && field.isMultiline() ? true : undefined,
      options: getFieldOptions(field),
      pageNumbers: getFieldPageNumbers(pdfDocument, field),
      supported: isSupportedFieldType(type),
    };
  });
}

export function getResolvedFormFieldValue(
  workspace: PdfWorkspace,
  sourceDocumentId: string,
  field: PdfFormField,
): PdfFormFieldValue {
  return workspace.formFieldValues[sourceDocumentId]?.[field.name] ?? field.value;
}

export function createWorkspaceFormDataJson(workspace: PdfWorkspace): PdfFormDataJson {
  return {
    version: 1,
    documents: workspace.documents.map((document) => {
      const fields = Object.fromEntries(
        (document.formFields ?? []).map((field) => [
          field.name,
          getResolvedFormFieldValue(workspace, document.id, field),
        ]),
      );

      return {
        sourceDocumentId: document.id,
        fileName: document.fileName,
        fields,
      };
    }),
  };
}

export function parseFormDataJson(input: string): PdfFormDataJson {
  const parsed = JSON.parse(input) as Partial<PdfFormDataJson>;

  if (parsed.version !== 1 || !Array.isArray(parsed.documents)) {
    throw new Error('Unsupported form data JSON.');
  }

  return {
    version: 1,
    documents: parsed.documents.map((document) => ({
      sourceDocumentId: String(document.sourceDocumentId ?? ''),
      fileName: String(document.fileName ?? ''),
      fields: Object.fromEntries(
        Object.entries(document.fields ?? {}).map(([name, value]) => [
          name,
          normalizeFormValue(value),
        ]),
      ),
    })),
  };
}

export function mergeImportedFormData(
  workspace: PdfWorkspace,
  formData: PdfFormDataJson,
): PdfFormFieldValuesByDocument {
  const nextValues: PdfFormFieldValuesByDocument = { ...workspace.formFieldValues };

  for (const documentData of formData.documents) {
    const document = workspace.documents.find(
      (candidateDocument) =>
        candidateDocument.id === documentData.sourceDocumentId ||
        candidateDocument.fileName === documentData.fileName,
    );

    if (!document) {
      continue;
    }

    const editableFieldNames = new Set(
      (document.formFields ?? []).filter((field) => field.supported).map((field) => field.name),
    );
    const documentValues = { ...(nextValues[document.id] ?? {}) };

    for (const [fieldName, value] of Object.entries(documentData.fields)) {
      if (editableFieldNames.has(fieldName)) {
        documentValues[fieldName] = value;
      }
    }

    nextValues[document.id] = documentValues;
  }

  return nextValues;
}

export function getFormEditsForDocument(
  workspace: PdfWorkspace,
  sourceDocument: PdfDocumentSource,
): PdfFormFieldValuesByName {
  return workspace.formFieldValues[sourceDocument.id] ?? {};
}

export function hasFormExportWork(
  workspace: PdfWorkspace,
  sourceDocument: PdfDocumentSource,
): boolean {
  return (
    Object.keys(getFormEditsForDocument(workspace, sourceDocument)).length > 0 ||
    (workspace.formSettings.flattenOnExport && (sourceDocument.formFields?.length ?? 0) > 0)
  );
}

export function applyPdfFormValues(
  pdfDocument: PDFDocument,
  values: PdfFormFieldValuesByName,
  flatten: boolean,
): void {
  const form = pdfDocument.getForm();

  for (const [fieldName, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(fieldName);

    if (!field) {
      continue;
    }

    try {
      applyFieldValue(field, value);
    } catch {
      continue;
    }
  }

  if (flatten) {
    form.flatten({ updateFieldAppearances: true });
  } else if (Object.keys(values).length > 0) {
    form.updateFieldAppearances();
  }
}
