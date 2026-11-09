/*
 * ============================================================
 * THE DIMENSION REGRESSION
 * ============================================================
 *
 * One rectangle, one horizontal dimension measuring its width, and the two
 * representations that must agree:
 *
 *   Rectangle bottom-left  (0, 49.9337)
 *   Rectangle top-right    (132.7724, 95.5743)
 *   Label                  "y"
 *
 * The checks below are the acceptance criteria, not a description of the
 * implementation: the dimension measures the rectangle's real width, both
 * defining points are the rectangle's edges, two witness lines are generated,
 * the dimension line is parallel to the measured edge and near the rectangle,
 * the label is centred, and the exported source carries every one of those
 * marks at the SAME coordinates the canvas draws.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();
if (error) throw error;

let state;
let model;
let dimensions;
let writer;

const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

before(async () => {
  await whenReady();

  ({ drawingState: state } = require(locate("editor-state.js")));
  model = require(locate("drawing-state.js")).default;
  dimensions = require(locate("dimension-model.js")).default;
  writer = require(locate("annotations.js")).annotationSourceWriter;

  state.camera = { zoom: 1, panX: 0, panY: 0 };
  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;
});

after(() => window.close());

/* The rectangle and a width dimension above it, as the acceptance case. */
function rectangleWithWidth() {
  const previous = model.snapshotDrawing(state);

  /*
   * The rectangle is stored by its TOP-LEFT corner and its two extents, so the
   * acceptance case's bottom-left (0, 49.9337) is `y + height`.
   */
  const rectangle = model.addObject(
    state,
    model.geometryFactories.rectangle({ x: 0, y: 95.5743 }, 132.7724, 45.6406),
  );

  const dimension = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "horizontal",
      refs: [
        { featureId: rectangle.id, anchor: "bottomLeft" },
        { featureId: rectangle.id, anchor: "bottomRight" },
      ],
      placement: { x: 66.3862, y: 40 },
      dimensionKind: "variable",
      content: "y",
    }),
  );

  model.commitDrawingChange(state, previous);

  return { rectangle, dimension };
}

test("the dimension measures the rectangle's actual width between its own edges", () => {
  const { dimension } = rectangleWithWidth();

  const points = dimensions.measurePoints(dimension, state);

  assert.equal(points.length, 2, "two defining points");
  assert.ok(near(points[0].x, 0, 1e-4), `left edge at x=0, got ${points[0].x}`);
  assert.ok(
    near(points[1].x, 132.7724, 1e-4),
    `right edge at x=132.7724, got ${points[1].x}`,
  );

  /* Both are on the rectangle's bottom edge. */
  assert.ok(near(points[0].y, 49.9337, 1e-4));
  assert.ok(near(points[1].y, 49.9337, 1e-4));
});

test("the construction is complete: two witness lines, a parallel dimension line, two heads", () => {
  const { dimension } = rectangleWithWidth();
  const graphics = dimensions.graphicsFor(dimension, state);

  assert.equal(graphics.kind, "linear");
  assert.equal(graphics.extensions.length, 2, "two extension (witness) lines");

  /*
   * EACH WITNESS LINE runs from a small stand-off from its measured point out
   * past the dimension line: it starts a little above (or below) the geometry
   * at the measured point's own x, and reaches the dimension line at the same
   * x - so it is vertical, and connects the correct point to the correct end.
   */
  const measured = dimensions.measurePoints(dimension, state);

  graphics.extensions.forEach(([from, to], index) => {
    const point = measured[index];

    assert.ok(
      near(from.x, point.x, 1e-6),
      "a witness line starts on its measured point's line",
    );
    assert.ok(near(to.x, point.x, 1e-6), "and ends on the same one");
    assert.ok(
      Math.abs(to.y - point.y) > 1,
      "the witness line reaches from the geometry to the dimension line",
    );
  });

  /* The dimension line is horizontal, level with the placement, and inside the sheet. */
  const [start, end] = graphics.line;

  assert.ok(
    near(start.y, end.y, 1e-6),
    "the dimension line is parallel to the measured edge",
  );
  assert.ok(
    near(start.y, 40, 1e-6),
    "and sits on the placement the student chose",
  );
  assert.ok(
    Math.abs(start.x) < 200 && Math.abs(end.x) < 200,
    "the line is not off the page",
  );
  assert.ok(
    near(Math.abs(end.x - start.x), 132.7724, 1e-4),
    "it spans the rectangle's width",
  );

  /* Heads at both ends, pointing towards the measured limits. */
  assert.equal(graphics.arrowheads.length, 2);

  const away = (head) => Math.hypot(head.direction.x, head.direction.y) > 0.9;
  assert.ok(away(graphics.arrowheads[0]) && away(graphics.arrowheads[1]));

  /*
   * THE HEADS POINT AT THE WITNESS LINES, and sit INSIDE the span between them.
   *
   * Inside: the left head at the left end points -x (out, at its witness line)
   * and the right head +x. Outside: each head is moved beyond its end and points
   * back in - which is the same measurement stated when the heads do not fit.
   */
  const [left, right] = graphics.arrowheads;

  if (graphics.arrowStyle === "inside") {
    assert.ok(left.direction.x < 0, "the left head points out, at the left witness line");
    assert.ok(right.direction.x > 0, "the right head points out, at the right witness line");
    assert.ok(left.at.x >= start.x - 1e-6 && left.at.x <= end.x + 1e-6, "and both sit inside the span");
  } else {
    assert.ok(left.direction.x > 0, "an outside left head points back in");
    assert.ok(right.direction.x < 0, "an outside right head points back in");
  }
});

test("the label is centred on the dimension line, above it, and keeps its override", () => {
  const { dimension } = rectangleWithWidth();
  const graphics = dimensions.graphicsFor(dimension, state);

  assert.equal(
    graphics.text,
    "y",
    "a user-defined label is shown, not a computed length",
  );

  const [start, end] = graphics.line;

  assert.ok(
    near(graphics.textFrame.x, (start.x + end.x) / 2, 1e-6),
    "centred along the line",
  );
  /*
   * ON THE FAR SIDE OF THE LINE FROM THE GEOMETRY. The dimension stands below
   * the rectangle, so its number reads BELOW the dimension line - a label
   * between line and geometry would be crowded against the outline it measures.
   */
  assert.ok(
    graphics.textFrame.y < start.y,
    "beyond the line, away from its geometry",
  );
  assert.ok(near(graphics.textFrame.angle, 0, 1e-6), "horizontal, upright");
  assert.ok(graphics.label.halfWidth > 0 && graphics.label.halfHeight > 0);
});

test("the dimension follows its geometry when the rectangle is resized", () => {
  const { rectangle, dimension } = rectangleWithWidth();

  const previous = model.snapshotDrawing(state);
  rectangle.geometry.width = 200;
  model.commitDrawingChange(state, previous);

  const graphics = dimensions.graphicsFor(dimension, state);

  assert.ok(
    near(Math.abs(graphics.line[1].x - graphics.line[0].x), 200, 1e-4),
    "the dimension line re-measures the new width",
  );

  const measured = dimensions.measurePoints(dimension, state);
  assert.ok(
    near(measured[1].x, 200, 1e-4),
    "the defining point moved with the edge",
  );
});

test("the TikZ source carries witness lines, the dimension line, heads and the text", () => {
  const { dimension } = rectangleWithWidth();
  const graphics = dimensions.graphicsFor(dimension, state);

  const source = writer(dimension, { state, allObjects: state.objects });

  assert.ok(source, "a dimension writes source");

  /* One block, with its stable identity and a readable name. */
  assert.match(source, /% DAETUM OBJECT:/);
  assert.match(source, new RegExp(`% DAETUM ID: ${dimension.id}`));
  assert.match(source, /% DAETUM TYPE: dimension/);

  /* Two witness lines, dashed. */
  const dashed = (source.match(/dash pattern=/g) || []).length;
  assert.ok(dashed >= 2, `two witness lines are dashed, got ${dashed}`);

  /*
   * THE DIMENSION LINE IS NOT A HAIRLINE.
   *
   * Its pen is the object's own, through the one calibrated conversion
   * (0.5 model units -> 1.2 pt) and then the drawing's export factor - the
   * SAME two steps every other object's stroke takes. The literal is therefore
   * not fixed by the writer; what matters is that it is a substantial weight,
   * well above the old 0.4 pt.
   */
  const widths = [...source.matchAll(/line width=([\d.]+)pt/g)].map((m) => Number(m[1]));

  assert.ok(widths.length > 0, "the dimension's strokes state a width");
  assert.ok(
    Math.max(...widths) >= 1.1,
    `the dimension line is a real pen, not a hairline: ${widths.join(", ")}`,
  );

  /*
   * AND THE WITNESS LINES ARE LIGHTER THAN IT - the hierarchy, not one weight
   * for everything.
   */
  assert.ok(
    Math.min(...widths) < Math.max(...widths),
    `witness lines weigh less than the dimension line: ${widths.join(", ")}`,
  );

  /* Heads on every stated head, in TikZ's own syntax. */
  const heads = (source.match(/-\{Latex\}/g) || []).length;
  assert.equal(
    heads,
    graphics.arrowheads.length,
    "one drawn head per arrowhead",
  );

  /* The label, as a node at the frame's own centre. */
  assert.match(source, /\{y\}/);
  assert.match(source, /fill=white/);

  /*
   * THE COORDINATES ARE THE MODEL'S, APPLIED ONCE. The drawing's export
   * transform moves the whole picture to a local origin, so every point in the
   * source is the model's point through that ONE transform - and the picture
   * the student sees and the picture that compiles therefore agree.
   */
  /*
   * THE TYPE SIZE IS THE MODEL'S PRINT SIZE, WRITTEN AT THE NODE - and nothing
   * else. A dimension's size is stated in POINTS (11 by default, the value a
   * drafter would write), so the number in `\fontsize` is the number the
   * student sees in Features: no 0.75 factor, no px-to-pt guess.
   */
  const size = Number(graphics.label.fontPt);
  const node = source
    .split("\n")
    .find((line) => line.includes(`{${graphics.text}}`));

  assert.ok(node, "the label's node is written");

  const written = Number(
    (node.match(/\\fontsize\{([\d.]+)\}/) || [])[1],
  );

  assert.ok(
    Math.abs(written - size) < 0.01,
    `the label is set at the model's print size (${size}pt), got ${written}: ${node}`,
  );
});

test("no dimension coordinate is ever written off the page", () => {
  const { dimension } = rectangleWithWidth();
  const source = writer(dimension, { state, allObjects: state.objects });

  /* Every coordinate in the block is inside the sheet's paper limits. */
  for (const match of source.matchAll(
    /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
  )) {
    const x = Number(match[1]);
    const y = Number(match[2]);

    assert.ok(
      Math.abs(x) <= 300 && Math.abs(y) <= 300,
      `coordinate (${x},${y}) is outside the fitted drawing`,
    );
  }
});

test("every dimension kind writes its own construction, not a linear one", () => {
  const previous = model.snapshotDrawing(state);

  const circle = model.addObject(
    state,
    model.geometryFactories.circle({ x: 60, y: 20 }, 12),
  );

  const angular = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "angular",
      refs: [
        { featureId: circle.id, anchor: "center" },
        { featureId: circle.id, anchor: "center" },
      ],
      placement: { x: 70, y: 30 },
    }),
  );

  const radial = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "radius",
      refs: [{ featureId: circle.id, anchor: "center" }],
      placement: { x: 90, y: 40 },
    }),
  );

  /*
   * A diameter is measured from a feature's own DIAMETER value where it has
   * one, so the case is a shaft - the feature that stores a diameter rather
   * than a radius.
   */
  const shaft = model.addObject(
    state,
    model.geometryFactories.line({ x: 0, y: 0 }, { x: 0, y: 0 }),
  );

  shaft.type = "shaft";
  shaft.geometry = {
    start: { x: 0, y: 60 },
    end: { x: 80, y: 60 },
    diameter: 24,
  };

  const diameter = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "diameter",
      refs: [{ kind: "property", featureId: shaft.id, property: "diameter" }],
      placement: { x: 40, y: 60 },
    }),
  );

  model.commitDrawingChange(state, previous);

  /*
   * A RADIUS IS A LEADER FROM THE CENTRE TO THE SURFACE, with a head at the
   * surface pointing out; a DIAMETER crosses the body with a head at each end.
   */
  const radiusGraphics = dimensions.graphicsFor(radial, state);
  assert.equal(radiusGraphics.kind, "radial");
  assert.ok(
    near(radiusGraphics.line[0].x, 60) && near(radiusGraphics.line[0].y, 20),
    "a radius starts at the centre",
  );
  assert.ok(
    near(
      Math.hypot(radiusGraphics.edge.x - 60, radiusGraphics.edge.y - 20),
      12,
      1e-6,
    ),
    "and reaches the circumference",
  );
  assert.equal(radiusGraphics.arrowheads.length, 1);
  assert.ok(radiusGraphics.leader, "a radius has a leader out to its text");

  const diameterGraphics = dimensions.graphicsFor(diameter, state);

  assert.ok(diameterGraphics, "a diameter against a shaft's own value is drawn");
  assert.ok(
    near(
      Math.hypot(
        diameterGraphics.line[1].x - diameterGraphics.line[0].x,
        diameterGraphics.line[1].y - diameterGraphics.line[0].y,
      ),
      24,
      1e-6,
    ),
    "a diameter's line crosses the whole body",
  );
  assert.equal(
    diameterGraphics.arrowheads.length,
    2,
    "a diameter has a head at each end",
  );

  /*
   * The source for each is its own construction: the radial writer emits a
   * leader and one head, the diameter writer two heads.
   */
  const radiusSource = writer(radial, { state, allObjects: state.objects });
  assert.ok(radiusSource);
  assert.equal((radiusSource.match(/-\{Latex\}/g) || []).length, 1);

  const diameterSource = writer(diameter, { state, allObjects: state.objects });
  assert.ok(diameterSource);
  assert.equal((diameterSource.match(/-\{Latex\}/g) || []).length, 2);

  /* An angular dimension between a feature and itself has no angle to state. */
  assert.equal(dimensions.measurementFor(angular, state), null);
});

test("the dimension's label is drawn as in-page text with the dimension's own id", () => {
  const { dimension } = rectangleWithWidth();
  const appendDimensionEntity = require(
    locate("dimension-render.js"),
  ).appendDimensionEntity;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const identity = (point) => point;

  appendDimensionEntity(svg, dimension, state, identity, {
    stroke: "#000000",
    lineWidth: 0.5,
  });

  const label = svg.querySelector("text");
  assert.ok(label, "the number is SVG text on the page");
  assert.equal(label.textContent, "y");

  const group = svg.querySelector("[data-dimension-id]");
  assert.equal(
    group.getAttribute("data-dimension-id"),
    dimension.id,
    "it belongs to the dimension",
  );

  /* No rectangle: the label is text, never a plate over the drawing. */
  assert.equal(svg.querySelectorAll("rect").length, 0);
});

test("the exported document loads arrows.meta in its preamble", () => {
  /*
   * `-{Latex}` is a `arrows.meta` head. A file that used it without the library
   * would fail in a clean TikZ editor, which is exactly what an export must not
   * do - so the library's presence is checked through the export's own list.
   */
  const document = require(locate("latex-document.js"));

  assert.ok(document.STANDALONE_LIBRARIES.includes("arrows.meta"));
});

test("a vertical dimension is built the other way round", () => {
  const previous = model.snapshotDrawing(state);

  const line = model.addObject(
    state,
    model.geometryFactories.line({ x: 10, y: 0 }, { x: 10, y: 80 }),
  );

  const vertical = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "vertical",
      refs: [
        { featureId: line.id, anchor: "start" },
        { featureId: line.id, anchor: "end" },
      ],
      placement: { x: 40, y: 40 },
    }),
  );

  model.commitDrawingChange(state, previous);

  const graphics = dimensions.graphicsFor(vertical, state);

  assert.ok(
    near(graphics.line[0].x, graphics.line[1].x, 1e-6),
    "the line is vertical",
  );
  assert.ok(near(graphics.line[0].x, 40), "and sits at the chosen offset");

  /* Horizontal witness lines. */
  graphics.extensions.forEach(([from, to]) => {
    assert.ok(near(from.y, to.y, 1e-6), "witness lines run horizontally");
  });

  /* The number reads bottom-to-top on a vertical dimension. */
  assert.ok(Math.abs(graphics.textFrame.angle) > 45);
});

test("the selection control stands clear of the number and off the dimension line", () => {
  const { dimension } = rectangleWithWidth();
  const handles = require(locate("handles.js"));
  const geometry = dimensions.graphicsFor(dimension, state);

  const [handle] = handles.editableHandlesFor(dimension);

  assert.ok(handle, "a selected dimension offers its one control");
  assert.equal(handle.kind, "annotation-offset");

  const frame = geometry.textFrame;
  const midX = (geometry.line[0].x + geometry.line[1].x) / 2;

  /*
   * OFF THE LINE, ON THE LINE'S SIDE OF THE NUMBER. The number is BELOW the
   * line; the handle is ABOVE it, so it can never be drawn over the glyphs or
   * on top of the dimension line they annotate.
   */
  assert.ok(handle.point.y > geometry.line[0].y, "the handle is on the far side from the number");
  assert.ok(
    Math.abs(handle.point.y - frame.y) > frame.height / 2,
    "and clear of the number's own extent"
  );

  /* BESIDE THE NUMBERS, not on them. */
  assert.ok(
    Math.abs(handle.point.x - frame.x) > frame.width / 2,
    "the handle is outside the label's box along the line"
  );

  assert.ok(
    Math.abs(handle.point.y - geometry.line[0].y) > 0.5,
    "the handle does not sit on the dimension line"
  );

  assert.ok(Number.isFinite(midX));
});

test("a selected dimension's frame is its drawn extent, not its placement point", () => {
  const { dimension } = rectangleWithWidth();
  const selection = require(locate("selection-transform.js"));

  const box = selection.selectionBounds([dimension], [dimension.id], state);
  const geometry = dimensions.graphicsFor(dimension, state);

  assert.ok(box, "the dimension has a frame");
  assert.ok(
    box.maxX - box.minX > geometry.line[1].x - geometry.line[0].x - 1,
    "the frame spans at least the dimension line"
  );
  assert.ok(
    box.minY <= geometry.textFrame.y - geometry.textFrame.height / 2 + 1e-6,
    "and reaches the number it annotates"
  );
});
