import type { PdfWorkspace } from '../pdf/types';
import { clearAutosavedWorkspace, writeAutosavedWorkspace } from './workspaceStorage';

export function readWorkspaceSnapshot(): null {
  return null;
}

export function writeWorkspaceSnapshot(workspace: PdfWorkspace): void {
  writeAutosavedWorkspace(workspace);
}

export function clearWorkspaceSnapshot(): void {
  clearAutosavedWorkspace();
}
