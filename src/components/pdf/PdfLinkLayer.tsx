import { useEffect, useState, type MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getPdfPageWebLinks } from '../../lib/pdf/pdfRenderer';
import type { PdfWebLink } from '../../lib/pdf/pdfLinks';
import type { PdfDocumentSource, PdfPageItem } from '../../lib/pdf/types';

type Props = {
  disabled: boolean;
  page: PdfPageItem;
  scale: number;
  sourceDocument: PdfDocumentSource;
};

export function PdfLinkLayer({ disabled, page, scale, sourceDocument }: Props) {
  const [result, setResult] = useState<{
    page: PdfPageItem;
    source: PdfDocumentSource;
    links: PdfWebLink[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setError(null);
    void getPdfPageWebLinks(sourceDocument, page)
      .then((links) => {
        if (!disposed) setResult({ page, source: sourceDocument, links });
      })
      .catch(() => {
        if (!disposed) setError('Links on this page could not be loaded.');
      });
    return () => {
      disposed = true;
    };
  }, [page, sourceDocument]);

  const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || (event.type === 'auxclick' && event.button !== 1)) return;
    setError(null);
    try {
      await invoke('open_pdf_web_link', { url });
    } catch {
      setError('Could not open this link in your default browser. Please try again.');
    }
  };

  if (disabled) return null;
  const links = result?.page === page && result.source === sourceDocument ? result.links : [];
  return (
    <div className="pdf-link-layer">
      {links.map((link) => (
        <a
          key={link.id}
          className="pdf-web-link"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
          aria-label={`Open ${link.url} in default browser`}
          title={link.url}
          onClick={(event) => void openLink(event, link.url)}
          onAuxClick={(event) => void openLink(event, link.url)}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            left: link.rect.x * scale,
            top: link.rect.y * scale,
            width: link.rect.width * scale,
            height: link.rect.height * scale,
          }}
        />
      ))}
      {error ? (
        <div className="pdf-link-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss link error">
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
