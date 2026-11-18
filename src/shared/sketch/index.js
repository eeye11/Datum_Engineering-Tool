/*
 * ============================================================
 * THE SHARED SKETCH INFRASTRUCTURE - ONE ENTRY POINT
 * ============================================================
 *
 * Every sketch-based tool imports from here, so there is ONE namespace for
 * "how DAETUM does sketches" and a tool cannot accidentally assemble a second
 * half-set of the modules.
 *
 * THE PIECES, AND WHAT EACH OWNS
 * ------------------------------
 *
 *   points        what a point IS: anchor (with a "path" or "centre" role),
 *                 control, inferred; absolute, relative and polar coordinates;
 *                 locking; association with geometry; insertion on geometry
 *   viewport      model <-> screen, equal X/Y scale, bounds - the only place the
 *                 two spaces meet
 *   grid          axes, ticks, labels, major and minor grid - each independent
 *                 of the others
 *   snap          the candidate places Add Point may land on: grid corners,
 *                 midpoints, cell centres, anchors, geometry
 *   adapters      the per-shape mathematics behind one interface, so a line, a
 *                 circle and a spline are usable by the same solver
 *   correction    recognition and CONSTRAINT-AWARE fitting: associated anchors
 *                 exact, primitives rejected rather than forced, conflicts
 *                 reported
 *   curveAnalysis derivative-based trend analysis (increasing/decreasing and
 *                 concavity) and the least-squares cubic chain a general curve
 *                 is reconstructed as
 *   appearance    line style, colour, thickness, fill - stored on the geometry,
 *                 not applied to a preview
 *   document      the ONE geometry model every view reads
 *   history       undo and redo over that model
 *   render        the one painter, shared by the editor and the drawing
 *   placement     the transform into the main drawing, explicit and repeatable
 *   source        TikZ generated FROM the model
 *   sourceParser  TikZ read back INTO the model
 *
 * The workspace UI lives in `src/shared/ui/sketch/` and is the only consumer
 * that needs all of them at once.
 */

export * from "./sketch-points.js";
export * from "./sketch-viewport.js";
export * from "./sketch-grid.js";
export * from "./sketch-axes.js";
export * from "./sketch-geometry-adapters.js";
export * from "./sketch-curve-analysis.js";
export * from "./sketch-correction.js";
export * from "./sketch-appearance.js";
export * from "./sketch-document.js";
export * from "./sketch-history.js";
export * from "./sketch-render.js";
export * from "./sketch-snap.js";
export * from "./sketch-placement.js";
export * from "./sketch-source.js";
export * from "./sketch-source-parser.js";

import * as points from "./sketch-points.js";
import * as viewport from "./sketch-viewport.js";
import * as grid from "./sketch-grid.js";
import * as axes from "./sketch-axes.js";
import * as adapters from "./sketch-geometry-adapters.js";
import * as correction from "./sketch-correction.js";
import * as curveAnalysis from "./sketch-curve-analysis.js";
import * as snap from "./sketch-snap.js";
import * as appearance from "./sketch-appearance.js";
import * as documentModel from "./sketch-document.js";
import * as history from "./sketch-history.js";
import * as render from "./sketch-render.js";
import * as placement from "./sketch-placement.js";
import * as source from "./sketch-source.js";
import * as sourceParser from "./sketch-source-parser.js";

const enggSketch = {
  points,
  viewport,
  grid,
  axes,
  adapters,
  correction,
  curveAnalysis,
  snap,
  appearance,
  document: documentModel,
  history,
  render,
  placement,
  source,
  sourceParser,
};

export default enggSketch;
