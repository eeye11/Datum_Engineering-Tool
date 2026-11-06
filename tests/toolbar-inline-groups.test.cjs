/*
 * ========================================================
 * AN INLINE GROUP SAYS WHETHER IT IS OPEN
 * ========================================================
 *
 * The toolset bar draws a group - Flow Paths, Bodies, Loads, Kinematics - as a
 * button with its children underneath it. The button toggles that list, so it
 * has to STATE whether the list is showing: `aria-expanded` is what a screen
 * reader announces, and `aria-controls` is what says which list is meant.
 *
 * THE DEFECT THIS PREVENTS. The pair used to be written only by a string
 * replace that matched 'aria-expanded="false"' - and most group buttons never
 * carried the attribute at all, so the replace found nothing and the button
 * rendered with no state. The students most affected are the ones the
 * attribute is for: a control that never says "collapsed" is a control a
 * screen reader cannot describe, and a search that expands a group leaves no
 * record on the page that it did.
 *
 * So this boots the real page and reads the rendered bar, for every group in
 * every category.
 */
const { bootApp } = require("./helpers/boot-app.cjs");

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

console.log("\n  every inline group in the toolset bar states its state\n");

const { window, document, error } = bootApp();

check("the page booted", !error, error ? String(error.message) : "");

const categories = [...document.querySelectorAll(".drawing-category")].map(
  (button) => button.dataset.category,
);

check("the toolset bar has categories", categories.length > 0, categories.join(", "));

const seen = [];

categories.forEach((category) => {
  const button = document.querySelector(`.drawing-category[data-category="${category}"]`);

  button.click();

  const groups = [...document.querySelectorAll("#drawingToolList .drawing-tool[aria-controls]")];

  groups.forEach((group) => {
    const section = document.getElementById(group.getAttribute("aria-controls"));

    seen.push({
      category,
      id: group.dataset.toolId,
      expanded: group.getAttribute("aria-expanded"),
      controlled: Boolean(section),
      hiddenMatches:
        section === null
          ? false
          : section.hidden === (group.getAttribute("aria-expanded") === "false"),
    });
  });
});

check(
  "at least one inline group was rendered",
  seen.length > 0,
  "no group button carried aria-controls; the pair is not being written at all",
);

check(
  "every group states aria-expanded",
  seen.every((group) => group.expanded === "true" || group.expanded === "false"),
  seen
    .filter((group) => group.expanded !== "true" && group.expanded !== "false")
    .map((group) => `${group.category}/${group.id}`)
    .join(", "),
);

check(
  "every group controls a list that exists",
  seen.every((group) => group.controlled),
  seen
    .filter((group) => !group.controlled)
    .map((group) => `${group.category}/${group.id}`)
    .join(", "),
);

check(
  "and the list is shown exactly when the button says it is open",
  seen.every((group) => group.hiddenMatches),
  seen
    .filter((group) => !group.hiddenMatches)
    .map((group) => `${group.category}/${group.id} (expanded=${group.expanded})`)
    .join(", "),
);

/* Toggling one really flips both sides together. */
const fluidButton = document.querySelector('.drawing-category[data-category="FLUIDS"]');

fluidButton.click();

const flowPaths = document.querySelector('.drawing-tool[data-tool-id="fluids-flow-paths"]');
const flowSection = document.getElementById(flowPaths.getAttribute("aria-controls"));
const before = flowPaths.getAttribute("aria-expanded");

flowPaths.click();

check(
  "pressing a group toggles it",
  flowPaths.getAttribute("aria-expanded") !== before,
  `${before} -> ${flowPaths.getAttribute("aria-expanded")}`,
);

check(
  "and shows or hides its list with it",
  flowSection.hidden === (flowPaths.getAttribute("aria-expanded") === "false"),
);

void window;

console.log(`\n  ${pass} passed, ${fail} failed\n`);

/*
 * The page's own timers (the source debounce, animation frames) are still
 * pending; the checks are done, so the process ends rather than waiting for
 * timers that will never be idle.
 */
process.exit(fail ? 1 : 0);
