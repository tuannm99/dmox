import { useCallback, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;

// Tracks whether the page was actively being wheel-scrolled just before the
// cursor entered a diagram, so we can tell "scrolling past it" apart from
// "stopped to zoom it" — see handleMouseEnter below.
let lastPageWheelAt = 0;
let wheelTrackingAttached = false;
const SCROLL_PASSTHROUGH_WINDOW_MS = 200;

function ensureWheelTracking() {
  if (wheelTrackingAttached || typeof window === 'undefined') return;
  wheelTrackingAttached = true;
  window.addEventListener(
    'wheel',
    (e) => {
      // Ignore wheel events on diagrams themselves (zoom or pass-through) —
      // only genuine page scrolling elsewhere should count as "recent scroll".
      if (e.target instanceof Element && e.target.closest('.mermaid-diagram-wrapper')) return;
      lastPageWheelAt = Date.now();
    },
    { passive: true, capture: true }
  );
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

export function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Set once per hover session (on mouse enter) and held until the cursor
  // leaves: true means "cursor arrived mid-scroll, let wheel keep scrolling
  // the page"; false means "cursor arrived at rest, wheel should zoom".
  const passThroughRef = useRef(false);

  useEffect(() => {
    ensureWheelTracking();
  }, []);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      initialized = true;
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: unknown) => setError(String(e)));
  }, [source]);

  const handleMouseEnter = useCallback(() => {
    passThroughRef.current = Date.now() - lastPageWheelAt < SCROLL_PASSTHROUGH_WINDOW_MS;
  }, []);

  const handleMouseLeave = useCallback(() => {
    passThroughRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (passThroughRef.current) return; // let the page keep scrolling through
    e.preventDefault();
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.0015)));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale === 1) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    },
    [scale, pan]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + (e.clientX - dragRef.current.startX), y: dragRef.current.panY + (e.clientY - dragRef.current.startY) });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (error) {
    return <pre className="mermaid-error">Mermaid render failed: {error}</pre>;
  }

  const zoomed = scale !== 1 || pan.x !== 0 || pan.y !== 0;

  return (
    <div
      className="mermaid-diagram-wrapper"
      onWheel={handleWheel}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {zoomed && (
        <button type="button" className="mermaid-reset-btn" onClick={resetZoom}>
          Reset zoom
        </button>
      )}
      <div
        className="mermaid-diagram"
        data-testid="mermaid-svg"
        ref={ref}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, cursor: scale > 1 ? 'grab' : 'zoom-in' }}
      />
    </div>
  );
}
