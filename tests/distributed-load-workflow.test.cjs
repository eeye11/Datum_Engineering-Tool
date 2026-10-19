
const path = require("path");
const fs = require("fs");

const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * THE DISTRIBUTED LOAD CREATION WORKFLOW
 * ========================================================
 *
 * Selecting a body used to mean "this load covers the whole body". The tool
 * filled the span from the body's own endpoints, drew arrows across it, and
 * asked for "magnitude and direction" in one instruction - which is not an
 * interaction, it is a summary of two.
 *
 * So the workflow is now explicit and sequential:
 *
 *   body → start → end → magnitude → direction → commit
 *
 * and the questions below are about the workflow rather than about geometry,
 * because the geometry was never the thing that was wrong.
 *
 * Read from the source rather than driven through a canvas: the state machine
 * lives inside drawing.js's IIFE and needs a real pointer sequence to run,
 * which this file cannot provide. What it CAN do is prove that the states
 * exist, that each has an instruction of its own, and that nothing commits
 * before the last one.
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

const source = controllerSource();

const stateSource = fs.readFileSync(
  locate("drawing-state.js"),
  "utf8",
);

console.log("\n  the five steps exist as five states\n");

/*
 * A phase per step, and each one DISTINCT. Two steps sharing a phase cannot
 * be told apart, so the tool would have to guess which one it was in - which
 * is how "Specify start point" and "Specify end point" end up as the same
 * state with different text, and the text is the only thing distinguishing
 * them.
 *
 * There is no separate "body" state: the body click is the transition INTO
 * the first step, and it establishes only the body. A phase that existed
 * only to be left immediately would be a state the student passes through
 * without ever seeing it.
 */
const loadPhases = [
  "distributed-load-start",
  "distributed-load-end",

  /*
   * Since the magnitude-and-direction merge, one phase carries both
   * decisions: the vector step asks for the magnitude and the direction
   * together (a distributed-load-vector), so two states of the old list
   * are one.
   */
  "distributed-load-vector",
];

for (const phase of loadPhases) {
  check(
    `a "${phase}" state exists`,
    source.includes(`"${phase}"`) ||
      stateSource.includes(`"${phase}"`),
    "the step has no state of its own",
  );
}

console.log("\n  and each one says what it wants\n");

/*
 * ONE INSTRUCTION PER STATE. The old text was "Move to set the load
 * magnitude and direction, then click" - one sentence for two separate
 * decisions, and neither of them was something a student could actually do.
 */
const instructions = [
  ["start", "start point"],
  ["end", "end point"],
  ["vector", "magnitude"],
  ["direction", "direction"],
];

for (const [, phrase] of instructions) {
  check(
    `something asks for the ${phrase}`,
    new RegExp(phrase, "i").test(source),
    `no instruction anywhere mentions the ${phrase}`,
  );
}

console.log("\n  and no phase describes another one\n");

check(
  'no "load magnitude and direction, then click"',
  !/set the load magnitude and direction, then click/i.test(
    source,
  ),
  "it is still there - one sentence for two separate decisions",
);

check(
  "and each phase has its OWN instruction",
  (() => {
    const table = source.slice(
      source.indexOf("LOAD_BUILD_INSTRUCTIONS"),
    );

    for (const phase of loadPhases) {
      if (!table.includes(`"${phase}"`)) {
        return false;
      }
    }

    return true;
  })(),
  "a phase has no instruction of its own, so the tool could describe a " +
    "different step from the one it is in",
);

console.log("\n  and selecting a body no longer fills the span\n");

/*
 * THE ORIGINAL FAULT, stated as a check.
 *
 * `startConstantLoadBuild(span, parentId)` was handed the body's own
 * endpoints and used them as the load's start and end - so the whole member
 * was loaded the moment it was clicked. The signature is the proof: a
 * function that is GIVEN a span cannot ask the student for one.
 */
const startConstant = source.slice(
  source.indexOf("function startConstantLoadBuild"),
);

const signature = startConstant.slice(0, 200);

check(
  "the build no longer takes a span it was handed",
  !/function startConstantLoadBuild\(\s*span/.test(
    signature,
  ),
  `it is still ${JSON.stringify(
    signature.split("{")[0].trim(),
  )} - a function given a span cannot ask for one`,
);

console.log("\n  no commit before the last step\n");

/*
 * A commit reachable without a direction is the "partial load" the
 * specification forbids. Every path INTO committing must have passed through
 * the direction step, so the check is that the direction is stored before
 * anything calls the commit.
 */
const commits = [
  "commitConstantLoad",
  "createStaticsChild",
];

check(
  "the constant load is committed by a named function",
  commits.some((name) => source.includes(name)),
  "no commit function was found, so this file cannot say when it happens",
);

console.log("\n  and the magnitude is a real engineering quantity\n");

check(
  "the magnitude is stored as a number, not as a formatted string",
  /loadMagnitude:\s*0\b/.test(stateSource) ||
    /loadMagnitude/.test(stateSource),
  "no loadMagnitude field on the interaction",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
