/*
 * ========================================================
 * THE VIEW MENU'S VISIBILITY SWITCHES
 * ========================================================
 *
 * Two things the user asked for, and one defect found while checking them:
 *
 *   1. THE LABEL NAMES WHAT THE COMMAND WILL DO. "Hide Grid" while the grid is
 *      up, "Show Grid" while it is down - so the menu states the effect rather
 *      than the current state.
 *
 *   2. NO TICK. The tick and the verb were saying the same thing twice.
 *
 *   3. AND THE LABEL HAS TO FOLLOW THE REAL STATE. The grid is a CANVAS switch:
 *      its visibility lives on `state.grid.visible`, not on
 *      `state.display.showGrid` with the annotation settings. The item was
 *      reading the wrong field, so its label never changed - the menu said
 *      "Hide Grid" whatever the grid was doing.
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

const menu = fs.readFileSync(locate("menu-commands.js"), "utf8");

console.log("\n  no tick beside the visibility commands\n");

check(
  "the grid item carries no checked flag",
  !/id: "grid",[\s\S]{0,200}?checked:/.test(menu),
  "a tick and a verb saying the same thing is the duplication being removed",
);

check(
  "nor do dimensions",
  !/id: "dimensions",[\s\S]{0,240}?checked:/.test(menu),
);

console.log("\n  the label names what the command WILL DO\n");

check(
  "the grid label flips between Show and Hide",
  /gridVisible\(\) \? "Hide Grid" : "Show Grid"/.test(menu),
);

check(
  "dimensions flip the same way",
  /showDimensions === false[\s\S]{0,80}?"Show Dimensions"[\s\S]{0,40}?"Hide Dimensions"/.test(
    menu,
  ),
);

/*
 * MAGNITUDES IS NO LONGER A VIEW COMMAND.
 *
 * The control and the menu item were removed, so the question is no longer how
 * a command reads - it is that there is no command. The SETTING survives in the
 * model (`display.showMagnitudes`), which is why this checks the MENU and not
 * the model: a saved file written while magnitudes were off must still open the
 * same way.
 */
check(
  "magnitudes is not a view command any more",
  !/id: "magnitudes"/.test(menu) && !/Show Magnitudes|Hide Magnitudes/.test(menu),
  "the control and its menu item were both removed",
);

console.log("\n  and the label reads the state the TOOLBAR writes\n");

/*
 * THE DEFECT. The grid is drawn on the canvas, so its visibility is
 * `state.grid.visible` - the same field the toolbar's Grid button writes. The
 * menu asked `display.showGrid`, a field nothing writes for the grid, so the
 * label could never change.
 */
check(
  "the grid reads state.grid.visible, not display.showGrid",
  /gridVisible[\s\S]{0,200}?drawingState\.grid\?\.visible/.test(menu),
  "reading display.showGrid is what made the label never change",
);

check(
  "and the stale display.showGrid read is gone",
  /*
   * Checked against the CODE, not the prose: the comment above the grid item
   * names the field it stopped using, so a blunt search would find the
   * explanation and report the bug as still present.
   */
  !/showGrid/.test(
    menu
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/[^\n]*$/gm, ""),
  ),
);

console.log("\n  and it toggles through the BUTTON, not a second implementation\n");

check(
  "the grid item clicks the toolbar's own button",
  /toggleWorkspaceSettingById\("drawingGridToggle"\)/.test(menu),
  "the button's handler owns the write, including the fields snap keeps in step",
);

check(
  "that helper exists and clicks rather than reimplementing",
  /export function toggleWorkspaceSettingById[\s\S]{0,400}?button\.click\(\)/.test(
    fs.readFileSync(locate("menu-commands-actions.js"), "utf8"),
  ),
);

/*
 * DIMENSIONS is the other way round: it IS on `state.display`, and it shares the
 * toolbar toggle's own writer, so the menu and the button cannot disagree.
 */
check(
  "dimensions goes through the shared display setter",
  /toggleDisplaySetting\("showDimensions"/.test(menu),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
