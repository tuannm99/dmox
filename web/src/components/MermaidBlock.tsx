import { useCallback, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;

export function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
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
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: unknown) => setError(String(e)));
  }, [source]);

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
          cursor: scale > 1 ? 'grab' : 'default',
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
