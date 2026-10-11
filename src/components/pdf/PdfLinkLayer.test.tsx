import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfLinkLayer } from './PdfLinkLayer';
import type { PdfDocumentSource, PdfPageItem } from '../../lib/pdf/types';
const { invoke, getPdfPageWebLinks } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getPdfPageWebLinks: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../lib/pdf/pdfRenderer', () => ({ getPdfPageWebLinks }));
const source: PdfDocumentSource = {
  id: 'source',
  fileName: 'links.pdf',
  pageCount: 2,
  bytes: new Uint8Array([1]),
  loadedAt: 'today',
};
const page: PdfPageItem = {
  id: 'page',
  sourceDocumentId: 'source',
  sourceFileName: 'links.pdf',
  sourcePageIndex: 0,
  rotation: 0,
  displayIndex: 1,
  deleted: false,
};
const link = {
  id: 'link',
  url: 'https://example.org/paper',
  rect: { x: 10, y: 20, width: 100, height: 12 },
};
beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  getPdfPageWebLinks.mockReset().mockResolvedValue([link]);
});
afterEach(cleanup);

describe('PDF link interactions', () => {
  it('opens a scaled link via native browser dispatch and prevents webview navigation', async () => {
    render(<PdfLinkLayer disabled={false} page={page} sourceDocument={source} scale={2} />);
    const anchor = await screen.findByRole('link', {
      name: 'Open https://example.org/paper in default browser',
    });
    expect(anchor.style.left).toBe('20px');
    expect(anchor.style.height).toBe('24px');
    expect(fireEvent.click(anchor)).toBe(false);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_pdf_web_link', { url: link.url });
  });

  it('keeps annotation mode free of link click targets', async () => {
    render(<PdfLinkLayer disabled page={page} sourceDocument={source} scale={1} />);
    await act(async () => {});
    expect(screen.queryByRole('link')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not leave stale link targets when the page changes', async () => {
    const { rerender } = render(
      <PdfLinkLayer disabled={false} page={page} sourceDocument={source} scale={1} />,
    );
    await screen.findByRole('link');
    getPdfPageWebLinks.mockReturnValue(new Promise(() => {}));
    rerender(
      <PdfLinkLayer
        disabled={false}
        page={{ ...page, id: 'page2', sourcePageIndex: 1 }}
        sourceDocument={source}
        scale={1}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('reports browser-launch failures and allows a retry', async () => {
    invoke.mockRejectedValueOnce(new Error('No handler'));
    render(<PdfLinkLayer disabled={false} page={page} sourceDocument={source} scale={1} />);
    fireEvent.click(await screen.findByRole('link'));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not open this link');
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
