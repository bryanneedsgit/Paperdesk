import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceFromDocuments } from '../pdf/pdfWorkspace';
import { decodePpd } from './ppdFormat';
import { savePpd } from './ppdFiles';

const { invoke, save, confirm, startAccess, stopAccess } = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
  startAccess: vi.fn(),
  stopAccess: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save, confirm }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  startAccessingSecurityScopedResource: startAccess,
  stopAccessingSecurityScopedResource: stopAccess,
}));
vi.mock('../pdf/pdfLoader', () => ({ loadPdfFromBytes: vi.fn() }));

function workspace(protectedSource = false) {
  return createWorkspaceFromDocuments([
    {
      id: 'pdf',
      bytes: new Uint8Array([1, 2]),
      fileName: 'source.pdf',
      pageCount: 1,
      loadedAt: 'today',
      ...(protectedSource ? { security: { wasEncrypted: true as const } } : {}),
    },
  ]);
}

describe('PPD file saving', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    save.mockResolvedValue('/tmp/source.ppd');
    confirm.mockResolvedValue(true);
    startAccess.mockResolvedValue(undefined);
    stopAccess.mockResolvedValue(undefined);
    invoke.mockImplementation(async (command: string, args: { path: string }) =>
      command === 'can_write_ppd_file' ? true : args.path,
    );
  });
  it('chooses a PPD path and sends a complete archive to the atomic writer', async () => {
    expect(await savePpd(workspace())).toBe('/tmp/source.ppd');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'source.ppd',
        filters: [{ name: 'PaperDesk Document', extensions: ['ppd'] }],
      }),
    );
    const [, args] = invoke.mock.calls.find(([command]) => command === 'write_ppd_file_atomic')!;
    expect(decodePpd(new Uint8Array(args.bytes)).sources.get('pdf')).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(stopAccess).toHaveBeenCalledWith('/tmp/source.ppd');
  });
  it('updates an authorized PPD directly but prompts for Save As or recovered scopes', async () => {
    await savePpd(workspace(), '/tmp/existing.ppd');
    expect(save).not.toHaveBeenCalled();
    await savePpd(workspace(), '/tmp/existing.ppd', true);
    expect(save).toHaveBeenCalledTimes(1);
    invoke.mockImplementation(async (command: string, args: { path: string }) =>
      command === 'can_write_ppd_file' ? false : args.path,
    );
    await savePpd(workspace(), '/tmp/existing.ppd');
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('does not write when the save dialog or unencrypted-copy confirmation is cancelled', async () => {
    save.mockResolvedValueOnce(null);
    expect(await savePpd(workspace())).toBeNull();
    confirm.mockResolvedValueOnce(false);
    expect(await savePpd(workspace(true))).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('releases scoped access on failed writes and reports failure', async () => {
    invoke.mockRejectedValueOnce(new Error('Disk full'));
    await expect(savePpd(workspace())).rejects.toThrow('Disk full');
    expect(stopAccess).toHaveBeenCalledWith('/tmp/source.ppd');
  });
});
