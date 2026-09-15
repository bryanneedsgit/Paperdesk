import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyWorkspace, insertBlankPage } from '../../lib/pdf/pdfWorkspace';
import { updatePageNote } from '../../lib/notes/pageNotes';
import { ExportDeckNotesDialog } from './ExportDeckNotesDialog';

describe('ExportDeckNotesDialog', () => {
  afterEach(cleanup);

  it('defaults to noted slides and lets the user select DOCX', () => {
    let workspace = insertBlankPage(insertBlankPage(createEmptyWorkspace('Quarterly deck')));
    workspace = updatePageNote(workspace, workspace.pages[0].id, {
      version: 1,
      blocks: [{ type: 'paragraph', runs: [{ text: 'Opening notes' }] }],
    });
    const onExport = vi.fn();

    render(
      <ExportDeckNotesDialog
        isExporting={false}
        onClose={vi.fn()}
        onExport={onExport}
        workspace={workspace}
      />,
    );

    expect(screen.getByText('1 of 2 slides have notes')).toBeTruthy();
    expect(screen.getByText('1 slide will be exported')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /DOCX/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Export DOCX' }));

    expect(onExport).toHaveBeenCalledWith({ format: 'docx', includeEmptySlides: false });
  });

  it('requires notes unless empty slides are explicitly included', () => {
    const workspace = insertBlankPage(createEmptyWorkspace('Empty deck'));

    render(
      <ExportDeckNotesDialog
        isExporting={false}
        onClose={vi.fn()}
        onExport={vi.fn()}
        workspace={workspace}
      />,
    );

    expect((screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Include slides without notes/i }));
    expect((screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByText('1 slide will be exported')).toBeTruthy();
  });
});
