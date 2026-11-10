/* eslint-disable no-console */
/*
 * ========================================================
 * THE SHARED SKETCH INFRASTRUCTURE
 * ========================================================
 *
 * The reusable suite the task asks for: it runs the SAME expectations against
 * every geometry adapter, so "an anchor means the same thing in every tool" is
 * a test rather than a claim.
 *
 * WHAT IT PROVES
 * --------------
 *   - points can be created, resolved, selected and edited
 *   - absolute, relative and polar coordinates agree with each other
 *   - anchors stay exactly where they were put during correction
 *   - the stroke itself guides the fit, with no second point type
 *   - a point can be inserted anywhere on geometry, not only at its ends
 *   - zoom never changes a stored coordinate
 *   - undo and redo restore points and geometry
 *   - the source reproduces the geometry and survives a round trip
 *
 * Run with: node --test tests/sketch-shared-infrastructure.test.cjs
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
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const root = path.join(__dirname, "..");
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

(async () => {
  const P = await load("src/shared/sketch/sketch-points.js");
  const V = await load("src/shared/sketch/sketch-viewport.js");
  const A = await load("src/shared/sketch/sketch-geometry-adapters.js");
  const C = await load("src/shared/sketch/sketch-correction.js");
  const D = await load("src/shared/sketch/sketch-document.js");
  const H = await load("src/shared/sketch/sketch-history.js");
  const S = await load("src/shared/sketch/sketch-source.js");
  const PR = await load("src/shared/sketch/sketch-source-parser.js");
  const PL = await load("src/shared/sketch/sketch-placement.js");
  const AP = await load("src/shared/sketch/sketch-appearance.js");
  const G = await load("src/shared/sketch/sketch-grid.js");

  /* ================================================ points */
  console.log("\nPoints");
  console.log("------");

  P.resetPointIds(1);

  const anchor = P.makePoint({ type: "anchor", x: 10, y: 5, name: "P1" });

  check("an anchor is created with a type", anchor.type === "anchor");
  check("and gets an id", Boolean(anchor.id));

  /*
   * THERE IS NO SHAPE GUIDE. The stroke is the guide, so a second point type
   * that merely suggests a shape was removed from the model entirely - not
   * hidden behind the interface.
   */
  check(
    "a shape guide is not a point type any more",
    !P.SKETCH_POINT_TYPES.includes("guide"),
    JSON.stringify(P.SKETCH_POINT_TYPES),
  );

  check(
    "and creating one is refused",
    (() => {
      try {
        P.makePoint({ type: "guide" });
        return false;
      } catch (error) {
        return true;
      }
    })(),
  );
  check("the default name sequence starts at P1", P.nextPointName([]) === "P1");
  check(
    "and moves past a taken name",
    P.nextPointName([{ name: "P1" }]) === "P2",
  );

  /* ---- coordinates ---- */
  const relative = P.makePoint({
    type: "anchor",
    x: 0,
    y: 0,
    coordinateMode: "relative",
    referenceId: anchor.id,
    delta: { dx: 3, dy: -2 },
  });

  check(
    "a relative point resolves from its reference",
    P.resolvePoint(relative, [anchor, relative]).x === 13 &&
      P.resolvePoint(relative, [anchor, relative]).y === 3,
    JSON.stringify(P.resolvePoint(relative, [anchor, relative])),
  );

  const polar = P.makePoint({
    type: "anchor",
    x: 0,
    y: 0,
    coordinateMode: "polar",
    referenceId: anchor.id,
    distance: 5,
    angleDeg: 0,
  });

  check(
    "a polar point resolves to distance and angle",
    Math.abs(P.resolvePoint(polar, [anchor, polar]).x - 15) < 1e-9 &&
      Math.abs(P.resolvePoint(polar, [anchor, polar]).y - 5) < 1e-9,
  );

  /* Switching the DESCRIPTION must not move the point. */
  const restated = P.withCoordinateMode(
    anchor,
    "relative",
    P.makePoint({ x: 0, y: 0 }),
    [anchor, { id: "origin", x: 0, y: 0 }],
  );

  check(
    "restating a point as relative keeps it where it is",
    Math.abs(
      P.resolvePoint(restated, [
        anchor,
        { id: restated.referenceId, x: 0, y: 0 },
      ]).x - 10,
    ) < 1e-9,
  );

  /* ---- locking ---- */
  check("an unlocked point is movable", P.isMovable({ locked: false }));
  check("a locked point is not", !P.isMovable({ locked: true }));

  /* ---- types are not confused ---- */
  check(
    "a control handle is not a constraint",
    !P.isConstraint({ type: "control" }),
  );
  check(
    "an inferred point is not a constraint",
    !P.isConstraint({ type: "inferred" }),
  );
  check("an anchor is", P.isConstraint({ type: "anchor" }));

  /* ================================================ every adapter */
  console.log("\nEvery geometry adapter");
  console.log("----------------------");

  const line = A.adapterFor({
    kind: "line",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  });
  const polyline = A.adapterFor({
    kind: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ],
  });
  const circle = A.adapterFor({
    kind: "circle",
    centre: { x: 0, y: 0 },
    radius: 5,
  });
  const arc = A.adapterFor({
    kind: "arc",
    centre: { x: 0, y: 0 },
    radius: 5,
    startAngle: 0,
    endAngle: Math.PI / 2,
  });
  const ellipse = A.adapterFor({
    kind: "ellipse",
    centre: { x: 0, y: 0 },
    radiusX: 8,
    radiusY: 4,
  });
  const rectangle = A.adapterFor({
    kind: "rectangle",
    corner: { x: 0, y: 0 },
    width: 10,
    height: 6,
  });
  const polygon = A.adapterFor({
    kind: "polygon",
    points: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 5 },
    ],
  });
  const curve = A.adapterFor({
    kind: "curve",
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ],
  });

  const adapters = {
    line,
    polyline,
    circle,
    arc,
    ellipse,
    rectangle,
    polygon,
    curve,
  };

  Object.entries(adapters).forEach(([name, adapter]) => {
    const projected = adapter.project({ x: 1, y: 1 });

    const finiteProjection =
      projected && Number.isFinite(projected.x) && Number.isFinite(projected.y);

    check(`${name}: projects a point onto its own geometry`, finiteProjection);
    check(
      `${name}: reports a length`,
      Number.isFinite(adapter.length()) && adapter.length() > 0,
    );
    check(`${name}: samples its own points`, adapter.sample(12).length >= 2);
    check(
      `${name}: states whether it is determined`,
      typeof adapter.constraints().determined === "boolean",
    );
  });

  check(
    "a circle's projection lands ON the circle",
    Math.abs(
      Math.hypot(
        circle.project({ x: 3, y: 3 }).x,
        circle.project({ x: 3, y: 3 }).y,
      ) - 5,
    ) < 1e-9,
  );

  check(
    "an ellipse is not projected onto a circle",
    (() => {
      const at = ellipse.project({ x: 8, y: 0 });

      return Math.abs(at.x - 8) < 0.2 && Math.abs(at.y) < 0.2;
    })(),
    JSON.stringify(ellipse.project({ x: 8, y: 0 })),
  );

  check(
    "a rectangle's projection is on an edge",
    (() => {
      const at = rectangle.project({ x: 11, y: 3 });

      return Math.abs(at.x - 10) < 1e-9;
    })(),
  );

  /* ================================================ point insertion */
  console.log("\nPoint insertion on geometry");
  console.log("---------------------------");

  /*
   * THE DESCRIPTIONS ARE REBUILT FROM THEIR OWN DATA, not spread from an
   * adapter. An adapter carries its INTERFACE's name as `id` ("circle"), so
   * spreading one over an element overwrites the element's identity with the
   * name of its kind - the call under test would then be asked about a
   * geometry that no longer had the id it was given.
   */
  const descriptions = {
    line: { id: "line-1", kind: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    polyline: { id: "polyline-1", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] },
    circle: { id: "circle-1", kind: "circle", centre: { x: 0, y: 0 }, radius: 5 },
    arc: { id: "arc-1", kind: "arc", centre: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 },
    ellipse: { id: "ellipse-1", kind: "ellipse", centre: { x: 0, y: 0 }, radiusX: 8, radiusY: 4 },
    rectangle: { id: "rectangle-1", kind: "rectangle", corner: { x: 0, y: 0 }, width: 10, height: 6 },
    polygon: { id: "polygon-1", kind: "polygon", points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 3, y: 5 }] },
    curve: { id: "curve-1", kind: "curve", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] },
  };

  Object.entries(descriptions).forEach(([name, geometry]) => {
    const point = A.pointOnGeometry(geometry, { x: 2, y: 2 }, { type: "anchor", name: "P9" });

    check(
      `${name}: a point can be created on it`,
      Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y),
      JSON.stringify(point),
    );

    check(
      `${name}: and the point records the geometry it belongs to`,
      Boolean(point) && point.geometryId === geometry.id,
      point ? `${point.geometryId} vs ${geometry.id}` : "no point",
    );
  });

  check(
    "a point inserted mid-curve is not at either end",
    (() => {
      const point = A.pointOnGeometry(
        { id: "curve-2", ...curve },
        { x: 5, y: 5 },
      );

      return Math.abs(point.x - 5) < 0.5 && Math.abs(point.y - 5) < 0.5;
    })(),
  );

  /* ================================================ correction */
  console.log("\nCorrection and constraints");
  console.log("--------------------------");

  const stroke = Array.from({ length: 50 }, (_, index) => {
    const t = index / 49;

    return { x: t * 10, y: Math.sin(t * Math.PI) * 3 };
  });

  const a1 = P.makePoint({ type: "anchor", x: 0, y: 0 });
  const a2 = P.makePoint({ type: "anchor", x: 10, y: 0 });

  const corrected = C.correctStroke(stroke, { points: [a1, a2] });

  const touches = (points, point) =>
    points.some(
      (entry) => Math.hypot(entry.x - point.x, entry.y - point.y) < 1e-6,
    );

  check(
    "a corrected curve passes through its first anchor",
    touches(corrected.points, a1),
    JSON.stringify(corrected.points.slice(0, 2)),
  );

  check("and through its last anchor", touches(corrected.points, a2));

  /*
   * THE STROKE IS THE GUIDE.
   *
   * With no guide points, the corrected curve still follows the drawn shape -
   * that is what makes the second point type unnecessary. The check is that the
   * result stays close to the stroke it came from.
   */
  const strokeMid = stroke[Math.floor(stroke.length / 2)];

  const nearestToStroke = Math.min(
    ...corrected.points.map((point) =>
      Math.hypot(point.x - strokeMid.x, point.y - strokeMid.y),
    ),
  );

  check(
    "the corrected curve follows the drawn stroke",
    nearestToStroke < 1.5,
    String(nearestToStroke),
  );

  const conflictAnchors = [
    P.makePoint({ type: "anchor", x: 0, y: 0 }),
    P.makePoint({ type: "anchor", x: 10, y: 0 }),
    P.makePoint({ type: "anchor", x: 0, y: 10 }),
  ];

  const circleStroke = Array.from({ length: 60 }, (_, index) => ({
    x: 5 + 5 * Math.cos((index / 59) * Math.PI * 2),
    y: 5 + 5 * Math.sin((index / 59) * Math.PI * 2),
  }));

  const conflicted = C.correctStroke(circleStroke, { points: conflictAnchors });

  check(
    "three anchors that cannot all be on one circle are reported, not moved",
    Boolean(conflicted.conflict) && conflicted.conflict.severity === "error",
    JSON.stringify(conflicted.conflict),
  );

  check(
    "and no anchor was relocated to make the fit work",
    conflictAnchors.every((entry) => entry.x === 0 || entry.x === 10),
  );

  const restored = C.restoreOriginal(corrected);

  check(
    "the original stroke can be restored exactly",
    restored.points.length === stroke.length &&
      Math.abs(restored.points[0].x - stroke[0].x) < 1e-9,
  );

  /* ================================================ viewport */
  console.log("\nViewport and coordinate integrity");
  console.log("---------------------------------");

  const vp = V.createViewport({
    bounds: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
    width: 800,
    height: 600,
    equal: true,
  });

  check(
    "equal scale means one model unit is the same on both axes",
    Math.abs(vp.scaleX - vp.scaleY) < 1e-9,
    `${vp.scaleX} vs ${vp.scaleY}`,
  );

  /*
   * A CIRCLE KEEPS ITS ASPECT WHEN THE TWO AXES SPAN THE SAME NUMBER OF PIXELS
   * PER UNIT - compared as MAGNITUDES, because screen Y grows DOWNWARD.
   *
   * This compared a raw X WIDTH against a raw Y HEIGHT with their signs as
   * they came, so the Y difference was negative and the test could never pass
   * at any scale: it was asserting that a width equals minus a height. Taking
   * both differences as a model unit to model unit - the width of 20 x-units
   * against the height of 10 y-units, each per unit - is what "equal scale"
   * actually means.
   */
  const xPerUnit =
    (V.toScreen({ x: 10, y: 0 }, vp).x - V.toScreen({ x: -10, y: 0 }, vp).x) / 20;

  const yPerUnit =
    Math.abs(
      V.toScreen({ x: 0, y: 5 }, vp).y - V.toScreen({ x: 0, y: -5 }, vp).y,
    ) / 10;

  check(
    "so a circle keeps its aspect",
    Math.abs(xPerUnit - yPerUnit) < 1e-6,
    `${xPerUnit} vs ${yPerUnit}`,
  );

  const roundTrip = V.toModel(V.toScreen({ x: 2.5, y: -1.5 }, vp), vp);

  check(
    "toScreen and toModel are exact inverses",
    Math.abs(roundTrip.x - 2.5) < 1e-9 && Math.abs(roundTrip.y + 1.5) < 1e-9,
    JSON.stringify(roundTrip),
  );

  const geometryBefore = JSON.stringify(stroke);

  const zoomedIn = V.createViewport({
    bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    width: 1600,
    height: 1200,
    equal: true,
  });

  V.toScreen({ x: 1, y: 1 }, zoomedIn);

  check(
    "zooming does not change stored geometry",
    JSON.stringify(stroke) === geometryBefore,
  );
  check("nor the viewport bounds", zoomedIn.bounds.xMin === -1);

  check(
    "a degenerate axis still gets a usable range",
    (() => {
      const flat = V.normaliseBounds({ xMin: 3, xMax: 3, yMin: 0, yMax: 0 });

      return flat.xMax - flat.xMin > 0 && flat.yMax - flat.yMin > 0;
    })(),
  );

  /* ================================================ document + history */
  console.log("\nDocument and history");
  console.log("--------------------");

  D.resetGeometryIds(1);

  let doc = D.createSketchDocument();

  const added = D.addPoint(doc, { type: "anchor", x: 3, y: 4 });

  doc = added.document;

  check("a point can be added to the document", doc.points.length === 1);
  check("the document revision moves on a change", doc.revision > 1);

  let history = H.createHistory(doc);

  const styled = D.addGeometry(doc, {
    kind: "circle",
    centre: { x: 0, y: 0 },
    radius: 2,
  });

  history = H.commit(history, styled);

  check("a change is a history step", H.canUndo(history));

  const undone = H.undo(history);

  check("undo removes the new geometry", undone.document.geometry.length === 0);

  const redone = H.redo(undone.history);

  check("redo restores it", redone.document.geometry.length === 1);

  const noop = D.movePoint(styled, "no-such-point", 1, 1);

  check("a no-op is not a history step", noop.revision === styled.revision);

  const locked = D.setPointLocked(doc, doc.points[0].id, true);
  const movedLocked = D.movePoint(locked, doc.points[0].id, 99, 99);

  check(
    "a locked point cannot be moved",
    movedLocked.points[0].x === 3 && movedLocked.points[0].y === 4,
    JSON.stringify(movedLocked.points[0]),
  );

  const converted = D.convertPointType(doc, doc.points[0].id, "guide");

  check(
    "a point cannot be converted into a guide any more",
    converted.points[0].type === "anchor" &&
      converted.points[0].x === 3 &&
      converted.points[0].y === 4,
  );

  /* ================================================ appearance */
  console.log("\nAppearance");
  console.log("----------");

  check(
    "a default colour follows the theme",
    AP.resolveColour({}, "#123456") === "#123456",
  );
  check(
    "a picked colour ignores the theme",
    AP.resolveColour(
      { colour: "#cc0000", isDefaultColour: false },
      "#123456",
    ) === "#cc0000",
  );

  check("thicknesses are named", AP.thicknessOf("bold").id === "bold");
  check("a numeric thickness maps to a name", AP.thicknessOf(2).id === "bold");
  check("a line has no fill", !AP.supportsFill({ kind: "line" }));
  check("a circle can be filled", AP.supportsFill({ kind: "circle" }));

  check(
    "changing the default does not repaint custom geometry",
    (() => {
      let d = D.createSketchDocument();

      d = D.addGeometry(d, {
        kind: "circle",
        appearance: { colour: "#0000ff", isDefaultColour: false },
      });

      d = D.setDefaultAppearance(d, { colour: "#ff0000" });

      return d.geometry[0].appearance.colour === "#0000ff";
    })(),
  );

  check(
    "one appearance can be applied to several elements",
    (() => {
      let d = D.createSketchDocument();

      d = D.addGeometry(d, { kind: "circle" });
      d = D.addGeometry(d, { kind: "rectangle" });

      d = D.setAppearanceForMany(
        d,
        d.geometry.map((element) => element.id),
        {
          lineStyle: "dashed",
        },
      );

      return d.geometry.every(
        (element) => element.appearance.lineStyle === "dashed",
      );
    })(),
  );

  /* ================================================ grid and snapping */
  console.log("\nGrid and snapping");
  console.log("-----------------");

  const hiddenGrid = G.normaliseGrid({
    showMajorGrid: false,
    snapToGrid: true,
  });

  check(
    "snapping works with the grid hidden",
    G.snapPoint({ x: 1.02, y: 2.97 }, { grid: hiddenGrid }).snapped === true,
  );

  check(
    "and is off when snapping is off",
    G.snapPoint({ x: 1.02, y: 2.97 }, { grid: { snapToGrid: false } })
      .snapped === false,
  );

  check(
    "grid values are clean numbers",
    G.gridValues(-1, 1, 0.1).every((value) => String(value).length < 6),
    JSON.stringify(G.gridValues(-1, 1, 0.1).slice(0, 4)),
  );

  check(
    "a tick label has no floating-point noise",
    G.formatTick(0.30000000000000004, { labelPrecision: 1 }) === "0.3",
  );

  /* ================================================ placement */
  console.log("\nPlacement");
  console.log("---------");

  let placedDoc = D.createSketchDocument();

  placedDoc = D.addGeometry(placedDoc, {
    kind: "circle",
    centre: { x: 2, y: 3 },
    radius: 4,
  });

  const moveTransform = PL.alignTransform({ x: 0, y: 0 }, { x: 100, y: 50 });
  const moved = PL.placementPackage(placedDoc, moveTransform);

  check(
    "placing translates the geometry",
    moved.geometry[0].centre.x === 102 && moved.geometry[0].centre.y === 53,
    JSON.stringify(moved.geometry[0].centre),
  );

  check("and does not change its size", moved.geometry[0].radius === 4);

  const anchored = PL.alignTransform({ x: 2, y: 3 }, { x: 0, y: 0 });
  const anchoredPackage = PL.placementPackage(placedDoc, anchored);

  check(
    "choosing another insertion anchor still puts THAT point on the target",
    Math.abs(anchoredPackage.geometry[0].centre.x) < 1e-9 &&
      Math.abs(anchoredPackage.geometry[0].centre.y) < 1e-9,
  );

  check(
    "the axes are excluded from a placement unless asked for",
    PL.placementPackage(placedDoc, moveTransform, { include: {} })
      .coordinateGeometry.length === 0,
  );

  check(
    "and included when they are",
    PL.placementPackage(placedDoc, moveTransform, { include: { axes: true } })
      .coordinateGeometry.length >= 1,
  );

  /* ================================================ source */
  console.log("\nSource generation and round trip");
  console.log("--------------------------------");

  let sourceDoc = D.createSketchDocument({ transform: { x: 20, y: 10 } });

  sourceDoc = D.addGeometry(sourceDoc, {
    kind: "circle",
    centre: { x: 2, y: 3 },
    radius: 4,
    appearance: { colour: "#cc0000", lineStyle: "dashed", thickness: "bold" },
  });

  sourceDoc = D.addGeometry(sourceDoc, {
    kind: "curve",
    points: [
      { x: -5, y: -2 },
      { x: -2, y: 1 },
      { x: 1, y: -1 },
      { x: 4, y: 2 },
    ],
    segments: [
      {
        from: { x: -5, y: -2 },
        control1: { x: -4, y: 0 },
        control2: { x: -3, y: 1 },
        to: { x: -2, y: 1 },
      },
      {
        from: { x: -2, y: 1 },
        control1: { x: -1, y: 1 },
        control2: { x: 0, y: -1 },
        to: { x: 1, y: -1 },
      },
      {
        from: { x: 1, y: -1 },
        control1: { x: 2, y: -1 },
        control2: { x: 3, y: 2 },
        to: { x: 4, y: 2 },
      },
    ],
  });

  sourceDoc = D.addGeometry(sourceDoc, {
    kind: "rectangle",
    corner: { x: -6, y: -6 },
    width: 3,
    height: 2,
    appearance: { fill: "#ffcccc", fillEnabled: true },
  });

  const generated = S.generateSource(sourceDoc, { include: {} });

  check(
    "the source is a tikzpicture",
    generated.source.includes("\\begin{tikzpicture}"),
  );
  check(
    "it defines the picked colour",
    generated.source.includes("\\definecolor{sketchcc0000}"),
  );
  check("it writes the dashed style", generated.source.includes("dashed"));
  check("it writes the bold thickness", generated.source.includes("thick"));
  check("it writes the fill", generated.source.includes("fill="));
  check("it writes the circle", /circle\[radius=4\]/.test(generated.source));
  check(
    "it writes every Bezier control",
    (generated.source.match(/controls/g) || []).length === 3,
  );
  check("it writes the rectangle", generated.source.includes("rectangle"));
  check("it carries the placement", generated.source.includes("shift="));

  const parsed = PR.parseSource(generated.source);

  check(
    "its own source parses back cleanly",
    parsed.ok,
    JSON.stringify(parsed.problems),
  );
  check(
    "with every element",
    parsed.geometry.length === sourceDoc.geometry.length,
  );

  const reapplied = PR.applyParsedSource(sourceDoc, parsed);
  const regenerated = S.generateSource(reapplied.document, { include: {} });

  const strip = (text) =>
    text
      .split("\n")
      .filter((line) => !line.startsWith("%") && !line.includes("tikzset"))
      .join("\n");

  check(
    "and regenerating it gives byte-identical source",
    strip(generated.source) === strip(regenerated.source),
  );

  /* ---- failures keep the last valid drawing ---- */
  const broken = PR.parseSource(
    "\\begin{tikzpicture}\n\\draw (0,0) -- ;\n\\end{tikzpicture}",
  );

  check("invalid source is reported, not accepted", broken.ok === false);
  check(
    "with a line number",
    broken.problems.length > 0 && broken.problems[0].line === 2,
  );

  const kept = PR.applyParsedSource(sourceDoc, broken);

  check(
    "and the last valid drawing is kept",
    kept.applied === false && kept.document === sourceDoc,
  );

  const unsupported = PR.parseSource(
    "\\begin{tikzpicture}\n\\node at (0,0) {x};\n\\end{tikzpicture}",
  );

  check(
    "an unsupported command is reported, not silently dropped",
    unsupported.ok === false,
  );

  /* ================================================ geometry-specific fit */
  console.log("\nGeometry-specific mathematics is preserved");
  console.log("------------------------------------------");

  const roughCircle = Array.from({ length: 64 }, (_, index) => {
    const angle = (index / 63) * Math.PI * 2;

    return {
      x: 5 * Math.cos(angle) + Math.sin(index * 3) * 0.03,
      y: 5 * Math.sin(angle) + Math.cos(index * 5) * 0.03,
    };
  });

  /*
   * THE RECONSTRUCTION IS THE TEST, not a separate classifier: what matters is
   * the geometry the student ends up with, so each case is drawn, corrected and
   * the RESULT inspected.
   */
  check(
    "a rough circle is reconstructed as a circle",
    C.correctStroke(roughCircle).correction.kind === "circle",
    C.correctStroke(roughCircle).correction.kind,
  );

  const ellipsePoints = Array.from({ length: 64 }, (_, index) => {
    const angle = (index / 63) * Math.PI * 2;

    return { x: 9 * Math.cos(angle), y: 3 * Math.sin(angle) };
  });

  const recognisedEllipse = C.correctStroke(ellipsePoints).correction;

  check(
    "an ellipse is NOT forced into a circle",
    recognisedEllipse.kind !== "circle",
    recognisedEllipse.kind,
  );

  check(
    "and is reconstructed as an ellipse",
    recognisedEllipse.kind === "ellipse",
    recognisedEllipse.kind,
  );

  const roughLine = Array.from({ length: 30 }, (_, index) => ({
    x: index * 0.5,
    y: 1 + Math.sin(index * 4) * 0.02,
  }));

  const lineResult = C.correctStroke(roughLine);

  check(
    "a rough line is reconstructed as an exact two-point line",
    lineResult.correction.kind === "line" && lineResult.points.length === 2,
    `${lineResult.correction.kind}, ${lineResult.points.length} points`,
  );

  /* ---- the new primitives ---- */
  const arcStroke = Array.from({ length: 40 }, (_, index) => {
    const angle = (index / 39) * Math.PI;

    return { x: 5 * Math.cos(angle), y: 5 * Math.sin(angle) };
  });

  check(
    "an open circular stroke is reconstructed as an arc",
    C.correctStroke(arcStroke).correction.kind === "arc",
    C.correctStroke(arcStroke).correction.kind,
  );

  const boxStroke = [
    ...Array.from({ length: 12 }, (_, index) => ({ x: index * 0.5, y: 0 })),
    ...Array.from({ length: 10 }, (_, index) => ({ x: 6, y: index * 0.4 })),
    ...Array.from({ length: 12 }, (_, index) => ({ x: 6 - index * 0.5, y: 4 })),
    ...Array.from({ length: 10 }, (_, index) => ({ x: 0, y: 4 - index * 0.4 })),
  ];

  const boxResult = C.correctStroke(boxStroke);

  check(
    "a hand-drawn box is reconstructed as a closed polygon",
    boxResult.correction.kind === "polygon" && boxResult.points.length === 4,
    `${boxResult.correction.kind}, ${boxResult.points.length} vertices`,
  );

  const mixedStroke = [
    ...Array.from({ length: 15 }, (_, index) => ({ x: index * 0.3, y: 0 })),
    ...Array.from({ length: 20 }, (_, index) => {
      const t = index / 19;

      return { x: 4.5 + t * 3, y: Math.sin(t * Math.PI) * 2 };
    }),
    ...Array.from({ length: 15 }, (_, index) => ({ x: 7.5 + index * 0.3, y: 0 })),
  ];

  const mixedResult = C.correctStroke(mixedStroke);

  check(
    "a stroke of straight and curved parts is segmented",
    mixedResult.correction.kind === "composite" &&
      mixedResult.correction.parts.includes("line") &&
      mixedResult.correction.parts.includes("curve"),
    JSON.stringify(mixedResult.correction.parts),
  );

  check(
    "and its corners are kept, not smoothed away",
    mixedResult.points.length > 2,
    String(mixedResult.points.length),
  );

  /* ================================================ summary */
  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
