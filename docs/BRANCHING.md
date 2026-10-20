# DAETUM — Branching and Collaboration Workflow

How the engineering categories are developed without stepping on each
other. This documents the branch structure, who owns what, and the exact
commands for each step.

---

## 1. The branch structure

```
main                    stable, tested releases
└── develop             shared integration branch (everyone's work lands here)
    ├── category/geometry
    ├── category/annotate
    ├── category/statics
    ├── category/dynamics
    ├── category/fluids
    ├── category/thermodynamics
    ├── category/heat-transfer
    ├── category/solid-mechanics
    ├── category/mechanical-design
    ├── category/controls
    ├── category/math-analysis
    └── category/shared-infra
```

| Branch | Purpose | Integration destination |
| --- | --- | --- |
| `main` | Stable, tested releases only | — |
| `develop` | Shared integration; reviewed category work merges here | `main` after checks pass |
| `category/*` | The persistent working branch for one category | `develop` via pull request |
| `category/shared-infra` | Cross-cutting changes: units, geometry, snapping, rendering, registration, undo/redo, Features panel | `develop` via pull request, then merged back into the affected category branches |

`develop` is the **common baseline**. Every `category/*` branch was cut
from it, and it is the only place category work is combined.

---

## 2. Coworker workflow

1. **Fetch the latest state**

   ```powershell
   git fetch origin --prune
   ```

2. **Check out your category branch**

   ```powershell
   git switch category/statics
   git pull --ff-only
   ```

3. **Confirm the working tree is clean** before you start

   ```powershell
   git status --short --branch
   ```

4. **Work, and run the checks locally** before committing

   ```powershell
   npm run lint
   npm test
   npm run build
   ```

5. **Commit logically grouped changes** (one idea per commit)

   ```powershell
   git add <files>
   git commit -m "feat(statics): ..."
   ```

6. **Push to your category branch**

   ```powershell
   git push origin category/statics
   ```

7. **Open a pull request** from `category/statics` into `develop`, and
   merge it once reviewed and green.

> Do not have two people commit to the same working directory at once.
> Different branches do **not** prevent conflicts when the same shared
> file is edited — see section 4.

---

## 3. Several people inside one category

If two or more people work on the same category, do not all commit to the
category branch directly. Cut a short-lived task branch from it:

```
category/annotate
├── task/annotate-smart-dimension
├── task/annotate-table
```

```powershell
git switch category/annotate
git pull --ff-only
git switch -c task/annotate-table
# ... work, commit ...
git push -u origin task/annotate-table
```

Then open a pull request from `task/annotate-table` into
`category/annotate`. Once merged, the updated category branch can go into
`develop` in the usual way.

Keep the `category/*` branches as the persistent collaboration branches;
task branches are for work that is substantial or likely to conflict.

---

## 4. Shared infrastructure — read this before you edit it

Some code is used by **every** category. Changing it on one category
branch and nowhere else is how the branches silently drift apart. This
work has its own branch, **`category/shared-infra`**, cut from `develop`
like the others.

| Shared system | Where |
| --- | --- |
| Universal units and value parsing | `core/units/quantities.js`, `core/scale/` |
| Shared geometry model | `core/geometry/`, `core/model/drawing-state.js` |
| Snapping and direct manipulation | `core/snapping/object-snap.js`, `editor/interaction/drag.js`, `editor/interaction/handles.js` |
| Feature registration and tool list | `editor/toolbar/tools.js`, `editor/toolbar/toolbar-render.js` |
| Selection and canvas interaction | `editor/interaction/selection.js`, `editor/interaction/canvas-click.js`, `editor/interaction/canvas-events.js`, `editor/interaction/pointer.js` |
| Rendering and annotation primitives | `rendering/` (all of it) |
| Undo/redo and persistence | `core/model/drawing-state.js`, `file/` |
| Common property inputs and Features panel | `editor/panels/feature-panel*.js`, `editor/panels/property-binding.js`, `editor/panels/property-update.js` |
| Analysis data types and interfaces | `features/analysis/` |

**When a change touches one of these:**

1. Write down what the shared change is and why.
2. List which category branches are affected.
3. Agree the interface or data contract with the other owners **first**.
4. Make the change on `category/shared-infra` with tests.
5. Merge it into `develop` via pull request, then bring `develop` back into
   each affected category branch (section 6).

`category/shared-infra` is not a place for category-specific features. A
tool that only one category uses belongs on that category's branch; only
the genuinely cross-cutting systems above belong here. Keep it merged
into `develop` promptly — the longer a shared change sits unmerged, the
more the category branches drift.

Do **not** make a different version of a shared file on each category
branch. That is the failure mode this structure exists to prevent.

---

## 5. Integration and release

- Category work → `develop` through review and validation.
- `develop` → `main` only after the integrated application passes its checks.
- Do not merge every branch just because it exists. A category branch
  merges when it contains intended, tested changes.
- A freshly created category branch contains no feature work. Its
  existence is not a claim that the category is implemented.

---

## 6. Keeping a category branch up to date with `develop`

```powershell
git switch category/statics
git fetch origin
git merge origin/develop      # or: git rebase origin/develop, if the branch is private
```

Resolve conflicts here, in the category branch, and push. Never
force-push a branch other people are working on.

---

## 7. What "green" means

`.github/workflows/ci.yml` runs, on every push and pull request:

| Step | Command |
| --- | --- |
| Lint | `npm run lint` |
| Unit and integration tests | `npm test` |
| Build | `npm run build` |
| Integration API in the browser | `tests/e2e/static-server.mjs` + `tests/e2e/api-check.mjs` |
| Every tool in the browser | `tests/e2e/golden-scenario.mjs` + `tests/e2e/golden-errors.mjs` (no step may raise a page error) |

All five must pass (`npm run check` runs the first three locally). The browser steps drive the real UI in Chrome, so a
test that clicks the wrong element fails there even when lint and unit
tests are green — check the actual DOM, not just the selector you expect.

---

## 8. Source-code ownership per category

The categories that have real tools have a folder of their own in the
editor - `editor/geometry/`, `editor/annotate/`, `editor/statics/`,
`editor/thermodynamics/` - so most
of a category's work stays inside it. Every category's tools are still
registered in `editor/toolbar/tools.js` and travel the shared pipeline in
`docs/TOOL-MAP.md`. A new category (Dynamics, Fluids, …) should follow the
same shape: `editor/<category>/` for its tools, a draw function in
`rendering/entities/` plus an entry in `ENTITY_RENDERERS` for each new
feature type, and its type declared once in `core/model/feature-types.js`.
Ownership below means *the files a category's work will most often change*,
not exclusive ownership.

| Category | Branch | Registered tools (from `editor/toolbar/tools.js`) | Primary files |
| --- | --- | --- | --- |
| GEOMETRY | `category/geometry` | Select, Point, Line, Triangle, Rectangle, Circle, Arc, Polygon, Coordinate System | `editor/geometry/geometry-creation.js`, `editor/geometry/construction-geometry.js`, `core/geometry/` |
| ANNOTATE | `category/annotate` | Dimension, Note / Text, Label, Leader, Callout, Arrow, Symbol, Tolerance, Table | `editor/annotate/annotate-creation.js`, `editor/annotate/annotation-tool.js`, `features/annotations/annotate-model.js`, `features/dimensions/`, `ui/editors/symbol-picker.js`, `ui/editors/table-picker.js` |
| STATICS | `category/statics` | Bodies, Point Force, Loads, Moment, Supports, Connections; Resultant, Force Components, SFD, BMD, AFD; Coordinate System, Reference Point/Line/Arc | `editor/statics/statics-creation.js`, `editor/statics/statics-attachment.js`, `editor/statics/statics-tools.js`, `editor/statics/analysis-editor.js`, `editor/statics/analysis-tools.js`, `features/analysis/` |
| DYNAMICS | `category/dynamics` | Particle, Rigid Body, Velocity, Acceleration, Rotation, Motion Path | `editor/toolbar/tools.js` (registration), shared creation path |
| FLUIDS | `category/fluids` | Pipe / Duct (with elbows at 45/90 degree corners), Elbow, Junction, Reducer / Expander, Reservoir / Tank; Pump, Valve, Flow Meter; Flow Arrow, Fluid Level; Pressure Tap, Pipe Diameter, Section Plane; Fluid Property Label, Flow Rate Label, Elevation Marker | `features/workspace/model/fluids/` (pipe-duct, fluids-tools), `features/workspace/interaction/pipe-duct-tool.js` and `fluids-tool.js`, `shared/rendering/entities/draw-fluids.js`, `shared/rendering/latex/source-writers/fluids.js` |
| THERMODYNAMICS | `category/thermodynamics` | Control Volume, Piston Cylinder (with/without stoppers), Process Diagrams (Process Plot, Saturation Curve, Process Path with bendable segments, Const Temp/Pressure Lines), State Point, Heat Transfer (Heat Entering / Leaving), Work (Electric / Mechanical) | `editor/thermodynamics/`, `features/thermodynamics/`, `rendering/entities/draw-thermodynamics.js`, `core/selection/selection-transform.js` (group move/resize) |
| HEAT TRANSFER | `category/heat-transfer` | Wall, Layer, Heat Flux, Temperature, Convection, Radiation | `editor/toolbar/tools.js` (registration), shared creation path |
| SOLID MECHANICS | `category/solid-mechanics` | Beam, Shaft, Load, Stress, Strain, Boundary Condition | `editor/toolbar/tools.js` (registration), shared creation path |
| MECHANICAL DESIGN | `category/mechanical-design` | Part, Hole, Shaft, Gear, Fastener, Section View | `editor/toolbar/tools.js` (registration), shared creation path |
| CONTROLS | `category/controls` | Block, Input, Output, Sensor, Controller, Signal Arrow | `editor/toolbar/tools.js` (registration), shared creation path |
| MATH / ANALYSIS | `category/math-analysis` | Point, Function, Vector, Graph, Equation | `editor/toolbar/tools.js` (registration), shared creation path |
| SHARED INFRA | `category/shared-infra` | *(none — cross-cutting)* | `core/units/`, `core/geometry/`, `core/snapping/`, `rendering/`, `editor/toolbar/tools.js`, `editor/toolbar/toolbar-render.js`, `editor/interaction/selection.js`, `editor/interaction/canvas-click.js`, `editor/panels/feature-panel*.js` |

**Important:** the six categories from DYNAMICS to MATH / ANALYSIS are
listed in the `engineeringTools` registry but do not yet have their own
feature modules — they route through the shared creation pipeline. Their
branches exist and are ready; the work to give them real tools is theirs
to do. Do not commit placeholder panels that imply unsupported features
work.

---

## 9. Quick command reference

```powershell
# See every branch and what it tracks
git branch -vv

# Start on a category
git switch category/geometry

# New task branch inside a category
git switch -c task/geometry-circle

# Publish a new branch
git push -u origin task/geometry-circle

# Bring develop into your category branch
git switch category/geometry
git fetch origin
git merge origin/develop

# Confirm your branch is level with the remote
git status --short --branch
```