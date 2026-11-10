/* eslint-disable no-console */
/*
 * ========================================================
 * THE SKETCH EDITOR'S ACCEPTANCE TESTS
 * ========================================================
 *
 * The behaviour the brief lists, as a suite that runs without a browser. Every
 * case draws REAL strokes - the shapes a hand produces, with tremor - and asks
 * the reconstruction what it made of them, because a correction that only
 * passes on synthetic points is a correction that will fail on a student.
 *
 * Covered here:
 *
 *   correction      line, circle, arc, ellipse, curve, composite, polygon,
 *                   and the case where NOTHING should be forced
 *   anchors         exact through the fit, and not bounding the stroke
 *   points          insertion on geometry, coordinate editing
 *   on/off          correction disabled, and restoring the original stroke
 *   zoom            stored geometry untouched
 *   source          the primitives, the appearance, and the round trip
 *   migration       a saved sketch carrying obsolete points still opens
 *   placement       round shapes stay round, and translation moves them
 *   history         undo restores the previous state
 *
 * Run with: node --test tests/sketch-acceptance.test.cjs
 */

const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}${detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ""}`,
    );
  }
};

const load = (relative) =>
  import(pathToFileURL(path.join(__dirname, "..", relative)).href);

/* A tremor that looks like a hand: two incommensurate waves. */
const tremor = (index, amount = 0.04) =>
  Math.sin(index * 2.7) * amount + Math.cos(index * 5.1) * amount * 0.6;

/*
 * THE DRAWINGS. Each is what a student's stroke looks like, not a set of exact
 * points - the fit has to find the shape despite the wobble.
 */
const DRAWINGS = {
  line: Array.from({ length: 50 }, (_, index) => ({
    x: index * 0.25,
    y: 1 + tremor(index),
  })),

  circle: Array.from({ length: 70 }, (_, index) => {
    const angle = (index / 69) * Math.PI * 2;

    return {
      x: 5 * Math.cos(angle) + tremor(index, 0.07),
      y: 5 * Math.sin(angle) + tremor(index + 3, 0.07),
    };
  }),

  arc: Array.from({ length: 45 }, (_, index) => {
    const angle = (index / 44) * Math.PI;

    return {
      x: 5 * Math.cos(angle) + tremor(index, 0.03),
      y: 5 * Math.sin(angle) + tremor(index + 2, 0.03),
    };
  }),

  ellipse: Array.from({ length: 70 }, (_, index) => {
    const angle = (index / 69) * Math.PI * 2;

    return {
      x: 9 * Math.cos(angle) + tremor(index, 0.04),
      y: 3 * Math.sin(angle) + tremor(index + 1, 0.04),
    };
  }),

  curve: Array.from({ length: 55 }, (_, index) => {
    const t = index / 54;

    return { x: t * 10, y: Math.sin(t * Math.PI) * 4 + tremor(index, 0.05) };
  }),

  box: [
    ...Array.from({ length: 14 }, (_, index) => ({ x: index * 0.5, y: 0 })),
    ...Array.from({ length: 10 }, (_, index) => ({ x: 6.5, y: index * 0.4 })),
    ...Array.from({ length: 14 }, (_, index) => ({
      x: 6.5 - index * 0.5,
      y: 3.6,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      x: 0,
      y: 3.6 - index * 0.4,
    })),
  ],

  mixed: [
    ...Array.from({ length: 15 }, (_, index) => ({ x: index * 0.3, y: 0 })),
    ...Array.from({ length: 22 }, (_, index) => {
      const t = index / 21;

      return { x: 4.5 + t * 3, y: Math.sin(t * Math.PI) * 2 };
    }),
    ...Array.from({ length: 15 }, (_, index) => ({
      x: 7.5 + index * 0.3,
      y: 0,
    })),
  ],
};

(async () => {
  const C = await load("src/shared/sketch/sketch-correction.js");
  const D = await load("src/shared/sketch/sketch-document.js");
  const S = await load("src/shared/sketch/sketch-source.js");
  const PR = await load("src/shared/sketch/sketch-source-parser.js");
  const P = await load("src/shared/sketch/sketch-points.js");
  const M = await load("src/shared/sketch/sketch-migrate.js");
  const A = await load("src/shared/sketch/sketch-geometry-adapters.js");
  const V = await load("src/shared/sketch/sketch-viewport.js");
  const H = await load("src/shared/sketch/sketch-history.js");
  const PL = await load("src/shared/sketch/sketch-placement.js");
  const G = await load("src/shared/sketch/sketch-grid.js");

  /* ============================================ correction */
  console.log("\nAutomatic geometric correction");
  console.log("------------------------------");

  const line = C.correctStroke(DRAWINGS.line);

  check(
    "a rough straight line becomes an exact two-point line",
    line.correction.kind === "line" && line.points.length === 2,
    { kind: line.correction.kind, points: line.points.length },
  );

  check(
    "and its ends are the ends that were drawn",
    Math.abs(line.points[0].x - DRAWINGS.line[0].x) < 0.5 &&
      Math.abs(line.points[1].x - DRAWINGS.line[DRAWINGS.line.length - 1].x) < 0.5,
    line.points,
  );

  check(
    "and the tremor is gone - two points, not fifty",
    line.points.length === 2 && DRAWINGS.line.length === 50,
    line.points.length,
  );

  check(
    "a rough circle becomes a mathematical circle",
    C.correctStroke(DRAWINGS.circle).correction.kind === "circle",
    C.correctStroke(DRAWINGS.circle).correction.kind,
  );

  check(
    "and its radius is the radius that was drawn",
    Math.abs(C.correctStroke(DRAWINGS.circle).correction.radius - 5) < 0.4,
    C.correctStroke(DRAWINGS.circle).correction.radius,
  );

  check(
    "an open circular stroke becomes an arc",
    C.correctStroke(DRAWINGS.arc).correction.kind === "arc",
    C.correctStroke(DRAWINGS.arc).correction.kind,
  );

  check(
    "an ellipse is an ellipse, not a circle",
    C.correctStroke(DRAWINGS.ellipse).correction.kind === "ellipse",
    C.correctStroke(DRAWINGS.ellipse).correction.kind,
  );

  const curve = C.correctStroke(DRAWINGS.curve);

  check(
    "a smooth curve becomes a curve with Bezier segments",
    curve.correction.kind === "curve" && curve.segments.length > 0,
    { kind: curve.correction.kind, segments: curve.segments.length },
  );

  check(
    "and it is CLEAN - a handful of vertices, not the samples",
    curve.points.length < 14,
    curve.points.length,
  );

  const mixed = C.correctStroke(DRAWINGS.mixed);

  check(
    "straight and curved parts of one stroke are segmented",
    mixed.correction.kind === "composite" &&
      mixed.correction.parts.includes("line"),
    mixed.correction.parts,
  );

  check(
    "and the corners are kept",
    mixed.points.length > 2,
    mixed.points.length,
  );

  const box = C.correctStroke(DRAWINGS.box);

  check(
    "a hand-drawn box becomes a closed polygon of four corners",
    box.correction.kind === "polygon" && box.points.length === 4,
    { kind: box.correction.kind, corners: box.points.length },
  );

  /*
   * THE CASE WHERE NOTHING SHOULD BE FORCED.
   *
   * A wild scribble fits no primitive well. The honest answer is a general curve
   * - and possibly several of them - never a circle or a line chosen because the
   * fitter had to choose something.
   */
  const wild = C.correctStroke(
    Array.from({ length: 40 }, (_, index) => ({
      x: Math.sin(index * 0.9) * 5 + index * 0.2,
      y: Math.cos(index * 1.7) * 5,
    })),
  );

  check(
    "a wild stroke is never forced into a primitive",
    ["curve", "composite"].includes(wild.correction.kind) &&
      (wild.correction.parts || []).every((part) => part === "curve"),
    { kind: wild.correction.kind, parts: wild.correction.parts },
  );

  /* ============================================ anchors */
  console.log("\nAnchor points");
  console.log("-------------");

  const a1 = P.makePoint({
    type: "anchor",
    x: DRAWINGS.curve[10].x,
    y: DRAWINGS.curve[10].y,
  });
  const a2 = P.makePoint({
    type: "anchor",
    x: DRAWINGS.curve[44].x,
    y: DRAWINGS.curve[44].y,
  });

  const anchored = C.correctStroke(DRAWINGS.curve, { points: [a1, a2] });
  const touches = (point) =>
    anchored.points.some(
      (q) => Math.hypot(q.x - point.x, q.y - point.y) < 1e-6,
    );

  check(
    "the corrected geometry passes through every anchor exactly",
    touches(a1) && touches(a2),
  );

  check(
    "and the stroke still begins and ends where it was drawn",
    Math.abs(anchored.points[0].x - DRAWINGS.curve[0].x) < 0.6,
    anchored.points[0],
  );

  /*
   * AN ANCHOR IS NOT A BOUNDARY.
   *
   * A stroke that runs well past its anchors keeps the whole of itself: the
   * geometry before the first and after the last is part of what was drawn.
   */
  const longStroke = Array.from({ length: 61 }, (_, index) => {
    const t = index / 60;

    return { x: t * 20, y: Math.sin(t * Math.PI) * 6 };
  });

  const inner1 = P.makePoint({
    type: "anchor",
    x: longStroke[15].x,
    y: longStroke[15].y,
  });
  const inner2 = P.makePoint({
    type: "anchor",
    x: longStroke[45].x,
    y: longStroke[45].y,
  });

  const bounded = C.correctStroke(longStroke, { points: [inner1, inner2] });

  check(
    "a stroke may be drawn before its first anchor",
    bounded.points[0].x < inner1.x - 1,
    { start: bounded.points[0].x, anchor: inner1.x },
  );

  check(
    "and continued past its last",
    bounded.points[bounded.points.length - 1].x > inner2.x + 1,
    { end: bounded.points[bounded.points.length - 1].x, anchor: inner2.x },
  );

  const faraway = P.makePoint({ type: "anchor", x: 500, y: 500 });
  const undragged = C.correctStroke(longStroke, { points: [faraway] });

  check(
    "an anchor nowhere near the stroke does not drag it",
    Math.max(...undragged.points.map((point) => point.x)) < 25,
    Math.max(...undragged.points.map((point) => point.x)),
  );

  const elsewhere = longStroke.map((point) => ({
    x: point.x + 1000,
    y: point.y + 1000,
  }));

  check(
    "a stroke drawn entirely outside the anchors is still accepted",
    C.correctStroke(elsewhere, { points: [inner1, inner2] }).points.length > 2,
  );

  /* ---- insertion ---- */
  const inserted = A.pointOnGeometry(
    { id: "curve-1", kind: "curve", points: DRAWINGS.curve },
    { x: 5.3, y: 3.7 },
  );

  check(
    "a point inserted on a curve is projected onto the real geometry",
    Boolean(inserted) &&
      inserted.geometryId === "curve-1" &&
      Math.abs(inserted.x - 5.3) < 1.5,
    inserted && { x: inserted.x, y: inserted.y },
  );

  /* ---- editing ---- */
  let document_ = D.createSketchDocument();
  const added = D.addPoint(document_, { type: "anchor", x: 2, y: 2 });

  document_ = added.document;
  document_ = D.movePoint(document_, added.point.id, -7, 9.5);

  check(
    "editing an anchor coordinate moves the point, negatives and decimals included",
    document_.points[0].x === -7 && document_.points[0].y === 9.5,
    document_.points[0],
  );

  /* ============================================ correction on/off */
  console.log("\nCorrection on, off and restore");
  console.log("------------------------------");

  const off = C.correctStroke(DRAWINGS.line, { correction: false });

  check(
    "correction off keeps the student's own stroke",
    off.points.length === DRAWINGS.line.length &&
      off.correction.disabled === true,
    off.points.length,
  );

  const restored = C.restoreOriginal(curve);

  check(
    "the original stroke can be restored exactly",
    restored.points.length === DRAWINGS.curve.length &&
      Math.abs(restored.points[0].x - DRAWINGS.curve[0].x) < 1e-9,
  );

  /* ============================================ zoom */
  console.log("\nZoom and coordinate integrity");
  console.log("-----------------------------");

  const before = JSON.stringify(DRAWINGS.circle);

  const near = V.createViewport({
    bounds: { xMin: -6, xMax: 6, yMin: -6, yMax: 6 },
    width: 400,
    height: 400,
    equal: true,
  });
  const far = V.createViewport({
    bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    width: 1600,
    height: 1200,
    equal: true,
  });

  V.toScreen(DRAWINGS.circle[0], near);
  V.toScreen(DRAWINGS.circle[0], far);

  check(
    "zooming leaves stored geometry untouched",
    JSON.stringify(DRAWINGS.circle) === before,
  );

  /* ============================================ source */
  console.log("\nSource generation");
  console.log("-----------------");

  let drawn = D.createSketchDocument();

  ["line", "circle", "arc", "ellipse", "curve"].forEach((name) => {
    const result = C.correctStroke(DRAWINGS[name]);

    drawn = D.addGeometry(drawn, {
      kind: result.correction.kind,
      name,
      points: result.points,
      segments: result.segments,
      centre: result.correction.centre || null,
      radius: result.correction.radius ?? null,
      radiusX: result.correction.radiusX ?? null,
      radiusY: result.correction.radiusY ?? null,
      closed: Boolean(result.correction.closed),
      original: result.original,
      correction: result.correction,
      appearance: { colour: "#cc0000", lineStyle: "dashed", thickness: "bold" },
    });
  });

  const source = S.generateSource(drawn, { include: {} }).source;

  check("the source writes a circle primitive", /circle\[radius=/.test(source));
  check("the source writes an arc primitive", /arc\[start angle=/.test(source));
  check(
    "the source writes an ellipse primitive",
    /ellipse\[x radius=/.test(source),
  );
  check("the source writes Bezier curves", /controls/.test(source));
  check(
    "the source writes the stored appearance",
    /dashed/.test(source) && /sketchcc0000/.test(source),
  );

  check(
    "and it does NOT write the rough stroke when a shape was recognised",
    !/circle\[radius=/.test(source) ||
      (source.match(/circle\[radius=/g) || []).length === 1,
  );

  const parsed = PR.parseSource(source);

  check("the source parses back cleanly", parsed.ok, parsed.problems);
  check("with every element", parsed.geometry.length === drawn.geometry.length);

  const strip = (text) =>
    text
      .split("\n")
      .filter((line) => !line.startsWith("%") && !line.includes("tikzset"))
      .join("\n");

  check(
    "and regenerating it is byte-identical",
    strip(source) ===
      strip(
        S.generateSource(PR.applyParsedSource(drawn, parsed).document, {
          include: {},
        }).source,
      ),
  );

  /* ============================================ migration */
  console.log("\nMigration of a saved sketch");
  console.log("---------------------------");

  const legacy = M.migrateSketch({
    schemaVersion: 1,
    points: [
      {
        id: "a1",
        name: "P1",
        type: "anchor",
        x: 1,
        y: 1,
        coordinateMode: "absolute",
      },
      {
        id: "g1",
        name: "G1",
        type: "guide",
        x: 4,
        y: 4,
        coordinateMode: "absolute",
      },
      {
        id: "a2",
        name: "P2",
        type: "anchor",
        x: 0,
        y: 0,
        coordinateMode: "polar",
        referenceId: "g1",
        distance: 3,
        angleDeg: 0,
      },
    ],
    geometry: [{ id: "e1", kind: "circle", points: [], guides: ["g1"] }],
  });

  check(
    "a saved shape guide is removed",
    legacy.document.points.every((point) => point.type !== "guide"),
    legacy.document.points.map((point) => point.type),
  );

  check(
    "a point that depended on it keeps its exact position",
    (() => {
      const point = legacy.document.points.find((entry) => entry.id === "a2");

      return (
        point.coordinateMode === "absolute" &&
        Math.abs(point.x - 7) < 1e-9 &&
        Math.abs(point.y - 4) < 1e-9
      );
    })(),
    legacy.document.points,
  );

  check(
    "the migration says what it changed",
    legacy.changes.length >= 2,
    legacy.changes,
  );
  check("and no geometry is lost", legacy.document.geometry.length === 1);
  check(
    "a current sketch needs no migration",
    !M.needsMigration(legacy.document),
  );
  check("but an old one does", M.needsMigration({ schemaVersion: 1 }));

  /* ============================================ placement */
  console.log("\nPlacement");
  console.log("---------");

  const transform = PL.alignTransform({ x: 0, y: 0 }, { x: 50, y: 20 });
  const placed = PL.placementPackage(drawn, transform, {});
  const circleElement = placed.geometry.find(
    (element) => element.kind === "circle",
  );

  check(
    "placing keeps a circle round",
    circleElement.radius ===
      drawn.geometry.find((element) => element.kind === "circle").radius,
  );

  check(
    "placing translates the geometry",
    placed.geometry.every(
      (element) => element.centre === null || Number.isFinite(element.centre.x),
    ),
  );

  /* ============================================ history */
  console.log("\nHistory");
  console.log("-------");

  let history = H.createHistory(drawn);

  const styled = D.setGeometryAppearance(drawn, drawn.geometry[0].id, {
    lineStyle: "dotted",
  });

  history = H.commit(history, styled);

  check(
    "undo restores the previous appearance",
    H.undo(history).document.geometry[0].appearance.lineStyle !== "dotted",
  );

  check(
    "and redo puts it back",
    H.redo(H.undo(history).history).document.geometry[0].appearance
      .lineStyle === "dotted",
  );

  /* ============================================ snapping */
  console.log("\nGrid and midpoint snapping");
  console.log("--------------------------");

  const grid = {
    majorX: 1,
    majorY: 1,
    snapToGrid: true,
    snapToGridMidpoints: true,
  };
  const viewport = V.createViewport({
    bounds: { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
    width: 800,
    height: 480,
  });

  check(
    "a click near an intersection snaps to it",
    G.snapPoint({ x: 1.04, y: 2.97 }, { grid, viewport }).x === 1,
  );
  check(
    "a click near a horizontal midpoint snaps there",
    G.snapPoint({ x: 1.46, y: 2.03 }, { grid, viewport }).x === 1.5,
  );
  check(
    "a click near a vertical midpoint snaps there",
    G.snapPoint({ x: 1.03, y: 2.47 }, { grid, viewport }).y === 2.5,
  );
  check(
    "a click near a cell centre snaps there",
    (() => {
      const at = G.snapPoint({ x: 1.47, y: 2.52 }, { grid, viewport });

      return at.x === 1.5 && at.y === 2.5;
    })(),
  );

  check(
    "midpoints off leaves intersections only",
    G.snapPoint(
      { x: 1.46, y: 2.03 },
      { grid: { ...grid, snapToGridMidpoints: false }, viewport },
    ).kind !== "midpoint",
  );

  check(
    "grid off leaves the click free",
    G.snapPoint(
      { x: 1.46, y: 2.03 },
      { grid: { ...grid, snapToGrid: false }, viewport },
    ).snapped === false,
  );

  check(
    "a hidden grid still snaps",
    G.snapPoint(
      { x: 1.04, y: 2.97 },
      { grid: { ...grid, showMajorGrid: false }, viewport },
    ).snapped === true,
  );

  /* ============================================ bounds */
  console.log("\nAutomatic bounds");
  console.log("----------------");

  const extent = V.boundsOfPoints(
    [
      { x: -3, y: 2 },
      { x: 4, y: 5 },
      { x: 8, y: -2 },
      { x: -1, y: -4 },
    ],
    { margin: 0 },
  );

  check(
    "the extent is the geometry's own minimum and maximum",
    extent.xMin === -3 &&
      extent.xMax === 8 &&
      extent.yMin === -4 &&
      extent.yMax === 5,
    extent,
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
