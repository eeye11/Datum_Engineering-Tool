
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * The Annotation model, tested directly.
 *
 * The centre of this file is the specification's central requirement
 * about annotations: a label may be moved anywhere on the sheet while
 * staying linked to its feature, and must go on updating from that
 * feature afterwards. Everything else here supports that.
 *
 * Pure module, so it is exercised in Node.
 */

global.window = { crypto: { randomUUID: () => "annotation-uuid" } };

loadModule("measurement-core.js");

global.window.enggDrawingState = {
  polygonVertices: () => []
};
global.window.enggFeatureGeometry = {
  rectangleCorners: () => []
};

loadModule("annotation-model.js");

const model = global.window.enggAnnotationModel;

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`
    );
  }
};

const state = (...objects) => ({ objects });

const force = (overrides = {}) => ({
  id: "force-1",
  name: "Point Force",
  type: "force",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 0, y: -30 },
    position: { x: 0, y: 0 },
    magnitude: 250,
    angle: -90,
    ...overrides
  },
  style: {},
  metadata: {}
});

console.log("\nA free note");
const note = model.createAnnotation({
  kind: "free-text",
  text: "Assume negligible self-weight."
});
check("is an annotation", note.type, "annotation");
check("with its own identity", typeof note.id === "string" && note.id.startsWith("annotation-"), true);
check("saying what the student wrote", note.text, "Assume negligible self-weight.");
check("about nothing in particular", note.sourceFeatureId, null);
check("and reading it back unchanged", model.textFor(note, state()), "Assume negligible self-weight.");

console.log("\nA force's value");
const forceAnnotation = model.createAnnotation({
  kind: "force-value",
  sourceFeatureId: "force-1",
  position: { x: 0, y: -30 }
});
check("names the force it is about", forceAnnotation.sourceFeatureId, "force-1");
check("is generated from it", forceAnnotation.textMode, "auto");
check(
  "and states the force's own magnitude",
  model.textFor(forceAnnotation, state(force())),
  "F = 250.0 N"
);

console.log("\nChanging the force changes the label");
const f = force();
const linked = state(f);
check(
  "it first says 250",
  model.textFor(forceAnnotation, linked),
  "F = 250.0 N"
);
f.geometry.magnitude = 300;
f.geometry.angle = 30;
check(
  "and 300 once the force is 300",
  model.textFor(forceAnnotation, linked),
  "F = 300.0 N"
);
check(
  "without the annotation being told to change",
  forceAnnotation.text,
  ""
);

console.log("\n---- the central requirement ----");
console.log("\nMoving the annotation does not move the feature");

const subject = force();
const doc = state(subject);
const movable = model.createAnnotation({
  kind: "force-value",
  sourceFeatureId: "force-1",
  position: { x: 5, y: -35 },
  leader: { enabled: true }
});

const geometryBefore = JSON.stringify(subject.geometry);
const sourceBefore = movable.sourceFeatureId;

model.moveAnnotation(movable, { x: 300, y: 150 });

check("the annotation is where it was put", movable.placement, { x: 300, y: 150 });
check("THE FORCE HAS NOT MOVED", JSON.stringify(subject.geometry), geometryBefore);
check("and the source link is intact", movable.sourceFeatureId, sourceBefore);
check("and is still the same link", sourceBefore, "force-1");

console.log("\nStill linked after being moved a long way");
subject.geometry.magnitude = 275;
check(
  "the moved annotation still updates from the force",
  model.textFor(movable, doc),
  "F = 275.0 N"
);
check(
  "and is still at the position the student chose",
  movable.placement,
  { x: 300, y: 150 }
);

console.log("\nMoving the force keeps the annotation's position");
subject.geometry.end = { x: 120, y: 40 };
subject.geometry.position = { x: 0, y: 0 };
check(
  "the annotation has not been dragged along",
  movable.placement,
  { x: 300, y: 150 }
);
check(
  "and still says what the force says",
  model.textFor(movable, doc),
  "F = 275.0 N"
);

console.log("\nAutomatic placement is released by hand");
check("it begins automatic", forceAnnotation.placementMode, "auto");
model.moveAnnotation(forceAnnotation, { x: 80, y: 80 });
check("a move takes charge of it", forceAnnotation.placementMode, "manual");
model.releaseToAutomaticPlacement(forceAnnotation);
check("and can be handed back deliberately", forceAnnotation.placementMode, "auto");
check(
  "while the position it had is untouched by that",
  forceAnnotation.placement,
  { x: 80, y: 80 }
);

console.log("\nA suggested first position");
const suggested = model.suggestPlacement(
  model.createAnnotation({
    kind: "force-value",
    sourceFeatureId: "force-1",
    position: { x: 0, y: 0 }
  }),
  state(force())
);
check(
  "is beyond the arrow, not on it",
  suggested.y < -30,
  true
);

console.log("\nLeaders");
check(
  "a leader is described, not stored as a Line",
  model.leaderFor(movable, doc) !== null,
  true
);
check(
  "and there is no Line feature for it",
  doc.objects.filter((o) => o.type === "line").length,
  0
);
const leaderBefore = model.leaderFor(movable, doc);
model.moveAnnotation(movable, { x: 320, y: 200 });
const leaderAfter = model.leaderFor(movable, doc);
check(
  "it follows the annotation when the annotation moves",
  leaderAfter.from.x !== leaderBefore.from.x,
  true
);
check(
  "and still points at the force",
  model.leaderFor(movable, doc).direction !== null,
  true
);
check(
  "an annotation without one gets none",
  model.leaderFor(forceAnnotation, doc),
  null
);

console.log("\nForce components");
const components = model.createAnnotation({
  kind: "force-components",
  sourceFeatureId: "force-1"
});
const angled = force({ magnitude: 200, angle: 30 });
check(
  "resolve the force's own arrow",
  model.textFor(components, state(angled)),
  "Fx = 173.2 N\nFy = 100.0 N"
);

console.log("\nA moment");
const moment = {
  id: "m1",
  name: "Applied Moment",
  type: "moment",
  geometry: { position: { x: 0, y: 0 }, magnitude: 500, clockwise: false },
  style: {},
  metadata: {}
};
const momentAnnotation = model.createAnnotation({
  kind: "moment-value",
  sourceFeatureId: "m1"
});
check(
  "states its magnitude and sense",
  model.textFor(momentAnnotation, state(moment)),
  "M = 500.0 N·m"
);
moment.geometry.magnitude = 750;
check(
  "and follows the moment",
  model.textFor(momentAnnotation, state(moment)),
  "M = 750.0 N·m"
);

console.log("\nA distributed load");
const load = {
  id: "load-1",
  name: "Distributed Load",
  type: "load",
  geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, intensity: 5, direction: -90, points: [] },
  style: {},
  metadata: {}
};
const loadAnnotation = model.createAnnotation({
  kind: "load-value",
  sourceFeatureId: "load-1"
});
check(
  "states its intensity",
  model.textFor(loadAnnotation, state(load)),
  "w = 5.00 kN/m"
);
load.geometry.intensity = 12;
check("and follows it", model.textFor(loadAnnotation, state(load)), "w = 12.0 kN/m");

console.log("\nA varying load's profile");
const varying = {
  id: "vdl-1",
  name: "Varying Distributed Load",
  type: "varying-load",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    startIntensity: 0,
    endIntensity: 10,
    points: [
      { t: 0, magnitude: 0 },
      { t: 0.5, magnitude: 5 },
      { t: 1, magnitude: 10 }
    ]
  },
  style: {},
  metadata: {}
};

const first = model.createAnnotation({
  kind: "load-profile-value",
  sourceFeatureId: "vdl-1",
  anchorRef: { index: 0 }
});
const second = model.createAnnotation({
  kind: "load-profile-value",
  sourceFeatureId: "vdl-1",
  anchorRef: { index: 2 }
});
const profile = state(varying);
check("each profile point is its own annotation", model.textFor(first, profile), "w1 = 0.00 kN/m");
check("naming the point it describes", model.textFor(second, profile), "w3 = 10.0 kN/m");
varying.geometry.points[2].magnitude = 14;
check(
  "and changing a point's magnitude updates that annotation",
  model.textFor(second, profile),
  "w3 = 14.0 kN/m"
);
check(
  "while the others are untouched",
  model.textFor(first, profile),
  "w1 = 0.00 kN/m"
);

console.log("\nSupports");
const pin = {
  id: "s1",
  name: "A",
  type: "pin-support",
  geometry: { position: { x: 0, y: 0 }, orientation: 0 },
  style: {},
  metadata: {}
};
const supportAnnotation = model.createAnnotation({
  kind: "support-label",
  sourceFeatureId: "s1"
});
check("identify the support", model.textFor(supportAnnotation, state(pin)), "Pin Support A");
pin.name = "B";
check("and follow a rename", model.textFor(supportAnnotation, state(pin)), "Pin Support B");

console.log("\nA free-text note is never rewritten");
const orphan = model.createAnnotation({
  kind: "free-text",
  text: "Check this joint.",
  sourceFeatureId: "force-1"
});
subject.geometry.magnitude = 999;
check(
  "even when it names a feature",
  model.textFor(orphan, doc),
  "Check this joint."
);
check(
  "because a written note is not derived from anything",
  orphan.textMode,
  "manual"
);

console.log("\nDeleting a source");
const generated = model.createAnnotation({
  kind: "force-value",
  sourceFeatureId: "force-1"
});
check(
  "a generated annotation is cleaned up",
  model.onSourceDeleted(generated).action,
  "delete"
);
const kept = model.onSourceDeleted(orphan);
check("a written one is kept", kept.action, "keep");
check(
  "with its text intact",
  kept.annotation.text,
  "Check this joint."
);
check(
  "and the association marked unresolved rather than left dangling",
  kept.annotation.sourceFeatureId,
  null
);
check(
  "so it is visibly no longer attached",
  kept.annotation.unresolved,
  true
);

console.log("\nResolution");
check(
  "a live generated annotation is resolved",
  model.isResolved(forceAnnotation, doc),
  true
);
check(
  "one whose feature has gone is not",
  model.isResolved(
    model.createAnnotation({ kind: "force-value", sourceFeatureId: "gone" }),
    doc
  ),
  false
);
check(
  "and a written note always is",
  model.isResolved(note, state()),
  true
);

console.log("\nDependencies");
check(
  "only the annotations of that feature are found",
  model.annotationsFor(state(subject, forceAnnotation, note), "force-1").length,
  1
);
check(
  "and not the ones about something else",
  model.annotationsFor(state(subject, forceAnnotation, note), "other").length,
  0
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
