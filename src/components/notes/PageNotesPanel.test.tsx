import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageNoteDocument } from '../../lib/pdf/types';
import { PageNotesPanel, readPageNoteFromEditor, writePageNoteToEditor } from './PageNotesPanel';

const note: PageNoteDocument = {
  version: 1,
  blocks: [
    {
      type: 'paragraph',
      runs: [
        { bold: true, text: 'Opening ' },
        { href: 'https://example.com/', italic: true, text: 'link' },
      ],
    },
    { type: 'bullet', runs: [{ text: 'First point' }] },
    { type: 'bullet', runs: [{ text: 'Second point' }] },
  ],
};

describe('PageNotesPanel', () => {
  afterEach(cleanup);

  it('round-trips the allowlisted editor structure', () => {
    const editor = document.createElement('div');

    writePageNoteToEditor(editor, note);

    expect(editor.querySelectorAll('ul > li')).toHaveLength(2);
    expect(editor.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
    expect(readPageNoteFromEditor(editor)).toEqual(note);
  });

  it('shows the active page, word count, and emits edited notes', () => {
    const onChange = vi.fn();

    render(
      <PageNotesPanel
        document={note}
        isFocusMode={false}
        onChange={onChange}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onResizeBy={vi.fn()}
        onResizeStart={vi.fn()}
        onToggleFocusMode={vi.fn()}
        pageId="page-2"
        pageNumber={2}
      />,
    );

    expect(screen.getByText('Page 2')).toBeTruthy();
    expect(screen.getByText('6 words')).toBeTruthy();
    const editor = screen.getByRole('textbox', { name: 'Notes for page 2' });

    editor.replaceChildren(document.createTextNode('Updated note'));
    fireEvent.input(editor);

    expect(onChange).toHaveBeenLastCalledWith({
      version: 1,
      blocks: [{ type: 'paragraph', runs: [{ text: 'Updated note' }] }],
    });
  });

  it('supports keyboard resizing and exits focus mode with Escape', () => {
    const onResizeBy = vi.fn();
    const onToggleFocusMode = vi.fn();
    const { rerender } = render(
      <PageNotesPanel
        document={note}
        isFocusMode={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onResizeBy={onResizeBy}
        onResizeStart={vi.fn()}
        onToggleFocusMode={onToggleFocusMode}
        pageId="page-2"
        pageNumber={2}
      />,
    );

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize page notes' }), {
      key: 'ArrowUp',
    });
    expect(onResizeBy).toHaveBeenCalledWith(16);

    rerender(
      <PageNotesPanel
        document={note}
        isFocusMode
        onChange={vi.fn()}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onResizeBy={onResizeBy}
        onResizeStart={vi.fn()}
        onToggleFocusMode={onToggleFocusMode}
        pageId="page-2"
        pageNumber={2}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes for page 2' }), {
      key: 'Escape',
    });
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);
  });
});
