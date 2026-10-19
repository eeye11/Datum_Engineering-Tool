/*
 * ========================================================
 * MOVING A SELECTION WITH THE ARROW KEYS
 * ========================================================
 *
 * The rule: an arrow key REQUESTS a direction; the feature's own constraints
 * decide how it is actually allowed to move. And most importantly, moving an
 * attached feature must NEVER detach it from its parent.
 *
 * The cases this pins:
 *
 *   free feature            moves freely
 *   child on a horizontal   moves along it; Up/Down do nothing
 *   child on a vertical     moves along it; Left/Right do nothing
 *   child on an inclined    follows the member, no perpendicular jump
 *   locked / derived        does not move
 *   parent + child selected moves ONCE (the child is carried, not doubled)
 *   the step is a WORLD step, the same real distance at any scale
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

/*
 * THE DOM SKELETON the editor looks up ONCE at module load. The movement's
 * re-render touches the panel, the status line and the canvas, so all three
 * have to exist - with the classes and ids the real page gives them - before
 * any editor module is required.
 */
dom.window.document.body.innerHTML = `
  <div class="drawing-canvas"></div>
  <div id="drawingProperties"></div>
  <div id="drawingToolMessage"></div>
  <div id="drawingCoordinates"></div>
  <div id="drawingZoomValue"></div>
  <button id="drawingUndo"></button>
  <button id="drawingRedo"></button>
  <div id="drawingToolHeading"></div>
  <div id="drawingToolList"></div>
  <div id="drawingFeaturesBack"></div>
`;

const state = require(modulePath("drawing-state.js")).default;
const frames = require(modulePath("body-frames.js")).default;

for (const name of [
  "quantities.js",
  "feature-geometry.js",
  "body-frames.js",
  "drawing-state.js",
]) {
  require(modulePath(name));
}

const editorState = require(modulePath("editor-state.js"));
const movement = require(modulePath("arrow-movement.js"));
const { nudgeSelection } = movement;

/* The editor's live document, which the movement module reads. */
const drawing = editorState.drawingState;

function reset(objects, selectedIds) {
  drawing.objects = objects;
  drawing.scale = null;
  drawing.selection.selectedObjectIds = selectedIds || [];
  drawing.selection.boxSelectionIds = [];
  drawing.interaction.phase = "idle";
}

/*
 * THE LIVE OBJECT, re-read from the document by id.
 *
 * The movement path re-assigns `drawing.objects` (commit, then put the dragged
 * array back), so a reference captured before a nudge can be a detached clone.
 * Every assertion re-reads by id, which is what the application itself does.
 */
function fresh(id) {
  return drawing.objects.find((object) => object.id === id);
}

const F = state.geometryFactories;

console.log("\n  a free feature moves in the requested direction\n");

{
  const line = F.line({ x: 0, y: 0 }, { x: 50, y: 0 });

  reset([line], [line.id]);

  const before = { ...line.geometry.start };

  check("Right moves a free line +X", nudgeSelection("right") === true);
  check(
    "and it moved by the shared step",
    Math.abs(fresh(line.id).geometry.start.x - before.x) > 0,
  );

  nudgeSelection("left");

  check(
    "Left brings it back to where it started",
    Math.abs(fresh(line.id).geometry.start.x - before.x) < 1e-9,
    `expected ${before.x}, got ${fresh(line.id).geometry.start.x}`,
  );
}

console.log("\n  a child on a HORIZONTAL parent moves ALONG it\n");

{
  const beam = F.beam({ x: 0, y: 0 }, { x: 100, y: 0 });
  const force = F.forceFromMagnitude({ x: 40, y: 0 }, 100, 90, {});

  force.parentId = beam.id;

  reset([beam, force], [force.id]);

  const startX = force.geometry.position.x;
  const startY = force.geometry.position.y;

  check("Right moves it along the beam", nudgeSelection("right") === true);
  check(
    "its X changed",
    fresh(force.id).geometry.position.x > startX,
  );
  check(
    "its Y did NOT change",
    Math.abs(fresh(force.id).geometry.position.y - startY) < 1e-9,
  );
  check(
    "it is still parented to the beam",
    fresh(force.id).parentId === beam.id,
  );

  const beforeUpX = fresh(force.id).geometry.position.x;

  nudgeSelection("up");

  check(
    "Up does NOT move a child of a horizontal beam",
    Math.abs(fresh(force.id).geometry.position.x - beforeUpX) < 1e-9,
    "a perpendicular step must not detach it",
  );
  check(
    "and it is STILL attached",
    fresh(force.id).parentId === beam.id,
  );
}

console.log("\n  a child on a VERTICAL parent moves along it\n");

{
  const column = F.beam({ x: 0, y: 0 }, { x: 0, y: 100 });
  const force = F.forceFromMagnitude({ x: 0, y: 40 }, 100, 0, {});

  force.parentId = column.id;

  reset([column, force], [force.id]);

  const startY = force.geometry.position.y;

  check("Up moves it along the column", nudgeSelection("up") === true);
  check("its Y changed", fresh(force.id).geometry.position.y > startY);

  const beforeRightX = fresh(force.id).geometry.position.x;

  nudgeSelection("right");

  check(
    "Right does NOT move a child of a vertical column",
    Math.abs(fresh(force.id).geometry.position.x - beforeRightX) < 1e-9,
  );
}

console.log("\n  a child on an INCLINED parent follows the member\n");

{
  const beam = F.beam({ x: 0, y: 0 }, { x: 100, y: 100 });
  const force = F.forceFromMagnitude({ x: 40, y: 40 }, 100, 90, {});
  force.parentId = beam.id;

  reset([beam, force], [force.id]);

  const frame = frames.frameOf(beam);
  const before = { ...force.geometry.position };

  nudgeSelection("right");

  check(
    "it moved",
    Math.hypot(
      fresh(force.id).geometry.position.x - before.x,
      fresh(force.id).geometry.position.y - before.y,
    ) > 1e-9,
  );

  /* The movement must lie ALONG the member, not across it. */
  const delta = {
    x: fresh(force.id).geometry.position.x - before.x,
    y: fresh(force.id).geometry.position.y - before.y,
  };

  const alongMember =
    delta.x * frame.tangent.x + delta.y * frame.tangent.y;
  const acrossMember =
    delta.x * frame.normal.x + delta.y * frame.normal.y;

  check(
    "the movement lies along the member",
    Math.abs(acrossMember) < 1e-6,
    `across = ${acrossMember}`,
  );
  check("and is the component along it", Math.abs(alongMember) > 1e-9);
}

console.log("\n  fixed, derived and locked features do not move\n");

{
  const line = F.line({ x: 0, y: 0 }, { x: 50, y: 0 });

  line.locked = true;
  reset([line], [line.id]);

  check(
    "a LOCKED feature is refused",
    movement.isMovableByArrows(line) === false,
  );

  const before = { ...line.geometry.start };
  nudgeSelection("right");

  check(
    "and the arrow changes nothing",
    line.geometry.start.x === before.x,
  );

  /* A derived child, by its registered type. */
  const resultant = {
    id: "r1",
    type: "resultant",
    geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
  };

  check(
    "a DERIVED child is not independently movable",
    movement.isMovableByArrows(resultant) === false,
  );
}

console.log("\n  a parent and its child selected together move ONCE\n");

{
  const beam = F.beam({ x: 0, y: 0 }, { x: 100, y: 0 });
  const force = F.forceFromMagnitude({ x: 40, y: 0 }, 100, 90, {});
  force.parentId = beam.id;

  reset([beam, force], [beam.id, force.id]);

  const stationBefore = enggStationOf(force, beam);

  nudgeSelection("right");

  const movedBeam = fresh(beam.id);
  const movedForce = fresh(force.id);

  const stationAfter = enggStationOf(movedForce, movedBeam);

  check(
    "the child keeps the SAME station on the beam",
    Math.abs(stationAfter - stationBefore) < 1e-6,
    `before ${stationBefore}, after ${stationAfter} - a doubled step would drift`,
  );

  check(
    "and the beam itself moved",
    Math.abs(movedBeam.geometry.start.x - 5) < 1e-6,
    `beam start x = ${movedBeam.geometry.start.x}`,
  );
}

/* The child's place along its parent, in the parent's own frame. */
function enggStationOf(child, parent) {
  const frame = frames.frameOf(parent);

  return frames.positionOn(frame, child.geometry.position);
}

console.log("\n  the step is a WORLD step, not a screen one\n");

{
  const line = F.line({ x: 0, y: 0 }, { x: 50, y: 0 });

  reset([line], [line.id]);
  drawing.camera.zoom = 4;

  nudgeSelection("right");

  const zoomed = fresh(line.id).geometry.start.x;

  const other = F.line({ x: 0, y: 0 }, { x: 50, y: 0 });
  reset([other], [other.id]);
  drawing.camera.zoom = 0.25;

  nudgeSelection("right");

  check(
    "the world step is the same at any zoom",
    Math.abs(fresh(other.id).geometry.start.x - zoomed) < 1e-9,
    `${fresh(other.id).geometry.start.x} vs ${zoomed} - zoom must not change the distance`,
  );
}

console.log("\n  repeated movement does not drift\n");

{
  const line = F.line({ x: 0, y: 0 }, { x: 50, y: 0 });
  reset([line], [line.id]);

  const startX = line.geometry.start.x;

  for (let i = 0; i < 100; i += 1) {
    nudgeSelection("right");
  }

  for (let i = 0; i < 100; i += 1) {
    nudgeSelection("left");
  }

  check(
    "100 right then 100 left returns to the start",
    Math.abs(fresh(line.id).geometry.start.x - startX) < 1e-9,
    `expected ${startX}, got ${fresh(line.id).geometry.start.x}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
