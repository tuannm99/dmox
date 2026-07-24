import { useEffect, useState } from 'react';
import type { Tab } from '../useTabs';

export interface TabBarProps {
  tabs: Tab[];
  activePath?: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  onCloseAll: () => void;
  onCopyPath: (path: string) => void;
  onReveal: (path: string) => void;
}

function baseName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function TabBar({
  tabs, activePath, onSelect, onClose, onCloseOthers, onCloseAll, onCopyPath, onReveal,
}: TabBarProps) {
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (tabs.length === 0) return null;

  return (
    <nav className="tab-bar" role="tablist">
      {tabs.map((t) => {
        const name = baseName(t.path);
        const active = t.path === activePath;
        return (
          <div
            key={t.path}
            role="tab"
            aria-selected={active}
            title={t.path}
            className={`tab${active ? ' active' : ''}${t.preview ? ' preview' : ''}`}
            onClick={() => onSelect(t.path)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.path);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ path: t.path, x: e.clientX, y: e.clientY });
            }}
          >
            <span className="tab-name">{name}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {menu && (
        <ul className="tab-menu" style={{ left: menu.x, top: menu.y }}>
          <li><button type="button" onClick={() => onClose(menu.path)}>Close</button></li>
          <li><button type="button" onClick={() => onCloseOthers(menu.path)}>Close Others</button></li>
          <li><button type="button" onClick={onCloseAll}>Close All</button></li>
          <li><button type="button" onClick={() => onCopyPath(menu.path)}>Copy Path</button></li>
          <li><button type="button" onClick={() => onReveal(menu.path)}>Reveal in Explorer</button></li>
        </ul>
      )}
    </nav>
  );
}
