
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const { controllerSource, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * THE SNAP AND INFERENCE HALF OF THE STATUS TEXT
 * ========================================================
 *
 * The status line is the tool's instruction with the current snap APPENDED.
 * When nothing is snapped, the snap half must be gone entirely - not a
 * separator, not a bullet, not a leftover "Horizontal" from a position the
 * cursor left thirty seconds ago.
 *
 * The message builder already filters empty labels, so the interesting
 * question is what it is GIVEN: a resolution whose `inference` and
 * `snapCandidate` still describe the previous cursor position would produce
 * a stale suffix that reads as though the snap were still live.
 *
 * These check the message builder against the shapes a resolution can take,
 * because that is where the answer is decided.
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

const lines = source.split(/\r?\n/);

/*
 * `constructionFeedbackMessage` is a private function, so it is lifted out of
 * the source the way analysis-panel.test.cjs lifts the panel's builder - and
 * for the same reason: the question is what THIS function does, not what a
 * reimplementation would do.
 */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);

  if (start < 0) {
    return null;
  }

  const open = source.indexOf("{", start);

  let depth = 0;
  let end = open;

  for (let i = open; i < source.length; i++) {
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

  return source.slice(start, end);
}

/* The label table both of these are built from. */
const snapTypeLabel = (type) =>
  ({
    endpoint: "Endpoint",
    midpoint: "Midpoint",
    center: "Center",
    quadrant: "Quadrant",
    intersection: "Intersection",
    perpendicular: "Perpendicular",
    "point-on-entity": "Point on entity",
    "point-on-body": "Point on entity",
    guide: "Guide",

    /*
     * The alignment cases. They go through the same table rather than being
     * spelled out at the call site, so "Horizontal" is reported the same way
     * whether it came from an inference or from a candidate.
     */
    horizontal: "Horizontal",
    vertical: "Vertical",
    horizontalVertical: "Horizontal + Vertical",
    hv: "Horizontal + Vertical",
    both: "Horizontal + Vertical",
  })[type] || "";

const sandbox = {
  snapTypeLabel,
  inferenceLabel: (inference) =>
    snapTypeLabel(inference?.type || inference),
};

vm.createContext(sandbox);

vm.runInContext(
  extract("constructionFeedbackMessage") +
    "\nthis.message = constructionFeedbackMessage;",
  sandbox,
);

const message = sandbox.message;

check(
  "the message builder was recovered",
  typeof message === "function",
  "extraction failed, so nothing below was actually tested",
);

if (typeof message !== "function") {
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

const resolution = (extra) => ({
  rawPointerPoint: { x: 10, y: 10 },
  effectiveConstructionPoint: { x: 10, y: 10 },
  snappedPoint: null,
  inferredPoint: null,
  snapCandidate: null,
  hoveredEntity: null,
  inference: null,
  ...extra,
});

console.log("\n  nothing snapped, nothing shown\n");

const bare = message(resolution(), "Specify second point");

check(
  "the status is the instruction and nothing else",
  bare === "Specify second point",
  `got ${JSON.stringify(bare)}`,
);

check(
  "and no separator is left dangling",
  !bare.includes("•") && !bare.includes("·"),
  `got ${JSON.stringify(bare)}`,
);

console.log("\n  a live snap IS shown\n");

const snapped = message(
  resolution({ snapCandidate: { type: "midpoint" } }),
  "Specify second point",
);

check(
  "and the suffix appears",
  snapped.includes("Midpoint"),
  `got ${JSON.stringify(snapped)}`,
);

check(
  "with the instruction still first",
  snapped.startsWith("Specify second point"),
  `got ${JSON.stringify(snapped)} - the question was replaced by the report`,
);

console.log("\n  and a live inference is shown too\n");

const inferred = message(
  resolution({ inference: { type: "horizontal" } }),
  "Specify force direction",
);

check(
  "Horizontal is reported",
  /Horizontal/.test(inferred),
  `got ${JSON.stringify(inferred)}`,
);

console.log("\n  A MISSING FIELD IS TREATED AS NO SNAP, NOT AS UNKNOWN\n");

/*
 * THE CASE THAT PRODUCES THE COMPLAINT.
 *
 * A resolution built somewhere without an `inference` key at all - a tool
 * that returns the points and forgets the rest - must read as "nothing
 * snapped" rather than as an unprintable label that sticks to the end of the
 * instruction forever.
 */
for (const key of ["inference", "snapCandidate"]) {
  const partial = resolution();

  delete partial[key];

  const text = message(partial, "Specify second point");

  check(
    `an absent ${key} shows nothing`,
    text === "Specify second point",
    `got ${JSON.stringify(text)}`,
  );
}

console.log("\n  and a snap on one axis does not linger as an inference\n");

/*
 * A snap candidate with no type, and an inference that is merely present -
 * the shapes a resolver produces when it has a candidate but has not
 * classified it. Neither may become text.
 */
const unclassified = message(
  resolution({
    snapCandidate: { x: 10, y: 10 },
    inference: {},
  }),
  "Specify second point",
);

check(
  "an unclassified candidate is not announced",
  unclassified === "Specify second point",
  `got ${JSON.stringify(unclassified)}`,
);

/*
 * ========================================================
 * THE STALE RESOLUTION
 * ========================================================
 *
 * The builder is correct - it prints a snap only when it is GIVEN one. So
 * the complaint can only arise if a resolution carrying an old inference
 * reaches it after the cursor has moved off whatever was aligned.
 *
 * That is a question about the CALLERS, not the builder, so it is asked of
 * the source: the status must be built from the resolution just handed over,
 * with no stored fallback and no cache.
 */
console.log("\n  and the status is only ever set from a FRESH resolution\n");

check(
  "the message reads only the resolution it is given",
  !/interaction\.(inference|snapCandidate)/.test(
    extract("constructionFeedbackMessage"),
  ),
  "it falls back to a stored snap somewhere",
);

check(
  "and no caller supplies a label from storage",
  !/inferenceLabel\(\s*drawingState/.test(source) &&
    !/snapTypeLabel\(\s*drawingState/.test(source),
  "a caller is passing a stored inference rather than a fresh one",
);

/*
 * ========================================================
 * EVERY EARLY RETURN REBUILDS THE STATUS
 * ========================================================
 *
 * The builder is fine and the resolution is fresh, so the only way a stale
 * suffix survives is if the status is never REWRITTEN - which happens on any
 * path that returns before reaching the call.
 *
 * `updatePreview` has six such paths: the analysis axis, the moment's
 * radius, an annotation's position, a dimension's placement, an idle sheet
 * and a construction with no start point yet. Each drives its own preview,
 * and each used to return without touching the status - so the last snap the
 * cursor made stayed printed for as long as the tool was active.
 *
 * Rather than assert on each one by name, this walks every top-level return
 * in the function and requires a status call before it. A branch added later
 * has to satisfy the same rule by construction.
 */
const startLine = lines.findIndex((l) =>
  l.startsWith("function updatePreview("),
);

let depth = 0;
let started = false;
let endLine = startLine;

for (let i = startLine; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
    }
  }

  if (started && depth === 0) {
    endLine = i;
    break;
  }
}

check(
  "updatePreview was found",
  startLine >= 0,
);

/*
 * A `return` at the top level of the function: one with no braces opened or
 * closed on its own line. A return that only leaves a nested `if` is a
 * different thing - the code after it still runs.
 */
const statusWords =
  /setToolMessage|reportConstructionStatus|reportLiveConstructionStatus|updateInteractionFeedback/;

let checked = 0;
let missing = [];

lines.slice(startLine, endLine + 1).forEach((line, offset) => {
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;

  if (opens !== 0 || closes !== 0) {
    return;
  }

  if (!/^\s*return\b/.test(line)) {
    return;
  }

  const at = startLine + offset;

  checked++;

  /* The 25 lines leading up to it are that branch's body. */
  const window = lines
    .slice(Math.max(startLine, at - 25), at + 1)
    .join("\n");

  if (!statusWords.test(window)) {
    missing.push(at + 1);
  }
});

check(
  `all ${checked} early returns in updatePreview rebuild the status`,
  missing.length === 0,
  `lines ${missing.join(", ")} return without setting the status, so the ` +
    "last snap stays printed",
);

/*
 * ========================================================
 * AND NO PHASE IS LEFT SPEECHLESS
 * ========================================================
 *
 * The status has two halves and they are written at different moments, so
 * asking one function to describe every phase asks the wrong question.
 *
 * A phase is announced by the CLICK that ENTERS it - "Specify second point"
 * arrives the moment the first point is placed - and from then on the
 * move-time feedback keeps it, adding the snap half. So the question is not
 * "does updateInteractionFeedback know this phase" but "is there a message
 * anywhere for it".
 *
 * An earlier version of this check demanded the former and reported ten
 * phases as undescribable - all of them perfectly well described, just at
 * the click rather than on the move.
 */
const phasesWritten = new Set();

for (const match of source.matchAll(
  /interaction\.phase\s*=\s*["']([a-z-]+)["']/g,
)) {
  phasesWritten.add(match[1]);
}

for (const match of source.matchAll(
  /phase\s*:\s*["']([a-z-]+)["']/g,
)) {
  phasesWritten.add(match[1]);
}

/*
 * THE MESSAGES THAT EXIST, anywhere in the file. A phase is answered if it
 * is named beside a message - either as a phase key in an instruction table
 * or in a comparison that decides which message to show.
 */
const phaseTables = [
  extract("updateInteractionFeedback"),
  extract("constructionFeedbackMessage"),
  extract("updatePreview"),
];

const loadPhases = source.slice(
  source.indexOf("const CONSTRUCTION_ACTIVE_PHASES"),
  source.indexOf("const CONSTRUCTION_ACTIVE_PHASES") + 1200,
);

const described = [...phasesWritten].filter((phase) => {
  if (phase === "idle") {
    return true;
  }

  const mentioned = phaseTables.some(
    (text) => text && text.includes(`"${phase}"`),
  );

  /*
   * A phase listed as one that waits for MORE input is one whose message
   * was given when it was entered, and the tool is mid-construction - so
   * the status is already correct and does not need restating.
   */
  const active = loadPhases.includes(`"${phase}"`);

  return mentioned || active;
});

check(
  `every phase the code enters (${phasesWritten.size}) is accounted for`,
  described.length === phasesWritten.size,
  `no message anywhere for: ${
    [...phasesWritten].filter((p) => !described.includes(p)).join(", ")
  }`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
