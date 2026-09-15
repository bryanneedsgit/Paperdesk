import { describe, expect, it } from 'vitest';

import { createEmptyWorkspace, deletePages, insertBlankPage } from '../pdf/pdfWorkspace';
import {
  getNotedPageCount,
  getPageNotePlainText,
  hasPageNoteContent,
  normalizePageNoteDocument,
  normalizePageNoteHref,
  normalizePageNotes,
  updatePageNote,
} from './pageNotes';

describe('page notes', () => {
  it('normalizes the restricted rich-text schema and rejects unsafe links', () => {
    const note = normalizePageNoteDocument({
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          runs: [
            { bold: true, href: 'https://example.com/path', text: 'Safe' },
            { href: 'javascript:alert(1)', italic: true, text: ' text' },
          ],
        },
        { type: 'heading', runs: [{ text: 'Not allowed' }] },
      ],
    });

    expect(note).toEqual({
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          runs: [
            { bold: true, href: 'https://example.com/path', text: 'Safe' },
            { italic: true, text: ' text' },
          ],
        },
      ],
    });
    expect(normalizePageNoteHref('mailto:person@example.com')).toBe('mailto:person@example.com');
    expect(normalizePageNoteHref('file:///private/document')).toBeUndefined();
  });

  it('counts meaningful notes and keeps them attached to stable page ids', () => {
    let workspace = insertBlankPage(insertBlankPage(createEmptyWorkspace('Deck')));
    const [firstPage, secondPage] = workspace.pages;

    workspace = updatePageNote(workspace, secondPage.id, {
      version: 1,
      blocks: [{ type: 'bullet', runs: [{ bold: true, text: 'Second slide note' }] }],
    });

    expect(getNotedPageCount(workspace)).toBe(1);
    expect(getPageNotePlainText(workspace.pageNotes?.[secondPage.id])).toBe('Second slide note');
    expect(hasPageNoteContent(workspace.pageNotes?.[firstPage.id])).toBe(false);

    workspace = deletePages(workspace, [secondPage.id]);

    expect(workspace.pageNotes?.[secondPage.id]).toBeUndefined();
  });

  it('drops unknown, empty, and prototype-polluting autosave entries', () => {
    const allowedIds = new Set(['page-1']);
    const value = JSON.parse(
      '{"page-1":{"version":1,"blocks":[{"type":"paragraph","runs":[{"text":"Hello"}]}]},"page-2":{"version":1,"blocks":[{"type":"paragraph","runs":[{"text":"Hidden"}]}]},"__proto__":{"version":1,"blocks":[{"type":"paragraph","runs":[{"text":"Unsafe"}]}]}}',
    );
    const notes = normalizePageNotes(value, allowedIds);

    expect(Object.keys(notes)).toEqual(['page-1']);
    expect({}.toString).toBeTypeOf('function');
  });
});
