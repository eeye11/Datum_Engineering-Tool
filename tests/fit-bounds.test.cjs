/*
 * ========================================================
 * FIT COVERS EVERY FEATURE TYPE
 * ========================================================
 *
 * Fit answers one question: how big is the DRAWING? The answer must include
 * everything that is drawn, and two kinds of feature used to give a wrong one.
 *
 * A POINT AND A PARTICLE were measured from their single defining position, so
 * their bounds were a ZERO-SIZE box. A zero-size drawing makes Fit zoom in to
 * the maximum looking for an extent that is not there - and a point is not
 * nothing: it is a marker with a visible radius, and that radius is what the
 * drawing occupies.
 *
 * AN ANALYSIS DIAGRAM was measured from its axis span, which has NO HEIGHT. The
 * frame the student sketches in extends well above and below that axis, so the
 * frame hung outside the fitted view - the fit cropped the very area the diagram
 * exists to provide.
 *
 * Both are fixed by measuring what is DRAWN, and the frame's dimensions live in
 * a leaf module so the renderer and the fit cannot disagree about them.
 */

const fs = require("fs");
const path = require("path");

const { modulePath, rendererSource } = require("./helpers/source-path.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const viewport = fs.readFileSync(modulePath("viewport.js"), "utf8");
const frame = fs.readFileSync(modulePath("analysis-frame.js"), "utf8");
const renderer = rendererSource();

console.log("\n  a point and a particle have a real size\n");

check(
  "the point branch measures a RADIUS, not a position",
  /object\.type === "point"[\s\S]{0,4000}position\.x - radius, y: position\.y - radius/.test(
    viewport,
  ),
  "one defining point is a zero-size box",
);

check(
  "the marker's drawn radius is what is used",
  /object\.style\?\.pointSize[\s\S]{0,200}: 4\)/.test(viewport),
  "the bounds must match the marker the renderer draws",
);

check(
  "the particle branch does the same",
  /object\.type === "particle"[\s\S]{0,900}position\.x - radius, y: position\.y - radius/.test(
    viewport,
  ),
);

check(
  "a screen-pixel radius is converted to world units",
  /Math\.max\(scale, 1e-6\)/.test(viewport),
  "the marker is drawn at a fixed screen size, so the fit must divide by scale",
);

console.log("\n  an analysis diagram is measured by its frame\n");

check(
  "the diagram branch adds the frame's corners",
  /object\.type === "analysis-diagram"[\s\S]{0,5000}point\.y - top/.test(
    viewport,
  ),
  "the axis span alone has no height",
);

check(
  "and takes the frame's dimensions from the shared leaf",
  /analysisFrameExtents/.test(viewport) &&
    /analysis-frame\.js/.test(viewport),
);

console.log("\n  one definition of the frame, shared by drawing and fitting\n");

check(
  "the frame lives in a module with NO imports",
  !/^import /m.test(frame),
  "the fit cannot import the renderer - that would be a cycle",
);

check(
  "it states the ordinate height once, used for both halves",
  /ordinateHeightPx:\s*\d+/.test(frame) &&
    /top: -ANALYSIS_FRAME\.ordinateHeightPx/.test(frame) &&
    /bottom: ANALYSIS_FRAME\.ordinateHeightPx/.test(frame),
  "two separate values would drift, invisibly, until the halves were compared",
);

check(
  "the renderer draws from the same definition",
  /const ANALYSIS_FRAME = enggAnalysisFrame\.ANALYSIS_FRAME/.test(renderer),
  "a fitted diagram and a drawn diagram must agree about the frame",
);

console.log("\n  every feature type is considered\n");

check(
  "the fit filter is permissive, so no type is silently dropped",
  /export function isFittableObject[\s\S]{0,400}object\.hidden === true/.test(
    viewport,
  ),
  "an exclusion list would drop a feature type added later",
);

check(
  "a hidden feature is still excluded",
  /if \(object\.hidden === true\) \{\s*\n\s*return false;/.test(viewport),
  "hidden means hidden",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void path;
