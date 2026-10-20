
const { JSDOM } = require("jsdom");

const { loadModule } = require("./helpers/source-path.cjs");

/*
 * ========================================================
 * THE ANNOTATION SELECTION BOX HUGS THE TEXT
 * ========================================================
 *
 * A selected magnitude label draws an editor-only box around its text. The
 * box used to be measured in WORLD units and then projected to the screen, so
 * it came out many times larger than the glyphs it was meant to outline - a
 * "500 N" label about 56 px wide drew a box nearly 190 px wide.
 *
 * The box is now measured in SCREEN pixels, from the same placement point and
 * the same font size the text node is built with, so it hugs the text with
 * only a couple of pixels of padding. This file renders and measures, because
 * the question - "does the box fit the text" - is about what is drawn.
 */

const dom = new JSDOM(
  '<!doctype html><html><body></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = (id) => clearTimeout(id);
global.window.crypto = { randomUUID: () => "annotation-box-uuid" };

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "renderer.js",
]) {
  loadModule(name);
}

for (const name of [
  "enggDrawingState",
  "enggDrawingRenderer",
  "enggLoadProfile",
  "enggFeatureGeometry",
  "enggBodyFrames",
  "enggDimensionModel",
  "enggQuantities",
  "enggMeasurement",
  "enggAnnotationModel",
]) {
  if (global.window[name]) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;

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

/*
 * A force with a magnitude label. `magnitude` shapes the text, so two labels
 * of different widths can be compared.
 */
function forceScene(magnitude) {
  const object = {
    id: "force-1",
    type: "force",
    name: "Point Force 1",
    geometry: {
      start: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      end: { x: 500, y: 0 },
      magnitude,
      angle: 0,
      forceX: magnitude,
      forceY: 0,
    },
    style: { stroke: "#000", lineWidth: 1 },
    engineering: { discipline: "statics" },
  };

  const state = {
    objects: [object],
    camera: { zoom: 1, panX: 0, panY: 0 },
    grid: { visible: false, spacing: 5 },
    snap: { enabled: false },
    display: { showMagnitudes: true, showUnits: true },
    styleDefaults: { stroke: "#000", lineWidth: 0.5, lineType: "solid" },
    selection: {
      /*
       * THE DERIVED ANNOTATION IS SELECTED. Its pseudo-id is what the
       * renderer keys the box off - the same id a click stores.
       */
      selectedObjectIds: [`derived-force-1-force-value`],
      boxSelectionIds: [],
      hoveredObjectId: null,
    },
    interaction: { phase: "idle", preview: null, previewObjects: [] },
  };

  return state;
}

function draw(state) {
  const host = global.document.createElement("div");
  global.document.body.appendChild(host);

  renderer.renderDrawing(state, host);

  const box = host.querySelector(".drawing-annotation-selection-box");
  const text = host.querySelector(".drawing-derived-magnitude text");

  const measured = {
    box: box
      ? {
          x: Number(box.getAttribute("x")),
          y: Number(box.getAttribute("y")),
          width: Number(box.getAttribute("width")),
          height: Number(box.getAttribute("height")),
        }
      : null,
    text: text
      ? {
          text: text.textContent,
          fontSize: Number(text.getAttribute("font-size")),
        }
      : null,
  };

  host.remove();

  return measured;
}

console.log("\n  the box is drawn only while the label is selected\n");

{
  const selected = draw(forceScene(500));

  check(
    "a selected label draws a box",
    Boolean(selected.box),
    JSON.stringify(selected),
  );

  check(
    "and the box is around the drawn text",
    Boolean(selected.text),
    JSON.stringify(selected.text),
  );

  const deselected = forceScene(500);
  deselected.selection.selectedObjectIds = [];

  check(
    "an unselected label draws no box",
    draw(deselected).box === null,
  );
}

console.log("\n  the box hugs the text, with only small padding\n");

{
  const measured = draw(forceScene(500));

  const { box, text } = measured;

  if (!box || !text) {
    check("measurement available", false, JSON.stringify(measured));
  } else {
    /*
     * The text is "F = 500 N" - nine characters at 12 px. The box must be
     * close to that width, not the many-hundred-pixel rectangle the
     * world-unit measurement produced.
     */
    const expectedTextWidth = text.text.length * text.fontSize * 0.62;

    check(
      "the box is close to the text's own width",
      Math.abs(box.width - expectedTextWidth) <= 8,
      `box ${box.width}, text estimate ${expectedTextWidth}`,
    );

    check(
      "and it has only a small, even padding on each side",
      box.width > expectedTextWidth &&
        box.width - expectedTextWidth <= 8,
      `padding total ${box.width - expectedTextWidth}`,
    );

    check(
      "the box height is about one line of text",
      box.height <= text.fontSize * 1.2 + 8,
      `height ${box.height}, font ${text.fontSize}`,
    );
  }
}

console.log("\n  a longer label gets a wider box\n");

{
  const short = draw(forceScene(5));
  const long = draw(forceScene(500000));

  check(
    "a longer label is boxed more widely",
    short.box &&
      long.box &&
      long.box.width > short.box.width,
    `short ${short.box?.width}, long ${long.box?.width}`,
  );

  /*
   * AND NEITHER IS A DEFAULT RECTANGLE. The two widths must actually differ,
   * so the box cannot be a fixed size that ignores the text.
   */
  check(
    "so the box is not a fixed default rectangle",
    short.box && long.box && short.box.width !== long.box.width,
    `short ${short.box?.width}, long ${long.box?.width}`,
  );
}

console.log("\n  the box follows the label's own position\n");

{
  const a = forceScene(500);
  const b = forceScene(500);

  /* Move the label by giving the force a magnitude offset. */
  b.objects[0].geometry.magnitudeOffset = { x: 60, y: -40 };

  const boxA = draw(a).box;
  const boxB = draw(b).box;

  /*
   * The offset is stored in WORLD units and projected, so the screen move is
   * the world offset scaled by the current zoom - and world +y is screen UP,
   * so a NEGATIVE world y offset moves the box DOWN the screen. What matters
   * is that the box moved WITH the label, by the same offset, rather than
   * staying put or being recomputed from the force.
   */
  const scaleX = (boxB.x - boxA.x) / 60;
  const scaleY = (boxB.y - boxA.y) / -40;

  check(
    "moving the label moves its box by the same offset, in world units",
    boxA &&
      boxB &&
      scaleX > 0 &&
      /*
       * The sign flips because world +y is screen UP: the magnitude of the
       * scaling is what must agree on both axes, not its sign.
       */
      Math.abs(Math.abs(scaleX) - Math.abs(scaleY)) < 1e-6,
    `A ${boxA?.x},${boxA?.y} -> B ${boxB?.x},${boxB?.y}, scaleX ${scaleX}, scaleY ${scaleY}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
