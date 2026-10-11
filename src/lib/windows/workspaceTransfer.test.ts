import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceFromDocuments } from '../pdf/pdfWorkspace';
import { commitWorkspaceHistory, createWorkspaceHistory } from '../pdf/workspaceHistory';
import { createDocumentSaveState, isDocumentDirty } from '../project/documentSaveState';
import { encodeWorkspaceTransfer, type WorkspaceTab } from './workspaceTransfer';

export function makeTransferTab(): WorkspaceTab {
  const workspace = createWorkspaceFromDocuments([
    {
      id: 'transfer-doc',
      fileName: 'transfer.pdf',
      pageCount: 1,
      bytes: new Uint8Array([0, 127, 128, 255]),
      loadedAt: '2026-10-10',
    },
  ]);
  return {
    id: workspace.id,
    color: '#123456',
    fontFamily: 'Arial',
    history: createWorkspaceHistory(workspace),
    saveState: createDocumentSaveState(workspace, '/tmp/transfer.ppd'),
  };
}

describe('workspace transfer', () => {
  it('restores unsaved edits, save path, appearance, passwords and undo-only PDF sources in a fresh window', async () => {
    const tab = makeTransferTab();
    tab.history = commitWorkspaceHistory(tab.history, {
      ...tab.history.present,
      name: 'Edited',
      documents: [],
    });
    const payload = encodeWorkspaceTransfer(
      [tab],
      new Map([
        ['transfer-doc', 'secret'],
        ['unrelated', 'excluded'],
      ]),
    );
    vi.resetModules(); // A destination has its own history byte registry.
    const { decodeWorkspaceTransfer } = await import('./workspaceTransfer');
    const { undoWorkspaceHistory, redoWorkspaceHistory } = await import('../pdf/workspaceHistory');
    const result = decodeWorkspaceTransfer(payload);
    expect(result.tabs[0]).toEqual(tab);
    expect(result.passwords).toEqual([['transfer-doc', 'secret']]);
    expect(isDocumentDirty(result.tabs[0].history.present, result.tabs[0].saveState)).toBe(true);
    const undone = undoWorkspaceHistory(result.tabs[0].history);
    expect(undone.present.documents[0].bytes).toEqual(new Uint8Array([0, 127, 128, 255]));
    expect(redoWorkspaceHistory(undone).present.name).toBe('Edited');
  });

  it('rejects incompatible payloads', async () => {
    const { decodeWorkspaceTransfer } = await import('./workspaceTransfer');
    expect(() => decodeWorkspaceTransfer('{"version":2}')).toThrow('Invalid workspace transfer');
  });
});
