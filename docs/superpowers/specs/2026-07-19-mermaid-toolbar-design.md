# Mermaid Diagram Toolbar (Zoom Buttons / View Code / Copy) Design

Status: Approved
Date: 2026-07-19
Sub-project: follow-up UX fix within the v0 core platform (see
`2026-07-17-dmox-core-platform-design.md`)

## 1. Problem & Scope

`MermaidBlock` (`web/src/components/MermaidBlock.tsx`) currently zooms
diagrams via mouse wheel, with a heuristic (`lastPageWheelAt`/
`passThroughRef`/`SCROLL_PASSTHROUGH_WINDOW_MS`) that tries to guess whether
an incoming wheel event means "the user is scrolling the page past this
diagram" or "the user stopped to zoom it." This heuristic is inherently
unreliable and actively fights the user's intent to just scroll the page
when the cursor happens to rest over a diagram.

There's also no way to see or copy a diagram's underlying Mermaid source
without opening the raw doc file elsewhere — useful both for understanding
a diagram that failed to render (see the parse-error case investigated
2026-07-19, unrelated to dmox itself) and for reusing/editing the diagram
source.

### In scope
- Remove wheel-to-zoom and its passthrough-detection heuristic entirely.
  Mouse wheel over a diagram always scrolls the page, like any other content.
- A toolbar, visible on hover only, with:
  - `−` / `+` buttons: zoom out/in by a fixed 0.25 step, clamped to the
    existing `MIN_SCALE=0.5`/`MAX_SCALE=4`, disabled at the respective
    bound.
  - A center label showing the current zoom percentage (e.g. "150%");
    clicking it resets scale to 1 and pan to (0,0) — replaces the current
    always-visible-when-zoomed "Reset zoom" button.
  - A "View Code" toggle: swaps the rendered SVG for a `<pre><code>` block
    showing the diagram's raw Mermaid source; toggling again (now labeled
    "View Diagram") swaps back.
  - A "Copy" button: copies the raw Mermaid source (not the SVG) to the
    clipboard, with a brief "Copied!" confirmation, matching the existing
    pattern in `AIContextPanel.tsx`.
- While in code view, the zoom buttons and percentage label are hidden
  (nothing to zoom); Copy and the View Code/Diagram toggle remain.
- Drag-to-pan when zoomed is unchanged.

### Explicitly out of scope
- Any change to how Mermaid diagrams are parsed/rendered, or to error
  handling for malformed diagram source (the reported ER-diagram parse
  error was confirmed, by reproducing the render pipeline in a test, to be
  a genuine syntax defect in the source `.md` file being viewed — not a bug
  in dmox's rendering path — and is out of scope for this spec).
- Syntax highlighting for the code view (plain `<pre><code>`, no highlighter
  dependency added).
- Any change to PlantUML rendering or other doc-rendering features.

## 2. Component Changes

`MermaidBlock.tsx`:
- Remove: `ensureWheelTracking`, `wheelTrackingAttached`, `lastPageWheelAt`,
  `SCROLL_PASSTHROUGH_WINDOW_MS`, `passThroughRef`, `handleWheel`, and the
  wrapper's `onWheel` handler.
- Add state: `showCode: boolean` (default `false`).
- Zoom step: replace continuous wheel delta with a fixed
  `ZOOM_STEP = 0.25` used by the `+`/`−` button handlers, reusing the
  existing `MIN_SCALE`/`MAX_SCALE` clamp and the existing `resetZoom`
  (renamed conceptually to "reset", still sets scale=1/pan={0,0}).
- Render: the toolbar replaces the current conditional "Reset zoom" button.
  It is always present in the DOM (so hover/CSS can show it), visibility
  controlled by CSS `:hover` on the wrapper — no new React state needed for
  visibility itself, consistent with `RightPanel`'s close button always
  being present and only the wrapper's `.closed` state hiding things.
- When `showCode`, render `<pre><code>{source}</code></pre>` instead of the
  `.mermaid-diagram` div; the zoom-related buttons are omitted from the
  toolbar in this state (not merely disabled, to avoid dead controls).
- Copy uses `navigator.clipboard.writeText(source)`.

## 3. CSS

Replace `.mermaid-reset-btn` with `.mermaid-toolbar` (flex row, positioned
top-right of `.mermaid-diagram-wrapper` as today), shown via
`.mermaid-diagram-wrapper:hover .mermaid-toolbar { opacity: 1; }` (hidden by
default via `opacity: 0; pointer-events: none;`) rather than a React
`zoomed` condition, since the toolbar must be reachable even when not
zoomed (to zoom in the first place, or to view code).

## 4. Testing

Rewrite `MermaidBlock.test.tsx`:
- Remove the 4 wheel/passthrough tests (`zooms in on scroll...`, `lets the
  wheel keep scrolling...`, `zooms on wheel once the cursor rests...`, and
  the passthrough half of the clamp test) — the behavior they covered no
  longer exists.
- Keep/adapt: clamps to max scale (via repeated `+` clicks instead of
  wheel), resets on percentage-label click.
- Add: `+`/`−` buttons change scale by 0.25 and disable at bounds; wheel
  over the diagram no longer calls `preventDefault`/changes `transform`
  (page scroll passes through unconditionally now); "View Code" swaps to a
  `<pre>` containing the raw source and hides zoom controls; "View
  Diagram" swaps back; "Copy" calls `navigator.clipboard.writeText` with
  the raw source.
