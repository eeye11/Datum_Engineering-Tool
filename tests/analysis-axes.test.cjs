
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES THE ANALYSIS GRAPH HAVE A COORDINATE SYSTEM?
 * ========================================================
 *
 * A Plot or Sketch frame is meant to read as a set of axes a student plots
 * against, not as a picture of a diagram. The y-axis in particular has to
 * span the WHOLE graph - top to bottom, empty or full - because it is the
 * thing a value is read against.
 *
 * Two versions of this got it wrong, and they are different mistakes:
 *
 *   1. The frame was 92px above the axis and 46px below. That is not a
 *      neutral layout, it is a claim that twice as much ordinate is
 *      available above as below - and for a shear force or bending moment
 *      diagram that is exactly backwards, because those are the quantities
 *      that change sign. The smaller half is the one holding the answers.
 *
 *   2. The y-axis was measured from the CONTENT in one version, so a
 *      student checking the size of a jump was reading it against an axis
 *      the jump had itself resized.
 *
 * The axis must therefore come from the GRAPH FRAME, and be the same
 * length whatever has been drawn in it. That is checked here by rendering
 * the same feature with and without a curve and comparing the axis.
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
  width: 1000,
  height: 600,
  left: 0,
  top: 0,
  right: 1000,
  bottom: 600,
});

const base = {
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
};

const DIAGRAM_TYPES = ["afd", "sfd", "bmd"];
const MODES = ["sketch", "plot"];

/* A 5 m body, drawn at the top-left of the sheet. */
function diagram(diagramType, mode, expressions) {
  return {
    id: `${diagramType}-${mode}`,
    type: "analysis-diagram",
    name: `${diagramType.toUpperCase()} ${mode}`,
    geometry: {
      diagramType,
      mode,
      start: { x: 0, y: -260 },
      end: { x: 500, y: -260 },
      localRange: { from: 0, to: 5 },
      showZeroAxis: true,
      backgroundVisible: true,
      sketchContent: mode === "sketch" ? true : undefined,
      expressions,
    },
    style: { stroke: "#000000", lineWidth: 0.5 },
    engineering: {
      plane: "XY",
      discipline: "statics",
      analysisKind: "analysis-diagram",
      sourceFeatureIds: ["beam-1"],
    },
  };
}

/*
 * A PLOT FULL OF EXPRESSIONS - two functions either side of a jump and the
 * vertical line at the jump itself.
 *
 * A small one, deliberately: the check that matters is that a graph with
 * little in it still has a full-height axis.
 */
const FILLED = [
  {
    id: "e1",
    relationType: "functionX",
    visible: true,
    expression: "10",
    xRange: { start: 0, end: 2.5 },
  },
  {
    id: "e2",
    relationType: "verticalLine",
    visible: true,
    x: 2.5,
    yRange: { start: -10, end: 10 },
  },
  {
    id: "e3",
    relationType: "functionX",
    visible: true,
    expression: "-10",
    xRange: { start: 2.5, end: 5 },
  },
];

/*
 * THE Y-AXIS, MEASURED OFF THE CANVAS.
 *
 * The axis is drawn as a PATH, not a line - `M x y L x y` - so a search
 * for `line` elements finds only the reference ticks, which are 10px long
 * and are not the axis. Reading the path's endpoints measures the axis;
 * reading the ticks measures nothing and reports "no axis" for a graph that
 * has one.
 *
 * A two-point vertical path is the axis and nothing else: the arrowhead is
 * three points, and a plotted curve is many.
 */
function verticalAxis(feature) {
  renderer.renderDrawing(
    { ...base, objects: [feature] },
    canvas,
  );

  const group = canvas.querySelector(
    '.drawing-feature[data-feature-id="' + feature.id + '"]',
  );

  if (!group) {
    return null;
  }

  const candidates = [...group.querySelectorAll("path")]
    .map(path => {
      const numbers = (
        path.getAttribute("d") || ""
      ).match(/-?\d+(?:\.\d+)?/g);

      if (!numbers || numbers.length < 4) {
        return null;
      }

      /*
       * Every successive PAIR is a point. The loop condition has to be
       * `i + 1 < length`, not `i + 3 < length`: the latter requires a
       * THIRD point to exist before accepting the second, so a two-point
       * line - which is what the axis is - yields a single point and every
       * candidate is thrown away.
       */
      const points = [];

      for (let i = 0; i + 1 < numbers.length; i += 2) {
        points.push({
          x: Number(numbers[i]),
          y: Number(numbers[i + 1]),
        });
      }

      return points;
    })
    .filter(Boolean)
    .filter(points => points.length === 2)
    .filter(points => points[0].x === points[1].x)
    .map(points => {
      const ys = points.map(p => p.y);

      return {
        x: points[0].x,
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
    });

  /* The axis is the tallest such line. */
  return candidates.sort(
    (a, b) => b.bottom - b.top - (a.bottom - a.top),
  )[0];
}

console.log("\n  the y-axis spans the graph, empty or full\n");

const axes = {};

DIAGRAM_TYPES.forEach(diagramType => {
  MODES.forEach(mode => {
    const label = `${diagramType.toUpperCase()} ${mode}`;

    const empty = verticalAxis(diagram(diagramType, mode));
    const full = verticalAxis(
      diagram(diagramType, mode, mode === "plot" ? FILLED : undefined),
    );

    axes[`${diagramType}-${mode}`] = empty;

    check(
      `${label} draws a y-axis`,
      Boolean(empty),
      "no vertical path was found in the diagram group",
    );

    check(
      `${label}: the axis is the same with content in it`,
      empty &&
        full &&
        Math.abs(empty.top - full.top) < 0.01 &&
        Math.abs(empty.bottom - full.bottom) < 0.01,
      `empty ${empty?.top}..${empty?.bottom}, full ${full?.top}..${full?.bottom}`,
    );
  });
});

console.log("\n  and it is symmetric about the zero line\n");

const extents = renderer.analysisFrameExtents();

check(
  "the frame declares one ordinate height, used both ways",
  Math.abs(extents.top) === extents.bottom,
  `top ${extents.top}, bottom ${extents.bottom}`,
);

check(
  "the frame's top and bottom are equal and opposite",
  extents.top === -extents.bottom,
);

/*
 * THE SYMMETRY IS THE POINT. 92 above and 46 below was not a layout, it was
 * a claim about the diagram - and for the quantities these graphs show the
 * claim was backwards, since they are the ones that change sign.
 */
const reference = axes["sfd-plot"];

check(
  "the axis has real height",
  reference && reference.bottom - reference.top > 100,
  `height was ${reference?.bottom - reference?.top}px`,
);

check(
  "the axis reaches both ends of the frame",
  reference &&
    Math.abs(
      reference.bottom -
        reference.top -
        (extents.bottom - extents.top),
    ) < 0.01,
  `axis ${reference?.bottom - reference?.top}px vs frame ${
    extents.bottom - extents.top
  }px`,
);

console.log("\n  and it is the same axis for all six diagrams\n");

const heights = Object.entries(axes).map(
  ([name, axis]) => [name, axis && axis.bottom - axis.top],
);

check(
  "all six graphs have an identically sized ordinate",
  new Set(heights.map(([, h]) => h)).size === 1,
  `heights: ${JSON.stringify(heights)}`,
);

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}
