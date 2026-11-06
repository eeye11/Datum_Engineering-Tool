
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DO THE COMPONENT ARROWHEADS POINT ALONG THEIR COMPONENTS?
 *
 * The arithmetic is already proven correct - 50 checks over every
 * quadrant, every zero case, and the sum back to the original. So
 * `derived.x.x` is the right number, and the reported BACKWARD ARROWHEADS
 * can only be a drawing fault: the renderer is placing the head at the
 * wrong end of the segment, or deriving the head from a screen-space
 * segment that runs the other way.
 *
 * The difference matters and is worth stating. A component is a SIGNED
 * vector. +Fx and -Fx have identical lengths and opposite directions, so
 * any test that compares lengths, or that compares magnitudes, will find
 * them equal and pass. The only thing that tells them apart is WHERE THE
 * TIP IS.
 *
 * So the tip position is what is measured: the head of each component
 * arrow must sit at the far end of that component's own shaft, in the
 * direction of the component's own sign.
 */

global.window = {
  crypto: { randomUUID: () => "components-render-uuid" }
};

function makeElement(tag) {
  const classes = new Set();

  const el = {
    tagName: String(tag).toUpperCase(),
    attributes: {},
    children: [],
    dataset: {},
    style: {},
    textContent: "",

    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      contains: n => classes.has(n),
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

    get childNodes() {
      return this.children;
    },

    setAttribute(n, v) {
      this.attributes[n] = String(v);
    },
    getAttribute(n) {
      return this.attributes.hasOwnProperty(n)
        ? this.attributes[n]
        : null;
    },
    hasAttribute(n) {
      return this.attributes.hasOwnProperty(n);
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    insertBefore(c) {
      this.children.unshift(c);
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter(x => x !== c);
      return c;
    },
    addEventListener() {},
    setAttributeNS(_n, k, v) {
      this.attributes[k] = String(v);
    }
  };

  return el;
}

const host = makeElement("div");
host.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  width: 1200,
  height: 900
});

host.querySelector = selector =>
  selector === ".drawing-renderer"
    ? host.children.find(
        c => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
      ) || null
    : null;
host.querySelectorAll = () => [];

global.window.document = {
  createElement: makeElement,
  createElementNS: (_ns, tag) => makeElement(tag),
  createTextNode: text => ({ nodeType: 3, textContent: String(text) })
};
global.document = global.window.document;

loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("analysis-dependencies.js");
loadModule("drawing-state.js");
loadModule("renderer.js");

const deps = global.window.enggAnalysisDependencies;
const state = global.window.enggDrawingState;
const renderer = global.window.enggDrawingRenderer;

global.enggDrawingState = state;
global.enggBodyFrames = global.window.enggBodyFrames;
global.enggFeatureGeometry = global.window.enggFeatureGeometry;
global.enggAnalysisDependencies = deps;

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
 * A COMPONENTS OBJECT BUILT THE WAY THE APP BUILDS IT, from a source
 * force.
 *
 * The SHAPE is the renderer's, not the one guessed: it reads
 * `geometry.original`, `geometry.horizontal` and `geometry.vertical`,
 * each a segment with its own start and end. An earlier version of this
 * file put the derivation under `engineering.components` - which is
 * where the derivation genuinely lives - and found no arrows at all. That
 * was the test being wrong about the object, not the app drawing nothing,
 * and the two are easy to confuse.
 *
 * The segments are built FROM the derivation, so the numbers are still
 * the derived ones and not values typed here.
 *
 * THE LENGTH IS DELIBERATELY LARGER THAN THE COMPONENTS ARE SMALL. A
 * component of a 100 N force is tens of units, and a head a fraction of a
 * unit long at that scale is one pixel - too small for the tip to be read
 * off a drawing, so a test about which way an arrow points would be
 * measuring rounding. The drawn length is scaled up; the DIRECTION and
 * the SIGN, which is what is being tested, are untouched by that.
 */
const COMPONENT_DRAW_SCALE = 6;

const componentsFor = force => {
  const derived = deps.deriveForceComponents(force);

  if (!derived) return null;

  const o = derived.origin;

  /*
   * A component's drawn end is the origin plus the component itself,
   * scaled to a visible length. The SIGN is what matters and scaling
   * cannot change it, but a negative component drawn as a positive one
   * would be exactly the fault being looked for, so the end is computed
   * by multiplying the component's own signed value.
   */
  const endFor = vector => ({
    x: o.x + vector.x * COMPONENT_DRAW_SCALE,
    y: o.y + vector.y * COMPONENT_DRAW_SCALE
  });

  return {
    id: `components-${force.id}`,
    type: "force-components",
    geometry: {
      start: o,
      end: endFor(derived.original),
      direction: 90,

      original: { start: o, end: endFor(derived.original) },
      horizontal: { start: o, end: endFor(derived.x) },
      vertical: { start: o, end: endFor(derived.y) },

      showOriginal: true,
      showX: true,
      showY: true
    },
    engineering: {
      sourceFeatureIds: [force.id],
      analysisKind: "force-components",
      components: derived
    }
  };
};

const forceAt = (magnitude, angleDegrees) => ({
  id: `force-${magnitude}-${angleDegrees}`,
  type: "force",
  geometry: {
    start: { x: 100, y: 100 },
    end: { x: 130, y: 100 },
    position: { x: 100, y: 100 },
    magnitude,
    angle: angleDegrees
  }
});

/*
 * THE ARROWHEAD OF ONE COMPONENT, FROM THE DRAWN PATH.
 *
 * A head is a small filled polygon. Its shape is its direction, so the
 * tip is the vertex furthest from the base - which for a triangle is
 * simply the one with the greatest distance from the centroid. Reading
 * the tip that way means the test does not have to agree with the
 * renderer about which vertex is which, which is the whole risk when a
 * test is written about a drawing.
 */
const tipOf = polygonPoints => {
  const points = [...polygonPoints.matchAll(/(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map(
    m => ({ x: Number(m[1]), y: Number(m[2]) })
  );

  if (points.length < 2) return null;

  const centre = points.reduce(
    (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
    { x: 0, y: 0 }
  );

  return points.reduce((best, p) => {
    const d = Math.hypot(p.x - centre.x, p.y - centre.y);
    const bd = Math.hypot(best.x - centre.x, best.y - centre.y);

    return d > bd ? p : best;
  });
};

const headsIn = group =>
  (group ? group.children : [])
    .filter(
      c =>
        c.tagName === "POLYGON" ||
        c.tagName === "PATH" ||
        c.tagName === "TRIANGLE"
    )
    .map(c => {
      const a = c.attributes || {};
      const source = a.points || a.d;

      return source ? tipOf(source) : null;
    })
    .filter(Boolean);

const render = object => {
  drawingState.objects = [object];
  drawingState.selection.selectedObjectIds = [];

  renderer.renderDrawing(drawingState, host);

  const svg = host.children.find(
    c => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
  );

  return svg
    ? [...svg.children]
        .reverse()
        .find(
          c =>
            c.tagName === "G" &&
            c.dataset &&
            c.dataset.featureId === object.id
        )
    : null;
};

console.log("\n  a component arrowhead points along its component\n");

/*
 * THE SIGN, NOT THE LENGTH.
 *
 * +Fx and -Fx are the same length. The only thing that distinguishes them
 * is which side of the origin the tip is on, so the check is signed: the
 * tip's offset from the origin must have the same SIGN as the component,
 * for every quadrant. A renderer that derives the head from a screen
 * segment that runs the other way fails exactly here, while still
 * producing a plausible arrow of the right length.
 */
const SIGNS = [
  ["+x +y", 100, 45, 1, 1],
  ["-x +y", 100, 135, -1, 1],
  ["-x -y", 100, 225, -1, -1],
  ["+x -y", 100, 315, 1, -1],
  ["-x only", 100, 180, -1, 0],
  ["-y only", 100, 270, 0, -1]
];

SIGNS.forEach(([label, magnitude, angle, signX, signY]) => {
  const force = forceAt(magnitude, angle);
  const object = componentsFor(force);

  if (!object) {
    check(`${label}: components exist`, false, "no derivation");
    return;
  }

  const group = render(object);
  const heads = headsIn(group);

  check(
    `${label}: the component arrows are drawn`,
    heads.length > 0,
    `heads: ${heads.length}`
  );

  if (heads.length < 2) {
    return;
  }

  /*
   * THE ORIGIN, TAKEN FROM THE SHAFTS THEMSELVES.
   *
   * All three vectors share one origin - the force's application point -
   * and that is the point every component arrow starts from. So it does
   * not need a handle, or a second implementation of the camera, to be
   * found: it is the endpoint that all three shafts share, and reading
   * it from the drawing is both simpler and harder to get wrong.
   *
   * (An earlier version looked for a selection handle here and found
   * none, and reported "the origin is not drawn" - a fault in the test,
   * not the drawing.)
   *
   * ONLY SOLID LINES ARE SHAFTS. The renderer also draws two dashed
   * construction guides closing the decomposition triangle (one from each
   * component's tip back to the original's tip); they are not vectors and
   * do not start at the origin, so counting them made every full
   * decomposition look like it had two arrows too many.
   */
  const shafts = (group ? group.children : []).filter(
    c => c.tagName === "LINE" && c.attributes?.x1 !== undefined &&
      !c.attributes?.["stroke-dasharray"]
  );

  const origins = shafts.map(s => ({
    x: Number(s.attributes.x1),
    y: Number(s.attributes.y1)
  }));

  const sameOrigin = origins.every(
    p => Math.abs(p.x - origins[0].x) < 0.001 &&
      Math.abs(p.y - origins[0].y) < 0.001
  );

  /*
   * THREE SHAFTS ONLY WHEN ALL THREE VECTORS HAVE LENGTH.
   *
   * A zero component has no shaft to draw: a zero-length arrow would be
   * an invisible head on a point, which says nothing. So a force along an
   * axis draws two vectors, not three, and requiring three would fail
   * every cardinal direction - a fault in the test, in a case where the
   * drawing is right.
   */
  const expectedShafts =
    signX === 0 || signY === 0 ? 2 : 3;

  check(
    `${label}: the vectors drawn are the ones with length`,
    shafts.length === expectedShafts,
    `shafts: ${shafts.length}, expected ${expectedShafts}`
  );

  check(
    `${label}: the vectors share one origin`,
    shafts.length >= 2 && sameOrigin,
    `shafts: ${shafts.length}, origins: ${JSON.stringify(origins)}`
  );

  if (!origins.length) return;

  const originScreen = origins[0];

  /*
   * THE HEAD OF EACH COMPONENT, IN THE ORDER THEY ARE DRAWN.
   *
   * The renderer appends the ORIGINAL first, then the x component, then
   * the y one - so the first head is the original vector, not the x
   * component. Reading heads[0] as the x component and heads[1] as the y
   * one compares the original against x, which is wrong whenever the two
   * differ, and is exactly the kind of off-by-one that makes a correct
   * renderer look broken.
   *
   * So the heads are matched to the shafts by DIRECTION rather than by
   * position: the x component is the head on a nearly horizontal shaft,
   * and the y component the head on a nearly vertical one.
   */
  const headsByAxis = (group, origin) =>
    (group ? group.children : [])
      .filter(c => (c.tagName === "POLYGON" || c.tagName === "PATH") &&
        (c.attributes?.points || c.attributes?.d))
      .map(c => {
        const tip = tipOf(c.attributes.points || c.attributes.d);
        if (!tip) return null;

        const dx = tip.x - origin.x;
        const dy = tip.y - origin.y;

        /*
         * WHICH AXIS THIS HEAD BELONGS TO. A world y-up frame becomes
         * screen y-down, so a component along the y axis is the one
         * with the larger |dy|.
         */
        return {
          tip,
          axis: Math.abs(dx) > Math.abs(dy) ? "x" : "y"
        };
      })
      .filter(Boolean);

  const axisHeads = headsByAxis(group, originScreen);

  const xHead = axisHeads.find(h => h.axis === "x");
  const yHead = axisHeads.find(h => h.axis === "y");

  /*
   * THE WORLD FRAME IS Y-UP, SO A POSITIVE y COMPONENT HAS A SMALLER
   * SCREEN y. Stated here because getting it backwards makes a correct
   * renderer look broken, and because the sign comparison below depends
   * on it.
   */
  const xOffset = xHead ? xHead.tip.x - originScreen.x : 0;
  const yOffset = yHead ? yHead.tip.y - originScreen.y : 0;

  /*
   * A ZERO COMPONENT HAS NO HEAD, AND THAT IS CORRECT.
   *
   * A force along +x has no y component, so there is nothing to draw for
   * it - an arrow of no length would be a head sitting on the origin,
   * which reads as a claim that the force has a vertical part rather than
   * as an acknowledgement that it has none.
   *
   * So the head is only required for an axis the force actually has, and
   * for the other axis the drawing must contain NO head along it, which is
   * the stronger check: it is what would catch a renderer inventing a
   * zero-length component.
   */
  if (signX === 0) {
    check(
      `${label}: no arrowhead is drawn for a zero x component`,
      !xHead,
      `heads by axis: ${JSON.stringify(axisHeads.map(h => h.axis))}`
    );
  } else {
    check(
      `${label}: the x arrowhead points the right way`,
      xHead && Math.sign(xOffset) === signX,
      `tip offset ${xOffset}, expected sign ${signX}`
    );
  }

  if (signY === 0) {
    check(
      `${label}: no arrowhead is drawn for a zero y component`,
      !yHead,
      `heads by axis: ${JSON.stringify(axisHeads.map(h => h.axis))}`
    );
  } else {
    check(
      `${label}: the y arrowhead points the right way`,
      yHead && Math.sign(yOffset) === -signY,
      `tip offset ${yOffset}, expected sign ${-signY}`
    );
  }
});

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
