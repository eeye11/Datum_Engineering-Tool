
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * SMART DIMENSION: THE REFERENCE-TO-MEASUREMENT INFERENCE
 * ========================================================
 *
 * The interaction itself lives inside drawing.js's IIFE and needs a real
 * pointer sequence to run. What CAN be tested here is the part that
 * decides WHAT a set of references measures - which is the whole of Smart
 * Dimension's judgement and the part the specification is most specific
 * about:
 *
 *   one line       -> its full length
 *   one circle     -> its diameter
 *   one arc        -> its radius
 *   two lines      -> the angle between them
 *   point + line   -> the perpendicular distance
 *   two points     -> a distance oriented from MODEL geometry
 *
 * The functions are lifted out of the source and run against a context of
 * their own, the way the other drawing.js tests do it, because the
 * question is what THESE functions do and not what a reimplementation
 * would do.
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

const source = controllerSource();

/*
 * Pull one function out of drawing.js by brace matching.
 */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);

  if (start < 0) {
    return null;
  }

  const open = source.indexOf("{", start);

  let depth = 0;
  let end = open;

  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;

      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

/* ---------------------------------------------------------- */
/* The feature fixtures, shaped as drawing.js actually stores  */
/* them.                                                        */
/* ---------------------------------------------------------- */

const line = (id, start, end) => ({
  id,
  name: "Line",
  type: "line",
  geometry: { start, end },
  style: {},
  metadata: {},
});

const circle = (id, centre, radius) => ({
  id,
  name: "Circle",
  type: "circle",
  geometry: { center: centre, radius },
  style: {},
  metadata: {},
});

const arc = (id, centre, radius) => ({
  id,
  name: "Arc",
  type: "arc",
  geometry: {
    center: centre,
    radius,
    startAngle: 0,
    endAngle: Math.PI / 2,
  },
  style: {},
  metadata: {},
});

const polyline = (id, points) => ({
  id,
  name: "Polyline",
  type: "polyline",
  geometry: { points },
  style: {},
  metadata: {},
});

const rectangle = (id, position, width, height) => ({
  id,
  name: "Rectangle",
  type: "rectangle",
  geometry: { position, width, height, rotation: 0 },
  style: {},
  metadata: {},
});

const OBJECTS = [
  line("l1", { x: 0, y: 0 }, { x: 100, y: 0 }),
  line("l2", { x: 0, y: 0 }, { x: 0, y: 100 }),
  line("l3", { x: 0, y: 0 }, { x: 100, y: 100 }),
  line("l4", { x: 0, y: 50 }, { x: 200, y: 50 }),
  line("l5", { x: 300, y: 0 }, { x: 400, y: 0 }),
  circle("c1", { x: 0, y: 0 }, 25),
  arc("a1", { x: 0, y: 0 }, 10),
  /*
   * A polyline whose two segments are deliberately different lengths and
   * directions, so a segment reference can be told apart from the whole chain:
   * segment 0 runs 100 horizontally, segment 1 runs 50 vertically.
   */
  polyline("pl1", [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ]),
  rectangle("rect1", { x: 0, y: 0 }, 80, 40),
];

const byId = (id) => OBJECTS.find((o) => o.id === id) || null;

/*
 * The measurement stub. `twoPointSpan` and `resolveAnchor` are the only
 * two the inference reads, and they mirror the real measurement core for
 * the fixtures above.
 */
const twoPointSpan = (object) => {
  const start = object?.geometry?.start;
  const end = object?.geometry?.end;

  if (!start || !end) {
    return null;
  }

  return { start, end };
};

const lerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const resolveAnchor = (object, anchor) => {
  if (!object) {
    return null;
  }

  if (
    typeof anchor === "string" &&
    anchor.startsWith("pointOnEntity@")
  ) {
    const span = twoPointSpan(object);

    if (!span) {
      return null;
    }

    const t = Math.min(
      1,
      Math.max(0, Number(anchor.slice("pointOnEntity@".length))),
    );

    return lerp(span.start, span.end, t);
  }

  const span = twoPointSpan(object);

  if (span) {
    if (anchor === "start") return span.start;
    if (anchor === "end") return span.end;
    if (anchor === "midpoint") return lerp(span.start, span.end, 0.5);
  }

  const g = object.geometry || {};

  if (anchor === "center") return g.center || null;

  /*
   * A COMPOSITE FEATURE'S SEGMENTS.
   *
   * A polyline names its segment ends `segment{i}Start` / `segment{i}End` and
   * its midpoint `segment{i}Mid`; a rectangle names the same against its
   * corners. The stub resolves them the way the real measurement layer does,
   * so a segment reference can be tested here.
   */
  const segmentMatch = /^segment(\d+)(Start|End|Mid)$/.exec(anchor);

  if (segmentMatch) {
    const index = Number(segmentMatch[1]);
    const which = segmentMatch[2];
    const points =
      object.type === "polyline"
        ? (g.points || [])
        : [
            g.position,
            { x: g.position.x + g.width, y: g.position.y },
            { x: g.position.x + g.width, y: g.position.y + g.height },
            { x: g.position.x, y: g.position.y + g.height },
            g.position,
          ];

    const a = points[index];
    const b = points[index + 1];

    if (!a || !b) return null;
    if (which === "Start") return a;
    if (which === "End") return b;
    return lerp(a, b, 0.5);
  }

  if (g.radius !== undefined && g.center) {
    const r = Number(g.radius);
    const c = g.center;

    if (anchor === "east") return { x: c.x + r, y: c.y };
    if (anchor === "west") return { x: c.x - r, y: c.y };
    if (anchor === "north") return { x: c.x, y: c.y + r };
    if (anchor === "south") return { x: c.x, y: c.y - r };
  }

  return null;
};

const sandbox = {
  console,
  enggMeasurement: { twoPointSpan, resolveAnchor },
  objectWithId: byId,
  findDimensionTarget: () => null,
  twoPointSpanOf: twoPointSpan,

  /*
   * THE SHARED POINT PRIMITIVES, loaded from the real module.
   *
   * `distance` and `distanceToSegment` used to be extracted from the
   * controller's own source, because each module carried its own copy. They
   * now live once, in core/geometry/points.js, so the sandbox is given that
   * module rather than a sliced-out function - which is closer to what the
   * application does and cannot drift from it.
   */
  ...require(modulePath("points.js")),

  window: {
    enggFeatureGeometry: {
      rectangleCorners: (geometry) => {
        const { position = { x: 0, y: 0 }, width = 0, height = 0 } =
          geometry || {};

        return [
          position,
          { x: position.x + width, y: position.y },
          { x: position.x + width, y: position.y + height },
          { x: position.x, y: position.y + height },
        ];
      },
    },
  },
};

/* The controller imports the module by name rather than reading window. */
sandbox.enggFeatureGeometry = sandbox.window.enggFeatureGeometry;

vm.createContext(sandbox);

const pieces = [
  "directionOfFeature",
  "spanDimensionType",
  "resolveRefPoint",
  "referenceSpan",
  "spanUnitDirection",
  "sameLineReference",
  "perpendicularDistanceDescriptor",
  "compositeSegmentPoints",
  "compositeSegmentReference",
  "lineLengthDescriptor",
  "pairOrientation",
  "pointPairDescriptor",
  "pointToLineDescriptor",
  "inferDimensionDescriptor",
]
  .map((name) => extract(name))
  .filter(Boolean);

vm.runInContext(
  pieces.join("\n") +
    "\nthis.infer = inferDimensionDescriptor;" +
    "\nthis.spanType = spanDimensionType;" +
    "\nthis.segmentRef = compositeSegmentReference;" +
    "\nthis.lineDescriptor = lineLengthDescriptor;",
  sandbox,
);

const infer = sandbox.infer;
const segmentRef = sandbox.segmentRef;
const lineDescriptor = sandbox.lineDescriptor;

check(
  "the inference was recovered from drawing.js",
  typeof infer === "function",
  "extraction failed, so nothing below was actually tested",
);

if (typeof infer !== "function") {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

const pointRef = (id, anchor) => ({
  kind: "point",
  featureId: id,
  anchor,
  ref: { featureId: id, anchor },
});

const lineRef = (id) => ({
  kind: "line",
  featureId: id,
  anchor: "start",
  endAnchor: "end",
  object: byId(id),
});

/* ============================================================
 * ONE REFERENCE
 * ============================================================ */

console.log("\n  A single line is a complete reference\n");

const oneLine = infer(lineRef("l1"), null);

check(
  "one line produces a length dimension",
  oneLine &&
    ["horizontal", "vertical", "aligned"].includes(
      oneLine.dimensionType,
    ),
  `got ${JSON.stringify(oneLine)}`,
);
check(
  "and it references BOTH ends of that line",
  oneLine &&
    oneLine.refs.length === 2 &&
    oneLine.refs[0].featureId === "l1" &&
    oneLine.refs[1].featureId === "l1",
  `got ${JSON.stringify(oneLine?.refs)}`,
);

check(
  "a horizontal line is dimensioned horizontally",
  infer(lineRef("l1"), null).dimensionType === "horizontal",
);

check(
  "a vertical line is dimensioned vertically",
  infer(lineRef("l2"), null).dimensionType === "vertical",
);

console.log("\n  A single point is NOT yet a dimension\n");

check(
  "one point waits for its partner rather than measuring itself",
  infer(pointRef("l1", "start"), null) === null,
);

console.log("\n  A circle and an arc dimension themselves\n");

const circleRef = {
  kind: "circle",
  featureId: "c1",
  dimensionType: "diameter",
  anchor: "east",
};

const arcRef = {
  kind: "arc",
  featureId: "a1",
  dimensionType: "radius",
  anchor: "center",
};

check(
  "a circle produces a diameter dimension",
  infer(circleRef, null)?.dimensionType === "diameter",
);
check(
  "an arc produces a radius dimension",
  infer(arcRef, null)?.dimensionType === "radius",
);

/* ============================================================
 * TWO LINES -> ANGLE
 * ============================================================ */

console.log("\n  Two lines produce an angle, with no mode switch\n");

const angle = infer(lineRef("l1"), lineRef("l2"));

check(
  "two lines produce an angular dimension",
  angle?.dimensionType === "angular",
  `got ${JSON.stringify(angle)}`,
);
check(
  "referencing the two DIFFERENT features",
  angle &&
    angle.refs[0].featureId !== angle.refs[1].featureId,
);

check(
  "a line against itself has no angle",
  infer(lineRef("l1"), lineRef("l1")) === null,
);

/* ============================================================
 * TWO POINTS
 * ============================================================ */

console.log("\n  Two points, oriented from MODEL geometry\n");

const horizontallyAligned = infer(
  pointRef("l1", "start"),
  pointRef("l1", "end"),
);

check(
  "two points on the same straight body follow its axis",
  horizontallyAligned?.dimensionType === "aligned",
  `got ${JSON.stringify(horizontallyAligned)}`,
);
check(
  "and reference the two exact anchors",
  horizontallyAligned &&
    horizontallyAligned.refs[0].anchor === "start" &&
    horizontallyAligned.refs[1].anchor === "end",
);

const acrossTwoLines = infer(
  pointRef("l1", "end"),
  pointRef("l5", "start"),
);

check(
  "two strongly horizontal points are dimensioned horizontally",
  acrossTwoLines?.dimensionType === "horizontal",
  `got ${JSON.stringify(acrossTwoLines)}`,
);

const vertically = infer(
  pointRef("l1", "start"),
  pointRef("l2", "end"),
);

check(
  "two strongly vertical points are dimensioned vertically",
  vertically?.dimensionType === "vertical",
  `got ${JSON.stringify(vertically)}`,
);

const diagonal = infer(
  pointRef("l3", "start"),
  pointRef("l3", "end"),
);

check(
  "two points on a diagonal body follow that body",
  diagonal?.dimensionType === "aligned",
);

console.log("\n  Duplicate references are refused, not measured\n");

check(
  "the same anchor twice produces nothing",
  infer(
    pointRef("l1", "start"),
    pointRef("l1", "start"),
  ) === null,
);

/* ============================================================
 * POINT + LINE
 * ============================================================ */

console.log("\n  A point and a line give a perpendicular distance\n");

const pointToLine = infer(
  pointRef("l2", "end"),
  lineRef("l1"),
);

check(
  "point then line produces a perpendicular distance",
  pointToLine?.dimensionType === "point-line",
  `got ${JSON.stringify(pointToLine)}`,
);
check(
  "the point reference is kept",
  pointToLine &&
    pointToLine.refs.some(
      (r) => r.featureId === "l2" && r.anchor === "end",
    ),
);
check(
  "and the line reference is kept by BOTH of its ends",
  pointToLine &&
    pointToLine.refs.filter((r) => r.featureId === "l1").length === 2,
);

const lineToPoint = infer(
  lineRef("l1"),
  pointRef("l2", "end"),
);

check(
  "line then point is the same measurement",
  lineToPoint?.dimensionType === "point-line" &&
    lineToPoint.refs.length === 3,
);

/* ============================================================
 * COMPOSITE FEATURES: ONE SEGMENT AT A TIME
 * ============================================================ */

console.log("\n  A polyline is referenced by the segment that was clicked\n");

const polylineRef0 = segmentRef(
  byId("pl1"),
  { x: 50, y: 2 },
);

check(
  "a click on the first segment references that segment's ends",
  polylineRef0 &&
    polylineRef0.featureId === "pl1" &&
    polylineRef0.anchor === "segment0Start" &&
    polylineRef0.endAnchor === "segment0End",
  `got ${JSON.stringify(polylineRef0)}`,
);

const polylineRef1 = segmentRef(
  byId("pl1"),
  { x: 102, y: 25 },
);

check(
  "and a click on the second references the second, not the first",
  polylineRef1 &&
    polylineRef1.anchor === "segment1Start" &&
    polylineRef1.endAnchor === "segment1End",
  `got ${JSON.stringify(polylineRef1)}`,
);

/*
 * The whole point of a segment reference: dimensioning one segment measures
 * THAT segment's length, not the distance between the polyline's two ends.
 */
const segmentLength = lineDescriptor(polylineRef0);

check(
  "dimensioning one segment measures that segment, not the whole chain",
  segmentLength &&
    segmentLength.dimensionType === "horizontal" &&
    segmentLength.refs[0].anchor === "segment0Start" &&
    segmentLength.refs[1].anchor === "segment0End",
  `got ${JSON.stringify(segmentLength)}`,
);

const verticalSegmentLength = lineDescriptor(polylineRef1);

check(
  "and a vertical segment is dimensioned vertically",
  verticalSegmentLength?.dimensionType === "vertical",
  `got ${JSON.stringify(verticalSegmentLength)}`,
);

console.log("\n  A rectangle's edge behaves like a line\n");

const rectangleEdge = segmentRef(
  byId("rect1"),
  { x: 40, y: 1 },
);

check(
  "a click on an edge references that edge's two ends",
  rectangleEdge &&
    rectangleEdge.featureId === "rect1" &&
    rectangleEdge.anchor === "segment0Start" &&
    rectangleEdge.endAnchor === "segment0End",
  `got ${JSON.stringify(rectangleEdge)}`,
);

check(
  "which dimensions that edge's length",
  lineDescriptor(rectangleEdge)?.dimensionType === "horizontal",
  `got ${JSON.stringify(lineDescriptor(rectangleEdge))}`,
);

check(
  "no segment reference is invented for a plain line",
  segmentRef(byId("l1"), { x: 50, y: 0 }) === null,
  `got ${JSON.stringify(segmentRef(byId("l1"), { x: 50, y: 0 }))}`,
);

/* ============================================================
 * NO TILDE, EVER
 * ============================================================ */

console.log("\n  No approximation symbol anywhere in the output\n");

const everything = JSON.stringify([
  oneLine,
  angle,
  horizontallyAligned,
  acrossTwoLines,
  vertically,
  pointToLine,
]);

check(
  "no inferred descriptor contains a tilde",
  !everything.includes("~"),
  everything,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
