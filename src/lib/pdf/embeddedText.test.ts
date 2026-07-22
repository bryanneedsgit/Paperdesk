import { describe, expect, it } from 'vitest';

import { createEmbeddedTextBoxes, type EmbeddedTextItem } from './embeddedText';

function createTextItem(patch: Partial<EmbeddedTextItem> = {}): EmbeddedTextItem {
  return {
    dir: 'ltr',
    fontName: 'font-main',
    height: 10,
    str: 'Hello',
    transform: [10, 0, 0, 10, 20, 80],
    width: 25,
    ...patch,
  };
}

describe('embedded text geometry', () => {
  it('converts PDF.js text items into page-local CSS pixel boxes using the viewport scale', () => {
    const boxes = createEmbeddedTextBoxes({
      items: [
        createTextItem(),
        createTextItem({ str: ' ', transform: [10, 0, 0, 10, 45, 80], width: 5 }),
        createTextItem({ str: 'World', transform: [10, 0, 0, 10, 60, 80], width: 30 }),
      ],
      styles: {
        'font-main': {
          ascent: 0.8,
        },
      },
      viewport: {
        height: 200,
        scale: 2,
        transform: [2, 0, 0, -2, 0, 200],
        width: 400,
      },
    });

    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({
      index: 0,
      rect: {
        height: 20,
        width: 50,
        x: 40,
        y: 24,
      },
      text: 'Hello',
    });
    expect(boxes[1]).toMatchObject({
      index: 2,
      rect: {
        height: 20,
        width: 60,
        x: 120,
        y: 24,
      },
      text: 'World',
    });
  });

  it('ignores invalid and whitespace-only text content items', () => {
    const boxes = createEmbeddedTextBoxes({
      items: [
        createTextItem({ str: '\n ' }),
        { str: 'Missing geometry' },
        createTextItem({ str: 'Visible' }),
      ],
      styles: {
        'font-main': {},
      },
      viewport: {
        height: 100,
        scale: 1,
        transform: [1, 0, 0, -1, 0, 100],
        width: 200,
      },
    });

    expect(boxes.map((box) => box.text)).toEqual(['Visible']);
  });
});
