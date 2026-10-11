import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspaceFromDocuments } from '../pdf/pdfWorkspace';
import {
  clearAutosavedWorkspace,
  readAutosavedWorkspace,
  writeAutosavedWorkspace,
} from './workspaceStorage';

const current = vi.hoisted(() => ({ label: 'main' }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => current }));
afterEach(() => {
  current.label = 'main';
  window.localStorage.clear();
});

it('clearing a detached window preserves the original window recovery snapshot', () => {
  const workspace = createWorkspaceFromDocuments([
    {
      id: 'test',
      fileName: 'test.pdf',
      bytes: new Uint8Array([1]),
      pageCount: 1,
      loadedAt: 'today',
    },
  ]);
  writeAutosavedWorkspace(workspace);
  const original = readAutosavedWorkspace();
  current.label = 'workspace-1';
  expect(readAutosavedWorkspace()).toBeNull();
  writeAutosavedWorkspace({ ...workspace, name: 'Detached' });
  expect(readAutosavedWorkspace()).not.toEqual(original);
  clearAutosavedWorkspace();
  expect(readAutosavedWorkspace()).toBeNull();
  current.label = 'main';
  expect(readAutosavedWorkspace()).toEqual(original);
});
