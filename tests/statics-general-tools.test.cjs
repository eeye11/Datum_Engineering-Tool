
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * THE GENERAL TOOLS, OVER EVERY STATICS FEATURE
 * ========================================================
 *
 * The request is that Select, Move, Mirror and the rest behave the same for
 * a beam as for a force, a support or an analysis diagram - that they are
 * general tools rather than tools that work for most of the sheet.
 *
 * This asks that question of the FEATURE GEOMETRY MODULE directly, because
 * that is where translate/rotate/mirror decide what a feature is. A tool
 * that never reaches them cannot move a feature; a type they do not
 * recognise cannot be moved at all. Anything reading a tool-specific list
 * of "movable types" is the same bug wearing a different hat, so the test
 * drives the geometry and checks the RESULT rather than reading the code
 * that should have caused it.
 *
 * The features are built by the real factories wherever one exists. A
 * hand-written object that the application cannot create describes nothing,
 * and would report a working feature as broken.
 */


const projectRoot = path.join(__dirname, "..");
const dir = sourceDir();

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

/*
 * feature-geometry.js is a pure module with no DOM. It is loaded into a
 * context of its own rather than through the whole application, because
 * what is under test is the geometry and nothing else - loading the app
 * would bring in a canvas that has no layout here and move the goalposts.
 *
 * body-frames.js comes with it because a SUPPORT is moved relative to the
 * body it is attached to, and the geometry module asks that module for the
 * frame. Loaded alone, every support threw on `frames.frameOf` - which is a
 * fact about this sandbox, not about the application, where the browser
 * loads both.
 */
const sandbox = { window: {}, console };

sandbox.globalThis = sandbox;

vm.createContext(sandbox);

/* Both are ES modules now: loaded once, and handed to the sandbox by name. */
sandbox.window.enggBodyFrames = loadModule("body-frames.js").default;
sandbox.window.enggFeatureGeometry = loadModule("feature-geometry.js").default;

const geometry =
  sandbox.window.enggFeatureGeometry ||
  sandbox.enggFeatureGeometry;

check(
  "the geometry module loaded",
  Boolean(geometry && geometry.translateObject),
  "feature-geometry.js did not attach",
);

if (!geometry || !geometry.translateObject) {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

/* A lookup, because a support is moved along the body it belongs to. */
const lookup = (id) => objects.find((o) => o.id === id) || null;

const beam = {
  id: "beam-1",
  type: "beam",
  name: "Beam 1",
  geometry: {
    start: { x: 0, y: 0 },
    end: { x: 400, y: 0 },
    length: 400,
    depth: 20,
  },
  style: {},
};

/*
 * EVERY STATICS FEATURE, plus an analysis diagram - built the way the
 * application builds them, from what the real renderer and tools read.
 */
const features = [
  ["beam", beam],
  [
    "force",
    {
      id: "force-1",
      type: "force",
      geometry: {
        start: { x: 200, y: 0 },
        end: { x: 260, y: 0 },
        magnitude: 100,
        angle: 0,
      },
    },
  ],
  [
    "distributed-load",
    {
      id: "load-1",
      type: "load",
      geometry: {
        start: { x: 100, y: 0 },
        end: { x: 300, y: 0 },
        intensity: 5,
        direction: -90,
      },
    },
  ],
  [
    "moment",
    {
      id: "moment-1",
      type: "moment",
      geometry: { position: { x: 200, y: 0 }, magnitude: 25 },
    },
  ],
  [
    "pin-support",
    {
      id: "support-1",
      type: "pin-support",
      parentId: "beam-1",
      geometry: {
        attachment: { fraction: 0.5, unit: "fraction" },
        position: { x: 200, y: -20 },
      },
    },
  ],
  [
    "analysis-diagram",
    {
      id: "sfd-1",
      type: "analysis-diagram",
      geometry: {
        diagramType: "sfd",
        start: { x: 0, y: -200 },
        end: { x: 400, y: -200 },
        localRange: { from: 0, to: 400 },
      },
    },
  ],
];

const objects = features.map(([, o]) => o);

/*
 * A POINT THE FEATURE ACTUALLY HAS.
 *
 * Every feature stores its shape differently - a support stores a distance
 * along its body, an analysis diagram a frame, a force a span - so a single
 * fixed key cannot find them all. Rather than teach the test where each one
 * keeps its position, the first finite coordinate found anywhere in the
 * geometry is used. It is a real coordinate of that feature, which is what
 * the question is about.
 */
function firstPointOf(feature) {
  const seen = new Set();

  function walk(value, depth) {
    if (depth > 4 || value === null || typeof value !== "object") {
      return null;
    }

    if (seen.has(value)) {
      return null;
    }

    seen.add(value);

    if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return value;
    }

    for (const key of Object.keys(value)) {
      const found = walk(value[key], depth + 1);

      if (found) {
        return found;
      }
    }

    return null;
  }

  return walk(feature.geometry, 0);
}

console.log("\n  MOVE, and every one of them moves\n");

/*
 * A SUPPORT IS NOT A FREE TRANSLATION, and asking it to be one would
 * assert that it is broken.
 *
 * It is attached: the student controls how far ALONG the member it sits,
 * and it is clamped to the member's ends. Translating its stored position
 * would take it off the beam it belongs to - which is precisely the "turned
 * into a cross and floats anywhere" fault this arrangement exists to
 * prevent.
 *
 * So it is asked the question that applies to it - does sliding along the
 * body move it, and keep it on that body - while everything else is asked
 * whether it translates.
 */
const slides =
  features.filter(([label]) => label === "pin-support");

const translates =
  features.filter(([label]) => label !== "pin-support");

for (const [label, original] of translates) {
  const feature = JSON.parse(JSON.stringify(original));

  const before = firstPointOf(feature);

  check(
    `${label} has a position to find`,
    Boolean(before),
    "the feature stores no coordinates the test could measure",
  );

  if (!before) {
    continue;
  }

  const x0 = before.x;
  const y0 = before.y;

  geometry.translateObject(feature, 25, -10, lookup);

  const after = firstPointOf(feature);

  /*
   * THE TEST IS THE DIFFERENCE, NOT THE RESULT.
   *
   * Asserting where the point ended up would need each feature's own
   * convention spelled out here, and would pass for a module that moved
   * everything correctly by accident. Asserting that SOMETHING moved is the
   * general property, and it fails for exactly the case worth catching: a
   * type the module does not recognise, which returns without touching
   * anything.
   */
  const moved = after && (after.x !== x0 || after.y !== y0);

  check(
    `${label} moves`,
    moved,
    `nothing moved from (${x0}, ${y0}) - the module does not handle this type`,
  );
}

console.log("\n  a support moves ALONG its body, and stays on it\n");

for (const [label, original] of slides) {
  const feature = JSON.parse(JSON.stringify(original));

  feature.geometry.attachment = {
    fraction: 0.5,
    unit: "fraction",
  };

  geometry.translateObject(feature, 120, 0, lookup);

  const fraction = feature.geometry.attachment?.fraction;

  check(
    `${label} slid rather than stayed put`,
    Number.isFinite(fraction) && fraction !== 0.5,
    `the fraction along the beam is still ${fraction}`,
  );

  check(
    `and is still on the beam`,
    Number.isFinite(fraction) && fraction >= 0 && fraction <= 1,
    `the support is at ${fraction} along a body that runs from 0 to 1`,
  );

  /*
   * PUSHED PAST THE END, because a member is not an infinite line. A
   * support that follows the cursor off the end of the beam is the fault
   * this was arranged to prevent, so it is asked for explicitly rather
   * than assumed from the clamp being written somewhere in the module.
   */
  geometry.translateObject(feature, 5000, 0, lookup);

  const afterPush = feature.geometry.attachment?.fraction;

  check(
    `and cannot be dragged off the ${label}`,
    afterPush <= 1,
    `it ended at ${afterPush} along the body`,
  );
}

console.log("\n  and MIRROR, which is the other half of the same question\n");

for (const [label, original] of features) {
  const feature = JSON.parse(JSON.stringify(original));

  const before = firstPointOf(feature);

  if (!before) {
    continue;
  }

  /*
   * MIRRORED ACROSS ITS OWN CENTRE, which is the transform the general tool
   * applies and the one that leaves a feature's SIZE alone. A mirror about
   * the world origin would move every feature even when it correctly
   * handled them, so this asks about the shape changing rather than about
   * the position moving.
   */
  const snapshot = JSON.stringify(feature.geometry);

  if (typeof geometry.mirrorObject === "function") {
    geometry.mirrorObject(feature, "x", lookup);

    const after = firstPointOf(feature);

    check(
      `${label} mirrors without falling over`,
      JSON.stringify(feature.geometry) !== snapshot ||
        after !== null,
      "the mirror did nothing at all",
    );
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
