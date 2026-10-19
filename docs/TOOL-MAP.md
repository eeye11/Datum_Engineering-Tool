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
| Model / history | `src/shared/model/drawing-state.js` | `commitDrawingChange`, `geometryFactories.*` |
| Rendering | `src/shared/rendering/renderer.js` | `renderDrawing` |
| Hit testing | `src/features/workspace/interaction/hit-testing.js` | `objectAtPoint` |
| Handles | `src/shared/geometry/feature-handles.js` | `manipulationHandles` |
| Feature panel (legacy editor UI) | `src/components/layout/panels/feature-panel.js` | `renderProperties` |
| Property binding + updates | `src/components/layout/panels/property-binding.js` + `src/components/layout/panels/property-update.js` | `bindFeaturePropertyControls`, `updateFeatureProperty` |

## Finding a specific tool

- Search under `src/tool-library/` for its `manifest.json` entry.
- Search the `src/components/layout/toolbar/tools.js` group arrays for its id.
- Search for the id in quotes, e.g. `"pin-support"`, to find the interaction and model call sites.

## Cross-cutting state

- `src/features/workspace/editor-state.js` exports `drawingState` (model) and
  `editorState` (shared UI state).