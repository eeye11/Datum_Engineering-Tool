/*
 * A DRAG IS UNDOABLE, WHATEVER IT MOVED.
 *
 * This is a structural test, and it is worth being honest about why.
 *
 * The behaviour it guards lives in the editor's drag machinery, which
 * needs a live canvas, so it cannot be exercised from Node. It IS
 * exercised in the browser - an annotation is dragged, the source
 * feature is confirmed unmoved, the link is confirmed intact, and undo
 * is confirmed to put the label back - but that proof is not a
 * regression test, because nobody re-runs it.
 *
 * So the shape of the code is pinned here instead.
 *
 * THE BUG
 * -------
 * The drag machinery snapshotted `object.geometry` and restored it on
 * undo. That is correct for a shape and silently wrong for everything
 * else, because plenty of features are not stored in geometry at all:
 *
 *   - an annotation's position is `placement`
 *   - a dimension's chosen offset is `placement`
 *
 * Moving either wrote to those fields, the undo entry held only
 * geometry, and restoring it left the moved object exactly where the
 * student had put it. Undo appeared to work - the drawing redrew, the
 * history advanced - while doing nothing to the thing the student was
 * trying to undo.
 *
 * Nothing threw and nothing looked wrong. That is the whole reason it
 * is pinned structurally.
 */
const fs = require("fs");
const path = require("path");

const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
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

const source = controllerSource();

const section = (name) => {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) {
    return "";
  }
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};

console.log("\nThe drag snapshots the whole object");

const begin = section("beginManipulationDrag");

check("beginManipulationDrag exists", begin.length > 0);

check(
  "it snapshots the object",
  /originals:\s*\{\s*\[hit\.object\.id\]:\s*JSON\.parse\(/s.test(begin),
  "no originals entry keyed by the object id"
);

check(
  "and does NOT snapshot only the geometry",
  !/JSON\.stringify\(\s*hit\.object\.geometry\s*\)/s.test(begin),
  "the snapshot is geometry-only, so a move of `placement` cannot be undone"
);

console.log("\nFinishing a drag restores the whole object");

const finish = section("finishManipulationDrag");

check("finishManipulationDrag exists", finish.length > 0);

check(
  "the undo entry spreads the whole snapshot",
  /\.\.\.JSON\.parse\(\s*JSON\.stringify\(\s*drag\.originals\[/s.test(finish),
  "the undo entry does not spread the snapshot"
);

check(
  "and does not restore geometry alone",
  !/geometry:\s*JSON\.parse\(/s.test(finish),
  "the undo entry restores only `geometry`, leaving `placement` moved"
);

/*
 * THE RELEASE IS THE COMMIT.
 *
 * A body drag once stayed live after release and waited for a "placing"
 * click before it recorded anything. Ctrl+Z in that window undid the step
 * BEFORE the move - usually the shape's creation - so the shape vanished
 * (Geometry GEO-01). Checked in Chrome: drag, release, Ctrl+Z now returns
 * the shape to where it was.
 */
console.log("\nReleasing a drag commits it - there is no placing click");

check(
  "finishManipulationDrag does not hold the drag open after release",
  !/awaitingPlacement|holdForPlacement/.test(finish),
  "a released drag that waits for a click has no undo entry yet"
);

check(
  "and no other part of the editor waits for a placing click",
  !/awaitingPlacement|placeAwaitingSelection/.test(source),
  "the floating move is back somewhere else"
);

check(
  "the trailing click after a moved drag is swallowed",
  /selectionClickSuppressed\s*=\s*true/.test(finish),
  "the release's click re-selects whatever is under it, dropping the edited feature"
);

console.log("\nCancelling a drag restores it too");

const cancel = section("cancelManipulationDrag");

check("cancelManipulationDrag exists", cancel.length > 0);

check(
  "the rollback spreads the whole snapshot",
  /\.\.\.JSON\.parse\(\s*JSON\.stringify\(\s*drag\.originals\[/s.test(cancel),
  "the rollback restores only geometry, so Escape would leave a moved label in place"
);

console.log("\nAnd identity and style are never rolled back");

/*
 * Both restores take a deep clone of the whole object, which would also
 * restore a stale id or style if one were captured before a later edit.
 * Re-keying the object to its live id is what keeps a rolled-back
 * feature attached to everything that points at it.
 */
[finish, cancel].forEach((code, index) => {
  const label = index === 0 ? "finish" : "cancel";

  check(
    `${label} keeps the live id`,
    /id:\s*object\.id/.test(code),
    "the restored object keeps a snapshotted id, which can detach it"
  );

  check(
    `${label} keeps the live style`,
    /style:\s*object\.style/.test(code)
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
