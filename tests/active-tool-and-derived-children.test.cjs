/*
 * ========================================================
 * THE ACTIVE TOOL OWNS THE CANVAS
 * ========================================================
 *
 * Three rules, all about one idea - the tool the student has armed decides
 * what a press means, and nothing else does:
 *
 *   1. WHILE A CREATION TOOL IS ACTIVE, existing features cannot be directly
 *      manipulated. A press draws the tool's own thing; it does not move what
 *      is already on the sheet. Only Select interacts with what is drawn.
 *
 *   2. SWITCHING TOP-LEVEL CATEGORY RESETS THE TOOL to Select for the new
 *      category, and abandons any half-built operation from the old one. The
 *      drawing itself is untouched.
 *
 *   3. RESULTANT AND FORCE COMPONENTS ARE DERIVED CHILDREN of the force(s)
 *      they read. They are selectable but NOT movable, they never infer their
 *      input, and creating them asks the student to name the force(s) first.
 */

const fs = require("fs");

const { locate } = require("./helpers/source-path.cjs");

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

const drag = fs.readFileSync(locate("drag.js"), "utf8");
const selection = fs.readFileSync(locate("selection.js"), "utf8");
const toolbar = fs.readFileSync(locate("toolbar.js"), "utf8");
const direct = fs.readFileSync(locate("direct-manipulation.js"), "utf8");
const featureTypes = fs.readFileSync(locate("feature-types.js"), "utf8");
const analysis = fs.readFileSync(locate("analysis-tools.js"), "utf8");
const canvasClick = fs.readFileSync(locate("canvas-click.js"), "utf8");
const handles = fs.readFileSync(locate("handles.js"), "utf8");
const modify = fs.readFileSync(locate("modify-tools.js"), "utf8");

console.log("\n  only Select directly manipulates what is drawn\n");

check(
  "the rule lives in ONE place",
  /export function allowsDirectManipulation/.test(direct) &&
    /activeTool === MANIPULATION_TOOL/.test(direct),
  "several scattered conditions would drift apart",
);

check(
  "the drag entry point asks it FIRST",
  /export function beginManipulationDrag[\s\S]{0,1200}?allowsDirectManipulation\(\)/.test(
    drag,
  ),
  "a branch reachable before the guard could still move a feature",
);

check(
  "grabbing a magnitude label is refused too, while a tool is armed",
  /export function beginAnnotationDrag[\s\S]{0,800}?allowsDirectManipulation\(\)/.test(
    selection,
  ),
);

check(
  "box selection still only starts with Select",
  /beginSelectionDrag[\s\S]{0,900}?allowsDirectManipulation\(\)/.test(selection),
  "it asks the shared predicate rather than repeating the rule inline",
);

console.log("\n  switching category resets the tool, not the drawing\n");

check(
  "the category button resets the active tool",
  /resetActiveToolForCategory/.test(toolbar),
);

check(
  "the reset abandons an unfinished construction",
  /export function resetActiveToolForCategory[\s\S]{0,1800}?clearInteraction/.test(
    selection,
  ),
);

check(
  "and activates Select in the new category",
  /resetActiveToolForCategory[\s\S]{0,2200}?setActiveTool\(\s*drawingState,\s*"select"\s*\)/.test(
    selection,
  ),
);

check(
  "it does NOT delete or modify existing features",
  !/resetActiveToolForCategory[\s\S]{0,1200}(delete|splice|\.length = 0)/.test(
    selection,
  ),
  "a category switch must leave the drawing intact",
);

console.log("\n  Resultant and Force Components are derived children\n");

check(
  "the feature registry marks them derived",
  /resultant:\s*\{[^}]*derived:\s*true/.test(featureTypes) &&
    /"force-components":\s*\{[^}]*derived:\s*true/.test(featureTypes),
);

check(
  "a derived feature exposes a capability, not a type list at the call site",
  /export const isDerivedFeature/.test(featureTypes),
);

check(
  "a drag on a derived child is refused",
  /isDerivedFeature\([\s\S]{0,200}?return false/.test(drag),
);

check(
  "the Move tool does not assume everything selectable is movable",
  /filter\([\s\S]{0,120}?isDerivedFeature/.test(modify),
);

check(
  "resultant/force-components get no manipulation handles",
  !/object\.type === "resultant"[\s\S]{0,120}kind:/.test(handles),
);

console.log("\n  the input is explicit, never inferred\n");

check(
  "the tools enter an input-selection state",
  /export function beginAnalysisInput/.test(analysis) &&
    /phase = "analysis-input"/.test(analysis),
);

check(
  "the state names what to click",
  /"Select force"[\s\S]{0,120}"Select force\(s\)"/.test(analysis) ||
    /Select force\(s\)/.test(analysis),
);

check(
  "entering the state CLEARS the previous selection",
  /beginAnalysisInput[\s\S]{0,600}?selectedObjectIds = \[\]/.test(analysis),
  "the last selected force must not be reused as the input",
);

check(
  "only a force is an input - anything else does nothing",
  /handleAnalysisInputClick[\s\S]{0,900}?candidate\.type === "force"/.test(
    analysis,
  ),
);

check(
  "clicking a non-force does not select it either",
  /if \(!object\) \{[\s\S]{0,300}?return;/.test(analysis),
);

check(
  "a click is routed to the input state BEFORE universal selection",
  /phase ===\s*"analysis-input"[\s\S]{0,300}?handleAnalysisInputClick/.test(
    canvasClick,
  ),
);

check(
  "Enter commits the child from the chosen inputs",
  /phase === "analysis-input"[\s\S]{0,120}?commitAnalysisInput/.test(selection),
);

check(
  "committing with no force chosen creates nothing",
  /commitAnalysisInput[\s\S]{0,400}?if \(!chosen\.length\)[\s\S]{0,120}?return false/.test(
    analysis,
  ),
);

check(
  "an already-chosen force is not added twice",
  /selected\.includes\(object\.id\)/.test(analysis) &&
    /filter\(id => id !== object\.id\)/.test(analysis),
);

console.log("\n  the child is parented and stays live\n");

check(
  "the resultant records its source forces",
  /registerDependency\(\s*resultant/.test(analysis),
);

check(
  "the components record their one force",
  /registerDependency\(\s*resolved/.test(analysis),
);

check(
  "the child is parented to the force's parent",
  /resultant\.parentId[\s\S]{0,120}forces\[0\]\.parentId/.test(analysis) ||
    /resolved\.parentId[\s\S]{0,120}force\.parentId/.test(analysis),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
