export type PdfWebLink = {
  id: string;
  url: string;
  rect: { x: number; y: number; width: number; height: number };
};

/** PDF actions are untrusted: only ordinary web URLs may leave the document. */
export function normalizeWebLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function mapPdfWebLinks(
  annotations: unknown[],
  convertRect: (rect: number[]) => number[],
  pageWidth: number,
  pageHeight: number,
): PdfWebLink[] {
  const links: PdfWebLink[] = [];
  annotations.forEach((value, index) => {
    if (!value || typeof value !== 'object') return;
    const annotation = value as Record<string, unknown>;
    const url = normalizeWebLink(annotation.url);
    // Invisible, Hidden and NoView annotation flags.
    if (annotation.subtype !== 'Link' || !url || Number(annotation.annotationFlags) & 35) return;
    const quads = annotation.quadPoints;
    const rectangles: number[][] = [];
    if (
      (Array.isArray(quads) || quads instanceof Float32Array) &&
      quads.length &&
      quads.length % 8 === 0
    ) {
      for (let offset = 0; offset < quads.length; offset += 8) {
        const quad = Array.from(quads.slice(offset, offset + 8));
        if (
          !quad.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
        )
          continue;
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        rectangles.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
    } else if (
      Array.isArray(annotation.rect) &&
      annotation.rect.length === 4 &&
      annotation.rect.every(
        (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
      )
    ) {
      rectangles.push(annotation.rect);
    }
    rectangles.forEach((rect, part) => {
      const [x1, y1, x2, y2] = convertRect(rect);
      if (![x1, y1, x2, y2].every(Number.isFinite)) return;
      const x = Math.max(0, Math.min(x1, x2));
      const y = Math.max(0, Math.min(y1, y2));
      const width = Math.min(pageWidth, Math.max(x1, x2)) - x;
      const height = Math.min(pageHeight, Math.max(y1, y2)) - y;
      if (width <= 0 || height <= 0) return;
      links.push({ id: `${index}-${part}`, url, rect: { x, y, width, height } });
    });
  });
  return links;
}
