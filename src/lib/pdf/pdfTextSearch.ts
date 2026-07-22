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

function countMatches(text: string, query: string): number {
  return findMatchIndexes(text, query).length;
}

function findMatchIndexes(text: string, query: string): number[] {
  if (!query) {
    return [];
  }

  const indexes: number[] = [];
  let nextIndex = text.indexOf(query);

  while (nextIndex >= 0) {
    indexes.push(nextIndex);
    nextIndex = text.indexOf(query, nextIndex + query.length);
  }

  return indexes;
}

function removeSearchSpacing(value: string): string {
  return value.replace(/\s+/g, '');
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
): Promise<PdfTextSearchResult[]> {
  const query = normalizeText(rawQuery).toLowerCase();
  const compactQuery = removeSearchSpacing(query);

  if (!query || !compactQuery) {
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
        const lowerPageText = pageText.toLowerCase();
        const directMatchIndexes = findMatchIndexes(lowerPageText, query);

        if (directMatchIndexes.length > 0) {
          directMatchIndexes.forEach((pageTextMatchIndex, pageMatchIndex) => {
            results.push({
              matchIndex,
              pageId: pageItem.id,
              pageMatchIndex,
              pageNumber: pageItem.displayIndex,
              snippet: createSnippet(pageText, pageTextMatchIndex, query.length),
            });
            matchIndex += 1;
          });
          continue;
        }

        const compactMatchCount = countMatches(removeSearchSpacing(lowerPageText), compactQuery);

        for (let pageMatchIndex = 0; pageMatchIndex < compactMatchCount; pageMatchIndex += 1) {
          results.push({
            matchIndex,
            pageId: pageItem.id,
            pageMatchIndex,
            pageNumber: pageItem.displayIndex,
            snippet: pageText.slice(0, 96),
          });
          matchIndex += 1;
        }
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
