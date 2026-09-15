/* eslint-disable react-refresh/only-export-components */
import {
  Bold,
  Download,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  RemoveFormatting,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import {
  getPageNotePlainText,
  hasPageNoteContent,
  normalizePageNoteHref,
} from '../../lib/notes/pageNotes';
import type { PageNoteBlock, PageNoteDocument, PageNoteRun, PdfPageId } from '../../lib/pdf/types';

type PageNotesPanelProps = {
  document: PageNoteDocument | undefined;
  isFocusMode: boolean;
  onChange: (document: PageNoteDocument) => void;
  onClose: () => void;
  onExport: () => void;
  onResizeBy: (delta: number) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleFocusMode: () => void;
  pageId: PdfPageId;
  pageNumber: number;
};

type InlineMarks = Pick<PageNoteRun, 'bold' | 'href' | 'italic'>;

const emptyNote: PageNoteDocument = { version: 1, blocks: [] };

function appendRun(runs: PageNoteRun[], text: string, marks: InlineMarks): void {
  if (!text) {
    return;
  }

  const href = normalizePageNoteHref(marks.href);
  const nextRun: PageNoteRun = {
    text,
    ...(marks.bold ? { bold: true } : {}),
    ...(marks.italic ? { italic: true } : {}),
    ...(href ? { href } : {}),
  };
  const previousRun = runs[runs.length - 1];

  if (
    previousRun &&
    previousRun.bold === nextRun.bold &&
    previousRun.italic === nextRun.italic &&
    previousRun.href === nextRun.href
  ) {
    previousRun.text += text;
    return;
  }

  runs.push(nextRun);
}

function collectRuns(node: Node, marks: InlineMarks, runs: PageNoteRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendRun(runs, node.textContent ?? '', marks);
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  const tagName = node.tagName.toLowerCase();

  if (tagName === 'br') {
    appendRun(runs, '\n', marks);
    return;
  }

  const nextMarks: InlineMarks = {
    bold: marks.bold || tagName === 'b' || tagName === 'strong',
    italic: marks.italic || tagName === 'i' || tagName === 'em',
    href: tagName === 'a' ? normalizePageNoteHref(node.getAttribute('href')) : marks.href,
  };

  for (const child of node.childNodes) {
    collectRuns(child, nextMarks, runs);
  }
}

function createBlock(type: PageNoteBlock['type'], node: Node): PageNoteBlock {
  const runs: PageNoteRun[] = [];

  collectRuns(node, {}, runs);

  if (runs.length === 1 && runs[0].text === '\n') {
    runs.length = 0;
  }

  return { type, runs };
}

export function readPageNoteFromEditor(editor: HTMLElement): PageNoteDocument {
  const blocks: PageNoteBlock[] = [];

  for (const child of editor.childNodes) {
    if (child instanceof HTMLUListElement || child instanceof HTMLOListElement) {
      const type = child instanceof HTMLUListElement ? 'bullet' : 'number';

      for (const listItem of child.children) {
        if (listItem instanceof HTMLLIElement) {
          blocks.push(createBlock(type, listItem));
        }
      }

      continue;
    }

    if (child instanceof HTMLDivElement || child instanceof HTMLParagraphElement) {
      const nestedLists = Array.from(child.children).filter(
        (element): element is HTMLUListElement | HTMLOListElement =>
          element instanceof HTMLUListElement || element instanceof HTMLOListElement,
      );

      if (
        nestedLists.length > 0 &&
        child.textContent?.trim() === nestedLists[0].textContent?.trim()
      ) {
        for (const list of nestedLists) {
          const type = list instanceof HTMLUListElement ? 'bullet' : 'number';

          for (const listItem of list.children) {
            if (listItem instanceof HTMLLIElement) {
              blocks.push(createBlock(type, listItem));
            }
          }
        }
      } else {
        blocks.push(createBlock('paragraph', child));
      }

      continue;
    }

    if (child.nodeType === Node.TEXT_NODE && child.textContent) {
      blocks.push(createBlock('paragraph', child));
    }
  }

  return { version: 1, blocks };
}

function appendRuns(parent: HTMLElement, runs: PageNoteRun[]): void {
  if (runs.length === 0) {
    parent.append(document.createElement('br'));
    return;
  }

  for (const run of runs) {
    let node: Node = document.createTextNode(run.text);

    if (run.italic) {
      const italic = document.createElement('em');
      italic.append(node);
      node = italic;
    }

    if (run.bold) {
      const bold = document.createElement('strong');
      bold.append(node);
      node = bold;
    }

    const href = normalizePageNoteHref(run.href);

    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.rel = 'noreferrer';
      link.append(node);
      node = link;
    }

    parent.append(node);
  }
}

export function writePageNoteToEditor(
  editor: HTMLElement,
  noteDocument: PageNoteDocument | undefined,
): void {
  const fragment = document.createDocumentFragment();
  const blocks = noteDocument?.blocks ?? [];
  let activeList: HTMLUListElement | HTMLOListElement | null = null;
  let activeListType: 'bullet' | 'number' | null = null;

  for (const block of blocks) {
    if (block.type === 'bullet' || block.type === 'number') {
      if (!activeList || activeListType !== block.type) {
        activeList = document.createElement(block.type === 'bullet' ? 'ul' : 'ol');
        activeListType = block.type;
        fragment.append(activeList);
      }

      const listItem = document.createElement('li');
      appendRuns(listItem, block.runs);
      activeList.append(listItem);
      continue;
    }

    activeList = null;
    activeListType = null;
    const paragraph = document.createElement('div');
    appendRuns(paragraph, block.runs);
    fragment.append(paragraph);
  }

  if (blocks.length === 0) {
    const paragraph = document.createElement('div');
    paragraph.append(document.createElement('br'));
    fragment.append(paragraph);
  }

  editor.replaceChildren(fragment);
  editor.dataset.empty = hasPageNoteContent(noteDocument) ? 'false' : 'true';
}

function getSelectionInside(editor: HTMLElement): Selection | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);

  return editor.contains(range.commonAncestorContainer) ? selection : null;
}

export function PageNotesPanel({
  document: noteDocument,
  isFocusMode,
  onChange,
  onClose,
  onExport,
  onResizeBy,
  onResizeStart,
  onToggleFocusMode,
  pageId,
  pageNumber,
}: PageNotesPanelProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false });
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const plainText = getPageNotePlainText(noteDocument);
  const wordCount = plainText ? plainText.split(/\s+/u).length : 0;

  const emitChange = useCallback(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const nextDocument = readPageNoteFromEditor(editor);
    editor.dataset.empty = hasPageNoteContent(nextDocument) ? 'false' : 'true';
    onChange(nextDocument);
  }, [onChange]);

  useLayoutEffect(() => {
    if (editorRef.current) {
      writePageNoteToEditor(editorRef.current, noteDocument ?? emptyNote);
    }
    // Notes are intentionally uncontrolled while typing so browser selection and native undo stay stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const editor = editorRef.current;

      if (!editor || !getSelectionInside(editor)) {
        return;
      }

      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  const runCommand = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    emitChange();
  };

  const openLinkPopover = () => {
    const editor = editorRef.current;
    const selection = editor ? getSelectionInside(editor) : null;

    savedSelectionRef.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setLinkText(selection?.toString() ?? '');
    setLinkUrl('');
    setLinkError(null);
    setIsLinkPopoverOpen(true);
  };

  const restoreSavedSelection = () => {
    const range = savedSelectionRef.current;
    const selection = window.getSelection();

    if (!range || !selection) {
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const handleApplyLink = (event: FormEvent) => {
    event.preventDefault();
    const editor = editorRef.current;
    const href = normalizePageNoteHref(linkUrl);

    if (!editor || !href) {
      setLinkError('Enter a valid http, https, or email link.');
      return;
    }

    editor.focus();
    const restoredSelection = restoreSavedSelection();

    if (restoredSelection && !savedSelectionRef.current?.collapsed) {
      document.execCommand('createLink', false, href);
    } else {
      const link = document.createElement('a');
      link.href = href;
      link.rel = 'noreferrer';
      link.textContent = linkText.trim() || href;
      const selection = window.getSelection();

      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(link);
        range.setStartAfter(link);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.append(link);
      }
    }

    setIsLinkPopoverOpen(false);
    savedSelectionRef.current = null;
    emitChange();
  };

  const handleRemoveLink = () => {
    editorRef.current?.focus();
    restoreSavedSelection();
    document.execCommand('unlink', false);
    setIsLinkPopoverOpen(false);
    savedSelectionRef.current = null;
    emitChange();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && isFocusMode) {
      event.preventDefault();
      onToggleFocusMode();
      return;
    }

    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }

    if (event.key.toLowerCase() === 'b') {
      event.preventDefault();
      runCommand('bold');
    } else if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      runCommand('italic');
    } else if (event.shiftKey && event.key === '7') {
      event.preventDefault();
      runCommand('insertOrderedList');
    } else if (event.shiftKey && event.key === '8') {
      event.preventDefault();
      runCommand('insertUnorderedList');
    }
  };

  return (
    <section
      aria-label={`Notes for page ${pageNumber}`}
      className="page-notes-panel"
      data-focus-mode={isFocusMode ? 'true' : undefined}
    >
      {!isFocusMode ? (
        <div
          aria-label="Resize page notes"
          className="page-notes-resize-edge"
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onResizeBy(16);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              onResizeBy(-16);
            }
          }}
          onPointerDown={onResizeStart}
          role="separator"
          tabIndex={0}
        >
          <span aria-hidden="true" />
        </div>
      ) : null}

      <header className="page-notes-header">
        <div>
          <span className="page-notes-eyebrow">Page notes</span>
          <strong>Page {pageNumber}</strong>
        </div>
        <span className="page-notes-word-count">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
        <div className="page-notes-header-actions">
          <button className="page-notes-export-button" onClick={onExport} type="button">
            <Download size={14} />
            <span>Export notes</span>
          </button>
          <button
            aria-label={isFocusMode ? 'Exit notes focus mode' : 'Open notes focus mode'}
            className="panel-icon-button"
            onClick={onToggleFocusMode}
            title={isFocusMode ? 'Exit focus mode' : 'Focus on notes'}
            type="button"
          >
            {isFocusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            aria-label="Close page notes"
            className="panel-icon-button"
            onClick={onClose}
            title="Close page notes"
            type="button"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="page-notes-toolbar" role="toolbar" aria-label="Note formatting">
        <button
          aria-label="Bold"
          aria-pressed={activeFormats.bold}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand('bold')}
          title="Bold (Ctrl+B)"
          type="button"
        >
          <Bold size={15} />
        </button>
        <button
          aria-label="Italic"
          aria-pressed={activeFormats.italic}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand('italic')}
          title="Italic (Ctrl+I)"
          type="button"
        >
          <Italic size={15} />
        </button>
        <span className="page-notes-toolbar-divider" aria-hidden="true" />
        <button
          aria-label="Bulleted list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand('insertUnorderedList')}
          title="Bulleted list"
          type="button"
        >
          <List size={15} />
        </button>
        <button
          aria-label="Numbered list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand('insertOrderedList')}
          title="Numbered list"
          type="button"
        >
          <ListOrdered size={15} />
        </button>
        <span className="page-notes-toolbar-divider" aria-hidden="true" />
        <div className="page-notes-link-control">
          <button
            aria-expanded={isLinkPopoverOpen}
            aria-label="Add or edit link"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLinkPopover}
            title="Add link"
            type="button"
          >
            <Link2 size={15} />
          </button>
          {isLinkPopoverOpen ? (
            <form className="page-notes-link-popover" onSubmit={handleApplyLink}>
              <label>
                <span>Text</span>
                <input
                  autoFocus={!linkText}
                  onChange={(event) => setLinkText(event.target.value)}
                  placeholder="Link text"
                  value={linkText}
                />
              </label>
              <label>
                <span>Link</span>
                <input
                  autoFocus={Boolean(linkText)}
                  onChange={(event) => {
                    setLinkUrl(event.target.value);
                    setLinkError(null);
                  }}
                  placeholder="https://example.com"
                  value={linkUrl}
                />
              </label>
              {linkError ? <p role="alert">{linkError}</p> : null}
              <div>
                <button
                  className="secondary-action-button"
                  onClick={handleRemoveLink}
                  type="button"
                >
                  Remove
                </button>
                <button className="primary" type="submit">
                  Apply link
                </button>
              </div>
            </form>
          ) : null}
        </div>
        <button
          aria-label="Clear formatting"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            runCommand('removeFormat');
            runCommand('unlink');
          }}
          title="Clear formatting"
          type="button"
        >
          <RemoveFormatting size={15} />
        </button>
      </div>

      <div className="page-notes-editor-scroll">
        <div
          aria-label={`Notes for page ${pageNumber}`}
          className="page-notes-editor"
          contentEditable
          data-empty={hasPageNoteContent(noteDocument) ? 'false' : 'true'}
          onInput={emitChange}
          onKeyDown={handleEditorKeyDown}
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
            window.queueMicrotask(emitChange);
          }}
          ref={editorRef}
          role="textbox"
          spellCheck
          suppressContentEditableWarning
        />
      </div>
    </section>
  );
}
