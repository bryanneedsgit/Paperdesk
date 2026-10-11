import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceFromDocuments } from '../pdf/pdfWorkspace';
import { createWorkspaceHistory } from '../pdf/workspaceHistory';
import { createDocumentSaveState } from '../project/documentSaveState';
import { encodeWorkspaceTransfer, type WorkspaceTab } from './workspaceTransfer';
import { useWorkspaceTransfer } from './useWorkspaceTransfer';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

function setupOptions() {
  const workspace = createWorkspaceFromDocuments([
    {
      id: 'source',
      fileName: 'test.pdf',
      bytes: new Uint8Array([1, 2, 3]),
      pageCount: 1,
      loadedAt: 'today',
    },
  ]);
  const tab: WorkspaceTab = {
    id: workspace.id,
    history: createWorkspaceHistory(workspace),
    saveState: createDocumentSaveState(workspace),
  };
  return {
    isBusy: false,
    getTabs: () => [tab],
    passwords: new Map<string, string>(),
    receive: vi.fn(),
    remove: vi.fn(),
    onError: vi.fn(),
  };
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('workspace handoff', () => {
  it('retains the source until the receiver acknowledges, including after IPC errors', async () => {
    const options = setupOptions();
    let status: string | Error = 'pending';
    invoke.mockImplementation(async (command) => {
      if (command === 'move_workspace_tabs') return 'handoff';
      if (command === 'workspace_tabs_status') {
        if (status instanceof Error) throw status;
        return status;
      }
      return null;
    });
    const { result } = renderHook(() => useWorkspaceTransfer(options));
    await act(async () => {
      await result.current.moveTabs([options.getTabs()[0].id], true);
    });
    await tick();
    expect(options.remove).not.toHaveBeenCalled();
    expect(result.current.isTransferring).toBe(true);
    status = new Error('temporary IPC failure');
    await tick();
    expect(options.remove).not.toHaveBeenCalled();
    status = 'accepted';
    await tick();
    expect(options.remove).toHaveBeenCalledExactlyOnceWith([options.getTabs()[0].id]);
    expect(result.current.isTransferring).toBe(false);
  });

  it('keeps rejected tabs and unlocks the source', async () => {
    const options = setupOptions();
    invoke.mockImplementation(async (command) =>
      command === 'move_workspace_tabs'
        ? 'handoff'
        : command === 'workspace_tabs_status'
          ? 'rejected'
          : null,
    );
    const { result } = renderHook(() => useWorkspaceTransfer(options));
    await act(async () => {
      await result.current.moveTabs([options.getTabs()[0].id], true);
    });
    await tick();
    expect(options.remove).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledOnce();
    expect(result.current.isTransferring).toBe(false);
  });

  it('installs once before acknowledgement and retries failed acknowledgements', async () => {
    const options = setupOptions();
    const payload = encodeWorkspaceTransfer(options.getTabs(), options.passwords);
    options.getTabs = () => [];
    let offered = false;
    let attempts = 0;
    invoke.mockImplementation(async (command) => {
      if (command === 'receive_workspace_tabs' && !offered) {
        offered = true;
        return ['handoff', payload];
      }
      if (command === 'finish_workspace_tabs') {
        expect(options.receive).toHaveBeenCalledOnce();
        if (++attempts === 1) throw new Error('IPC unavailable');
      }
      return null;
    });
    renderHook(() => useWorkspaceTransfer(options));
    await tick();
    await tick();
    expect(options.receive).toHaveBeenCalledOnce();
    expect(attempts).toBe(2);
    expect(invoke).toHaveBeenCalledWith('finish_workspace_tabs', { id: 'handoff', accepted: true });
  });

  it('rejects malformed transfers without changing the destination', async () => {
    const options = setupOptions();
    invoke.mockImplementation(async (command) =>
      command === 'receive_workspace_tabs' ? ['bad', '{}'] : null,
    );
    renderHook(() => useWorkspaceTransfer(options));
    await tick();
    expect(options.receive).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('finish_workspace_tabs', { id: 'bad', accepted: false });
  });
});
