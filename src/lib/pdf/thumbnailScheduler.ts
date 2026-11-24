// Thumbnail previews are background work: keep the visible page responsive, and
// don't start more rasterization while the window is hidden/minimized.
const maxConcurrentThumbnails = 2;
let active = 0;
const pending: { start: () => void }[] = [];
let listening = false;

function drain(): void {
  while (!document.hidden && active < maxConcurrentThumbnails && pending.length) {
    pending.shift()!.start();
  }
  if (!pending.length && listening) {
    document.removeEventListener('visibilitychange', drain);
    listening = false;
  }
}

export function scheduleThumbnail<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = pending.indexOf(job);
      if (index < 0) return;
      pending.splice(index, 1);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Thumbnail cancelled', 'AbortError'));
      drain();
    };
    const job = {
      start: () => {
        signal?.removeEventListener('abort', abort);
        active++;
        void Promise.resolve()
          .then(run)
          .then(resolve, reject)
          .finally(() => {
            active--;
            drain();
          });
      },
    };
    if (signal?.aborted) {
      reject(new DOMException('Thumbnail cancelled', 'AbortError'));
      return;
    }
    pending.push(job);
    signal?.addEventListener('abort', abort, { once: true });
    if (!listening) {
      document.addEventListener('visibilitychange', drain);
      listening = true;
    }
    drain();
  });
}
