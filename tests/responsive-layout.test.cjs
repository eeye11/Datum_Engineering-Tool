/*
 * ========================================================
 * RESPONSIVE LAYOUT: THE INVARIANTS, IN THE SOURCE
 * ========================================================
 *
 * These rules are easy to break by accident - a stray `flex-wrap: wrap`, or
 * a `display: none` on a panel - and a broken one does not throw, it just
 * quietly makes the drawing unusable on a narrow screen. So the properties
 * that MATTER are read out of the stylesheet and stated here.
 *
 * The rules the responsive work has to keep:
 *
 *   1. The top toolbar is ONE ROW that scrolls - it never wraps.
 *   2. The section bar is ONE ROW that scrolls - it never wraps.
 *   3. Neither panel is ever `display: none`d by a width breakpoint.
 *   4. The panels switch to an icon-only form at a narrow width, driven by
 *      the VIEWPORT (a media query), not by a device check.
 *   5. The workspace clamps its width, so a panel cannot make the whole
 *      page scroll sideways.
 */

const fs = require("fs");
const { stylesheetSource } = require("./helpers/source-path.cjs");
const path = require("path");

const { SOURCE_ROOT } = require("./helpers/source-path.cjs");

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

const cssRaw = stylesheetSource("editor.css");

/*
 * COMMENTS ARE STRIPPED FIRST.
 *
 * Several of these checks look for a rule that must NOT exist - a
 * `display: none` on a panel, a stray breakpoint - and the file
 * deliberately DOCUMENTS the ones that were removed. Matching a comment
 * would make the test report the explanation as the defect, so the
 * comment text is removed and only real CSS is examined.
 */
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/*
 * Pull one rule block out by its opening selector text.
 *
 * Anchored to the START OF A LINE so a compound selector that merely
 * CONTAINS the text - `body.datum-topbar-hidden .drawing-toolbar {`, for
 * instance - is not mistaken for the top-level rule being asked for. Without
 * that anchor the lookup finds whichever such selector appears first in the
 * file, and the assertions then run against the wrong block.
 */
function ruleFor(selector) {
  const at = css.search(
    new RegExp(
      `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "m",
    ),
  );
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(at, close + 1);
}

console.log("\n  the top toolbar is one row that scrolls, never wraps\n");

{
  const rule = ruleFor(".drawing-app-toolbar {");

  check(
    "the toolbar forbids wrapping",
    /flex-wrap:\s*nowrap/.test(rule),
    "wrapping makes the toolbar taller and eats the drawing",
  );

  check(
    "and scrolls horizontally instead",
    /overflow-x:\s*auto/.test(rule),
    "the row must scroll rather than fold onto a second line",
  );

  check(
    "with a stable single-row white-space",
    /white-space:\s*nowrap/.test(rule),
  );

  check(
    "and no vertical growth from a wrapped second line",
    /overflow-y:\s*hidden/.test(rule),
  );
}

console.log("\n  the section bar is one row that scrolls, never wraps\n");

{
  const rule = ruleFor(".drawing-toolbar {");

  check(
    "the section bar forbids wrapping",
    /flex-wrap:\s*nowrap/.test(rule),
  );

  /*
   * THE SCROLLING MOVED TO THE INNER GROUP.
   *
   * The toolsets live in `.drawing-toolbar-scroll` now, because the Hide
   * control at the far right must NOT be pushed off the edge by eleven
   * toolsets - so the OVERFLOW is on the group that holds the toolsets, and the
   * bar around it is a plain flex row. The invariant is the same - one row that
   * scrolls rather than one that wraps - it is simply carried by the child.
   */
  const scroller = ruleFor(".drawing-toolbar-scroll {");

  check(
    "and its toolset group scrolls horizontally",
    /overflow-x:\s*auto/.test(scroller),
    "the toolset row must scroll rather than fold onto a second line",
  );

  check(
    "keeping its height stable",
    /overflow-y:\s*hidden/.test(scroller),
  );

  check(
    "and the bar around the scroller does not itself scroll",
    !/overflow-x:\s*auto/.test(rule),
    "the Hide control is a sibling of the scroller, not something it scrolls past",
  );
}

console.log("\n  the toolbar's groups do not shrink, so they overflow\n");

{
  const rule = ruleFor(".drawing-app-toolbar-group,");

  check(
    "the groups keep their size and do not wrap internally",
    /flex:\s*0 0 auto/.test(rule) && /flex-wrap:\s*nowrap/.test(rule),
    "without this the flex container absorbs the overflow and never scrolls",
  );
}

console.log("\n  a panel is NEVER removed by a width breakpoint\n");

check(
  "no media query hides the tool panel with display: none",
  !/@media[^{]*\{[^@]*\.drawing-tool-panel[^}]*display:\s*none/.test(css),
  "the Tools panel must survive every width, compressed - not removed",
);

check(
  "the only display:none on a panel is the COLLAPSED rail state",
  /\.drawing-panel-rail-collapsed \.drawing-tool-panel,\s*\n\s*\.drawing-panel-rail-collapsed \.drawing-inspector\s*\{\s*\n\s*display:\s*none;/.test(
    css,
  ),
  "collapsing is the student's choice; width must not do it",
);

console.log("\n  icon-only tools appear at a narrow breakpoint\n");

check(
  "there is a media query that hides the tool LABELS",
  /@media\s*\(max-width:\s*\d+px\)[\s\S]{0,4000}\.drawing-tool-label,\s*\n\s*\.drawing-tool-caret\s*\{\s*\n\s*display:\s*none;/.test(
    css,
  ),
  "the compact form must drop the label but keep the icon",
);

check(
  "and the group headings go with them",
  /@media\s*\(max-width:\s*\d+px\)[\s\S]{0,4000}\.drawing-tool-group-label\s*\{\s*\n\s*display:\s*none;/.test(
    css,
  ),
);

check(
  "the icon-only buttons keep a real touch target",
  /\.drawing-tool\s*\{[\s\S]{0,80}min-height:\s*(2[6-9]|3\d)px/.test(css),
  "an icon may be small; the button it sits in must not be",
);

console.log("\n  the breakpoints are viewport-based, and progressive\n");

{
  const widths = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)]
    .map((m) => Number(m[1]))
    .filter((w) => w <= 900);

  check(
    "there are several viewport breakpoints for the panels",
    widths.length >= 3,
    `found ${widths.join(", ")}`,
  );

  check(
    "and they descend, so the progression is full -> compact -> icon-only",
    widths.every((w, i) => i === 0 || w <= widths[i - 1]),
    `order: ${widths.join(", ")}`,
  );

  check(
    "no breakpoint is decided by device type",
    !/pointer:\s*coarse|hover:\s*none|orientation:\s*portrait/.test(css),
    "the layout must follow AVAILABLE WIDTH, not the device",
  );
}

console.log("\n  the page cannot be made to scroll sideways by a panel\n");

{
  const rule = ruleFor(".drawing-workspace {");

  check(
    "the workspace is clamped to its container",
    /max-width:\s*100%/.test(rule) && /overflow:\s*hidden/.test(rule),
    "only the toolbar and section bar scroll horizontally, not the page",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
