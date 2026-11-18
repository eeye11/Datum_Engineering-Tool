/* eslint-disable no-console */
/*
 * ========================================================
 * THE SKETCH REVISION - MATHEMATICAL RECONSTRUCTION AND REAL CONSTRAINTS
 * ========================================================
 *
 * The acceptance list from the brief, as tests that ask the GEOMETRY rather
 * than the interface:
 *
 *   correction   line, circle, arc, general curve, mixed stroke, jitter,
 *                corners, trend, concavity, turning and inflection points,
 *                and non-function geometry left alone
 *   points       associated anchors, geometry outside them, centres, conflicts
 *   snapping     intersections, all three midpoint kinds, independent
 *                switches, hidden grid, stored values
 *   bounds       automatic from the real geometry, fixed untouched, negative
 *                and decimal coordinates
 *   document     association recorded on both sides, deletion semantics
 */

const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}${detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ""}`,
    );
  }
}

const root = path.join(__dirname, "..");
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

/* A hand: two incommensurate waves, faded in and out at the ends. */
const tremor = (index, amount = 0.04) =>
  Math.sin(index * 2.7) * amount + Math.cos(index * 5.1) * amount * 0.6;

const wobble = (index, amount) => tremor(index, amount);

/* A rough line from one point to another. */
function shakyLine(from, to, steps = 60, amount = 0.06) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;

    return {
      x: from.x + (to.x - from.x) * t + wobble(index, amount * 0.4),
      y: from.y + (to.y - from.y) * t + wobble(index + 5, amount),
    };
  });
}

(async () => {
  const C = await load("src/shared/sketch/sketch-correction.js");
  const T = await load("src/shared/sketch/sketch-curve-analysis.js");
  const D = await load("src/shared/sketch/sketch-document.js");
  const P = await load("src/shared/sketch/sketch-points.js");
  const G = await load("src/shared/sketch/sketch-grid.js");
  const V = await load("src/shared/sketch/sketch-viewport.js");
  const S = await load("src/shared/sketch/sketch-source.js");
  const M = await load("src/shared/sketch/sketch-migrate.js");

  /* ============================================================ correction */
  console.log("\n1-11. Curve reconstruction");
  console.log("---------------------------");

  /* 1. an approximate straight line becomes exact line geometry */
  const rough = shakyLine({ x: -4, y: 1 }, { x: 4, y: 1 });

  const line = C.correctStroke(rough);

  check(
    "a rough straight line becomes a line",
    line.correction.kind === "line",
    line.correction.kind,
  );
  check(
    "with exactly two points",
    line.points.length === 2,
    line.points.length,
  );
  check(
    "lying flat: the tremor is gone",
    Math.abs(line.points[0].y - line.points[1].y) < 1e-9,
    line.points,
  );

  /* 2. a rough circle becomes a true mathematical circle */
  const roughCircle = Array.from({ length: 70 }, (_, index) => {
    const angle = (index / 69) * Math.PI * 2;

    return {
      x: 3 + 5 * Math.cos(angle) + wobble(index, 0.08),
      y: -2 + 5 * Math.sin(angle) + wobble(index + 3, 0.08),
    };
  });

  const circle = C.correctStroke(roughCircle);

  check(
    "a rough circle becomes a circle",
    circle.correction.kind === "circle",
    circle.correction.kind,
  );
  check(
    "with the radius that was drawn",
    Math.abs(circle.correction.radius - 5) < 0.25,
    circle.correction.radius,
  );
  check(
    "and every point the same distance from the centre",
    Math.max(
      ...circle.points.map((point) =>
        Math.abs(
          Math.hypot(
            point.x - circle.correction.centre.x,
            point.y - circle.correction.centre.y,
          ) - circle.correction.radius,
        ),
      ),
    ) < 1e-9,
  );

  /* 3. an open circular stroke becomes an arc */
  const openArc = Array.from({ length: 45 }, (_, index) => {
    const angle = (index / 44) * Math.PI;

    return {
      x: 5 * Math.cos(angle) + wobble(index, 0.03),
      y: 5 * Math.sin(angle) + wobble(index + 2, 0.03),
    };
  });

  const arc = C.correctStroke(openArc);

  check(
    "an open circular stroke becomes an arc",
    arc.correction.kind === "arc",
    arc.correction.kind,
  );
  check(
    "with centre, radius and both angles",
    Boolean(arc.correction.centre) &&
      Number.isFinite(arc.correction.radius) &&
      Number.isFinite(arc.correction.startAngle) &&
      Number.isFinite(arc.correction.endAngle),
  );

  /* 4. a general curve becomes a clean mathematical curve */
  const roughCurve = Array.from({ length: 60 }, (_, index) => {
    const t = index / 59;

    return { x: t * 10, y: Math.sin(t * Math.PI) * 4 + wobble(index, 0.04) };
  });

  const curve = C.correctStroke(roughCurve);

  check(
    "a general stroke becomes a curve",
    curve.correction.kind === "curve",
    curve.correction.kind,
  );
  check(
    "represented by cubic Bezier segments",
    curve.segments.length > 0 &&
      curve.segments.every((segment) => segment.control1 && segment.control2),
    curve.segments.length,
  );
  check(
    "and it is a HANDFUL of vertices, not the samples",
    curve.points.length < 25,
    curve.points.length,
  );
  check(
    "every segment starts where the last one ended",
    curve.segments.every(
      (segment, index) =>
        index === 0 ||
        Math.hypot(
          segment.from.x - curve.segments[index - 1].to.x,
          segment.from.y - curve.segments[index - 1].to.y,
        ) < 1e-9,
    ),
  );

  /* 5. mixed straight and curved portions are segmented */
  const mixed = [
    ...Array.from({ length: 15 }, (_, index) => ({ x: index * 0.3, y: 0 })),
    ...Array.from({ length: 22 }, (_, index) => {
      const t = index / 21;

      return { x: 4.5 + t * 3, y: Math.sin(t * Math.PI) * 2 };
    }),
    ...Array.from({ length: 15 }, (_, index) => ({
      x: 7.5 + index * 0.3,
      y: 0,
    })),
  ];

  const mixedResult = C.correctStroke(mixed);

  check(
    "a mixed stroke is segmented",
    mixedResult.correction.kind === "composite" &&
      mixedResult.correction.parts.includes("line") &&
      mixedResult.correction.parts.includes("curve"),
    mixedResult.correction.parts,
  );

  /* 6. accidental jitter is removed, 7. meaningful corners stay */
  const wiggly = Array.from({ length: 80 }, (_, index) => {
    const t = index / 79;

    return {
      x: t * 10,
      y: 2 * Math.sin(t * Math.PI * 1.2) + wobble(index, 0.22),
    };
  });

  const cleaned = C.correctStroke(wiggly);

  const turning = (points) => {
    let total = 0;

    for (let index = 2; index < points.length; index += 1) {
      const a = Math.atan2(
        points[index - 1].y - points[index - 2].y,
        points[index - 1].x - points[index - 2].x,
      );
      const b = Math.atan2(
        points[index].y - points[index - 1].y,
        points[index].x - points[index - 1].x,
      );

      let gap = Math.abs(b - a);

      if (gap > Math.PI) gap = Math.PI * 2 - gap;

      total += gap;
    }

    return total;
  };

  check(
    "jitter is removed: the result turns far less than the ink",
    turning(cleaned.points) < turning(wiggly) * 0.5,
    { before: turning(wiggly), after: turning(cleaned.points) },
  );

  const cornered = [
    ...Array.from({ length: 25 }, (_, index) => ({
      x: -3 + index * 0.12,
      y: 0,
    })),
    ...Array.from({ length: 25 }, (_, index) => ({ x: 0, y: index * 0.12 })),
  ];

  const corneredResult = C.correctStroke(cornered);

  check(
    "a genuine corner survives as a vertex",
    corneredResult.points.some((point) => Math.hypot(point.x, point.y) < 0.2),
    corneredResult.points.slice(0, 3),
  );

  /* 8-10. trend, concavity, turning and inflection points */
  const hump = T.analyseTrend(roughCurve);

  check(
    "the curve's trend is increasing then decreasing",
    hump.trends.join(",") === "increasing,decreasing",
    hump.trends,
  );
  check(
    "its concavity is downward",
    hump.concavities.join(",") === "down",
    hump.concavities,
  );
  check(
    "and one turning point is found, near the top",
    hump.turnings.length === 1 && Math.abs(hump.turnings[0].x - 5) < 1.5,
    hump.turnings,
  );

  const sCurve = Array.from({ length: 70 }, (_, index) => {
    const t = index / 69;

    return {
      x: t * 10,
      y: Math.sin(t * Math.PI * 2) * 3 + wobble(index, 0.03),
    };
  });

  const sAnalysis = T.analyseTrend(sCurve);

  check(
    "an S-curve has an inflection point",
    sAnalysis.inflections.length >= 1,
    sAnalysis.inflections,
  );
  check(
    "and at least one turning point",
    sAnalysis.turnings.length >= 1,
    sAnalysis.turnings,
  );

  const falling = T.analyseTrend(
    Array.from({ length: 40 }, (_, index) => {
      const t = index / 39;

      return { x: t * 10, y: 6 - t * t * 4 };
    }),
  );

  check(
    "a falling curve is decreasing",
    falling.trends.join(",") === "decreasing",
    falling.trends,
  );
  check(
    "and concave downward",
    falling.concavities.join(",") === "down",
    falling.concavities,
  );

  /* 11. non-function geometry is not forced into a trend */
  check(
    "a circle is not classified as increasing or decreasing",
    T.analyseElementTrend({ kind: "circle", centre: { x: 0, y: 0 }, radius: 5 })
      .applicable === false,
  );
  check(
    "and neither is an arc",
    T.analyseElementTrend({ kind: "arc", centre: { x: 0, y: 0 }, radius: 5 })
      .applicable === false,
  );

  const vertical = T.analyseTrend([
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 1, y: 3 },
  ]);

  check(
    "a vertical curve is not a function of x",
    vertical.applicable === false,
    vertical.summary,
  );

  const loop = T.analyseTrend(
    Array.from({ length: 40 }, (_, index) => {
      const angle = (index / 39) * Math.PI * 1.6;

      return { x: 2 + 2 * Math.cos(angle), y: 2 * Math.sin(angle) };
    }),
  );

  check(
    "a looping curve is not given one monotonic label",
    loop.applicable === false,
    loop.summary,
  );

  /* ============================================================ points */
  console.log("\n12-18. Point constraints and unrestricted drawing");
  console.log("-------------------------------------------------");

  let document_ = D.createSketchDocument();

  /*
   * THE POINTS ARE ADDED ONE AFTER ANOTHER. Each `addPoint` returns the new
   * document beside the point, so the second add must start from the FIRST
   * one's document - otherwise the first point is never in the sketch, and a
   * constraint that is not in the sketch cannot be honoured.
   */
  const through = [];

  [{ x: 1, y: 3 }, { x: 5, y: 2 }].forEach((point) => {
    const added = D.addPoint(document_, { type: "anchor", ...point });

    document_ = added.document;

    through.push(added);
  });

  const strokeThrough = Array.from({ length: 90 }, (_, index) => {
    const t = index / 89;

    return { x: -2 + t * 12, y: 3 * Math.sin(t * Math.PI) + 0.5 };
  });

  /*
   * THE POINTS ARE ASSOCIATED WITH THE STROKE THE CANVAS WOULD CREATE - an
   * association that names no geometry yet is still an association, and
   * `anchorsFor` honours it.
   */
  const constrained = C.correctStroke(strokeThrough, {
    points: document_.points,
    geometryId: "stroke-1",
    association: through.map((entry) => entry.point.id),
  });

  /*
   * THE CURVE PASSES THROUGH ITS ANCHORS EXACTLY - travelling through them, not
   * merely reaching them: the anchors are vertices of the chain, so the ink
   * goes in one side and out the other.
   */
  /*
   * A PINNED ANCHOR IS A VERTEX OF THE CHAIN - five decimal places, because the
   * point is put where the stroke comes nearest and then held exactly.
   */
  const passesThrough = (point) =>
    constrained.points.some(
      (vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) < 1e-5,
    );

  /*
   * THE SECOND ANCHOR IS IN THE, AND ONLY THE, PLACE AT WHICH THE CHAIN ENDS -
   * a copy of the point that the stroke itself does not reach is not a curve
   * through it. The point is added to the chain at its nearest sample, so the
   * anchor is an exact vertex wherever the ink was.
   */
  check(
    "a curve passes through every associated point exactly",
    passesThrough(through[0].point) && passesThrough(through[1].point),
    constrained.points,
  );

  check(
    "and the geometry before the first and after the last point is kept",
    constrained.points[0].x < through[0].point.x - 1 &&
      constrained.points[constrained.points.length - 1].x >
        through[1].point.x + 1,
    [constrained.points[0], constrained.points[constrained.points.length - 1]],
  );

  /* An unrelated point is NOT a constraint. */
  let unrelated = D.createSketchDocument();
  const far = D.addPoint(unrelated, { type: "anchor", x: 500, y: 500 });

  unrelated = far.document;

  const untouched = C.correctStroke(strokeThrough, {
    points: unrelated.points,
  });

  check(
    "an unrelated point does not drag the stroke",
    Math.max(...untouched.points.map((point) => point.x)) < 11,
    Math.max(...untouched.points.map((point) => point.x)),
  );

  /*
   * AN ASSOCIATION NAMES A REAL ELEMENT. Recorded against an id that no element
   * has, it would be a constraint on nothing - so a geometry is added first,
   * and the association is made against ITS id.
   */
  document_ = D.addGeometry(document_, {
    kind: "curve",
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
    ],
  });

  const associatedId = document_.geometry[0].id;

  document_ = D.associatePointWithGeometry(document_, through[0].point.id, associatedId, "path");

  check(
    "an association is recorded on the point AND kept by the document",
    document_.points.find((point) => point.id === through[0].point.id).geometryId ===
      associatedId,
    document_.points.map((point) => [point.name, point.geometryId]),
  );

  /* 16. a point used as a circle's centre */
  const aroundCentre = Array.from({ length: 70 }, (_, index) => {
    const angle = (index / 69) * Math.PI * 2;

    return {
      x: 2 + 3 * Math.cos(angle) + wobble(index, 0.05),
      y: 1 + 3 * Math.sin(angle) + wobble(index, 0.05),
    };
  });

  const centred = C.correctStroke(aroundCentre, {
    centre: { x: 2, y: 1, id: "c1" },
  });

  check(
    "a stroke around a chosen centre becomes a circle",
    centred.correction.kind === "circle",
    centred.correction.kind,
  );
  check(
    "with EXACTLY that centre",
    centred.correction.centre.x === 2 && centred.correction.centre.y === 1,
    centred.correction.centre,
  );
  check(
    "and no point on the circumference AT the centre",
    centred.points.every((point) => Math.hypot(point.x - 2, point.y - 1) > 2.9),
  );

  /* 17. a point used as an arc's centre */
  const arcAround = Array.from({ length: 40 }, (_, index) => {
    const angle = -0.6 + (index / 39) * 1.8;

    return { x: 2 + 3 * Math.cos(angle), y: 1 + 3 * Math.sin(angle) };
  });

  const arcCentred = C.correctStroke(arcAround, {
    centre: { x: 2, y: 1, id: "c2" },
  });

  check(
    "a stroke around a chosen centre becomes an arc",
    arcCentred.correction.kind === "arc",
    arcCentred.correction.kind,
  );
  check(
    "with that centre and the drawn radius",
    arcCentred.correction.centre.x === 2 &&
      Math.abs(arcCentred.correction.radius - 3) < 0.05,
    arcCentred.correction,
  );
  check(
    "and an angular extent that matches the ink",
    Math.abs(
      arcCentred.correction.endAngle - arcCentred.correction.startAngle - 1.8,
    ) < 0.2,
    arcCentred.correction,
  );

  /* 18. incompatible constraints never move a fixed point */
  let conflictDoc = D.createSketchDocument();

  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ].forEach((point) => {
    const added = D.addPoint(conflictDoc, { type: "anchor", ...point });

    conflictDoc = added.document;
  });

  const circleForConflict = Array.from({ length: 60 }, (_, index) => ({
    x: 5 + 5 * Math.cos((index / 59) * Math.PI * 2),
    y: 5 + 5 * Math.sin((index / 59) * Math.PI * 2),
  }));

  const conflicted = C.correctStroke(circleForConflict, {
    points: conflictDoc.points,
  });

  check(
    "three points the circle cannot pass through are reported",
    Boolean(conflicted.conflict) && conflicted.conflict.severity === "error",
    conflicted.conflict,
  );
  check(
    "and none of them was moved",
    conflictDoc.points.every(
      (point) =>
        (point.x === 0 || point.x === 10) && (point.y === 0 || point.y === 10),
    ),
    conflictDoc.points.map((point) => [point.x, point.y]),
  );

  void document_;

  /* ============================================================ snapping */
  console.log("\n19-22. Grid snapping");
  console.log("--------------------");

  const grid = G.normaliseGrid({ majorX: 1, majorY: 1 });
  const viewport = V.createViewport({
    bounds: { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
    width: 800,
    height: 480,
  });

  const snapAt = (model, extra = {}) =>
    G.snapPoint(model, { grid: { ...grid, ...extra }, viewport });

  check(
    "a click near an intersection snaps to it",
    snapAt({ x: 1.04, y: 2.97 }).x === 1 &&
      snapAt({ x: 1.04, y: 2.97 }).kind === "grid",
    snapAt({ x: 1.04, y: 2.97 }),
  );
  check(
    "a horizontal midpoint snaps halfway across a cell",
    snapAt({ x: 1.46, y: 2.03 }).x === 1.5,
    snapAt({ x: 1.46, y: 2.03 }),
  );
  check(
    "a vertical midpoint snaps halfway up a cell",
    snapAt({ x: 1.03, y: 2.47 }).y === 2.5,
    snapAt({ x: 1.03, y: 2.47 }),
  );
  check(
    "a cell centre snaps to the middle of both",
    (() => {
      const at = snapAt({ x: 1.48, y: 2.52 });

      return at.x === 1.5 && at.y === 2.5;
    })(),
    snapAt({ x: 1.48, y: 2.52 }),
  );
  check(
    "midpoints can be switched off independently",
    snapAt({ x: 1.46, y: 2.03 }, { snapToGridMidpoints: false }).kind !==
      "midpoint",
    snapAt({ x: 1.46, y: 2.03 }, { snapToGridMidpoints: false }),
  );
  check(
    "intersections can be switched off independently",
    (() => {
      const at = snapAt({ x: 1.04, y: 2.97 }, { snapToGrid: false });

      return at.kind !== "grid";
    })(),
    snapAt({ x: 1.04, y: 2.97 }, { snapToGrid: false }),
  );
  check(
    "a hidden grid still snaps",
    snapAt({ x: 1.04, y: 2.97 }, { showMajorGrid: false, showMinorGrid: false })
      .snapped === true,
  );
  /*
   * THE STORED VALUE IS THE SNAPPED VALUE - "0.3", not 0.30000000000000004.
   */
  const nearCorner = snapAt({ x: 0.13, y: 2.92 });

  check(
    "the snapped value is the STORED value, cleaned of floating-point dust",
    nearCorner.x === 0 && nearCorner.y === 3 && String(nearCorner.x) === "0",
    nearCorner,
  );

  /*
   * A STEP THAT IS NOT A ROUND NUMBER IS STILL CLEAN. A 0.2-unit grid produces
   * 0.6000000000000001 in floating point; the stored value is the 0.6 the
   * student sees.
   */
  /*
   * THE INTERVAL IS PASSED IN, as the canvas passes the one it draws - a grid
   * finer than the view can hold four cells of is replaced by a nicer step, and
   * the test is about the STORED VALUE, not that adaptation.
   */
  const odd = G.snapPoint(
    { x: 0.6001, y: 0.2001 },
    {
      grid: G.normaliseGrid({ majorX: 0.2, majorY: 0.2 }),
      interval: { x: 0.2, y: 0.2 },
      viewport,
    },
  );

  check(
    "and a non-round intersection is stored as the clean number",
    odd.kind === "grid" && odd.x === 0.6 && odd.y === 0.2,
    odd,
  );

  /*
   * A CLICK EXACTLY BETWEEN A CORNER AND A CELL CENTRE GOES TO THE CORNER.
   * (1.75, 2.75) is as far from the corner (2, 3) as from the (1.5, 2.5)
   * centre - a true halfway point, so the rank has to decide it.
   */
  const tie = snapAt({ x: 1.75, y: 2.75 });

  check(
    "a tie between an intersection and a midpoint goes to the intersection",
    tie.kind === "grid",
    tie,
  );

  /* ============================================================ bounds */
  console.log("\n23-26. Coordinates and automatic bounds");
  console.log("---------------------------------------");

  let boundsDoc = D.createSketchDocument();

  const negative = D.addPoint(boundsDoc, { type: "anchor", x: -7.25, y: 9.5 });

  boundsDoc = negative.document;

  check(
    "negative and decimal coordinates are stored exactly",
    boundsDoc.points[0].x === -7.25 && boundsDoc.points[0].y === 9.5,
    boundsDoc.points[0],
  );

  const extent = T.elementExtent({
    kind: "circle",
    centre: { x: 0, y: 0 },
    radius: 5,
  });

  check(
    "a circle's extent is its true extremes",
    extent.some((point) => point.x === -5) &&
      extent.some((point) => point.y === 5),
    extent,
  );

  const cubic = T.elementExtent({
    kind: "curve",
    segments: [
      {
        from: { x: 0, y: 0 },
        control1: { x: 0, y: 10 },
        control2: { x: 10, y: 10 },
        to: { x: 10, y: 0 },
      },
    ],
  });

  check(
    "a cubic's extent is its exact peak, not its control points",
    (() => {
      const peak = Math.max(...cubic.map((point) => point.y));

      return peak > 7 && peak < 10;
    })(),
    cubic,
  );

  const autoBounds = V.boundsOfPoints(
    [
      { x: -3, y: 2 },
      { x: 8, y: -4 },
    ],
    { margin: 0 },
  );

  check(
    "automatic bounds are the geometry's own min and max",
    autoBounds.xMin === -3 && autoBounds.xMax === 8 && autoBounds.yMin === -4,
    autoBounds,
  );

  check(
    "a fixed bound survives untouched by a refit",
    (() => {
      const fixed = D.setBounds(
        boundsDoc,
        { xMin: -100, xMax: 100, yMin: -50, yMax: 50 },
        "manual",
      );

      return (
        fixed.boundsMode === "manual" &&
        fixed.bounds.xMin === -100 &&
        fixed.points[0].x === -7.25
      );
    })(),
  );

  /* ============================================================ source */
  console.log("\n27-31. Document, association and source");
  console.log("----------------------------------------");

  const anchor = D.addPoint(D.createSketchDocument(), { type: "anchor", x: 1, y: 1 });

  let assoc = anchor.document;

  assoc = D.addGeometry(assoc, {
    kind: "curve",
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ],
    anchors: [anchor.point.id],
  });

  check(
    "the geometry records the anchor it passes through",
    assoc.geometry[0].anchors.includes(anchor.point.id),
    assoc.geometry[0].anchors,
  );
  check(
    "and the anchor records the geometry",
    assoc.points.find((point) => point.id === anchor.point.id).geometryId ===
      assoc.geometry[0].id,
  );

  const released = D.disassociatePoint(assoc, anchor.point.id);

  check(
    "releasing keeps the point's exact coordinates",
    released.points.find((point) => point.id === anchor.point.id).x === 1 &&
      released.points.find((point) => point.id === anchor.point.id)
        .geometryId === null,
  );

  /* A circle's centre point is stored on the element. */
  let centredDoc = D.createSketchDocument();
  const centreAnchor = D.addPoint(centredDoc, { type: "anchor", x: 4, y: 4 });

  centredDoc = centreAnchor.document;

  centredDoc = D.addGeometry(centredDoc, {
    kind: "circle",
    centre: { x: 4, y: 4 },
    radius: 2,
  });

  const circleId = centredDoc.geometry[0].id;

  centredDoc = D.associatePointWithGeometry(
    centredDoc,
    centreAnchor.point.id,
    circleId,
    "centre",
  );

  check(
    "a centre association is recorded on the element",
    centredDoc.geometry[0].centrePointId === centreAnchor.point.id,
  );
  check(
    "with the exact centre coordinates",
    centredDoc.geometry[0].centre.x === 4 &&
      centredDoc.geometry[0].centre.y === 4,
    centredDoc.geometry[0].centre,
  );
  check(
    "and the point's role is centre, not path",
    centredDoc.points.find((point) => point.id === centreAnchor.point.id)
      .role === "centre",
  );

  check(
    "the circle's source is a circle, not a polyline",
    /circle\[radius=2\]/.test(
      S.generateSource(centredDoc, { include: {} }).source,
    ),
  );

  /* ---- migration ---- */
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
        influence: 0.5,
      },
    ],
    geometry: [{ id: "e1", kind: "circle", points: [], guides: ["g1"] }],
  });

  check(
    "a saved shape guide is removed",
    legacy.document.points.every((point) => point.type !== "guide"),
    legacy.document.points,
  );
  check(
    "and no guide influence survives",
    legacy.document.points.every((point) => !("influence" in point)),
    legacy.document.points,
  );
  check(
    "and no geometry lists a guide",
    legacy.document.geometry.every((element) => !("guides" in element)),
    legacy.document.geometry,
  );
  check(
    "the migration reports what it did",
    legacy.changes.length >= 1,
    legacy.changes,
  );

  /* ============================================================ points model */
  console.log("\nThe point model");
  console.log("---------------");

  check(
    "an anchor is the only user point type",
    JSON.stringify(P.USER_POINT_TYPES) === JSON.stringify(["anchor"]),
    P.USER_POINT_TYPES,
  );
  check(
    "a guide cannot be created",
    (() => {
      try {
        P.makePoint({ type: "guide" });
        return false;
      } catch (error) {
        return true;
      }
    })(),
  );
  check(
    "an anchor carries a role, defaulting to path",
    P.makePoint({ type: "anchor" }).role === "path",
  );
  check(
    "and can be a centre",
    P.makePoint({ type: "anchor", role: "centre" }).role === "centre",
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
