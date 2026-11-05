/*
 * ========================================================
 * THE RESERVOIR / TANK
 * ========================================================
 *
 * The Fluids vessel end to end: drawing it in every direction, its two
 * configurations, its geometry handles, its fluid level, its Features rows, its
 * source round trip and its interaction with a Pipe / Duct.
 *
 * ============================================================
 * THE ORIENTATION IS ASSERTED ON THE RENDERED PICTURE
 * ============================================================
 *
 * DAETUM's world Y axis grows UPWARD; the renderer flips it into SCREEN y,
 * which grows DOWNWARD. A test that only reads model numbers can therefore pass
 * while the sheet shows an upside-down tank - which is exactly what happened.
 *
 * So every orientation test here reads the real SVG the canvas receives and
 * reasons in SCREEN terms: a small y is the TOP of the picture, a large y is the
 * BOTTOM. The vessel must always have its floor at the bottom and its mouth or
 * lid at the top, and its liquid must always be BELOW its surface.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

/* Pixels per drawing unit at the camera zoom the tests use (zoom 1). */
const PIXELS_PER_UNIT = 2.4;
const CANVAS = {
  left: 0,
  top: 0,
  width: 800,
  height: 600,
  right: 800,
  bottom: 600,
  x: 0,
  y: 0,
};

let page = null;

function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return page;
}

async function modules() {
  ready();
  await whenReady();

  const dom = require(locate("interaction/dom.js"));

  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", {
    value: CANVAS.width,
    configurable: true,
  });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", {
    value: CANVAS.height,
    configurable: true,
  });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const editorState = require(locate("editor-state.js")).editorState;
  const precision = require(locate("pointer-precision.js"));

  /* The panel wires the vessel's object provider in at module load. */
  require(locate("features-editor.js"));

  return {
    dom,
    editorState,
    precision,
    state: require(locate("editor-state.js")).drawingState,
    ds: require(locate("drawing-state.js")).default,
    vessel: require(locate("model/fluids/reservoir-tank.js")).default,
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    tool: require(locate("fluids-schematic-tool.js")),
    pipeTool: require(locate("pipe-duct-tool.js")),
    schema: require(locate("feature-schema.js")),
    sync: require(locate("source-synchronization.js")),
    apply: require(locate("source-model-apply.js")),
    handles: require(locate("handles.js")),
    drag: require(locate("drag.js")),
    creation: require(locate("creation-drag.js")),
    renderer: require(locate("renderer.js")).default,
    palette: require(locate("svg-primitives.js")),
    toolSettingsStore: require(locate("tool-settings-store.js")),
  };
}

/* A clean sheet at a known scale, with nothing selected. */
function reset(m) {
  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.state.interaction.phase = "idle";
  m.state.interaction.preview = null;
  m.state.manipulationDrag = null;
  m.editorState.creationDrag = null;
  m.state.history = { past: [], future: [] };
  m.state.grid = { ...(m.state.grid || {}), snapToGrid: false };
  m.state.camera.zoom = 1;
  m.state.camera.panX = 0;
  m.state.camera.panY = 0;

  /* Application state: the pointer kind persists until the next gesture. */
  m.precision.setPointerKind("mouse");
}

/* Whether a painted horizontal line is the FLUID SURFACE rather than a wall. */
function isSurfaceLine(painted, line) {
  if (Math.abs(line.y1 - line.y2) > 0.01) {
    return false;
  }

  const left = Math.min(line.x1, line.x2);
  const right = Math.max(line.x1, line.x2);

  return left > painted.leftWall + 0.01 || right < painted.rightWall - 0.01;
}

/* A pointer event at a drawing (world) point, as the canvas reports it. */
function pointer(type, point, pointerType = "mouse") {
  const event = new window.MouseEvent(type, {
    clientX: CANVAS.left + CANVAS.width / 2 + point.x * PIXELS_PER_UNIT,
    clientY: CANVAS.top + CANVAS.height / 2 - point.y * PIXELS_PER_UNIT,
    bubbles: true,
    button: 0,
  });

  event.pointerId = 1;
  event.pointerType = pointerType;

  return event;
}

/*
 * DRAW A VESSEL WITH THE REAL GESTURE: arm the tool, press, move past the drag
 * threshold, release. Nothing is written into the document by the test itself.
 */
function drawVessel(m, from, to, pointerType = "mouse", style = null) {
  const settings = m.toolSettingsStore.settingsFor("reservoir-tank");
  const previous = settings.vesselStyle;

  if (style) {
    settings.vesselStyle = style;
  }

  m.tool.beginVesselToolSession();

  assert.equal(
    m.creation.beginCreationDrag(pointer("pointerdown", from, pointerType)),
    true,
    "the press arms the gesture",
  );

  m.creation.moveCreationDrag(pointer("pointermove", from, pointerType));
  m.creation.moveCreationDrag(pointer("pointermove", to, pointerType));

  assert.ok(m.editorState.creationDrag?.moved, "the gesture is a drag");

  m.creation.finishCreationDrag(pointer("pointerup", to, pointerType));

  settings.vesselStyle = previous;

  return (
    m.state.objects.find(
      (object) => object.id === m.state.selection.selectedObjectIds[0],
    ) || null
  );
}

function sourceFor(m, object) {
  return m.sync.sourceForObject(object);
}

function applySource(m, block) {
  const source = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${block}\n\\end{tikzpicture}`;

  return m.apply.applyParsedSourceToDrawing({
    model: m.ds,
    state: m.state,
    source,
    editable: true,
    removeMissing: false,
  });
}

const live = (m, object) =>
  m.state.objects.find((candidate) => candidate.id === object.id) || object;

/* ============================================================
 * THE RENDERED PICTURE, IN SCREEN TERMS
 * ============================================================
 *
 * Reads the vessel's own group from the canvas and reports what a student
 * actually sees. Screen y grows DOWNWARD, so `top < bottom`.
 */
function paintedVessel(m, id) {
  const target = m.dom.drawingCanvas;

  target.innerHTML = "";
  m.renderer.renderDrawing(m.state, target);

  const svg = target.querySelector("svg") || target;

  /* Only the vessel's own feature group - never the grid or the overlay. */
  const group = svg.querySelector(`[data-feature-id="${id}"]`);

  assert.ok(group, `the vessel ${id} is painted`);

  const lines = [...group.querySelectorAll("line")].map((element) => ({
    x1: Number(element.getAttribute("x1")),
    y1: Number(element.getAttribute("y1")),
    x2: Number(element.getAttribute("x2")),
    y2: Number(element.getAttribute("y2")),
  }));

  /*
   * HORIZONTAL MEANS HORIZONTAL. A vertical wall of zero width would satisfy
   * `y1 === y2` as well, so each test is stated against the OTHER axis.
   */
  const horizontal = lines.filter(
    (line) => Math.abs(line.y1 - line.y2) < 0.01 && Math.abs(line.x1 - line.x2) > 0.01,
  );
  const vertical = lines.filter((line) => Math.abs(line.x1 - line.x2) < 0.01 && Math.abs(line.y1 - line.y2) > 0.01);

  const walls = lines
    .map((line) => line.y1)
    .concat(lines.map((line) => line.y2));
  const top = Math.min(...walls);
  const bottom = Math.max(...walls);

  const wallXs = vertical.map((wall) => wall.x1);
  const leftWall = Math.min(...wallXs);
  const rightWall = Math.max(...wallXs);

  /*
   * THE SURFACE IS THE HORIZONTAL LINE THAT STOPPED SHORT OF THE WALLS.
   *
   * The walls themselves are excluded first - the floor and the lid span the
   * full width, while the surface is inset at both ends. Without that step the
   * LID would be read as "the first inset row" and the midpoint test would
   * compare the water against the roof.
   */
  const isWall = (line) =>
    Math.abs(Math.min(line.x1, line.x2) - leftWall) < 0.01 && Math.abs(Math.max(line.x1, line.x2) - rightWall) < 0.01;

  const interiorRows = horizontal.filter((line) => !isWall(line));

  const surfaceRow = interiorRows.length
    ? Math.min(...interiorRows.map((line) => line.y1))
    : null;

  const surface = Number.isFinite(surfaceRow) ? surfaceRow : null;

  const polygon = group.querySelector("polygon[fill-opacity]");

  const liquid = polygon
    ? polygon
        .getAttribute("points")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number))
    : [];

  return {
    lines,
    horizontal,
    vertical,
    top,
    bottom,
    leftWall,
    rightWall,
    surface: Number.isFinite(surface) ? surface : null,
    liquid,
    fill: polygon ? polygon.getAttribute("fill") : null,
  };
}

/* ============================================================
 * 1 & 2. CREATING A RESERVOIR AND A TANK
 * ============================================================ */

test("a drag creates a Reservoir, selects it, and shows its open mouth at the top", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    "mouse",
    "open",
  );

  assert.ok(vessel, "the vessel was created");
  assert.equal(vessel.type, "reservoir-tank");
  assert.equal(vessel.engineering.vesselStyle, "open");
  assert.equal(
    m.state.selection.selectedObjectIds[0],
    vessel.id,
    "it is selected after creation",
  );
  assert.equal(vessel.geometry.width, 40);
  assert.equal(vessel.geometry.height, 30);

  /* AN OPEN RESERVOIR HAS THREE WALLS: two sides and a floor, no top. */
  assert.equal(
    m.vessel.vesselSegments(vessel).length,
    3,
    "an open reservoir has no top line",
  );
  assert.equal(m.state.objects.length, 1, "it is one object, not four walls");

  const painted = paintedVessel(m, vessel.id);

  assert.equal(
    painted.horizontal.length,
    2,
    "the floor and the fluid surface, and no lid",
  );
  assert.equal(painted.vertical.length, 2, "the two side walls");

  /* THE MOUTH IS AT THE TOP OF THE SCREEN. */
  painted.vertical.forEach((wall) => {
    assert.equal(
      Math.max(wall.y1, wall.y2),
      painted.bottom,
      "each wall starts at the floor",
    );
    assert.equal(
      Math.min(wall.y1, wall.y2),
      painted.top,
      "and rises to the mouth",
    );
  });
});

test("a drag creates a Tank when the chosen configuration is Tank, with a lid at the top", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    "mouse",
    "closed",
  );

  assert.equal(vessel.engineering.vesselStyle, "closed");
  assert.equal(
    m.vessel.vesselSegments(vessel).length,
    4,
    "a closed tank has a top line",
  );

  const painted = paintedVessel(m, vessel.id);

  /* Three horizontal lines: the lid, the surface, the floor - in that order. */
  assert.equal(painted.horizontal.length, 3, "a lid, a surface and a floor");

  const rows = painted.horizontal.map((line) => line.y1).sort((a, b) => a - b);

  assert.equal(
    rows[0],
    painted.top,
    "the lid is the highest line on the screen",
  );
  assert.equal(rows[2], painted.bottom, "the floor is the lowest");
  assert.ok(
    rows[1] > rows[0] && rows[1] < rows[2],
    "the surface sits between them",
  );
});

test("every vessel carries a fluid level at 50% from the moment it exists", async () => {
  const m = await modules();

  for (const style of ["open", "closed"]) {
    reset(m);

    const vessel = drawVessel(
      m,
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      "mouse",
      style,
    );

    assert.equal(
      m.vessel.fluidLevelPercentOf(vessel),
      50,
      `${style}: the level starts at 50%`,
    );
    assert.equal(
      m.vessel.fluidLevelEnabledOf(vessel),
      true,
      `${style}: and it is shown`,
    );

    const painted = paintedVessel(m, vessel.id);

    /* 50% is the midpoint, in screen terms the middle of the picture. */
    assert.ok(
      Math.abs(painted.surface - (painted.top + painted.bottom) / 2) < 1,
      `${style}: the surface is at the midpoint`,
    );
  }
});

/* ============================================================
 * 3. SWITCHING CONFIGURATION
 * ============================================================ */

test("switching Reservoir <-> Tank keeps ONE object: id, name, style and level survive", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    "mouse",
    "open",
  );

  m.schema.writeField(vessel, "name", "Supply Reservoir");
  vessel.style = { ...vessel.style, lineType: "dashed" };
  m.schema.writeField(vessel, "vesselFluidPercent", 30);

  const id = vessel.id;
  const count = m.state.objects.length;

  assert.equal(m.schema.writeField(vessel, "vesselStyle", "closed"), true);
  assert.equal(vessel.id, id, "the id is stable");
  assert.equal(vessel.name, "Supply Reservoir", "the name survives");
  assert.equal(vessel.style.lineType, "dashed", "the appearance survives");
  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    30,
    "the fluid level survives",
  );
  assert.equal(m.vessel.vesselSegments(vessel).length, 4, "the lid appears");

  assert.equal(m.schema.writeField(vessel, "vesselStyle", "open"), true);
  assert.equal(m.vessel.vesselSegments(vessel).length, 3, "the lid goes");
  assert.equal(m.state.objects.length, count, "no second object was created");

  /*
   * THE PICTURE AGREES. A reservoir has no lid, so the only line the tank adds
   * is one across the TOP - counted on the real markup, not inferred from rows
   * the helper already interprets.
   */
  m.schema.writeField(vessel, "vesselStyle", "open");
  const open = paintedVessel(m, id);

  m.schema.writeField(vessel, "vesselStyle", "closed");
  const closed = paintedVessel(m, id);

  /*
   * THE WALLS. `vesselSegments` is the model's own statement of them, and it is
   * what the renderer draws - the fluid surface is a separate line inside the
   * vessel and must not be counted here.
   */
  const walls = (painted) => painted.vertical.length + painted.horizontal.filter((line) => !isSurfaceLine(painted, line)).length;

  assert.equal(walls(open), 3, "an open reservoir draws three walls");
  assert.equal(walls(closed), 4, "a closed tank draws four");

  /* The added line is across the top of the screen. */
  assert.ok(
    closed.horizontal.some((line) => Math.abs(line.y1 - closed.top) < 0.01),
    "closing adds the lid across the top",
  );
  assert.equal(
    open.horizontal.some((line) => Math.abs(line.y1 - open.top) < 0.01),
    false,
    "and the open reservoir has none",
  );
});

/* ============================================================
 * 4. DRAWING IN ALL DRAG DIRECTIONS
 * ============================================================ */

/* The four gestures, named by the corner they start at on the SCREEN. */
const DRAG_DIRECTIONS = [
  ["top-left to bottom-right", { x: 0, y: 40 }, { x: 40, y: 0 }],
  ["top-right to bottom-left", { x: 40, y: 40 }, { x: 0, y: 0 }],
  ["bottom-left to top-right", { x: 0, y: 0 }, { x: 40, y: 40 }],
  ["bottom-right to top-left", { x: 40, y: 0 }, { x: 0, y: 40 }],
];

test("a vessel can be dragged out in every direction, and the box is normalised", async () => {
  const m = await modules();

  for (const [label, from, to] of DRAG_DIRECTIONS) {
    for (const style of ["open", "closed"]) {
      reset(m);

      const vessel = drawVessel(m, from, to, "mouse", style);

      assert.ok(vessel, `${label} (${style}) creates a vessel`);

      /* The anchor is the vessel's own BOTTOM-LEFT corner in world terms. */
      assert.deepEqual(
        vessel.geometry.position,
        { x: 0, y: 0 },
        `${label} (${style}): the same anchor whichever way it was dragged`,
      );
      assert.equal(vessel.geometry.width, 40);
      assert.equal(vessel.geometry.height, 40);
    }
  }
});

test("a drag with no area is refused rather than becoming a zero-sized line", async () => {
  const m = await modules();
  reset(m);

  assert.equal(
    m.vessel.vesselFromDrag({ x: 10, y: 10 }, { x: 10, y: 10 }),
    null,
  );
  assert.equal(
    m.vessel.vesselFromDrag({ x: 10, y: 10 }, { x: 10.5, y: 30 }),
    null,
    "a sub-minimum side is refused",
  );

  m.tool.beginVesselToolSession();
  m.creation.beginCreationDrag(pointer("pointerdown", { x: 5, y: 5 }));
  m.creation.finishCreationDrag(pointer("pointerup", { x: 5, y: 5 }));

  assert.equal(m.state.objects.length, 0, "a click is not a vessel");
});

/* ============================================================
 * 5. THE LIVE PREVIEW
 * ============================================================ */

test("the live preview is upright and matches the committed vessel", async () => {
  const m = await modules();
  reset(m);

  m.tool.beginVesselToolSession();
  m.creation.beginCreationDrag(pointer("pointerdown", { x: 40, y: 40 }));
  m.creation.moveCreationDrag(pointer("pointermove", { x: 0, y: 0 }));

  const preview = m.state.interaction.preview;

  assert.ok(preview, "the gesture shows a preview");
  assert.equal(
    m.state.objects.length,
    0,
    "nothing is registered while dragging",
  );

  const previewRect = m.vessel.vesselRect(preview);

  assert.deepEqual(
    previewRect.position,
    { x: 0, y: 0 },
    "the preview box is normalised",
  );
  assert.equal(previewRect.width, 40);

  /* The preview carries the same level the committed vessel will. */
  assert.equal(
    m.vessel.fluidLevelPercentOf(preview),
    50,
    "the preview shows the default level",
  );

  const previewSegments = m.vessel.vesselSegments(preview);

  m.creation.finishCreationDrag(pointer("pointerup", { x: 0, y: 0 }));

  const committed = live(m, { id: m.state.selection.selectedObjectIds[0] });
  const committedRect = m.vessel.vesselRect(committed);

  assert.deepEqual(
    committedRect.position,
    previewRect.position,
    "the committed box is where the preview was",
  );
  assert.equal(committedRect.width, previewRect.width);
  assert.deepEqual(
    m.vessel.vesselSegments(committed),
    previewSegments,
    "the walls do not move on release",
  );
});

test("Escape clears the preview and leaves no object behind", async () => {
  const m = await modules();
  reset(m);

  m.tool.beginVesselToolSession();
  m.creation.beginCreationDrag(pointer("pointerdown", { x: 0, y: 0 }));
  m.creation.moveCreationDrag(pointer("pointermove", { x: 30, y: 30 }));

  assert.ok(m.state.interaction.preview, "a preview is showing");

  /* The canvas's own cancelling gesture: a pointercancel, not a made-up reset. */
  const cancel = new window.MouseEvent("pointercancel", { bubbles: true, button: 0 });

  cancel.pointerId = 1;
  cancel.pointerType = "mouse";

  m.dom.drawingCanvas.dispatchEvent(cancel);

  assert.equal(m.state.objects.length, 0, "nothing was created");
  assert.equal(m.editorState.creationDrag, null, "the gesture is over");
});

/* ============================================================
 * 6. RESIZING AND MOVING
 * ============================================================ */

test("the four corner handles resize the vessel and keep it upright", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  for (const index of [0, 1, 2, 3]) {
    /* A fresh box for each corner, so a resize cannot move the next grab. */
    m.state.activeTool = "select";
    m.state.selection.selectedObjectIds = [vessel.id];

    m.schema.writeField(vessel, "vesselWidth", 40);
    m.schema.writeField(vessel, "vesselHeight", 30);
    vessel.geometry = { ...vessel.geometry, position: { x: 0, y: 0 } };

    const handle = m.handles
      .editableHandlesFor(vessel)
      .find((candidate) => candidate.kind === `vessel-corner${index}`);

    assert.ok(handle, `corner ${index} has a handle`);

    const arrived = m.drag.beginManipulationDrag(
      pointer("pointerdown", handle.point),
    );

    assert.ok(arrived, `a press on corner ${index} starts a drag`);
    assert.equal(
      m.editorState.manipulationDrag?.kind,
      `vessel-corner${index}`,
      `corner ${index} takes the press`,
    );

    const target = { x: handle.point.x + 5, y: handle.point.y + 5 };

    m.drag.updateManipulationDrag(pointer("pointermove", target));
    m.drag.finishManipulationDrag(pointer("pointerup", target));

    const rect = m.vessel.vesselRect(vessel);

    assert.ok(
      rect.width >= m.vessel.MIN_VESSEL_SIDE &&
        rect.height >= m.vessel.MIN_VESSEL_SIDE,
      "the box stays valid",
    );

    const painted = paintedVessel(m, vessel.id);

    assert.ok(
      painted.top < painted.bottom,
      `corner ${index}: the vessel is still upright`,
    );
    assert.ok(
      painted.surface !== null &&
        painted.surface > painted.top &&
        painted.surface < painted.bottom,
      `corner ${index}: the surface is still inside the vessel`,
    );
  }
});

test("the boundary handles resize one wall at a time, and never turn the vessel over", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 40 });

  m.schema.writeField(vessel, "vesselStyle", "closed");
  m.schema.writeField(vessel, "vesselFluidPercent", 50);

  /*
   * World y grows UP, so dragging the LID handle DOWN the screen lowers its
   * world y and shrinks the vessel from the top.
   *
   * Each handle sits a small GAP outside its wall, so the pointer is aimed at
   * the wall's own position (x = 0, 50, 20, 20) rather than at the handle.
   */
  const cases = [
    ["vessel-edge-left", { x: -10, y: 20 }, (r) => r.width === 50 && Math.abs(r.position.x + 10) < 1],
    ["vessel-edge-right", { x: 50, y: 20 }, (r) => r.width === 50 && Math.abs(r.position.x) < 1],
    ["vessel-edge-top", { x: 20, y: 28 }, (r) => r.height === 28 && Math.abs(r.position.y) < 1],
    ["vessel-edge-bottom", { x: 20, y: 12 }, (r) => r.height === 28 && Math.abs(r.position.y - 12) < 1],
  ];

  for (const [kind, target, ok] of cases) {
    m.state.activeTool = "select";
    m.state.selection.selectedObjectIds = [vessel.id];

    m.schema.writeField(vessel, "vesselWidth", 40);
    m.schema.writeField(vessel, "vesselHeight", 40);
    vessel.geometry = { ...vessel.geometry, position: { x: 0, y: 0 } };

    const handle = m.handles
      .editableHandlesFor(vessel)
      .find((candidate) => candidate.kind === kind);

    m.drag.beginManipulationDrag(pointer("pointerdown", handle.point));
    m.drag.updateManipulationDrag(pointer("pointermove", target));
    m.drag.finishManipulationDrag(pointer("pointerup", target));

    const rect = m.vessel.vesselRect(vessel);

    assert.ok(
      ok(rect),
      `${kind} moved only its own wall (${JSON.stringify(rect.position)} ${rect.width}x${rect.height})`,
    );
    assert.ok(
      rect.width >= m.vessel.MIN_VESSEL_SIDE &&
        rect.height >= m.vessel.MIN_VESSEL_SIDE,
    );
    assert.equal(
      m.vessel.fluidLevelPercentOf(vessel),
      50,
      `${kind} kept the level percentage`,
    );
  }

  /* A wall dragged past its opposite collapses the box; it never inverts it. */
  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  m.schema.writeField(vessel, "vesselWidth", 40);
  vessel.geometry = { ...vessel.geometry, position: { x: 0, y: 0 } };

  const left = m.handles
    .editableHandlesFor(vessel)
    .find((candidate) => candidate.kind === "vessel-edge-left");

  m.drag.beginManipulationDrag(pointer("pointerdown", left.point));
  m.drag.updateManipulationDrag(
    pointer("pointermove", { x: 200, y: left.point.y }),
  );
  m.drag.finishManipulationDrag(
    pointer("pointerup", { x: 200, y: left.point.y }),
  );

  assert.equal(
    m.vessel.vesselRect(vessel).width,
    m.vessel.MIN_VESSEL_SIDE,
    "it collapses rather than inverting",
  );
});

test("dragging a handle never moves the whole object", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  const handle = m.handles
    .editableHandlesFor(vessel)
    .find((candidate) => candidate.kind === "vessel-corner2");
  const target = { x: handle.point.x + 10, y: handle.point.y };

  m.drag.beginManipulationDrag(pointer("pointerdown", handle.point));
  m.drag.updateManipulationDrag(pointer("pointermove", target));
  m.drag.finishManipulationDrag(pointer("pointerup", target));

  /* The corner opposite the grabbed one is what stays put. */
  assert.deepEqual(
    vessel.geometry.position,
    { x: 0, y: 0 },
    "the opposite corner did not move",
  );
  assert.equal(vessel.geometry.width, 50, "only the grabbed side grew");
  assert.equal(vessel.geometry.height, 30);
});

test("a completed vessel moves as a whole through the ordinary body drag", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  const centre = m.vessel.vesselRect(vessel).centre;

  /*
   * THE DELTA IS GRID-ALIGNED. The sheet's grid spacing is 7.5 units and grid
   * snapping is on by default, so a 30 x 15 drag lands on 22.5 x 15 - the same
   * snapping every other object gets.
   */
  m.drag.beginManipulationDrag(pointer("pointerdown", centre));
  m.drag.updateManipulationDrag(
    pointer("pointermove", { x: centre.x + 30, y: centre.y + 15 }),
  );
  m.drag.finishManipulationDrag(
    pointer("pointerup", { x: centre.x + 30, y: centre.y + 15 }),
  );

  assert.deepEqual(
    vessel.geometry.position,
    { x: 22.5, y: 15 },
    "the vessel moved by the drag's delta",
  );
  assert.equal(vessel.geometry.width, 40, "and did not resize");
});

/* ============================================================
 * 7. FIX
 * ============================================================ */

test("Fix locks the vessel: its handles go away and it cannot be moved or levelled", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  assert.ok(
    m.handles.editableHandlesFor(vessel).length > 0,
    "an unlocked vessel has handles",
  );
  assert.ok(
    m.handles
      .editableHandlesFor(vessel)
      .some((handle) => handle.kind === "vessel-level"),
    "including the fluid-level handle",
  );

  assert.equal(m.schema.writeField(vessel, "fixed", true), true);
  assert.equal(vessel.locked, true, "Fix locks the object");
  assert.deepEqual(
    m.handles.editableHandlesFor(vessel),
    [],
    "a fixed vessel has no handles",
  );

  const before = { ...vessel.geometry.position };

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  m.drag.beginManipulationDrag(pointer("pointerdown", { x: 20, y: 15 }));
  m.drag.updateManipulationDrag(pointer("pointermove", { x: 60, y: 40 }));
  m.drag.finishManipulationDrag(pointer("pointerup", { x: 60, y: 40 }));

  assert.deepEqual(vessel.geometry.position, before, "it did not move");
  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    50,
    "and its level did not change",
  );

  assert.equal(m.schema.writeField(vessel, "fixed", false), true);
  assert.equal(Boolean(vessel.locked), false, "Unfix unlocks it");
  assert.ok(
    m.handles.editableHandlesFor(vessel).length > 0,
    "Unfix gives the handles back",
  );
});

/* ============================================================
 * 8. APPEARANCE
 * ============================================================ */

test("appearance properties are the existing controls and reach the outline and the liquid", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  assert.equal(m.schema.writeField(vessel, "lineType", "dashed"), true);
  assert.equal(m.schema.writeField(vessel, "stroke", "#ff0000"), true);
  assert.equal(m.schema.writeField(vessel, "lineWidth", 3), true);
  assert.equal(m.schema.writeField(vessel, "fillMode", "solid"), true);
  assert.equal(m.schema.writeField(vessel, "fill", "#00ff00"), true);

  assert.equal(vessel.style.lineType, "dashed");
  assert.equal(vessel.style.stroke, "#ff0000");
  assert.equal(vessel.style.lineWidth, 3);
  assert.equal(vessel.style.fill, "#00ff00");

  /*
   * THE FILL IS THE LIQUID: it paints the region below the surface.
   *
   * The canvas resolves a chosen colour against the active theme's palette, so
   * the test asks the SAME resolver the renderer uses rather than comparing a
   * raw hex with the palette's own shade.
   */
  const painted = paintedVessel(m, vessel.id);

  assert.equal(
    painted.fill,
    m.palette.paintColour("#00ff00"),
    "the liquid takes the chosen fill colour",
  );
  assert.notEqual(
    painted.fill,
    m.palette.paintColour("#ff0000"),
    "and it is not some other colour",
  );

  const liquidYs = painted.liquid.map((corner) => corner[1]);

  assert.ok(
    Math.min(...liquidYs) >= painted.surface - 1,
    "no liquid is painted above the surface",
  );
  assert.ok(
    Math.max(...liquidYs) <= painted.bottom + 1,
    "and none below the floor",
  );

  assert.match(
    sourceFor(m, vessel),
    /dashed/,
    "the source states the line type",
  );
});

test("the liquid fill follows the percentage and stays inside the vessel", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 40 },
    "mouse",
    "closed",
  );

  m.schema.writeField(vessel, "fillMode", "solid");
  m.schema.writeField(vessel, "fill", "#3366cc");

  const levels = [
    [0, 0],
    [25, 0.25],
    [50, 0.5],
    [75, 0.75],
    [100, 1],
  ];

  for (const [percent, fraction] of levels) {
    m.schema.writeField(vessel, "vesselFluidPercent", percent);

    const painted = paintedVessel(m, vessel.id);
    const height = painted.bottom - painted.top;
    const expected = painted.bottom - height * fraction;

    assert.ok(
      Math.abs(painted.surface - expected) < 1,
      `${percent}% surface at the right height`,
    );

    if (percent === 0) {
      assert.equal(painted.liquid.length, 0, "0% paints no liquid at all");
    } else {
      const ys = painted.liquid.map((corner) => corner[1]);
      const xs = painted.liquid.map((corner) => corner[0]);

      assert.ok(
        Math.abs(Math.min(...ys) - painted.surface) < 1,
        `${percent}%: the liquid starts at the surface`,
      );
      assert.ok(
        Math.abs(Math.max(...ys) - painted.bottom) < 1,
        `${percent}%: and reaches the floor`,
      );

      const walls = painted.vertical.map((wall) => wall.x1);
      const leftWall = Math.min(...walls);
      const rightWall = Math.max(...walls);

      assert.ok(
        Math.min(...xs) >= leftWall,
        `${percent}%: the liquid stays inside the left wall`,
      );
      assert.ok(
        Math.max(...xs) <= rightWall,
        `${percent}%: and inside the right wall`,
      );
    }
  }
});

/* ============================================================
 * 9. THE FLUID LEVEL AND ITS HANDLE
 * ============================================================ */

test("both configurations carry the same fluid level, and it renders at 0, 25, 50, 75 and 100 percent", async () => {
  const m = await modules();

  for (const style of ["open", "closed"]) {
    reset(m);

    const vessel = drawVessel(
      m,
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      "mouse",
      style,
    );

    for (const percent of [0, 25, 50, 75, 100]) {
      assert.equal(
        m.schema.writeField(vessel, "vesselFluidPercent", percent),
        true,
        `${style}: ${percent}% is applied`,
      );
      assert.equal(m.vessel.fluidLevelPercentOf(vessel), percent);

      const painted = paintedVessel(m, vessel.id);

      assert.ok(
        painted.surface !== null,
        `${style} at ${percent}%: the surface is drawn`,
      );

      /* Inside the walls, never on or outside them. */
      assert.ok(
        painted.surface >= painted.top - 0.01,
        `${style} at ${percent}%: not above the lid`,
      );
      assert.ok(
        painted.surface <= painted.bottom + 0.01,
        `${style} at ${percent}%: not below the floor`,
      );

      const surface = painted.horizontal.find(
        (line) => Math.abs(line.y1 - painted.surface) < 0.01,
      );

      assert.ok(surface, `${style} at ${percent}%: the surface is horizontal`);
      assert.ok(
        surface.x1 > painted.vertical[0].x1 ||
          surface.x1 > Math.min(...painted.vertical.map((w) => w.x1)),
        `${style} at ${percent}%: it starts inside the wall`,
      );
    }

    /*
     * 100% OF A RESERVOIR MUST NOT CLOSE ITS TOP.
     *
     * The vessel's lines are its WALLS plus the fluid surface, which is drawn
     * at every percentage - so a reservoir paints 3 + 1 and a tank 4 + 1. A lid
     * appearing at 100% would make it one more, which is the failure this
     * guards against.
     */
    m.schema.writeField(vessel, "vesselFluidPercent", 100);

    const full = paintedVessel(m, vessel.id);
    const walls = style === "open" ? 3 : 4;

    assert.equal(
      full.lines.length,
      walls + 1,
      `${style} at 100%: the same walls as at any other level`,
    );
    assert.equal(
      m.vessel.vesselSegments(vessel).length,
      walls,
      `${style} at 100%: a full reservoir still has an open mouth`,
    );
  }
});

test("the fluid-level handle moves the surface and never the vessel", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 40 },
    "mouse",
    "closed",
  );

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  const handle = m.handles
    .editableHandlesFor(vessel)
    .find((candidate) => candidate.kind === "vessel-level");

  assert.ok(handle, "the level has its own handle");
  assert.ok(
    handle.point.y > 0 && handle.point.y < 40,
    "it sits on the surface, inside the vessel",
  );

  const before = { ...vessel.geometry };

  m.drag.beginManipulationDrag(pointer("pointerdown", handle.point));

  assert.equal(
    m.editorState.manipulationDrag?.kind,
    "vessel-level",
    "the level handle takes the press first",
  );

  /* Drag up to three quarters of the height. */
  m.drag.updateManipulationDrag(
    pointer("pointermove", { x: handle.point.x, y: 30 }),
  );
  m.drag.finishManipulationDrag(
    pointer("pointerup", { x: handle.point.x, y: 30 }),
  );

  assert.deepEqual(
    vessel.geometry,
    before,
    "the vessel did not move or resize",
  );
  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    75,
    "the level followed the handle",
  );

  /* And the Features field reads the same value. */
  assert.equal(
    m.schema.readField(vessel, "vesselFluidPercent"),
    75,
    "the field and the handle agree",
  );

  const painted = paintedVessel(m, vessel.id);
  const surface = painted.horizontal.find(
    (line) => Math.abs(line.y1 - painted.surface) < 0.01,
  );

  assert.ok(surface, "the surface is still a single horizontal line");
});

test("the level handle is hidden when deselected, and the surface stays visible", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 40 });

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  assert.ok(
    m.handles
      .editableHandlesFor(vessel)
      .some((handle) => handle.kind === "vessel-level"),
  );

  m.state.selection.selectedObjectIds = [];

  /* The handle belongs to the SELECTION - but the surface is the vessel's. */
  const painted = paintedVessel(m, vessel.id);

  assert.ok(
    painted.surface !== null,
    "the surface is still drawn when deselected",
  );
});

test("an invalid or out-of-range percentage is refused or clamped", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 40 });

  m.schema.writeField(vessel, "vesselFluidPercent", 40);

  assert.equal(
    m.schema.writeField(vessel, "vesselFluidPercent", "not a number"),
    false,
    "a non-number is refused",
  );
  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    40,
    "and the stored value is untouched",
  );

  assert.equal(
    m.vessel.setFluidLevelPercent(vessel, Number.NaN),
    false,
    "NaN is refused",
  );
  assert.equal(m.vessel.fluidLevelPercentOf(vessel), 40);

  assert.equal(m.schema.writeField(vessel, "vesselFluidPercent", -20), true);
  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    0,
    "below zero clamps to empty",
  );

  assert.equal(m.schema.writeField(vessel, "vesselFluidPercent", 250), true);
  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    100,
    "above a hundred clamps to full",
  );
});

test("resizing keeps the level percentage, and the surface follows", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 40 },
    "mouse",
    "closed",
  );

  for (const percent of [25, 50, 75]) {
    m.schema.writeField(vessel, "vesselFluidPercent", percent);
    m.schema.writeField(vessel, "vesselHeight", 80);

    assert.equal(
      m.vessel.fluidLevelPercentOf(vessel),
      percent,
      `${percent}% is preserved`,
    );

    const rect = m.vessel.vesselRect(vessel);
    const surface = m.vessel.fluidLevelSegment(vessel);

    assert.ok(
      Math.abs(
        surface.start.y - (rect.position.y + (percent / 100) * rect.height),
      ) < 1e-6,
      `${percent}% is re-seated on the taller tank`,
    );

    m.schema.writeField(vessel, "vesselHeight", 40);
  }

  /* And through a handle drag. */
  m.schema.writeField(vessel, "vesselFluidPercent", 50);
  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  const handle = m.handles
    .editableHandlesFor(vessel)
    .find((candidate) => candidate.kind === "vessel-corner2");
  const target = { x: handle.point.x, y: handle.point.y + 40 };

  m.drag.beginManipulationDrag(pointer("pointerdown", handle.point));
  m.drag.updateManipulationDrag(pointer("pointermove", target));
  m.drag.finishManipulationDrag(pointer("pointerup", target));

  assert.equal(
    m.vessel.fluidLevelPercentOf(vessel),
    50,
    "a handle resize keeps the level",
  );

  const painted = paintedVessel(m, vessel.id);

  assert.ok(
    painted.surface > painted.top && painted.surface < painted.bottom,
    "the surface stays inside",
  );
});

/* ============================================================
 * 10. ORIENTATION
 * ============================================================ */

test("a Reservoir always renders its mouth at the TOP, whichever way it was dragged", async () => {
  const m = await modules();

  for (const [label, from, to] of DRAG_DIRECTIONS) {
    reset(m);

    const vessel = drawVessel(m, from, to, "mouse", "open");
    const painted = paintedVessel(m, vessel.id);

    /* Two side walls and a floor - and no lid, whichever way the drag went. */
    assert.equal(
      painted.vertical.length,
      2,
      `${label}: the sides are vertical`,
    );

    const floorRows = painted.horizontal
      .map((line) => line.y1)
      .sort((a, b) => a - b);

    /* The floor is the LOWEST horizontal line on the screen. */
    assert.ok(
      floorRows.some((row) => Math.abs(row - painted.bottom) < 0.01),
      `${label}: the floor is at the bottom`,
    );
    assert.equal(
      floorRows.filter((row) => Math.abs(row - painted.top) < 0.01).length,
      0,
      `${label}: nothing is drawn across the mouth`,
    );

    painted.vertical.forEach((wall) => {
      assert.equal(
        Math.max(wall.y1, wall.y2),
        painted.bottom,
        `${label}: the wall starts at the floor`,
      );
      assert.equal(
        Math.min(wall.y1, wall.y2),
        painted.top,
        `${label}: and rises to the mouth`,
      );
    });
  }
});

test("a Tank always renders its lid ABOVE its floor, whichever way it was dragged", async () => {
  const m = await modules();

  for (const [label, from, to] of DRAG_DIRECTIONS) {
    reset(m);

    const vessel = drawVessel(m, from, to, "mouse", "closed");
    const painted = paintedVessel(m, vessel.id);

    assert.equal(painted.vertical.length, 2, `${label}: two side walls`);

    /* A LID at the very top - the highest line on the screen. */
    assert.ok(
      painted.horizontal.some((line) => Math.abs(line.y1 - painted.top) < 0.01),
      `${label}: the lid is at the top`,
    );

    painted.vertical.forEach((wall) => {
      assert.equal(
        Math.min(wall.y1, wall.y2),
        painted.top,
        `${label}: the wall starts at the lid`,
      );
      assert.equal(
        Math.max(wall.y1, wall.y2),
        painted.bottom,
        `${label}: and ends at the floor`,
      );
    });
  }
});

test("the liquid is always BELOW the surface and rises with the percentage", async () => {
  const m = await modules();

  for (const [label, from, to] of DRAG_DIRECTIONS) {
    reset(m);

    const vessel = drawVessel(m, from, to, "mouse", "closed");
    m.schema.writeField(vessel, "vesselFluidPercent", 25);

    const painted = paintedVessel(m, vessel.id);

    assert.ok(
      painted.surface > painted.top + 1,
      `${label}: the surface is below the lid`,
    );
    assert.ok(
      painted.surface < painted.bottom - 1,
      `${label}: and above the floor`,
    );

    const quarter = painted.top + (painted.bottom - painted.top) * 0.75;

    assert.ok(
      Math.abs(painted.surface - quarter) < 1,
      `${label}: a quarter-full tank's surface sits a quarter up`,
    );

    const liquidY = painted.liquid.map((corner) => corner[1]);
    const liquidTop = Math.min(...liquidY);
    const liquidBottom = Math.max(...liquidY);

    assert.ok(
      Math.abs(liquidTop - painted.surface) < 1,
      `${label}: the liquid starts at the surface`,
    );
    assert.ok(
      Math.abs(liquidBottom - painted.bottom) < 1,
      `${label}: and reaches the floor`,
    );
    assert.ok(
      liquidTop < liquidBottom,
      `${label}: the fill is below the surface, not above it`,
    );

    m.schema.writeField(vessel, "vesselFluidPercent", 75);

    const fuller = paintedVessel(m, vessel.id);

    assert.ok(
      fuller.surface < painted.surface,
      `${label}: 75% is higher on the screen than 25%`,
    );
    assert.ok(fuller.surface > fuller.top, `${label}: and still below the lid`);
  }
});

test("all four drag directions paint the same upright vessel", async () => {
  const m = await modules();

  const rendered = [];

  for (const [label, from, to] of DRAG_DIRECTIONS) {
    reset(m);

    const vessel = drawVessel(m, from, to, "mouse", "closed");

    const rect = m.vessel.vesselRect(vessel);

    assert.deepEqual(
      rect.position,
      { x: 0, y: 0 },
      `${label}: the same anchor`,
    );

    /* Corner 3 is the TOP-LEFT in world terms, so it is above corner 0. */
    assert.ok(
      rect.corners[3].y > rect.corners[0].y,
      `${label}: the top corner is above the floor corner`,
    );
    assert.equal(
      rect.corners[3].x,
      rect.corners[0].x,
      `${label}: and directly above it`,
    );

    rendered.push(paintedVessel(m, vessel.id));
  }

  const first = rendered[0];

  rendered.forEach((painted, index) => {
    const label = DRAG_DIRECTIONS[index][0];

    assert.equal(painted.top, first.top, `${label}: the same lid row`);
    assert.equal(painted.bottom, first.bottom, `${label}: the same floor row`);
    assert.equal(painted.surface, first.surface, `${label}: the same surface`);
    assert.deepEqual(painted.liquid, first.liquid, `${label}: the same liquid`);
  });
});

/* ============================================================
 * 11. SOURCE
 * ============================================================ */

test("the vessel is written as readable source with its id, name, size, style and level", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    "mouse",
    "closed",
  );

  m.schema.writeField(vessel, "vesselFluidPercent", 35);

  const block = sourceFor(m, vessel);

  assert.match(block, /% DAETUM OBJECT:/, "it has the object header");
  assert.match(block, /% DAETUM TYPE: reservoir-tank/);
  assert.match(
    block,
    new RegExp(
      `% DAETUM ID: ${vessel.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  assert.match(block, /% DAETUM VESSEL: style=closed/);
  assert.match(block, /width=40/);
  assert.match(block, /height=30/);
  assert.match(block, /percent=35/);
});

test("a source edit resizes the vessel, switches it, and sets its level", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    "mouse",
    "open",
  );
  const id = vessel.id;

  const edited = sourceFor(m, vessel)
    .replace("style=open", "style=closed")
    .replace("width=40", "width=55")
    .replace("height=30", "height=20");

  applySource(m, edited);

  const reread = live(m, vessel);

  assert.equal(reread.id, id, "the id is stable across a source edit");
  assert.equal(m.vessel.vesselStyleOf(reread), "closed");
  assert.equal(reread.geometry.width, 55);
  assert.equal(reread.geometry.height, 20);

  const levelled = sourceFor(m, reread).replace(
    /percent=\d+(\.\d+)?/,
    "percent=80",
  );

  applySource(m, levelled);

  const changed = live(m, vessel);

  assert.equal(
    m.vessel.fluidLevelPercentOf(changed),
    80,
    "at the percentage the source states",
  );

  const painted = paintedVessel(m, changed.id);

  assert.ok(
    painted.surface > painted.top && painted.surface < painted.bottom,
    "and the canvas follows",
  );
});

test("a Features edit and a handle drag both reach the source", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  m.schema.writeField(vessel, "vesselStyle", "closed");
  m.schema.writeField(vessel, "vesselWidth", 70);

  assert.match(sourceFor(m, vessel), /width=70/, "a typed width is written");

  m.state.activeTool = "select";
  m.state.selection.selectedObjectIds = [vessel.id];

  const handle = m.handles
    .editableHandlesFor(vessel)
    .find((candidate) => candidate.kind === "vessel-corner2");
  const target = { x: handle.point.x + 10, y: handle.point.y + 10 };

  m.drag.beginManipulationDrag(pointer("pointerdown", handle.point));
  m.drag.updateManipulationDrag(pointer("pointermove", target));
  m.drag.finishManipulationDrag(pointer("pointerup", target));

  assert.match(
    sourceFor(m, vessel),
    /width=80/,
    "a dragged width is written too",
  );
});

test("a vessel saved and reopened comes back identical and upright", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 3, y: 4 },
    { x: 43, y: 44 },
    "mouse",
    "closed",
  );

  m.schema.writeField(vessel, "name", "Day Tank");
  m.schema.writeField(vessel, "vesselFluidPercent", 65);
  m.schema.writeField(vessel, "stroke", "#336699");

  const block = sourceFor(m, vessel);
  const before = JSON.parse(JSON.stringify(live(m, vessel)));

  m.state.objects = [];

  applySource(m, block);

  const reopened = m.state.objects.find(
    (candidate) => candidate.type === "reservoir-tank",
  );

  assert.ok(reopened, "the vessel came back");
  assert.equal(reopened.id, before.id, "with its id");
  assert.equal(reopened.name, before.name, "its name");
  assert.equal(reopened.geometry.position.x, before.geometry.position.x);
  assert.equal(reopened.geometry.position.y, before.geometry.position.y);
  assert.equal(reopened.geometry.width, before.geometry.width);
  assert.equal(reopened.geometry.height, before.geometry.height);
  assert.equal(m.vessel.vesselStyleOf(reopened), "closed");
  assert.equal(m.vessel.fluidLevelPercentOf(reopened), 65);
  assert.equal(reopened.style.stroke, "#336699");

  const painted = paintedVessel(m, reopened.id);

  assert.ok(painted.top < painted.bottom, "and it reopens upright");
});

/* ============================================================
 * 12. UNDO / REDO AND OBJECT MANAGEMENT
 * ============================================================ */

test("undo removes a created vessel and redo puts it back", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });
  const id = vessel.id;

  assert.equal(m.state.objects.length, 1);

  m.ds.undo(m.state);
  assert.equal(
    m.state.objects.some((object) => object.id === id),
    false,
    "undo removed it",
  );

  m.ds.redo(m.state);
  assert.equal(
    m.state.objects.some((object) => object.id === id),
    true,
    "redo restored it",
  );
});

test("the vessel is a normal object: named, listed, selectable, hideable and deletable", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  assert.ok(vessel.id, "it has a stable id");
  assert.notEqual(vessel.visible, false, "it is visible when created");

  assert.equal(m.schema.writeField(vessel, "name", "Header Tank"), true);
  assert.equal(vessel.name, "Header Tank", "the name is editable");

  m.state.selection.selectedObjectIds = [vessel.id];
  assert.deepEqual(
    m.state.selection.selectedObjectIds,
    [vessel.id],
    "it can be selected",
  );

  m.state.selection.selectedObjectIds = [];
  assert.deepEqual(m.state.selection.selectedObjectIds, [], "and deselected");

  assert.equal(m.schema.writeField(vessel, "visible", false), true);
  assert.equal(vessel.visible, false, "it can be hidden");

  m.schema.writeField(vessel, "visible", true);

  m.ds.removeObject(m.state, vessel.id);
  assert.equal(m.state.objects.length, 0, "and deleted");
});

/* ============================================================
 * 13. POINTER KINDS
 * ============================================================ */

test("a touch or a pen draws the same upright vessel through the same gesture", async () => {
  const m = await modules();

  for (const pointerType of ["touch", "pen"]) {
    reset(m);

    const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 }, pointerType);

    assert.ok(vessel, `${pointerType} created a vessel`);
    assert.equal(
      vessel.geometry.width,
      40,
      `${pointerType} used the same coordinates`,
    );
    assert.equal(vessel.geometry.height, 30);
    assert.equal(
      vessel.geometry.position.y,
      0,
      `${pointerType} got the same anchor`,
    );

    const painted = paintedVessel(m, vessel.id);

    assert.ok(painted.top < painted.bottom, `${pointerType} drew it upright`);
  }
});

/* ============================================================
 * 14. PIPE CONNECTIONS
 * ============================================================ */

test("a pipe ending on a vessel wall is attached, follows it, and makes no elbow", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(m, { x: 0, y: 0 }, { x: 40, y: 30 });

  /* A run whose end lands on the right wall, at mid height. */
  const run = m.pipe.createPipeDuct({ x: 80, y: 15 }, { x: 40, y: 15 });

  m.ds.addObject(m.state, run);
  m.pipeTool.reconcileFluidConnections(run, m.state.objects);

  assert.equal(
    run.engineering?.vesselId,
    vessel.id,
    "the pipe is attached to the vessel",
  );
  assert.equal(
    run.engineering?.vesselPort,
    "end",
    "at the end that touches the wall",
  );
  assert.equal(
    m.state.objects.filter((object) => object.type === "elbow").length,
    0,
    "no elbow is generated by a wall",
  );

  /* RESIZE: the held end stays on the wall it was attached to. */
  m.schema.writeField(vessel, "vesselWidth", 70);
  assert.deepEqual(
    run.geometry.end,
    { x: 70, y: 15 },
    "the end followed the wall",
  );

  /* MOVE: the attached end moves with the vessel. */
  vessel.geometry = { ...vessel.geometry, position: { x: 10, y: 10 } };
  m.vessel.followVessel(vessel, m.state.objects);
  assert.deepEqual(
    run.geometry.end,
    { x: 80, y: 25 },
    "the end followed the vessel",
  );

  /* A PIPE THAT MERELY CROSSES IS NOT ATTACHED. */
  const crossing = m.pipe.createPipeDuct({ x: -30, y: 25 }, { x: 90, y: 25 });

  m.ds.addObject(m.state, crossing);
  m.pipeTool.reconcileFluidConnections(crossing, m.state.objects);

  assert.equal(
    crossing.engineering?.vesselId,
    undefined,
    "a crossing pipe is not attached",
  );
  assert.equal(
    m.state.objects.filter((object) => object.type === "elbow").length,
    0,
    "and still makes no elbow",
  );
});

test("a pipe held on a tank's lid lets go when the tank becomes a Reservoir", async () => {
  const m = await modules();
  reset(m);

  const vessel = drawVessel(
    m,
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    "mouse",
    "closed",
  );

  const rect = m.vessel.vesselRect(vessel);

  /* A run standing on the lid, at mid width. */
  const run = m.pipe.createPipeDuct(
    { x: 20, y: rect.corners[3].y },
    { x: 20, y: rect.corners[3].y + 40 },
  );

  m.ds.addObject(m.state, run);
  m.pipeTool.reconcileFluidConnections(run, m.state.objects);

  assert.equal(
    run.engineering?.vesselId,
    vessel.id,
    "held on the lid of the tank",
  );

  const start = { ...run.geometry.start };

  m.schema.writeField(vessel, "vesselStyle", "open");

  assert.equal(
    run.engineering?.vesselId,
    undefined,
    "an open mouth holds nothing",
  );
  assert.deepEqual(
    run.geometry.start,
    start,
    "and the pipe stays where it was drawn",
  );
});
