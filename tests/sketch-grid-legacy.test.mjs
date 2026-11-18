/*
 * ========================================================
 * THE LEGACY GRAPH FIELDS CONVERT WITHOUT CHANGING A DRAWING
 * ========================================================
 *
 * This is the regression test for the single most damaging way the coordinate
 * migration could fail: an existing graph saved with NO grid silently gaining
 * one, on the main sheet, in every reopened file.
 *
 * It is a plain module test - no DOM - because the adapter is pure arithmetic.
 */
import {
  gridFromGeometry,
  applyGridToGeometry,
} from "../src/shared/sketch/sketch-grid-legacy.js";

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`}`,
  );
};

/* THE DEFECT THAT WOULD RUIN EVERY REOPENED DRAWING. */
const sketchedCommit = {
  showGrid: false,
  showXAxis: false,
  showYAxis: false,
  showTickLabels: false,
  xTickSpacing: null,
  yTickSpacing: null,
  gridDivisions: 1,
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
  boundsMode: "auto",
};

const s = gridFromGeometry(sketchedCommit);

check("sketch: NO major grid", s.showMajorGrid, false);
check("sketch: NO minor grid", s.showMinorGrid, false);
check("sketch: NO x axis", s.showXAxis, false);
check("sketch: NO y axis", s.showYAxis, false);
check("sketch: NO tick labels", s.showTickLabels, false);
check("sketch: NOT in output", s.includeInOutput, false);

/* A legacy PLOT graph: grid on, default axes and numbers. */
const plottedGraph = {
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
  showTickLabels: true,
  xTickSpacing: 2,
  yTickSpacing: 0.5,
  gridDivisions: 1,
  xMin: -10,
  xMax: 10,
  yMin: -5,
  yMax: 5,
  equalUnits: true,
};

const p = gridFromGeometry(plottedGraph);

check("plot: major grid ON", p.showMajorGrid, true);
check("plot: minor grid OFF (divisions=1)", p.showMinorGrid, false);
check("plot: X interval honoured", p.majorX, 2);
/*
 * `equalUnits: true` LINKS the intervals, so Y follows X. The stored Y of 0.5
 * is preserved in the settings for when the link is switched off, but the
 * EFFECTIVE interval is the linked one - that is the point of the link.
 */
check("plot: link (equalUnits)", p.linkXYIntervals, true);
check("plot: Y follows linked X", p.majorY, 2);
check("plot: axes in output", p.includeInOutput, true);

/* A sketch with a fine grid: divisions > 1 means minor grid on. */
const fineGrid = gridFromGeometry({
  showMinorGrid: true,
  showGrid: true,
  gridDivisions: 5,
  xTickSpacing: 1,
  yTickSpacing: 1,
  xMin: -5,
  xMax: 5,
  yMin: -5,
  yMax: 5,
});

check("fine: minor grid ON", fineGrid.showMinorGrid, true);
check("fine: minor divisions 5", fineGrid.minorDivisions, 5);

/* Derived interval when none stored. */
const derived = gridFromGeometry({
  showGrid: true,
  xMin: -10,
  xMax: 10,
  yMin: -5,
  yMax: 5,
});
check("derived X interval is a round step", derived.majorX, 2);
check("derived Y interval is a round step", derived.majorY, 1);

/* Already-migrated graph keeps its own grid. */
const migrated = gridFromGeometry({ grid: { majorX: 7, showMinorGrid: true } });
check("migrated: stored interval wins", migrated.majorX, 7);
check("migrated: stored minor wins", migrated.showMinorGrid, true);

/* Dual write, then re-read: round trip must be stable. */
const g = {};
applyGridToGeometry(g, {
  showMajorGrid: false,
  showXAxis: false,
  showYAxis: false,
  showTickLabels: false,
});
const back = gridFromGeometry(g);

check("round trip: grid stays off", back.showMajorGrid, false);
check("round trip: x axis stays off", back.showXAxis, false);
check("round trip: labels stay off", back.showTickLabels, false);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail) {
  process.exitCode = 1;
}
