import { isSourcePageItem } from './pdfWorkspace';
import { ensurePdfJsWorker, pdfjsLib } from './pdfJs';
import type { PdfPageId, PdfWorkspace } from './types';

export type PdfTextSearchResult = {
  matchIndex: number;
  pageId: PdfPageId;
  pageMatchIndex: number;
  pageNumber: number;
  snippet: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export type TextMatch = { start: number; end: number };

// Retain source offsets even when whitespace or case folding changes lengths.
export function findTextMatches(text: string, rawQuery: string, exact = false): TextMatch[] {
  const query = normalizeText(rawQuery).toLowerCase();
  if (!query) return [];
  function mapped(compact: boolean) {
    let value = '';
    const starts: number[] = [];
    const ends: number[] = [];
    let offset = 0;
    for (const character of text) {
      const start = offset;
      offset += character.length;
      const whitespace = /\s/u.test(character);
      if (whitespace && compact) continue;
      if (whitespace && value.endsWith(' ')) {
        ends[ends.length - 1] = offset;
        continue;
      }
      const folded = whitespace ? ' ' : character.toLowerCase();
      value += folded;
      for (let i = 0; i < folded.length; i++) {
        starts.push(start);
        ends.push(offset);
      }
    }
    return { value, starts, ends };
  }
  function search(compact: boolean): TextMatch[] {
    const { value, starts, ends } = mapped(compact);
    const needle = compact ? query.replace(/\s+/g, '') : query;
    if (!needle) return [];
    const matches: TextMatch[] = [];
    for (let i = value.indexOf(needle); i >= 0; i = value.indexOf(needle, i + needle.length)) {
      const before = Array.from(value.slice(0, i)).at(-1) ?? '';
      const after = Array.from(value.slice(i + needle.length))[0] ?? '';
      if (exact && (/[\p{L}\p{N}_]/u.test(before) || /[\p{L}\p{N}_]/u.test(after))) continue;
      matches.push({ start: starts[i], end: ends[i + needle.length - 1] });
    }
    return matches;
  }
  const direct = search(false);
  return direct.length || exact ? direct : search(true);
}

function createSnippet(text: string, matchIndex: number, queryLength: number): string {
  if (matchIndex < 0) {
    return '';
  }

  const start = Math.max(0, matchIndex - 42);
  const end = Math.min(text.length, matchIndex + queryLength + 42);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';

  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export async function searchWorkspaceText(
  workspace: PdfWorkspace,
  rawQuery: string,
  options: { exact?: boolean } = {},
): Promise<PdfTextSearchResult[]> {
  const query = normalizeText(rawQuery).toLowerCase();

  if (!query) {
    return [];
  }

  const results: PdfTextSearchResult[] = [];
  let matchIndex = 0;
  const visiblePages = workspace.pages.filter((page) => !page.deleted);

  for (const document of workspace.documents) {
    const sourcePages = visiblePages.filter(
      (page) => isSourcePageItem(page) && page.sourceDocumentId === document.id,
    );

    if (sourcePages.length === 0) {
      continue;
    }

    await ensurePdfJsWorker();

    const loadingTask = pdfjsLib.getDocument({ data: document.bytes.slice() });

    try {
      const pdfDocument = await loadingTask.promise;

      for (const pageItem of sourcePages) {
        if (!isSourcePageItem(pageItem)) {
          continue;
        }

        const page = await pdfDocument.getPage(pageItem.sourcePageIndex + 1);
        const textContent = await page.getTextContent();
        const pageText = normalizeText(
          textContent.items
            .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
            .join(' '),
        );
        findTextMatches(pageText, query, options.exact).forEach((match, pageMatchIndex) => {
          results.push({
            matchIndex: matchIndex++,
            pageId: pageItem.id,
            pageMatchIndex,
            pageNumber: pageItem.displayIndex,
            snippet: createSnippet(pageText, match.start, match.end - match.start),
          });
        });
      }
    } finally {
      await loadingTask.destroy().catch(() => undefined);
    }
  }

  return results
    .sort((firstResult, secondResult) => firstResult.pageNumber - secondResult.pageNumber)
    .map((result, sortedIndex) => ({
      ...result,
      matchIndex: sortedIndex,
    }));
}
