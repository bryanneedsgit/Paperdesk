import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { getPdfPageFormWidgets } from '../../lib/pdf/pdfRenderer';
import { logDeveloperError } from '../../lib/utils/errors';
import type { PdfFormWidget } from '../../lib/pdf/pdfFormWidgets';
import type {
  PdfDocumentSource,
  PdfFormField,
  PdfFormFieldValue,
  PdfFormFieldValuesByName,
  PdfPageItem,
} from '../../lib/pdf/types';

type FormFieldLayerProps = {
  disabled: boolean;
  onChangeFieldValue: (fieldName: string, value: PdfFormFieldValue) => void;
  page: PdfPageItem;
  scale: number;
  sourceDocument: PdfDocumentSource;
  values: PdfFormFieldValuesByName;
};

const minAutoFontSize = 7;
const multiLineFontSize = 11;

function getWidgetStyle(widget: PdfFormWidget, scale: number): CSSProperties {
  return {
    height: `${widget.rect.height * scale}px`,
    left: `${widget.rect.x * scale}px`,
    top: `${widget.rect.y * scale}px`,
    width: `${widget.rect.width * scale}px`,
  };
}

function getTextFontSize(widget: PdfFormWidget, scale: number): number {
  const autoSize = widget.multiLine
    ? multiLineFontSize
    : Math.max(minAutoFontSize, widget.rect.height * 0.62);
  // Auto-sized fields can carry a font size computed for their previous
  // (often empty) appearance; ignore sizes that cannot fit a line of text.
  const maxUsableSize = widget.multiLine ? widget.rect.height / 2 : widget.rect.height * 0.85;
  const declaredSize =
    widget.fontSize && widget.fontSize > 0 && widget.fontSize <= maxUsableSize
      ? widget.fontSize
      : autoSize;

  return declaredSize * scale;
}

function getStringValue(value: PdfFormFieldValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return typeof value === 'boolean' ? '' : value;
}

function getArrayValue(value: PdfFormFieldValue): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === 'string' && value ? [value] : [];
}

// pdf.js reports a radio widget's appearance-state name, which for /Opt-based
// radio groups is an index ('0', '1', …) rather than the option string that
// pdf-lib selects by. Map index-style on values back to the option string so
// on-page clicks stay compatible with the Forms panel and the export pipeline.
function getRadioOnValue(
  widget: PdfFormWidget,
  field: PdfFormField | undefined,
): string | undefined {
  const options = field?.options;

  if (widget.onValue === undefined || !options?.length || options.includes(widget.onValue)) {
    return widget.onValue;
  }

  const optionIndex = Number(widget.onValue);

  if (Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < options.length) {
    return options[optionIndex];
  }

  return widget.onValue;
}

function FormWidgetControl({
  field,
  onChangeFieldValue,
  scale,
  value,
  widget,
}: {
  field: PdfFormField | undefined;
  onChangeFieldValue: FormFieldLayerProps['onChangeFieldValue'];
  scale: number;
  value: PdfFormFieldValue;
  widget: PdfFormWidget;
}) {
  const style = getWidgetStyle(widget, scale);
  const label = field?.name ?? widget.fieldName;

  if (widget.kind === 'text') {
    const textStyle: CSSProperties = {
      ...style,
      fontSize: `${getTextFontSize(widget, scale)}px`,
      textAlign: widget.textAlignment,
    };

    if (widget.multiLine) {
      return (
        <textarea
          aria-label={label}
          className="pdf-form-field pdf-form-text pdf-form-text-multiline"
          maxLength={widget.maxLength}
          onChange={(event) => onChangeFieldValue(widget.fieldName, event.target.value)}
          style={textStyle}
          value={getStringValue(value)}
        />
      );
    }

    return (
      <input
        aria-label={label}
        className="pdf-form-field pdf-form-text"
        maxLength={widget.maxLength}
        onChange={(event) => onChangeFieldValue(widget.fieldName, event.target.value)}
        style={textStyle}
        type="text"
        value={getStringValue(value)}
      />
    );
  }

  if (widget.kind === 'checkbox') {
    const isChecked = value === true;

    return (
      <button
        aria-checked={isChecked}
        aria-label={label}
        className="pdf-form-field pdf-form-checkbox"
        data-checked={isChecked ? 'true' : undefined}
        onClick={() => onChangeFieldValue(widget.fieldName, !isChecked)}
        role="checkbox"
        style={style}
        type="button"
      >
        {isChecked ? (
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path
              d="M3 8.5 6.5 12 13 4.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.4"
            />
          </svg>
        ) : null}
      </button>
    );
  }

  if (widget.kind === 'radio') {
    const onValue = getRadioOnValue(widget, field);
    const isChecked = onValue !== undefined && getStringValue(value) === onValue;

    return (
      <button
        aria-checked={isChecked}
        aria-label={`${label}: ${onValue ?? ''}`}
        className="pdf-form-field pdf-form-radio"
        data-checked={isChecked ? 'true' : undefined}
        onClick={() => {
          if (onValue !== undefined) {
            onChangeFieldValue(widget.fieldName, onValue);
          }
        }}
        role="radio"
        style={style}
        type="button"
      >
        {isChecked ? <span aria-hidden="true" className="pdf-form-radio-dot" /> : null}
      </button>
    );
  }

  // Prefer pdf-lib's option strings so on-page edits stay consistent with the
  // Forms panel and the export pipeline, which both select by those strings.
  const options =
    field?.options?.map((option) => ({ label: option, value: option })) ?? widget.options ?? [];
  const fontSize = `${Math.max(
    minAutoFontSize * scale,
    Math.min(12 * scale, widget.rect.height * scale * 0.55),
  )}px`;

  if (widget.kind === 'dropdown') {
    return (
      <select
        aria-label={label}
        className="pdf-form-field pdf-form-select"
        onChange={(event) => onChangeFieldValue(widget.fieldName, event.target.value)}
        style={{ ...style, fontSize }}
        value={getStringValue(value)}
      >
        <option value="">&nbsp;</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const selectedValues = getArrayValue(value);

  return (
    <select
      aria-label={label}
      className="pdf-form-field pdf-form-select pdf-form-option-list"
      multiple
      onChange={(event) =>
        onChangeFieldValue(
          widget.fieldName,
          Array.from(event.target.selectedOptions, (option) => option.value),
        )
      }
      style={{ ...style, fontSize }}
      value={selectedValues}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function FormFieldLayer({
  disabled,
  onChangeFieldValue,
  page,
  scale,
  sourceDocument,
  values,
}: FormFieldLayerProps) {
  const [widgets, setWidgets] = useState<PdfFormWidget[]>([]);

  useEffect(() => {
    let isStale = false;

    getPdfPageFormWidgets(sourceDocument, page)
      .then((pageWidgets) => {
        if (!isStale) {
          setWidgets(pageWidgets);
        }
      })
      .catch((error) => {
        logDeveloperError('Unable to load PDF form widgets.', error);

        if (!isStale) {
          setWidgets([]);
        }
      });

    return () => {
      isStale = true;
    };
  }, [page, sourceDocument]);

  const fieldsByName = useMemo(() => {
    return new Map((sourceDocument.formFields ?? []).map((field) => [field.name, field]));
  }, [sourceDocument.formFields]);

  if (widgets.length === 0) {
    return null;
  }

  return (
    <div className="pdf-form-layer" data-disabled={disabled ? 'true' : undefined}>
      {widgets.map((widget) => {
        const field = fieldsByName.get(widget.fieldName);
        const value = values[widget.fieldName] ?? field?.value ?? widget.defaultValue;

        return (
          <FormWidgetControl
            field={field}
            key={widget.id}
            onChangeFieldValue={onChangeFieldValue}
            scale={scale}
            value={value}
            widget={widget}
          />
        );
      })}
    </div>
  );
}
