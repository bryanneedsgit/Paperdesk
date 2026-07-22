import { describe, expect, it } from 'vitest';

import { getNonLayeredHighlightRects } from '../../lib/pdf/highlightRects';
import type { PdfAnnotation } from '../../lib/pdf/types';

const pageSize = { height: 200, width: 200 };

function createHighlight(patch: Partial<PdfAnnotation>): PdfAnnotation {
  return {
    color: '#ffe600',
    createdAt: '2026-06-29T10:00:00.000Z',
    height: 10,
    id: 'highlight-1',
    pageItemId: 'page-1',
    type: 'highlight',
    width: 40,
    x: 20,
    y: 20,
    ...patch,
  };
}

describe('getNonLayeredHighlightRects', () => {
  it('drops highlight rects that are already highlighted', () => {
    expect(
      getNonLayeredHighlightRects({
        existingHighlights: [createHighlight({})],
        pageSize,
        rects: [{ height: 10, width: 40, x: 20, y: 20 }],
      }),
    ).toEqual([]);
  });

  it('keeps only uncovered text-line segments when a selection partially overlaps a highlight', () => {
    expect(
      getNonLayeredHighlightRects({
        existingHighlights: [createHighlight({ width: 30, x: 40 })],
        pageSize,
        rects: [{ height: 10, width: 80, x: 20, y: 20 }],
      }),
    ).toEqual([
      { height: 10, width: 20, x: 20, y: 20 },
      { height: 10, width: 30, x: 70, y: 20 },
    ]);
  });
});
