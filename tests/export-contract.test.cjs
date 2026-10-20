/* eslint-disable no-console */
/*
 * Verifies the export-scaling contract WITHOUT the renderer harness, so it is
 * independent of the canvas/overlay modules another agent is editing.
 */
const path = require("path");
const { loadModule } = require("./helpers/source-path.cjs");

const statics = loadModule("statics.js");
const geometry = loadModule("geometry.js");
const style = loadModule("tikz-style.js");
const transform = loadModule("export-transform.js");
const bounds = loadModule("model-bounds.js");
const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${n}${ok || !d ? "" : `\n       ${d}`}`);
};

const widthIn = (t) => [...String(t).matchAll(/line width=([\d.]+)pt/g)].map((m) => Number(m[1]));

const sheet = [
  { id: "beam", type: "beam", geometry: { start: { x: -215, y: 0 }, end: { x: 215, y: 0 } }, style: { lineWidth: "thin" } },
  { id: "sfd", type: "analysis-diagram", geometry: { start: { x: -215, y: -60 }, end: { x: 215, y: -60 }, localRange: { from: 0, to: 10 }, mode: "sketch", sketchElements: [] }, style: { lineWidth: "thin" } },
  { id: "pin", type: "pin-support", geometry: { position: { x: -215, y: 0 }, orientation: Math.PI / 2 }, style: { lineWidth: "thin" } },
];

/* --- presets --- */
/*
 * A PRESET IS A MODEL WIDTH, and a model width becomes a print pen through the
 * canvas calibration (`POINTS_PER_LINE_WIDTH`): the sheet paints 0.5 as 1.2 px,
 * so the source states 1.2 pt. These are the numbers the canvas draws, not
 * TikZ's own `thin`/`thick` (which are print sizes and were 2.4x finer).
 */
const PT_PER_WIDTH = style.POINTS_PER_LINE_WIDTH;

check("Thin is the model's 0.5 stroke", style.resolveLineWidth("thin") === 0.5);
check("Ultra Thin is 0.25", style.resolveLineWidth("ultra-thin") === 0.25);
check("Ultra Thick is 2", style.resolveLineWidth("ultra-thick") === 2);
check(
  "and a preset is written at width x 2.4 points",
  Math.abs(style.strokeWidthPt("thin") - 0.5 * PT_PER_WIDTH) < 1e-9,
  String(style.strokeWidthPt("thin")),
);

/* --- factor --- */
const fit = transform.createExportContext({ bounds: bounds.drawingBounds(sheet) });
check("a 430-unit sheet is reduced", fit.factor < 0.5 && fit.factor > 0.2, String(fit.factor));

const smallFit = transform.createExportContext({
  bounds: bounds.drawingBounds([{ id: "s", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 20 } }, style: {} }]),
});
check("a small sheet is not enlarged", smallFit.factor === 1);

/* --- widths --- */
const factor = 150 / 430;
const scaled = transform.createExportContext({ bounds: { minX: 0, minY: 0, maxX: 430, maxY: 10 }, inkAllowancePt: 0 });

const line = { id: "l", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, style: { lineWidth: "thin" } };

check("at scale 1 the width is the calibrated nominal", widthIn(geometry.geometrySourceWriter(line, { transform: smallFit }))[0] === 1.2);
check(
  "Thin at 0.3488 is ~0.4186pt (1.2 x factor)",
  Math.abs(widthIn(geometry.geometrySourceWriter(line, { transform: scaled }))[0] - 0.5 * PT_PER_WIDTH * factor) < 1e-3,
  String(widthIn(geometry.geometrySourceWriter(line, { transform: scaled }))[0]),
);

/* --- coordinates --- */
const at = fit.point(-215, 0);
check("coordinates are shifted to a local origin", at.x >= 0 && at.y >= 0, JSON.stringify(at));
check("and reduced into the page", fit.point(215, 0).x <= 150.5, JSON.stringify(fit.point(215, 0)));

/* --- zoom independence --- */
const a = statics.serializeStaticsObject(sheet[0], { transform: fit, state: { camera: { zoom: 0.25 } } });
const b = statics.serializeStaticsObject(sheet[0], { transform: fit, state: { camera: { zoom: 4, panX: 99, panY: 99 } } });
check("zoom and pan cannot change the source", a === b);

/* --- idempotence --- */
check("generating twice is identical", a === statics.serializeStaticsObject(sheet[0], { transform: fit }));

/* --- dashes & arrows --- */
const dashed = geometry.geometrySourceWriter({ ...line, style: { lineWidth: "thin", lineType: "dashed" } }, { transform: scaled });
check("dashes scale", /dash pattern=on [\d.]+pt off [\d.]+pt/.test(dashed), dashed);

const arrowed = geometry.geometrySourceWriter({ ...line, style: { lineWidth: "thin", arrowEnd: "filled" } }, { transform: scaled });
check("arrow heads get an explicit scaled size", arrowed.includes("[length=") && arrowed.includes("width="), arrowed);

/* --- pipeline --- */
const manager = managerModule.createSourceManager();
sync.setSourceWriter(geometry.geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);
sheet.forEach((o) => sync.writeObjectIntoSource(manager, o, { allObjects: sheet }));

const source = manager.getSource();
check("every object reaches the source", sheet.every((o) => source.includes(`id="${o.id}"`)));
check("the coordinates are normalised", !source.includes("(-215,"), "");
check("and no command carries two widths", source.split("\n").filter((l) => /^\\(draw|fill)/.test(l.trim())).every((l) => (l.match(/line width=/g) || []).length <= 1));

/* --- model integrity --- */
const before = JSON.stringify(sheet);
sheet.forEach((o) => statics.serializeStaticsObject(o, { transform: scaled }));
check("the model is never mutated", JSON.stringify(sheet) === before);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
