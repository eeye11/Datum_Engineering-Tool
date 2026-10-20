# DAETUM — Code Map

A concise map of the current repository layout (post-restructure). Use this to
find the *owner* of a behaviour before changing code.

## Entry points

- `index.html` — the application shell and DOM mount points.
- `src/app/entry/main.js` — the single JS entry; imports modules in startup order.
- `server/server.js` — optional Node server (serves `dist/` + API routes).
- `server/tikz.js` — TikZ -> SVG rendering service used by `/api/render-tikz`.

## The big ideas

- A **document** contains **sheets**; each sheet contains **objects/features**.
- `drawingState` is the live model for the *active* sheet.
- `editorState` is shared UI state (panel views, tool defaults, active drags, …).

See `src/features/workspace/editor-state.js` for both.

## Folder map

- `src/app/` — app-only concerns (automation hooks, error logging).
- `src/components/` — layout and UI wiring that directly touches the DOM.
- `src/features/workspace/` — workspace/editor behaviour by domain (annotate,
  geometry, statics, thermodynamics, interaction, commands, model).
- `src/shared/` — reusable model, rendering, persistence, solution integration,
  snapping, selection, units, UI primitives.
- `src/tool-library/` — tool metadata (manifests/templates) and the registry.

## Where do I look for…?

| I want to change… | Go to |
|---|---|
| App startup order | `src/app/entry/main.js` |
| Workspace boot / controller wiring | `src/features/workspace/index.js` |
| The document model (objects, selection, history) | `src/shared/model/drawing-state.js` |
| Shared editor + model state (`drawingState`, `editorState`) | `src/features/workspace/editor-state.js` |
| Tool registration (toolsets, labels, shortcuts) | `src/components/layout/toolbar/tools.js` |
| Tool activation (arming/cancelling tools) | `src/components/layout/toolbar/tool-activation.js` |
| Canvas pointer routing (down/move/up/click) | `src/features/workspace/interaction/canvas-events.js` + `src/features/workspace/interaction/pointer.js` |
| Hit testing (what is under the cursor) | `src/features/workspace/interaction/hit-testing.js` |
| Box selection behaviour | `src/features/workspace/interaction/box-selection.js` |
| Snapping and inference | `src/shared/snapping/object-snap.js` |
| Rendering the current sheet | `src/shared/rendering/renderer.js` + `src/components/layout/workspace/canvas-render.js` |
| Right-side inspector (Objects / Features / Source) | `src/components/layout/panels/drawing-panel.js` |
| Feature editing UI (existing “legacy” feature panel) | `src/components/layout/panels/feature-panel.js` |
| Tool-library registry loader | `src/tool-library/registry/tool-registry.js` |
| Document envelope read/write + migrations (saved inside the `.tex`; `.enggdraw` is import-only) | `src/shared/file/document-file.js` + `src/shared/file/latex/latex-document.js` |
| Writing-tab LaTeX editor and render | `src/shared/solution/writing-tab.js` |
| Embedded drawing blocks in LaTeX | `src/shared/solution/embedded-drawings.js` |
| Integration API (`window.datum`, postMessage bridge) | `src/shared/integration/datum-api.js` + `src/shared/integration/embed-bridge.js` |

## Tests

- `tests/*.test.cjs` are `node:test` suites.
- `tests/e2e/` contains browser scenarios and diagnostics.

Run the baseline check with `npm run check` (or `npm.cmd run check` on systems
where PowerShell blocks `npm.ps1`).