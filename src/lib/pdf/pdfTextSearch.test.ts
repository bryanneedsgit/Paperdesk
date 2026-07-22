import { describe, expect, it, vi } from 'vitest';

import { createDefaultFormSettings, createDefaultFormatterSettings } from './pdfWorkspace';
import { searchWorkspaceText } from './pdfTextSearch';
import type { PdfWorkspace } from './types';

vi.mock('./pdfJs', () => ({
  ensurePdfJsWorker: vi.fn(() => Promise.resolve()),
  pdfjsLib: {
    GlobalWorkerOptions: {},
    getDocument: vi.fn(() => ({
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.resolve({
        getPage: vi.fn(async (pageNumber: number) => ({
          getTextContent: vi.fn(async () => ({
            items:
              pageNumber === 1
                ? [{ str: 'Boarding pass alpha boarding pass gamma' }]
                : [
                    { str: 'F' },
                    { str: 'l' },
                    { str: 'i' },
                    { str: 'g' },
                    { str: 'h' },
                    { str: 't' },
                    { str: 'ticket' },
                    { str: 'beta' },
                  ],
          })),
        })),
        numPages: 2,
      }),
    })),
  },
}));

function createSearchableWorkspace(): PdfWorkspace {
  return {
    id: 'workspace-search',
    name: 'searchable.pdf',
    documents: [
      {
        id: 'document-search',
        fileName: 'searchable.pdf',
        bytes: new Uint8Array([1, 2, 3]),
        loadedAt: '2026-06-24T00:00:00.000Z',
        pageCount: 2,
      },
    ],
    pages: [
      {
        id: 'page-1',
        displayIndex: 1,
        rotation: 0,
        deleted: false,
        sourceDocumentId: 'document-search',
        sourceFileName: 'searchable.pdf',
        sourcePageIndex: 0,
      },
      {
        id: 'page-2',
        displayIndex: 2,
        rotation: 0,
        deleted: false,
        sourceDocumentId: 'document-search',
        sourceFileName: 'searchable.pdf',
        sourcePageIndex: 1,
      },
    ],
    selectedPageIds: ['page-1'],
    activePageId: 'page-1',
    formatterSettings: createDefaultFormatterSettings(),
    formFieldValues: {},
    formSettings: createDefaultFormSettings(),
    annotations: [],
  };
}

describe('PDF text search', () => {
  it('finds embedded text when PDF text items are fragmented', async () => {
    const results = await searchWorkspaceText(createSearchableWorkspace(), 'flight ticket');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      matchIndex: 0,
      pageId: 'page-2',
      pageMatchIndex: 0,
      pageNumber: 2,
    });
  });

  it('returns one result for each match instance on a page', async () => {
    const results = await searchWorkspaceText(createSearchableWorkspace(), 'boarding pass');

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.pageMatchIndex)).toEqual([0, 1]);
    expect(results.every((result) => result.pageId === 'page-1')).toBe(true);
  });
});
