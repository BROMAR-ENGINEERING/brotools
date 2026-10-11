<!-- brotools/js/tools/plan-tracer/README.md -->
# Plan Tracer — BroTools module

## Integration (confirmed against js/app.js)

```js
import { mount, unmount } from './js/tools/plan-tracer/index.js';
mount(container);   // on first open (lazy) and every re-open
unmount();          // when leaving the tool
```

- **ESM named exports only.** No global fallback.
- Already wired in `js/app.js`: route `#/plan-tracer` → this `index.js`, plus a home tile.
- **Lazy + cached:** `index.js` is imported once on first open; its top-level code
  (symbol registry + Basic fallback) runs once. `mount()`/`unmount()` run on every
  open/leave. Safe to repeat: state is rebuilt each `mount()`, CSS is injected once
  and kept, libraries load once and are cached.

## Container
The hub passes `<div class="bt-tool tool-plan-tracer">` with a definite height below
the fixed header (`flex:1; min-height:0; position:relative; overflow:auto`). The tool
fills it with `height:100%`. The module does **not** add or remove that class — the
hub owns the container.

## Styling
`plan-tracer.css` (self-loaded on first mount, relative to `index.js`) maps all UI
chrome to shared.css tokens — `--bg-main`, `--bg-secondary`, `--text-primary`,
`--text-secondary`, `--accent`, `--border` — so the toolbars, panels and dialogs
match Ops light/dark. The **drawing surface** (dark canvas, selection amber, snap
teal, grid greys, on-canvas HUD text) keeps its own fixed tokens for legibility,
regardless of theme. Fallback values are baked in so the tool still works if a token
is absent.

## Libraries
`libraries/manifest.json` + `*.js`, loaded on mount via `fetch` + `<script>`,
resolved relative to `index.js` via `import.meta.url`. Add a symbol set by dropping
a file in `libraries/` and adding its name to the manifest — no change to `index.js`
or the hub.

## Notes
- Does not set `document.title` (hub owns it).
- A fresh drawing is created each mount. Say the word if you want it to persist
  across unmount→remount.
