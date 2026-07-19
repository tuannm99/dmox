# Right-Side Toggle Panels (Terminal / Search / AI Context) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/search`, `/ai-context`, `/terminal` routes with a single resizable right-side panel that docks next to doc content, toggled by topnav buttons and keyboard shortcuts, whose contents lazy-mount once and never unmount for the life of the workspace — fixing the bug where switching away from Terminal kills its shell process.

**Architecture:** `WorkspaceLayout` owns `activePanel`/`openedPanels` state and a merged keymap (code defaults ← optional `config.yaml` override fetched from a new `GET /api/keymap`). A new `RightPanel` component provides the resizable chrome; `TerminalPanel`/`SearchPanel`/`AIContextPanel` (adapted from the current route pages) render inside it as permanently-mounted siblings, hidden via the `hidden` DOM attribute (never conditionally rendered) so their internal state — most importantly `TerminalPanel`'s WebSocket/PTY session — survives being toggled off-screen.

**Tech Stack:** React 18 + TypeScript + Vite (`web/`), react-router-dom v6, `@xterm/xterm` + `@xterm/addon-fit`, Vitest + Testing Library; Go 1.x + Gin (`internal/api`), `gopkg.in/yaml.v3` config.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-right-side-panels-design.md` — read it before starting if anything below is ambiguous.
- Only one panel visible at a time; all three, once opened, stay mounted (hidden, not unmounted) until the workspace changes or the page reloads.
- Panel docks (pushes content), does not overlay; resizable like the existing left sidebar, width persisted to `localStorage['dmox-panel-width']`, bounds `MIN_PANEL_WIDTH=160`, `MAX_PANEL_WIDTH=600`, `DEFAULT_PANEL_WIDTH=260`.
- Default keybindings (binding strings use `mod` for Ctrl/⌘, resolved per-platform): `terminal` → `` mod+` ``, `search` → `mod+shift+f`, `ai-context` → `mod+shift+a`.
- Keymap defaults live in frontend code (`web/src/keymap.ts`); overridable via a new optional `keymap:` map in `config.yaml`, exposed read-only via `GET /api/keymap` (top-level route, not workspace-scoped).
- Out of scope (do not implement): backend session persistence across page reload/workspace switch, multiple panels open simultaneously, an in-app keymap editor UI, any change to `dmox build`/static export.
- Existing patterns to follow, not reinvent: the sidebar's drag-to-resize implementation in `web/src/routes/WorkspaceLayout.tsx` (`handleResizeMouseDown`/`dragging`/`localStorage` width persistence), the `*Panel.tsx` naming/prop convention already used by `web/src/components/GitHistoryPanel.tsx` (`{ workspaceId, ... }` props, no internal routing), and the Go handler/test conventions in `internal/api/workspace_handlers.go` + `internal/api/server_test.go` (`newTestApp(t)` helper).

---

### Task 1: Backend — `keymap` config field + `GET /api/keymap`

**Files:**
- Modify: `internal/config/config.go`
- Create: `internal/api/keymap_handlers.go`
- Modify: `internal/api/server.go`
- Test: `internal/api/keymap_handlers_test.go`

**Interfaces:**
- Produces: `config.Config.Keymap map[string]string` (yaml tag `keymap`); `GET /api/keymap` → `200 application/json`, body is `cfg.Keymap` (or `{}` if nil).

- [ ] **Step 1: Write the failing tests**

Create `internal/api/keymap_handlers_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPI_Keymap_EmptyWhenNotConfigured(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/keymap")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out) != 0 {
		t.Fatalf("keymap = %+v, want empty", out)
	}
}

func TestAPI_Keymap_ReturnsConfiguredOverrides(t *testing.T) {
	a := newTestApp(t)
	a.Cfg.Keymap = map[string]string{"terminal": "mod+j"}
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/keymap")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if out["terminal"] != "mod+j" {
		t.Fatalf("keymap = %+v, want terminal=mod+j", out)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/... -run TestAPI_Keymap -v`
Expected: compile error — `a.Cfg.Keymap` undefined (field doesn't exist on `config.Config` yet).

- [ ] **Step 3: Add the config field**

In `internal/config/config.go`, add `Keymap` to the `Config` struct (right after `DataDir`):

```go
type Config struct {
	Workspaces []Workspace      `yaml:"workspaces"`
	Embeddings EmbeddingsConfig `yaml:"embeddings"`
	Render     RenderConfig     `yaml:"render"`
	Server     ServerConfig     `yaml:"server"`
	DataDir    string           `yaml:"data_dir"`
	Keymap     map[string]string `yaml:"keymap"`
}
```

No defaults/validation needed — an absent or unrecognized key is simply ignored by the frontend merge logic (Task 2).

- [ ] **Step 4: Add the handler**

Create `internal/api/keymap_handlers.go`:

```go
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

func handleKeymap(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		overrides := a.Cfg.Keymap
		if overrides == nil {
			overrides = map[string]string{}
		}
		c.JSON(http.StatusOK, overrides)
	}
}
```

- [ ] **Step 5: Register the route**

In `internal/api/server.go`, inside `NewRouter`, add the route next to `handleListWorkspaces` (top-level, not workspace-scoped — keymap is a user preference, not workspace data):

```go
	g.GET("/workspaces", handleListWorkspaces(a))
	g.GET("/keymap", handleKeymap(a))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/... -run TestAPI_Keymap -v`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add internal/config/config.go internal/api/keymap_handlers.go internal/api/keymap_handlers_test.go internal/api/server.go
git commit -m "feat(api): add GET /api/keymap backed by optional config.yaml keymap overrides"
```

---

### Task 2: Frontend — `keymap.ts` module

**Files:**
- Create: `web/src/keymap.ts`
- Test: `web/src/keymap.test.ts`

**Interfaces:**
- Produces: `type PanelKind = 'terminal' | 'search' | 'ai-context'`; `type Keymap = Record<PanelKind, string>`; `defaultKeymap: Keymap`; `matches(event: KeyboardEvent, binding: string): boolean`; `mergeKeymap(overrides: Partial<Record<string, string>>): Keymap`; `fetchKeymapOverrides(): Promise<Partial<Record<string, string>>>`.
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write the failing tests**

Create `web/src/keymap.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultKeymap, matches, mergeKeymap, fetchKeymapOverrides } from './keymap';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('matches', () => {
  it('matches a plain mod+key binding using ctrlKey on non-Mac', () => {
    const event = new KeyboardEvent('keydown', { key: '`', ctrlKey: true });
    expect(matches(event, defaultKeymap.terminal)).toBe(true);
  });

  it('does not match when the modifier is missing', () => {
    const event = new KeyboardEvent('keydown', { key: '`', ctrlKey: false });
    expect(matches(event, defaultKeymap.terminal)).toBe(false);
  });

  it('does not match when an unrelated key is pressed', () => {
    const event = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true });
    expect(matches(event, defaultKeymap.terminal)).toBe(false);
  });

  it('requires shift when the binding specifies it', () => {
    const withoutShift = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: false });
    const withShift = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true });
    expect(matches(withoutShift, defaultKeymap.search)).toBe(false);
    expect(matches(withShift, defaultKeymap.search)).toBe(true);
  });

  it('uses metaKey instead of ctrlKey on Mac', () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel' });
    const event = new KeyboardEvent('keydown', { key: '`', metaKey: true });
    expect(matches(event, defaultKeymap.terminal)).toBe(true);
  });
});

describe('mergeKeymap', () => {
  it('overrides only the actions present in the override map', () => {
    const merged = mergeKeymap({ terminal: 'mod+j' });
    expect(merged.terminal).toBe('mod+j');
    expect(merged.search).toBe(defaultKeymap.search);
    expect(merged['ai-context']).toBe(defaultKeymap['ai-context']);
  });

  it('ignores unknown keys in the override map', () => {
    const merged = mergeKeymap({ bogus: 'mod+z' } as any);
    expect(merged).toEqual(defaultKeymap);
  });
});

describe('fetchKeymapOverrides', () => {
  it('returns the parsed JSON body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ terminal: 'mod+j' }) }));
    await expect(fetchKeymapOverrides()).resolves.toEqual({ terminal: 'mod+j' });
  });

  it('returns {} when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchKeymapOverrides()).resolves.toEqual({});
  });

  it('returns {} on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchKeymapOverrides()).resolves.toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run keymap.test.ts`
Expected: FAIL — `./keymap` module not found.

- [ ] **Step 3: Implement `keymap.ts`**

Create `web/src/keymap.ts`:

```ts
export type PanelKind = 'terminal' | 'search' | 'ai-context';
export type Keymap = Record<PanelKind, string>;

export const defaultKeymap: Keymap = {
  terminal: 'mod+`',
  search: 'mod+shift+f',
  'ai-context': 'mod+shift+a',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? '');

export function matches(event: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantShift = parts.includes('shift');
  const wantMod = parts.includes('mod');

  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherModPressed = isMac ? event.ctrlKey : event.metaKey;

  if (wantMod !== modPressed) return false;
  if (otherModPressed) return false;
  if (wantShift !== event.shiftKey) return false;

  return event.key.toLowerCase() === key;
}

export function mergeKeymap(overrides: Partial<Record<string, string>>): Keymap {
  const merged = { ...defaultKeymap };
  for (const action of Object.keys(defaultKeymap) as PanelKind[]) {
    const override = overrides[action];
    if (typeof override === 'string') merged[action] = override;
  }
  return merged;
}

export async function fetchKeymapOverrides(): Promise<Partial<Record<string, string>>> {
  try {
    const res = await fetch('/api/keymap');
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run keymap.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add web/src/keymap.ts web/src/keymap.test.ts
git commit -m "feat(web): add keymap module with cross-platform binding matcher"
```

---

### Task 3: Frontend — `RightPanel` component

**Files:**
- Create: `web/src/components/RightPanel.tsx`
- Test: `web/src/components/RightPanel.test.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Produces: `RightPanel({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode })` — a JSX component.
- Consumes: nothing beyond React/DOM APIs.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/RightPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RightPanel } from './RightPanel';

beforeEach(() => {
  localStorage.clear();
});

describe('RightPanel', () => {
  it('renders the title, close button, and children', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <RightPanel open title="Terminal" onClose={onClose}>
        <div>panel content</div>
      </RightPanel>
    );
    fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps children rendered even when closed (hidden via CSS, not unmounted)', () => {
    const { container } = render(
      <RightPanel open={false} title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(container.querySelector('.right-panel')).toHaveClass('closed');
  });

  it('defaults to 260px width and resizes by dragging the left edge, persisting to localStorage', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = handle.parentElement as HTMLElement;
    expect(panel.style.width).toBe('260px');

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 50 }); // dragged left by 50 -> grows
    fireEvent.mouseUp(window, { clientX: 50 });

    expect(panel.style.width).toBe('310px');
    expect(localStorage.getItem('dmox-panel-width')).toBe('310');
  });

  it('clamps width to the 160-600 bounds', () => {
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = handle.parentElement as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 1000 }); // dragged right by 900 -> shrinks past min
    fireEvent.mouseUp(window, { clientX: 1000 });

    expect(panel.style.width).toBe('160px');
  });

  it('restores a previously persisted width on mount', () => {
    localStorage.setItem('dmox-panel-width', '400');
    render(
      <RightPanel open title="Terminal" onClose={() => {}}>
        <div>panel content</div>
      </RightPanel>
    );
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    expect((handle.parentElement as HTMLElement).style.width).toBe('400px');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run RightPanel.test.tsx`
Expected: FAIL — `./RightPanel` module not found.

- [ ] **Step 3: Implement `RightPanel.tsx`**

Create `web/src/components/RightPanel.tsx`:

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run RightPanel.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Add CSS**

In `web/src/styles.css`, add after the existing `.sidebar-resizer` / `.workspace-shell.resizing` rules (around line 93):

```css
.right-panel {
  flex-shrink: 0;
  height: 100%;
  display: flex;
  box-sizing: border-box;
}

.right-panel.closed {
  display: none;
}

.right-panel-resizer {
  flex-shrink: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  background: #8882;
  touch-action: none;
}

.right-panel-resizer:hover,
.right-panel-resizer:active {
  background: #6366f180;
}

.right-panel-inner {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #8884;
  font-size: 0.85rem;
  font-weight: 600;
}

.right-panel-close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  color: inherit;
}

.right-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/RightPanel.tsx web/src/components/RightPanel.test.tsx web/src/styles.css
git commit -m "feat(web): add resizable RightPanel shell component"
```

---

### Task 4: Frontend — `SearchPanel` and `AIContextPanel`

**Files:**
- Create: `web/src/components/SearchPanel.tsx`, `web/src/components/SearchPanel.test.tsx`
- Create: `web/src/components/AIContextPanel.tsx`, `web/src/components/AIContextPanel.test.tsx`
- Delete: `web/src/routes/SearchPage.tsx`, `web/src/routes/SearchPage.test.tsx`, `web/src/routes/AIContextPage.tsx`, `web/src/routes/AIContextPage.test.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Produces: `SearchPanel({ workspaceId, onNavigate }: { workspaceId: string; onNavigate: () => void })`; `AIContextPanel({ workspaceId, onNavigate }: { workspaceId: string; onNavigate: () => void })`.
- Consumes: `useDataSource()` from `../datasource/context` (unchanged interface).

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/SearchPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchPanel } from './SearchPanel';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

function setup(searchImpl: any, onNavigate = vi.fn()) {
  (globalThis as any).__testDataSource = { search: searchImpl };
  return { onNavigate, ...render(
    <MemoryRouter>
      <SearchPanel workspaceId="ws" onNavigate={onNavigate} />
    </MemoryRouter>
  ) };
}

describe('SearchPanel', () => {
  it('debounces input and renders results with links', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue([
      { workspace_id: 'ws', source_id: 'local', path: 'guide.md', title: 'Getting Started', snippet: '<mark>getting</mark> started', score: 1 },
    ]);
    setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: 'getting' } });
    vi.advanceTimersByTime(250);
    await waitFor(() => expect(search).toHaveBeenCalledWith('ws', 'getting'));
    expect(await screen.findByRole('link', { name: 'Getting Started' })).toHaveAttribute(
      'href',
      '/w/ws/doc/local/guide.md'
    );
    vi.useRealTimers();
  });

  it('does not call search for an empty query', () => {
    const search = vi.fn();
    setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: '' } });
    expect(search).not.toHaveBeenCalled();
  });

  it('calls onNavigate when a result link is clicked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue([
      { workspace_id: 'ws', source_id: 'local', path: 'guide.md', title: 'Getting Started', snippet: 'x', score: 1 },
    ]);
    const { onNavigate } = setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: 'getting' } });
    vi.advanceTimersByTime(250);
    const link = await screen.findByRole('link', { name: 'Getting Started' });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

Create `web/src/components/AIContextPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AIContextPanel } from './AIContextPanel';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('AIContextPanel', () => {
  it('lists AI context files and copies concatenated content on click', async () => {
    (globalThis as any).__testDataSource = {
      getAIContext: vi.fn().mockResolvedValue([{ source_id: 'local', path: 'CLAUDE.md', title: 'Claude Notes' }]),
      getFile: vi.fn().mockResolvedValue({ path: 'local/CLAUDE.md', title: 'Claude Notes', body: 'agent instructions', frontmatter: {}, headings: [], is_ai_context: true }),
    };
    render(
      <MemoryRouter>
        <AIContextPanel workspaceId="ws" onNavigate={() => {}} />
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'Claude Notes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('agent instructions')));
  });

  it('calls onNavigate when a file link is clicked', async () => {
    const onNavigate = vi.fn();
    (globalThis as any).__testDataSource = {
      getAIContext: vi.fn().mockResolvedValue([{ source_id: 'local', path: 'CLAUDE.md', title: 'Claude Notes' }]),
      getFile: vi.fn().mockResolvedValue({ path: 'local/CLAUDE.md', title: 'Claude Notes', body: '', frontmatter: {}, headings: [], is_ai_context: true }),
    };
    render(
      <MemoryRouter>
        <AIContextPanel workspaceId="ws" onNavigate={onNavigate} />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Claude Notes' }));
    expect(onNavigate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run SearchPanel.test.tsx AIContextPanel.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `SearchPanel.tsx`**

Create `web/src/components/SearchPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { SearchResult } from '../datasource/types';

export function SearchPanel({ workspaceId, onNavigate }: { workspaceId: string; onNavigate: () => void }) {
  const ds = useDataSource();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      ds.search(workspaceId, query).then(
        (r) => !cancelled && setResults(r),
        (e) => !cancelled && setError(String(e))
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [ds, workspaceId, query]);

  return (
    <div className="search-page">
      <input
        autoFocus
        placeholder="Search this workspace…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <ul className="search-results">
        {results.map((r) => (
          <li key={`${r.source_id}/${r.path}`}>
            <Link to={`/w/${workspaceId}/doc/${r.source_id}/${r.path}`} onClick={onNavigate}>
              {r.title}
            </Link>
            <p dangerouslySetInnerHTML={{ __html: r.snippet }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Implement `AIContextPanel.tsx`**

Create `web/src/components/AIContextPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { AIContextEntry } from '../datasource/types';

export function AIContextPanel({ workspaceId, onNavigate }: { workspaceId: string; onNavigate: () => void }) {
  const ds = useDataSource();
  const [entries, setEntries] = useState<AIContextEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ds.getAIContext(workspaceId).then(setEntries);
  }, [ds, workspaceId]);

  async function copyAll() {
    const files = await Promise.all(entries.map((e) => ds.getFile(workspaceId, `${e.source_id}/${e.path}`)));
    const text = files.map((f) => `# ${f.path}\n\n${f.body}`).join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="ai-context-page">
      <button type="button" onClick={copyAll} disabled={entries.length === 0}>
        {copied ? 'Copied!' : `Copy all ${entries.length} as context`}
      </button>
      <ul>
        {entries.map((e) => (
          <li key={`${e.source_id}/${e.path}`}>
            <Link to={`/w/${workspaceId}/doc/${e.source_id}/${e.path}`} onClick={onNavigate}>
              {e.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Delete the old route files**

```bash
git rm web/src/routes/SearchPage.tsx web/src/routes/SearchPage.test.tsx web/src/routes/AIContextPage.tsx web/src/routes/AIContextPage.test.tsx
```

- [ ] **Step 6: Run tests to verify the new ones pass**

Run: `cd web && npx vitest run SearchPanel.test.tsx AIContextPanel.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 7: Add CSS padding for the moved pages**

The panel content no longer inherits `.content`'s `padding: 1.5rem 2rem`. In `web/src/styles.css`, add near the `.right-panel-body` rule from Task 3:

```css
.search-page,
.ai-context-page {
  padding: 1rem;
  box-sizing: border-box;
}
```

- [ ] **Step 8: Commit**

```bash
git add web/src/components/SearchPanel.tsx web/src/components/SearchPanel.test.tsx \
        web/src/components/AIContextPanel.tsx web/src/components/AIContextPanel.test.tsx \
        web/src/styles.css
git commit -m "feat(web): move Search and AI Context from routes to panel components"
```

---

### Task 5: Frontend — `TerminalPanel`

**Files:**
- Create: `web/src/components/TerminalPanel.tsx`
- Delete: `web/src/components/TerminalView.tsx`, `web/src/routes/TerminalPage.tsx`

**Interfaces:**
- Produces: `TerminalPanel({ workspaceId, toggleBinding }: { workspaceId: string; toggleBinding?: string })`.
- Consumes: `matches` from `../keymap` (Task 2).

No new automated test here: `TerminalView.tsx` has never had one (xterm.js needs `ResizeObserver`/canvas APIs jsdom doesn't provide), and the behavior this task changes — the keymap interception — is exercised indirectly by the `WorkspaceLayout` regression test in Task 6, which mocks `@xterm/xterm` entirely. Manual verification is step 3 below.

- [ ] **Step 1: Create `TerminalPanel.tsx`**

Create `web/src/components/TerminalPanel.tsx` (adapted from the current `web/src/components/TerminalView.tsx`, adding keymap interception):

```tsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { matches } from '../keymap';

export function TerminalPanel({ workspaceId, toggleBinding }: { workspaceId: string; toggleBinding?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read via ref, not a dependency: if the keymap override arrives (async
  // fetch in WorkspaceLayout) after the terminal is already open, the effect
  // below must NOT re-run — that would close this WebSocket and kill the
  // shell, exactly the bug this component exists to fix.
  const bindingRef = useRef(toggleBinding);
  bindingRef.current = toggleBinding;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    term.attachCustomKeyEventHandler((event) => {
      const binding = bindingRef.current;
      // Returning false stops xterm from forwarding this keystroke to the
      // shell (so it doesn't also type e.g. a stray backtick) when it's the
      // configured toggle shortcut; everything else is forwarded normally.
      return binding ? !matches(event, binding) : true;
    });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/workspaces/${workspaceId}/terminal/ws`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
    };
    ws.onmessage = (ev) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data;
      term.write(typeof data === 'string' ? data : new TextDecoder().decode(data));
    };
    ws.onclose = () => {
      term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n');
    };
    ws.onerror = () => {
      term.write('\r\n\x1b[31m[terminal connection error]\x1b[0m\r\n');
    };

    const dataListener = term.onData((chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
      }
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      dataListener.dispose();
      ws.close();
      term.dispose();
    };
  }, [workspaceId]);

  return <div className="terminal-view" ref={containerRef} />;
}
```

- [ ] **Step 2: Delete the old files**

```bash
git rm web/src/components/TerminalView.tsx web/src/routes/TerminalPage.tsx
```

- [ ] **Step 3: Manual check (deferred to Task 7's end-to-end smoke)**

No isolated test for this file — covered by the Task 6 regression test and Task 7's manual smoke pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TerminalPanel.tsx
git commit -m "feat(web): rename TerminalView to TerminalPanel, intercept the toggle shortcut"
```

---

### Task 6: Frontend — wire panels into `WorkspaceLayout`, clean up `router.tsx`

**Files:**
- Modify: `web/src/routes/WorkspaceLayout.tsx`
- Modify: `web/src/routes/WorkspaceLayout.test.tsx`
- Modify: `web/src/routes/router.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `RightPanel` (Task 3), `SearchPanel`/`AIContextPanel` (Task 4), `TerminalPanel` (Task 5), `defaultKeymap`/`mergeKeymap`/`matches`/`fetchKeymapOverrides`/`type PanelKind`/`type Keymap` from `../keymap` (Task 2).

- [ ] **Step 1: Update `router.tsx`**

Modify `web/src/routes/router.tsx` to remove the three panel routes and their imports:

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { WorkspacePickerPage } from './WorkspacePickerPage';
import { WorkspaceLayout } from './WorkspaceLayout';
import { FileViewerPage } from './FileViewerPage';

export const router = createBrowserRouter([
  { path: '/', element: <WorkspacePickerPage /> },
  {
    path: '/w/:workspaceId',
    element: <WorkspaceLayout />,
    children: [{ path: 'doc/*', element: <FileViewerPage /> }],
  },
]);
```

- [ ] **Step 2: Update the existing nav-links test (it now expects buttons)**

In `web/src/routes/WorkspaceLayout.test.tsx`, replace the `'renders nav links to search, ai-context, and terminal'` test:

```tsx
  it('renders toggle buttons for search, ai-context, and terminal', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    expect(await screen.findByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Add mocks and the new regression tests**

At the top of `web/src/routes/WorkspaceLayout.test.tsx`, after the existing imports, add:

```tsx
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  binaryType = '';
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    open() {}
    write() {}
    dispose() {}
    onData() {
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
```

Update the top-level `beforeEach` to also stub `fetch` (for `fetchKeymapOverrides`) and clear `MockWebSocket.instances`:

```tsx
beforeEach(() => {
  localStorage.clear();
  MockWebSocket.instances = [];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});
```

Add these tests inside the `describe('WorkspaceLayout', ...)` block:

```tsx
  it('toggles a panel open and closed when its topnav button is clicked', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const searchButton = await screen.findByRole('button', { name: 'Search' });

    fireEvent.click(searchButton);
    expect(await screen.findByPlaceholderText(/search this workspace/i)).toBeInTheDocument();
    expect(searchButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(searchButton);
    expect(searchButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the terminal WebSocket alive when the panel is toggled closed and reopened', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const terminalButton = await screen.findByRole('button', { name: 'Terminal' });

    fireEvent.click(terminalButton); // open
    expect(MockWebSocket.instances).toHaveLength(1);

    fireEvent.click(terminalButton); // close
    fireEvent.click(terminalButton); // reopen
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('toggles the terminal panel via the default keyboard shortcut', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    await screen.findByRole('button', { name: 'Terminal' });

    fireEvent.keyDown(document, { key: '`', ctrlKey: true });
    expect(await screen.findByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(document, { key: '`', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'false');
  });
```

- [ ] **Step 4: Run tests to verify the new/updated ones fail**

Run: `cd web && npx vitest run WorkspaceLayout.test.tsx`
Expected: FAIL — `WorkspaceLayout` doesn't yet render buttons, panels, or a keydown listener.

- [ ] **Step 5: Implement the `WorkspaceLayout.tsx` changes**

Add imports at the top of `web/src/routes/WorkspaceLayout.tsx`:

```tsx
import { RightPanel } from '../components/RightPanel';
import { TerminalPanel } from '../components/TerminalPanel';
import { SearchPanel } from '../components/SearchPanel';
import { AIContextPanel } from '../components/AIContextPanel';
import { defaultKeymap, mergeKeymap, matches, fetchKeymapOverrides, type PanelKind, type Keymap } from '../keymap';
```

Add this helper above the `WorkspaceLayout` function:

```tsx
function panelTitle(kind: PanelKind | null): string {
  switch (kind) {
    case 'terminal':
      return 'Terminal';
    case 'search':
      return 'Search';
    case 'ai-context':
      return 'AI Context';
    default:
      return '';
  }
}
```

Inside `WorkspaceLayout`, add state and effects (alongside the existing `sidebarWidth`/`dragging` state):

```tsx
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [openedPanels, setOpenedPanels] = useState<Set<PanelKind>>(new Set());
  const [keymap, setKeymap] = useState<Keymap>(defaultKeymap);

  useEffect(() => {
    let cancelled = false;
    fetchKeymapOverrides().then((overrides) => {
      if (!cancelled) setKeymap(mergeKeymap(overrides));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePanel = useCallback((kind: PanelKind) => {
    setActivePanel((current) => (current === kind ? null : kind));
    setOpenedPanels((s) => (s.has(kind) ? s : new Set(s).add(kind)));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const kind of Object.keys(keymap) as PanelKind[]) {
        if (matches(e, keymap[kind])) {
          e.preventDefault();
          togglePanel(kind);
          return;
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [keymap, togglePanel]);
```

Replace the `topnav` block:

```tsx
      <nav className="topnav">
        <Link to={`/w/${workspaceId}`}>{tree.name}</Link>
        <button type="button" aria-pressed={activePanel === 'search'} onClick={() => togglePanel('search')}>
          Search
        </button>
        <button type="button" aria-pressed={activePanel === 'ai-context'} onClick={() => togglePanel('ai-context')}>
          AI Context
        </button>
        <button type="button" aria-pressed={activePanel === 'terminal'} onClick={() => togglePanel('terminal')}>
          Terminal
        </button>
      </nav>
```

Add the panel rendering as a new sibling of `<main className="content">` inside `.workspace-layout`, right before the `{showScrollTop && ...}` block:

```tsx
        {openedPanels.size > 0 && (
          <RightPanel open={activePanel !== null} title={panelTitle(activePanel)} onClose={() => setActivePanel(null)}>
            {openedPanels.has('terminal') && (
              <div hidden={activePanel !== 'terminal'} className="right-panel-pane">
                <TerminalPanel workspaceId={workspaceId} toggleBinding={keymap.terminal} />
              </div>
            )}
            {openedPanels.has('search') && (
              <div hidden={activePanel !== 'search'} className="right-panel-pane">
                <SearchPanel workspaceId={workspaceId} onNavigate={() => setActivePanel(null)} />
              </div>
            )}
            {openedPanels.has('ai-context') && (
              <div hidden={activePanel !== 'ai-context'} className="right-panel-pane">
                <AIContextPanel workspaceId={workspaceId} onNavigate={() => setActivePanel(null)} />
              </div>
            )}
          </RightPanel>
        )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run WorkspaceLayout.test.tsx`
Expected: PASS (all cases, including the pre-existing sidebar/scroll tests — they must still pass unchanged).

- [ ] **Step 7: Add topnav button CSS**

In `web/src/styles.css`, after the existing `.topnav a:hover` rule (around line 55), add:

```css
.topnav button {
  all: unset;
  cursor: pointer;
  color: inherit;
  font-size: 0.9rem;
}

.topnav button:hover {
  text-decoration: underline;
}

.topnav button[aria-pressed='true'] {
  font-weight: 700;
}

/* Each panel pane needs an explicit height so TerminalPanel's
   .terminal-view (height: 100%) resolves against something concrete —
   a percentage height against an auto-height parent is otherwise ignored,
   which would collapse the terminal to 0 rows. */
.right-panel-pane {
  height: 100%;
}
```

- [ ] **Step 8: Run the full frontend test suite**

Run: `cd web && npx vitest run`
Expected: PASS across all test files (no regressions in `FileViewerPage`, `TreeView`, `MermaidBlock`, `GitHistoryPanel`, etc.).

- [ ] **Step 9: Commit**

```bash
git add web/src/routes/WorkspaceLayout.tsx web/src/routes/WorkspaceLayout.test.tsx \
        web/src/routes/router.tsx web/src/styles.css
git commit -m "feat(web): dock Terminal/Search/AI Context as a persistent right-side panel"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full Go test suite**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./...`
Expected: PASS, including the new `internal/api/keymap_handlers_test.go` cases.

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd web && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Build the full binary**

Run: `make build`
Expected: builds cleanly (this also runs `npm run build`, which runs `tsc -b` — confirms no TypeScript errors from the new/moved files).

- [ ] **Step 4: Manual smoke test**

Run: `./bin/dmox serve` (serves `./example/docs` per the README's local-dev instructions), open the printed URL, and confirm by hand:
- Clicking Terminal opens the right panel and a working shell; typing a command and output shows up.
- Clicking Search while Terminal is open closes Terminal's panel view and opens Search instead (only one visible at a time).
- Clicking Terminal again shows the *same* shell session/scrollback — not a fresh one.
- `` Ctrl+` `` (or `Cmd+\`` on Mac) toggles the Terminal panel from the keyboard, including while a shell command is running.
- Dragging the panel's left edge resizes it, and the width survives a page reload.

- [ ] **Step 5: Final commit (if manual testing surfaced fixups)**

Only if Step 4 required code changes:

```bash
git add -A
git commit -m "fix(web): address issues found in right-side panel manual smoke test"
```
