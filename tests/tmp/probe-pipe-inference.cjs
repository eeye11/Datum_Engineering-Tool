/* eslint-disable no-console */
/*
 * PROBE: does the pipe/duct tool's pointer path reach the shared H/V
 * inference? Run against the REAL snap engine, with exactly the options
 * pointer.js passes for a pipe-duct construction today.
 */
const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..", "..");

const { createHarness } = require("../harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, loadModule } = require("../helpers/source-path.cjs");

const snapModule = loadModule("object-snap.js");
const snap = snapModule.default || snapModule;

const { drawingState } = require(modulePath("editor-state.js"));

drawingState.objects = [];
drawingState.selection = { selectedObjectIds: [] };
drawingState.objectSnap = drawingState.objectSnap || {};
drawingState.objectSnap.enabled = true;

const boundary = {
  left: -10000,
  right: 10000,
  top: -10000,
  bottom: 10000,
  width: 900,
  height: 600,
};

const start = { x: 0, y: 0 };

/* EXACTLY what pointer.js passes for pipe-duct today: no lineStart. */
function resolveAsToday(rawCursor) {
  return snap.resolveConstructionPoint(
    { ...rawCursor },
    drawingState,
    boundary,
    {
      lineStart: null,
      inferenceReferences: [],
      tool: "pipe-duct",
    },
  );
}

/* EXACTLY what pointer.js would pass after the fix: the segment start. */
function resolveAsFixed(rawCursor) {
  return snap.resolveConstructionPoint(
    { ...rawCursor },
    drawingState,
    boundary,
    {
      lineStart: start,
      inferenceReferences: [start],
      tool: "pipe-duct",
    },
  );
}

console.log("\n  A. AS WIRED TODAY (no lineStart)\n");

const nearHorizontal = resolveAsToday({ x: 400, y: 4 });
console.log(
  "   near-horizontal ->",
  JSON.stringify(nearHorizontal.effectiveConstructionPoint),
  "inference:",
  nearHorizontal.inference && nearHorizontal.inference.type,
);

const nearVertical = resolveAsToday({ x: 4, y: 400 });
console.log(
  "   near-vertical   ->",
  JSON.stringify(nearVertical.effectiveConstructionPoint),
  "inference:",
  nearVertical.inference && nearVertical.inference.type,
);

console.log("\n  B. WITH THE SEGMENT START AS THE ANCHOR\n");

const fixedH = resolveAsFixed({ x: 400, y: 4 });
console.log(
  "   near-horizontal ->",
  JSON.stringify(fixedH.effectiveConstructionPoint),
  "inference:",
  fixedH.inference && fixedH.inference.type,
);

const fixedV = resolveAsFixed({ x: 4, y: 400 });
console.log(
  "   near-vertical   ->",
  JSON.stringify(fixedV.effectiveConstructionPoint),
  "inference:",
  fixedV.inference && fixedV.inference.type,
);

console.log("\n  C. WIRING IN pointer.js\n");
const fs = require("fs");
const pointerSource = fs.readFileSync(modulePath("pointer.js"), "utf8");
const isLineBlock = pointerSource.match(/const isLine =[\s\S]{0,700}?;/);
console.log(
  "   isLine block mentions pipe-duct:",
  /pipe-duct/.test(isLineBlock ? isLineBlock[0] : ""),
);
