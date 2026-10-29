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
 *   2. The section bar is ONE ROW that never wraps - the MENU BAR above it and
 *      the section bar are inside ONE shared horizontal scroller.
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

/* The token file and the layout installer, read alongside the stylesheets. */
const tokens = fs.readFileSync(path.join(SOURCE_ROOT, "styles", "tokens.css"), "utf8");
const layout = fs.readFileSync(
  path.join(SOURCE_ROOT, "components", "layout", "workspace", "workspace-layout.js"),
  "utf8",
);

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

console.log("\n  the section bar is one row that never wraps\n");

{
  const rule = ruleFor(".drawing-toolbar {");

  check(
    "the section bar forbids wrapping",
    /flex-wrap:\s*nowrap/.test(rule),
  );

  check(
    "and does not grow past its contents",
    /flex:\s*0 0 auto/.test(rule),
    "the bars must keep their natural widths so the rail overflows",
  );

  /*
   * THE SCROLLING IS NOT THE BARS' OWN ANY MORE.
   *
   * The menu bar and the section bar are ONE navigation area, so a bar that
   * scrolled on its own would be a second, independent offset - and the two
   * could become misaligned. Neither bar, nor the toolset group inside it,
   * scrolls; the SHARED RAIL does.
   */
  check(
    "and neither the bar nor its toolset group scrolls on its own",
    !/overflow-x:\s*auto/.test(rule) &&
      !/overflow-x:\s*auto/.test(ruleFor(".drawing-toolbar-scroll {")),
    "two independent scrollers are two offsets that can drift apart",
  );
}

console.log("\n  the menu bar and section bar share one horizontal scroller\n");

{
  const rail = ruleFor(".drawing-top-rail-scroll {");
  const track = ruleFor(".drawing-top-rail-track {");

  /*
   * THE SCROLLER IS CONDITIONAL, AND THAT IS THE FIX FOR THE MENUS.
   *
   * `overflow-x: auto` is a clip on BOTH axes, so a rail that was always a
   * scroller always clipped - and the dropdowns, which drop from the bar, were
   * cut off at the bar's edge. The rail is only made a scroll container when its
   * content is actually wider than it (`--scrollable`, toggled from the real
   * `scrollWidth` by `installTopRail`), and even then the panels are placed
   * against the window so the clip cannot touch them.
   */
  check(
    "the shared rail scrolls horizontally once its content is wider than it",
    /\.drawing-top-rail-scroll--scrollable\s*\{[^}]*overflow-x:\s*auto/.test(css),
    "one scroller for both bars is what keeps them aligned",
  );

  check(
    "and does not clip its menus when it is not scrolling",
    /\.drawing-top-rail-scroll\s*\{[^}]*overflow:\s*visible/.test(rail) ||
      /@supports \(overflow: clip\)/.test(css),
    "a clip on the rail cuts every dropdown off at the bar's edge",
  );

  check(
    "and is clamped to its grid row, so the page cannot widen",
    /max-width:\s*100%/.test(ruleFor(".drawing-top-rail {")),
  );

  check(
    "the track is the viewport width at minimum and the content width at most",
    /width:\s*max\(min-content,\s*100%\)/.test(track),
    "wide screens show both bars normally; narrow ones overflow instead of wrapping",
  );

  check(
    "but never narrower than the content, which is what enables the scroll",
    /grid-template-columns:\s*minmax\(max-content,/i.test(track),
  );

  check(
    "the menu bar stays on one line too",
    /flex-wrap:\s*nowrap/.test(ruleFor(".datum-menubar {")) &&
      /white-space:\s*nowrap/.test(ruleFor(".datum-menubar {")),
    "a menu bar that folded onto a second line would move the section bar",
  );

  check(
    "and the toolset group is not a second scroller",
    !/overflow-x:\s*(auto|scroll)/.test(ruleFor(".drawing-toolbar-scroll {")),
  );

  check(
    "the rail's two bars span its whole one-column track",
    /grid-column:\s*1 \/ -1/.test(ruleFor(".drawing-top-rail-track > .drawing-menu-controls-bar,")),
  );
}

console.log("\n  the divider between the menu row and the tool options is drawn\n");

{
  const track = ruleFor(".drawing-top-rail-track {");

  /*
   * THE RULE BETWEEN THE MENU-AND-CONTROLS ROW AND THE SECTION BAR.
   *
   * It is a background layer on the track, placed with the measured height of
   * the first row - not a border on either bar, because a bar's border moves
   * with its content and a scrolled track has to draw the line at the row's own
   * edge. Losing it is silent: the two rows simply run together.
   */
  /*
   * THE DIVIDER BELONGS TO THE RAIL, NOT TO THE SCROLLING TRACK.
   *
   * The track is as wide as the content and moves sideways, so a line painted
   * on it travels with the content. The line between the two bars is drawn on
   * the rail - the box that does not scroll - which is what keeps it spanning
   * the visible width at every scroll position.
   */
  const rail = ruleFor(".drawing-top-rail::after {");

  check(
    "the rail paints the divider between the two bars",
    /position:\s*absolute/.test(rail) &&
      /left:\s*0/.test(rail) &&
      /right:\s*0/.test(rail) &&
      /height:\s*1px/.test(rail) &&
      /background:\s*var\(--datum-border\)/.test(rail),
    "a 1px line on the non-scrolling rail, spanning it edge to edge",
  );

  check(
    "and it is placed by the measured first-row height",
    /top:\s*var\(--datum-rail-row-one/.test(rail),
    "measured from the rail's top, so the line lands on the row's foot - `bottom` would put it through the menu",
  );

  check(
    "and it is drawn above the bars that paint over it",
    /z-index:\s*\d+/.test(rail),
    "both rows are stacking contexts of their own",
  );

  check(
    "and it does not intercept clicks meant for the bars",
    /pointer-events:\s*none/.test(rail),
  );

  check(
    "the track still closes the section bar off from the drawing",
    /background-image:[^;]*linear-gradient/.test(track) &&
      /background-size:\s*100% 1px/.test(track) &&
      /background-position:[^;]*bottom/.test(track),
    "one hairline, under the last row",
  );

  check(
    "and the row above the divider draws no border of its own",
    /border-bottom:\s*0/.test(
      ruleFor(".drawing-top-rail-track > .drawing-menu-controls-bar {"),
    ),
    "two stacked hairlines read as a double line, not one seam",
  );

  check(
    "the row height is a themed token, defined for light, dark and system",
    (tokens.match(/--datum-rail-row-one:/g) || []).length === 3,
    `${(tokens.match(/--datum-rail-row-one:/g) || []).length} definitions`,
  );

  check(
    "and the workspace measures the row and writes it",
    /getBoundingClientRect\(\)\.height[\s\S]{0,400}--datum-rail-row-one/.test(layout),
    "the row is as tall as its controls, so it is measured rather than assumed",
  );

  check(
    "and writes it on the rail, which is what draws the line",
    /rail\.style\.setProperty\(\s*"--datum-rail-row-one"/.test(layout),
    "the divider is painted by the rail, so the rail needs the figure too",
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

/*
 * SCOPED TO ONE MEDIA BLOCK.
 *
 * The range used to run `[^@]*` from `@media` through to the first matching
 * `display: none` ANYWHERE after it - so a breakpoint that merely came before an
 * unrelated `display: none` block was reported as hiding the panel. `[^}]*`
 * cannot cross a closing brace that is not inside the rule it is testing, and
 * the alternatives stop it spanning a second media query.
 */
check(
  "no media query hides the tool panel with display: none",
  !/@media[^{]*\{((?!@media)[\s\S])*?\.drawing-tool-panel\s*\{[^}]*display:\s*none/.test(css),
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

console.log("\n  hiding the top bar folds the whole rail and gives the space back\n");

{
  const rule = ruleFor(".drawing-workspace {");
  const hidden = ruleFor("body.datum-topbar-hidden .drawing-workspace {");

  const rows = (text) => text.match(/grid-template-rows:\s*([^;]+);/)?.[1];
  const tracks = (text) => (rows(text) || "").match(/minmax\([^)]*\)|\S+/g) || [];

  /*
   * ONE TRACK PER GRID CHILD, AND THE MIDDLE ONE IS THE FLEXIBLE ROW.
   *
   * The workspace has five children - the rail, the Show row, the three middle
   * columns sharing row 3, the sheet bar and the status bar - so five tracks.
   * A short list makes the grid add an implicit row and pushes the canvas into
   * the 24px sheet-bar track; the canvas is the `minmax(0, 1fr)` one.
   */
  check(
    "the shown layout has one row per grid child",
    tracks(rule).length === 5 && /minmax\(0,\s*1fr\)/.test(rows(rule) || ""),
    `the rail, the Show row, the canvas, the sheet bar and the status bar - got ${rows(rule)}`,
  );

  check(
    "and hiding keeps the same number of tracks, so nothing shifts up into the wrong row",
    tracks(hidden).length === 5,
    `got ${rows(hidden)}`,
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

  /*
   * THE RAIL AND ITS SCROLLER ARE THE VISIBLE WIDTH, NOT THE CONTENT WIDTH.
   *
   * `overflow-x: auto` cannot make a box narrower than its contents on its own
   * - the box has to be bounded first. A rail, or a scroller, that grew to its
   * contents would put the right-hand end of both bars beyond the edge of the
   * screen, where nothing could scroll to it.
   */
  check(
    "the rail and its scroller are bounded to the full available width",
    /width:\s*100%/.test(ruleFor(".drawing-top-rail {")) &&
      /width:\s*100%/.test(ruleFor(".drawing-top-rail-scroll {")),
    "an unbounded scroller never overflows, so it never scrolls",
  );

  check(
    "and both are border-box, so padding and borders cannot widen them",
    /box-sizing:\s*border-box/.test(ruleFor(".drawing-top-rail {")) &&
      /box-sizing:\s*border-box/.test(ruleFor(".drawing-top-rail-scroll {")),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
