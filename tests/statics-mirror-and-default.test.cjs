
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * MIRROR, AND THE DEFAULT TOOL
 * ========================================================
 *
 * Two things that came out of asking whether the general tools work for
 * every Statics feature.
 *
 * MIRROR HANDLED EVERYTHING EXCEPT THE ANALYSIS DIAGRAM.
 *
 * `mirrorObjectAcrossLine` has a case for the beam, the truss, the force,
 * the load, the moment, the support, the connection and the rigid body. An
 * analysis diagram was not among them, so mirroring one produced a second
 * copy in exactly the same place - which looks precisely like the mirror
 * failing, with nothing to say so. That is the worst shape of miss: a tool
 * that appears to work and silently does the wrong thing.
 *
 * SELECT IS NOW NAMED RATHER THAN NULL.
 *
 * With `activeTool: null`, clicking already selected - but by falling
 * through every tool handler rather than by Select being active. Naming it
 * makes the default state an ordinary one.
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
 * `mirrorObjectAcrossLine` is a private function inside drawing.js's IIFE,
 * so it is pulled out of the source and run against a context of its own -
 * the same technique analysis-panel.test.cjs uses for the panel's own
 * builder. It is extracted rather than reimplemented because the question
 * is what that function DOES, not what a copy of it would do.
 */
const source = controllerSource();

const start = source.indexOf("function mirrorObjectAcrossLine");

if (start < 0) {
  console.log("  FAIL mirrorObjectAcrossLine not found\n");
  process.exit(1);
}

/*
 * Its declaration, from `function` to the closing brace of its body.
 *
 * The end is FOUND rather than estimated. An earlier version added a fixed
 * `+ 3` on the assumption that the brace and the following newline were the
 * next three characters, and sliced through the middle of
 * `placementOffset` - producing a syntax error in a file that was fine.
 */
const openBrace = source.indexOf("{", start);

let depth = 0;
let end = openBrace;

for (let i = openBrace; i < source.length; i++) {
  if (source[i] === "{") {
    depth++;
  } else if (source[i] === "}") {
    depth--;

    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}

const declaration = source.slice(start, end);

/* The branch under test, read from the declaration itself. */
const body = declaration;

const reflectPointAcrossLine = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;

  const t =
    ((point.x - a.x) * dx + (point.y - a.y) * dy) /
    lengthSq;

  const projection = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };

  return {
    x: 2 * projection.x - point.x,
    y: 2 * projection.y - point.y,
  };
};

/*
 * The helpers the body reaches for, supplied as globals. They are not
 * under test - only what the function DOES with each feature type is - and
 * declaring them as plain globals keeps the wrapper to a single line, which
 * an earlier version made into a parse error by redeclaring them.
 */
const sandbox = {
  reflectPointAcrossLine,
  enggFeatureGeometry: {
    rigidBodyShape: () => "rectangle",
    definingPoints: () => [],
    rigidBodyCenter: () => null,
  },

  /*
   * FALSE, not true.
   *
   * The support/connection/moment branch is reached by calling these, and it
   * comes BEFORE the analysis-diagram branch. A stub that claimed everything
   * was a support sent `analysis-diagram` into it - which reflected the
   * frame's two ends (that branch does that for anything) and returned
   * before ever reaching the offset, and the failure looked exactly like a
   * missing branch.
   *
   * It was a fixture lying about the type, and the test believed it.
   */
  isSupportType: () => false,
  isConnectionType: () => false,
};

vm.createContext(sandbox);

const declaration_ = declaration;

vm.runInContext(
  `${declaration_};this.mirrorObjectAcrossLine = mirrorObjectAcrossLine;`,
  sandbox,
);

const mirror = sandbox.mirrorObjectAcrossLine;

check(
  "the mirror function was recovered",
  typeof mirror === "function",
  "extraction failed, so nothing below was actually tested",
);

if (typeof mirror !== "function") {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

/* A VERTICAL AXIS AT x = 0, which flips x and leaves y alone. */
const axis = { start: { x: 0, y: -500 }, end: { x: 0, y: 500 } };

console.log("\n  an analysis diagram is reflected\n");

const diagram = {
  id: "sfd-1",
  type: "analysis-diagram",
  geometry: {
    diagramType: "sfd",
    start: { x: 100, y: -200 },
    end: { x: 400, y: -200 },
    localRange: { from: 0, to: 500 },
    placementOffset: { x: 10, y: 20 },
    expressions: [
      {
        id: "e1",
        relationType: "functionX",
        expression: "10 - 5*x",
        xRange: { start: 0, end: 500 },
      },
    ],
  },
};

mirror(diagram, axis.start, axis.end);

check(
  "the frame's near end moved to the mirror image",
  Math.abs(diagram.geometry.start.x + 100) < 1e-6,
  `start.x is ${diagram.geometry.start.x}, expected ${-100}`,
);

check(
  "and the far end with it",
  Math.abs(diagram.geometry.end.x + 400) < 1e-6,
  `end.x is ${diagram.geometry.end.x}, expected ${-400}`,
);

check(
  "so the axis is genuinely the same length",
  Math.abs(
    Math.abs(
      diagram.geometry.end.x - diagram.geometry.start.x,
    ) - 300,
  ) < 1e-6,
  `the mirrored diagram is ${
    diagram.geometry.end.x - diagram.geometry.start.x
  } long, not 300 - a reflection reverses the direction, so the difference is negative`,
);

check(
  "the placement offset went with it",
  Math.abs(diagram.geometry.placementOffset.x + 10) < 1e-6,
  `offset.x is ${diagram.geometry.placementOffset.x}`,
);

check(
  "and the local range did NOT change",
  diagram.geometry.localRange.from === 0 &&
    diagram.geometry.localRange.to === 500,
  `the range is now ${JSON.stringify(
    diagram.geometry.localRange,
  )} - it is a member length, not a position`,
);

check(
  "nor did the student's expression",
  diagram.geometry.expressions[0].expression ===
    "10 - 5*x",
  "the equation was rewritten by a reflection",
);

console.log("\n  and it was not already working by accident\n");

/*
 * THE MISSING BRANCH WAS SILENT. It is worth proving the test WOULD have
 * failed before the fix: a case that is simply absent returns without
 * touching anything, so "the copy lands in the same place" is what the
 * absence looks like from outside. An earlier version of this file built a
 * fixture for that and never read it - which is the same mistake the bug
 * itself is made of.
 */
check(
  "and it now has a case of its own",
  /analysis-diagram/.test(body),
  "no analysis-diagram branch - the copy would land on the original",
);

console.log("\n  SELECT IS NAMED AS THE DEFAULT\n");

const stateSource = fs.readFileSync(
  locate("drawing-state.js"),
  "utf8",
);

check(
  "a new document starts with Select active",
  /activeTool:\s*"select"/.test(stateSource),
  "it starts with no tool, so clicks select only by falling through",
);

check(
  "not with nothing active",
  !/activeTool:\s*null/.test(stateSource),
  "null is still the default somewhere",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
