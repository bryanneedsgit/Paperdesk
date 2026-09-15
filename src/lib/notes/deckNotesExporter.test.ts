import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(),
}));

import { createEmptyWorkspace, insertBlankPage } from '../pdf/pdfWorkspace';
import { updatePageNote } from './pageNotes';
import { createDeckNotesDocx, createDeckNotesPdf } from './deckNotesExporter';
import {
  getDeckNotesExportFileName,
  getDeckNotesSections,
  type DeckNotesSection,
} from './deckNotesExport';

describe('deck notes exporter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const fileName = String(input).split('/').pop();
        const bytes = await readFile(join(process.cwd(), 'src/assets/fonts', fileName ?? ''));

        return {
          arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ok: true,
          status: 200,
        };
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('selects notes in visible slide order and sanitizes the suggested filename', () => {
    let workspace = insertBlankPage(
      insertBlankPage(createEmptyWorkspace('Q3: Launch / Review.pdf')),
    );
    workspace = updatePageNote(workspace, workspace.pages[1].id, {
      version: 1,
      blocks: [{ type: 'paragraph', runs: [{ text: 'Second slide' }] }],
    });

    expect(getDeckNotesSections(workspace, false).map((section) => section.slideNumber)).toEqual([
      2,
    ]);
    expect(getDeckNotesSections(workspace, true).map((section) => section.slideNumber)).toEqual([
      1, 2,
    ]);
    expect(getDeckNotesExportFileName(workspace, 'docx')).toBe('Q3- Launch - Review-notes.docx');
  });

  it('creates valid PDF and DOCX documents from the same slide section', async () => {
    const workspace = insertBlankPage(createEmptyWorkspace('Export deck'));
    const imageBytes = new Uint8Array(
      await readFile(join(process.cwd(), 'src-tauri/icons/32x32.png')),
    );
    const sections: DeckNotesSection[] = [
      {
        image: { bytes: imageBytes, height: 32, width: 32 },
        note: {
          version: 1,
          blocks: [
            {
              type: 'paragraph',
              runs: [
                { bold: true, text: 'Presenter note with ' },
                { href: 'https://example.com/', italic: true, text: 'a link' },
              ],
            },
            { type: 'number', runs: [{ text: 'First point' }] },
          ],
        },
        slideNumber: 1,
      },
    ];

    const pdfBytes = await createDeckNotesPdf(workspace, sections);
    const pdf = await PDFDocument.load(pdfBytes);
    const docxBytes = await createDeckNotesDocx(workspace, sections);

    expect(pdf.getPageCount()).toBe(1);
    expect(Array.from(docxBytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(docxBytes.byteLength).toBeGreaterThan(2_000);
  });
});
