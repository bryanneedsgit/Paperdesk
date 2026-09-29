import { invoke } from '@tauri-apps/api/core';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import {
  startAccessingSecurityScopedResource,
  stopAccessingSecurityScopedResource,
} from '@tauri-apps/plugin-fs';
import { loadPdfFromBytes } from '../pdf/pdfLoader';
import type { PdfWorkspace } from '../pdf/types';
import { decodePpd, encodePpd, hydratePpd } from './ppdFormat';

export async function openPpd(path: string): Promise<PdfWorkspace> {
  let scoped = false;
  try {
    try {
      await startAccessingSecurityScopedResource(path);
      scoped = true;
    } catch {
      /* Native open events may already grant access. */
    }
    const bytes = await invoke<number[]>('read_ppd_file_bytes', { path });
    return await hydratePpd(decodePpd(new Uint8Array(bytes)), (source, fileName) =>
      loadPdfFromBytes({ bytes: source, fileName }),
    );
  } finally {
    if (scoped) await stopAccessingSecurityScopedResource(path).catch(() => undefined);
  }
}

export async function savePpd(
  workspace: PdfWorkspace,
  existingPath?: string,
  forceSaveAs = false,
): Promise<string | null> {
  if (
    workspace.documents.some((document) => document.security?.wasEncrypted) &&
    !(await confirm(
      'This .ppd copy will contain the document and notes without password protection.',
      {
        title: 'Save unencrypted PaperDesk copy?',
        kind: 'warning',
        okLabel: 'Save unencrypted copy',
        cancelLabel: 'Cancel',
      },
    ))
  )
    return null;

  const canOverwrite =
    existingPath &&
    !forceSaveAs &&
    (await invoke<boolean>('can_write_ppd_file', { path: existingPath }));
  const selectedPath = canOverwrite
    ? existingPath
    : await save({
        title: 'Save PaperDesk Document',
        filters: [{ name: 'PaperDesk Document', extensions: ['ppd'] }],
        defaultPath:
          existingPath ??
          `${workspace.name.replace(/\.(pdf|ppd)$/i, '').replace(/[/\\]/g, '-') || 'Untitled'}.ppd`,
      });
  if (!selectedPath) return null;
  const bytes = encodePpd(workspace);
  let scoped = false;
  try {
    try {
      await startAccessingSecurityScopedResource(selectedPath);
      scoped = true;
    } catch {
      /* Native scope may already cover this path. */
    }
    return await invoke<string>('write_ppd_file_atomic', {
      path: selectedPath,
      bytes: Array.from(bytes),
    });
  } finally {
    if (scoped) await stopAccessingSecurityScopedResource(selectedPath).catch(() => undefined);
  }
}
