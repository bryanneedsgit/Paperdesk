import type {
  PageNoteBlock,
  PageNoteDocument,
  PageNoteRun,
  PdfPageId,
  PdfWorkspace,
} from '../pdf/types';

export const emptyPageNoteDocument: PageNoteDocument = {
  version: 1,
  blocks: [],
};

const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);

export function normalizePageNoteHref(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  try {
    const url = new URL(trimmedValue);

    return allowedProtocols.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRun(value: unknown): PageNoteRun | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PageNoteRun>;

  if (typeof candidate.text !== 'string') {
    return null;
  }

  const href = normalizePageNoteHref(candidate.href);

  return {
    text: candidate.text,
    ...(candidate.bold === true ? { bold: true } : {}),
    ...(candidate.italic === true ? { italic: true } : {}),
    ...(href ? { href } : {}),
  };
}

function normalizeBlock(value: unknown): PageNoteBlock | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PageNoteBlock>;

  if (
    candidate.type !== 'paragraph' &&
    candidate.type !== 'bullet' &&
    candidate.type !== 'number'
  ) {
    return null;
  }

  const runs = Array.isArray(candidate.runs)
    ? candidate.runs.map(normalizeRun).filter((run): run is PageNoteRun => Boolean(run))
    : [];

  return {
    type: candidate.type,
    runs,
  };
}

export function normalizePageNoteDocument(value: unknown): PageNoteDocument {
  if (!value || typeof value !== 'object') {
    return emptyPageNoteDocument;
  }

  const candidate = value as Partial<PageNoteDocument>;

  if (candidate.version !== 1 || !Array.isArray(candidate.blocks)) {
    return emptyPageNoteDocument;
  }

  return {
    version: 1,
    blocks: candidate.blocks
      .map(normalizeBlock)
      .filter((block): block is PageNoteBlock => Boolean(block)),
  };
}

export function normalizePageNotes(
  value: unknown,
  allowedPageIds?: ReadonlySet<PdfPageId>,
): Record<PdfPageId, PageNoteDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const notes: Record<PdfPageId, PageNoteDocument> = {};

  for (const [pageId, document] of Object.entries(value)) {
    if (
      pageId === '__proto__' ||
      pageId === 'constructor' ||
      pageId === 'prototype' ||
      (allowedPageIds && !allowedPageIds.has(pageId))
    ) {
      continue;
    }

    const normalizedDocument = normalizePageNoteDocument(document);

    if (hasPageNoteContent(normalizedDocument)) {
      notes[pageId] = normalizedDocument;
    }
  }

  return notes;
}

export function getPageNotePlainText(document: PageNoteDocument | undefined): string {
  if (!document) {
    return '';
  }

  return document.blocks
    .map((block) => block.runs.map((run) => run.text).join(''))
    .join('\n')
    .trim();
}

export function hasPageNoteContent(document: PageNoteDocument | undefined): boolean {
  return getPageNotePlainText(document).length > 0;
}

export function getNotedPageCount(workspace: PdfWorkspace): number {
  return workspace.pages.reduce(
    (count, page) =>
      !page.deleted && hasPageNoteContent(workspace.pageNotes?.[page.id]) ? count + 1 : count,
    0,
  );
}

export function updatePageNote(
  workspace: PdfWorkspace,
  pageId: PdfPageId,
  document: PageNoteDocument,
): PdfWorkspace {
  if (!workspace.pages.some((page) => page.id === pageId && !page.deleted)) {
    return workspace;
  }

  const normalizedDocument = normalizePageNoteDocument(document);
  const pageNotes = { ...(workspace.pageNotes ?? {}) };

  if (hasPageNoteContent(normalizedDocument)) {
    pageNotes[pageId] = normalizedDocument;
  } else {
    delete pageNotes[pageId];
  }

  return {
    ...workspace,
    pageNotes,
  };
}
