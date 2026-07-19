import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const PANEL_WIDTH_KEY = 'dmox-panel-width';
const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 600;
const DEFAULT_PANEL_WIDTH = 260;

function readStoredPanelWidth(): number {
  const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
  return stored >= MIN_PANEL_WIDTH && stored <= MAX_PANEL_WIDTH ? stored : DEFAULT_PANEL_WIDTH;
}

export function RightPanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(readStoredPanelWidth);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStartRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
    },
    [width]
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: MouseEvent) {
      if (!dragStartRef.current) return;
      // The resize handle sits on the panel's LEFT edge, so dragging left
      // (negative clientX delta) grows the panel — the inverse of the
      // sidebar's resize math, which grows by dragging its right edge right.
      const delta = e.clientX - dragStartRef.current.startX;
      const next = dragStartRef.current.startWidth - delta;
      setWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, next)));
    }
    function onUp() {
      dragStartRef.current = null;
      setDragging(false);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    document.body.style.cursor = dragging ? 'col-resize' : '';
    document.body.style.userSelect = dragging ? 'none' : '';
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  return (
    <div className={open ? 'right-panel' : 'right-panel closed'} style={{ width }}>
      <div
        className="right-panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onMouseDown={handleResizeMouseDown}
      />
      <div className="right-panel-inner">
        <div className="right-panel-header">
          <span>{title}</span>
          <button type="button" className="right-panel-close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </div>
        <div className="right-panel-body">{children}</div>
      </div>
    </div>
  );
}
