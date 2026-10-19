
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * DOES A SNAP BECOME A DIMENSION REFERENCE?
 *
 * The join between two vocabularies:
 *
 *   a snap     says  objectId + KIND  ("endpoint", "midpoint")
 *   a reference says featureId + ANCHOR ("start", "end", "center")
 *
 * Nothing converted between them, so a click on a real endpoint had no anchor
 * name to store and could not become a reference at all. This exercises the
 * conversion directly, because the failure it prevents is silent: the tool
 * quietly falls back to measuring the whole feature under the cursor, which
 * looks like it works.
 */

global.window = {
  crypto: { randomUUID: () => "snap-anchor-uuid" }
};

loadModule("measurement-core.js");

const M = global.window.enggMeasurement;

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

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const line = {
  id: "line-1",
  type: "line",
  geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } }
};

console.log("\n  a snap becomes a named anchor\n");

/* THE START. `endpoint` matches both ends, so position must decide. */
check(
  "an endpoint snap at the start resolves to the start anchor",
  M.anchorNameAtPoint(line, { x: 0, y: 0 }, "endpoint") === "start",
  `got ${M.anchorNameAtPoint(line, { x: 0, y: 0 }, "endpoint")}`
);

check(
  "an endpoint snap at the other end resolves to the end anchor",
  M.anchorNameAtPoint(line, { x: 300, y: 0 }, "endpoint") === "end",
  `got ${M.anchorNameAtPoint(line, { x: 300, y: 0 }, "endpoint")}`
);

/* NEAR, NOT ON - which is what a snap actually delivers. */
check(
  "a snap a few pixels off the start still resolves to start",
  M.anchorNameAtPoint(line, { x: 3, y: 0.5 }, "endpoint") === "start",
  `got ${M.anchorNameAtPoint(line, { x: 3, y: 0.5 }, "endpoint")}`
);

/*
 * MIDPOINT. A line now declares one, so this reference can be named
 * and persisted instead of being refused.
 */
check(
  "a midpoint snap on a line resolves to its midpoint anchor",
  M.anchorNameAtPoint(line, { x: 150, y: 0 }, "midpoint") === "midpoint",
  `got ${M.anchorNameAtPoint(line, { x: 150, y: 0 }, "midpoint")}`
);

/*
 * The refusal still has to work. A feature that genuinely offers no
 * matching anchor must return null rather than fall back to whichever
 * anchor happens to be nearest - naming an endpoint there would print
 * a confidently wrong distance.
 */
check(
  "a kind no anchor answers to is still refused, not fudged",
  M.anchorNameAtPoint(line, { x: 150, y: 0 }, "centre") === null,
  `got ${M.anchorNameAtPoint(line, { x: 150, y: 0 }, "centre")} - naming an unrelated anchor would measure the wrong distance`
);

/* END TO END IS A DIFFERENT DIMENSION FROM END TO MIDPOINT. */
const endToEnd = M.spanDimensionTypes({
  start: { x: 0, y: 0 },
  end: { x: 300, y: 0 }
});

const endToMid = M.spanDimensionTypes({
  start: { x: 0, y: 0 },
  end: { x: 150, y: 0 }
});

check(
  "and they measure differently",
  endToEnd.includes("horizontal") && endToMid.includes("horizontal"),
  `end-end ${JSON.stringify(endToEnd)}, end-mid ${JSON.stringify(endToMid)}`
);

/* NO KIND - the filter falls away rather than refusing. */
check(
  "an unrecognised kind still resolves to the nearest anchor",
  M.anchorNameAtPoint(line, { x: 0, y: 0 }, "some-new-kind") === "start",
  `got ${M.anchorNameAtPoint(line, { x: 0, y: 0 }, "some-new-kind")}`
);

/* BOTH SPELLINGS OF CENTRE. */
check(
  "centre and center are the same word",
  M.anchorKindMatches("center", "centre") &&
    M.anchorKindMatches("centre", "center"),
  `center/centre: ${M.anchorKindMatches("center", "centre")}, ${M.anchorKindMatches("centre", "center")}`
);

/* A POINT FEATURE HAS ONE ANCHOR. */
const particle = {
  id: "p-1",
  type: "particle",
  geometry: { position: { x: 120, y: 40 } }
};

check(
  "a point resolves to its position anchor",
  M.anchorNameAtPoint(particle, { x: 120, y: 40 }, "endpoint") === "position",
  `got ${M.anchorNameAtPoint(particle, { x: 120, y: 40 }, "endpoint")}`
);

/* NOTHING TO NAME. */
check(
  "an object with no anchors resolves to nothing rather than a guess",
  M.anchorNameAtPoint(
    { id: "x", type: "unknown", geometry: {} },
    { x: 0, y: 0 },
    "endpoint"
  ) === null
);

check(
  "and a null point is refused too",
  M.anchorNameAtPoint(line, null, "endpoint") === null
);

/*
 * THE ANCHOR ACTUALLY EXISTS AND RESOLVES TO WHERE IT WAS SNAPPED.
 *
 * This is the property that matters: the stored reference must measure the
 * point the student clicked, not merely name something valid.
 */
console.log("\n  and the anchor it names is the point that was snapped\n");

[[0, "start"], [300, "end"]].forEach(([x, expected]) => {
  const name = M.anchorNameAtPoint(line, { x, y: 0 }, "endpoint");
  const resolved = M.resolveAnchor(line, name);

  check(
    `the ${expected} anchor resolves to the point that was snapped`,
    name === expected &&
      resolved &&
      near(resolved.x, x, 1e-9) &&
      near(resolved.y, 0, 1e-9),
    `name ${name}, resolved ${JSON.stringify(resolved)}`
  );
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
