
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * SHOW MAGNITUDES, FROM A REAL FEATURE
 * ========================================================
 *
 * display-rendering.test.cjs injects a hand-built annotation into the
 * document, so it proves the renderer draws an annotation that EXISTS.
 *
 * It cannot prove the annotation gets created, which is the half the
 * student reports as missing. Nothing in the application ever built a
 * generated annotation - `annotationKind: "force-value"` appeared in
 * tests and nowhere else - so enabling Show Magnitudes revealed nothing.
 *
 * These check the real path: a real force, the real renderer, no
 * annotation supplied.
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

/*
 * The modules attach to `window`; the renderer also reads some of them as
 * bare globals. Bridging every one that was attached is deliberate rather
 * than listing them: adding a module later should not mean this test
 * starts throwing on a name nobody remembered to add here.
 */
for (const name of Object.keys(global.window)) {
  if (/^engg[A-Z]/.test(name) && global[name] === undefined) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;

/* A force as drawing.js actually stores one: magnitude INSIDE geometry. */
const force = {
  id: "force-1",
  type: "force",
  name: "Point Force 1",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 60, y: 0 },
    magnitude: 100,
    angle: 0,
  },
  style: { stroke: "#000000", lineWidth: 1 },
};

const beam = {
  id: "beam-1",
  type: "beam",
  name: "Beam 1",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 },
    length: 200,
    depth: 20,
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
};

const scene = (objects, display) => ({
  objects,
  display,
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

const drawnMagnitudes = (objects, display) => {
  const canvas = global.document.getElementById("canvas");

  renderer.renderDrawing(scene(objects, display), canvas);

  const group = canvas.querySelector(".drawing-derived-magnitude");

  return group
    ? [...group.querySelectorAll("text")].map(t => t.textContent).join(" ")
    : "";
};

console.log("\n  the value is derived, not stored\n");

const withOn = drawnMagnitudes([force], { showMagnitudes: true });

check(
  "a force states its magnitude with no annotation supplied",
  withOn.includes("100"),
  `drew ${JSON.stringify(withOn)}`,
);

check(
  "and the unit is part of it",
  withOn.includes("N"),
  `drew ${JSON.stringify(withOn)}`,
);

console.log("\n  the setting is what switches it\n");

const withOff = drawnMagnitudes([force], { showMagnitudes: false });

check(
  "with magnitudes off, nothing is derived",
  withOff === "",
  `drew ${JSON.stringify(withOff)}`,
);

console.log("\n  a feature with no magnitude contributes nothing\n");

const beamText = drawnMagnitudes([beam], { showMagnitudes: true });

check(
  "a beam is not given a magnitude",
  beamText === "",
  `drew ${JSON.stringify(beamText)}`,
);

console.log("\n  it cannot disagree with its source\n");

/*
 * The whole reason for deriving rather than storing: edit the force and
 * the label follows in the same pass, with no separate thing to update.
 */
const edited = {
  ...force,
  geometry: { ...force.geometry, magnitude: 250 },
};

const editedText = drawnMagnitudes([edited], { showMagnitudes: true });

check(
  "changing the force changes the value drawn",
  editedText.includes("250") && !editedText.includes("100"),
  `drew ${JSON.stringify(editedText)}`,
);

console.log("\n  and it is not a second selectable object\n");

check(
  "the derived value is not stored on the feature",
  !force.annotations,
  "a stored copy would be a number free to go stale",
);

console.log("\n  every Statics feature that HAS a magnitude\n");

/*
 * The gap was not one feature. Statics features each take an EARLY RETURN
 * once their own symbol is drawn - in five separate places - so a hook at
 * the end of the pass reached none of them.
 *
 * EVERY FIXTURE HERE IS BUILT BY THE REAL FACTORY, not written by hand.
 * Three hand-written ones in this file described features the application
 * cannot create: a components with no `position`, a varying load with a
 * single `intensity` instead of profile points, and an axis-aligned force
 * asserted to have a non-zero vertical component. Each read as a defect in
 * the model when the model was right and the description was wrong.
 */
const factories =
  global.window.enggDrawingState.geometryFactories;

const placed = [
  ["force", factories.force({ x: 0, y: 0 }, { x: 0, y: -30 }), "100"],
  [
    "moment",
    factories.moment({ x: 0, y: 0 }, 25, false),
    "25",
  ],
  [
    "load",
    factories.load({ x: 0, y: 0 }, { x: 100, y: 0 }, 5),
    "5",
  ],
];

for (const [type, object, expected] of placed) {
  if (type === "force") {
    object.geometry.magnitude = 100;
    object.geometry.angle = -90;
  }

  const text = drawnMagnitudes([object], { showMagnitudes: true });

  check(
    `a ${type} states its magnitude`,
    text.includes(expected),
    `drew ${JSON.stringify(text)}`,
  );
}

/*
 * A resultant is derived from source forces, so it is built by the analysis
 * registry rather than a factory - and it is the case where "derived, not
 * stored" matters most: the drawn value has to follow the force it came
 * from without anything being written back to the document.
 */
const source = factories.force({ x: 0, y: 0 }, { x: 40, y: 0 });
source.geometry.magnitude = 150;
source.geometry.angle = 0;

const resultant = {
  id: "resultant-1",
  type: "resultant",
  name: "Resultant 1",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 40, y: 0 },
    position: { x: 0, y: 0 },
    magnitude: 150,
    angle: 0,
  },
  engineering: {
    sourceFeatureIds: [source.id],
    analysisKind: "resultant",
  },
  style: { stroke: "#000000", lineWidth: 1 },
};

check(
  "a resultant states its magnitude",
  drawnMagnitudes([resultant], { showMagnitudes: true }).includes("150"),
  `drew ${JSON.stringify(drawnMagnitudes([resultant], { showMagnitudes: true }))}`,
);

/*
 * Components are built differently from every other feature here: they are
 * DERIVED from a parent force, so they carry the three spans they are drawn
 * from AND the engineering components themselves. A fixture that gives them
 * only a top-level start/end/magnitude describes something the application
 * never creates - and would report a working feature as broken.
 */
const components = {
  id: "components-force-1",
  type: "force-components",
  name: "Force Components 1",
  geometry: {
    /*
     * A 30-degree force, so BOTH components are non-zero.
     *
     * At 0 degrees Fy is genuinely 0.00 N - an axis-aligned force has no
     * vertical part - so a fixture there would assert against a correct
     * answer and look like a defect in the model.
     */
    start: { x: 0, y: 0 },
    end: { x: 86.6, y: 50 },
    position: { x: 0, y: 0 },
    magnitude: 100,
    angle: 30,
    original: { start: { x: 0, y: 0 }, end: { x: 86.6, y: 50 } },
    horizontal: { start: { x: 0, y: 0 }, end: { x: 86.6, y: 0 } },
    vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 50 } },
    showOriginal: true,
    showX: true,
    showY: true,
  },
  engineering: {
    sourceFeatureIds: ["force-1"],
    analysisKind: "force-components",
    components: { x: 86.6, y: 50, original: { x: 100, y: 0 } },
  },
  style: { stroke: "#000000", lineWidth: 1 },
};

const componentText = drawnMagnitudes([components], {
  showMagnitudes: true,
});

check(
  "a force-components states BOTH components, derived from F and theta",
  componentText.includes("86.6") && componentText.includes("50"),
  `drew ${JSON.stringify(componentText)}`,
);

/*
 * A varying load, in the shape load-outline.test.cjs uses: end intensities
 * named as start/endIntensity, and the profile POINTS expressed in t (the
 * fraction along the span) rather than in world positions. The label reads
 * the points, so a fixture built the other way round would ask for a
 * magnitude that is not on the feature.
 */
const varying = {
  id: "vload-1",
  type: "varying-load",
  name: "Varying Load 1",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    direction: -90,
    intensity: 5,
    startIntensity: 5,
    endIntensity: 10,
    points: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 10 },
    ],
  },
  style: { stroke: "#000000", lineWidth: 1 },
};

const varyingText = drawnMagnitudes([varying], { showMagnitudes: true });

check(
  "a varying load states the intensity of its profile",
  varyingText.includes("5") || varyingText.includes("10"),
  `drew ${JSON.stringify(varyingText)}`,
);

console.log("\n  the value follows the feature, and only the feature\n");

/*
 * Each is drawn from the feature's own current geometry, so a change to
 * that geometry changes the drawing in the same pass - there is no stored
 * copy anywhere that could disagree.
 */
const liveCases = [
  ["a load", placed[2][1], "intensity", 5, 12],
  ["a moment", placed[1][1], "magnitude", 25, 60],
];

for (const [label, object, field, before, after] of liveCases) {
  object.geometry[field] = after;

  const text = drawnMagnitudes([object], { showMagnitudes: true });

  check(
    `${label} redraws when its ${field} is edited`,
    text.includes(String(after)) && !text.includes(String(before)),
    `drew ${JSON.stringify(text)}`,
  );
}

/*
 * Show Magnitudes is the ONLY thing that decides this. Units are always
 * present - there is no setting that removes them - so a value with no unit
 * would be a formatting fault, not a preference.
 */
const unitText = drawnMagnitudes([factories.load(
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  5,
)], { showMagnitudes: true });

check(
  "a magnitude always carries its unit",
  /\d[\d.]*\s*\S/.test(unitText),
  `drew ${JSON.stringify(unitText)}`,
);

console.log("\n  a feature with NO magnitude is left alone\n");

/*
 * A support or a connection has no force, no moment and no load, so there
 * is nothing to state. Drawing "0 N" beside one would be asserting a fact
 * about it that is not true.
 *
 * This is the case a naive implementation gets wrong in the opposite
 * direction: a component that defaults to printing 0 rather than to
 * printing nothing.
 */
/*
 * Factories are keyed by the TYPE STRING itself - `geometryFactories[
 * "pin-support"]` - and take (position, angle, style). The unquoted names
 * I first reached for do not exist.
 */
const plain = [
  "pin-support",
  "roller-support",
  "fixed-support",
  "smooth-support",
  "pin-connection",
  "fixed-connection",
  "slider-connection",
].map((type) => [
  type,
  factories[type]({ x: 0, y: 0 }, 0, {}),
]);

for (const [type, object] of plain) {
  const text = drawnMagnitudes([object], { showMagnitudes: true });

  check(
    `a ${type} states nothing`,
    text === "",
    `drew ${JSON.stringify(text)} - it has no magnitude to report`,
  );
}

console.log("\n  the component toggles do not change the VALUE\n");

/*
 * `showOriginal`, `showX` and `showY` control which VECTORS are drawn. The
 * label reports the engineering components either way, because the numbers
 * are properties of the decomposition, not of what was chosen to display.
 * If switching a vector off also removed its number, the decomposition
 * would stop being readable the moment the student tidied it up.
 */
const hidden = {
  ...components,
  geometry: {
    ...components.geometry,
    showX: false,
    showY: false,
    showOriginal: false,
  },
};

const hiddenText = drawnMagnitudes([hidden], { showMagnitudes: true });

check(
  "hiding the component vectors does not hide their values",
  hiddenText.includes("86.6") && hiddenText.includes("50"),
  `drew ${JSON.stringify(hiddenText)}`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
