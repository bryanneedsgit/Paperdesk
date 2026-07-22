import { describe, expect, it } from 'vitest';

import {
  annotationFontFamilies,
  getAnnotationFontCssFamily,
  getAnnotationFontOption,
  getBundledFontUrlForVariant,
  getStandardFontForVariant,
  normalizeAnnotationFontSize,
  recognizePdfFontName,
  stripFontSubsetPrefix,
} from './annotationFonts';

describe('font registry', () => {
  it('provides a usable option for unknown or missing font ids', () => {
    expect(getAnnotationFontOption(undefined).id).toBe('helvetica');
    expect(getAnnotationFontOption('not-a-font').id).toBe('helvetica');
  });

  it('resolves standard font variants for bold and italic combinations', () => {
    const times = getAnnotationFontOption('times-roman');

    expect(getStandardFontForVariant(times, {})).toBe('Times-Roman');
    expect(getStandardFontForVariant(times, { bold: true })).toBe('Times-Bold');
    expect(getStandardFontForVariant(times, { italic: true })).toBe('Times-Italic');
    expect(getStandardFontForVariant(times, { bold: true, italic: true })).toBe('Times-BoldItalic');
  });

  it('resolves bundled font files for every variant of every bundled family', () => {
    for (const option of annotationFontFamilies.filter((family) => family.kind === 'bundled')) {
      expect(getBundledFontUrlForVariant(option, {})).toBeTruthy();
      expect(getBundledFontUrlForVariant(option, { bold: true })).toBeTruthy();
      expect(getBundledFontUrlForVariant(option, { italic: true })).toBeTruthy();
      expect(getBundledFontUrlForVariant(option, { bold: true, italic: true })).toBeTruthy();
    }
  });

  it('never renders annotation text with charcode-mapped embedded document fonts', () => {
    const css = getAnnotationFontCssFamily({
      fontId: 'liberation-serif',
      embeddedFontName: 'g_d0_f3',
    });

    expect(css).not.toContain('g_d0_f3');
    expect(css).toContain('Liberation Serif');
  });

  it('clamps annotation font sizes to a sane range', () => {
    expect(normalizeAnnotationFontSize(undefined)).toBe(14);
    expect(normalizeAnnotationFontSize(Number.NaN)).toBe(14);
    expect(normalizeAnnotationFontSize(1)).toBe(6);
    expect(normalizeAnnotationFontSize(500)).toBe(96);
    expect(normalizeAnnotationFontSize(11.25)).toBe(11.3);
  });
});

describe('font recognizer', () => {
  it('strips PDF subset prefixes', () => {
    expect(stripFontSubsetPrefix('ABCDEF+Arial-BoldMT')).toBe('Arial-BoldMT');
    expect(stripFontSubsetPrefix('Arial-BoldMT')).toBe('Arial-BoldMT');
  });

  it('recognizes common document fonts with weight and style', () => {
    expect(recognizePdfFontName('ABCDEF+Arial-BoldMT')).toEqual({
      fontId: 'liberation-sans',
      bold: true,
      italic: false,
      matched: true,
    });
    expect(recognizePdfFontName('TimesNewRomanPS-BoldItalicMT')).toEqual({
      fontId: 'liberation-serif',
      bold: true,
      italic: true,
      matched: true,
    });
    expect(recognizePdfFontName('Calibri-Italic')).toEqual({
      fontId: 'carlito',
      bold: false,
      italic: true,
      matched: true,
    });
    expect(recognizePdfFontName('CourierNewPSMT')).toEqual({
      fontId: 'liberation-mono',
      bold: false,
      italic: false,
      matched: true,
    });
    expect(recognizePdfFontName('GHIJKL+Cambria-Bold')).toEqual({
      fontId: 'caladea',
      bold: true,
      italic: false,
      matched: true,
    });
  });

  it('matches bare standard names before generic fallbacks', () => {
    expect(recognizePdfFontName('Times-Roman').fontId).toBe('times-roman');
    expect(recognizePdfFontName('Courier-Oblique')).toMatchObject({
      fontId: 'courier',
      italic: true,
    });
    expect(recognizePdfFontName('Helvetica').fontId).toBe('helvetica');
  });

  it('falls back to the generic family reported by pdf.js when the name is unknown', () => {
    expect(recognizePdfFontName('XYZABC+MysteryFont', 'serif')).toEqual({
      fontId: 'liberation-serif',
      bold: false,
      italic: false,
      matched: false,
    });
    expect(recognizePdfFontName('MysterySans', 'sans-serif').fontId).toBe('liberation-sans');
    expect(recognizePdfFontName('MysteryMono', 'monospace').fontId).toBe('liberation-mono');
    expect(recognizePdfFontName(undefined, undefined).fontId).toBe('helvetica');
    expect(recognizePdfFontName(undefined, undefined).matched).toBe(false);
  });
});
