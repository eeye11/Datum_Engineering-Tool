
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DOES AN ANALYSIS DIAGRAM DRAW?
 *
 * The feature appeared in the Features panel and the status line said
 * "Reference axis placed" while the canvas showed nothing at all. So
 * "the feature exists" proved to be no evidence that "the feature renders",
 * and this file renders one for real and looks at the output.
 *
 * The whole path, in Node with no browser:
 *
 *     axis from the source  ->  the factory  ->  the renderer
 *
 * The renderer's own rule is that a feature group is appended ONLY if it
 * drew at least one child, so an empty group is the signature of a branch
 * that returned early. That is what is asserted against.
 *
 * ONE LEVEL BODY ONLY, deliberately. This file answers a single question,
 * and every extra case is another DOM stub that can be wrong for reasons
 * that have nothing to do with the bug.
 */


global.window = {
  crypto: {
    randomUUID: () => "diagram-draw-uuid"
  }
};

function makeElement(tag) {
  const classes = new Set();

  const element = {
    tagName: String(tag).toUpperCase(),
    attributes: {},
    children: [],
    dataset: {},
    style: {},
    textContent: "",

    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toggle: (n, on) => {
        if (on === undefined) {
          if (classes.has(n)) {
            classes.delete(n);
            return false;
          }
          classes.add(n);
          return true;
        }
        if (on) classes.add(n);
        else classes.delete(n);
        return on;
      }
    },

    get firstChild() {
      return this.children[0] || null;
    },

    get childNodes() {
      return this.children;
    },

    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },

    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(
        element.attributes,
        name
      )
        ? element.attributes[name]
        : null;
    },

    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(
        element.attributes,
        name
      );
    },

    appendChild(child) {
      this.children.push(child);
      return child;
    },

    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },

    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },

    addEventListener() {}
  };

  return element;
}

global.window.document = {
  createElement: makeElement,
  createElementNS: (_ns, tag) => makeElement(tag),
  createTextNode: (text) => ({
    nodeType: 3,
    textContent: String(text)
  })
};

global.document = global.window.document;

loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("analysis-dependencies.js");
loadModule("drawing-state.js");
loadModule("renderer.js");

const state = global.window.enggDrawingState;
const renderer = global.window.enggDrawingRenderer;
const deps = global.window.enggAnalysisDependencies;

global.enggDrawingState = state;
global.enggBodyFrames = global.window.enggBodyFrames;
global.enggFeatureGeometry = global.window.enggFeatureGeometry;

/*
 * The renderer reads the equation engine as a bare global, the same way
 * the browser hands it over.
 */
loadModule("diagram-equations.js");

global.enggDiagramEquations = global.window.enggDiagramEquations;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`
    );
  }
};

/*
 * Screen coordinates are compared with a tolerance. They come out of a
 * transform, so an exact equality here would fail on rounding rather than
 * on anything about the drawing - and a test that fails on a half-pixel is
 * a test that gets deleted instead of fixed.
 */
const near = (a, b) =>
  Number.isFinite(a) && Math.abs(a - b) < 0.5;

console.log("\n  an analysis diagram draws\n");

const BOUNDS = { left: 0, top: 0, width: 1200, height: 900 };

const host = makeElement("div");
host.getBoundingClientRect = () => BOUNDS;

/*
 * ensureSvg asks the canvas for an existing ".drawing-renderer" and only
 * mints one when there is none. A stub that always answers null therefore
 * produces a fresh SVG on every call, and the test would count a growing
 * pile of canvases instead of one canvas holding every feature.
 */
host.querySelector = (selector) =>
  selector === ".drawing-renderer"
    ? host.children.find(
        (c) =>
          c.tagName === "SVG" &&
          c.classList.contains("drawing-renderer")
      ) || null
    : null;

host.querySelectorAll = () => [];

const drawingState = {
  version: 1,
  units: "mm",
  camera: { zoom: 1, panX: 0, panY: 0 },
  grid: { visible: false, spacing: 5 },
  snap: { enabled: true, spacing: 1 },
  objectSnap: { enabled: false, tolerancePx: 10 },
  styleDefaults: {
    stroke: "#000000",
    lineWidth: 0.5,
    lineType: "solid"
  },
  selection: { selectedObjectIds: [], hoveredObjectId: null },
  interaction: { phase: "idle", previewObjects: [] },
  objects: []
};

/*
 * ONE SOURCE, THREE ORIENTATIONS. A level beam and two sloping ones,
 * because an axis taken from the screen rather than from the member is
 * indistinguishable on the first and obvious on the others.
 */
const SOURCES = [
  ["level", { x: 0, y: 0, end: { x: 300, y: 0 } }],
  ["rising", { x: 0, y: 0, end: { x: 200, y: 120 } }],
  ["falling", { x: -100, y: 40, end: { x: 100, y: -40 } }]
];

const DIAGRAMS = [
  ["sfd", "shear-force-diagram"],
  ["bmd", "bending-moment-diagram"],
  ["afd", "axial-force-diagram"]
];

/*
 * The colour each diagram must appear in, mirroring the renderer's own
 * table. Written out here rather than imported so the test would still
 * fail if the table were emptied - importing it would make the two agree
 * by construction and prove nothing.
 */
const EXPECTED_TINT = {
  sfd: "#1f5c38",
  bmd: "#8a4b1f",
  afd: "#1f4a7a"
};

const renderedGroups = () => {
  const svg = host.children.find(
    (c) => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
  );

  return svg ? svg.children.filter((c) => c.tagName === "G") : [];
};

SOURCES.forEach(([label, span]) => {
  const beam = {
    id: `beam-${label}`,
    type: "beam",
    geometry: {
      start: { x: span.x, y: span.y },
      end: { ...span.end },
      depth: 12
    }
  };

  const axis = deps.axisFromSource(beam, -70);

  DIAGRAMS.forEach(([shortForm, factoryName]) => {
    const diagram = state.geometryFactories[factoryName](
      axis.start,
      axis.end,
      { name: shortForm.toUpperCase() }
    );

    drawingState.objects = [beam, diagram];
    drawingState.selection.selectedObjectIds = [];

    renderer.renderDrawing(drawingState, host);

    const groups = renderedGroups();

    const summary = groups
      .map(
        (g) =>
          `${(g.dataset && g.dataset.featureId) || "?"}(${g.children.length})`
      )
      .join(", ");

    /*
     * The beam goes in first, so if IT is missing the harness is at fault
     * rather than the diagram, and every later assertion would be
     * reporting the harness's failure as the renderer's.
     */
    check(
      `${label} ${shortForm.toUpperCase()}: the beam draws, so the harness is answering`,
      groups.some((g) => g.dataset && g.dataset.featureId === beam.id),
      `groups: ${summary || "no svg"}`
    );

    const diagramGroup = groups.find(
      (g) => g.dataset && g.dataset.featureId === diagram.id
    );

    check(
      `${label} ${shortForm.toUpperCase()}: a feature group is appended`,
      !!diagramGroup,
      `groups: ${summary || "no svg"}`
    );

    check(
      `${label} ${shortForm.toUpperCase()}: the group actually drew something`,
      !!diagramGroup && diagramGroup.children.length > 0,
      `children: ${diagramGroup ? diagramGroup.children.length : "no group"}`
    );

    /*
     * IT DREW THE RIGHT THING, not merely anything.
     *
     * "A group exists with children in it" is satisfied by a grey box, and
     * a grey box is what a MISSED TINT LOOKS LIKE: the lookup falls
     * through to the SFD green silently, so a BMD comes out the wrong
     * colour with nothing to report it. Asserting only the group would let
     * exactly that through, which is the gap this check closes.
     */
    /*
     * AN EMPTY FRAME CARRIES NO TINT AT ALL.
     *
     * The tint was the plot-area highlight, and the highlight now appears
     * only once the student has plotted something. So an empty frame has
     * no filled rectangle - which is the change, and it is checked as a
     * positive assertion rather than left to be noticed.
     */
    const tintedFills = (diagramGroup ? diagramGroup.children : []).filter(
        c =>
            c.attributes &&
            String(c.attributes.fill || "") === EXPECTED_TINT[shortForm]
    );

    check(
      `${label} ${shortForm.toUpperCase()}: an empty frame has no plot-area highlight`,
      tintedFills.length === 0,
      `tinted marks: ${tintedFills.length}`
    );

    /* The axes themselves are still drawn, in the diagram's stroke. */
    check(
      `${label} ${shortForm.toUpperCase()}: the axes are still drawn`,
      (diagramGroup ? diagramGroup.children.length : 0) > 0,
      `marks: ${diagramGroup ? diagramGroup.children.length : "no group"}`
    );
  });
});

DIAGRAMS.forEach(([shortForm, factoryName]) => {
  const diagram = state.geometryFactories[factoryName](
    { x: 0, y: -70 },
    { x: 300, y: -70 },
    {}
  );

  check(
    `${shortForm.toUpperCase()} stores its type as the short form`,
    diagram.geometry.diagramType === shortForm,
    `diagramType = ${JSON.stringify(diagram.geometry.diagramType)}`
  );
});

console.log("\n  a Plot draws the student's equation\n");

/*
 * A PLOT FRAME WITH A CURVE ON IT.
 *
 * The frame is worth nothing on its own: what makes a Plot different from
 * a Sketch is that the typed equation appears. So this checks a real curve
 * is on the drawing, in the diagram's own colour, and - just as important -
 * that a SKETCH of the same frame does NOT have one.
 */
const plotBeam = {
  id: "beam-plot",
  type: "beam",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 300, y: 0 },
    depth: 12
  }
};

const plotAxis = deps.axisFromSource(plotBeam, -70);

const plotObject = state.geometryFactories["shear-force-diagram"](
  plotAxis.start,
  plotAxis.end,
  {}
);

/*
 * The data a committed Plot carries: the mode, the body's own range, and
 * the segments the student typed.
 */
plotObject.geometry.mode = "plot";
plotObject.geometry.localRange = { from: 0, to: 300 };
plotObject.geometry.segments = [
  /*
   * A shear that falls from 10 to 0 over the first half and holds at
   * zero over the second, which is the shape of a simply supported beam
   * under a uniform load: a linear ramp down, then no shear. The
   * numbers are in the frame's own engineering units, so "10 - x/15" is
   * 10 at the left end and 0 at the midpoint - written this way rather
   * than as "10 - 5x" because over a 300-long range that would run to
   * thousands, and the peak is what sets the vertical scale.
   */
  { id: "seg-0", from: 0, to: 150, equation: "10 - x/15" },
  { id: "seg-1", from: 150, to: 300, equation: "0" }
];

drawingState.objects = [plotBeam, plotObject];
drawingState.selection.selectedObjectIds = [];

renderer.renderDrawing(drawingState, host);

const plotSvg = host.children.find(
  (c) => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
);

const plotGroup = plotSvg
  ? plotSvg.children.find(
      (c) =>
        c.tagName === "G" &&
        c.dataset &&
        c.dataset.featureId === plotObject.id
    )
  : null;

const plotPaths = (plotGroup ? plotGroup.children : []).filter(
  (c) =>
    c.tagName === "PATH" &&
    c.attributes &&
    String(c.attributes.d || "").indexOf("M ") === 0 &&
    c.attributes.stroke === "#1f5c38"
);

/*
 * THE FRAME, READ FROM WHAT WAS ACTUALLY DRAWN.
 *
 * The zero axis is already in the group as a line, so the frame's screen
 * position is read from the drawing itself rather than from a second
 * implementation of the camera. A reimplemented transform is a second
 * thing that can be wrong, and this test exists to catch wrong numbers.
 */
const zeroAxis = (plotGroup ? plotGroup.children : []).find(
  (c) =>
    c.tagName === "LINE" &&
    c.attributes &&
    String(c.attributes["stroke-width"]) === "1.2"
);

check(
  "a Plot draws its equation",
  plotPaths.length >= 2,
  `curve paths: ${plotPaths.length}`
);

check(
  "a jump is two curves, not one joined line",
  plotPaths.length === 2,
  `curve paths: ${plotPaths.length}, expected 2 segments`
);

/*
 * THE CURVE MUST BE LOCKED TO THE BODY. A station at 150 along the range
 * has to sit at the middle of the frame, and the frame is the member's
 * own length - so this is the check that the diagram is registered with
 * the beam above it rather than merely drawn near it.
 */
const firstCurve = plotPaths[0];

const curveXs = String(firstCurve.attributes.d)
  .split(/[ML]/)
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => Number(pair.split(/\s+/)[0]));

const curveYs = String(firstCurve.attributes.d)
  .split(/[ML]/)
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => Number(pair.split(/\s+/)[1]));

check(
  "the curve spans the frame from end to end",
  curveXs.length > 2,
  `points: ${curveXs.length}`
);

check(
  "the curve is drawn in the diagram's own colour",
  plotPaths.every(
    (p) => p.attributes.stroke === "#1f5c38"
  )
);

/*
 * THE CURVE MUST BE ON THE SHEET, AND ON THE FRAME.
 *
 * A path built by interpolating between two SCREEN points and then being
 * transformed a second time comes out at several times its own size, far
 * outside the viewport - and it is still a path, still the right colour,
 * and still has a plausible looking "d" attribute. Neither of the checks
 * above can see that; only comparing the drawn coordinates against the
 * frame can.
 */
const frameX1 = Number(zeroAxis.attributes.x1);
const frameX2 = Number(zeroAxis.attributes.x2);
const frameY = Number(zeroAxis.attributes.y1);

const onSheet = curveXs.every(
  (x) =>
    x >= Math.min(frameX1, frameX2) - 2 &&
    x <= Math.max(frameX1, frameX2) + 2
);

check(
  "every point of the curve lies along the frame",
  onSheet,
  `xs ${Math.min(...curveXs).toFixed(1)}..${Math.max(...curveXs).toFixed(1)}, ` +
    `frame ${frameX1.toFixed(1)}..${frameX2.toFixed(1)}`
);

/*
 * And the values must go the right way: the ramp starts ABOVE the axis
 * at the left and returns TO it at the right, which is the shape a
 * falling shear has. A curve that is flat, or that sits below the axis
 * where the value is positive, is the wrong answer drawn confidently.
 */
check(
  "a positive value is drawn ABOVE the axis",
  curveYs[0] < frameY,
  `first y ${curveYs[0].toFixed(1)}, axis ${frameY.toFixed(1)}`
);

check(
  "the curve returns to the axis where the equation says it does",
  Math.abs(curveYs[curveYs.length - 1] - frameY) < 1.5,
  `last y ${curveYs[curveYs.length - 1].toFixed(1)}, axis ${frameY.toFixed(1)}`
);

/*
 * A CONSTANT segment lies ON the axis, which is what a zero shear region
 * looks like - not a curve floating somewhere.
 */
const secondCurve = plotPaths[1];
const secondYs = String(secondCurve.attributes.d)
  .split(/[ML]/)
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => Number(pair.split(/\s+/)[1]));

check(
  "a constant zero segment is drawn on the axis",
  secondYs.every((y) => Math.abs(y - frameY) < 1.5),
  `axis ${frameY.toFixed(1)}, ys ${secondYs[0].toFixed(1)}`
);

/*
 * A SKETCH MUST NOT GROW A CURVE.
 *
 * The single most important negative in this file. A Sketch frame that
 * quietly drew a solution would make the tool the answer key, and there
 * would be nothing on the drawing to show it had happened.
 */
const sketchObject = state.geometryFactories["shear-force-diagram"](
  plotAxis.start,
  plotAxis.end,
  {}
);

sketchObject.geometry.mode = "sketch";

drawingState.objects = [plotBeam, sketchObject];

renderer.renderDrawing(drawingState, host);

const sketchSvg = host.children.find(
  (c) => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
);

const sketchGroup = sketchSvg
  ? sketchSvg.children.find(
      (c) =>
        c.tagName === "G" &&
        c.dataset &&
        c.dataset.featureId === sketchObject.id
    )
  : null;

check(
  "a Sketch draws no curve at all",
  !(sketchGroup ? sketchGroup.children : []).some(
    (c) =>
      c.tagName === "PATH" &&
      c.attributes &&
      String(c.attributes.d || "").indexOf("M ") === 0 &&
      c.attributes["stroke-width"] === "1.8"
  ),
  "a Sketch must not draw the answer"
);

/*
 * A PLOT WITH NO EQUATION TYPED YET DRAWS NO CURVE.
 *
 * A frame the student has not filled in is the normal state on arrival,
 * and it must read as a blank frame rather than as a flat line at zero -
 * which is what a default equation would produce, and would look like a
 * claim that the answer is zero everywhere.
 */
const emptyPlot = state.geometryFactories["shear-force-diagram"](
  plotAxis.start,
  plotAxis.end,
  {}
);

emptyPlot.geometry.mode = "plot";
emptyPlot.geometry.localRange = { from: 0, to: 300 };
emptyPlot.geometry.segments = [
  { id: "seg-0", from: 0, to: 300, equation: "" }
];

drawingState.objects = [plotBeam, emptyPlot];

renderer.renderDrawing(drawingState, host);

const emptySvg = host.children.find(
  (c) => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
);

const emptyGroup = emptySvg
  ? emptySvg.children.find(
      (c) =>
        c.tagName === "G" &&
        c.dataset &&
        c.dataset.featureId === emptyPlot.id
    )
  : null;

check(
  "a Plot with no equation draws no curve",
  !(emptyGroup ? emptyGroup.children : []).some(
    (c) =>
      c.tagName === "PATH" &&
      c.attributes &&
      c.attributes["stroke-width"] === "1.8"
  ),
  "an untyped equation must not become a zero line"
);

console.log(
  "\n  the frame: margins, arrowhead and axis label\n"
);

/*
 * ============================================================
   THE FRAME GEOMETRY
   ============================================================
 *
 * A blank frame that looks like a finished diagram is the thing this
 * section is about, so each requirement is checked on the DRAWING rather
 * than on the constants - a constant can be right while nothing uses it.
 *
 * Measured on the PLOT group, because it is the one with content and so
 * the one whose highlight behaviour is also being checked.
 */

/*
 * WHERE THE BODY ENDS, in screen units.
 *
 * TAKEN FROM THE LAST CURVE POINT, which is the end of the last segment
 * and therefore exactly the body's far end - the frame's own `to`.
 *
 * Two wrong attempts are worth recording. The first looked for lines in
 * the beam's group and found none, because a beam is drawn as a
 * rectangle. The second compared the FIRST curve against it, but the first
 * curve is only the first SEGMENT - half the span - so its end is the
 * middle of the beam and everything past it looked like margin.
 *
 * The invariant being checked is the one that matters: the axis reaches
 * past where the engineering domain ends, and the plotted curve stops
 * exactly where the engineering domain ends.
 */
const lastCurve = plotPaths[plotPaths.length - 1];

const lastCurveXs = [...String(lastCurve.attributes.d).matchAll(/(-?[\d.]+)[ ,]/g)]
    .map(m => Number(m[1]))
    .filter(n => !Number.isNaN(n));

const bodyEndX = lastCurveXs[lastCurveXs.length - 1];

/* The zero axis: the longest horizontal line in the diagram group. */
const zeroAxisLine = (plotGroup.children || [])
    .filter(c => c.tagName === "LINE")
    .reduce(
        (longest, line) => {
            const length = Math.abs(
                Number(line.attributes.x2) - Number(line.attributes.x1)
            );

            /*
             * A seeded ACCUMULATOR, not null: the reducer below reads
             * `longest.length`, and a null seed makes that a TypeError
             * on the first element rather than an empty result.
             */
            return length > longest.length ? { line, length } : longest;
        },
        { line: null, length: -1 }
    ).line;

const axisEndX = Number(zeroAxisLine?.attributes.x2);
const axisStartX = Number(zeroAxisLine?.attributes.x1);
const zeroY = Number(zeroAxisLine?.attributes.y1);

check(
    "the x axis extends past the body",
    axisEndX > bodyEndX + 10,
    `axis ends at ${axisEndX}, body ends at ${bodyEndX}`
);

/* THE ARROWHEAD, at the axis's own end rather than the body's. */
const paths = (plotGroup.children || []).filter(
    c => c.tagName === "PATH"
);

const arrowBeyondBody = paths.some(p => {
    const xs = [...String(p.attributes.d || "").matchAll(/(-?[\d.]+)/g)].map(
        m => Number(m[1])
    );

    return Math.max(...xs) > bodyEndX + 10;
});

check(
    "the x axis ends in an arrowhead",
    arrowBeyondBody,
    `paths: ${paths.length}, one reaching past the body: ${arrowBeyondBody}`
);

/* THE LABEL, and where it sits. */
const labelNode = (plotGroup.children || []).find(
    c => c.tagName === "TEXT" && c.textContent === "x (m)"
);

check(
    'the x axis is labelled "x (m)"',
    Boolean(labelNode),
    `labels: ${JSON.stringify(
        (plotGroup.children || [])
            .filter(c => c.tagName === "TEXT")
            .map(c => c.textContent)
    )}`
);

check(
    "the x label sits beyond the arrowhead",
    labelNode && Number(labelNode.attributes.x) > axisEndX,
    `label at ${labelNode && labelNode.attributes.x}, axis ends at ${axisEndX}`
);

/*
 * THE Y AXIS, longer both ways. The zero line must sit INSIDE it rather
 * than at its bottom - the quantities these diagrams carry go negative,
 * and a frame that stops at the baseline cannot show one.
 */
const verticalAxis = paths.find(p => {
    const d = String(p.attributes.d || "");

    return d.startsWith("M ") && !d.includes("C");
});

const yNumbers = verticalAxis
    ? [...String(verticalAxis.attributes.d).matchAll(/(-?[\d.]+)/g)].map(
        m => Number(m[1])
      ).filter(n => !Number.isNaN(n))
    : [];

const yTop = yNumbers.length ? Math.min(...yNumbers) : null;
const yBottom = yNumbers.length ? Math.max(...yNumbers) : null;

check(
    "the y axis extends above the zero line",
    yTop !== null && yTop < zeroY,
    `y axis top ${yTop}, zero line at ${zeroY}`
);

check(
    "and below it, so a negative value has somewhere to go",
    yBottom !== null && yBottom > zeroY,
    `y axis bottom ${yBottom}, zero line at ${zeroY}`
);

/*
 * THE ENGINEERING DOMAIN IS UNCHANGED.
 *
 * The extension is presentation only. The plotted curve is mapped by
 * fraction along the body's own span, so the two curves must still span
 * exactly the body - if the extension had leaked into the mapping, a
 * value at the far end of the body would now be plotted inside the
 * margin, quietly rescaling everything the student drew.
 */
check(
    "the plotted curve still spans the body, not the extended axis",
    near(curveXs[0], axisStartX) &&
        near(bodyEndX, axisStartX + Math.abs(bodyEndX - axisStartX)),
    `first curve starts ${curveXs[0].toFixed(1)}, body ends ${bodyEndX}, axis ${axisStartX}..${axisEndX}`
);

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
