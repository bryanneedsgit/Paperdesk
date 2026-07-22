import type { FormatterSettings, PdfFormatterFont, PdfPageItem } from './types';
import { annotationFontFamilies } from './annotationFonts';
import { generatedPageSizes, isGeneratedPageItem } from './pdfWorkspace';

export const formatterFontOptions: Array<{
  cssFamily: string;
  id: PdfFormatterFont;
  label: string;
}> = annotationFontFamilies.map((option) => ({
  cssFamily: option.cssFamily,
  id: option.id,
  label: option.detail ? `${option.label} (${option.detail})` : option.label,
}));

export function getFormatterFontCssFamily(fontFamily: PdfFormatterFont): string {
  return (
    formatterFontOptions.find((option) => option.id === fontFamily)?.cssFamily ??
    formatterFontOptions[0].cssFamily
  );
}

export function getResizeDimensions(
  settings: FormatterSettings,
  page: PdfPageItem,
): { height: number; width: number } | null {
  switch (settings.resizePageSize) {
    case 'a4-portrait':
      return generatedPageSizes.a4Portrait;
    case 'a4-landscape':
      return {
        width: generatedPageSizes.a4Portrait.height,
        height: generatedPageSizes.a4Portrait.width,
      };
    case 'letter-portrait':
      return generatedPageSizes.letterPortrait;
    case 'letter-landscape':
      return {
        width: generatedPageSizes.letterPortrait.height,
        height: generatedPageSizes.letterPortrait.width,
      };
    case 'keep-original':
      if (isGeneratedPageItem(page)) {
        return {
          width: page.width ?? generatedPageSizes.a4Portrait.width,
          height: page.height ?? generatedPageSizes.a4Portrait.height,
        };
      }

      return null;
    default:
      return null;
  }
}
