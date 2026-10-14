# DAETUM — Tool Map

Where each toolbar command's code lives. Paths are under `src/`.

## A tool is a path through the editor

A tool is not one file. Every tool travels the same path through the
editor, and each stage has one home:

| Stage                    | Where                                                         | Entry point                     |
| ------------------------ | ------------------------------------------------------------- | ------------------------------- |
| **Registration**         | `editor/toolbar/tools.js` — id, label, icon, shortcut, toolset        | `drawingToolGroups`, `disciplineToolGroups` |
| **Activation**           | `editor/toolbar/tool-activation.js`                                   | `activateTool`                  |
| **Submenus**             | `editor/toolbar/tool-menus.js`, `editor/statics/statics-tools.js`             | `openToolSubmenu`, `openStaticsMenu` |
| **Pointer → point**      | `editor/interaction/pointer.js` (snapping, inference, status text)        | `resolvePointerPoint`           |
| **Click**                | `editor/interaction/canvas-click.js`                                      | `handleCanvasClick`             |
| **Preview**              | `editor/geometry/preview.js`                                           | `updatePreview`                 |
| **Creation — geometry**  | `editor/geometry/geometry-creation.js`                                 | `beginOrCompleteGeometry`       |
| **Creation — Statics**   | `editor/statics/statics-creation.js`, `editor/statics/statics-attachment.js`  | `createStaticsFeature`          |
| **Creation-time sizing** | `editor/geometry/creation-sizing.js` + `features/dimensions/creation-dimensioning.js` | `beginCreationDimensioning` |
| **Model**                | `core/model/drawing-state.js`                                 | `geometryFactories.<type>`      |
| **Rendering**            | `rendering/renderer.js`                                       | `renderDrawing`                 |
| **Hit-testing**          | `editor/interaction/hit-testing.js`, `editor/interaction/box-selection.js`            | `objectAtPoint`, `objectIntersectsSelection` |
| **Handles and dragging** | `editor/interaction/handles.js`, `editor/interaction/drag.js`                         | `manipulationHandles`, `beginManipulationDrag` |
| **Features panel**       | `editor/panels/feature-panel.js` → `editor/panels/feature-panel-markup.js`, `editor/statics/statics-panel.js` | `renderProperties`, `featurePropertyMarkup` |
| **Panel edits**          | `editor/panels/property-binding.js` → `editor/panels/property-update.js`    | `bindFeaturePropertyControls`, `updateFeatureProperty` |
| **Move/rotate/mirror**   | `editor/geometry/transforms.js`                                        | `translateObject`, `rotateObjectAbout`, `mirrorObjectAcrossLine` |

To find every place a tool is handled, search `src/` for its id in quotes,
for example `"pin-support"`. `editor/index.js` lists every editor module
with a one-line description.

---

## General tools

| Tool   | Id       | Where                                                   |
| ------ | -------- | ------------------------------------------------------- |
| Select | `select` | `editor/interaction/selection.js` (`beginSelectionDrag`, `finishSelectionDrag`), `editor/interaction/canvas-click.js` |
| Pan    | `pan`    | `editor/interaction/canvas-events.js`                               |
| Zoom   | `zoom`   | `editor/workspace/viewport.js` (`zoomAtCanvasPoint`)              |
| Fit    | `fit`    | `editor/workspace/viewport.js` (`fitWholePage`, `fitSelected`)    |
| Move   | `move`   | `editor/commands/modify-tools.js` (`commitMove`) → `editor/geometry/transforms.js` |
| Rotate | `rotate` | `editor/commands/modify-tools.js` (`commitRotate`) → `rotateObjectAbout` |
| Mirror | `mirror` | `editor/commands/modify-tools.js` (`commitMirror`) → `mirrorObjectAcrossLine` |
| Trim   | `trim`   | `editor/commands/modify-tools.js` → `trimObjectToBoundary`        |
| Extend | `extend` | `editor/commands/modify-tools.js` → `extendObjectToBoundary`      |

The Modify and View buttons are wired in `editor/workspace/workspace-controls.js`.

---

## Geometry tools

| Tool         | Id             | Creation                                          |
| ------------ | -------------- | ------------------------------------------------- |
| Point        | `point`        | `createPointFeature` (`editor/geometry/geometry-creation.js`) |
| Line         | `line`         | `beginOrCompleteGeometry`                          |
| Triangle     | `triangle`     | `beginOrCompleteGeometry`; panel `editor/geometry/triangle-panel.js`, solving `editor/geometry/triangle-editing.js` |
| Rectangle    | `rectangle`    | `beginOrCompleteGeometry`                          |
| Circle       | `circle`       | `beginOrCompleteGeometry`                          |
| Arc          | `arc`          | 3-point or centre-point, chosen in `editor/toolbar/tool-menus.js`; arc maths in `editor/geometry/construction-geometry.js` |
| Polygon      | `polygon`      | by sides or by centre (`polygonFromCursor`, `polygonFromCentre`) |
| Coordinate System | `coordinate-system` | `add2DCoordinateSystem`                   |

All geometry is snapped by `core/snapping/object-snap.js` and measured by
`core/geometry/measurement-core.js`.

---

## Reference tools

| Tool              | Id                | Notes                                   |
| ----------------- | ----------------- | --------------------------------------- |
| Reference Point   | `reference-point` | single click (`editor/statics/statics-creation.js`) |
| Reference Line    | `reference-line`  | as Line; asks **Length** on creation    |
| Reference Arc     | `reference-arc`   | a true Arc with construction styling; asks **Radius** |

---

## Dimension tools

| Tool            | Id                | Notes                                 |
| --------------- | ----------------- | ------------------------------------- |
| Dimension       | `dimension`       | select references → **Enter** → place |
| Smart Dimension | `smart-dimension` | the same engine; infers the measurement |

| Concern                                  | File                                           |
| ---------------------------------------- | ---------------------------------------------- |
| Dimension data, measurement, geometry    | `features/dimensions/dimension-model.js`       |
| Which measurement a selection means      | `features/dimensions/smart-dimension.js`       |
| What a click refers to                   | `editor/annotate/dimension-inference.js`                |
| Choosing and committing                  | `editor/annotate/dimension-tool.js` (`commitDimension`) |
| Reference selection and placement        | `editor/annotate/dimension-placement.js` (`handleDimensionClick`) |
| Creation-time sizing popup               | `features/dimensions/creation-dimensioning.js` |
| Value editor                             | `features/dimensions/dimension-editor.js`      |
| Unit formatting                          | `core/units/quantities.js`                     |

**What a selection measures** (single click → **Enter**):

| Selection                                       | Result                      |
| ----------------------------------------------- | --------------------------- |
| Line, Beam, Truss, Cable, Shaft, Reference Line | Length                      |
| Circle                                          | Diameter                    |
| Arc, Reference Arc                              | Radius                      |
| Point + Point                                   | Distance                    |
| Line + Line                                     | Angle (parallel → distance) |
| Point + Line                                    | Perpendicular distance      |

---

## Statics tools

| Tool                                  | Id               | Creation                         | Where                                |
| ------------------------------------- | ---------------- | -------------------------------- | ------------------------------------ |
| Particle                              | `particle`       | single click                     | `editor/statics/statics-creation.js`         |
| Rigid Body                            | `rigid-body`     | single click, then shape         | shape edits in `editor/panels/property-inputs.js` |
| Beam, Cable, Shaft                    | `beam`, `cable`, `shaft` | two clicks + **Length**  | `editor/statics/statics-creation.js`         |
| Truss                                 | `truss`          | staged, member by member         | `editor/statics/truss-tool.js`; optimisation `editor/statics/truss-optimizer.js` |
| Point Force                           | `point-force`    | placement + vector drag          | `editor/statics/statics-creation.js`; vector maths `features/analysis/load-profile.js` |
| Distributed Load                      | `distributed-load` | body → start → end → magnitude → direction | `editor/statics/load-tool.js`; profile `features/analysis/load-profile.js` |
| Varying Distributed Load              | `varying-distributed-load` | as above, with profile points | `editor/statics/load-tool.js`        |
| Applied Moment                        | `applied-moment` | on a body or in free space       | `editor/statics/statics-attachment.js`; arc `features/analysis/rotational-arrow.js` |
| Couple                                | `couple`         | single click                     | `editor/statics/statics-creation.js`         |
| Pin / Roller / Fixed / Smooth Support | `pin-support` …  | pick the body, then the point    | `editor/statics/statics-attachment.js`       |
| Pin / Fixed / Slider Connection       | `pin-connection` … | between bodies                 | `editor/statics/statics-attachment.js`       |

Which tools attach to a body, how many points each takes and what each
asks for are defined once, in `editor/statics/statics-tools.js`.

**Length editing** for Beam, Cable, Truss and Shaft is one shared path:
search `editor/panels/property-update.js` for `key === "length"`. It converts
millimetres to drawing units through `core/scale/dimensions.js` and moves
the far end along the member's own direction.

**Attachments** (supports, loads, moments) are stored as a **fraction
along their parent** (`core/geometry/body-frames.js`), which is why they
survive a resize.

---

## Analysis tools

| Tool             | Id                       | Kind    | Values come from           |
| ---------------- | ------------------------ | ------- | -------------------------- |
| Resultant        | `resultant`              | derived | the summed source forces   |
| Force Components | `force-components`       | derived | one source force           |
| SFD              | `shear-force-diagram`    | diagram | the student's sketch or plot |
| BMD              | `bending-moment-diagram` | diagram | the student's sketch or plot |
| AFD              | `axial-force-diagram`    | diagram | the student's sketch or plot |

| Concern                                   | File                                         |
| ----------------------------------------- | -------------------------------------------- |
| Placing them                              | `editor/statics/analysis-tools.js`                   |
| Derived values and live updates           | `features/analysis/analysis-dependencies.js` |
| Diagram expressions                       | `features/analysis/diagram-equations.js`     |
| Sketch editor / Plot editor               | `ui/editors/sketch-editor.js`, `ui/editors/plot-editor.js` |

Resultant and Force Components are **derived and read-only**: they update
from their sources and cannot be edited into disagreeing with them.

---

## Annotations

| Concern                                        | File                                         |
| ---------------------------------------------- | -------------------------------------------- |
| Annotation model (text, placement, visibility) | `features/annotations/annotation-model.js`   |
| The annotation tools                           | `editor/annotate/annotation-tool.js`                  |
| Magnitude boxes drawn on the canvas            | `rendering/renderer.js` (`appendDerivedMagnitude`) |
| Magnitude box hit-testing                      | `editor/interaction/hit-testing.js` (`pickDerivedMagnitude`) |
| Magnitude box dragging                         | `editor/interaction/selection.js` (`beginSelectionDrag`) |

A magnitude annotation is a drawing-space object linked to its source: it
stores `sourceFeatureId`, position and visibility, never a copy of the
magnitude. It shows magnitude and unit only — never an angle; the arrow
communicates direction.

---

## Commands

| Command                       | Where                                                   |
| ----------------------------- | ------------------------------------------------------- |
| New, Open, Save, Save As      | `editor/commands/document-commands.js` → `file/file-save.js`, `file/document-file.js` |
| Print, export PNG/JPG/SVG     | `editor/commands/document-commands.js` → `file/document-export.js` |
| Crash recovery                | `editor/commands/document-commands.js` → `file/document-recovery.js` |
| Undo, Redo                    | `editor/toolbar/tool-activation.js` → `core/model/drawing-state.js` |
| Copy, Cut, Paste, Duplicate   | `editor/commands/clipboard-commands.js` → `core/selection/clipboard.js` |
| Delete                        | `editor/commands/delete-command.js`                              |
| Right-click menu              | `editor/interaction/context-menu.js`                                |
| Colour picker                 | `editor/panels/colour-picker.js`                               |
| Keyboard shortcuts            | `editor/interaction/keyboard-shortcuts.js`                          |
| Sheets                        | `editor/workspace/sheet-controller.js`, `sheets/`                 |
