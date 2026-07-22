import { describe, expect, it } from 'vitest';

import {
  defaultAnnotationColor,
  defaultTextAnnotationColor,
  getAnnotationBorderColor,
  getAnnotationColor,
  getAnnotationFillColor,
  normalizeAnnotationPaintColor,
  transparentAnnotationColor,
  normalizeAnnotationColor,
} from './annotationColors';

describe('annotation colors', () => {
  it('normalizes valid hex colors', () => {
    expect(normalizeAnnotationColor('#ABC123')).toBe('#abc123');
  });

  it('falls back for invalid colors', () => {
    expect(normalizeAnnotationColor('red')).toBe(defaultAnnotationColor);
  });

  it('uses type defaults when annotations do not have stored colors', () => {
    expect(getAnnotationColor({ type: 'rectangle' })).toBe('#d9480f');
  });

  it('defaults text annotations to black and highlights to yellow', () => {
    expect(getAnnotationColor({ type: 'free-text' })).toBe(defaultTextAnnotationColor);
    expect(getAnnotationColor({ type: 'text-edit' })).toBe(defaultTextAnnotationColor);
    expect(getAnnotationColor({ type: 'text-note' })).toBe(defaultTextAnnotationColor);
    expect(getAnnotationColor({ type: 'highlight' })).toBe(defaultAnnotationColor);
  });

  it('normalizes transparent paint colors', () => {
    expect(normalizeAnnotationPaintColor(transparentAnnotationColor, '#ffffff')).toBe(
      transparentAnnotationColor,
    );
  });

  it('uses independent text box fill and border defaults', () => {
    expect(getAnnotationFillColor({ type: 'free-text' })).toBe('#ffffff');
    expect(getAnnotationBorderColor({ type: 'free-text' })).toBe('#28666e');
    expect(getAnnotationFillColor({ type: 'text-note' })).toBe('#fff3bf');
  });
});
