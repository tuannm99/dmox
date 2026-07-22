import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readScrollTop, restoreScrollTop, saveScrollTop } from './scrollMemory';

/**
 * jsdom has no layout, so scrollTop is a plain property with no clamping.
 * Give the element a fake scrolling box whose reachable maximum we control,
 * which is the whole point of the retry loop: a doc's height grows as async
 * content (Mermaid) renders, and an early assignment lands short.
 */
function scrollableEl(maxScrollTop: number) {
  const el = document.createElement('div');
  let top = 0;
  let max = maxScrollTop;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.min(v, max);
    },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', { get: () => max + 800, configurable: true });
  return {
    el,
    grow: (to: number) => {
      max = to;
    },
    // Emulate MermaidBlock nudging scrollTop after a diagram finishes rendering.
    nudge: (by: number) => {
      top = Math.min(top + by, max);
    },
  };
}

describe('scrollMemory', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a position per workspace and path', () => {
    saveScrollTop('ws', 'local/a.md', 420);
    expect(readScrollTop('ws', 'local/a.md')).toBe(420);
    expect(readScrollTop('ws', 'local/b.md')).toBe(0);
    expect(readScrollTop('other', 'local/a.md')).toBe(0);
  });

  it('forgets a doc once it is scrolled back to the top', () => {
    saveScrollTop('ws', 'local/a.md', 420);
    saveScrollTop('ws', 'local/a.md', 0);
    expect(readScrollTop('ws', 'local/a.md')).toBe(0);
  });

  describe('restoreScrollTop', () => {
    let raf: ReturnType<typeof vi.spyOn>;
    let pending: FrameRequestCallback[] = [];

    beforeEach(() => {
      pending = [];
      raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        pending.push(cb);
        return pending.length;
      });
    });
    afterEach(() => raf.mockRestore());

    const flushFrame = () => {
      const cbs = pending;
      pending = [];
      for (const cb of cbs) cb(0);
    };
    const flushFrames = (n: number) => {
      for (let i = 0; i < n; i++) flushFrame();
    };

    it('applies the target immediately', () => {
      const { el } = scrollableEl(2000);
      restoreScrollTop(el, 800);
      expect(el.scrollTop).toBe(800);
    });

    it('keeps re-applying until async content makes the target reachable', () => {
      const { el, grow } = scrollableEl(100); // diagrams not rendered yet
      restoreScrollTop(el, 800);
      expect(el.scrollTop).toBe(100);

      flushFrame();
      expect(el.scrollTop).toBe(100);

      grow(2000); // Mermaid finished rendering
      flushFrame();
      expect(el.scrollTop).toBe(800);
    });

    it("undoes MermaidBlock's layout-shift nudge, which is wrong during a restore", () => {
      const { el, grow, nudge } = scrollableEl(3000);
      restoreScrollTop(el, 800);
      expect(el.scrollTop).toBe(800);

      grow(4000);
      nudge(600); // a diagram above the target finished rendering
      expect(el.scrollTop).toBe(1400);

      flushFrame();
      expect(el.scrollTop).toBe(800);
    });

    it('stops once the height has held steady', () => {
      const { el } = scrollableEl(2000);
      restoreScrollTop(el, 800, { settleFrames: 3 });
      flushFrames(5);
      expect(pending).toHaveLength(0);
      expect(el.scrollTop).toBe(800);
    });

    it('gives up rather than fighting a user who has started scrolling', () => {
      const { el, grow } = scrollableEl(100);
      restoreScrollTop(el, 800);
      expect(el.scrollTop).toBe(100);

      el.dispatchEvent(new Event('wheel'));
      grow(2000);
      flushFrame();

      expect(el.scrollTop).toBe(100);
      expect(pending).toHaveLength(0);
    });

    it('stops when cancelled', () => {
      const { el, grow } = scrollableEl(100);
      const stop = restoreScrollTop(el, 800);
      stop();

      grow(2000);
      flushFrame();
      expect(el.scrollTop).toBe(100);
    });

    it('stops retrying once the deadline passes', () => {
      const { el } = scrollableEl(100);
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(0);
      restoreScrollTop(el, 800, { timeoutMs: 3000 });
      expect(pending).toHaveLength(1);

      now.mockReturnValue(4000);
      flushFrame();
      expect(pending).toHaveLength(0);
      now.mockRestore();
    });
  });
});
