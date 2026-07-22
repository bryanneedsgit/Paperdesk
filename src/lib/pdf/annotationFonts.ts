import { StandardFonts } from 'pdf-lib';

import caladeaBold from '../../assets/fonts/Caladea-Bold.ttf?url';
import caladeaBoldItalic from '../../assets/fonts/Caladea-BoldItalic.ttf?url';
import caladeaItalic from '../../assets/fonts/Caladea-Italic.ttf?url';
import caladeaRegular from '../../assets/fonts/Caladea-Regular.ttf?url';
import carlitoBold from '../../assets/fonts/Carlito-Bold.ttf?url';
import carlitoBoldItalic from '../../assets/fonts/Carlito-BoldItalic.ttf?url';
import carlitoItalic from '../../assets/fonts/Carlito-Italic.ttf?url';
import carlitoRegular from '../../assets/fonts/Carlito-Regular.ttf?url';
import liberationMonoBold from '../../assets/fonts/LiberationMono-Bold.ttf?url';
import liberationMonoBoldItalic from '../../assets/fonts/LiberationMono-BoldItalic.ttf?url';
import liberationMonoItalic from '../../assets/fonts/LiberationMono-Italic.ttf?url';
import liberationMonoRegular from '../../assets/fonts/LiberationMono-Regular.ttf?url';
import liberationSansBold from '../../assets/fonts/LiberationSans-Bold.ttf?url';
import liberationSansBoldItalic from '../../assets/fonts/LiberationSans-BoldItalic.ttf?url';
import liberationSansItalic from '../../assets/fonts/LiberationSans-Italic.ttf?url';
import liberationSansRegular from '../../assets/fonts/LiberationSans-Regular.ttf?url';
import liberationSerifBold from '../../assets/fonts/LiberationSerif-Bold.ttf?url';
import liberationSerifBoldItalic from '../../assets/fonts/LiberationSerif-BoldItalic.ttf?url';
import liberationSerifItalic from '../../assets/fonts/LiberationSerif-Italic.ttf?url';
import liberationSerifRegular from '../../assets/fonts/LiberationSerif-Regular.ttf?url';

import type { PdfFormatterFont } from './types';

// One family list serves annotation text, the formatter, and export.
export type PdfFontFamilyId = PdfFormatterFont;

export type PdfFontVariantFiles = {
  bold: string;
  boldItalic: string;
  italic: string;
  regular: string;
};

export type PdfFontStandardNames = {
  bold: StandardFonts;
  boldItalic: StandardFonts;
  italic: StandardFonts;
  regular: StandardFonts;
};

export type PdfFontFamilyOption = {
  cssFamily: string;
  detail?: string;
  fileUrls?: PdfFontVariantFiles;
  id: PdfFontFamilyId;
  kind: 'standard' | 'bundled';
  label: string;
  standardNames?: PdfFontStandardNames;
};

export const annotationFontFamilies: PdfFontFamilyOption[] = [
  {
    id: 'helvetica',
    label: 'Helvetica',
    detail: 'PDF standard',
    kind: 'standard',
    cssFamily: "Helvetica, 'Liberation Sans', Arial, sans-serif",
    standardNames: {
      regular: StandardFonts.Helvetica,
      bold: StandardFonts.HelveticaBold,
      italic: StandardFonts.HelveticaOblique,
      boldItalic: StandardFonts.HelveticaBoldOblique,
    },
  },
  {
    id: 'times-roman',
    label: 'Times',
    detail: 'PDF standard',
    kind: 'standard',
    cssFamily: "'Times New Roman', 'Liberation Serif', Times, serif",
    standardNames: {
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    },
  },
  {
    id: 'courier',
    label: 'Courier',
    detail: 'PDF standard',
    kind: 'standard',
    cssFamily: "'Courier New', 'Liberation Mono', Courier, monospace",
    standardNames: {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    },
  },
  {
    id: 'liberation-sans',
    label: 'Liberation Sans',
    detail: 'Arial-compatible',
    kind: 'bundled',
    cssFamily: "'Liberation Sans', Arial, sans-serif",
    fileUrls: {
      regular: liberationSansRegular,
      bold: liberationSansBold,
      italic: liberationSansItalic,
      boldItalic: liberationSansBoldItalic,
    },
  },
  {
    id: 'liberation-serif',
    label: 'Liberation Serif',
    detail: 'Times New Roman–compatible',
    kind: 'bundled',
    cssFamily: "'Liberation Serif', 'Times New Roman', serif",
    fileUrls: {
      regular: liberationSerifRegular,
      bold: liberationSerifBold,
      italic: liberationSerifItalic,
      boldItalic: liberationSerifBoldItalic,
    },
  },
  {
    id: 'liberation-mono',
    label: 'Liberation Mono',
    detail: 'Courier New–compatible',
    kind: 'bundled',
    cssFamily: "'Liberation Mono', 'Courier New', monospace",
    fileUrls: {
      regular: liberationMonoRegular,
      bold: liberationMonoBold,
      italic: liberationMonoItalic,
      boldItalic: liberationMonoBoldItalic,
    },
  },
  {
    id: 'carlito',
    label: 'Carlito',
    detail: 'Calibri-compatible',
    kind: 'bundled',
    cssFamily: 'Carlito, Calibri, sans-serif',
    fileUrls: {
      regular: carlitoRegular,
      bold: carlitoBold,
      italic: carlitoItalic,
      boldItalic: carlitoBoldItalic,
    },
  },
  {
    id: 'caladea',
    label: 'Caladea',
    detail: 'Cambria-compatible',
    kind: 'bundled',
    cssFamily: 'Caladea, Cambria, Georgia, serif',
    fileUrls: {
      regular: caladeaRegular,
      bold: caladeaBold,
      italic: caladeaItalic,
      boldItalic: caladeaBoldItalic,
    },
  },
];

export const defaultAnnotationFontId: PdfFontFamilyId = 'helvetica';
export const defaultAnnotationFontSize = 14;
export const minAnnotationFontSize = 6;
export const maxAnnotationFontSize = 96;

export function getAnnotationFontOption(fontId?: string): PdfFontFamilyOption {
  return (
    annotationFontFamilies.find((option) => option.id === fontId) ??
    annotationFontFamilies.find((option) => option.id === defaultAnnotationFontId) ??
    annotationFontFamilies[0]
  );
}

export function normalizeAnnotationFontSize(size: number | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return defaultAnnotationFontSize;
  }

  return Math.min(
    maxAnnotationFontSize,
    Math.max(minAnnotationFontSize, Math.round(size * 10) / 10),
  );
}

export type AnnotationFontStyle = {
  embeddedFontName?: string;
  fontBold?: boolean;
  fontId?: string;
  fontItalic?: boolean;
};

// Embedded document fonts loaded by pdf.js (e.g. "g_d0_f1") map glyphs by the
// PDF's internal charcodes rather than Unicode, so rendering annotation text
// with them turns letters into arbitrary symbols. Annotations therefore render
// with the recognized replacement family, which is also what export embeds.
export function getAnnotationFontCssFamily(style: AnnotationFontStyle): string {
  return getAnnotationFontOption(style.fontId).cssFamily;
}

type FontVariantSelection = { bold?: boolean; italic?: boolean };

export function getStandardFontForVariant(
  option: PdfFontFamilyOption,
  variant: FontVariantSelection,
): StandardFonts | null {
  if (!option.standardNames) {
    return null;
  }

  if (variant.bold && variant.italic) {
    return option.standardNames.boldItalic;
  }

  if (variant.bold) {
    return option.standardNames.bold;
  }

  if (variant.italic) {
    return option.standardNames.italic;
  }

  return option.standardNames.regular;
}

export function getBundledFontUrlForVariant(
  option: PdfFontFamilyOption,
  variant: FontVariantSelection,
): string | null {
  if (!option.fileUrls) {
    return null;
  }

  if (variant.bold && variant.italic) {
    return option.fileUrls.boldItalic;
  }

  if (variant.bold) {
    return option.fileUrls.bold;
  }

  if (variant.italic) {
    return option.fileUrls.italic;
  }

  return option.fileUrls.regular;
}

export type RecognizedPdfFont = {
  bold: boolean;
  fontId: PdfFontFamilyId;
  italic: boolean;
  matched: boolean;
};

// Ordered: specific family names must match before their generic substrings
// ("timesnewroman" before "times", "couriernew" before "courier").
const fontFamilyMatchers: Array<{ id: PdfFontFamilyId; pattern: RegExp }> = [
  { id: 'carlito', pattern: /calibri|carlito/ },
  { id: 'caladea', pattern: /cambria|caladea/ },
  {
    id: 'liberation-mono',
    pattern: /couriernew|liberationmono|cousine|consolas|menlo|monaco|inconsolata|dejavusansmono/,
  },
  { id: 'courier', pattern: /courier/ },
  {
    id: 'liberation-serif',
    pattern:
      /timesnewroman|liberationserif|tinos|georgia|garamond|palatino|bookantiqua|bookman|charter|utopia|minionpro|minion/,
  },
  { id: 'times-roman', pattern: /times/ },
  {
    id: 'liberation-sans',
    pattern:
      /arial|liberationsans|arimo|segoe|tahoma|verdana|opensans|roboto|lato|notosans|dejavusans/,
  },
  { id: 'helvetica', pattern: /helvetica|helvetneue|helvet/ },
];

const genericFallbackFontIds: Record<string, PdfFontFamilyId> = {
  monospace: 'liberation-mono',
  'sans-serif': 'liberation-sans',
  serif: 'liberation-serif',
};

export function stripFontSubsetPrefix(rawFontName: string): string {
  return rawFontName.replace(/^[A-Z]{6}\+/, '');
}

export function recognizePdfFontName(
  rawFontName: string | undefined,
  genericFallback?: string,
): RecognizedPdfFont {
  const cleaned = rawFontName ? stripFontSubsetPrefix(rawFontName) : '';
  const normalized = cleaned.toLowerCase().replace(/[^a-z]/g, '');
  const bold = /bold|black|heavy|semib|demib|extrab|ultrab/.test(normalized);
  const italic = /italic|oblique/.test(normalized);

  for (const matcher of fontFamilyMatchers) {
    if (normalized && matcher.pattern.test(normalized)) {
      return { fontId: matcher.id, bold, italic, matched: true };
    }
  }

  const fallbackId = genericFallback ? genericFallbackFontIds[genericFallback] : undefined;

  return {
    fontId: fallbackId ?? defaultAnnotationFontId,
    bold,
    italic,
    matched: false,
  };
}
