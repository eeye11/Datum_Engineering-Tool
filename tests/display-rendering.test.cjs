
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES A DISPLAY SETTING CHANGE WHAT IS ON THE SHEET?
 * ========================================================
 *
 * The three settings are only real if turning one off removes something
 * from the drawing. A setting that is stored, reported by the toolbar and
 * ignored by the renderer is worse than no setting at all, because it looks
 * like it works.
 *
 * The distinction this file turns on is between two ways of "hiding" a
 * value:
 *
 *   - NOT DRAWING IT, which is what a display setting means;
 *   - DRAWING IT WITH NO TEXT, which leaves the leader line running to a
 *     blank spot where the value was.
 *
 * The second is the failure mode worth guarding: an annotation that
 * returns an empty string still contributes geometry, so the drawing keeps
 * a line pointing at nothing and the student reads it as something broken
 * rather than something they switched off.
 *
 * These are checked against the real renderer, because reading the model
 * cannot tell whether a leader line was left behind.
 */


const projectRoot = path.join(__dirname, "..");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = cb => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = id => clearTimeout(id);

for (const name of [
  "measurement-core.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "drawing-state.js",
  "renderer.js",
]) {
  loadModule(name);
}

for (const name of [
  "enggDrawingState",
  "enggDrawingRenderer",
  "enggDiagramEquations",
]) {
  if (global.window[name]) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;

const canvas = global.document.getElementById("canvas");

canvas.getBoundingClientRect = () => ({
  width: 900,
  height: 600,
  left: 0,
  top: 0,
  right: 900,
  bottom: 600,
});

const force = {
  id: "f1",
  type: "force",
  name: "Point Force 1",
  geometry: {
    start: { x: 0, y: 0 },
    angle: 30,
    magnitude: 100,
    unit: "N",
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
};

const beam = {
  id: "b1",
  type: "beam",
  name: "Beam 1",
  geometry: {
    start: { x: 0, y: -100 },
    end: { x: 200, y: -100 },
    length: 200,
    depth: 20,
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
};

/* A generated value, and a note the student wrote themselves. */
const generated = {
  id: "a-generated",
  type: "annotation",
  sourceFeatureId: "f1",
  annotationKind: "force-value",
  textMode: "generated",
  placement: { x: 40, y: 20 },
};

const handwritten = {
  id: "a-written",
  type: "annotation",
  sourceFeatureId: "f1",
  textMode: "manual",
  text: "this is the load case",
  placement: { x: 40, y: -30 },
};

const render = display => {
  renderer.renderDrawing(
    {
      objects: [beam, force, generated, handwritten],
      display,
      selection: {
        selectedObjectIds: [],
        boxSelectionIds: [],
        hoveredObjectId: null,
      },
      interaction: {
        phase: "idle",
        preview: null,
        previewObjects: [],
      },
      camera: { zoom: 1, panX: 0, panY: 0 },
      styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
      grid: { visible: false, spacing: 10 },
      snap: { enabled: false },
    },
    canvas,
  );

  const group = canvas.querySelector(
    '.drawing-feature[data-feature-id="a-generated"]',
  );

  const note = canvas.querySelector(
    '.drawing-feature[data-feature-id="a-written"]',
  );

  return {
    generatedDrawn: Boolean(group),
    generatedLines: group ? group.querySelectorAll("line").length : 0,
    noteDrawn: Boolean(note),
    noteText: note
      ? [...note.querySelectorAll("text")]
          .map(t => t.textContent)
          .join(" ")
      : "",
  };
};

console.log("\n  SHOW MAGNITUDES removes the value entirely\n");

const on = render({ showMagnitudes: true });

check(
  "with magnitudes on, the generated value is drawn",
  on.generatedDrawn,
);

const off = render({ showMagnitudes: false });

check(
  "with magnitudes off, it is not drawn at all",
  !off.generatedDrawn,
  "an annotation with no text would still draw its leader line",
);

check(
  "so no line is left behind pointing at nothing",
  off.generatedLines === 0,
  `left ${off.generatedLines} line(s)`,
);

console.log("\n  and the student's own notes are not its business\n");

check(
  "a handwritten note survives magnitudes being off",
  off.noteDrawn && off.noteText.includes("load case"),
  `note reads: ${JSON.stringify(off.noteText)}`,
);

console.log("\n  the unit is part of the value\n");

/*
 * A VISIBLE QUANTITY ALWAYS CARRIES ITS UNIT.
 *
 * This used to assert the opposite - that `showUnits: false` removed the "N"
 * from "100 N" - on the reasoning that a drawing carrying both a 250 mm
 * dimension and a 250 N force may want to read either. But a bare 100 beside
 * another 100 of a different physical quantity is ambiguous, and a number with
 * no unit is not a weaker presentation of the same fact: it is a different
 * claim. Units are what makes the two comparable at a glance, which is the
 * only reason they are printed.
 *
 * So the flag no longer decides anything, and a setting that asked for
 * magnitudes can no longer produce values that cannot be read.
 */
const withUnits = render({
  showMagnitudes: true,
  showUnits: true,
});

const withoutUnits = render({
  showMagnitudes: true,
  showUnits: false,
});

const unitsText = which => {
  renderer.renderDrawing(
    {
      objects: [beam, force, generated],
      display: {
        showMagnitudes: true,
        showUnits: which,
      },
      selection: {
        selectedObjectIds: [],
        boxSelectionIds: [],
        hoveredObjectId: null,
      },
      interaction: {
        phase: "idle",
        preview: null,
        previewObjects: [],
      },
      camera: { zoom: 1, panX: 0, panY: 0 },
      styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
      grid: { visible: false, spacing: 10 },
      snap: { enabled: false },
    },
    canvas,
  );

  const group = canvas.querySelector(
    '.drawing-feature[data-feature-id="a-generated"]',
  );

  return group
    ? [...group.querySelectorAll("text")]
        .map(t => t.textContent)
        .join(" ")
    : "";
};

check(
  "both are still drawn - the setting draws, it does not gate",
  withUnits.generatedDrawn && withoutUnits.generatedDrawn,
);

check(
  "the figure is on the sheet either way",
  unitsText(true).includes("100") && unitsText(false).includes("100"),
  `with units ${JSON.stringify(unitsText(true))}, without ${JSON.stringify(unitsText(false))}`,
);

check(
  "and the unit is in BOTH - a magnitude is not readable without one",
  unitsText(true).includes("N") && /\bN\b/.test(unitsText(false)),
  `without units: ${JSON.stringify(unitsText(false))}`,
);

check(
  "and neither is marked approximate",
  !unitsText(true).includes("~") && !unitsText(false).includes("~"),
  `read: ${JSON.stringify(unitsText(true))}`,
);

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}
