# DAETUM — Geometry Tools Implementation Task List

Derived from an audit of the working tree (2026-10-16). Paths reflect the current
restructure: implementation lives under `src/features/workspace/`, panels under

See the detailed step-by-step plan in [GEOMETRY-TOOLS-IMPLEMENTATION.md](GEOMETRY-TOOLS-IMPLEMENTATION.md).
`src/components/layout/panels/`, tool definitions under `src/tool-library/`.

## Phase 0 — Audit & prerequisite verification

- [ ] 0.1 Audit `src/features/workspace/` (interaction, geometry, model, commands) and record
      which of press-hold-drag-release, preview, multistage gestures, Escape-cancel and
      click-vs-drag disambiguation already exist; reuse, do not rebuild.
- [ ] 0.2 Verify grid snapping is functional: run `tests/grid-snapping.test.cjs` and
      `tests/general-snap-and-grid-snap.test.cjs`; confirm grid spacing is zoom/pan stable and
      independent of World Scale. Fix before Phase 1 if broken.
- [ ] 0.3 Verify object snapping (endpoint, midpoint, intersection, centre, quadrant,
      point-on-entity) exists and is reachable from construction gestures.
- [ ] 0.4 Verify the `Objects | Features | Source` panel foundation: `panel-tabs.js` order,
      `features-pane.js`, `property-panel.js`, `source-editor.js`, `source-tab.js`,
      `source-canvas-bridge.js`, `drawing-panel.js`. Fix and verify before Phase 1.
- [ ] 0.5 Audit source pipeline: canonical drawing source, source map / object-ID mapping,
      renderer (`server/tikz.js`, `/api/render-tikz`), LaTeX reader (`src/shared/rendering/latex/`),
      Written Solution insertion (`src/shared/solution/`).
- [ ] 0.6 Audit persistence: sheet save/reopen path, Fixed-state serialisation, current test suite
      baseline (`npm run test`, `npm run lint`) — record pass/fail counts before changes.
- [ ] 0.7 Confirm the registry (`src/tool-library/registry/`) loads every `manifest.json` and
      `template.tex`; note the missing Freeform Polygon entry.

## Phase 1 — Shared interaction and snapping

- [ ] 1.1 Implement/confirm a shared construction-gesture controller (press → hold & drag →
      release) used by all geometry tools; multistage support via successive drags.
- [ ] 1.2 Implement live construction preview driven by the snapped cursor.
- [ ] 1.3 Escape cancels an unfinished construction at any stage without committing.
- [ ] 1.4 Guard against accidental commit on click-without-movement (consistent with existing
      pointer architecture).
- [ ] 1.5 Centralise snap resolution: object snap (within tolerance) → grid snap → raw pointer;
      expose one `resolvePoint()` used by construction, editing, and source generation.
- [ ] 1.6 Verify grid spacing stays consistent under zoom/pan and is not tied to physical units or
      World Scale.

## Phase 2 — Source-generation architecture

- [ ] 2.1 Establish one canonical drawing source per sheet (editable `tikzpicture`); empty sheet =
      empty tikzpicture, no placeholder comments, no DAETUM markers, no boundary rectangle.
- [ ] 2.2 Build/extend the source map: generated source regions ↔ stable object IDs, preserving
      custom (hand-edited) source blocks.
- [ ] 2.3 Implement per-object source regeneration that replaces only the object's own source
      region (no full-render overwrite when one object changes).
- [ ] 2.4 Define shared style helpers in `src/tool-library/shared/primitives/`: thickness presets
      (thin/normal/thick → line width), dash styles (solid/dashed/dotted), fill styles
      (none/solid), colour validation/escaping, marker sizes, arrowheads.
- [ ] 2.5 Wire the Source tab: editable, monospaced, line numbers/syntax colours, no black
      terminal box, no nested scroll containers; invalid drafts preserved with diagnostics; last
      good render kept on failure; selection ↔ source-region highlighting.

## Phase 3 — The nine geometry tools

Each tool: construction workflow (§3 of spec), preview, snapping on every gesture, Features tab,
Fixed option, TikZ generation from committed geometry, registry/library entry, selection and
editing, persistence.

- [ ] 3.1 **Point** — single drag places marker at snapped position. Features: marker style
      Dot/Cross, size Small/Medium/Large, colour, Fixed. Source: `\fill` circle (dot) or two
      perpendicular strokes (cross). Populate `geometry/create/point`.
- [ ] 3.2 **Line** — press-drag-release endpoints. Features: style, colour, thickness, Fixed.
      Source: `\draw[...] (p1) -- (p2);`. Populate `geometry/create/line`.
- [ ] 3.3 **Triangle** — drag 1 = base, drag 2 = third vertex; reject degenerate. Features: fill
      mode/colour, outline colour, thickness, Fixed. Source: 3-vertex `-- cycle` path.
      Populate `geometry/create/triangle`.
- [ ] 3.4 **Rectangle** — corner-to-corner drag; Shift = square. Features as triangle.
      Source: `(p1) rectangle (p2);`. Preserve right angles in editing.
      Populate `geometry/create/rectangle`.
- [ ] 3.5 **Circle** — centre drag defines radius from committed points; no numeric radius input.
      Source: `(c) circle[radius=r];`. Populate `geometry/create/circle`.
- [ ] 3.6 **Arc, Method A (Three Points)** — chord drag then curve-point drag; circumcircle
      through the three points; correct sweep through the defining point; reject
      collinear/coincident without corrupting the drawing.
- [ ] 3.7 **Arc, Method B (Centre–Start–End)** — centre drag fixes centre+radius+start; second
      drag around centre sets endpoint and sweep direction; track angular movement so the chosen
      sweep isn't replaced by the shorter arc. Method selector in Features.
- [ ] 3.8 **Arc source generation** — `arc[start angle=, end angle=, radius=]` with unwrapped
      angles (zero-crossing safe); verify generated endpoints match stored geometry. Populate
      `geometry/create/arc`.
- [ ] 3.9 **Polygon (regular), Centre method** — centre drag defines circumradius + orientation;
      preview updates live.
- [ ] 3.10 **Polygon, Side method** — dragged segment is an actual polygon edge (endpoints match
      generated vertices); deterministic construction direction, allow flip.
- [ ] 3.11 **Polygon Features & source** — side-count integer (min 3, default 6) that updates
      preview, geometry, and source immediately without redrawing; fill/appearance/Fixed;
      vertex-list `-- cycle` source. Populate `geometry/create/polygon`.
- [ ] 3.12 **Freeform Polygon** — successive drag gestures add vertices; closing snap highlights
      the first vertex within tolerance; Escape cancels; ≥3 distinct vertices to commit; no
      side-count field; per-vertex editing; no regular-polygon constraints. Add to registry and
      tool library (`geometry/create/freeform-polygon`).
- [ ] 3.13 **Coordinate System** — origin drag + X-axis direction drag; Y-axis derived
      perpendicular to X regardless of grid snap. Features: show X/Y axes, show labels, label
      texts (default x / y / O), colour, thickness, Fixed. Source: arrowed axis paths with
      escaped label nodes; omit per settings. Populate `geometry/construction/coordinate-system`.

## Phase 4 — Features and object behaviour

- [ ] 4.1 Verify Objects tab: clean list only (no property form beneath), readable names
      (`Point 1`, `Line 1`, …), two-way selection highlighting, stable ordering, sync with
      create/delete.
- [ ] 4.2 Wire Features tab dual mode: tool defaults when nothing selected; selected object's
      editable properties when selected; switching selection updates the panel; one shared store
      (no competing tool-vs-object settings).
- [ ] 4.3 Implement Fixed for every tool: default Off; tool-level default for new objects;
      object-level reflect/control when selected; blocks move/resize/rotate/reshape and handles,
      keeps selectable, allows appearance changes, allows unfix and deliberate deletion, remains a
      snap target; persists through save/reopen; no nonstandard TikZ commands.
- [ ] 4.4 Implement editing handles per tool (point move; line endpoints/whole line; triangle
      vertices/whole; rectangle corner resize; circle centre+radius; arc defining points; polygon
      safe controls preserving regularity; freeform per-vertex; coordinate-system origin +
      direction with perpendicular axes) — all through the shared Snap system, Fixed-aware.

## Phase 5 — Rendering, editing, and Written Solution

- [ ] 5.1 Verify the full lifecycle per object: construct → snap-resolve → validate → create with
      stable ID → Objects list → TikZ from committed geometry → source map update → render →
      canvas/Objects/Features/Source synchronised.
- [ ] 5.2 Preserve custom/hand-edited source that can't be represented as a structured object
      (source-controlled content, never silently overwritten).
- [ ] 5.3 Written Solution insertion: insert the current source as a plain `tikzpicture`; empty
      sheet identified as e.g. `Sheet 1 — Empty`; no delimiters, metadata, `\input`,
      `\documentclass`, or placeholder geometry; preserve unrelated content.

## Phase 6 — Tool library / registry

- [ ] 6.1 Confirm all nine tool IDs registered, with Create/Construction groupings preserved and
      valid library paths.
- [ ] 6.2 Add Freeform Polygon manifest + template to registry and library.
- [ ] 6.3 Fill every geometry `template.tex` with a useful starting pattern (template, not static
      output — generators substitute committed geometry and feature settings).
- [ ] 6.4 Keep registry separate from implementation; route generation through shared primitives.

## Phase 7 — Tests, verification, and delivery

- [ ] 7.1 Unit tests per tool: source generation from committed geometry (dot/cross point; line
      dash/thickness; triangle closure/fill; rectangle corners/square; circle radius; arc sweep
      and zero-crossing + degenerate rejection; polygon centre/side + side-count change; freeform
      vertices + closure; coordinate-system perpendicularity/labels/escaping).
- [ ] 7.2 Snapping tests: grid snap, object snap precedence, snap used by model/source not just
      visuals, fixed objects remain snap targets.
- [ ] 7.3 Fixed-state tests: blocks edits, persists, unfix works.
- [ ] 7.4 Panel tests: tab order Objects|Features|Source; Objects list purity; Features dual
      mode; Source editor styling and editability; selection ↔ source mapping.
- [ ] 7.5 Persistence tests: save/reopen preserves geometry and Fixed state; custom source
      survives edits; Written Solution insertion contents.
- [ ] 7.6 E2E/browser verification of each tool's press-hold-drag-release workflow, preview,
      Escape, and editing via the existing Select tool.
- [ ] 7.7 Regression: full `npm run test`, `npm run lint`, production build,
      `git diff --check`; report each result separately; investigate any unexplained test-count
      changes. Do not delete or weaken existing tests.
- [ ] 7.8 Final report: files created/modified, per-tool workflow summary, per-tool TikZ
      generation summary, snapping verification, Fixed behaviour, panel integration, Written
      Solution behaviour, test/lint/build/browser results, known limitations.

## Execution order & dependencies

1. Phase 0 gates Phases 1–3 (snapping and panel foundation must pass first).
2. Phases 1–2 are prerequisites for all of Phase 3; implement Phase 2 style/source-map
   infrastructure alongside the first tool (Point) to prove the lifecycle.
3. Within Phase 3, build in order: Point → Line → Rectangle → Circle → Triangle → Arc →
   Polygon → Freeform Polygon → Coordinate System (simplest to richest).
4. Phases 4–6 run concurrently with Phase 3 tools; each tool is complete only when its Features,
   Fixed, Objects entry, and source generation are wired.
5. Phase 7 is continuous — add tests per tool as it lands, then run full regression.

## Reuse constraints (apply to every task)

- No parallel implementations of the drawing model, snapping, registry, renderer, or persistence.
- Do not implement Select as a new tool; extend the existing Select for the new geometry.
- All committed geometry comes from the shared snap-resolved points; those points are the single
  source of truth for canvas, model, and TikZ source.
- No engineering-unit or physical-measurement inputs; no numeric radius/angle/side-length fields.
