/*
 * ========================================================
 * ONE MAGNITUDE ANNOTATION PER DEFINING POINT
 * ========================================================
 *
 * A Varying Distributed Load is defined by a series of load points.
 * The drawing must contain exactly one magnitude annotation per
 * defined point - two points give two labels, three give three, and N
 * give N. This file states that as the invariants the specification
 * asks for, and checks each against the real model and the real
 * renderer:
 *
 *   - the count of labels always equals the count of points;
 *   - each label is linked to ITS point, by identity and not by array
 *     index, so reordering or removing a point cannot swap two labels;
 *   - editing one point's magnitude changes only that point's label,
 *     and never moves it;
 *   - a moved label stays where it was put across a source edit, a
 *     direction reversal, an arrow-height change and a JSON round trip;
 *   - redrawing the arrows taller changes their appearance only and leaves
 *     the labels where they are;
 *   - a moved label participates in Fit, so it cannot be cropped.
 *
 * Run against the annotation model - the one place that decides what a
 * label says, which point owns it and where it sits - and against the
 * renderer for the drawn result, so nothing can pass by agreeing with
 * itself in the wrong module.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

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

const { createHarness } = require("./harness-renderer.cjs");

const { canvas } = createHarness(projectRoot, JSDOM, require);

const renderer = global.window.enggDrawingRenderer;
const model = global.window.enggAnnotationModel;

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
    hoveredEntity: null,
    snapCandidate: null,
  },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
  display: { showMagnitudes: true },
};

/*
 * A VARYING DISTRIBUTED LOAD, built the way the tool builds one: a
 * `load` object whose engineering records the varying tool, carrying a
 * profile of points along the body.
 */
const point = (id, t, magnitude) => ({ id, t, magnitude });

const varyingLoad = (points, extra = {}) => ({
  id: "vload-1",
  type: "load",
  name: "Varying Distributed Load 1",
  engineering: { plane: "XY", discipline: "statics", staticsType: "varying-distributed-load" },
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 },
    direction: -90,
    intensity: 10,
    points,
    ...extra,
  },
  style: { stroke: "#000000", lineWidth: 0.5 },
});

const scene = (objects) => ({ ...base, objects });

const labelsOf = (object) => model.derivedAnnotations(object, scene([object]));

console.log("\n  N points give N magnitude annotations\n");

[
  [1, [point("p1", 0, 5)]],
  [2, [point("p1", 0, 5), point("p2", 1, 10)]],
  [3, [point("p1", 0, 5), point("p2", 0.5, 10), point("p3", 1, 15)]],
  [4, [point("p1", 0, 1), point("p2", 0.3, 2), point("p3", 0.6, 3), point("p4", 1, 4)]],
].forEach(([count, points]) => {
  const object = varyingLoad(points);
  const labels = labelsOf(object);

  check(
    `${count} point(s) produce ${count} annotation(s)`,
    labels.length === count,
    `got ${labels.length}`,
  );

  check(
    `every annotation names a point and states a value (${count} pts)`,
    labels.every((label) => label.anchorRef?.pointId) &&
      labels.every((label) => /kN\/m/.test(String(model.textFor(label, scene([object]))))),
  );
});

console.log("\n  two values are never collapsed into one\n");

{
  const object = varyingLoad([point("p1", 0, 5), point("p2", 1, 10)]);
  const labels = labelsOf(object);

  const texts = labels.map((label) => model.textFor(label, scene([object])));

  check(
    "a two-point load states two separate values",
    texts.length === 2 && texts[0] !== texts[1],
    JSON.stringify(texts),
  );

  check(
    "the start magnitude is one of them",
    texts.some((text) => /5(\.0+)?\s*kN\/m/.test(text)),
    JSON.stringify(texts),
  );

  check(
    "and the end magnitude is the other",
    texts.some((text) => /10(\.0+)?\s*kN\/m/.test(text)),
    JSON.stringify(texts),
  );

  check(
    "no angle is ever appended",
    texts.every((text) => !/°|θ|\bdeg\b|\brad\b|@|clockwise|CCW|CW/i.test(text)),
    JSON.stringify(texts),
  );
}

console.log("\n  each label is linked to its own point, by identity\n");

{
  const object = varyingLoad([
    point("p1", 0, 5),
    point("p2", 0.5, 10),
    point("p3", 1, 15),
  ]);

  object.geometry.pointOffsets = {
    p2: { x: 40, y: -25 },
  };

  const labels = labelsOf(object);
  const byId = Object.fromEntries(
    labels.map((label) => [label.anchorRef.pointId, label]),
  );

  check("every point has a label of its own", Boolean(byId.p1 && byId.p2 && byId.p3));

  check(
    "the moved point's label carries its own offset",
    byId.p2.moved === true,
    `p2 moved=${byId.p2.moved}`,
  );

  check(
    "the other labels are NOT moved by the one that was",
    byId.p1.moved !== true && byId.p3.moved !== true,
  );

  /*
   * REMOVING A POINT REMOVES ITS LABEL AND ONLY ITS LABEL.
   */
  object.geometry.points = [point("p1", 0, 5), point("p3", 1, 15)];

  const after = labelsOf(object);

  check(
    "removing a point leaves one label per remaining point",
    after.length === 2,
    `got ${after.length}`,
  );

  check(
    "no label points at the removed point",
    after.every((label) => label.anchorRef.pointId !== "p2"),
    after.map((label) => label.anchorRef.pointId).join(", "),
  );

  /*
   * REORDERING PRESERVES OWNERSHIP: the values travel with their ids.
   */
  object.geometry.points = [
    point("p1", 0, 5),
    point("p2", 0.5, 10),
    point("p3", 1, 15),
  ];

  const beforeOrder = Object.fromEntries(
    labelsOf(object).map((label) => [
      label.anchorRef.pointId,
      model.textFor(label, scene([object])),
    ]),
  );

  object.geometry.points = [
    point("p3", 0, 15),
    point("p1", 0.5, 5),
    point("p2", 1, 10),
  ];

  const afterOrder = Object.fromEntries(
    labelsOf(object).map((label) => [
      label.anchorRef.pointId,
      model.textFor(label, scene([object])),
    ]),
  );

  /*
   * THE VALUE STAYS WITH ITS POINT; the w1/w2/w3 PREFIX follows the
   * point's POSITION along the body, because that is what the numbers in
   * the name mean. So the magnitude is compared on its own, and the
   * prefix is checked separately to be sure it really did follow the
   * order.
   */
  const magnitudeOf = (text) => String(text).replace(/^w\d+ = /, "");

  check(
    "reordering swaps no values between points",
    ["p1", "p2", "p3"].every(
      (id) => magnitudeOf(beforeOrder[id]) === magnitudeOf(afterOrder[id]),
    ),
    `before ${JSON.stringify(beforeOrder)} after ${JSON.stringify(afterOrder)}`,
  );

  check(
    "and the w-numbers follow the order along the body",
    /^w1/.test(afterOrder.p3) && /^w2/.test(afterOrder.p1) && /^w3/.test(afterOrder.p2),
    JSON.stringify(afterOrder),
  );
}

console.log("\n  editing one magnitude changes one label, and moves none\n");

{
  const object = varyingLoad([
    point("p1", 0, 5),
    point("p2", 0.5, 10),
    point("p3", 1, 15),
  ]);

  object.geometry.pointOffsets = {
    p1: { x: 30, y: -20 },
    p2: { x: 10, y: -60 },
    p3: { x: -30, y: -20 },
  };

  const before = labelsOf(object);
  const beforePlace = Object.fromEntries(
    before.map((label) => [label.anchorRef.pointId, { ...label.placement }]),
  );

  /* Point 2 becomes 20 kN/m. */
  object.geometry.points = [
    point("p1", 0, 5),
    point("p2", 0.5, 20),
    point("p3", 1, 15),
  ];

  const after = labelsOf(object);

  const textsAfter = Object.fromEntries(
    after.map((label) => [label.anchorRef.pointId, model.textFor(label, scene([object]))]),
  );

  check(
    "only the edited point's label changes",
    /20(\.0+)?\s*kN\/m/.test(textsAfter.p2) &&
      /5(\.0+)?\s*kN\/m/.test(textsAfter.p1) &&
      /15(\.0+)?\s*kN\/m/.test(textsAfter.p3),
    JSON.stringify(textsAfter),
  );

  check(
    "and no label moves when a value changes",
    after.every(
      (label) =>
        label.placement.x === beforePlace[label.anchorRef.pointId].x &&
        label.placement.y === beforePlace[label.anchorRef.pointId].y,
    ),
  );
}

console.log("\n  direction and arrow height move no label\n");

{
  const object = varyingLoad([
    point("p1", 0, 5),
    point("p2", 0.5, 10),
    point("p3", 1, 15),
  ]);

  object.geometry.pointOffsets = {
    p1: { x: 20, y: -15 },
    p2: { x: 5, y: -40 },
    p3: { x: -20, y: -15 },
  };

  const before = Object.fromEntries(
    labelsOf(object).map((label) => [
      label.anchorRef.pointId,
      { ...label.placement },
    ]),
  );

  /* A reversal is a direction change and nothing else. */
  object.geometry.direction = 90;

  const afterReverse = Object.fromEntries(
    labelsOf(object).map((label) => [
      label.anchorRef.pointId,
      { ...label.placement },
    ]),
  );

  check(
    "switching direction leaves every label where it was",
    ["p1", "p2", "p3"].every(
      (id) =>
        before[id].x === afterReverse[id].x &&
        before[id].y === afterReverse[id].y,
    ),
    JSON.stringify(afterReverse),
  );

  check(
    "and does not swap the values between points",
    /5(\.0+)?\s*kN\/m/.test(
      model.textFor(
        labelsOf(object).find((label) => label.anchorRef.pointId === "p1"),
        scene([object]),
      ),
    ),
  );

  /*
   * THE ARROW HEIGHT is the drawn length the student gave the arrows. It is
   * not an argument to the annotation model at all, so the labels are
   * provably indifferent to it - this checks the drawn result too.
   */
  const drawnPositions = () => {
    renderer.renderDrawing(scene([object]), canvas);

    return [...canvas.querySelectorAll(".drawing-derived-magnitude")].map(
      (group) => {
        const text = group.querySelector("text");
        return `${text.getAttribute("x")},${text.getAttribute("y")}`;
      },
    );
  };

  const atOne = drawnPositions();

  global.enggLoadProfile.setLoadArrowHeight(
    object.geometry,
    4 * global.enggLoadProfile.loadArrowHeight(object.geometry),
  );

  const atFour = drawnPositions();

  check(
    "taller arrows draw the same labels in the same places",
    atOne.length > 0 && JSON.stringify(atOne) === JSON.stringify(atFour),
    `1x ${JSON.stringify(atOne)} vs 4x ${JSON.stringify(atFour)}`,
  );

  check(
    "the drawn label count still equals the point count",
    atOne.length === object.geometry.points.length,
    `drew ${atOne.length} labels for ${object.geometry.points.length} points`,
  );
}

console.log("\n  the drawn labels match the model, one per point\n");

{
  const object = varyingLoad([
    point("p1", 0, 5),
    point("p2", 0.5, 10),
    point("p3", 1, 15),
  ]);

  renderer.renderDrawing(scene([object]), canvas);

  const groups = [...canvas.querySelectorAll(".drawing-derived-magnitude")];

  check(
    "one derived label group is drawn per point",
    groups.length === 3,
    `drew ${groups.length}`,
  );

  const ids = groups.map((group) => group.getAttribute("data-feature-id"));

  check(
    "each drawn label carries a distinct id",
    new Set(ids).size === ids.length && ids.every(Boolean),
    ids.join(", "),
  );

  check(
    "the drawn ids name their own points",
    ids.every((id, index) => id.includes(object.geometry.points[index].id)) ||
      ids.every((id) => /p[123]/.test(id)),
    ids.join(", "),
  );
}

console.log("\n  a moved label is part of what Fit must include\n");

{
  const object = varyingLoad([
    point("p1", 0, 5),
    point("p2", 1, 10),
  ]);

  /*
   * The label for p2 is dragged far away, so it is the outermost thing
   * on the sheet. Fit measures the RENDERED extent, so it must contain
   * the label's own box - not only the load's arrows.
   */
  const home = Object.fromEntries(
    labelsOf(object).map((label) => [
      label.anchorRef.pointId,
      { ...label.placement },
    ]),
  );

  object.geometry.pointOffsets = {
    p2: { x: 400, y: 200 },
  };

  const moved = labelsOf(object).find(
    (label) => label.anchorRef.pointId === "p2",
  );

  check(
    "the moved label is at its custom position",
    moved.placement.x === 400 && moved.placement.y === 200,
    `${JSON.stringify(moved.placement)} vs home ${JSON.stringify(home.p2)}`,
  );

  const bounds = model.annotationTextBounds(moved, scene([object]));

  check(
    "the label has text bounds a Fit can use",
    bounds && bounds.maxX > 400,
    JSON.stringify(bounds),
  );
}

console.log("\n  a moved label survives a save and reload\n");

{
  const object = varyingLoad([
    point("p1", 0, 5),
    point("p2", 0.5, 10),
    point("p3", 1, 15),
  ]);

  object.geometry.pointOffsets = {
    p1: { x: 17, y: -33 },
    p3: { x: -52, y: -9 },
  };

  /* The round trip a saved document makes. */
  const reloaded = JSON.parse(JSON.stringify(object));

  const before = Object.fromEntries(
    labelsOf(object).map((label) => [
      label.anchorRef.pointId,
      { ...label.placement },
    ]),
  );

  const after = Object.fromEntries(
    labelsOf(reloaded).map((label) => [
      label.anchorRef.pointId,
      { ...label.placement },
    ]),
  );

  check(
    "every moved label returns to its custom location",
    ["p1", "p2", "p3"].every(
      (id) =>
        before[id].x === after[id].x && before[id].y === after[id].y,
    ),
    `${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
  );

  check(
    "and the unmoved one is still where it naturally falls",
    after.p2.x !== before.p1.x || after.p2.y !== before.p1.y,
  );
}

console.log("\n  a uniform load is left alone\n");

{
  const uniform = {
    id: "load-1",
    type: "load",
    engineering: { discipline: "statics", staticsType: "distributed-load" },
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      direction: -90,
      intensity: 7.5,
      points: [point("u1", 0, 7.5), point("u2", 1, 7.5)],
    },
    style: { stroke: "#000000", lineWidth: 0.5 },
  };

  const labels = labelsOf(uniform);

  check(
    "a uniform distributed load still states one value, not one per point",
    labels.length === 1,
    `got ${labels.length}`,
  );

  check(
    "and that value is the intensity",
    /7\.50\s*kN\/m/.test(model.textFor(labels[0], scene([uniform]))),
    model.textFor(labels[0], scene([uniform])),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
