/* eslint-disable no-console */
/*
 * ========================================================
 * AN ARROW IS AS LONG AS IT WAS DRAWN
 * ========================================================
 *
 * The retired Vector Scale drew every force and load arrow as
 * `magnitude x scale`, so typing a value resized the arrow and dragging the
 * arrow changed the value. The rule now is the one a drawing tool should have:
 *
 *   - the ARROW is geometry - the gesture that drew it, and the handle that
 *     edits it, decide where it ends;
 *   - the VALUE (20 N, 5 kN/m, v) is annotation text, and never moves it.
 *
 * Everything below is checked through the application's own model, handle
 * drag, handles and Source writer, against the same object.
 */

const assert = require("node:assert/strict");
const { test, after } = require("node:test");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, error } = bootApp();

if (error) {
  console.log(`the application did not boot: ${error.message}`);
  process.exit(1);
}

after(() => window.close());

const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

let profile;
let model;
let attachment;
let handles;
let statics;
let drawingState;

async function load() {
  if (profile) {
    return;
  }

  await whenReady();

  profile = require(locate("load-profile.js")).default;
  model = require(locate("drawing-state.js")).default;
  attachment = require(locate("statics-attachment.js"));
  handles = require(locate("handles.js"));
  statics = require(locate("statics.js"));
  ({ drawingState } = require(locate("editor-state.js")));
}

const lengthOf = (g) => Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);

/* ------------------------------------------------------------- forces */

test("typing a force's value changes its label, never its arrow", async () => {
  await load();

  const force = model.geometryFactories.force({ x: 0, y: 0 }, { x: 0, y: 30 }, {});
  const drawn = lengthOf(force.geometry);

  profile.setForceVector(force.geometry, 5000, 90);

  assert.equal(force.geometry.magnitude, 5000);
  assert.ok(near(lengthOf(force.geometry), drawn), `arrow became ${lengthOf(force.geometry)} long`);

  const source = statics.serializeStaticsObject(force);

  assert.match(source, /\(0,0\) -- \(0,30\)/, "the Source draws the arrow as drawn");
  assert.match(source, /F = 5000/, "and states the typed value");
});

test("turning a force rotates its drawn arrow at the same length", async () => {
  await load();

  const force = model.geometryFactories.force({ x: 0, y: 0 }, { x: 40, y: 0 }, {});

  profile.setForceVector(force.geometry, force.geometry.magnitude, 90);

  assert.ok(near(force.geometry.end.x, 0) && near(force.geometry.end.y, 40), JSON.stringify(force.geometry.end));
});

test("dragging the arrowhead redraws the arrow and keeps the value", async () => {
  await load();

  const force = model.geometryFactories.force({ x: 0, y: 0 }, { x: 30, y: 0 }, {});
  profile.setForceVector(force.geometry, 250, 0);

  attachment.applyStaticsManipulation(force, { kind: "end" }, { x: 0, y: 75 });

  assert.equal(force.geometry.magnitude, 250, "the drag changed the value");
  assert.ok(near(force.geometry.end.x, 0) && near(force.geometry.end.y, 75), JSON.stringify(force.geometry.end));
  assert.ok(near(force.geometry.angle, 90), `angle ${force.geometry.angle}`);

  /* Grabbing the head and releasing it where it is changes nothing. */
  const before = { ...force.geometry.end };

  attachment.applyStaticsManipulation(force, { kind: "end" }, profile.drawnForceEnd(drawingState, force.geometry));

  assert.ok(near(force.geometry.end.x, before.x) && near(force.geometry.end.y, before.y));
  assert.equal(force.geometry.magnitude, 250);
});

test("reversing a force turns its drawn arrow about the application point", async () => {
  await load();

  const force = model.geometryFactories.force({ x: 10, y: 10 }, { x: 40, y: 10 }, {});
  profile.setForceVector(force.geometry, 120, 0);

  profile.reverseForceDirection(force.geometry);

  assert.deepEqual(force.geometry.start, { x: 10, y: 10 }, "the application point moved");
  assert.equal(force.geometry.magnitude, 120, "the value changed");
  assert.ok(near(force.geometry.end.x, -20) && near(force.geometry.end.y, 10), JSON.stringify(force.geometry.end));

  /* The model, the canvas and the Source agree about the reversed arrow. */
  const axis = profile.drawnForceAxis(drawingState, force.geometry);

  assert.ok(near(axis.head.x, -20), `canvas head at ${axis.head.x}`);
  assert.match(statics.serializeStaticsObject(force), /\(10,10\) -- \(-20,10\)/);
});

test("the force's label sits at the arrowhead it is drawn with", async () => {
  await load();

  const force = model.geometryFactories.force({ x: 0, y: 0 }, { x: 30, y: 0 }, {});
  profile.setForceVector(force.geometry, 900, 0);

  /* The value node is placed just beyond the drawn head (30), not at 900. */
  const node = /\\node\[[^\]]*\] at \((-?[\d.]+),(-?[\d.]+)\) \{\$F = 900/.exec(statics.serializeStaticsObject(force));

  assert.ok(node, "no value node");
  assert.ok(Number(node[1]) > 30 && Number(node[1]) < 40, `label at x=${node[1]}`);
});

test("an old force with no drawn end is drawn at its magnitude", async () => {
  await load();

  const legacy = { start: { x: 0, y: 0 }, magnitude: 45, angle: 0 };
  const axis = profile.drawnForceAxis(drawingState, legacy);

  assert.ok(near(axis.head.x, 45) && near(axis.head.y, 0), JSON.stringify(axis.head));
});

/* -------------------------------------------------------------- loads */

test("a load's arrows reach its drawn height, whatever its intensity", async () => {
  await load();

  const uniform = model.geometryFactories.load({ x: 0, y: 0 }, { x: 100, y: 0 }, 25, { arrowLength: 12 });

  assert.equal(profile.loadArrowReach(uniform.geometry, 25), 12);

  /* A typed intensity is the label; the arrows stay as drawn. */
  uniform.geometry.points = uniform.geometry.points.map((point) => ({ ...point, magnitude: 400 }));

  assert.equal(profile.loadArrowReach(uniform.geometry, 400), 12);

  const source = statics.serializeStaticsObject(uniform);

  assert.match(source, /\(0,0\) -- \(0,-12\)|\(0,0\) -- \(0,12\)/, `arrows not 12 long:\n${source}`);
});

test("a varying load tapers by its intensities under its drawn height", async () => {
  await load();

  const varying = model.geometryFactories["varying-load"]({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 4, { arrowLength: 20 });

  assert.equal(profile.loadArrowReach(varying.geometry, 4), 20, "the peak arrow is the drawn height");
  assert.equal(profile.loadArrowReach(varying.geometry, 1), 5, "a quarter of the peak is a quarter of the height");
});

test("dragging a load's arrow tip changes the drawn height, not the intensities", async () => {
  await load();

  const uniform = model.geometryFactories.load({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, { arrowLength: 10 });
  /* The tip handle sits on the drawn arrowhead. */
  const tip = handles.editableHandlesFor(uniform).find((handle) => handle.kind === "load-point0");

  assert.ok(tip, "no tip handle");
  assert.ok(near(Math.abs(tip.point.y), 10), `tip handle at ${JSON.stringify(tip.point)}`);

  const direction = profile.unitVector(profile.loadDirection(uniform.geometry));

  attachment.applyStaticsManipulation(uniform, { kind: "load-point0" }, { x: 0, y: direction.y * 30 });

  assert.ok(near(uniform.geometry.arrowLength, 30), `height ${uniform.geometry.arrowLength}`);
  assert.ok(uniform.geometry.points.every((point) => point.magnitude === 10), "an intensity changed");
});

test("an old load with no drawn height looks as it did", async () => {
  await load();

  const legacy = {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    points: [{ t: 0, magnitude: 8 }, { t: 1, magnitude: 8 }]
  };

  assert.equal(profile.loadArrowReach(legacy, 8), 8, "drawn at its peak intensity, as at the old default scale");
});

test("the retired Vector Scale is gone from the model and the toolbar", async () => {
  await load();

  assert.equal(typeof profile.vectorScaleFor, "undefined");
  assert.equal(typeof profile.vectorScale, "undefined");
  assert.equal(window.document.getElementById("drawingVectorScale"), null);
  assert.equal(model.createDrawingState().statics, undefined);
});
