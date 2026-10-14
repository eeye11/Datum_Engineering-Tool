# DAETUM — Tool Map

Where each toolbar command's code lives. Paths are under `src/`.

## A tool is a path through the editor

A tool is not one file. Every tool travels the same path through the
editor, and each stage has one home:

| Stage                    | Where                                                         | Entry point                     |
| ------------------------ | ------------------------------------------------------------- | ------------------------------- |
| **Registration**         | `editor/tools.js` — id, label, icon, shortcut, toolset        | `drawingToolGroups`, `disciplineToolGroups` |
| **Activation**           | `editor/tool-activation.js`                                   | `activateTool`                  |
| **Submenus**             | `editor/tool-menus.js`, `editor/statics-tools.js`             | `openToolSubmenu`, `openStaticsMenu` |
| **Pointer → point**      | `editor/pointer.js` (snapping, inference, status text)        | `resolvePointerPoint`           |
| **Click**                | `editor/canvas-click.js`                                      | `handleCanvasClick`             |
| **Preview**              | `editor/preview.js`                                           | `updatePreview`                 |
| **Creation — geometry**  | `editor/geometry-creation.js`                                 | `beginOrCompleteGeometry`       |
| **Creation — Statics**   | `editor/statics-creation.js`, `editor/statics-attachment.js`  | `createStaticsFeature`          |
| **Creation-time sizing** | `editor/creation-sizing.js` + `features/dimensions/creation-dimensioning.js` | `beginCreationDimensioning` |
| **Model**                | `core/model/drawing-state.js`                                 | `geometryFactories.<type>`      |
| **Rendering**            | `rendering/renderer.js`                                       | `renderDrawing`                 |
| **Hit-testing**          | `editor/hit-testing.js`, `editor/box-selection.js`            | `objectAtPoint`, `objectIntersectsSelection` |
| **Handles and dragging** | `editor/handles.js`, `editor/drag.js`                         | `manipulationHandles`, `beginManipulationDrag` |
| **Features panel**       | `editor/feature-panel.js` → `editor/feature-panel-markup.js`, `editor/statics-panel.js` | `renderProperties`, `featurePropertyMarkup` |
| **Panel edits**          | `editor/property-binding.js` → `editor/property-update.js`    | `bindFeaturePropertyControls`, `updateFeatureProperty` |
| **Move/rotate/mirror**   | `editor/transforms.js`                                        | `translateObject`, `rotateObjectAbout`, `mirrorObjectAcrossLine` |

To find every place a tool is handled, search `src/` for its id in quotes,
for example `"pin-support"`. `editor/index.js` lists every editor module
with a one-line description.

**Two toolsets keep their entries in their own module** rather than in
`editor/tools.js`: Annotate (`annotateToolGroups`) and Fluids
(`features/fluids/fluids-tools.js`). Both are registered in
`disciplineToolGroups`, so the toolbar reads them the same way it reads every
other discipline.

---

## General tools

| Tool   | Id       | Where                                                   |
| ------ | -------- | ------------------------------------------------------- |
| Select | `select` | `editor/selection.js` (`beginSelectionDrag`, `finishSelectionDrag`), `editor/canvas-click.js` |
| Pan    | `pan`    | `editor/canvas-events.js`                               |
| Zoom   | `zoom`   | `editor/viewport.js` (`zoomAtCanvasPoint`)              |
| Fit    | `fit`    | `editor/viewport.js` (`fitWholePage`, `fitSelected`)    |
| Move   | `move`   | `editor/modify-tools.js` (`commitMove`) → `editor/transforms.js` |
| Rotate | `rotate` | `editor/modify-tools.js` (`commitRotate`) → `rotateObjectAbout` |
| Mirror | `mirror` | `editor/modify-tools.js` (`commitMirror`) → `mirrorObjectAcrossLine` |
| Trim   | `trim`   | `editor/modify-tools.js` → `trimObjectToBoundary`        |
| Extend | `extend` | `editor/modify-tools.js` → `extendObjectToBoundary`      |

The Modify and View buttons are wired in `editor/workspace-controls.js`.

---

## Geometry tools

| Tool         | Id             | Creation                                          |
| ------------ | -------------- | ------------------------------------------------- |
| Point        | `point`        | `createPointFeature` (`editor/geometry-creation.js`) |
| Line         | `line`         | `beginOrCompleteGeometry`                          |
| Triangle     | `triangle`     | `beginOrCompleteGeometry`; panel `editor/triangle-panel.js`, solving `editor/triangle-editing.js` |
| Rectangle    | `rectangle`    | `beginOrCompleteGeometry`                          |
| Circle       | `circle`       | `beginOrCompleteGeometry`                          |
| Arc          | `arc`          | 3-point or centre-point, chosen in `editor/tool-menus.js`; arc maths in `editor/construction-geometry.js` |
| Polygon      | `polygon`      | by sides or by centre (`polygonFromCursor`, `polygonFromCentre`) |
| Coordinate System | `coordinate-system` | `add2DCoordinateSystem`                   |

All geometry is snapped by `core/snapping/object-snap.js` and measured by
`core/geometry/measurement-core.js`.

---

## Reference tools

| Tool              | Id                | Notes                                   |
| ----------------- | ----------------- | --------------------------------------- |
| Reference Point   | `reference-point` | single click (`editor/statics-creation.js`) |
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
| What a click refers to                   | `editor/dimension-inference.js`                |
| Choosing and committing                  | `editor/dimension-tool.js` (`commitDimension`) |
| Reference selection and placement        | `editor/dimension-placement.js` (`handleDimensionClick`) |
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
| Particle                              | `particle`       | single click                     | `editor/statics-creation.js`         |
| Rigid Body                            | `rigid-body`     | single click, then shape         | shape edits in `editor/property-inputs.js` |
| Beam, Cable, Shaft                    | `beam`, `cable`, `shaft` | two clicks + **Length**  | `editor/statics-creation.js`         |
| Truss                                 | `truss`          | staged, member by member         | `editor/truss-tool.js`; optimisation `editor/truss-optimizer.js` |
| Point Force                           | `point-force`    | placement + vector drag          | `editor/statics-creation.js`; vector maths `features/analysis/load-profile.js` |
| Distributed Load                      | `distributed-load` | body → start → end → magnitude → direction | `editor/load-tool.js`; profile `features/analysis/load-profile.js` |
| Varying Distributed Load              | `varying-distributed-load` | as above, with profile points | `editor/load-tool.js`        |
| Applied Moment                        | `applied-moment` | on a body or in free space       | `editor/statics-attachment.js`; arc `features/analysis/rotational-arrow.js` |
| Couple                                | `couple`         | single click                     | `editor/statics-creation.js`         |
| Pin / Roller / Fixed / Smooth Support | `pin-support` …  | pick the body, then the point    | `editor/statics-attachment.js`       |
| Pin / Fixed / Slider Connection       | `pin-connection` … | between bodies                 | `editor/statics-attachment.js`       |

Which tools attach to a body, how many points each takes and what each
asks for are defined once, in `editor/statics-tools.js`.

**Length editing** for Beam, Cable, Truss and Shaft is one shared path:
search `editor/property-update.js` for `key === "length"`. It converts
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
| Placing them                              | `editor/analysis-tools.js`                   |
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
| The annotation tools                           | `editor/annotation-tool.js`                  |
| Magnitude boxes drawn on the canvas            | `rendering/renderer.js` (`appendDerivedMagnitude`) |
| Magnitude box hit-testing                      | `editor/hit-testing.js` (`pickDerivedMagnitude`) |
| Magnitude box dragging                         | `editor/selection.js` (`beginSelectionDrag`) |

A magnitude annotation is a drawing-space object linked to its source: it
stores `sourceFeatureId`, position and visibility, never a copy of the
magnitude. It shows magnitude and unit only — never an angle; the arrow
communicates direction.

---

## Fluids tools

The Fluids section is a **registry of entries, each bound to an existing
DAETUM system**. The section itself owns no engineering behaviour yet; what it
owes is the six subcategories, the seventeen entries, and the binding from each
entry to the shared system it travels.

| Concern                                  | File                                          |
| ---------------------------------------- | --------------------------------------------- |
| The six subcategories and 17 entries     | `features/fluids/fluids-tools.js`             |
| The `capability` that binds an entry     | `features/fluids/fluids-tools.js`             |
| Activation: what pressing one arms       | `editor/fluids-tool.js` (`fluidsArmedTool`)   |
| The opening instruction for a tool       | `editor/fluids-tool.js` (`fluidsInstruction`) |
| The active-tool highlight for a shape    | `editor/fluids-tool.js` (`isFluidsToolActive`)|

**The subcategories and their tools** (from `fluidsToolGroups`):

| Subcategory           | Tools                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Selection             | Select                                                             |
| Flow Paths            | Pipe / Duct, Elbow, Junction, Reducer / Expander, Reservoir / Tank |
| Equipment             | Pump, Valve, Flow Meter                                            |
| Flow Representation   | Flow Arrow, Fluid Level                                            |
| Measurements          | Pressure Tap, Pipe Diameter, Section Plane                         |
| Fluid Annotations     | Fluid Property Label, Flow Rate Label, Elevation Marker            |

**What each entry reuses, by `capability`:**

| Capability  | The shared system it travels                                     |
| ----------- | ---------------------------------------------------------------- |
| `select`    | the ordinary selection system                                    |
| `shape`     | the geometry creation pipeline, via the `geometryTool` it names  |
| `dimension` | the Smart Dimension engine (`editor/dimension-tool.js`)          |
| `annotate`  | the Annotate model, via the `annotateKind` it names              |
| `planned`   | nothing yet — listed, and honest about it                        |

A `shape` entry activates its **primitive** (`line`, `rectangle`, `point`), so
the drawing, snapping, preview, commit, selection, movement, undo and save are
the primitive's own — there is no second creation pipeline. The toolbar still
highlights the Fluids button, because `editor/fluids-tool.js` answers the same
question the activation did.

**Adding a real Fluid tool later** means giving its entry a capability of its
own and implementing that capability — not restructuring the section, and not
editing the toolbar, the icons or the categories.

---

## Commands

| Command                       | Where                                                   |
| ----------------------------- | ------------------------------------------------------- |
| New, Open, Save, Save As      | `editor/document-commands.js` → `file/file-save.js`, `file/document-file.js` |
| Print, export PNG/JPG/SVG     | `editor/document-commands.js` → `file/document-export.js` |
| Crash recovery                | `editor/document-commands.js` → `file/document-recovery.js` |
| Undo, Redo                    | `editor/tool-activation.js` → `core/model/drawing-state.js` |
| Copy, Cut, Paste, Duplicate   | `editor/clipboard-commands.js` → `core/selection/clipboard.js` |
| Delete                        | `editor/delete-command.js`                              |
| Right-click menu              | `editor/context-menu.js`                                |
| Colour picker                 | `editor/colour-picker.js`                               |
| Keyboard shortcuts            | `editor/keyboard-shortcuts.js`                          |
| Sheets                        | `editor/sheet-controller.js`, `sheets/`                 |
