/*
 * ========================================================
 * DRAW ORDER
 * ========================================================
 *
 * Which feature is drawn on top of which. Two rules, and the second is the one
 * worth failing over:
 *
 *   1. THE ORDER IS THE ARRAY. The renderer walks `state.objects` in order, so
 *      draw order is the position in the one list the whole application uses -
 *      not a second `zIndex` field that could disagree with it.
 *
 *   2. DRAW ORDER DOES NOT AFFECT SELECTION. Sending a feature to the back
 *      changes what covers it and nothing else: it must still be picked by a
 *      click, still be found by a selection rectangle, and still be listed in
 *      the feature tree. A visual change must never become data loss or a
 *      feature that cannot be reached.
 */

const fs = require("fs");

const { modulePath, locate } = require("./helpers/source-path.cjs");

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
 * ========================================================
 * THE COMMANDS, AS BEHAVIOUR
 * ========================================================
 *
 * The reorder logic is pure with respect to a list, so it is checked by reading
 * the module's own source for the properties that matter, and - more usefully -
 * the real behaviour is exercised in the browser probe. What is asserted here
 * is that the four commands exist and that each is ONE committed change.
 */
console.log("\n  the four draw-order commands exist\n");

const source = fs.readFileSync(locate("draw-order.js"), "utf8");

["front", "forward", "backward", "back"].forEach((id) => {
  check(
    `"${id}" is offered`,
    new RegExp(`\\b${id}:\\s*bring|\\b${id}:\\s*send`).test(source),
  );
});

check(
  "the order IS the objects array, not a separate z-index field",
  source.includes("drawingState.objects = nextObjects") &&
    !/this\.zIndex|object\.zIndex\s*=|zIndex:/.test(source),
  "a second source of truth for draw order would drift from the array",
);

check(
  "each command is ONE committed change",
  (source.match(/commitDrawingChange\(/g) || []).length === 1,
  "one reorder must be one history entry",
);

check(
  "a reorder does not touch the selection",
  !/selectedObjectIds\s*=/.test(source),
  "changing what covers what must not change what is selected",
);

/*
 * ========================================================
 * DRAW ORDER AND SELECTION ARE SEPARATE SYSTEMS
 * ========================================================
 *
 * The hit test walks the array backwards, so overlapping features are picked in
 * the order they LOOK - but it must still test every feature, so one sent to the
 * back is reachable wherever the feature above it is not under the cursor.
 */
console.log("\n  selection does not depend on draw order\n");

const hitTesting = fs.readFileSync(locate("hit-testing.js"), "utf8");

check(
  "the hit test walks the array topmost-first, so picking matches appearance",
  /\[[\s\S]{0,60}drawingState\.objects[\s\S]{0,40}\]\s*\.reverse\(\)\s*\.find\(/.test(
    hitTesting,
  ),
  "the pick order must match the drawn order",
);

check(
  "but it still TESTS EVERY feature - nothing is skipped by being at the back",
  !/objectAtPoint[\s\S]{0,2000}(slice\(-\d|\.pop\(\))/.test(hitTesting),
  "a feature must never become unreachable because it is drawn underneath",
);

/*
 * ========================================================
 * THE CONTROLS ARE WIRED TO THE PAGE
 * ========================================================
 */
/*
 * THE CONTROLS ARE REACHED FROM THE TOOLS MENU.
 *
 * They were buttons on the global tool bar, which has been removed - it put two
 * rows of File/Save/Undo on one screen and duplicated the menu bar. The COMMANDS
 * were not removed with it: each is now a Tools menu item that calls the same
 * function the button called.
 *
 * So this asserts the commands are still reachable, through the menu, which is
 * where they now live.
 */
console.log("\n  the commands are reachable from the Tools menu\n");

const menuCommands = fs.readFileSync(locate("menu-commands.js"), "utf8");

/*
 * The four directions are named on the menu items, and each runs the draw-order
 * command with its direction - so the direction is what proves the item exists.
 */
["front", "forward", "backward", "back"].forEach((id) => {
  check(
    `the ${id} command is offered by the Tools menu`,
    menuCommands.includes(`applyDrawOrderToSelection("${id}")`),
  );
});

check(
  "and the menu calls the SAME function the buttons called",
  /export function applyDrawOrderToSelection[\s\S]{0,300}?applyDrawOrder\(direction\)/.test(
    fs.readFileSync(locate("menu-commands-actions.js"), "utf8"),
  ),
  "a second implementation of the ordering rule would be a second answer",
);

const editorIndex = fs.readFileSync(locate("index.js"), "utf8");

check(
  "the draw-order controls are installed at start-up",
  editorIndex.includes("installDrawOrderControls()"),
);

void modulePath;

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
