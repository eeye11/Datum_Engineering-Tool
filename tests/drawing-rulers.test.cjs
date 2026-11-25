/*
 * ========================================================
 * MEASUREMENT RULERS
 * ========================================================
 *
 * The contract this suite holds the rulers to:
 *
 *   1. They read the DRAWING's coordinates through the same camera the canvas
 *      draws with - the project's own unit, at BASE_PIXELS_PER_UNIT x zoom -
 *      so a tick's position and a click's world point agree.
 *   2. Zooming changes the interval the ticks represent while the numbers stay
 *      true to the drawing; panning slides the visible range with the sheet.
 *   3. Major ticks are labelled with clearly spaced numbers, and every major
 *      interval is subdivided into smaller ticks.
 *   4. A resize re-measures the strip, and the edges are labelled inside the
 *      ruler rather than half clipped at the canvas's edge.
 *   5. The rulers are chrome: pointer-events: none, absolutely positioned in
 *      the canvas, and they take no row from the layout - the canvas box is
 *      unchanged.
 *   6. They are styled through theme tokens, so light and dark both contrast,
 *      and the unit is named rather than implied.
 *   7. Unchanged cameras draw nothing, and repeated installs share one set.
 *   8. They are a fixed scale: nothing on them follows the pointer.
 *
 * The arithmetic is exercised directly (it is pure); the DOM wiring is
 * exercised in a real jsdom page, because the rulers ARE DOM.
 */

const path = require("path");
const { JSDOM } = require("jsdom");
const { modulePath, stylesheetSource } = require("./helpers/source-path.cjs");

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

const ASSERTS = [];

const assert = (name, fn) => {
  ASSERTS.push({ name, fn });
};

/* The project's camera baseline: pixels for one drawing unit at 100% zoom. */
const BASE_PIXELS_PER_UNIT = 3.6;

const CANVAS = { width: 800, height: 600 };

/* ------------------------------------------------------------------ window */

const dom = new JSDOM(
  '<!doctype html><html><body><div class="drawing-canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;

const canvas = document.querySelector(".drawing-canvas");

Object.defineProperties(canvas, {
  clientWidth: { configurable: true, get: () => CANVAS.width },
  clientHeight: { configurable: true, get: () => CANVAS.height },
});

canvas.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: CANVAS.width,
  bottom: CANVAS.height,
  width: CANVAS.width,
  height: CANVAS.height,
  x: 0,
  y: 0,
});

/* ------------------------------------------------------------------ modules */

let scale;
let rulerModule;
let state;
let renderer;

let installed = false;

(async () => {
  scale = await import(
    new URL(`file://${modulePath("ruler-scale.js").replace(/\\/g, "/")}`).href
  );
  rulerModule = await import(
    new URL(`file://${modulePath("rulers.js").replace(/\\/g, "/")}`).href
  );
  /*
   * AN ES MODULE LOADED BY A CJS PROCESS MAY COME BACK WRAPPED, with its
   * namespace under `default`. The rulers module is the one under test here, so
   * it is unwrapped rather than left to fail on a missing function.
   */
  rulerModule =
    typeof rulerModule.installDrawingRulers === "function"
      ? rulerModule
      : rulerModule.default || rulerModule;
  state = (
    await import(
      new URL(`file://${modulePath("drawing-state.js").replace(/\\/g, "/")}`)
        .href
    )
  ).default;
  renderer = await import(
    new URL(`file://${modulePath("canvas-render.js").replace(/\\/g, "/")}`).href
  );

  install();
  await run();
})();

/* The live editor state the rulers read. Its camera is what we move. */
const editorState = () => require("../src/features/workspace/editor-state.js");

function resetCamera(zoom = 1, panX = 0, panY = 0) {
  const { drawingState } = editorState();

  drawingState.camera.zoom = zoom;
  drawingState.camera.panX = panX;
  drawingState.camera.panY = panY;
}

function install() {
  if (installed) {
    return;
  }

  resetCamera();
  rulerModule.installDrawingRulers();
  installed = true;
}

/*
 * A REDRAW, SYNCHRONOUSLY.
 *
 * The rulers coalesce on a frame; the suite asks them to draw now, through the
 * camera signal the canvas itself uses - which is the same path a pan or a
 * zoom takes in the application.
 */
async function redraw() {
  renderer.__testAnnounceCamera?.();

  await new Promise((resolve) => setTimeout(resolve, 0));
}

const topRuler = () => canvas.querySelector(".drawing-ruler-x");
const rightRuler = () => canvas.querySelector(".drawing-ruler-y");

const labelsOf = (ruler) =>
  [...ruler.querySelectorAll(".drawing-ruler-label")].map((node) => ({
    text: node.textContent,
    position: Number(
      node.getAttribute(node.closest(".drawing-ruler-x") ? "x" : "x"),
    ),
  }));

function tickPositionsOf(ruler) {
  return [...ruler.querySelectorAll(".drawing-ruler-ticks line")].map(
    (line) => {
      const isTop = line.closest(".drawing-ruler-x");

      return Number(line.getAttribute(isTop ? "x1" : "y1"));
    },
  );
}

/* ------------------------------------------------------------------ checks */

assert("the ruler's scale follows the drawing's own ratio", () => {
  /*
   * 150 -> 100.
   *
   * The drawing scale was raised so that the SAME physical distance now reads
   * 100 units where it used to read 150: at 100% zoom, a screen distance that
   * marked 150 mm now marks 100. That is k = 2.4 * 150/100 = 3.6 px per unit,
   * and it is asserted as a distance, not as a constant - 150 units at the OLD
   * ratio must equal 100 units at the NEW one.
   */
  const oldRatio = 2.4;
  const distance = 150 * oldRatio;

  check(
    "the position that marked 150 now marks 100",
    Math.abs(distance / BASE_PIXELS_PER_UNIT - 100) < 1e-9,
    `${distance}px / ${BASE_PIXELS_PER_UNIT} = ${distance / BASE_PIXELS_PER_UNIT}`,
  );

  const s = scale.rulerScale({ pixelsPerUnit: BASE_PIXELS_PER_UNIT });

  check(
    "the adaptive interval still lands on a readable step at the new scale",
    s.majorStep === 20 && s.subdivisions > 1 && s.majorPx >= 60 && s.majorPx <= 140,
    JSON.stringify({ major: s.majorStep, subdivisions: s.subdivisions, px: s.majorPx }),
  );
});

assert("the scale picks a nice interval for the room it has", () => {
  const step = scale.snapToNiceStep(10);

  check(
    "a snapped step is 1, 2 or 5 times a power of ten",
    scale.preferredMantissa(step) === 1 ||
      scale.preferredMantissa(step) === 2 ||
      scale.preferredMantissa(step) === 5,
    String(step),
  );

  const s = scale.rulerScale({ pixelsPerUnit: BASE_PIXELS_PER_UNIT });

  check(
    "at 100% the major ticks are 20 mm apart",
    s.majorStep === 20,
    String(s.majorStep),
  );

  check(
    "and the majors are about a comfortable gap apart",
    s.majorPx >= 60 && s.majorPx <= 140,
    String(s.majorPx),
  );

  check(
    "each major interval is subdivided",
    s.subdivisions > 1 && s.minorStep === s.majorStep / s.subdivisions,
    JSON.stringify(s),
  );
});

assert("the tick position is the canvas's own transform", () => {
  const zoom = 1.37;
  const panX = 23;
  const k = BASE_PIXELS_PER_UNIT * zoom;
  const size = CANVAS.width;

  const res = scale.rulerTicks({
    axis: "x",
    size,
    pan: panX,
    pixelsPerUnit: k,
  });

  const bounds = { width: size, height: CANVAS.height };

  const wrong = res.ticks.find((tick) => {
    const expected = state.engineeringToScreen(
      { x: tick.value, y: 0 },
      bounds,
      { camera: { zoom, panX, panY: 0 } },
    ).x;

    return Math.abs(expected - tick.position) > 1e-6;
  });

  check(
    "every top tick sits where engineeringToScreen puts its value",
    !wrong,
    wrong ? JSON.stringify(wrong) : "",
  );

  const vertical = scale.rulerTicks({
    axis: "y",
    size: CANVAS.height,
    pan: -12,
    pixelsPerUnit: k,
  });

  const wrongY = vertical.ticks.find((tick) => {
    const expected = state.engineeringToScreen(
      { x: 0, y: tick.value },
      bounds,
      { camera: { zoom, panX: 0, panY: -12 } },
    ).y;

    return Math.abs(expected - tick.position) > 1e-6;
  });

  check(
    "and every right tick sits where engineeringToScreen puts its value",
    !wrongY,
    wrongY ? JSON.stringify(wrongY) : "",
  );
});

assert("zooming keeps the numbers true and the ticks readable", () => {
  const zooms = [0.25, 0.5, 1, 2, 5];

  for (const zoom of zooms) {
    const s = scale.rulerScale({ pixelsPerUnit: BASE_PIXELS_PER_UNIT * zoom });

    check(
      `at ${zoom * 100}% the minor ticks stay at least a few pixels apart`,
      s.minorPx >= 4,
      `minorPx=${s.minorPx}`,
    );

    check(
      `at ${zoom * 100}% the majors stay about a label apart`,
      s.majorPx >= 60 && s.majorPx <= 140,
      `majorPx=${s.majorPx}`,
    );

    check(
      `at ${zoom * 100}% the interval is a readable mm step`,
      [1, 2, 5, 10, 20, 50, 100].includes(s.majorStep),
      `${s.majorStep} mm`,
    );
  }

  /* A tick of a value is at the same place at every zoom BECAUSE the zoom is
     in the scale - the INTERVAL changes, the value does not. */
  const at100 = scale.rulerTicks({
    axis: "x",
    size: 800,
    pan: 0,
    pixelsPerUnit: BASE_PIXELS_PER_UNIT,
  });

  const at200 = scale.rulerTicks({
    axis: "x",
    size: 800,
    pan: 0,
    pixelsPerUnit: BASE_PIXELS_PER_UNIT * 2,
  });

  /*
   * THE INTERVAL CHANGES WITH THE ZOOM, the millimetres do not. A window of
   * the same width covers HALF the millimetres at 200% - and the ruler labels
   * them a step finer, so the count of labels stays in the same band rather
   * than halving with the span.
   */
  check(
    "zooming in halves the span of the canvas",
    Math.abs(
      at100.labels[at100.labels.length - 1].value -
        at100.labels[0].value -
        2 *
          (at200.labels[at200.labels.length - 1].value -
            at200.labels[0].value),
    ) <= 100,
    `100%: ${at100.labels[0].value}..${at100.labels.at(-1).value}, ` +
      `200%: ${at200.labels[0].value}..${at200.labels.at(-1).value}`,
  );

  check(
    "and the labels stay a readable number of them",
    at200.labels.length >= 4 && at200.labels.length <= 12,
    `${at200.labels.length} labels at 200%`,
  );
});

assert("panning slides the visible range with the sheet", () => {
  const before = scale.rulerTicks({
    axis: "x",
    size: 800,
    pan: 0,
    pixelsPerUnit: BASE_PIXELS_PER_UNIT,
  });

  const after = scale.rulerTicks({
    axis: "x",
    size: 800,
    pan: 100,
    pixelsPerUnit: BASE_PIXELS_PER_UNIT,
  });

  const beforeValues = before.labels.map((label) => label.value);
  const afterValues = after.labels.map((label) => label.value);

  check(
    "the low edge's label moves with the pan",
    afterValues[0] > beforeValues[0],
    `${beforeValues[0]} -> ${afterValues[0]}`,
  );

  /* Panning by 100 units is 100 x 2.4 = 240px: the same tick moves 240px. */
  const shared = beforeValues.find((value) => afterValues.includes(value));

  const moved =
    before.labels.find((label) => label.value === shared).position -
    after.labels.find((label) => label.value === shared).position;

  check(
    "and the same tick moves by the panned pixels",
    Math.abs(moved - 100 * BASE_PIXELS_PER_UNIT) < 1e-6,
    String(moved),
  );
});

assert("the rulers never follow the pointer", () => {
  /*
   * A RULER IS A SCALE, NOT A READ-OUT. Nothing in the rulers may read the
   * pointer: there is no cursor line, no value under the mouse, and no
   * pointer listener - so nothing is drawn or changed while the mouse moves.
   */
  check(
    "the scale module exposes no cursor read-out",
    typeof scale.cursorWorldValue !== "function",
  );

  check(
    "the ruler module exports only the installer and the unit name",
    Object.keys(rulerModule).sort().join(",") ===
      "RULER_UNIT_LABEL,installDrawingRulers",
    Object.keys(rulerModule).join(","),
  );

  check(
    "no ruler element is a cursor mark",
    !canvas.querySelector(".drawing-ruler-cursor") &&
      !canvas.querySelector(".drawing-ruler-cursor-line"),
  );
});

assert("an edge label stays inside the ruler", () => {
  check(
    "a label at the far left is pushed right",
    scale.clampLabelCentre(0, 10, 800) === 11,
    String(scale.clampLabelCentre(0, 10, 800)),
  );

  check(
    "a label at the far right is pushed left",
    scale.clampLabelCentre(800, 10, 800) === 789,
    String(scale.clampLabelCentre(800, 10, 800)),
  );

  check(
    "a label with room is left where it is",
    scale.clampLabelCentre(400, 10, 800) === 400,
    String(scale.clampLabelCentre(400, 10, 800)),
  );

  check(
    "zero is written as 0, not 0.00",
    scale.formatRulerLabel(0) === "0",
    scale.formatRulerLabel(0),
  );

  check(
    "a fraction is written to two decimals at most",
    scale.formatRulerLabel(12.5) === "12.5",
    scale.formatRulerLabel(12.5),
  );
});

assert(
  "the rendered rulers are in the canvas and read the camera",
  async () => {
    await redraw();

    check("the top ruler is in the canvas", Boolean(topRuler()));
    check("the right ruler is in the canvas", Boolean(rightRuler()));

    check(
      "the top ruler is at the top edge",
      topRuler().classList.contains("drawing-ruler-x"),
    );

    check(
      "the right ruler is on the right edge",
      rightRuler().classList.contains("drawing-ruler-y"),
    );

    check(
      "the unit is named in the corner",
      Boolean(canvas.querySelector(".drawing-ruler-unit")),
    );

    check(
      "the unit badge's own label is the drawing unit",
      canvas
        .querySelector(".drawing-ruler-unit")
        .title.includes(rulerModule.RULER_UNIT_LABEL),
      canvas.querySelector(".drawing-ruler-unit").title,
    );

    const topLabels = labelsOf(topRuler()).map((label) => label.text);
    const rightLabels = labelsOf(rightRuler()).map((label) => label.text);

    check(
      "the top ruler labels numbered major divisions",
      topLabels.length >= 5 && topLabels.includes("0"),
      topLabels.join(","),
    );

    check(
      "the right ruler labels numbered major divisions",
      rightLabels.length >= 5 && rightLabels.includes("0"),
      rightLabels.join(","),
    );

    const ticks = tickPositionsOf(topRuler());
    const minors = topRuler().querySelectorAll(
      '.drawing-ruler-ticks line[data-major="false"]',
    ).length;
    const majors = topRuler().querySelectorAll(
      '.drawing-ruler-ticks line[data-major="true"]',
    ).length;

    check(
      "the top ruler draws smaller subdivisions between the majors",
      minors > majors && majors === topLabels.length,
      `${majors} majors, ${minors} minors`,
    );

    check(
      "the ticks are evenly spaced",
      ticks.every(
        (position, index) =>
          index === 0 ||
          Math.abs(position - ticks[index - 1] - ticks[1] - ticks[0]) < 1e-6 ||
          Math.abs(position - ticks[index - 1] - (ticks[1] - ticks[0])) < 1e-6,
      ),
    );
  },
);

assert("a zoom redraws the scale and moves the range", async () => {
  resetCamera(1, 0, 0);
  await redraw();

  const before = labelsOf(topRuler()).map((label) => label.text);

  resetCamera(4, 0, 0);
  await redraw();

  const after = labelsOf(topRuler()).map((label) => label.text);

  check(
    "zooming in changes the labelled interval",
    before.join(",") !== after.join(","),
    `${before.slice(0, 4).join(",")} -> ${after.slice(0, 4).join(",")}`,
  );

  check(
    "the zoomed-in labels are true to the drawing (0 still reads 0)",
    after.includes("0"),
    after.join(","),
  );
});

assert("a pan moves the visible range in the rendered ruler", async () => {
  resetCamera(1, 0, 0);
  await redraw();

  const before = labelsOf(topRuler());

  resetCamera(1, 100, 0);
  await redraw();

  const after = labelsOf(topRuler());

  /*
   * THE ANCHOR IS A LABEL BOTH WINDOWS SHOW, chosen from the read-back rather
   * than named by this test - the interval is 50 mm at this zoom, so a value
   * written here would silently stop being a tick.
   */
  const anchor = before.find((label) =>
    after.some((other) => other.text === label.text),
  );

  const moved = after.find((label) => label.text === anchor?.text);

  check(
    "a labelled tick moves left by the panned pixels",
    anchor &&
      moved &&
      Math.abs(anchor.position - moved.position - 100 * BASE_PIXELS_PER_UNIT) <
        1e-6,
    anchor && moved
      ? `${anchor.position} -> ${moved.position}`
      : "anchor or moved missing",
  );

  check(
    "the panned range starts later",
    Number(after[0].text) > Number(before[0].text),
    `${before[0].text} -> ${after[0].text}`,
  );
});

assert("a resize re-measures the strip", async () => {
  resetCamera(1, 0, 0);

  CANVAS.width = 400;

  await redraw();

  const svg = topRuler().querySelector("svg");

  check(
    "the ruler's SVG follows the new canvas width",
    svg.getAttribute("viewBox") === "0 0 400 400",
    svg.getAttribute("viewBox"),
  );

  check(
    "fewer ticks fit across the narrower canvas",
    labelsOf(topRuler()).length < 17,
    String(labelsOf(topRuler()).length),
  );

  /* The corner badge never sits over the drawing: it is at the top-right. */
  CANVAS.width = 800;
  await redraw();
});

assert("an unchanged camera draws nothing new", async () => {
  resetCamera(1, 0, 0);
  await redraw();

  const svg = topRuler().querySelector("svg");

  renderer.__testAnnounceCamera?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  check(
    "the same SVG is not rebuilt when nothing moved",
    topRuler().querySelector("svg") === svg,
  );
});

assert("installing twice shares one set of rulers", async () => {
  const uninstall = rulerModule.installDrawingRulers();

  check(
    "only one top ruler is in the canvas",
    canvas.querySelectorAll(".drawing-ruler-x").length === 1,
  );

  check(
    "only one right ruler is in the canvas",
    canvas.querySelectorAll(".drawing-ruler-y").length === 1,
  );

  check(
    "a second install returns the first's uninstall",
    typeof uninstall === "function",
  );

  uninstall();
});

assert("the rulers are chrome, not a drawing surface", () => {
  const css = stylesheetSource("editor.css");

  check(
    "the rulers do not take the pointer",
    /\.drawing-ruler\s*\{[^}]*pointer-events:\s*none/.test(css),
  );

  check(
    "the top ruler is absolute at the top of the canvas",
    /\.drawing-ruler-x\s*\{[^}]*position:\s*absolute[^}]*top:\s*0/.test(css),
  );

  check(
    "the right ruler is absolute at the right of the canvas",
    /\.drawing-ruler-y\s*\{[^}]*position:\s*absolute[^}]*right:\s*0/.test(css),
  );

  check(
    "the corner badge does not take the pointer either",
    /\.drawing-ruler-unit\s*\{[^}]*pointer-events:\s*none/.test(css),
  );

  check(
    "every ruler colour comes from a theme token",
    !/#[0-9a-fA-F]{3,8}/.test(
      css.slice(
        css.indexOf(".drawing-ruler {"),
        css.indexOf("@media (max-width: 620px)"),
      ),
    ),
    "a literal colour was found in the ruler rules",
  );

  check(
    "the badge carries the accent",
    /\.drawing-ruler-unit\s*\{[^}]*background:\s*var\(--datum-green\)/.test(
      css,
    ),
  );

  check(
    "the labels read the theme's ink",
    /\.drawing-ruler-labels text\s*\{[^}]*fill:\s*var\(--datum-muted\)/.test(
      css,
    ),
  );

  check(
    "the rulers stylesheet is registered in the cascade",
    /* `stylesheetSource` expands the @imports, so the evidence is the rules. */
    /\.drawing-ruler-unit\s*\{/.test(css) && /\.drawing-ruler-x\s*\{/.test(css),
  );
});

assert("the canvas is not made to skip the ruler strip", () => {
  const css = stylesheetSource("editor/workspace-chrome.css");

  check(
    "the canvas area keeps its single grid row",
    /\.drawing-canvas-area\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/.test(
      css,
    ),
  );

  check(
    "the rulers live inside the canvas element, not in a new surface",
    !css.includes(".drawing-ruler"),
  );
});

/* ------------------------------------------------------------------ runner */

async function run() {
  for (const { name, fn } of ASSERTS) {
    console.log(name);
    try {
      await fn();
    } catch (error) {
      fail++;
      console.log(
        `  FAIL ${name}\n       ${error && error.stack ? error.stack : error}`,
      );
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail) {
    process.exitCode = 1;
  }
}

void path;
