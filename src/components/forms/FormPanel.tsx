import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { Download, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  createWorkspaceFormDataJson,
  getResolvedFormFieldValue,
  parseFormDataJson,
  type PdfFormDataJson,
} from '../../lib/pdf/pdfForms';
import { logDeveloperError } from '../../lib/utils/errors';
import type {
  PdfDocumentSource,
  PdfFormField,
  PdfFormFieldValue,
  PdfFormSettings,
  PdfWorkspace,
} from '../../lib/pdf/types';

type FormPanelProps = {
  onChangeFieldValue: (
    sourceDocumentId: string,
    fieldName: string,
    value: PdfFormFieldValue,
  ) => void;
  onChangeFormSettings: (settings: Partial<PdfFormSettings>) => void;
  onImportFormData: (formData: PdfFormDataJson) => void;
  workspace: PdfWorkspace | null;
};

type FieldRowProps = {
  document: PdfDocumentSource;
  field: PdfFormField;
  onChangeFieldValue: FormPanelProps['onChangeFieldValue'];
  value: PdfFormFieldValue;
};

const jsonFileFilters = [{ name: 'JSON', extensions: ['json'] }];

function formatFieldType(field: PdfFormField): string {
  return field.type
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function formatFieldValue(value: PdfFormFieldValue): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'boolean') {
    return value ? 'Checked' : 'Unchecked';
  }

  return value || 'Blank';
}

function getStringValue(value: PdfFormFieldValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return typeof value === 'boolean' ? String(value) : value;
}

function getArrayValue(value: PdfFormFieldValue): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === 'string' && value ? [value] : [];
}

async function exportFormData(workspace: PdfWorkspace): Promise<void> {
  const filePath = await save({
    canCreateDirectories: true,
    defaultPath: 'paperdesk-form-data.json',
    filters: jsonFileFilters,
    title: 'Export Form Data',
  });

  if (!filePath) {
    return;
  }

  const outputPath = filePath.toLowerCase().endsWith('.json') ? filePath : `${filePath}.json`;
  const json = JSON.stringify(createWorkspaceFormDataJson(workspace), null, 2);

  await writeFile(outputPath, new TextEncoder().encode(json));
}

async function importFormData(): Promise<PdfFormDataJson | null> {
  const selectedPath = await open({
    multiple: false,
    filters: jsonFileFilters,
    title: 'Import Form Data',
  });

  if (typeof selectedPath !== 'string') {
    return null;
  }

  const bytes = await readFile(selectedPath);
  const json = new TextDecoder().decode(bytes);

  return parseFormDataJson(json);
}

function FieldEditor({ document, field, onChangeFieldValue, value }: FieldRowProps) {
  if (!field.supported) {
    return <span className="form-field-unsupported">Editing unsupported</span>;
  }

  if (field.type === 'checkbox') {
    return (
      <label className="form-checkbox-control">
        <input
          checked={!!value}
          onChange={(event) => onChangeFieldValue(document.id, field.name, event.target.checked)}
          type="checkbox"
        />
        <span>{value ? 'Checked' : 'Unchecked'}</span>
      </label>
    );
  }

  if (field.type === 'radio') {
    return (
      <select
        onChange={(event) => onChangeFieldValue(document.id, field.name, event.target.value)}
        value={getStringValue(value)}
      >
        <option value="">No selection</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'option-list' && field.options?.length) {
    return (
      <select
        multiple
        onChange={(event) =>
          onChangeFieldValue(
            document.id,
            field.name,
            Array.from(event.target.selectedOptions, (option) => option.value),
          )
        }
        size={Math.min(4, field.options.length)}
        value={getArrayValue(value)}
      >
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'dropdown' && field.options?.length) {
    return (
      <select
        onChange={(event) => onChangeFieldValue(document.id, field.name, event.target.value)}
        value={getStringValue(value)}
      >
        <option value="">No selection</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.multiline) {
    return (
      <textarea
        onChange={(event) => onChangeFieldValue(document.id, field.name, event.target.value)}
        rows={3}
        value={getStringValue(value)}
      />
    );
  }

  return (
    <input
      onChange={(event) => onChangeFieldValue(document.id, field.name, event.target.value)}
      type="text"
      value={getStringValue(value)}
    />
  );
}

function FormFieldRow({ document, field, onChangeFieldValue, value }: FieldRowProps) {
  return (
    <div className="form-field-row">
      <div className="form-field-heading">
        <span className="form-field-name" title={field.name}>
          {field.name}
        </span>
        <span className="form-field-type">{formatFieldType(field)}</span>
      </div>
      <div className="form-field-meta">
        <span title={document.fileName}>{document.fileName}</span>
        <span>
          {field.pageNumbers?.length ? `Page ${field.pageNumbers.join(', ')}` : 'Page unknown'}
        </span>
      </div>
      <div className="form-field-current">Current value: {formatFieldValue(value)}</div>
      <FieldEditor
        document={document}
        field={field}
        onChangeFieldValue={onChangeFieldValue}
        value={value}
      />
    </div>
  );
}

export function FormPanel({
  onChangeFieldValue,
  onChangeFormSettings,
  onImportFormData,
  workspace,
}: FormPanelProps) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fieldsByDocument = useMemo(() => {
    return (
      workspace?.documents
        .map((document) => ({
          document,
          fields: document.formFields ?? [],
        }))
        .filter(({ fields }) => fields.length > 0) ?? []
    );
  }, [workspace?.documents]);
  const fieldCount = fieldsByDocument.reduce((count, { fields }) => count + fields.length, 0);
  const unsupportedFieldCount = fieldsByDocument.reduce(
    (count, { fields }) => count + fields.filter((field) => !field.supported).length,
    0,
  );

  const handleExportFormData = async () => {
    if (!workspace) {
      return;
    }

    try {
      await exportFormData(workspace);
      setStatusMessage('Exported form data JSON.');
    } catch (error) {
      logDeveloperError('Form data export failed.', error);
      setStatusMessage('Could not export form data JSON. Choose a different save location.');
    }
  };

  const handleImportFormData = async () => {
    try {
      const formData = await importFormData();

      if (!formData) {
        return;
      }

      onImportFormData(formData);
      setStatusMessage('Imported form data JSON.');
    } catch (error) {
      logDeveloperError('Form data import failed.', error);
      setStatusMessage('Could not import form data JSON. Check that the file is valid JSON.');
    }
  };

  if (!workspace) {
    return (
      <div className="tool-stack">
        <section className="tool-section">
          <h3>Form Fields</h3>
          <p className="tool-empty-copy">Open a PDF to inspect fillable form fields.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="tool-stack form-panel">
      <section className="tool-section">
        <h3>Form Fields</h3>
        <p className="form-panel-hint">
          Fillable fields are highlighted on the page — click one to type or toggle it directly.
          This panel mirrors those values for review and bulk edits.
        </p>
        <label className="formatter-check">
          <input
            checked={workspace.formSettings.flattenOnExport}
            onChange={(event) => onChangeFormSettings({ flattenOnExport: event.target.checked })}
            type="checkbox"
          />
          <span>Flatten forms on export</span>
        </label>
        <div className="formatter-button-row">
          <button
            className="secondary-action-button"
            disabled={fieldCount === 0}
            onClick={handleExportFormData}
            type="button"
          >
            <Download size={15} />
            <span>Export JSON</span>
          </button>
          <button
            className="secondary-action-button"
            disabled={fieldCount === 0}
            onClick={handleImportFormData}
            type="button"
          >
            <Upload size={15} />
            <span>Import JSON</span>
          </button>
        </div>
        {unsupportedFieldCount > 0 ? (
          <p className="form-panel-status">
            {unsupportedFieldCount} unsupported form{' '}
            {unsupportedFieldCount === 1 ? 'field' : 'fields'} will be left unchanged.
          </p>
        ) : null}
        {statusMessage ? <p className="form-panel-status">{statusMessage}</p> : null}
      </section>

      {fieldCount === 0 ? (
        <p className="form-empty-message">
          No fillable form fields detected. Scanned forms are not supported yet.
        </p>
      ) : (
        fieldsByDocument.map(({ document, fields }) => (
          <section className="tool-section form-document-section" key={document.id}>
            <h3>{document.fileName}</h3>
            <div className="form-field-list">
              {fields.map((field) => (
                <FormFieldRow
                  document={document}
                  field={field}
                  key={`${document.id}:${field.name}`}
                  onChangeFieldValue={onChangeFieldValue}
                  value={getResolvedFormFieldValue(workspace, document.id, field)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
