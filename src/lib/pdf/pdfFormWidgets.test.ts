import { describe, expect, it } from 'vitest';

import {
  mapWidgetAnnotationsToFormWidgets,
  type PdfFormWidgetRect,
  type PdfRawWidgetAnnotation,
} from './pdfFormWidgets';

function convertRect([x1, y1, x2, y2]: [number, number, number, number]): PdfFormWidgetRect {
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function createTextWidget(overrides: Partial<PdfRawWidgetAnnotation> = {}): PdfRawWidgetAnnotation {
  return {
    id: 'widget-1',
    fieldName: 'applicant.name',
    fieldType: 'Tx',
    fieldValue: 'Ada',
    rect: [10, 20, 110, 40],
    subtype: 'Widget',
    ...overrides,
  };
}

describe('mapWidgetAnnotationsToFormWidgets', () => {
  it('maps text widgets with position, value, and typing constraints', () => {
    const widgets = mapWidgetAnnotationsToFormWidgets(
      [
        createTextWidget({
          defaultAppearanceData: { fontSize: 14 },
          maxLen: 30,
          multiLine: true,
          textAlignment: 1,
        }),
      ],
      convertRect,
    );

    expect(widgets).toEqual([
      {
        id: 'widget-1',
        fieldName: 'applicant.name',
        kind: 'text',
        rect: { x: 10, y: 20, width: 100, height: 20 },
        defaultValue: 'Ada',
        fontSize: 14,
        maxLength: 30,
        multiLine: true,
        multiSelect: undefined,
        onValue: undefined,
        options: undefined,
        textAlignment: 'center',
      },
    ]);
  });

  it('maps checkbox and radio widgets with their on values', () => {
    const widgets = mapWidgetAnnotationsToFormWidgets(
      [
        createTextWidget({
          checkBox: true,
          exportValue: 'Yes',
          fieldName: 'agree',
          fieldType: 'Btn',
          fieldValue: 'Yes',
          id: 'check-1',
        }),
        createTextWidget({
          buttonValue: 'blue',
          fieldName: 'color',
          fieldType: 'Btn',
          fieldValue: 'red',
          id: 'radio-1',
          radioButton: true,
        }),
      ],
      convertRect,
    );

    expect(widgets[0]).toMatchObject({
      kind: 'checkbox',
      defaultValue: true,
      onValue: 'Yes',
    });
    expect(widgets[1]).toMatchObject({
      kind: 'radio',
      defaultValue: 'red',
      onValue: 'blue',
    });
  });

  it('maps choice widgets to dropdowns or option lists with options', () => {
    const widgets = mapWidgetAnnotationsToFormWidgets(
      [
        createTextWidget({
          combo: true,
          fieldName: 'country',
          fieldType: 'Ch',
          fieldValue: 'SG',
          id: 'combo-1',
          options: [{ displayValue: 'Singapore', exportValue: 'SG' }],
        }),
        createTextWidget({
          fieldName: 'toppings',
          fieldType: 'Ch',
          fieldValue: ['cheese'],
          id: 'list-1',
          multiSelect: true,
          options: [{ displayValue: 'Cheese', exportValue: 'cheese' }],
        }),
      ],
      convertRect,
    );

    expect(widgets[0]).toMatchObject({
      kind: 'dropdown',
      defaultValue: 'SG',
      options: [{ label: 'Singapore', value: 'SG' }],
    });
    expect(widgets[1]).toMatchObject({
      kind: 'option-list',
      defaultValue: ['cheese'],
      multiSelect: true,
    });
  });

  it('skips widgets that pdf.js keeps on the canvas or cannot be edited', () => {
    const widgets = mapWidgetAnnotationsToFormWidgets(
      [
        createTextWidget({ hidden: true, id: 'hidden' }),
        createTextWidget({ hasOwnCanvas: true, id: 'own-canvas' }),
        createTextWidget({ noHTML: true, id: 'no-html' }),
        createTextWidget({ readOnly: true, id: 'read-only' }),
        createTextWidget({ fieldType: 'Sig', id: 'signature' }),
        createTextWidget({ fieldType: 'Btn', id: 'push-button', pushButton: true }),
        createTextWidget({ fieldName: undefined, id: 'unnamed' }),
        createTextWidget({ id: 'zero-size', rect: [10, 20, 10, 20] }),
        { subtype: 'Link' },
        'not-an-annotation',
      ],
      convertRect,
    );

    expect(widgets).toEqual([]);
  });

  it('falls back to safe defaults for missing metadata', () => {
    const widgets = mapWidgetAnnotationsToFormWidgets(
      [createTextWidget({ fieldValue: null, id: undefined, textAlignment: null })],
      convertRect,
    );

    expect(widgets[0]).toMatchObject({
      id: 'applicant.name:0',
      defaultValue: '',
      textAlignment: 'left',
    });
  });
});
