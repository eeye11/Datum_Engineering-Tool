
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES A DRAGGED FEATURE STAY UNDER THE CURSOR?
 * ========================================================
 *
 * Two faults lived in the move, and both made a feature OVERTAKE the pointer
 * instead of following it - which is what "it flies off" described.
 *
 * THE FIRST: an ordinary feature was translated without being restored to its
 * pre-drag geometry first. The delta reaching the move is measured from where
 * the PRESS happened, not from the last pointermove, so the move is a SET -
 * "wherever you were, plus the total distance". Restoring the children but
 * not the feature itself meant each move added a full delta on top of the
 * previous one: three moves of ten units left the feature sixty units from the
 * cursor, and the gap grew with every further pixel.
 *
 * THE SECOND, specific to analysis objects: `placementOffset` was COMPOSED
 * rather than set, for the same reason - thirty on the first move, sixty on
 * the second, ninety on the third. And the geometry was translated inside the
 * analysis branch ON TOP OF the caller's own translation, moving it twice.
 *
 * BOTH WERE BUGS IN THE MOVE, NOT A REASON TO FORBID IT. A Force Components
 * and a Resultant are draggable - their numbers are re-derived from their
 * sources, so they record where the student put them and the refresh applies
 * that to whatever it derives. An earlier version of this file responded to
 * the flying-off report by refusing to move them at all, which hid the
 * symptom by removing the feature's capability. This file holds that line:
 * the features are draggable AND they land where the pointer is.
 *
 * `translateObject` is exercised through the real module, because the faults
 * were in what it does with a delta rather than in the shape of any model.
 */

global.window = { crypto: { randomUUID: () => "drag-uuid" } };

loadModule("body-frames.js");
loadModule("feature-geometry.js");

const geometry = global.window.enggFeatureGeometry;

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

/*
 * THE SEQUENCE A REAL DRAG PRODUCES.
 *
 * `moveObjectAndChildren` restores every feature to its pre-drag geometry and
 * then translates by the total distance travelled. That is reproduced here
 * exactly, because reproducing anything else - translating repeatedly, or
 * skipping the restore - would pass against the very faults this is checking.
 */
function dragHarness(object, startingGeometry) {
  const snapshots = {
    [object.id]: JSON.parse(JSON.stringify(startingGeometry)),
  };

  return distance => {
    object.geometry = JSON.parse(JSON.stringify(snapshots[object.id]));
    geometry.translateObject(object, distance, 0);
  };
}

const beamStarting = () => ({
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
});

console.log("\n  an ordinary feature follows the pointer\n");

{
  const beam = { id: "beam-1", type: "beam", geometry: beamStarting() };
  const dragTo = dragHarness(beam, beamStarting());

  const positions = [];

  [10, 20, 30, 40].forEach(distance => {
    dragTo(distance);
    positions.push(beam.geometry.start.x);
  });

  check(
    "it lands exactly where the pointer is, on every move",
    positions.every((x, index) => x === (index + 1) * 10),
    `positions = ${JSON.stringify(positions)} (expected 10,20,30,40)`,
  );

  /*
   * IDEMPOTENCE - the property that was missing, and the one that makes
   * redrawing on every pointermove safe at all. A pointer that reports the
   * same position twice must not move the feature twice.
   */
  dragTo(25);
  dragTo(25);

  check(
    "repeating a position does not move it further",
    beam.geometry.start.x === 25,
    `x = ${beam.geometry.start.x} after holding at 25`,
  );

  dragTo(5);

  check(
    "dragging back towards the origin works the same",
    beam.geometry.start.x === 5,
    `x = ${beam.geometry.start.x}, expected 5`,
  );
}

console.log(
  "\n  an analysis object follows the pointer too\n",
);

/*
 * A DECOMPOSITION IS STILL MOVABLE, and both halves of it are checked because
 * they were wrong in different ways and either could be broken on its own.
 */
[
  ["a Force Components", "force-components"],
  ["a Resultant", "resultant"],
].forEach(([label, type]) => {
  const starting = () => ({
    start: { x: 0, y: 0 },
    end: { x: 60, y: 0 },
  });

  const object = { id: `${type}-1`, type, geometry: starting() };
  const dragTo = dragHarness(object, starting());

  [10, 20, 30, 40].forEach(dragTo);

  check(
    `${label} lands where the pointer is after four moves`,
    object.geometry.start.x === 40,
    `x = ${object.geometry.start.x}, expected 40`,
  );

  check(
    "and its offset records that same distance, not four times it",
    object.geometry.placementOffset?.x === 40,
    `offset = ${JSON.stringify(object.geometry.placementOffset)}, expected 40`,
  );

  /*
   * THE TWO HALVES MUST AGREE. The refresh rebuilds the geometry from the
   * offset alone, so a feature whose ink and whose offset disagree is drawn
   * in one place and drawn in another on the next refresh - the
   * double-translation fault, invisible until it snaps back.
   */
  check(
    "and its ink and its offset agree",
    object.geometry.placementOffset.x ===
      object.geometry.start.x - starting().start.x,
    `offset ${object.geometry.placementOffset?.x} vs drawn ${
      object.geometry.start.x - starting().start.x
    }`,
  );

  dragTo(0);

  check(
    `${label} returns to the source when dragged back to zero`,
    object.geometry.placementOffset?.x === 0 &&
      object.geometry.start.x === 0,
    `offset ${JSON.stringify(
      object.geometry.placementOffset,
    )}, start ${object.geometry.start.x}`,
  );
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
