/* eslint-disable no-console */
/*
 * ========================================================
 * THE FREEFORM POLYGON TOOL
 * ========================================================
 *
 * The whole workflow, not just the picture:
 *
 *   select the tool -> place vertices -> close it (three ways) -> select it ->
 *   edit its appearance -> drag a vertex -> edit the source -> read it back.
 *
 * The drawing is driven through the SAME modules a click on the canvas reaches
 * (`beginOrCompleteGeometry`, the commit, the keyboard finishers), so a test
 * here proves the interaction rather than a parallel copy of it. Only the
 * events themselves are simulated, because a DOM event is the one thing that
 * cannot be called directly.
 */

const assert = require("node:assert/strict");
const path = require("path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

/*
 * THE TOOLBAR CHROME THE STATUS LINE WRITES INTO.
 *
 * Every construction reports through `setToolMessage`, which writes to the real
 * status element the page has. The harness builds a bare document, so the
 * elements are created BEFORE the modules capture them - each module reads its
 * element once, at load time - and the status text can then be asserted as the
 * student would see it.
 */
[
  "drawingToolMessage",
  "drawingToolHeading",
  "drawingToolList",
  "drawingCoordinates",
  "drawingZoomValue"
].forEach((id) => {
  if (!globalThis.document.getElementById(id)) {
    const element = globalThis.document.createElement("div");

    element.id = id;

    globalThis.document.body.appendChild(element);
  }
});

/* The canvas element is found by CLASS, as the workspace's dom module does. */
if (!globalThis.document.querySelector(".drawing-canvas")) {
  const canvas = globalThis.document.createElement("div");

  canvas.className = "drawing-canvas";

  globalThis.document.body.appendChild(canvas);
}

const { loadModule } = require("./helpers/source-path.cjs");

/* ============================================================ modules */

let cached = null;

function modules() {
  if (cached) {
    return cached;
  }

  const ds = loadModule("drawing-state.js");
  const creation = loadModule("geometry-creation.js");
  const selection = loadModule("selection.js");
  const editorState = loadModule("editor-state.js");

  /*
   * EVERY MODULE HERE PUBLISHES ITS API AS ITS DEFAULT EXPORT, which is the
   * same object the application reaches through the global. `api()` unwraps
   * that in one place, so a test says `m.ds.selectObject` rather than having
   * to know the shape of a source module.
   */
  const api = (module) => module.default || module;

  const m = {
    ds: api(ds),
    creation,
    selection,
    editorState,
    /* The live drawing state every module above shares. */
    state: editorState.drawingState,
    sync: api(loadModule("source-object-sync.js")),
    apply: loadModule("source-model-apply.js"),
    writer: api(loadModule("source-writers/geometry.js")),
    schema: api(loadModule("feature-schema.js")),
    handles: loadModule("handles.js"),
    drag: loadModule("drag.js"),
    hit: loadModule("hit-testing.js"),
  };

  /*
   * THE GEOMETRY SOURCE WRITER IS INSTALLED THE WAY START-UP INSTALLS IT.
   * A polygon's block is written by that writer, so a test without it would
   * see a source manager that could write no geometry at all - and would
   * report the polygon as unrepresentable rather than as broken.
   */
  m.writer.installGeometrySourceWriter({
    setSourceWriter: loadModule("source-synchronization.js").setSourceWriter,
  });

  /*
   * AND THE MODEL'S FACTORY TABLE, which is how a block read from the source
   * becomes a real feature. Start-up registers it; a test that forgot would
   * find every block "created" as nothing at all.
   */
  m.sync.setSourceGeometryFactories(m.ds.geometryFactories);

  cached = m;

  return m;
}

/* A blank sheet at a known camera, so a test can talk in drawing units. */
function freshSheet(m, { zoom = 1 } = {}) {
  m.state.objects = [];
  m.state.activeTool = "freeform-polygon";
  m.state.camera.zoom = zoom;
  m.state.camera.panX = 0;
  m.state.camera.panY = 0;
  m.ds.clearSelection(m.state);
  m.ds.clearInteraction(m.state);
}

/*
 * Place one vertex the way a click does.
 *
 * `beginOrCompleteGeometry` is the function the canvas's click router calls,
 * and it reads a RESOLUTION - the snapped pointer position plus the modifier
 * keys of that frame - not a raw event. One is built here so the construction
 * is fed exactly what a real click would feed it.
 */
function clickAt(m, point, { shift = false } = {}) {
  m.creation.beginOrCompleteGeometry({
    effectiveConstructionPoint: { x: point.x, y: point.y },
    rawPointerPoint: { x: point.x, y: point.y },
    modifiers: { shift, alt: false, ctrl: false },
  });
}

function polygons(m) {
  return m.state.objects.filter((object) => object.type === "freeform-polygon");
}

/*
 * THE VERTEX HANDLES - a selected object also offers ONE rotation handle, which
 * is every object's turn gesture rather than a vertex, so the shape's own
 * handles are the ones named `vertex<n>`.
 */
function vertexHandles(m, object) {
  return m.handles
    .editableHandlesFor(object)
    .filter((handle) => /^vertex\d+$/.test(handle.kind));
}

/*
 * The polygon's source block, written the way the application writes it: the
 * source manager is asked for the object's region, which is what regenerates
 * the file after a vertex drag or a Features edit.
 */
function sourceBlock(m, object) {
  return m.sync.sourceForObjectRegion(
    object,
    "\\begin{tikzpicture}[x=1mm, y=1mm]\n\\end{tikzpicture}",
    { allObjects: m.state.objects }
  );
}

function pointsOf(object) {
  return object.geometry.points.map(({ x, y }) => ({ x, y }));
}

/*
 * A CONCAVE "L" - six vertices, one of them a real reflex corner. A shape with
 * four points on a diamond is CONVEX however irregular it looks, so the
 * concave case needs a vertex that turns back into the shape.
 */
const CONCAVE = [
  { x: 0, y: 0 },
  { x: 80, y: 0 },
  { x: 80, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 80 },
  { x: 0, y: 80 },
];

/* A simple convex quadrilateral, for the cases that only need "not a triangle". */
const DIAMOND = [
  { x: 0, y: 50 },
  { x: 40, y: 0 },
  { x: 80, y: 50 },
  { x: 40, y: 90 },
];

const SQUARE = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 60 },
  { x: 0, y: 60 },
];

/* ============================================================ creation */

test("1: a triangle is created from three clicks and closed back on itself", () => {
  const m = modules();

  freshSheet(m);

  const vertices = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 0, y: 40 },
  ];

  vertices.forEach((point) => clickAt(m, point));

  assert.equal(
    polygons(m).length,
    0,
    "three vertices alone do not make a polygon",
  );

  /* The fourth click lands on the first vertex: close. */
  clickAt(m, vertices[0]);

  const [polygon] = polygons(m);

  assert.ok(polygon, "the polygon was created");
  assert.deepEqual(
    pointsOf(polygon),
    vertices,
    "its own vertices, in the order clicked",
  );
  assert.equal(polygon.geometry.closed, true, "the shape is genuinely closed");
  assert.match(polygon.name, /Freeform Polygon/, "it has an editable name");
  assert.ok(polygon.id, "and a stable id");
});

test("2: a polygon with many vertices keeps each one in order", () => {
  const m = modules();

  freshSheet(m);

  const many = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;

    return {
      x: Math.round(100 * Math.cos(angle) * 1000) / 1000,
      y: Math.round(100 * Math.sin(angle) * 1000) / 1000,
    };
  });

  many.forEach((point) => clickAt(m, point));

  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  assert.ok(polygon);
  assert.equal(
    polygon.geometry.points.length,
    12,
    "every vertex is kept, none lost to rounding",
  );
  assert.deepEqual(
    pointsOf(polygon),
    many,
    "and in the order they were placed",
  );
});

test("3: an irregular CONCAVE polygon is created and not rejected", () => {
  const m = modules();

  freshSheet(m);

  CONCAVE.forEach((point) => clickAt(m, point));

  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  assert.ok(polygon, "a concave shape is a polygon, not a degenerate one");
  assert.equal(polygon.geometry.points.length, 6);

  /*
   * The notches are real: the signed area of the ring is smaller than the
   * triangle through the same extreme points would be, which is what
   * "concave" means geometrically. This fails if something silently replaced
   * the vertices with a convex hull or a regular polygon.
   */
  const ring = pointsOf(polygon);
  const signedArea =
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length];

      return sum + (point.x * next.y - next.x * point.y);
    }, 0) / 2;

  assert.ok(Math.abs(signedArea) > 100, "the shape has real area");

  /*
   * CONCAVE, PROVED BY THE CORNERS: a convex ring turns the same way at every
   * vertex, and this one turns both ways. That is exactly the difference
   * between the shape the student drew and its convex hull.
   */
  const turns = ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    const after = ring[(index + 2) % ring.length];

    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });

  assert.ok(
    turns.some((turn) => turn > 0) && turns.some((turn) => turn < 0),
    "the polygon is genuinely concave, not its convex hull"
  );
});

/* ============================================================ the closes */

test("4: clicking the first vertex closes the polygon without adding a vertex", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));

  /* A click WITHIN the closing tolerance, not exactly on the vertex. */
  clickAt(m, { x: 3, y: 3 });

  const [polygon] = polygons(m);

  assert.ok(polygon);
  assert.equal(
    polygon.geometry.points.length,
    4,
    "the closing click is not a fifth vertex",
  );
  assert.deepEqual(
    pointsOf(polygon),
    SQUARE,
    "and no vertex was moved or added",
  );
});

test("5: Enter completes the polygon from the vertices already placed", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));

  const finished = m.selection.finishActiveConstruction();

  assert.equal(finished, true, "Enter is consumed by the construction");
  assert.equal(polygons(m).length, 1);
  assert.equal(
    m.state.interaction.points.length,
    0,
    "the construction ends with the commit",
  );
});

test("5b: a double-click finishes the polygon and does not duplicate its last vertex", () => {
  const m = modules();

  freshSheet(m);

  DIAMOND.slice(0, 3).forEach((point) => clickAt(m, point));

  /*
   * The ordinary click of the pair has ALREADY placed the fourth vertex by
   * the time the double-click arrives, which is how a browser delivers it.
   */
  clickAt(m, DIAMOND[3]);

  const finished = m.selection.finishFreeformPolygonByDoubleClick({
    ...DIAMOND[3],
  });

  assert.equal(finished, true);
  assert.equal(polygons(m).length, 1);

  const [polygon] = polygons(m);

  assert.equal(
    polygon.geometry.points.length,
    4,
    "the double-click adds no fifth point",
  );
  assert.deepEqual(
    pointsOf(polygon),
    DIAMOND,
    "the shape is the four corners, not four corners plus a duplicate",
  );
});

test("5c: a double-click closes on the vertices already placed, and adds none", () => {
  const m = modules();

  freshSheet(m);

  DIAMOND.slice(0, 3).forEach((point) => clickAt(m, point));

  /*
   * The gesture's clicks placed every vertex - a real `dblclick` carries no
   * position the shape needs - so the finisher closes what is there. A third
   * vertex is a triangle, which is a legitimate polygon.
   */
  const finished = m.selection.finishFreeformPolygonByDoubleClick();

  assert.equal(finished, true, "the triangle is closed");

  const [polygon] = polygons(m);

  assert.ok(polygon);
  assert.deepEqual(
    pointsOf(polygon),
    DIAMOND.slice(0, 3),
    "exactly the three vertices the clicks placed - nothing added",
  );
});

test("6: fewer than three vertices - or three on one line - cannot complete", () => {
  const m = modules();

  freshSheet(m);

  clickAt(m, { x: 0, y: 0 });
  clickAt(m, { x: 50, y: 0 });

  assert.equal(
    m.selection.finishActiveConstruction(),
    false,
    "two vertices are refused",
  );
  assert.equal(polygons(m).length, 0);
  assert.equal(
    m.state.interaction.points.length,
    2,
    "and the construction is left running",
  );

  /* Collinear: three vertices, no area. */
  freshSheet(m);
  clickAt(m, { x: 0, y: 0 });
  clickAt(m, { x: 25, y: 0 });
  clickAt(m, { x: 50, y: 0 });

  assert.equal(
    m.selection.finishActiveConstruction(),
    false,
    "collinear vertices are refused",
  );
  assert.equal(polygons(m).length, 0);
});

test("6b: a repeated click at the same spot never adds a second vertex", () => {
  const m = modules();

  freshSheet(m);

  clickAt(m, { x: 10, y: 10 });
  clickAt(m, { x: 10, y: 10 });
  clickAt(m, { x: 10, y: 10 });

  assert.equal(
    m.state.interaction.points.length,
    1,
    "three clicks on one spot are one vertex",
  );
});

/* ============================================================ keyboard */

test("7: Backspace takes back the most recently placed vertex", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));

  assert.equal(m.creation.removeLastFreeformVertex(), true);
  assert.equal(m.state.interaction.points.length, 3);
  assert.deepEqual(
    m.state.interaction.points.slice(0, 3),
    SQUARE.slice(0, 3),
    "the FIRST three remain - it is the last one that went",
  );

  /* The shape is still drawable after the correction. */
  clickAt(m, SQUARE[3]);
  m.selection.finishActiveConstruction();

  assert.equal(polygons(m).length, 1);
});

test("8: Escape cancels the polygon being drawn and commits nothing", () => {
  const m = modules();

  freshSheet(m);

  CONCAVE.slice(0, 3).forEach((point) => clickAt(m, point));

  assert.equal(m.creation.cancelFreeformPolygon(), true);
  assert.equal(m.state.interaction.points.length, 0, "the vertices are gone");
  assert.equal(polygons(m).length, 0, "nothing was written to the drawing");
});

/* ============================================================ handles */

test("9: there is one handle per vertex, and dragging one moves only that vertex", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  const handles = vertexHandles(m, polygon);

  assert.equal(
    handles.length,
    polygon.geometry.points.length,
    "a handle for every vertex",
  );

  handles.forEach((handle, index) => {
    assert.deepEqual(
      handle.point,
      polygon.geometry.points[index],
      "each handle sits on its own vertex",
    );
  });

  m.ds.selectObject(m.state, polygon.id);

  /* Drag vertex 1 to a new place, through the same frame the canvas applies. */
  m.drag.applyManipulationFrame(
    { kind: "vertex1", object: polygon, snapGeometry: null, originalObjects: null },
    { x: 90, y: -10 }
  );

  assert.deepEqual(
    polygon.geometry.points[1],
    { x: 90, y: -10 },
    "the dragged vertex moved",
  );
  assert.deepEqual(
    polygon.geometry.points[0],
    SQUARE[0],
    "its neighbour did not",
  );
  assert.deepEqual(
    polygon.geometry.points[2],
    SQUARE[2],
    "nor the one after it",
  );
  assert.equal(polygon.geometry.closed, true, "the shape is still closed");
});

test("9b: handle positions follow the vertices when a vertex is dragged twice", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  m.drag.applyManipulationFrame(
    { kind: "vertex2", object: polygon, snapGeometry: null, originalObjects: null },
    { x: 70, y: 70 }
  );

  const handles = vertexHandles(m, polygon);

  assert.deepEqual(
    handles[2].point,
    { x: 70, y: 70 },
    "the handle is drawn where the vertex now is",
  );
  assert.equal(handles.length, polygon.geometry.points.length);
});

/* ============================================================ fix */

test("10: fixing a polygon removes its vertex handles and unfixing restores them", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  assert.ok(
    vertexHandles(m, polygon).length > 0,
    "unfixed: the vertices are grabbable",
  );

  m.schema.writeField(polygon, "fixed", true);

  assert.equal(polygon.locked, true, "Fix locks the object");
  assert.equal(
    vertexHandles(m, polygon).length,
    0,
    "a fixed polygon offers no handles at all",
  );

  m.schema.writeField(polygon, "fixed", false);

  assert.equal(
    vertexHandles(m, polygon).length,
    4,
    "unfixing gives them back",
  );
});

/* ============================================================ appearance */

test("11: outline colour, thickness, line style and fill are all editable", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  m.schema.writeField(polygon, "stroke", "#ff0000");
  m.schema.writeField(polygon, "lineWidth", "thick");
  m.schema.writeField(polygon, "lineType", "dashed");
  m.schema.writeField(polygon, "fillMode", "solid");
  m.schema.writeField(polygon, "fill", "#00aa00");

  assert.equal(polygon.style.stroke, "#ff0000", "outline colour");
  assert.equal(polygon.style.lineType, "dashed", "line style");
  assert.equal(polygon.style.fill, "#00aa00", "fill colour");

  assert.ok(polygon.style.lineWidth !== undefined, "a thickness was recorded");

  /* The appearance is what the source writer emits. */
  const block = sourceBlock(m, polygon);

  assert.match(block, /dashed/, "the style reaches the source");
  assert.match(block, /-- cycle;/, "and the shape is still written closed");
  assert.match(block, /ff0000|daetumC[A-Fa-f0-9]+/i, "with its own colour");
});

/* ============================================================ the source */

test("14: the source block describes the polygon and reads back as the same shape", () => {
  const m = modules();

  freshSheet(m);

  CONCAVE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  m.schema.writeField(polygon, "stroke", "#123456");
  m.schema.writeField(polygon, "fillMode", "solid");
  m.schema.writeField(polygon, "fill", "#abcdef");

  const block = sourceBlock(m, polygon);

  assert.match(
    block,
    /% DAETUM TYPE: freeform-polygon/,
    "the block names its type",
  );
  assert.match(block, /% DAETUM ID: /, "and its stable id");
  assert.match(block, /% DAETUM OBJECT: /, "and its readable name");
  assert.match(block, /-- cycle/, "the geometry is closed in the source");

  /* Read it back into a fresh drawing. */
  m.state.objects = [];

  /*
   * `setObjectRegion` writes ONE object's region into a source, so a fresh
   * plan is built the way the panel builds one: a picture with nothing in it,
   * into which the object's block is inserted.
   */
  const source = sourceBlock(m, polygon);

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true,
  });

  assert.equal(report.invalid.length, 0, JSON.stringify(report.invalid));
  assert.equal(report.created.length, 1, JSON.stringify(report));

  const rebuilt = m.state.objects[0];

  assert.equal(
    rebuilt.type,
    "freeform-polygon",
    "it comes back as a polygon, not a polyline",
  );
  assert.equal(rebuilt.id, polygon.id, "with its id");
  assert.equal(rebuilt.geometry.closed, true, "and still closed");

  pointsOf(rebuilt).forEach((point, index) => {
    assert.ok(Math.abs(point.x - CONCAVE[index].x) < 1e-2, `vertex ${index} x`);
    assert.ok(Math.abs(point.y - CONCAVE[index].y) < 1e-2, `vertex ${index} y`);
  });

  assert.equal(
    rebuilt.style.stroke,
    "#123456",
    "the outline colour round-trips",
  );
  assert.equal(rebuilt.style.fill, "#abcdef", "and the fill");
});

test("12: retyping a coordinate in the source moves that vertex", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);
  const block = sourceBlock(m, polygon);

  const edited = block.replace("-- (60,0)", "-- (90,0)");

  assert.notEqual(edited, block, "the statement was actually changed");

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source: `\\begin{tikzpicture}[x=1mm, y=1mm]\n${edited}\n\\end{tikzpicture}`,
    editable: true,
  });

  assert.equal(report.invalid.length, 0, JSON.stringify(report.invalid));
  assert.ok(
    report.updated.includes(polygon.id),
    "the polygon was updated in place",
  );

  assert.ok(
    Math.abs(polygon.geometry.points[1].x - 90) < 1e-2,
    `vertex moved: ${JSON.stringify(polygon.geometry.points[1])}`,
  );
  assert.equal(polygon.type, "freeform-polygon", "and stayed a polygon");
});

test("13: adding vertices in the source adds them to the polygon", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  assert.equal(polygon.geometry.points.length, 4);

  const block = sourceBlock(m, polygon);
  const edited = block.replace("-- cycle", "-- (30,-40) -- cycle");

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source: `\\begin{tikzpicture}[x=1mm, y=1mm]\n${edited}\n\\end{tikzpicture}`,
    editable: true,
  });

  assert.equal(report.invalid.length, 0, JSON.stringify(report.invalid));
  assert.equal(
    polygon.geometry.points.length,
    5,
    "the polygon now has five vertices",
  );
  assert.ok(
    Math.abs(polygon.geometry.points[4].y + 40) < 1e-2,
    "the new vertex is where the source says",
  );
  assert.equal(polygon.type, "freeform-polygon");
});

test("13b: invalid source keeps the last valid polygon and reports a line", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);
  const before = JSON.stringify(polygon.geometry);

  /*
   * THE POLYGON'S OWN BLOCK IS THE ONE THAT IS BROKEN. Invalid source is
   * reported per object block, and the object keeps its last valid form - so
   * the edit is made inside this polygon's block rather than in a picture with
   * no markers, where nothing would be attributable to it.
   */
  const broken = sourceBlock(m, polygon).replace(
    /\\draw\[[^\]]*\][^;]*;/,
    "\\draw (1,2) -- (3,"
  );

  assert.notEqual(broken, sourceBlock(m, polygon), "the statement was broken");

  const report = m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source: broken,
    editable: true,
  });

  assert.ok(report.invalid.length > 0, "the bad statement is reported");
  assert.equal(
    JSON.stringify(polygon.geometry),
    before,
    "the object keeps its last valid geometry",
  );
});

/* ============================================================ interaction */

test("15: hit-testing finds the polygon on every edge, including the closing one", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);

  /*
   * The midpoint of the closing edge: the last vertex back to the first.
   * This is the edge a naive "consecutive pairs" test misses.
   */
  const closingMid = { x: 0, y: 30 };

  assert.equal(
    m.hit.objectAtPoint(closingMid)?.id,
    polygon.id,
    "the closing edge is selectable",
  );

  const leftMid = { x: 30, y: 0 };
  assert.equal(
    m.hit.objectAtPoint(leftMid)?.id,
    polygon.id,
    "an ordinary edge is selectable",
  );

  const outside = { x: 500, y: 500 };
  assert.equal(
    m.hit.objectAtPoint(outside) ?? null,
    null,
    "so is empty space, and it is not the polygon",
  );
});

test("15b: a filled polygon is selectable from its interior; an unfilled one is not", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);
  const inside = { x: 30, y: 30 };

  assert.equal(
    m.hit.objectAtPoint(inside) ?? null,
    null,
    "an unfilled region is not a click trap",
  );

  m.schema.writeField(polygon, "fillMode", "solid");
  m.schema.writeField(polygon, "fill", "#cccccc");

  assert.equal(
    m.hit.objectAtPoint(inside)?.id,
    polygon.id,
    "a filled region is picked anywhere",
  );
});

test("15c: zoom and pan do not change which vertices the handles describe", () => {
  const m = modules();

  [0.25, 1, 4].forEach((zoom) => {
    freshSheet(m, { zoom });

    SQUARE.forEach((point) => clickAt(m, point));
    m.selection.finishActiveConstruction();

    const [polygon] = polygons(m);
    const handles = vertexHandles(m, polygon);

    assert.equal(handles.length, 4, `four handles at zoom ${zoom}`);
    handles.forEach((handle, index) => {
      assert.deepEqual(
        handle.point,
        polygon.geometry.points[index],
        `handle ${index} is on its vertex at zoom ${zoom}`,
      );
    });
  });
});

/* ============================================================ the tool */

test("16: the tool is a click tool - a bare click places a vertex rather than exiting", () => {
  const classification = loadModule("tool-classification.js");
  const dragCreation = loadModule("creation-drag.js");
  const constructionTools = loadModule("construction-tools.js");

  assert.equal(
    constructionTools.isConstructionTool("freeform-polygon"),
    true,
    "the click router hands it its clicks",
  );

  assert.equal(
    classification.isClickClickTool("freeform-polygon"),
    true,
    "a click is a vertex, not a request to leave the tool",
  );

  assert.equal(
    classification.shouldExitToSelectOnClick("freeform-polygon"),
    false,
    "so the first click can never drop the student into Select",
  );

  /*
   * THE POLYGON HAS TWO WAYS OF BEING DRAWN, AND BOTH ARE DELIBERATE.
   *
   * A bare click still places a vertex, and the press is a TRACE session that
   * records nothing until it travels - so a click that does not move reaches the
   * click router untouched and the vertex is placed exactly as before. A drag
   * traces the outline. Both commit through ONE polygon commit, so the object
   * type and the source are identical either way.
   */
  assert.equal(
    dragCreation.isDragCreationTool("freeform-polygon"),
    true,
    "a press may become a trace session, and a click is still a vertex",
  );

  const freeform = loadModule("freeform-trace.js");

  assert.equal(
    freeform.TRACE_START_PX > 0,
    true,
    "a press records no trace point until the pointer has actually travelled",
  );
});

test("16b: the pointer preview is driven for touch and pen, not only for a mouse", () => {
  const fs = require("fs");
  const { locate } = require("./helpers/source-path.cjs");

  const source = fs.readFileSync(locate("canvas-events.js"), "utf8");

  assert.match(
    source,
    /"pointermove",\s*event\s*=>\s*\{\s*if \(event\.pointerType && event\.pointerType !== "mouse"\)/,
    "a non-mouse pointermove updates the construction preview",
  );
});

test("16c: a double-click never reaches the polyline finisher for this tool", () => {
  const fs = require("fs");
  const { locate } = require("./helpers/source-path.cjs");

  const source = fs.readFileSync(locate("canvas-events.js"), "utf8");

  assert.match(
    source,
    /drawingState\.activeTool === "freeform-polygon"[\s\S]{0,1600}finishFreeformPolygonByDoubleClick\(\)/,
    "the polygon has its own double-click finisher",
  );
});

/* ============================================================ the panel */

test("the Features panel offers Object, Appearance and Transform for a polygon", () => {
  const m = modules();

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);
  const groups = m.schema.groupsFor(polygon);

  const ids = groups.map((group) => group.id);

  assert.ok(
    ids.includes("object"),
    `Object section present: ${ids.join(", ")}`,
  );
  assert.ok(
    ids.includes("appearance"),
    `Appearance section present: ${ids.join(", ")}`,
  );
  assert.ok(
    ids.includes("transform"),
    `Transform section present: ${ids.join(", ")}`,
  );

  const objectFields = groups
    .find((group) => group.id === "object")
    .fields.map((field) => field.key);
  assert.ok(objectFields.includes("name"), "Name");
  assert.ok(objectFields.includes("fixed"), "Fix");

  const appearanceFields = groups
    .find((group) => group.id === "appearance")
    .fields.map((field) => field.key);
  assert.ok(appearanceFields.includes("lineType"), "Line Style");
  assert.ok(appearanceFields.includes("stroke"), "Outline Colour");
  assert.ok(appearanceFields.includes("lineWidth"), "Thickness");
});

test("the polygon appears in the Objects list", () => {
  const m = modules();
  const objectsList = loadModule("objects-list.js");

  freshSheet(m);

  SQUARE.forEach((point) => clickAt(m, point));
  m.selection.finishActiveConstruction();

  const [polygon] = polygons(m);
  const markup = objectsList.objectsListMarkup(m.state.objects, []);

  assert.ok(
    markup.includes(`data-object-id="${polygon.id}"`),
    "the row is in the list",
  );
  assert.ok(markup.includes("Freeform Polygon"), "with its name");
  assert.ok(
    markup.includes(`data-visibility-for="${polygon.id}"`),
    "and its visibility control",
  );
});

/* ============================================================
 * THE CLICK AND DOUBLE-CLICK SEQUENCE
 * ============================================================
 *
 * A browser delivers a double-click as `click` (detail 1), `click` (detail 2)
 * and then `dblclick`. The tests below drive that exact sequence through the
 * canvas's real listeners, so they prove the input wiring rather than a
 * hand-call to the finisher.
 */

/*
 * A canvas event carrying the fields the click router reads: a client
 * position, the click `detail`, and the pointer modifiers. `detail` is what
 * distinguishes the two clicks of a double-click, and it is the same field a
 * touch double-tap fills in.
 */
function fireCanvasEvent(canvas, type, point, detail = 1) {
  const rect = canvas.getBoundingClientRect();

  const MouseEvent = globalThis.window.MouseEvent;

  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + point.x,
    clientY: rect.top + point.y,
    detail,
  });

  canvas.dispatchEvent(event);

  return event;
}

/*
 * Make the canvas a known size and the camera a known scale, so a screen
 * coordinate maps to a drawing coordinate the test can predict.
 */
function prepareCanvas(m) {
  const canvas = globalThis.document.querySelector(".drawing-canvas");

  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
  });

  /*
   * THE CANVAS'S REAL LISTENERS, installed once. The click and double-click
   * wiring lives in `installCanvasEvents` - the same function the application
   * boots - so a test that fires DOM events exercises the ROUTING (including
   * the rule that drops a double-click's second click), not a copy of it.
   */
  if (!canvas.dataset.listenersInstalled) {
    loadModule("canvas-events.js").installCanvasEvents();

    canvas.dataset.listenersInstalled = "true";
  }

  /* `canvasPointFromEvent` reads the element's own client size. */
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 600 });

  m.state.camera.zoom = 1;
  m.state.camera.panX = 0;
  m.state.camera.panY = 0;

  return canvas;
}

/* The number of vertices the polygon being drawn currently has. */
function vertexCount(m) {
  return Array.isArray(m.state.interaction.points) ? m.state.interaction.points.length : 0;
}

const SCREEN = {
  a: { x: 200, y: 200 },
  b: { x: 400, y: 200 },
  c: { x: 400, y: 400 },
  d: { x: 200, y: 400 },
};

test("double-click: the second click of the pair never becomes a vertex", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  /*
   * THREE ORDINARY CLICKS, then the double-click at the last position:
   * `click(1)`, `click(2)`, `dblclick` - exactly what the browser sends.
   */
  [SCREEN.a, SCREEN.b, SCREEN.c].forEach((point) => fireCanvasEvent(canvas, "click", point, 1));

  assert.equal(vertexCount(m), 3, "each single click is one vertex");

  fireCanvasEvent(canvas, "click", SCREEN.d, 1);

  assert.equal(vertexCount(m), 4, "the first click of the pair places the final vertex");

  fireCanvasEvent(canvas, "click", SCREEN.d, 2);

  assert.equal(
    vertexCount(m),
    4,
    "the second click of the pair is not a vertex"
  );

  fireCanvasEvent(canvas, "dblclick", SCREEN.d, 2);

  const [polygon] = polygons(m);

  assert.ok(polygon, "the polygon was completed");
  assert.equal(
    polygon.geometry.points.length,
    4,
    "four clicks made four vertices - the double-click's second half added none"
  );

  /* No duplicate: no two consecutive vertices are the same point. */
  const ring = pointsOf(polygon);

  ring.forEach((point, index) => {
    const next = ring[(index + 1) % ring.length];

    assert.ok(
      Math.abs(point.x - next.x) > 1e-9 || Math.abs(point.y - next.y) > 1e-9,
      `vertices ${index} and ${(index + 1) % ring.length} form a real edge`
    );
  });

  /*
   * THE FINAL VERTEX IS THE DOUBLE-CLICKED POINT, KEPT ONCE, and the closing
   * edge runs from it back to the FIRST vertex - not to a duplicate of itself.
   */
  const first = ring[0];
  const last = ring[3];

  assert.ok(
    Math.hypot(last.x - first.x, last.y - first.y) > 1e-6,
    "the closing edge has real length"
  );
  assert.ok(
    last.x !== first.x || last.y !== first.y,
    "the last vertex is its own point, not a copy of the first"
  );
});

test("double-click: a single click still places exactly one vertex", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  fireCanvasEvent(canvas, "click", SCREEN.a, 1);

  assert.equal(vertexCount(m), 1, "one click, one vertex");
});

test("double-click: a second click on the SAME spot adds nothing", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  fireCanvasEvent(canvas, "click", SCREEN.a, 1);
  fireCanvasEvent(canvas, "click", SCREEN.b, 1);

  /* A plain click again on the last vertex - detail 1, so it is a real click. */
  fireCanvasEvent(canvas, "click", SCREEN.b, 1);

  assert.equal(vertexCount(m), 2, "repeating the last vertex is not a third vertex");
});

test("double-click: rapid separate clicks are still separate vertices", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  [SCREEN.a, SCREEN.b, SCREEN.c, SCREEN.d].forEach((point) => {
    fireCanvasEvent(canvas, "click", point, 1);
  });

  assert.equal(vertexCount(m), 4, "four deliberate clicks are four vertices, however quickly they come");
});

test("double-click: a double-tap reports the same detail and behaves the same", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  [SCREEN.a, SCREEN.b, SCREEN.c].forEach((point) => fireCanvasEvent(canvas, "click", point, 1));

  /*
   * A touch double-tap is delivered as a `click` pair with detail 1 then 2,
   * exactly as a mouse double-click is - the pointer events differ, the click
   * detail does not. Driving that sequence is therefore the touch case.
   */
  fireCanvasEvent(canvas, "click", SCREEN.d, 1);
  fireCanvasEvent(canvas, "click", SCREEN.d, 2);
  fireCanvasEvent(canvas, "dblclick", SCREEN.d, 2);

  const [polygon] = polygons(m);

  assert.ok(polygon, "a double-tap completes the polygon");
  assert.equal(polygon.geometry.points.length, 4, "and introduces no duplicate vertex");
});

test("double-click: the tool's click router ignores a repeated click outright", () => {
  const fs = require("fs");
  const { locate } = require("./helpers/source-path.cjs");

  const source = fs.readFileSync(locate("canvas-events.js"), "utf8");

  assert.match(
    source,
    /event\.detail \|\| 0\) > 1[\s\S]{0,160}freeform-polygon/,
    "the router drops the second click of a multi-click gesture before the tool sees it"
  );
});

test("double-click: near the first vertex still closes on the click, not the gesture", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  [SCREEN.a, SCREEN.b, SCREEN.c].forEach((point) => fireCanvasEvent(canvas, "click", point, 1));

  /* A click a couple of pixels from the first vertex closes it. */
  fireCanvasEvent(canvas, "click", { x: SCREEN.a.x + 2, y: SCREEN.a.y + 2 }, 1);

  const [polygon] = polygons(m);

  assert.ok(polygon, "closing by clicking the first vertex still works");
  assert.equal(polygon.geometry.points.length, 3, "and the closing click adds no vertex");
});

test("double-click: Enter still completes the polygon", () => {
  const m = modules();

  freshSheet(m);

  const canvas = prepareCanvas(m);

  [SCREEN.a, SCREEN.b, SCREEN.c].forEach((point) => fireCanvasEvent(canvas, "click", point, 1));

  assert.equal(m.selection.finishActiveConstruction(), true);
  assert.equal(polygons(m).length, 1);
});
