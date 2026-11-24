import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceFromDocuments } from '../pdf/pdfWorkspace';
import { useWorkspaceAutosave } from './useWorkspaceAutosave';
const { writeMetadata, writeSources } = vi.hoisted(() => ({
  writeMetadata: vi.fn(),
  writeSources: vi.fn(),
}));
vi.mock('./workspaceStorage', () => ({
  writeAutosavedWorkspace: writeMetadata,
  writeAutosavedWorkspaceSources: writeSources,
}));
beforeEach(() => {
  writeMetadata.mockReset();
  writeSources.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it('keeps recovery current without recopying PDF bytes on 100 navigation/zoom updates', () => {
  const workspace = createWorkspaceFromDocuments([
    {
      id: 'source',
      fileName: 'source.pdf',
      loadedAt: 'today',
      pageCount: 1,
      bytes: new Uint8Array([1, 2]),
    },
  ]);
  const { rerender } = renderHook(
    ({ current, enabled }) => useWorkspaceAutosave(current, undefined, enabled),
    { initialProps: { current: workspace, enabled: true } },
  );
  for (let i = 0; i < 100; i++) {
    rerender({
      current: {
        ...workspace,
        formatterSettings: { ...workspace.formatterSettings, zoom: 1 + i / 100 },
      },
      enabled: true,
    });
  }
  expect(writeMetadata).toHaveBeenCalledTimes(101);
  expect(writeSources).toHaveBeenCalledTimes(1);
  const updated = {
    ...workspace,
    documents: [...workspace.documents, { ...workspace.documents[0], id: 'added' }],
  };
  rerender({ current: updated, enabled: true });
  expect(writeSources).toHaveBeenCalledTimes(2);
  expect(writeSources).toHaveBeenLastCalledWith({ documents: updated.documents });
  rerender({ current: updated, enabled: false });
  expect(writeSources).toHaveBeenCalledTimes(2);
  rerender({ current: updated, enabled: true });
  expect(writeSources).toHaveBeenCalledTimes(3);
});
