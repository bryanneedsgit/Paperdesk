import type { PdfFormFieldValue } from './types';

export type PdfFormWidgetKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'option-list';

export type PdfFormWidgetRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type PdfFormWidgetOption = {
  label: string;
  value: string;
};

export type PdfFormWidget = {
  id: string;
  fieldName: string;
  kind: PdfFormWidgetKind;
  rect: PdfFormWidgetRect;
  defaultValue: PdfFormFieldValue;
  fontSize?: number;
  maxLength?: number;
  multiLine?: boolean;
  multiSelect?: boolean;
  onValue?: string;
  options?: PdfFormWidgetOption[];
  textAlignment: 'center' | 'left' | 'right';
};

export type PdfRawWidgetAnnotation = {
  buttonValue?: string | null;
  checkBox?: boolean;
  combo?: boolean;
  defaultAppearanceData?: { fontSize?: number };
  exportValue?: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: unknown;
  hasOwnCanvas?: boolean;
  hidden?: boolean;
  id?: string;
  maxLen?: number | null;
  multiLine?: boolean;
  multiSelect?: boolean;
  noHTML?: boolean;
  options?: Array<{ displayValue?: string; exportValue?: string }>;
  pushButton?: boolean;
  radioButton?: boolean;
  readOnly?: boolean;
  rect?: number[];
  subtype?: string;
  textAlignment?: number | null;
};

const textAlignments = ['left', 'center', 'right'] as const;

function isRawWidgetAnnotation(annotation: unknown): annotation is PdfRawWidgetAnnotation {
  return (
    typeof annotation === 'object' &&
    annotation !== null &&
    'subtype' in annotation &&
    (annotation as PdfRawWidgetAnnotation).subtype === 'Widget'
  );
}

function getWidgetKind(annotation: PdfRawWidgetAnnotation): PdfFormWidgetKind | null {
  if (annotation.fieldType === 'Tx') {
    return 'text';
  }

  if (annotation.fieldType === 'Btn') {
    if (annotation.checkBox) {
      return 'checkbox';
    }

    if (annotation.radioButton) {
      return 'radio';
    }

    return null;
  }

  if (annotation.fieldType === 'Ch') {
    return annotation.combo ? 'dropdown' : 'option-list';
  }

  return null;
}

function getWidgetDefaultValue(
  kind: PdfFormWidgetKind,
  annotation: PdfRawWidgetAnnotation,
): PdfFormFieldValue {
  if (kind === 'checkbox') {
    return annotation.fieldValue === (annotation.exportValue ?? 'On');
  }

  if (Array.isArray(annotation.fieldValue)) {
    return annotation.fieldValue.map((value) => String(value));
  }

  return annotation.fieldValue === null || annotation.fieldValue === undefined
    ? ''
    : String(annotation.fieldValue);
}

function getWidgetOptions(annotation: PdfRawWidgetAnnotation): PdfFormWidgetOption[] | undefined {
  if (!Array.isArray(annotation.options)) {
    return undefined;
  }

  return annotation.options.map((option) => {
    const value = option.exportValue ?? option.displayValue ?? '';

    return {
      label: option.displayValue || value,
      value,
    };
  });
}

/**
 * Maps raw pdf.js widget annotations to positioned, interactive form widgets.
 *
 * Widgets that pdf.js keeps on the canvas in ENABLE_FORMS mode (signatures,
 * push buttons, read-only fields, hidden fields) are excluded — the canvas
 * still shows their appearance, so overlaying them would double-render.
 */
export function mapWidgetAnnotationsToFormWidgets(
  annotations: unknown[],
  convertRectToPageSpace: (rect: [number, number, number, number]) => PdfFormWidgetRect,
): PdfFormWidget[] {
  const widgets: PdfFormWidget[] = [];

  for (const annotation of annotations) {
    if (!isRawWidgetAnnotation(annotation)) {
      continue;
    }

    if (
      annotation.hidden ||
      annotation.noHTML ||
      annotation.hasOwnCanvas ||
      annotation.readOnly ||
      !annotation.fieldName ||
      !Array.isArray(annotation.rect) ||
      annotation.rect.length < 4
    ) {
      continue;
    }

    const kind = getWidgetKind(annotation);

    if (!kind) {
      continue;
    }

    const rect = convertRectToPageSpace([
      annotation.rect[0],
      annotation.rect[1],
      annotation.rect[2],
      annotation.rect[3],
    ]);

    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    widgets.push({
      id: annotation.id ?? `${annotation.fieldName}:${widgets.length}`,
      fieldName: annotation.fieldName,
      kind,
      rect,
      defaultValue: getWidgetDefaultValue(kind, annotation),
      fontSize: annotation.defaultAppearanceData?.fontSize || undefined,
      maxLength:
        typeof annotation.maxLen === 'number' && annotation.maxLen > 0
          ? annotation.maxLen
          : undefined,
      multiLine: annotation.multiLine || undefined,
      multiSelect: annotation.multiSelect || undefined,
      onValue:
        kind === 'radio'
          ? (annotation.buttonValue ?? undefined)
          : kind === 'checkbox'
            ? (annotation.exportValue ?? undefined)
            : undefined,
      options:
        kind === 'dropdown' || kind === 'option-list' ? getWidgetOptions(annotation) : undefined,
      textAlignment: textAlignments[annotation.textAlignment ?? 0] ?? 'left',
    });
  }

  return widgets;
}
