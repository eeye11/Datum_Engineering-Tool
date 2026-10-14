# DAETUM — Architecture

Where things live, why, and the rules that keep them there. Read this
before changing the code; [TOOL-MAP.md](TOOL-MAP.md) then tells you where
a particular toolbar command's code is.

---

## The shape of the application

DAETUM is a static web application: plain ES modules, built by Vite into
files any web server can host. There is no framework. `index.html` loads
one module, `src/main.js`, and everything else is reached through imports.

```
src/
├── main.js        the entry point: loads every part, installs the API
├── api/           the integration API — the only supported way in for other tools
├── app/           page shell: the tabs, the automation handles
├── editor/        the drawing editor: tools, interaction, panels, commands
├── core/          shared machinery: geometry, units, scale, the document model, snapping
├── features/      persistent feature models: dimensions, annotations, analysis
├── rendering/     the document drawn as SVG
├── sheets/        sheets and the sheet tab bar
├── file/          the .enggdraw format, save, export, crash recovery
├── references/    drawing references: a sheet placed in the written solution
├── solution/      the Written Solution tab
├── ui/            shared panel vocabulary, dialogs, the analysis editors
├── styles/        tokens.css, base.css, editor.css, shell.css
└── assets/        the icon
```

### Dependency direction

```
            api ──► editor ──► rendering ──► features ──► core
                       │           ▲             ▲
                       └──► ui, sheets, file, references
```

- **`core/`** knows nothing about the editor or the page. Its modules are
  pure enough to run under Node with a stubbed `window` (most of the unit
  tests do exactly that).
- **`features/`** holds what a feature *is* and *stores*; **`rendering/`**
  reads the model and draws it, owning no state.
- **`editor/`** sits on top and wires everything to the page.
- **`api/`** is the facade over the editor that other tools use.

One import cycle remains inside `core/`+`features/` (object-snap,
measurement-core, feature-geometry, drawing-state, dimension-model,
annotation-model). Every reference across it is inside a function, so it
is safe at load time; `node tools/refactor/import-cycles.mjs` reports it.
Do not add load-time reads across it.

---

## The drawing editor (`src/editor/`)

The editor was one 39,000-line file; it is now one module per concern.
**`editor/index.js` opens with a table of contents of every module**, in
reading order — start there.

The modules are grouped by what they do. The three engineering folders
(`geometry/`, `annotate/`, `statics/`) match the `category/*` branches, so
a category's tool work mostly stays inside its own folder:

```
editor/
├── index.js, editor-state.js, dom.js, constants.js   start-up and shared state
├── interaction/   pointer and keyboard: events, clicks, snapping feedback,
│                  hit-testing, selection, drags, handles, context menu
├── toolbar/       the tool registry (tools.js), toolbar, menus, tool activation,
│                  the menu bar's commands, command search
├── workspace/     the canvas render loop, viewport, sheets, layout, theme
├── panels/        the Features panel: markup, tree, property binding and update
├── commands/      document (new/open/save/export), clipboard, delete, modify, draw order
├── geometry/      GEOMETRY tools: creation, sizing, preview, transforms, triangle
├── annotate/      ANNOTATE tools: annotate creation, dimensions and their placement
└── statics/       STATICS tools: bodies, loads, supports, attachment, analysis, truss
```

### Shared state

| Module                  | Holds                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `editor/editor-state.js`| `drawingState` — the active sheet's document model (objects, camera, selection, interaction, history) — and `editorState`, the UI state more than one module changes (the sheet collection, an in-progress drag or modify session, the clipboard, the Features panel view, …) |
| `editor/dom.js`         | every DOM element the editor uses, looked up once             |
| `editor/constants.js`   | constants shared across the editor                            |

An imported binding is read-only, so state that several modules *change*
lives as a property of `editorState` (`editorState.modifySession = …`).
State only one module uses stays in that module.

### Start-up

A module that wires itself to the page — event listeners, callbacks
registered with another module — does so in an exported
`install…()` function, never at load time. `editor/index.js` calls every
install in order and then starts the editor (renders the tools, loads the
first sheet, offers crash recovery). Nothing therefore depends on the
order in which modules happen to be evaluated.

### The interaction loop

```
pointer event ─► pointer.js (snap, infer) ─► canvas-click.js ─► tool handler
                                                                   │
        drawing-state.js  ◄── geometryFactories + addObject ◄──────┘
              │ commitDrawingChange (history, analysis refresh, "documentchange")
              ▼
   canvas-render.js ─► rendering/renderer.js (state → SVG) + feature-panel.js
```

Every committed edit goes through `commitDrawingChange` in
`core/model/drawing-state.js`. That single point records the undo entry
(the latest 100 are kept), refreshes derived analysis objects, and
notifies the editor, which marks the document dirty, schedules the crash
recovery copy, re-renders any drawing reference, and raises the API's
`documentchange` event.

---

## Core concepts

### The document and its sheets

A document is an ordered list of **sheets**, each a separate drawing with
its own features, view, grid and scale. The editor has exactly one live
drawing state, always the active sheet's; switching sheets writes the
editor back to its sheet and loads the next one. A sheet has a permanent
**id** (what references and files use) and a **name** (what the student
sees and may change).

### The Universal Length Scale

A drawing's coordinates are numbers until something says how big they
are. The **Universal Length Scale** does, and **it belongs to the sheet**:

- implemented in `core/scale/dimensions.js` (`readScale`, `calibrate`,
  `toEngineering`, `fromEngineering`);
- established by the first real physical length on a sheet;
- reset when the sheet is emptied of length-bearing geometry.

Do not confuse it with the **Vector Display Scale**, which only changes how
large a force arrow is *drawn* and never a magnitude.

### Dimensions and annotations

A **dimension measures geometry**; an **annotation states meaning**. A
dimension stores *references* to geometry, not a number, so it stays right
when the geometry moves (`features/dimensions/dimension-model.js`). An
annotation such as a magnitude box stores its source feature's id, never a
copy of the value (`features/annotations/annotation-model.js`).

### Units

`core/units/quantities.js` is the **only** place a number becomes text. A
visible quantity always carries its unit, and no approximation mark is
ever printed.

### Snapping

`core/snapping/object-snap.js` serves every tool. 5 px snap tolerance; a 7°
horizontal/vertical inference band; a candidate is dropped as soon as the
pointer leaves tolerance.

### Dependencies

Parent/child relationships — a load follows its beam, deleting a beam
deletes its supports — and derived features (Resultant, Force Components,
diagram axes) are resolved in `features/analysis/analysis-dependencies.js`,
not scattered through the tools. Attachments are stored as a fraction along
the parent (`core/geometry/body-frames.js`), so they survive a resize.

### Rendering

`rendering/renderer.js` draws every feature, for every output: the canvas,
image and SVG export (`file/document-export.js`), drawing references and
the API's `renderSheetSvg`. There is one shared vector-arrow implementation
for forces, loads and analysis. No other module may build SVG geometry of
its own (`tests/render-pipeline.test.cjs` enforces this).

---

## The integration boundary

Other tools use `src/api/` and nothing else:

- `window.datum` — `getDocument`, `loadDocument`, `listSheets`,
  `renderSheetSvg`, `getSolution`, `setSolution`, `on(event)`;
- the postMessage bridge for embedding pages, off unless the embedding
  origin is named in the URL;
- the `.enggdraw` file format, versioned and migrated by `file/document-file.js`.

See [INTEGRATION.md](INTEGRATION.md) and [FILE-FORMAT.md](FILE-FORMAT.md).
`src/app/automation-hooks.js` also exposes internal `window.engg*`
handles; those are for this repository's browser tests and QA scripts
only, and may change with any refactor.

---

## Styling

`src/styles/tokens.css` names every colour and font once, following the
University of Alberta palette (UAlberta green as the accent). The other
stylesheets refer to the tokens. They load in a fixed order — tokens,
base, editor, shell — and later files win where they overlap.

---

## Adding a feature

1. **Model** — a factory in `core/model/drawing-state.js`
   (`geometryFactories`); shared geometry in `core/geometry/`; and an entry
   in `core/model/feature-types.js` saying which groups the type belongs to
   (body, support, attachable, span-shaped, …).
2. **Measurement** — register what it can be measured as in
   `core/geometry/measurement-core.js`.
3. **Rendering** — `rendering/renderer.js`.
4. **Tool** — register it in `editor/toolbar/tools.js`; creation in
   `editor/geometry/geometry-creation.js` or `editor/statics/statics-creation.js` (Statics
   placement rules in `editor/statics/statics-tools.js`); preview in
   `editor/geometry/preview.js`.
5. **Interaction** — hit-testing (`editor/interaction/hit-testing.js`,
   `editor/interaction/box-selection.js`), handles (`editor/interaction/handles.js`), transforms
   (`editor/geometry/transforms.js`).
6. **Panel** — `editor/panels/feature-panel-markup.js` (Statics sections in
   `editor/statics/statics-panel.js`), edits in `editor/panels/property-update.js`.
7. **File format** — if the stored shape changes, see
   [FILE-FORMAT.md](FILE-FORMAT.md#changing-the-format).
8. **Tests** — `tests/`, loading modules with `loadModule()`.

---

## Known debts, and what would pay them

- **A feature type's behaviour is spread across many modules.** What a type
  *is* has one home: `core/model/feature-types.js` declares each type's
  groups (body, support, connection, attachable, span-shaped, vector), and
  the editor asks it instead of keeping its own lists. What a type *does*
  is still spread: a beam is handled in about eight editor modules
  (hit-testing, handles, transforms, panels, …), each with its own
  `if (object.type === "beam")` branch, which is why steps 5–6 above touch
  so many files. The next step is to grow the registry from traits into
  behaviour — each type declaring its hit test, handles, transforms and
  panel rows, with the editor dispatching through it.
  `core/geometry/measurement-core.js` already works this way for
  measurement, so the pattern is proven here.
- **Three very large functions** remain: `featurePropertyMarkup`
  (~1,300 lines), `updateFeatureProperty` (~1,100) and
  `bindFeaturePropertyControls` (~950). They are per-type switch
  statements and would dissolve into the registry above.
- **The editor is a single instance.** It finds its elements by id
  (`editor/dom.js`), so one page hosts one editor. Embedding several would
  need `dom.js` to resolve inside a given root element.
