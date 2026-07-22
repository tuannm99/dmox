const storageKey = (workspaceId: string, path: string) => `dmox-scroll-${workspaceId}:${path}`;

// sessionStorage, not localStorage: "put me back where I was" is about this
// tab's current visit — reload, or back/forward. A doc opened fresh next week
// should start at the top.
export function saveScrollTop(workspaceId: string, path: string, top: number) {
  if (!workspaceId || !path) return;
  try {
    if (top > 0) sessionStorage.setItem(storageKey(workspaceId, path), String(Math.round(top)));
    else sessionStorage.removeItem(storageKey(workspaceId, path));
  } catch {
    /* storage full or unavailable — position just won't be remembered */
  }
}

export function readScrollTop(workspaceId: string, path: string): number {
  if (!workspaceId || !path) return 0;
  try {
    const raw = Number(sessionStorage.getItem(storageKey(workspaceId, path)));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

const TAKEOVER_EVENTS = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

/**
 * Scroll `el` back to `target` and hold it there until the page stops
 * changing height.
 *
 * One assignment isn't enough, for two separate reasons:
 *
 *  - A doc's full height isn't known until its async content has rendered
 *    (Mermaid diagrams grow from near-zero to thousands of pixels), so an
 *    early assignment is clamped to whatever the container can scroll at that
 *    instant and lands short.
 *  - MermaidBlock deliberately nudges scrollTop when a diagram finishes
 *    rendering, to keep a *reading* user's view from jumping. During a
 *    restore that correction is wrong — the saved offset was measured against
 *    the finished layout — and every diagram above the target adds to the
 *    drift.
 *
 * So keep re-asserting the target every frame until the height has held
 * steady for `settleFrames`, the deadline passes, or the user takes over —
 * whichever comes first. Fighting a user who has already started scrolling
 * would be worse than not restoring at all.
 *
 * Returns a cleanup that stops the loop.
 */
export function restoreScrollTop(
  el: HTMLElement,
  target: number,
  { timeoutMs = 5000, settleFrames = 24 }: { timeoutMs?: number; settleFrames?: number } = {}
): () => void {
  let done = false;
  let frame = 0;
  let lastHeight = -1;
  let stable = 0;
  const deadline = Date.now() + timeoutMs;

  const stop = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    for (const type of TAKEOVER_EVENTS) el.removeEventListener(type, stop);
  };

  for (const type of TAKEOVER_EVENTS) el.addEventListener(type, stop, { passive: true });

  const tick = () => {
    if (done) return;
    el.scrollTop = target;

    const height = el.scrollHeight;
    if (height === lastHeight) stable += 1;
    else {
      lastHeight = height;
      stable = 0;
    }

    if (stable >= settleFrames || Date.now() >= deadline) {
      stop();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  tick();

  return stop;
}
