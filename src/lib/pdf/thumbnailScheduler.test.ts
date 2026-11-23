import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleThumbnail } from './thumbnailScheduler';

afterEach(() => vi.restoreAllMocks());

describe('thumbnail scheduling', () => {
  it('runs at most two PDF renders at once', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const promises = Array.from({ length: 10 }, () =>
      scheduleThumbnail(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running--;
      }),
    );
    for (let i = 0; i < 10; i++) {
      while (!releases.length) await Promise.resolve();
      releases.shift()!();
      await Promise.resolve();
    }
    await Promise.all(promises);
    expect(peak).toBe(2);
  });

  it('does no queued rendering while hidden and resumes on visibility change without timers', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const render = vi.fn().mockResolvedValue('thumbnail');
    const result = scheduleThumbnail(render);
    await Promise.resolve();
    expect(render).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await expect(result).resolves.toBe('thumbnail');
  });

  it('removes obsolete requests before they spend CPU rendering', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const controller = new AbortController();
    const render = vi.fn().mockResolvedValue('thumbnail');
    const promise = scheduleThumbnail(render, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(render).not.toHaveBeenCalled();
  });
});
