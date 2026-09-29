import type { PageNoteDocument, PdfWorkspace } from '../pdf/types';
import { hasPageNoteContent } from './pageNotes';

export type DeckNotesExportFormat = 'pdf' | 'docx';

export type DeckNotesExportOptions = {
  format: DeckNotesExportFormat;
  includeEmptySlides: boolean;
};

export type DeckNotesSaveResult = {
  filePath: string;
  format: DeckNotesExportFormat;
  slideCount: number;
};

export type DeckNotesSection = {
  image: {
    bytes: Uint8Array;
    height: number;
    width: number;
  };
  note: PageNoteDocument | undefined;
  slideNumber: number;
};

export function getDeckNotesBaseName(workspace: PdfWorkspace): string {
  const printableValue = Array.from(workspace.name)
    .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
    .join('');

  return (
    printableValue
      .replace(/\.(pdf|ppd)$/i, '')
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[ .-]+$/g, '')
      .trim()
      .slice(0, 80) || 'paperdesk'
  );
}

export function getDeckNotesExportFileName(
  workspace: PdfWorkspace,
  format: DeckNotesExportFormat,
): string {
  return `${getDeckNotesBaseName(workspace)}-notes.${format}`;
}

export function getDeckNotesSections(
  workspace: PdfWorkspace,
  includeEmptySlides: boolean,
): Array<Omit<DeckNotesSection, 'image'>> {
  return workspace.pages
    .filter((page) => !page.deleted)
    .map((page, pageIndex) => ({
      note: workspace.pageNotes?.[page.id],
      slideNumber: pageIndex + 1,
    }))
    .filter(({ note }) => includeEmptySlides || hasPageNoteContent(note));
}
