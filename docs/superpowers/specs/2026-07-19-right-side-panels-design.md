# Right-Side Toggle Panels (Terminal / Search / AI Context) Design

Status: Draft for review
Date: 2026-07-19
Sub-project: follow-up UX fix within the v0 core platform (see
`2026-07-17-dmox-core-platform-design.md`)

## 1. Problem & Scope

Today, Terminal, Search, and AI Context are separate routes
(`/w/:id/{terminal,search,ai-context}`) rendered by `WorkspaceLayout`'s
`<Outlet/>`. Navigating to any of them unmounts whatever was previously in
that outlet, and navigating away unmounts them in turn.

For Terminal specifically this is actively harmful: `TerminalView`
opens a WebSocket and the server (`handleTerminalWS` in
`internal/api/terminal_handlers.go`) spawns a brand-new PTY-backed shell
(`internal/terminal.Start`) per connection, killing it (`defer sess.Close()`)
the instant the socket closes. Route-unmount → socket close → shell killed.
Every visit to the Terminal tab is a fresh shell with no scrollback and no
process state, even mid-task.

The desired interaction is closer to an IDE's side panel: view a doc, pop
open Terminal (or Search, or AI Context) on the right without leaving the
doc, close it, reopen it later in the same session with everything exactly
as it was — no route change involved at all.

### In scope
- Replace the three routes with toggle buttons that open a resizable panel
  docked on the right side of the content area, pushing (not overlaying) the
  doc content.
- Only one of the three panels is visible at a time.
- Once a panel has been opened for the first time in a workspace session, it
  stays mounted (hidden via CSS, not unmounted) until the workspace changes
  or the page reloads — so Terminal's WebSocket/shell process, Search's
  input/results, and AI Context's list all survive being hidden and reshown.
- Keyboard shortcuts to toggle each panel, VSCode-like defaults, with the
  default map defined in frontend code and overridable via `config.yaml`.
- Keystroke routing fix so a toggle shortcut works even while the Terminal
  panel has keyboard focus (without leaking into the shell it's not meant
  for).

### Explicitly out of scope
- Backend session persistence across page reload/workspace switch (i.e., a
  server-side session registry that lets a shell survive a closed
  WebSocket/browser refresh). This spec only stops the *avoidable* kills —
  closing/reopening the panel without navigating away. True
  reload-survivable sessions are a separate, deferred project.
- Multiple panels open simultaneously.
- A settings UI for editing keymaps from within the browser (v0 is
  code-default + config.yaml override only; no in-app editor).
- Any change to `dmox build` / static export — panels are a `dmox serve`
  (live API) concern only, consistent with Terminal already being
  server-only (static export has no shell to attach to).

## 2. Architecture

`WorkspaceLayout` (`web/src/routes/WorkspaceLayout.tsx`) gains:

- `activePanel: 'terminal' | 'search' | 'ai-context' | null` — which panel is
  currently visible.
- `openedPanels: Set<PanelKind>` — which panels have been mounted at least
  once this workspace session.

The three routes and `TerminalPage.tsx` are removed from `router.tsx`. The
layout's middle row changes from 2 columns (sidebar, content) to 3
(sidebar, content, right panel):

```
┌────────┬──────────────────────────┬────────────────┐
│sidebar │ content (doc / Outlet)   │ right panel     │
│ (tree) │                          │ (terminal/      │
│        │                          │  search/        │
│        │                          │  ai-context)    │
└────────┴──────────────────────────┴────────────────┘
```

The right panel container renders once `openedPanels` is non-empty. Inside
it, all panels that have ever been opened stay mounted as siblings; only the
one matching `activePanel` is visible (`hidden` attribute / `display:none`
on the rest). This is the key mechanism that fixes the terminal-kill bug: as
long as `WorkspaceLayout` itself doesn't unmount (i.e., you stay in the same
workspace), `TerminalPanel`'s WebSocket is never closed by toggling.

Panel mount is lazy (on first open), not eager on workspace load — so
opening a workspace never spawns a shell process the user hasn't asked for.

## 3. Components

- **`RightPanel.tsx`** (new) — outer chrome: header with panel title + close
  button, a resize handle on its *left* edge mirroring `.sidebar-resizer`'s
  drag behavior (`handleResizeMouseDown`/`dragging` logic in
  `WorkspaceLayout.tsx`, mirrored so dragging left grows the panel), with its
  own `MIN_PANEL_WIDTH`/`MAX_PANEL_WIDTH`/`DEFAULT_PANEL_WIDTH` constants
  (same values as the sidebar's as a starting point: 160/600/260px), width
  persisted to `localStorage` under `dmox-panel-width` (same pattern as
  `SIDEBAR_WIDTH_KEY`). Renders whichever mounted panel children are passed
  to it, toggling visibility via CSS only.
- **`TerminalPanel.tsx`** — renamed/adapted from `TerminalView.tsx`. Same
  xterm + WebSocket logic. Two changes:
  - Drop the `key={workspaceId}` remount trick from `TerminalPage.tsx` — no
    longer needed since `WorkspaceLayout` (the new mount boundary) already
    remounts fully on workspace change.
  - Add `term.attachCustomKeyEventHandler(...)` (see §5) so the configured
    toggle shortcut is intercepted before xterm forwards it to the shell.
- **`SearchPanel.tsx` / `AIContextPanel.tsx`** — adapted from
  `SearchPage.tsx` / `AIContextPage.tsx`. Behavior unchanged except: clicking
  a result closes the panel (`activePanel = null`) and navigates to the doc
  via `useNavigate()` instead of a plain `<Link>`, since the panel is no
  longer the outlet — the doc route needs to actually change under it.

## 4. Toggle buttons & data flow

`topnav`'s three `<Link>`s become `<button>`s:

```ts
function togglePanel(kind: PanelKind) {
  if (activePanel === kind) {
    setActivePanel(null);                 // open -> close
  } else {
    setOpenedPanels(s => new Set(s).add(kind));
    setActivePanel(kind);                 // closed/other -> open
  }
}
```

## 5. Keymap system

- **`web/src/keymap.ts`** (new) — default action→shortcut map:
  | Action | Action id | Default binding |
  |---|---|---|
  | Toggle Terminal | `terminal` | `` mod+` `` |
  | Toggle Search | `search` | `mod+shift+f` |
  | Toggle AI Context | `ai-context` | `mod+shift+a` |

  Binding strings use `mod` as a platform-neutral primary modifier token
  (`mod+shift+f`), resolved to `metaKey` on Mac and `ctrlKey` everywhere
  else, so one binding string works cross-platform and one config override
  doesn't need an OS-specific variant. A `matches(event: KeyboardEvent,
  binding: string): boolean` helper parses `binding` and compares against
  `event.{ctrlKey,metaKey,shiftKey,key}`.

- **Backend override** — `internal/config/config.go`'s `Config` gains an
  optional field:
  ```go
  Keymap map[string]string `yaml:"keymap"` // action id -> binding string, e.g. {"terminal": "mod+j"}
  ```
  No validation beyond existing YAML parsing — an unrecognized action id or
  malformed binding is simply ignored by the frontend matcher, keeping this
  additive and low-risk.
- **New endpoint** — `GET /api/keymap` (added to `internal/api/server.go`
  alongside the other top-level routes, not workspace-scoped, since keymaps
  are a user preference, not workspace data) returns `cfg.Keymap` as JSON
  (`{}` when unset).
- **Frontend merge** — `WorkspaceLayout` fetches `/api/keymap` once per
  mount, merges `{...defaultKeymap, ...overrides}`, and registers one
  `document.addEventListener('keydown', ...)` that calls `togglePanel` when
  the event matches a binding.

### Terminal focus interception

When `activePanel === 'terminal'`, xterm.js owns keyboard focus and
swallows keydown events by default. `TerminalPanel` uses
`term.attachCustomKeyEventHandler(event => ...)`:
- If `event` matches the (merged) Terminal toggle binding: return `false`
  (xterm does not process it, letting it bubble to the document-level
  listener that closes the panel) — this is what lets you close the
  terminal panel with the shortcut while `vim`/`tmux` has focus inside it.
- Otherwise: return `true` (xterm handles it normally, forwarding to the
  shell) — everything the user types, including their own tmux/nvim
  bindings, reaches the shell unmodified.

## 6. Testing

- `keymap.test.ts` — `matches()` against representative events (Ctrl vs Cmd,
  Shift combos, non-matching keys); merge logic (`{...default, ...override}`
  overrides only provided actions).
- `WorkspaceLayout.test.tsx` — toggling a panel via button updates
  `activePanel`/`openedPanels` correctly; closing and reopening Terminal does
  **not** construct a second `WebSocket` (mock `WebSocket`, assert
  construction count stays at 1 across two open/close cycles) — this is the
  regression test for the bug this spec fixes.
- Backend: `internal/api` test for `GET /api/keymap` — empty config →
  `{}`; config with a `keymap:` section → matching JSON.
- Manual/Playwright smoke: open Terminal, run a command, switch to Search,
  switch back to Terminal — output/scrollback still present.

## 7. Deferred / Future Sub-Projects

- Backend session persistence: a session registry keyed by ID so a shell
  survives a WebSocket disconnect (page reload, workspace switch), with its
  own idle-timeout cleanup. Out of scope here by explicit user decision —
  revisit once the panel UX above is in place and proves insufficient on its
  own.
- In-app keymap editor (settings UI), if code-default + config.yaml override
  turns out to be too inconvenient in practice.
