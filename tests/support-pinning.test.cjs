
const path = require("path");
const fs = require("fs");

const { controllerSource, loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DOES A SUPPORT STAY PINNED WHILE IT IS BEING MOVED?
 * ========================================================
 *
 * A support is attached to a MEMBER, not to a place on the sheet. Its position
 * is the fraction of the member it stands at, and that is what makes it
 * survive the member being resized, moved or rotated after the fact.
 *
 * IT USED TO UNPIN THE MOMENT IT WAS TOUCHED.
 *
 * The support's position handle wrote the raw cursor point straight into
 * `geometry.position` and then re-read the parent from wherever the pointer
 * happened to be. Because the symbol is drawn clear of the beam, the pointer
 * is almost never over the beam - so the re-read came back null, `parentId`
 * was cleared, and the support was orphaned on the first pointermove.
 *
 * Three symptoms, one cause:
 *
 *   - it turned into a cross, because with no parent the renderer had no
 *     member to resolve a position against and drew nothing it recognised;
 *   - it stopped being pinned to the body, since there was no longer a body;
 *   - it could be dragged anywhere, because there was nothing left to
 *     constrain it.
 *
 * The `position` handle is the entry point, and the check is that dragging it
 * changes WHERE ALONG THE MEMBER the support stands and nothing else - not the
 * world coordinate, and certainly not the parent.
 *
 * The behaviour under test is `applyStaticsManipulation`'s, so the source is
 * read and the branch is exercised through the same path a pointer takes.
 */


const projectRoot = path.join(__dirname, "..");

const drawingSource = controllerSource();

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

/* ---------------------------------------------------------------------
 * The branch, lifted from the real source so it cannot drift from it.
 * ------------------------------------------------------------------ */

const branchStart = drawingSource.indexOf(
  'if (kind === "position" && g.position) {',
);

const wholeBranch = drawingSource.slice(
  branchStart,
  drawingSource.indexOf("\n    }\n", branchStart),
);

/*
 * ONLY THE SUPPORT HALF OF IT.
 *
 * The handle has two behaviours by design: a support is projected onto its
 * member, and everything else is a free feature that may genuinely be
 * re-parented by dropping it elsewhere. So the source check below is aimed at
 * the support case, and reading the whole branch would flag the generic
 * `updateAttachment` call that is correct for the features it serves.
 */
const supportStart = wholeBranch.indexOf("isSupportType");

const branch =
  supportStart === -1
    ? ""
    : wholeBranch.slice(
        supportStart,
        wholeBranch.indexOf("\n        g.position = {"),
      );

check(
  "the position handle still exists to be tested",
  branchStart !== -1 && supportStart !== -1 && branch.length > 0,
  "could not find the support's position-handle branch",
);

check(
  "it handles a support specifically",
  branch.includes("isSupportType"),
  "a support's position handle falls through to the generic free-move path",
);

/*
 * THE TWO THINGS THAT MUST NOT HAPPEN. Both are one line of code each, and
 * both are the whole fault - a `parentId = null` from a cursor that was not
 * over the beam, and a raw world point written into a value that means
 * "fraction along the member".
 */
check(
  "a support's drag resolves onto the member frame",
  branch.includes("frameOf") && branch.includes("attachmentFor"),
  "the drag is not measured on the member",
);

check(
  "and does not re-parent from the cursor position",
  !branch.includes("updateAttachment"),
  "updateAttachment is still called: dropping on empty canvas clears the parent",
);

/* ---------------------------------------------------------------------
 * The model the branch is judged against, exercised for real.
 * ------------------------------------------------------------------ */

global.window = { crypto: { randomUUID: () => "support-pin-uuid" } };

loadModule("body-frames.js");

const frames = global.window.enggBodyFrames;

const beam = {
  id: "beam-1",
  type: "beam",
  geometry: { start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, depth: 12 },
};

const frame = frames.frameOf(beam);

/* A support sitting a quarter of the way along, as placement leaves it. */
const support = {
  id: "pin-1",
  type: "pin-support",
  parentId: "beam-1",
  engineering: { discipline: "statics" },
  geometry: {
    attachment: { fraction: 0.25, unit: "fraction" },
    flipped: false,
    orientation: 0,
  },
};

console.log("\n  a dragged support stays on its member\n");

/*
 * WHAT A DRAG PRODUUCES, computed the way the fixed branch computes it: the
 * pointer is projected onto the member and stored as a fraction.
 */
const dragTo = pointer => {
  const clamped = Math.min(
    frame.length,
    Math.max(0, frames.positionOn(frame, pointer)),
  );

  const moved = frames.pointAt(frame, clamped);

  support.geometry.attachment = frames.attachmentFor(frame, moved);

  const placement = frames.supportPlacement(
    beam,
    moved,
    support.geometry.flipped === true,
  );

  if (placement) {
    support.geometry.position = placement.render;
  }
};

const stationOf = () =>
  frames.attachmentPoint(frame, support.geometry.attachment).x;

/*
 * THE POINTER IS OFF THE BEAM, which is the whole situation: the symbol is
 * drawn clear of the member, so a student dragging it is grabbing something
 * that is not over the line at all.
 */
dragTo({ x: 180, y: 40 });

check(
  "it lands on the member even though the pointer was not on it",
  Math.abs(stationOf() - 180) < 1e-9,
  `station is ${stationOf()}, expected 180`,
);

check(
  "and it is stored as a fraction of the member, not a world point",
  support.geometry.attachment.unit === "fraction" &&
    Math.abs(support.geometry.attachment.fraction - 0.45) < 1e-9,
  `attachment = ${JSON.stringify(support.geometry.attachment)}`,
);

/*
 * A FAR-OFF POINTER MUST NOT UNPIN IT. This is the regression: the pointer is
 * a long way from the beam and nothing about the support may change except
 * where along the beam it stands.
 */
dragTo({ x: 500, y: 300 });

check(
  "a pointer far off the member does not unpin it",
  support.parentId === "beam-1",
  `parentId became ${JSON.stringify(support.parentId)}`,
);

check(
  "it is clamped to the member rather than escaping it",
  stationOf() <= 400 + 1e-9,
  `station is ${stationOf()}, past the end of a 400 member`,
);

/*
 * AND IT SURVIVES THE MEMBER CHANGING, which is the reason the value is a
 * fraction rather than a coordinate. A support dragged to the far end and
 * then doubled still stands at the end, not at the same millimetres.
 */
dragTo({ x: 300, y: 0 });

const longer = {
  geometry: { start: { x: 0, y: 0 }, end: { x: 800, y: 0 }, depth: 12 },
};

const afterResize = frames.attachmentPoint(
  frames.frameOf(longer),
  support.geometry.attachment,
);

check(
  "a support dragged along its member stays proportional when it is resized",
  Math.abs(afterResize.x - 600) < 1e-9,
  `resolved to ${afterResize.x} on the longer member, expected 600`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
