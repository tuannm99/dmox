# Editor Tab Bar (#9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code-style editor tab bar so several files stay open at once, surviving reload, without opening browser tabs.

**Architecture:** The URL stays the single source of truth for which tab is active — there is no `activeTab` state, so back/forward cannot desync. A `useTabs` hook owns the persisted tab list; navigation intent (preview vs permanent, restore-scroll vs top) travels through react-router's `location.state`.

**Tech Stack:** React + TypeScript, react-router v6, vitest + @testing-library/react. Frontend only — no backend, no datasource changes.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-editor-tab-bar-design.md`. It governs; this plan implements it.
- Frontend commands run from `/home/minhtuan/dev/local/dmox/web`: `npx vitest run <file>` for one file, `npx vitest run` for all, `npx tsc -b --force` for typecheck (must be clean before any commit).
- **Referential stability** (CLAUDE.md): never build a component map / render-prop inline per render such that its identity changes each render — it remounts the subtree and breaks scroll. Handlers passed to `TabBar` must be `useCallback`-stable.
- **`box-sizing: border-box` is global and `.content` is its own scroll container** (CLAUDE.md). Adding a row above `.content` requires converting `.content` from `height: 100%` to flex sizing, or it overflows by exactly the tab bar's height and silently cuts the last line.
- Storage key: `dmox-tabs-${workspaceId}` in `localStorage`. Storage access must be wrapped in try/catch — a failure means "tabs aren't remembered", never a crash.
- Tab `path` is the tree-form path, e.g. `local/sub/guide.md` (source id first). Route is `/w/:workspaceId/doc/*`.
- Commit trailer, exactly:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8
  ```
- Do NOT touch `config.yaml`, `docker-compose.override.yml`, or `resume` (unrelated uncommitted user files). Do not push.

## File Structure

- `web/src/useTabs.ts` (create) — tab list state + persistence. One responsibility: what tabs exist.
- `web/src/useTabs.test.ts` (create)
- `web/src/components/TabBar.tsx` (create) — presentational; renders tabs + context menu, calls handlers. Knows nothing about routing.
- `web/src/components/TabBar.test.tsx` (create)
- `web/src/routes/WorkspaceLayout.tsx` (modify) — wires URL ↔ tabs, owns navigation decisions.
- `web/src/components/TreeView.tsx` (modify) — carries preview/promote intent on file links.
- `web/src/routes/FileViewerPage.tsx` (modify) — widens the scroll-restore rule.
- `web/src/styles.css` (modify) — `.tab-bar`, `.tab`, `.tab-menu`, and the `.content` flex fix.

---

### Task 1: `useTabs` hook

**Files:**
- Create: `web/src/useTabs.ts`
- Create: `web/src/useTabs.test.ts`

**Interfaces:**
- Produces:
  - `export interface Tab { path: string; preview: boolean }`
  - `export function useTabs(workspaceId: string): { tabs: Tab[]; ensureTab(path: string, opts?: { preview?: boolean }): void; promote(path: string): void; close(path: string): void; closeOthers(path: string): void; closeAll(): void }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabs } from './useTabs';

beforeEach(() => localStorage.clear());

describe('useTabs', () => {
  it('adds a tab and does not duplicate an already-open path', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('local/a.md'));
    act(() => result.current.ensureTab('local/a.md'));
    expect(result.current.tabs).toEqual([{ path: 'local/a.md', preview: false }]);
  });

  it('replaces the reusable preview tab in place instead of piling up', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('local/keep.md'));
    act(() => result.current.ensureTab('local/a.md', { preview: true }));
    act(() => result.current.ensureTab('local/b.md', { preview: true }));
    expect(result.current.tabs).toEqual([
      { path: 'local/keep.md', preview: false },
      { path: 'local/b.md', preview: true },
    ]);
  });

  it('keeps a promoted tab when the next preview file is opened', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('local/a.md', { preview: true }));
    act(() => result.current.promote('local/a.md'));
    act(() => result.current.ensureTab('local/b.md', { preview: true }));
    expect(result.current.tabs.map((t) => t.path)).toEqual(['local/a.md', 'local/b.md']);
    expect(result.current.tabs[0].preview).toBe(false);
  });

  it('closes one, others, and all', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('a'));
    act(() => result.current.ensureTab('b'));
    act(() => result.current.ensureTab('c'));
    act(() => result.current.close('b'));
    expect(result.current.tabs.map((t) => t.path)).toEqual(['a', 'c']);
    act(() => result.current.closeOthers('c'));
    expect(result.current.tabs.map((t) => t.path)).toEqual(['c']);
    act(() => result.current.closeAll());
    expect(result.current.tabs).toEqual([]);
  });

  it('persists per workspace and restores on remount', () => {
    const first = renderHook(() => useTabs('ws1'));
    act(() => first.result.current.ensureTab('local/a.md'));
    first.unmount();
    const again = renderHook(() => useTabs('ws1'));
    expect(again.result.current.tabs.map((t) => t.path)).toEqual(['local/a.md']);
  });

  it('keeps workspaces isolated without remounting', () => {
    const { result, rerender } = renderHook(({ ws }) => useTabs(ws), { initialProps: { ws: 'ws1' } });
    act(() => result.current.ensureTab('local/a.md'));
    rerender({ ws: 'ws2' });
    expect(result.current.tabs).toEqual([]);
    act(() => result.current.ensureTab('local/b.md'));
    rerender({ ws: 'ws1' });
    expect(result.current.tabs.map((t) => t.path)).toEqual(['local/a.md']);
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('dmox-tabs-ws', '{not json');
    const { result } = renderHook(() => useTabs('ws'));
    expect(result.current.tabs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/useTabs.test.ts`
Expected: FAIL — cannot resolve `./useTabs`.

- [ ] **Step 3: Implement**

```ts
import { useCallback, useEffect, useState } from 'react';

export interface Tab {
  /** Tree-form path, source id first: "local/sub/guide.md". */
  path: string;
  /** A reusable "preview" tab (shown italic) — the next preview open replaces it. */
  preview: boolean;
}

const storageKey = (workspaceId: string) => `dmox-tabs-${workspaceId}`;

function readStored(workspaceId: string): Tab[] {
  if (!workspaceId) return [];
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is { path: string; preview?: unknown } => !!t && typeof (t as { path?: unknown }).path === 'string')
      .map((t) => ({ path: t.path, preview: t.preview === true }));
  } catch {
    return [];
  }
}

function initialState(workspaceId: string) {
  return { workspaceId, tabs: readStored(workspaceId) };
}

/**
 * The open tab list, remembered per workspace.
 *
 * Same shape as useActivePanel: the stored value is read during render and the
 * workspaceId is carried inside the state object, because WorkspaceLayout does
 * not remount when you switch workspaces — reading in an effect would persist
 * the previous workspace's tabs under the new workspace's key before
 * correcting itself.
 *
 * There is deliberately no "active tab" here: the active tab is whatever the
 * URL points at, so back/forward cannot fall out of sync with the tab strip.
 */
export function useTabs(workspaceId: string) {
  const [state, setState] = useState(() => initialState(workspaceId));
  const current = state.workspaceId === workspaceId ? state : initialState(workspaceId);

  if (state.workspaceId !== workspaceId) {
    setState(current);
  }

  useEffect(() => {
    if (!current.workspaceId) return;
    try {
      localStorage.setItem(storageKey(current.workspaceId), JSON.stringify(current.tabs));
    } catch {
      /* storage full or unavailable — tabs just won't be remembered */
    }
  }, [current.workspaceId, current.tabs]);

  const ensureTab = useCallback(
    (path: string, opts?: { preview?: boolean }) => {
      if (!path) return;
      const preview = opts?.preview === true;
      setState((s) => {
        if (s.tabs.some((t) => t.path === path)) return s;
        const next: Tab = { path, preview };
        const previewIdx = preview ? s.tabs.findIndex((t) => t.preview) : -1;
        if (previewIdx >= 0) {
          const tabs = s.tabs.slice();
          tabs[previewIdx] = next;
          return { workspaceId, tabs };
        }
        return { workspaceId, tabs: [...s.tabs, next] };
      });
    },
    [workspaceId]
  );

  const promote = useCallback(
    (path: string) => {
      setState((s) =>
        s.tabs.some((t) => t.path === path && t.preview)
          ? { workspaceId, tabs: s.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)) }
          : s
      );
    },
    [workspaceId]
  );

  const close = useCallback(
    (path: string) => setState((s) => ({ workspaceId, tabs: s.tabs.filter((t) => t.path !== path) })),
    [workspaceId]
  );

  const closeOthers = useCallback(
    (path: string) => setState((s) => ({ workspaceId, tabs: s.tabs.filter((t) => t.path === path) })),
    [workspaceId]
  );

  const closeAll = useCallback(() => setState({ workspaceId, tabs: [] }), [workspaceId]);

  return { tabs: current.tabs, ensureTab, promote, close, closeOthers, closeAll };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/useTabs.test.ts && npx tsc -b --force`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/useTabs.ts web/src/useTabs.test.ts
git commit -m "feat: useTabs hook for the editor tab list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 2: `TabBar` component + styles

**Files:**
- Create: `web/src/components/TabBar.tsx`
- Create: `web/src/components/TabBar.test.tsx`
- Modify: `web/src/styles.css` (append tab styles; the `.content` flex fix lands in Task 3 with the markup that needs it)

**Interfaces:**
- Consumes: `Tab` from `../useTabs` (Task 1).
- Produces: `export function TabBar(props: TabBarProps)` where
  ```ts
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
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

const tabs = [
  { path: 'local/a.md', preview: false },
  { path: 'local/sub/b.go', preview: true },
];

function setup(overrides = {}) {
  const handlers = {
    onSelect: vi.fn(), onClose: vi.fn(), onCloseOthers: vi.fn(),
    onCloseAll: vi.fn(), onCopyPath: vi.fn(), onReveal: vi.fn(),
    ...overrides,
  };
  const utils = render(<TabBar tabs={tabs} activePath="local/a.md" {...handlers} />);
  return { ...utils, ...handlers };
}

describe('TabBar', () => {
  it('renders nothing when there are no tabs', () => {
    const { container } = render(
      <TabBar tabs={[]} onSelect={vi.fn()} onClose={vi.fn()} onCloseOthers={vi.fn()}
        onCloseAll={vi.fn()} onCopyPath={vi.fn()} onReveal={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one tab per file by base name, marking the active one', () => {
    setup();
    const active = screen.getByRole('tab', { name: /a\.md/ });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /b\.go/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('marks a preview tab so it reads as temporary', () => {
    const { container } = setup();
    expect(container.querySelector('.tab.preview')).toHaveTextContent('b.go');
  });

  it('selects a tab on click and closes it on the close button', () => {
    const { onSelect, onClose } = setup();
    fireEvent.click(screen.getByRole('tab', { name: /b\.go/ }));
    expect(onSelect).toHaveBeenCalledWith('local/sub/b.go');
    fireEvent.click(screen.getByRole('button', { name: 'Close b.go' }));
    expect(onClose).toHaveBeenCalledWith('local/sub/b.go');
  });

  it('closes on middle click without also selecting', () => {
    const { onClose, onSelect } = setup();
    fireEvent.auxClick(screen.getByRole('tab', { name: /a\.md/ }), { button: 1 });
    expect(onClose).toHaveBeenCalledWith('local/a.md');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers the context menu actions for the right-clicked tab', () => {
    const { onCloseOthers, onCopyPath, onReveal } = setup();
    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Others' }));
    expect(onCloseOthers).toHaveBeenCalledWith('local/a.md');

    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Path' }));
    expect(onCopyPath).toHaveBeenCalledWith('local/a.md');

    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Explorer' }));
    expect(onReveal).toHaveBeenCalledWith('local/a.md');
  });

  it('does not remount its tabs when the parent re-renders', () => {
    const { container, rerender } = setup();
    const first = container.querySelector('.tab');
    rerender(
      <TabBar tabs={tabs} activePath="local/a.md" onSelect={vi.fn()} onClose={vi.fn()}
        onCloseOthers={vi.fn()} onCloseAll={vi.fn()} onCopyPath={vi.fn()} onReveal={vi.fn()} />
    );
    expect(container.querySelector('.tab')).toBe(first);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/components/TabBar.test.tsx`
Expected: FAIL — cannot resolve `./TabBar`.

- [ ] **Step 3: Implement `TabBar.tsx`**

```tsx
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
```

- [ ] **Step 4: Append styles to `web/src/styles.css`**

```css
.tab-bar {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
  overflow-x: auto;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  border-right: 1px solid rgba(128, 128, 128, 0.2);
  font-size: 13px;
}

.tab.active {
  background: rgba(99, 102, 241, 0.16);
  font-weight: 600;
}

.tab.preview .tab-name {
  font-style: italic;
}

.tab-close {
  border: 0;
  background: transparent;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.6;
}

.tab-close:hover {
  opacity: 1;
}

.tab-menu {
  position: fixed;
  z-index: 50;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  min-width: 160px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  background: Canvas;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

.tab-menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.tab-menu button:hover {
  background: rgba(99, 102, 241, 0.16);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/components/TabBar.test.tsx && npx tsc -b --force`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/components/TabBar.tsx web/src/components/TabBar.test.tsx web/src/styles.css
git commit -m "feat: TabBar component with close, middle-click and context menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 3: Wire tabs into `WorkspaceLayout`

**Files:**
- Modify: `web/src/routes/WorkspaceLayout.tsx`
- Modify: `web/src/styles.css` (the `.content` flex fix — see Step 4, this is required, not cosmetic)
- Modify: `web/src/routes/WorkspaceLayout.test.tsx` (add the tests below; mirror the file's existing mock/setup style)

**Interfaces:**
- Consumes: `useTabs` (Task 1), `TabBar` (Task 2).
- Produces: file links receive `onOpenFile`-style intent in Task 4; `promote` is threaded to `TreeView` as the `onPromoteTab` prop with signature `(path: string) => void`.

**Context you need (already in the file):**
- `const location = useLocation();` exists (line ~76) and `currentPath` is derived from it (line ~80): `location.pathname.startsWith(docPrefix) ? location.pathname.slice(docPrefix.length) : undefined`.
- `expandAncestors(path)` comes from `useExpandedFolders` and is already used to reveal the active file.
- **There is an existing effect that calls `resetScroll()` on every `location.pathname` change** (~line 230). Leave it alone. Restoring still wins because `restoreScrollTop` re-asserts the target every frame until the height settles — this is the same sequence the existing reload/back restore already relies on.

- [ ] **Step 1: Write the failing tests** (append to `web/src/routes/WorkspaceLayout.test.tsx`, matching its existing render helper and datasource mock)

```tsx
it('opens a tab for the file in the URL and marks it active', async () => {
  renderLayoutAt('/w/ws/doc/local/guide.md'); // use this file's existing render helper
  expect(await screen.findByRole('tab', { name: /guide\.md/ })).toHaveAttribute('aria-selected', 'true');
});

it('closing the active tab moves to the neighbouring tab', async () => {
  renderLayoutAt('/w/ws/doc/local/guide.md');
  await screen.findByRole('tab', { name: /guide\.md/ });
  // open a second file from the tree, then close the active one
  fireEvent.click(await screen.findByRole('link', { name: /other\.md/ }));
  await screen.findByRole('tab', { name: /other\.md/ });
  fireEvent.click(screen.getByRole('button', { name: 'Close other.md' }));
  expect(await screen.findByRole('tab', { name: /guide\.md/ })).toHaveAttribute('aria-selected', 'true');
});
```

> Read `WorkspaceLayout.test.tsx` first and reuse its existing setup (datasource mock incl. `getGitStatus`/`getGitWorkingDiff`, router wrapper, tree fixture). If its fixture has only one file, add a second markdown file to the fixture tree so the neighbour test is meaningful.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/routes/WorkspaceLayout.test.tsx`
Expected: FAIL — no `tab` role in the document.

- [ ] **Step 3: Implement the wiring in `WorkspaceLayout.tsx`**

Add imports:
```tsx
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTabs } from '../useTabs';
import { TabBar } from '../components/TabBar';
```

Inside the component, after the existing hooks:
```tsx
const navigate = useNavigate();
const { tabs, ensureTab, promote, close, closeOthers, closeAll } = useTabs(workspaceId);

// The URL is the source of truth for which tab is active; this only makes sure
// a tab exists for whatever the URL points at. `preview` comes from the link
// that navigated here (see TreeView) — a reload or back/forward carries no
// state, and the tab is already in the persisted list with its own flag.
useEffect(() => {
  if (!currentPath) return;
  const preview = (location.state as { preview?: boolean } | null)?.preview === true;
  ensureTab(currentPath, { preview });
}, [currentPath, location.state, ensureTab]);

const goToTab = useCallback(
  (path: string) => navigate(`/w/${workspaceId}/doc/${path}`, { state: { restoreScroll: true } }),
  [navigate, workspaceId]
);

const closeTab = useCallback(
  (path: string) => {
    // Only the active tab forces a navigation; closing a background tab must
    // leave the reader where they are.
    if (path === currentPath) {
      const idx = tabs.findIndex((t) => t.path === path);
      const next = tabs[idx + 1] ?? tabs[idx - 1];
      if (next) navigate(`/w/${workspaceId}/doc/${next.path}`, { state: { restoreScroll: true } });
      else navigate(`/w/${workspaceId}`);
    }
    close(path);
  },
  [close, currentPath, navigate, tabs, workspaceId]
);

const closeOtherTabs = useCallback((path: string) => {
  closeOthers(path);
  if (path !== currentPath) navigate(`/w/${workspaceId}/doc/${path}`, { state: { restoreScroll: true } });
}, [closeOthers, currentPath, navigate, workspaceId]);

const closeAllTabs = useCallback(() => {
  closeAll();
  navigate(`/w/${workspaceId}`);
}, [closeAll, navigate, workspaceId]);

const copyTabPath = useCallback((path: string) => {
  navigator.clipboard?.writeText(path);
}, []);

// Reveal = expand the tree down to the file and make it active; the existing
// reveal effect then scrolls the highlighted node into view.
const revealTab = useCallback((path: string) => {
  expandAncestors(path);
  if (path !== currentPath) navigate(`/w/${workspaceId}/doc/${path}`, { state: { restoreScroll: true } });
}, [currentPath, expandAncestors, navigate, workspaceId]);
```

Replace the `<main className="content">` block (currently lines ~298-300) with:
```tsx
        <div className="content-area">
          <TabBar
            tabs={tabs}
            activePath={currentPath}
            onSelect={goToTab}
            onClose={closeTab}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeAllTabs}
            onCopyPath={copyTabPath}
            onReveal={revealTab}
          />
          <main className="content" ref={contentRef}>
            <Outlet context={{ tree, scrollToTop, resetScroll, contentRef, fileChangeEvent } satisfies WorkspaceOutletContext} />
          </main>
        </div>
```

Also pass `onPromoteTab={promote}` to the existing `<TreeView ... />` element (the prop is consumed in Task 4).

- [ ] **Step 4: Fix `.content` sizing in `web/src/styles.css` (required)**

`.content` currently has `height: 100%`. It is now a flex-column child sitting under the tab bar, so `height: 100%` would make it overflow its parent by exactly the tab bar's height — and because the shell clips overflow, the last line of every document would be silently cut off (the failure mode called out in CLAUDE.md). Change `.content`'s `height: 100%;` to `min-height: 0;` and add the new wrapper:

```css
.content-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
```

Leave `.content`'s `flex: 1`, `overflow-y: auto`, `overflow-anchor: none`, and both paddings exactly as they are.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run && npx tsc -b --force`
Expected: whole suite PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/routes/WorkspaceLayout.tsx web/src/routes/WorkspaceLayout.test.tsx web/src/styles.css
git commit -m "feat: render the tab bar and drive tabs from the URL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 4: Preview/promote intent on tree file links

**Files:**
- Modify: `web/src/components/TreeView.tsx`
- Modify: `web/src/components/TreeView.test.tsx`

**Interfaces:**
- Consumes: `onPromoteTab` passed from `WorkspaceLayout` (Task 3).
- Produces: file `<Link>`s carry `state={{ preview: true }}` and promote on double click.

- [ ] **Step 1: Write the failing test** (append to `web/src/components/TreeView.test.tsx`, mirroring its existing render helper)

```tsx
it('promotes a previewed file to a permanent tab on double click', () => {
  const onPromoteTab = vi.fn();
  renderTree({ onPromoteTab }); // use this file's existing helper/props shape
  fireEvent.doubleClick(screen.getByRole('link', { name: /guide\.md/ }));
  expect(onPromoteTab).toHaveBeenCalledWith('local/guide.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/components/TreeView.test.tsx`
Expected: FAIL — `onPromoteTab` never called (prop not wired).

- [ ] **Step 3: Implement**

Add to the props interfaces (`TreeView` and `TreeNodeItem` both take it, alongside the existing `TreeGitProps` etc.):
```tsx
export interface TreeTabProps {
  /** Double-clicking a file turns its reusable preview tab into a permanent one. */
  onPromoteTab?: (path: string) => void;
}
```
Thread `onPromoteTab` through `TreeView` → `TreeNodeItem` → recursive children exactly like `gitStatus` is threaded today.

Change the file `<Link>` (currently at the bottom of `TreeNodeItem`) to:
```tsx
        <Link
          className={active ? 'tree-file active' : 'tree-file'}
          to={`/w/${workspaceId}/doc/${node.path}`}
          state={{ preview: true }}
          onDoubleClick={() => onPromoteTab?.(node.path)}
        >
```

> Keep it a `<Link>` (do not swap to a button): middle-click and ctrl-click must keep their normal browser behaviour.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/components/TreeView.test.tsx && npx tsc -b --force`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/components/TreeView.tsx web/src/components/TreeView.test.tsx
git commit -m "feat: single click previews a file, double click pins its tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 5: Restore scroll when switching tabs

**Files:**
- Modify: `web/src/routes/FileViewerPage.tsx` (the scroll effect at ~line 58-72)
- Modify: `web/src/routes/FileViewerPage.test.tsx` (or add `FileViewerPage.scroll.test.tsx`, mirroring the existing mock style)

**Interfaces:**
- Consumes: `location.state.restoreScroll` set by `WorkspaceLayout`'s tab navigation (Task 3).

**Why:** today the effect restores only when `navigationType === 'POP'` (reload / back-forward) and otherwise resets to top. Clicking a tab is a PUSH, so without this change switching tabs would throw away the reading position — contradicting the spec's "switching tabs must not lose your place".

- [ ] **Step 1: Write the failing test**

```tsx
it('restores the saved position when a tab click asks for it', async () => {
  saveScrollTop('ws', 'local/guide.md', 1200);
  // render FileViewerPage at /w/ws/doc/local/guide.md with router state
  // { restoreScroll: true } (a PUSH, not a POP), using this file's existing
  // helper + a contentRef whose element has scrollHeight > clientHeight.
  await waitFor(() => expect(contentEl.scrollTop).toBe(1200));
});

it('still starts at the top when a file is opened fresh from the tree', async () => {
  saveScrollTop('ws', 'local/guide.md', 1200);
  // same, but with no router state at all
  await waitFor(() => expect(contentEl.scrollTop).toBe(0));
});
```

> Read the existing `FileViewerPage.test.tsx` first: reuse its datasource mock, its outlet-context shape (`contentRef`, `resetScroll`), and its router wrapper. `MemoryRouter` takes state via `initialEntries={[{ pathname: '...', state: { restoreScroll: true } }]}`. jsdom gives elements zero height, so set `scrollHeight`/`clientHeight` on the stub element the way the existing scroll tests do.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/routes/FileViewerPage.test.tsx`
Expected: FAIL — first test sees `scrollTop` 0 because the PUSH path resets.

- [ ] **Step 3: Implement**

Ensure `useLocation` is imported from `react-router-dom` in `FileViewerPage.tsx`, and add near the other hooks:
```tsx
const location = useLocation();
```

In the scroll effect, replace the condition
```tsx
    if (el && saved > 0 && navigationType === 'POP' && restoredForRef.current !== wildcardPath) {
```
with
```tsx
    // A reload or back/forward ('POP') restores, and so does clicking a tab —
    // WorkspaceLayout flags those navigations, because switching tabs must not
    // lose your place. Opening a file fresh from the tree carries no flag and
    // still starts at the top.
    const askedToRestore = (location.state as { restoreScroll?: boolean } | null)?.restoreScroll === true;
    if (el && saved > 0 && (navigationType === 'POP' || askedToRestore) && restoredForRef.current !== wildcardPath) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run && npx tsc -b --force`
Expected: whole suite PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/routes/FileViewerPage.tsx web/src/routes/FileViewerPage.test.tsx
git commit -m "feat: keep your reading position when switching tabs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 6: Full gate, real-app check, docs

**Files:**
- Modify: `docs/roadmap/2026-07-20-technical-backlog.md` (#9 row + section)

- [ ] **Step 1: Full gate**

Run:
```bash
cd /home/minhtuan/dev/local/dmox/web && npx vitest run && npx tsc -b --force
cd /home/minhtuan/dev/local/dmox && CGO_ENABLED=1 go test -tags sqlite_fts5 ./... && gofmt -l .
```
Expected: vitest all PASS, tsc clean, backend PASS (unchanged by this feature), `gofmt -l .` prints nothing.

- [ ] **Step 2: Real-app check**

Run `make build && ./bin/dmox serve` (or `make run`) and confirm in the browser, with a hard refresh:
1. Single-clicking three files in the tree leaves **one** italic preview tab, not three.
2. Double-clicking a file makes its tab permanent; the next single click opens a separate preview tab.
3. Scroll down a long doc, switch to another tab, switch back → you land where you left off.
4. Reload → the tab strip and the active tab come back.
5. Closing the active tab moves to a neighbour; closing the last one returns to the workspace page.
6. The last line of a long document is still fully visible (the `.content` sizing change).

- [ ] **Step 3: Update the backlog** — flip #9 to 🟢 in the status table and its section, recording anything only found by running it.

- [ ] **Step 4: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add docs/roadmap/2026-07-20-technical-backlog.md
git commit -m "docs: mark backlog #9 (Editor Tab Bar) done

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

## Self-Review

**Spec coverage:**
- §2 #1 preview tabs → Task 1 (`ensureTab` replace-in-place, `promote`) + Task 4 (click/double-click intent). ✓
- §2 #2 localStorage per workspace → Task 1. ✓
- §2 #3 URL is source of truth / no `activeTab` → Task 1 (none stored) + Task 3 (`activePath={currentPath}`). ✓
- §2 #4 + §4.3 scroll on tab switch → Task 5. ✓
- §2 #5 deleted file keeps its tab → no code needed: nothing closes tabs on delete, and `FileViewerPage`'s existing deleted-file banner shows. Verified as a non-task, not a gap.
- §4.1 hook API → Task 1. §4.2 intent via `location.state` → Tasks 3+4. §4.4 TabBar incl. middle-click, context menu, `title`, italic preview, stability test → Task 2; placement + `box-sizing`/height constraint → Task 3 Step 4. §4.5 close semantics → Task 3 (`closeTab`). ✓
- §5 testing → Tasks 1,2,3,5 (integration incl. back/forward-sensitive active-tab assertion via URL-derived active). ✓
- §6 out of scope → not implemented. ✓

**Placeholder scan:** Tasks 3, 4, 5 tell the implementer to read the existing test file and mirror its helper/mock rather than pasting a fabricated harness — deliberate, since those helpers exist and inventing a parallel one would be worse. The assertions themselves are given concretely. No "TBD"/"handle edge cases"/"add tests for the above" anywhere.

**Type consistency:** `Tab { path, preview }` (Task 1) is what `TabBarProps.tabs` consumes (Task 2). `ensureTab(path, { preview })`, `promote(path)`, `close/closeOthers(path)`, `closeAll()` are used with exactly those signatures in Task 3. `onPromoteTab: (path: string) => void` is produced in Task 3 and consumed in Task 4 under the same name. `location.state.preview` (Task 4 → Task 3) and `location.state.restoreScroll` (Task 3 → Task 5) match in both directions. ✓
