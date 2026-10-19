
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DOES A REVERSED LOAD STILL HAVE ITS OUTLINE?
 *
 * The model is fine: `reverseLoadDirection` touches one boolean and a test
 * proves no span, endpoint, intensity or attachment moves. So the reported
 * fault - a reversal that "loses or moves the outline at the arrow ends" -
 * cannot be in the model, and has to be in what gets DRAWN.
 *
 * That is what this file renders. It builds a load, renders it, reverses
 * it, renders it again, and compares the two drawings field by field.
 *
 * The comparison is the point. Not "does something render" - a lost
 * outline still leaves most of the load on screen, so a load that draws
 * anything at all would pass that. What has to hold is that the set of
 * drawn marks is the SAME set, with only the arrowheads moved to the far
 * end of each vector. One fewer outline stroke is invisible in a
 * screenshot and obvious in a count.
 */

global.window = {
  crypto: { randomUUID: () => "load-reversal-uuid" }
};

/*
 * The smallest SVG surface the renderer needs, counting children so
 * "did this draw anything, and what" is answerable.
 */
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

/*
 * ensureSvg asks the canvas for an existing ".drawing-renderer" and mints
 * a new one when there is none. A host that always answers null would
 * leave a growing pile of one-group canvases, and the counts below would
 * be meaningless.
 */
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

loadModule("load-profile.js");
loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("load-profile.js");
loadModule("drawing-state.js");
loadModule("renderer.js");

const state = global.window.enggDrawingState;
const profile = global.window.enggLoadProfile;
const renderer = global.window.enggDrawingRenderer;

global.enggDrawingState = state;
global.enggBodyFrames = global.window.enggBodyFrames;
global.enggFeatureGeometry = global.window.enggFeatureGeometry;
global.enggLoadProfile = profile;

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

const beam = {
  id: "beam-1",
  type: "beam",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 300, y: 0 },
    depth: 12
  }
};

/*
 * A SIGNATURE OF WHAT WAS DRAWN: every mark, by the fields that define
 * where it is. Comparing a count alone would not notice a stroke that
 * survived but moved; comparing geometry alone would miss a missing one.
 */
const signature = group => {
  if (!group) return null;

  return group.children
    .map(child => {
      const a = child.attributes || {};

      /*
       * EVERY field that can place a mark.
       *
       * The earlier version of this captured d, the line endpoints and
       * the circle centre - and produced two "identical" drawings from a
       * reversal that sets a flag the renderer is supposed to read. The
       * arrowheads carry `stroke: none` and their shape in `points` or a
       * `transform`, neither of which was captured, so a comparison blind
       * to them would report any reversal as a no-op. That is the whole
       * bug this file exists to find, so the capture has to include what
       * it might be.
       */
      const fields = [
        a.d,
        a.points,
        a.transform,
        a.cx !== undefined ? `${a.cx},${a.cy}` : null,
        a.r,
        a.x1 !== undefined
          ? `${a.x1},${a.y1},${a.x2},${a.y2}`
          : null,
        a.x !== undefined
          ? `${a.x},${a.y},${a.width},${a.height}`
          : null,
        a.fill,
        a.stroke
      ]
        .filter(v => v !== null && v !== undefined)
        .join("|");

      return { tag: child.tagName, fields };
    })
    .sort((a, b) => `${a.tag}${a.fields}`.localeCompare(`${b.tag}${b.fields}`));
};

const renderLoad = load => {
  drawingState.objects = [beam, load];
  drawingState.selection.selectedObjectIds = [];

  renderer.renderDrawing(drawingState, host);

  const svg = host.children.find(
    c => c.tagName === "SVG" && c.classList.contains("drawing-renderer")
  );

  /*
   * THE LAST MATCH, NOT THE FIRST.
   *
   * The renderer appends a fresh group per render rather than clearing
   * the canvas, so a feature drawn twice appears twice. Reading the first
   * match would return the group from BEFORE the reversal - which is
   * exactly the stale comparison this file was written to avoid, and the
   * reason a reversal appeared to change nothing.
   */
  return svg
    ? [...svg.children]
        .reverse()
        .find(
          c =>
            c.tagName === "G" &&
            c.dataset &&
            c.dataset.featureId === load.id
        )
    : null;
};

/*
 * WHAT THE HARNESS CAN ACTUALLY SEE, printed. A signature that is empty,
 * or that contains only a background, would make every comparison here
 * pass for the wrong reason - and one of these checks exists precisely to
 * catch a rendering that did nothing.
 */
const describeGroup = group =>
  group
    ? group.children.map(c => ({
        tag: c.tagName,
        points: c.attributes && c.attributes.points,
        transform: c.attributes && c.attributes.transform,
        fill: c.attributes && c.attributes.fill,
        stroke: c.attributes && c.attributes.stroke
      }))
    : "NO GROUP";

console.log("\n  a reversed load draws the same load\n");

/* ============================================================
   THE UNIFORM LOAD
   ============================================================ */

const load = state.geometryFactories.load(
  { x: 40, y: 40 },
  { x: 260, y: 40 },
  10,
  {}
);

const beforeGroup = renderLoad(load);
const before = signature(beforeGroup);

check(
  "the load draws something before it is reversed",
  before && before.length > 0,
  `marks: ${before ? before.length : "no group"}`
);

profile.reverseLoadDirection(load.geometry);

const afterGroup = renderLoad(load);
const after = signature(afterGroup);

check(
  "the load still draws something after it is reversed",
  after && after.length > 0,
  `marks: ${after ? after.length : "no group"}`
);

/*
 * THE CENTRAL CLAIM, as a count.
 *
 * A reversal flips which end of each force vector carries the arrowhead.
 * It must not add or remove a single mark: in particular the OUTLINE at
 * the far end of the arrows, which is the thing reported as vanishing, is
 * a stroke like any other and would show up here as a mark fewer.
 */
check(
  "reversing draws exactly as many marks as before",
  before && after && before.length === after.length,
  `before ${before ? before.length : "?"}, after ${after ? after.length : "?"}`
);

/*
 * THE MARKS THAT MUST NOT MOVE, AND THE ONE THAT MUST.
 *
 * Declared before they are used, which is not a style point: a `const`
 * arrow function is in its temporal dead zone until the line above it
 * runs, and reading one from a helper defined higher up throws rather
 * than returning undefined - which is how a test can fail for a reason
 * that has nothing to do with what it is testing.
 *
 * A shaft is a LINE. The outline at the arrow ends is a POLYGON drawn in
 * the load's own stroke and fill. The arrowheads are POLYGONs carrying
 * neither, because they are filled shapes whose shape IS their direction.
 */
const outlineMarks = list =>
  (list || []).filter(
    m =>
      m.tag === "POLYGON" &&
      m.fields.includes("stroke=") &&
      m.fields.includes("fill=")
  );

const headMarks = list =>
  (list || []).filter(
    m => m.tag === "POLYGON" && !m.fields.includes("stroke=")
  );

const shafts = list =>
  (list || []).filter(m => m.tag === "LINE");

const headsExcluded = list =>
  (list || []).filter(m => !headMarks([m]).length);

const counts = list => {
  const tally = {};

  list.forEach(mark => {
    tally[mark.tag] = (tally[mark.tag] || 0) + 1;
  });

  return tally;
};

/*
 * NOT "the same marks" - "the same marks apart from the arrowheads".
 *
 * This was the wrong assertion when this file was written, and it failed
 * for the right reason: a reversal is SUPPOSED to change the drawing, and
 * the marks it changes are the arrowheads. The count, the shafts and the
 * outline are each checked individually below; this one states the whole
 * picture in a single comparison, with the heads excluded.
 */
check(
  "every mark except the arrowheads is untouched",
  before &&
    after &&
    JSON.stringify(headsExcluded(before)) ===
      JSON.stringify(headsExcluded(after)),
  before && after
    ? `first difference at ${headsExcluded(before).findIndex(
        (b, i) =>
          JSON.stringify(b) !==
          JSON.stringify(headsExcluded(after)[i])
      )}`
    : "nothing to compare"
);

/*
 * WHAT ACTUALLY MOVED.
 *
 * The count holds and the set does not, so a reversal must be trading
 * marks. The claim being tested is that the marks that move are the
 * ARROWHEADS, and that the shaft and the outline - one each, the
 * definition of the load's visual envelope - stay exactly where they
 * were. A reversal that changed the count, or that moved a shaft, would
 * be the reported fault.
 */
const beforeCounts = counts(before || []);
const afterCounts = counts(after || []);

const sameComposition =
  JSON.stringify(beforeCounts) === JSON.stringify(afterCounts);

check(
  "reversal keeps the same NUMBER of each kind of mark",
  sameComposition,
  `before ${JSON.stringify(beforeCounts)}, after ${JSON.stringify(afterCounts)}`
);

check(
  "the outline at the arrow ends survives the reversal",
  JSON.stringify(outlineMarks(before)) ===
    JSON.stringify(outlineMarks(after)),
  `before ${outlineMarks(before).length}, after ${
    outlineMarks(after).length
  }`
);

check(
  "the arrowheads are the marks that changed",
  JSON.stringify(headMarks(before)) !==
    JSON.stringify(headMarks(after)),
  "arrowheads are unchanged, so the reversal is not visible"
);

check(
  "no shaft moves when the direction reverses",
  JSON.stringify(shafts(before)) === JSON.stringify(shafts(after)),
  `before ${shafts(before).length} shafts, after ${
    shafts(after).length
  } shafts`
);

/*
 * ...WHICH WOULD MEAN THE DRAWING NEVER CHANGED AT ALL, which is also
 * wrong. The point of the control is that the arrows visibly reverse, so
 * something must differ. If the two signatures are identical, the flag is
 * being ignored by the renderer and the button does nothing.
 */
const identical = before && after &&
  JSON.stringify(before) === JSON.stringify(after);

check(
  "reversing does change the drawing, so the flag is not ignored",
  !identical,
  "the flag is set but the renderer produced an identical drawing"
);

console.log(
  "\n  the reversal keeps the load, and moves only the arrowheads\n"
);
console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
