import { describe, expect, it, vi } from 'vitest';

import { ensureReadableStreamAsyncIteration } from './pdfJs';

type Chunk = { value: unknown };

function createStreamLike(chunks: Chunk[]) {
  let index = 0;
  const reader = {
    cancelled: false,
    released: false,
    read: vi.fn(() =>
      Promise.resolve(
        index < chunks.length
          ? { done: false as const, value: chunks[index++].value }
          : { done: true as const, value: undefined },
      ),
    ),
    cancel: vi.fn(() => {
      reader.cancelled = true;
      return Promise.resolve();
    }),
    releaseLock: vi.fn(() => {
      reader.released = true;
    }),
  };

  return {
    reader,
    stream: { getReader: () => reader },
  };
}

describe('ensureReadableStreamAsyncIteration', () => {
  it('installs an async iterator that yields every chunk from the reader', async () => {
    const prototype: object = {};
    ensureReadableStreamAsyncIteration(prototype);

    const { stream } = createStreamLike([{ value: 'a' }, { value: 'b' }]);
    const iterate = (prototype as Record<symbol, (this: unknown) => AsyncIterator<unknown>>)[
      Symbol.asyncIterator
    ];
    const collected: unknown[] = [];

    for await (const chunk of { [Symbol.asyncIterator]: () => iterate.call(stream) }) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['a', 'b']);
  });

  it('cancels the reader and releases the lock when iteration stops early', async () => {
    const prototype: object = {};
    ensureReadableStreamAsyncIteration(prototype);

    const { reader, stream } = createStreamLike([{ value: 'a' }, { value: 'b' }]);
    const iterate = (prototype as Record<symbol, (this: unknown) => AsyncIterator<unknown>>)[
      Symbol.asyncIterator
    ];

    for await (const chunk of { [Symbol.asyncIterator]: () => iterate.call(stream) }) {
      expect(chunk).toBe('a');
      break;
    }

    expect(reader.cancelled).toBe(true);
    expect(reader.released).toBe(true);
  });

  it('does not replace an existing async iterator implementation', () => {
    const existing = () => {
      throw new Error('unused');
    };
    const prototype: Record<symbol, unknown> = { [Symbol.asyncIterator]: existing };

    ensureReadableStreamAsyncIteration(prototype);

    expect(prototype[Symbol.asyncIterator]).toBe(existing);
  });

  it('leaves the real ReadableStream iterable end to end', async () => {
    ensureReadableStreamAsyncIteration();

    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    });
    const collected: number[] = [];

    for await (const chunk of stream as unknown as AsyncIterable<number>) {
      collected.push(chunk);
    }

    expect(collected).toEqual([1, 2]);
  });
});
