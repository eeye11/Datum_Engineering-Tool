# DAETUM — Tool Map

Where a toolbar command’s code lives in the current folder structure.

A tool is not one file: it is a path through registration ? activation ?
interaction ? model ? rendering ? panels.

## The tool pipeline

| Stage | Where | Entry point |
|---|---|---|
| Tool registry (metadata + templates) | `src/tool-library/` | `src/tool-library/registry/tool-registry.js` |
| Toolbar grouping + shortcuts | `src/components/layout/toolbar/tools.js` | `drawingToolGroups`, `disciplineToolGroups` |
| Activation / cancellation | `src/components/layout/toolbar/tool-activation.js` | `activateTool`, `resetActiveTool` |
| Pointer ? snapped point | `src/features/workspace/interaction/pointer.js` + `src/shared/snapping/object-snap.js` | `resolvePointerPoint` |
| Click routing | `src/features/workspace/interaction/canvas-click.js` | `handleCanvasClick` |
| Drag routing | `src/features/workspace/interaction/canvas-events.js` + `src/features/workspace/interaction/drag.js` | `handlePointerDown`, `beginManipulationDrag` |
| Preview | `src/features/workspace/geometry/preview.js` | `updatePreview` |
| Geometry creation | `src/features/workspace/geometry/geometry-creation.js` | `beginOrCompleteGeometry` |
| Statics creation / attachment | `src/features/workspace/statics/` | `createStaticsFeature`, `attachStaticsFeature` |
| Fluids: Pipe / Duct routing, elbows | `src/features/workspace/interaction/pipe-duct-tool.js` + `src/features/workspace/model/fluids/pipe-duct.js` | `commitRouteSegment`, `generateElbowFor` |
| Fluids: toolset registry (what each button arms) | `src/features/workspace/model/fluids/fluids-tools.js` + `src/features/workspace/interaction/fluids-tool.js` | `fluidsToolGroups`, `fluidsArmedTool` |
| Source writers (TikZ per feature type) | `src/shared/rendering/latex/source-writers/` | `SOURCE_WRITERS` in `index.js` |
| Model / history | `src/shared/model/drawing-state.js` | `commitDrawingChange`, `geometryFactories.*` |
| Rendering | `src/shared/rendering/renderer.js` | `renderDrawing` |
| Hit testing | `src/features/workspace/interaction/hit-testing.js` | `objectAtPoint` |
| Handles | `src/shared/geometry/feature-handles.js` | `manipulationHandles` |
| Inspector (Objects / Features / Source) | `src/components/layout/panels/drawing-panel.js` | `objects-pane.js`, `features-pane.js`, `source-tab.js` |
| Features tab (schema-driven editor) | `src/components/layout/panels/features-editor.js` + `feature-schema.js` | |
| Statics analysis editor (Resultant, Components, SFD/BMD/AFD) | `src/features/workspace/statics/analysis-editor.js` | |

## Finding a specific tool

- Search under `src/tool-library/` for its `manifest.json` entry.
- Search the `src/components/layout/toolbar/tools.js` group arrays for its id.
- Search for the id in quotes, e.g. `"pin-support"`, to find the interaction and model call sites.

## Cross-cutting state

- `src/features/workspace/editor-state.js` exports `drawingState` (model) and
  `editorState` (shared UI state).
