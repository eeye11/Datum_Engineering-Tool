
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * A MAGNITUDE BOX IS A BOX, NOT A PART OF THE FORCE
 * ========================================================
 *
 * `F = 100 N` printed across an arrowhead is unreadable, so the box has to
 * be movable. But the box is DERIVED from the force - it is not a feature,
 * and storing its text would give two copies of one number free to
 * disagree.
 *
 * The division that works:
 *
 *   THE TEXT IS DERIVED.  Recomputed from the force every frame, so it
 *                         cannot go stale and cannot be dragged into
 *                         disagreeing with the force it belongs to.
 *   THE PLACE IS STORED.  An offset on the feature, which is the only part
 *                         the student chose and the only part the
 *                         application has no opinion about.
 *
 * So editing the force moves the NUMBER and editing the box moves the box,
 * and neither can affect the other.
 */


const projectRoot = path.join(__dirname, "..");
const dir = sourceDir();

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

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = (id) => clearTimeout(id);

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "analysis-dependencies.js",
  "renderer.js",
]) {
  loadModule(name);
}

for (const name of Object.keys(global.window)) {
  if (/^engg[A-Z]/.test(name) && global[name] === undefined) {
    global[name] = global.window[name];
  }
}

const model = global.window.enggAnnotationModel;
const renderer = global.window.enggDrawingRenderer;
const canvas = global.document.getElementById("canvas");

/*
 * `extra` goes into the GEOMETRY, which is where a magnitude lives. Setting
 * an id through it does nothing - the feature's id is at the top level - so
 * a second feature is built explicitly below.
 */
const force = (extra = {}, id = "force-1") => ({
  id,
  type: "force",
  name: "Point Force 1",
  geometry: {
    start: { x: 100, y: 100 },
    end: { x: 160, y: 100 },
    magnitude: 100,
    angle: 0,
    ...extra,
  },
  style: { stroke: "#000000", lineWidth: 1 },
});

const scene = (objects, display = {}) => ({
  objects,
  display: { showMagnitudes: true, showUnits: true, ...display },
  scale: { mmPerUnit: 1, unit: "mm" },
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: { phase: "idle", preview: null, previewObjects: [] },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
});

const derived = (object, display) =>
  model.derivedAnnotation(object, scene([object], display));

console.log("\n  the box has an identity of its own\n");

const plain = derived(force());

check("a force has a magnitude box", Boolean(plain));

check(
  "and it is not the force's own id",
  plain.id !== "force-1",
  `the box answers to ${plain.id}`,
);

check(
  "it names the feature it belongs to",
  plain.sourceFeatureId === "force-1",
);

check(
  "and it is stable across frames",
  derived(force()).id === plain.id,
  "the id changed between two identical draws, so it cannot be picked twice",
);

check(
  "two forces have two different boxes",
  derived(force({}, "force-2")).id !== plain.id,
  "both boxes answer to the same id, so a click could not tell them apart",
);

console.log("\n  and it is DRAWN with that identity\n");

renderer.renderDrawing(scene([force()]), canvas);

const group = canvas.querySelector(
  ".drawing-derived-magnitude",
);

check("the box is on the sheet", Boolean(group));

check(
  "carrying the id the pick will look for",
  group.getAttribute("data-feature-id") === plain.id,
  `drew ${group.getAttribute("data-feature-id")}, pick expects ${plain.id}`,
);

console.log("\n  MOVING IT MOVES THE BOX AND NOT THE FORCE\n");

const movable = force({
  magnitudeOffset: { x: 30, y: -20 },
});

const moved = derived(movable);

check(
  "the box is drawn where it was put",
  moved.placement.x ===
      plain.placement.x + 30 &&
    moved.placement.y ===
      plain.placement.y - 20,
  `placed at ${JSON.stringify(
    moved.placement,
  )}, unmoved at ${JSON.stringify(plain.placement)}`,
);

check(
  "and it is marked as moved, so the renderer and the pick agree",
  moved.moved === true,
);

check(
  "the force itself did not move",
  movable.geometry.start.x === 100,
  `the force's geometry is now at ${movable.geometry.start.x}`,
);

console.log("\n  BUT THE TEXT IS STILL DERIVED\n");

/*
 * THE DIVISION HOLDING. A moved box must still report what the force says,
 * because the offset is a place and not a value.
 */
check(
  "a moved box still states the force's magnitude",
  model.textFor(moved, scene([movable])).includes(
    "100",
  ),
  `a moved box reads ${model.textFor(moved, scene([movable]))}`,
);

const edited = force({
  magnitudeOffset: { x: 30, y: -20 },
});

edited.geometry.magnitude = 250;

const afterEdit = derived(edited);

check(
  "and editing the force updates a MOVED box",
  model.textFor(afterEdit, scene([edited])).includes(
    "250",
  ),
  `a moved box still reads ${model.textFor(
    afterEdit,
    scene([edited]),
  )} after the force became 250`,
);

check(
  "without the box going back to where it was",
  afterEdit.placement.x ===
    moved.placement.x &&
    afterEdit.placement.y === moved.placement.y,
  "the box jumped when the magnitude changed",
);

console.log("\n  and an offset of nothing means 'where it falls'\n");

const home = derived(force({ magnitudeOffset: null }));

check(
  "null puts it back where it naturally falls",
  home.placement.x === plain.placement.x &&
    home.placement.y === plain.placement.y,
  `got ${JSON.stringify(home.placement)}`,
);

check(
  "and it is no longer marked as moved",
  home.moved !== true,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
