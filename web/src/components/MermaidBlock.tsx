import { useCallback, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;

/** Nearest ancestor that actually scrolls (used to compensate its scrollTop
 * for the layout shift mermaid's async render causes — see the render
 * effect below). */
function findScrollableAncestor(el: Element): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      initialized = true;
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        const el = ref.current;
        if (!el) return;
        // mermaid.render() is async, so this element is empty (near-zero
        // height) until now, when it can suddenly grow to thousands of
        // pixels — a real, unavoidable layout shift since the diagram's
        // size isn't known until render completes. If the page is already
        // scrolled past where this diagram STARTS (its top edge, which
        // insertion doesn't move — only its bottom edge moves down), that
        // growth happens right at the user's current position, and their
        // view silently jumps to content near the top of the (now much
        // taller) diagram instead of what they were actually looking at.
        // Compensate by shifting scrollTop by exactly the height delta, so
        // the user's visual position doesn't move. (.content deliberately
        // disables the browser's own scroll anchoring — see styles.css — so
        // nothing else does this automatically.)
        const scrollParent = findScrollableAncestor(el);
        const heightBefore = el.getBoundingClientRect().height;
        const pastTop = scrollParent ? el.getBoundingClientRect().top <= scrollParent.getBoundingClientRect().top : false;
        el.innerHTML = svg;
        if (scrollParent && pastTop) {
          const heightAfter = el.getBoundingClientRect().height;
          scrollParent.scrollTop += heightAfter - heightBefore;
        }
      })
      .catch((e: unknown) => setError(String(e)));
  }, [source]);

  // Ctrl/Cmd + wheel zooms around the pointer, like Excalidraw/Figma/draw.io.
  // Bound natively rather than via React's onWheel because React attaches
  // wheel listeners passively at the root, where preventDefault() is ignored
  // — and without it the browser would run its own page zoom instead. A wheel
  // without the modifier is left completely alone so the page still scrolls
  // through a diagram taller than the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      setScale((prev) => {
        const next = clampScale(prev * Math.exp(-e.deltaY * 0.002));
        if (next === prev) return prev;
        // Keep whatever sits under the cursor pinned there. The element scales
        // about its own centre, so a point currently offset `d` from that
        // centre moves to d * next/prev — cancel that out through pan.
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const factor = 1 - next / prev;
        setPan((p) => ({ x: p.x + dx * factor, y: p.y + dy * factor }));
        return next;
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale === 1) return;
      // Without this the browser starts its own text/image drag-selection on
      // the SVG's <text> nodes, so panning paints everything blue instead of
      // moving the canvas.
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      setDragging(true);
    },
    [scale, pan]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + (e.clientX - dragRef.current.startX), y: dragRef.current.panY + (e.clientY - dragRef.current.startY) });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP));
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const copySource = useCallback(() => {
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [source]);

  if (error) {
    return <pre className="mermaid-error">Mermaid render failed: {error}</pre>;
  }

  return (
    <div className="mermaid-diagram-wrapper">
      <div className="mermaid-toolbar">
        <button type="button" onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'View Diagram' : 'View Code'}
        </button>
        <button type="button" onClick={copySource}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {!showCode && (
          <>
            <button type="button" onClick={zoomOut} disabled={scale <= MIN_SCALE} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={resetZoom}>
              {Math.round(scale * 100)}%
            </button>
            <button type="button" onClick={zoomIn} disabled={scale >= MAX_SCALE} aria-label="Zoom in">
              +
            </button>
          </>
        )}
      </div>
      <pre className="mermaid-source" hidden={!showCode}>
        <code>{source}</code>
      </pre>
      <div
        className="mermaid-diagram"
        data-testid="mermaid-svg"
        hidden={showCode}
        ref={ref}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
          // Only while zoomed in, where left-drag means "pan the canvas" — at
          // 100% there's nothing to pan, so leave the diagram's text
          // selectable/copyable as normal content.
          userSelect: scale > 1 ? 'none' : 'auto',
          // Only opt out of native touch/trackpad scrolling once actually
          // zoomed in, when drag-to-pan should take over — at the default
          // 100% there's nothing to pan, so the page must still scroll
          // normally through a diagram taller than the viewport.
          touchAction: scale > 1 ? 'none' : 'pan-y',
        }}
      />
    </div>
  );
}
