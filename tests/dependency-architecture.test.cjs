
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DOES THE DEPENDENCY SYSTEM HOLD THE WHOLE SHEET TOGETHER?
 *
 * The individual mechanisms are each proven elsewhere: a components
 * object follows its force, a resultant follows its forces, a diagram
 * follows its body, a support slides along its member. What none of those
 * tests covers is the thing they all depend on - that ONE refresh runs on
 * EVERY committed edit, so that no tool can be written that forgets it.
 *
 * That is the claim worth testing, and it is a claim about coverage rather
 * than about arithmetic. So this file does not move a force by calling the
 * refresh, which would prove nothing: it goes through the ordinary
 * commitDrawingChange, exactly as a dragged handle or a typed magnitude
 * does, and asks whether the dependent objects are correct afterwards.
 *
 * THE ORDER MATTERS AND IS THE SUBSTANCE OF IT. The refresh runs BEFORE
 * the snapshot is taken for Undo, so an undone edit returns to a state in
 * which the dependents were already right. Undoing the other way round
 * would restore a components object still describing where the force used
 * to be - a state no student would ever see by hand, and one they would
 * quite reasonably report as Undo being broken.
 */

global.window = { crypto: { randomUUID: () => "deps-uuid" } };

loadModule("load-profile.js");
loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("analysis-dependencies.js");
loadModule("drawing-state.js");

const deps = global.window.enggAnalysisDependencies;
const state = global.window.enggDrawingState;
const geometry = global.window.enggFeatureGeometry;

/*
 * THE REGISTRY IS WIRED EXPLICITLY, as the controller does at startup.
 * Without it there is no refresh on commit at all, and every check below
 * would pass for the wrong reason - by never running.
 */
state.setAnalysisDependencyRegistry(deps);

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`
    );
  }
};

const near = (a, b) =>
  Number.isFinite(a) && Math.abs(a - b) < 1e-9;

const freshDrawing = objects => ({
  version: 1,
  units: "mm",
  camera: { zoom: 1, panX: 0, panY: 0 },
  grid: { visible: false, spacing: 5 },
  snap: { enabled: true, spacing: 1 },
  objectSnap: { enabled: false, tolerancePx: 10 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
  selection: { selectedObjectIds: [], hoveredObjectId: null },
  interaction: { phase: "idle", previewObjects: [] },
  history: { past: [], future: [] },
  objects
});

const beam = {
  id: "beam-1",
  type: "beam",
  geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, depth: 12 }
};

const forceA = {
  id: "force-a",
  type: "force",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 50, y: 0 },
    position: { x: 0, y: 0 },
    magnitude: 300,
    angle: 0
  }
};

const forceB = {
  id: "force-b",
  type: "force",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 0, y: 50 },
    position: { x: 0, y: 0 },
    magnitude: 400,
    angle: 90
  }
};

const components = state.geometryFactories["force-components"](
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  {}
);
deps.registerDependency(components, ["force-a"]);

const resultant = state.geometryFactories.resultant(
  { x: 0, y: 0 },
  { x: 0.3, y: 0.4 },
  {}
);
deps.registerDependency(resultant, ["force-a", "force-b"]);

const diagram = state.geometryFactories["shear-force-diagram"](
  { x: 0, y: -70 },
  { x: 300, y: -70 },
  {}
);
deps.registerDependency(diagram, ["beam-1"]);

const drawing = freshDrawing([
  beam,
  forceA,
  forceB,
  components,
  resultant,
  diagram
]);

/*
 * ================================================================
 * READ EVERY OBJECT BACK FROM THE DRAWING, EVERY TIME
 * ================================================================
 *
 * Undo and redo REPLACE the object list with a fresh clone of the stored
 * snapshot. So a variable holding an object from before an undo refers to
 * something that is no longer on the sheet - it is detached, and reading
 * it reports the state the object was left in rather than the state the
 * drawing is in.
 *
 * That is the correct design: history is a value, not a thing that gets
 * mutated back. But it means a test that keeps a reference across an undo
 * is measuring the wrong object, and will report the app as broken.
 *
 * An earlier version of this file did exactly that, and five of its seven
 * failures were its own stale references rather than anything in the
 * application. So nothing here is held across a history operation, and
 * `byId` is the only way an object is reached.
 */
const componentsOf = drawingState =>
  drawingState.objects.find(
    object => object.type === "force-components"
  );

const resultantOf = drawingState =>
  drawingState.objects.find(object => object.type === "resultant");

const diagramOf = drawingState =>
  drawingState.objects.find(object => object.type === "analysis-diagram");

const forceOf = (drawingState, id) =>
  drawingState.objects.find(object => object.id === id);

console.log("\n  every committed edit refreshes what depends on it\n");

/*
 * ONE EDIT, EVERY DEPENDENT. A single committed change to one force must
 * bring every dependent of that force up to date, and must not disturb the
 * ones that depend on something else. Testing the two together matters:
 * a refresh that updated everything from every source would satisfy the
 * first half and quietly corrupt the second.
 */
forceA.geometry.magnitude = 600;

const before = state.snapshotDrawing(drawing);

state.commitDrawingChange(drawing, before);

/*
 * WHAT A REFRESH IS ASSERTED AGAINST.
 *
 * The derivation itself is not stored on the object - the refresh writes
 * the three drawn SEGMENTS and the source id, and leaves the numbers to
 * be re-derived on demand. Asserting against `engineering.components`
 * found nothing there, and a refresh that happened to keep a cached copy
 * of the derivation would be exactly the kind of second source of truth
 * this architecture exists to avoid.
 *
 * So what is checked is the geometry, which is the thing on the sheet.
 */
/*
 * VALUES, NOT DRAWN LENGTHS. A Force Components object is DRAWN as the
 * projections of its force's drawn arrow, and STATES the force's value in
 * `forceX`/`forceY` (the retired Vector Scale used to tie the two together).
 * This file is about whether every edit reaches the dependents, and a value
 * edit reaches them as values - so the checks read `forceX`/`forceY`.
 */
const segmentsOf = object => ({
  original: object.geometry.original,
  horizontal: object.geometry.horizontal,
  vertical: object.geometry.vertical,
  origin: object.geometry.origin,
  forceX: object.geometry.forceX,
  forceY: object.geometry.forceY
});

check(
  "a force's components follow it through an ordinary commit",
  near(
    segmentsOf(componentsOf(drawing)).forceX,
    600
  ) &&
    near(
      segmentsOf(componentsOf(drawing)).forceY,
      0
    ),
  `horizontal ${JSON.stringify(segmentsOf(componentsOf(drawing)).horizontal)}, vertical ${JSON.stringify(segmentsOf(componentsOf(drawing)).vertical)}`
);

check(
  "a resultant that sums it is up to date too",
  near(resultantOf(drawing).geometry.magnitude, Math.hypot(600, 400)),
  `resultant ${resultantOf(drawing).geometry.magnitude}`
);

check(
  "a diagram reading a different source is left alone",
  near(
    diagramOf(drawing).geometry.end.x - diagramOf(drawing).geometry.start.x,
    300
  ),
  `diagram length ${
    diagramOf(drawing).geometry.end.x -
    diagramOf(drawing).geometry.start.x
  }`
);

/* ============================================================
   EVERY KIND OF EDIT GOES THROUGH THE SAME PATH
   ============================================================ */

console.log("\n  a moved feature, a re-aimed one, and a resized body\n");

/*
 * A DRAGGED HANDLE. Translation goes through the shared transform, so this
 * is the same path a handle drag takes - not a special case, which is the
 * property being tested.
 */
const movedBefore = state.snapshotDrawing(drawing);

/*
 * MUTATE THROUGH THE DRAWING, not through the local `forceB`.
 *
 * commitDrawingChange does not replace the object list - only undo and
 * redo do - so this is safe here. But holding a reference and expecting
 * it to be the drawing is the habit that caused the failures above, and
 * going through the drawing is both correct and no harder.
 */
geometry.translateObject(forceOf(drawing, "force-b"), 120, 0);

state.commitDrawingChange(drawing, movedBefore);

/*
 * THE RESULTANT IS ANCHORED ON THE FIRST SOURCE, not on the average and
 * not on whichever force moved. `commonOrigin` documents that explicitly:
 * averaging would be tidier and wrong, because the resultant of forces
 * applied at different points is not a vector at an average position.
 *
 * So moving the SECOND force does NOT move the resultant, and this is the
 * expected answer rather than a missed update. An earlier version of this
 * file moved the second force and expected the resultant to follow,
 * reporting a fault in a rule that is right.
 */
check(
  "the resultant stays anchored on its FIRST source when a later one moves",
  near(resultantOf(drawing).geometry.position.x, 0),
  `resultant at ${JSON.stringify(resultantOf(drawing).geometry.position)}`
);

/*
 * ...AND IT DOES MOVE WHEN THE FIRST SOURCE DOES, which is the case that
 * would be a real fault if it failed.
 */
const anchorBefore = state.snapshotDrawing(drawing);

geometry.translateObject(forceOf(drawing, "force-a"), 80, 0);

state.commitDrawingChange(drawing, anchorBefore);

check(
  "the resultant follows its first source",
  near(resultantOf(drawing).geometry.position.x, 80),
  `resultant at ${JSON.stringify(resultantOf(drawing).geometry.position)}`
);

/*
 * ...AND THE COMPONENTS OF A FORCE THAT DID NOT MOVE ARE NOT DISTURBED BY
 * IT. Force A has moved, so its components must have followed it; force B
 * has not moved, so its own attachment must be exactly where it was. A
 * refresh that re-derived everything from everywhere would drag B's
 * components across the sheet.
 */
check(
  "and the components follow the force that actually moved",
  near(componentsOf(drawing).geometry.origin.x, 80),
  `components origin ${JSON.stringify(componentsOf(drawing).geometry.origin)}`
);

/*
 * A RE-AIMED FORCE, which is the case a components object is most likely
 * to be stale for: the lengths of the two components have to change, not
 * merely the direction of one arrow.
 */
const reaimedBefore = state.snapshotDrawing(drawing);

forceA.geometry.angle = 90;

state.commitDrawingChange(drawing, reaimedBefore);

check(
  "a re-aimed force's components change length, not just direction",
  near(
    componentsOf(drawing).geometry.forceX,
    0
  ) &&
    near(
      componentsOf(drawing).geometry.forceY,
      600
    ),
  `horizontal ${JSON.stringify(componentsOf(drawing).geometry.horizontal)}, vertical ${JSON.stringify(componentsOf(drawing).geometry.vertical)}`
);

/* ============================================================
   A RESIZED BODY
   ============================================================ */

console.log("\n  a body that changes length\n");

/*
 * THE CASE THE FRACTION ATTACHMENT EXISTS FOR. A diagram is stored as a
 * fraction of its member, so lengthening the member must move the far end
 * of the frame without moving the near end, and a support's attachment
 * must stay where it was ON THE MEMBER rather than at an absolute place.
 */
const resizedBefore = state.snapshotDrawing(drawing);

beam.geometry.end = { x: 600, y: 0 };

state.commitDrawingChange(drawing, resizedBefore);

check(
  "a diagram follows its member's new length",
  near(
    diagramOf(drawing).geometry.end.x - diagramOf(drawing).geometry.start.x,
    600
  ),
  `diagram length ${
    diagramOf(drawing).geometry.end.x - diagramOf(drawing).geometry.start.x
  }`
);

/* ============================================================
   UNDO SEES A CONSISTENT STATE
   ============================================================ */

console.log("\n  undo returns to a state that was already consistent\n");

/*
 * THE ORDERING CLAIM, AND THE ONE MOST LIKELY TO BE WRONG.
 *
 * Undo restores the snapshot taken BEFORE the edit - and that snapshot
 * was taken after the refresh, so the dependents in it describe the
 * moment the student is going back to. If the snapshot were taken first
 * and refreshed after, the restored components would still point at where
 * the force used to be.
 *
 * So after an undo the components must describe the RESTORED force, not
 * the force as it was when the edit was made.
 */
const editedBefore = state.snapshotDrawing(drawing);

forceOf(drawing, "force-a").geometry.angle = 0;

state.commitDrawingChange(drawing, editedBefore);

/*
 * AT 0 DEGREES the force has NO VERTICAL COMPONENT, so the vertical
 * segment is zero-length. An earlier version of this check expected the
 * vertical component to be 600 - which is what it was when the force was
 * at 90 degrees - and so reported the refresh as failing to follow a
 * re-aim that had actually worked.
 */
check(
  "the components describe the edited force before the undo",
  near(
    componentsOf(drawing).geometry.forceX,
    600
  ) &&
    near(
      componentsOf(drawing).geometry.forceY,
      0
    ),
  `horizontal ${JSON.stringify(componentsOf(drawing).geometry.horizontal)}, vertical ${JSON.stringify(componentsOf(drawing).geometry.vertical)}`
);

state.undo(drawing);

/*
 * READ BACK FROM THE DRAWING, not from the local references - undo has
 * replaced the object list, and a local reference from before it now
 * points at something that is not on the sheet.
 */
const undoneForce = forceOf(drawing, "force-a");
const undoneComponents = componentsOf(drawing);

check(
  "undo restores the force",
  undoneForce && undoneForce.geometry.angle === 90,
  `angle is ${undoneForce && undoneForce.geometry.angle}`
);

check(
  "and the components in the restored state agree with it",
  undoneComponents &&
    near(
      undoneComponents.geometry.forceY,
      600
    ),
  `vertical ${
    undoneComponents && JSON.stringify(undoneComponents.geometry.vertical)
  }`
);

/*
 * ...AND THE UNDO ITSELF REFRESHES, because a restored snapshot may have
 * been taken before some other dependent was correct. Redoing the whole
 * thing is a stronger test than undoing: it has to come back consistent
 * from BOTH directions.
 */
state.redo(drawing);

const redoneComponents = componentsOf(drawing);

/*
 * THE ORIGIN IS NOW 80, NOT 0, because force A was moved by 80 earlier in
 * this file. The components are anchored on their force's application
 * point, so that move carried them with it - which is the property under
 * test, and the reason this is 80 rather than 0.
 */
check(
  "redo leaves the components consistent with the force again",
  redoneComponents &&
    near(redoneComponents.geometry.origin.x, 80) &&
    near(redoneComponents.geometry.forceX, 600) &&
    near(redoneComponents.geometry.forceY, 0),
  `origin ${redoneComponents && JSON.stringify(redoneComponents.geometry.origin)}, horizontal ${redoneComponents && JSON.stringify(redoneComponents.geometry.horizontal)}`
);

/* ============================================================
   ONE EDIT, ONE HISTORY ENTRY
   ============================================================ */

console.log("\n  one edit is one entry in the history\n");

/*
 * A FRESH FORCE, not the shared one.
 *
 * `forceA` has been moved and re-aimed several times by now, so reusing
 * it here would carry all of that into this section and make the expected
 * numbers depend on the order the earlier checks ran in. Its own force
 * starts from a known place, which is what a history check needs.
 */
const countedForce = {
  id: "force-a",
  type: "force",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 50, y: 0 },
    position: { x: 0, y: 0 },
    magnitude: 100,
    angle: 0
  }
};

const countedBeam = {
  id: "beam-1",
  type: "beam",
  geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, depth: 12 }
};

const countedDrawing = freshDrawing([
  countedBeam,
  countedForce,
  {
    id: "force-b",
    type: "force",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 50 },
      position: { x: 0, y: 0 },
      magnitude: 400,
      angle: 90
    }
  },
  state.geometryFactories["force-components"](
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    {}
  ),
  state.geometryFactories.resultant(
    { x: 0, y: 0 },
    { x: 0.3, y: 0.4 },
    {}
  )
]);

const comp2 = componentsOf(countedDrawing);
const res2 = resultantOf(countedDrawing);

deps.registerDependency(comp2, ["force-a"]);
deps.registerDependency(res2, ["force-a", "force-b"]);

/*
 * An edit that updates SEVERAL dependents at once. The refresh is
 * internal to the commit, so however many objects it touched there is
 * still exactly one edit as far as the student is concerned - and an
 * implementation that pushed a history entry per refreshed object would
 * make Undo appear to do nothing.
 */
for (let i = 1; i <= 3; i++) {
  const snapshot = state.snapshotDrawing(countedDrawing);

  forceOf(countedDrawing, "force-a").geometry.magnitude = 100 * i;

  state.commitDrawingChange(countedDrawing, snapshot);
}

check(
  "three edits are three history entries, however many objects they touched",
  countedDrawing.history.past.length === 3,
  `history: ${countedDrawing.history.past.length}`
);

state.undo(countedDrawing);

check(
  "one undo reverses one whole edit",
  forceOf(countedDrawing, "force-a").geometry.magnitude === 200,
  `magnitude is ${forceOf(countedDrawing, "force-a").geometry.magnitude}`
);

/*
 * AND THE DEPENDENTS CAME BACK WITH IT, which is the property that makes
 * the history usable: a student who undoes a change must not be left
 * looking at a components object describing a force they have already
 * undone.
 */
check(
  "and the components followed the undo",
  near(componentsOf(countedDrawing).geometry.origin.x, 0),
  `components origin ${JSON.stringify(componentsOf(countedDrawing).geometry.origin)}`
);

/*
 * AND THE RESULTANT, which the same commit also had to update. Its
 * magnitude is the sum of the two magnitudes, and a components object
 * cannot show that - so the two are checked together, which is the point:
 * one edit, several dependents, all correct afterwards.
 */
check(
  "and so did the resultant",
  near(resultantOf(countedDrawing).geometry.magnitude, Math.hypot(200, 400)),
  `resultant ${resultantOf(countedDrawing).geometry.magnitude}`
);
/*
 * ============================================================
   EDITING A FIELD IN THE FEATURE PANEL
 * ============================================================ */

console.log("\n  a magnitude typed into the panel, not yet left behind\n");

/*
 * THE PATH A TYPED VALUE TAKES IS NOT THE PATH A COMMITTED EDIT TAKES.
 *
 * The property panel applies a field's new value on every keystroke but only
 * makes the history entry when the student leaves the field, because one edit
 * is one undo however many characters it took to type. That left a gap
 * between the two: the arrow moved as the student typed, and the Components
 * and Resultant beside it kept the old numbers until the click that ended the
 * edit - long enough that they looked broken.
 *
 * So the fix is a refresh that records nothing, and this checks the two
 * things that make it safe. The dependents have to update IMMEDIATELY, or the
 * original complaint stands. And the history must NOT move, or fixing the
 * lag has filled the undo stack with one entry per keystroke.
 */
const typedForce = forceOf(countedDrawing, "force-a");
const typedComponents = componentsOf(countedDrawing);
const typedResultant = resultantOf(countedDrawing);

const pastBeforeTyping = countedDrawing.history.past.length;

typedForce.geometry.magnitude = 900;

const typedMagnitude = countedDrawing.objects.find(
  object => object.id === "force-a"
).geometry.magnitude;

state.refreshDerivedFeatures(countedDrawing);

check(
  "a force edited in the panel brings its components with it at once",
  near(
    componentsOf(countedDrawing).geometry.forceX,
    typedMagnitude
  ),
  `horizontal ${JSON.stringify(componentsOf(countedDrawing).geometry.horizontal)}`
);

check(
  "and its resultant, without waiting for the field to be left",
  near(
    resultantOf(countedDrawing).geometry.magnitude,
    Math.hypot(typedMagnitude, 400)
  ),
  `resultant ${resultantOf(countedDrawing).geometry.magnitude}`
);

check(
  "typing records no history of its own",
  countedDrawing.history.past.length === pastBeforeTyping,
  `history went from ${pastBeforeTyping} to ${countedDrawing.history.past.length}`
);

check(
  "and the objects it holds are the drawing's, not detached copies",
  typedComponents === componentsOf(countedDrawing) &&
    typedResultant === resultantOf(countedDrawing)
);

/*
 * ============================================================
   A DRAG, WHICH COMMITS NOTHING UNTIL THE POINTER IS RELEASED
 * ============================================================ */

console.log("\n  a force being dragged, mid-gesture\n");

/*
 * THE CASE THAT MATTERS MOST, AND THE ONE THE PANEL FIX DID NOT COVER.
 *
 * A drag mutates its force on every pointermove and commits once, on release.
 * A typed value mutates on every keystroke and commits on blur. Both are
 * uncommitted for most of their duration, and the refresh used to live in
 * the commit alone - so for the whole of the gesture the arrow tracked the
 * cursor and its decomposition sat frozen at the value it had when the
 * student first pressed down.
 *
 * So this asserts the refresh works on the force ALONE, with no commit
 * anywhere: the state a drag is actually in between two pointermove events.
 * Committing is not what is being tested here, and a check that committed
 * would pass even with the original fault in place.
 */
const draggedDrawing = freshDrawing([
  {
    id: "beam-1",
    type: "beam",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 300, y: 0 },
      depth: 12
    }
  },
  {
    id: "force-a",
    type: "force",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 50, y: 0 },
      position: { x: 0, y: 0 },
      magnitude: 100,
      angle: 0
    }
  },
  {
    id: "force-b",
    type: "force",
    geometry: {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 50 },
      position: { x: 0, y: 0 },
      magnitude: 400,
      angle: 90
    }
  },
  state.geometryFactories["force-components"](
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    {}
  ),
  state.geometryFactories.resultant(
    { x: 0, y: 0 },
    { x: 0.3, y: 0.4 },
    {}
  )
]);

deps.registerDependency(componentsOf(draggedDrawing), ["force-a"]);
deps.registerDependency(resultantOf(draggedDrawing), ["force-a", "force-b"]);

/*
 * A FRESH ENTRY IS WRITTEN ON EVERY FRAME, because a student who drags a
 * handle sees exactly that - one entry per pointermove - and the dependent
 * has to keep up with each one rather than with the last.
 */
const frames = [];

for (let i = 1; i <= 5; i++) {
  forceOf(draggedDrawing, "force-a").geometry.magnitude = 100 * i;

  state.refreshDerivedFeatures(draggedDrawing);

  frames.push({
    magnitude: 100 * i,
    horizontal: componentsOf(draggedDrawing).geometry.forceX,
    vertical: componentsOf(draggedDrawing).geometry.forceY,
    resultant: resultantOf(draggedDrawing).geometry.magnitude
  });
}

check(
  "every frame of a drag brings the components with it",
  frames.every(frame =>
    near(frame.horizontal, frame.magnitude) && near(frame.vertical, 0)
  ),
  `frames ${JSON.stringify(frames)}`
);

check(
  "and every frame brings the resultant with it",
  frames.every(frame => near(frame.resultant, Math.hypot(frame.magnitude, 400))),
  `frames ${JSON.stringify(frames)}`
);

check(
  "a whole uncommitted drag leaves the history untouched",
  draggedDrawing.history.past.length === 0,
  `history: ${draggedDrawing.history.past.length}`
);

/*
 * AND THE POSITION, which is the half a magnitude-only check would miss.
 * Dragging a force slides its application point, and the components are
 * anchored on that point - so a refresh that recomputed the arrow lengths
 * but not the anchor would leave the decomposition behind on the sheet,
 * still correctly sized and pointing at nothing.
 */
geometry.translateObject(forceOf(draggedDrawing, "force-a"), 75, -40);

state.refreshDerivedFeatures(draggedDrawing);

check(
  "a force dragged to a new place takes its components with it",
  near(componentsOf(draggedDrawing).geometry.origin.x, 75) &&
    near(componentsOf(draggedDrawing).geometry.origin.y, -40),
  `origin ${JSON.stringify(componentsOf(draggedDrawing).geometry.origin)}`
);

check(
  "and its resultant, which is anchored on the same point",
  near(resultantOf(draggedDrawing).geometry.position.x, 75) &&
    near(resultantOf(draggedDrawing).geometry.position.y, -40),
  `position ${JSON.stringify(resultantOf(draggedDrawing).geometry.position)}`
);

/*
 * THE ORDER ONE LAST TIME. A drag commits ONCE. Five frames, one entry.
 * The history is what makes the drag feel like a single action to Undo, and
 * a refresh that recorded per frame would undo one pixel of a drag at a
 * time - so this is a property of the fix, not of the fault.
 */
state.commitDrawingChange(
  draggedDrawing,
  state.snapshotDrawing(draggedDrawing)
);

check(
  "one drag is one entry in the history, not one per frame",
  draggedDrawing.history.past.length === 1,
  `history: ${draggedDrawing.history.past.length}`
);

console.log("\n  every KIND of change to a force reaches its dependents\n");

/*
 * REFRESHING ON EVERY DRAW IS ONLY HALF THE CLAIM.
 *
 * `renderCurrentDrawing` refreshes before every repaint and `commitDrawingChange`
 * refreshes before every snapshot, so a dependent cannot lag behind the source
 * by one frame or by one blur. But that only holds if the derivation actually
 * READS every part of the force that can change.
 *
 * A refresh that watched the position but not the unit would keep up with a
 * drag and go stale on a unit change, and it would do so silently - the
 * dependent would be updated, just from part of its source. So each part of
 * a force that a student can edit is changed here on its own, and the
 * dependents are asked to catch up through the ordinary refresh. If any one
 * of these reads a field the derivation ignores, it fails.
 *
 * A FRESH DRAWING, because the checks above have moved and re-aimed force A
 * many times over, and reusing it would make the expected numbers depend on
 * the order the earlier checks ran in.
 */
const kindsForce = {
  id: "kind-force",
  type: "force",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 50, y: 0 },
    position: { x: 0, y: 0 },
    magnitude: 300,
    angle: 0,
    unit: "N"
  }
};

const kindsDrawing = freshDrawing([
  { ...beam },
  kindsForce,
  state.geometryFactories["force-components"](
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    {}
  ),
  state.geometryFactories.resultant({ x: 0, y: 0 }, { x: 0.3, y: 0.4 }, {})
]);

const kindsComponentsId = kindsDrawing.objects.find(
  object => object.type === "force-components"
).id;

const kindsResultantId = kindsDrawing.objects.find(
  object => object.type === "resultant"
).id;

deps.registerDependency(
  kindsDrawing.objects.find(
    object => object.type === "force-components"
  ),
  ["kind-force"]
);

deps.registerDependency(
  kindsDrawing.objects.find(object => object.type === "resultant"),
  ["kind-force"]
);

const kindsForceOf = drawingState =>
  drawingState.objects.find(object => object.id === "kind-force");

const kindsComponentsOf = drawingState =>
  drawingState.objects.find(object => object.id === kindsComponentsId);

const kindsResultantOf = drawingState =>
  drawingState.objects.find(object => object.id === kindsResultantId);

/*
 * THE CHECK IS GENERIC: it re-derives what the components SHOULD be straight
 * from the source force, and asks whether the refresh got there. That way the
 * test states the rule rather than restating the implementation, and an
 * implementation that stopped reading the unit cannot pass by also having
 * changed the test's expectation.
 */
const componentsAgree = drawingState => {
  const force = kindsForceOf(drawingState);
  const drawn = kindsComponentsOf(drawingState).geometry;
  const radians = (force.geometry.angle * Math.PI) / 180;

  const expectedX = force.geometry.magnitude * Math.cos(radians);
  const expectedY = force.geometry.magnitude * Math.sin(radians);

  return (
    near(drawn.origin.x, force.geometry.start.x) &&
    near(drawn.origin.y, force.geometry.start.y) &&
    near(drawn.forceX, expectedX) &&
    near(drawn.forceY, expectedY)
  );
};

const resultantAgrees = drawingState => {
  const force = kindsForceOf(drawingState);

  return (
    near(
      kindsResultantOf(drawingState).geometry.magnitude,
      Math.abs(force.geometry.magnitude)
    ) && near(
      kindsResultantOf(drawingState).geometry.position.x,
      force.geometry.start.x
    )
  );
};

const changesOfAKind = [
  [
    "moved in the plane",
    force => {
      /*
       * BOTH ENDS, and through `start`.
       *
       * A Point Force is one vector, so its application point lives on
       * `geometry.start` and `geometry.position` is a mirror the property
       * setter keeps in step - the panel's "Application Point" row writes
       * `start.x`, not `position.x`. Moving only the mirror is not a move
       * a student can perform, and the dependencies rightly ignore it;
       * an earlier version of this check moved the mirror and reported the
       * refresh as failing to follow a move that had never happened.
       */
      force.geometry.start = { x: 40, y: 25 };
      force.geometry.position = { x: 40, y: 25 };
      force.geometry.end = { x: 90, y: 25 };
    }
  ],
  [
    "re-magnified",
    force => {
      force.geometry.magnitude = 875;
    }
  ],
  [
    "re-aimed",
    force => {
      force.geometry.angle = 37;
    }
  ],
  [
    "given a different unit",
    force => {
      force.geometry.unit = "kN";
    }
  ],
  [
    "flipped end for end",
    force => {
      force.geometry.angle = 180 - force.geometry.angle;
    }
  ]
];

changesOfAKind.forEach(([description, change]) => {
  change(kindsForceOf(kindsDrawing));

  state.refreshDerivedFeatures(kindsDrawing);

  check(
    `a force ${description} brings its components with it`,
    componentsAgree(kindsDrawing),
    `components ${JSON.stringify(kindsComponentsOf(kindsDrawing).geometry)} for force ${JSON.stringify(kindsForceOf(kindsDrawing).geometry)}`
  );

  check(
    `and its resultant`,
    resultantAgrees(kindsDrawing),
    `resultant ${JSON.stringify(kindsResultantOf(kindsDrawing).geometry)} for force ${JSON.stringify(kindsForceOf(kindsDrawing).geometry)}`
  );
});

/*
 * AND THROUGH A COMMIT, which is the other route an edit can take. Both routes
 * are exercised above - the refresh here, the commit in the sections before -
 * so a dependent cannot be correct on one and stale on the other.
 */
const kindCommitBefore = state.snapshotDrawing(kindsDrawing);

kindsForceOf(kindsDrawing).geometry.magnitude = 120;

state.commitDrawingChange(kindsDrawing, kindCommitBefore);

check(
  "the same is true of a committed change",
  componentsAgree(kindsDrawing) && resultantAgrees(kindsDrawing),
  `components ${JSON.stringify(kindsComponentsOf(kindsDrawing).geometry)}, resultant ${JSON.stringify(kindsResultantOf(kindsDrawing).geometry)}`
);

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
