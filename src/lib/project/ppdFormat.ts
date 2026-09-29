import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { normalizePageNotes } from '../notes/pageNotes';
import type { PdfDocumentSource, PdfWorkspace } from '../pdf/types';
import { createId } from '../utils/ids';
import { getFileNameFromPath } from '../utils/fileNames';
import { ppdManifestSchema, type PpdManifest } from './ppdSchema';

export const maxPpdBytes = 512 * 1024 * 1024;
const maxManifestBytes = 32 * 1024 * 1024;
const invalidFile = () =>
  new Error('This PaperDesk document is invalid, damaged, or uses an unsupported version.');

function createManifest(workspace: PdfWorkspace): PpdManifest {
  return ppdManifestSchema.parse({
    format: 'paperdesk',
    version: 1,
    workspace: {
      ...workspace,
      documents: workspace.documents.map((document, index) => ({
        id: document.id,
        fileName: getFileNameFromPath(document.fileName),
        pageCount: document.pageCount,
        entry: `sources/${index}.pdf`,
      })),
      pageNotes: normalizePageNotes(
        workspace.pageNotes,
        new Set(workspace.pages.filter((p) => !p.deleted).map((p) => p.id)),
      ),
    },
  });
}

export function encodePpd(workspace: PdfWorkspace): Uint8Array {
  const manifest = strToU8(JSON.stringify(createManifest(workspace)));
  if (
    manifest.length > maxManifestBytes ||
    workspace.documents.reduce((sum, doc) => sum + doc.bytes.length, manifest.length) > maxPpdBytes
  ) {
    throw new Error('This document exceeds the .ppd size limit (512 MB total, 32 MB metadata).');
  }
  const entries: Record<string, Uint8Array> = { 'manifest.json': manifest };
  workspace.documents.forEach((document, index) => {
    entries[`sources/${index}.pdf`] = document.bytes;
  });
  // PDFs are already compressed; storing entries also keeps saves responsive.
  const bytes = zipSync(entries, { level: 0 });
  if (bytes.length > maxPpdBytes)
    throw new Error('This document exceeds the .ppd size limit (512 MB).');
  return bytes;
}

export function decodePpd(bytes: Uint8Array): {
  manifest: PpdManifest;
  sources: Map<string, Uint8Array>;
} {
  try {
    if (bytes.length > maxPpdBytes) throw invalidFile();
    let totalSize = 0;
    const names = new Set<string>();
    const entries = unzipSync(bytes, {
      filter(entry) {
        if (
          names.has(entry.name) ||
          names.size >= 1025 ||
          (entry.name !== 'manifest.json' && !/^sources\/\d+\.pdf$/.test(entry.name))
        )
          throw invalidFile();
        names.add(entry.name);
        totalSize += entry.originalSize;
        if (
          totalSize > maxPpdBytes ||
          (entry.name === 'manifest.json' && entry.originalSize > maxManifestBytes)
        )
          throw invalidFile();
        return true;
      },
    });
    if (!entries['manifest.json']) throw invalidFile();
    const parsed: unknown = JSON.parse(
      strFromU8(entries['manifest.json']),
      (key, value: unknown) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw invalidFile();
        return value;
      },
    );
    const manifest = ppdManifestSchema.parse(parsed);
    const workspace = manifest.workspace;
    const documents = new Map(workspace.documents.map((d) => [d.id, d]));
    const pages = new Set(workspace.pages.map((p) => p.id));
    const annotations = new Set(workspace.annotations.map((a) => a.id));
    const sourceEntries = new Set(workspace.documents.map((d) => d.entry));
    if (
      documents.size !== workspace.documents.length ||
      pages.size !== workspace.pages.length ||
      annotations.size !== workspace.annotations.length ||
      sourceEntries.size !== documents.size ||
      names.size !== documents.size + 1
    )
      throw invalidFile();
    const sources = new Map<string, Uint8Array>();
    for (const document of workspace.documents) {
      const source = entries[document.entry];
      if (!source?.length) throw invalidFile();
      sources.set(document.id, source);
    }
    for (const page of workspace.pages) {
      if (page.kind !== 'generated') {
        const source = documents.get(page.sourceDocumentId);
        if (!source || page.sourcePageIndex >= source.pageCount) throw invalidFile();
      }
    }
    const pageRefs = [
      ...workspace.bookmarkedPageIds,
      ...workspace.selectedPageIds,
      ...Object.keys(workspace.pageNotes),
      ...(workspace.activePageId ? [workspace.activePageId] : []),
    ];
    if (
      pageRefs.some((id) => !pages.has(id)) ||
      Object.keys(workspace.formFieldValues).some((id) => !documents.has(id)) ||
      workspace.annotations.some(
        (a) =>
          !pages.has(a.pageItemId) || (a.linkedCommentId && !annotations.has(a.linkedCommentId)),
      )
    )
      throw invalidFile();
    workspace.pageNotes = normalizePageNotes(workspace.pageNotes, pages);
    return { manifest, sources };
  } catch {
    throw invalidFile();
  }
}

/** Remap identity before any renderer or history cache sees an opened project. */
export async function hydratePpd(
  decoded: ReturnType<typeof decodePpd>,
  loadSource: (bytes: Uint8Array, fileName: string) => Promise<PdfDocumentSource>,
): Promise<PdfWorkspace> {
  const saved = decoded.manifest.workspace;
  const documentIds = new Map(saved.documents.map((d) => [d.id, createId('pdf')]));
  const pageIds = new Map(saved.pages.map((p) => [p.id, createId('page')]));
  const annotationIds = new Map(saved.annotations.map((a) => [a.id, createId('annotation')]));
  const documents: PdfDocumentSource[] = [];
  for (const source of saved.documents) {
    const loaded = await loadSource(
      decoded.sources.get(source.id)!,
      getFileNameFromPath(source.fileName),
    );
    if (loaded.pageCount !== source.pageCount) throw invalidFile();
    documents.push({ ...loaded, id: documentIds.get(source.id)!, filePath: undefined });
  }
  return {
    ...saved,
    id: createId('workspace'),
    documents,
    pages: saved.pages.map((page) =>
      page.kind === 'generated'
        ? { ...page, id: pageIds.get(page.id)! }
        : {
            ...page,
            id: pageIds.get(page.id)!,
            sourceDocumentId: documentIds.get(page.sourceDocumentId)!,
          },
    ),
    activePageId: saved.activePageId ? pageIds.get(saved.activePageId) : undefined,
    selectedPageIds: saved.selectedPageIds.map((id) => pageIds.get(id)!),
    bookmarkedPageIds: saved.bookmarkedPageIds.map((id) => pageIds.get(id)!),
    pageNotes: Object.fromEntries(
      Object.entries(saved.pageNotes).map(([id, note]) => [pageIds.get(id)!, note]),
    ),
    formFieldValues: Object.fromEntries(
      Object.entries(saved.formFieldValues).map(([id, values]) => [documentIds.get(id)!, values]),
    ),
    annotations: saved.annotations.map((a) => ({
      ...a,
      id: annotationIds.get(a.id)!,
      pageItemId: pageIds.get(a.pageItemId)!,
      linkedCommentId: a.linkedCommentId ? annotationIds.get(a.linkedCommentId) : undefined,
    })),
  };
}
