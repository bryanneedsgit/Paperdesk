import { describe, expect, it } from 'vitest';
import { mapPdfWebLinks, normalizeWebLink } from './pdfLinks';

describe('PDF web links', () => {
  it('allows only absolute web URLs without embedded credentials', () => {
    expect(normalizeWebLink('https://example.org/paper?q=1#section')).toBe(
      'https://example.org/paper?q=1#section',
    );
    expect(normalizeWebLink('http://example.org')).toBe('http://example.org/');
    for (const value of [
      'javascript:alert(1)',
      'file:///tmp/file.pdf',
      'data:text/html,hi',
      'mailto:a@b.com',
      '//example.org',
      '/relative',
      'https://user:secret@example.org',
      null,
    ]) {
      expect(normalizeWebLink(value)).toBeNull();
    }
  });

  it('maps reversed PDF coordinates through the rotated viewport and clips to the page', () => {
    const links = mapPdfWebLinks(
      [{ subtype: 'Link', url: 'https://example.org', rect: [80, 20, -10, 40] }],
      ([x1, y1, x2, y2]) => [100 - y1, x1, 100 - y2, x2],
      100,
      60,
    );
    expect(links[0].rect).toEqual({ x: 60, y: 0, width: 20, height: 60 });
  });

  it('uses separate click targets for multiline link quadrilaterals', () => {
    const links = mapPdfWebLinks(
      [
        {
          subtype: 'Link',
          url: 'https://example.org',
          rect: [0, 0, 100, 100],
          quadPoints: new Float32Array([
            10, 30, 40, 30, 10, 20, 40, 20, 10, 15, 25, 15, 10, 5, 25, 5,
          ]),
        },
      ],
      (rect) => rect,
      100,
      100,
    );
    expect(links.map((link) => link.rect)).toEqual([
      { x: 10, y: 20, width: 30, height: 10 },
      { x: 10, y: 5, width: 15, height: 10 },
    ]);
  });

  it('ignores hidden annotations, internal destinations, unsafe actions and malformed geometry', () => {
    const base = { subtype: 'Link', url: 'https://example.org', rect: [10, 10, 40, 20] };
    const links = mapPdfWebLinks(
      [
        { ...base, annotationFlags: 2 },
        { ...base, annotationFlags: 32 },
        { ...base, subtype: 'Widget' },
        { ...base, url: undefined, dest: 'chapter1' },
        { ...base, url: 'javascript:alert(1)' },
        { ...base, rect: [NaN, 0, 10, 10] },
        { ...base, rect: [1, 1, 1, 1] },
        { ...base, rect: [110, 110, 120, 120] },
      ],
      (rect) => rect,
      100,
      100,
    );
    expect(links).toEqual([]);
  });
});
