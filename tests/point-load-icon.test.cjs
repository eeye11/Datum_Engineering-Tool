/*
 * ============================================================
 * THE POINT LOAD HAS AN ICON
 * ============================================================
 *
 * The Loads menu lists `{ id: "point-force", label: "Point Load" }`.
 * The toolbar does not look an icon up by the menu's id; it looks it up by
 * `iconLabel || label` in the artwork table. That table's key for this tool is
 * `"Point Load"`, so the menu MUST resolve to it.
 *
 * A mismatch there is a silent defect: the button renders with an empty icon
 * span and no error, only a blank icon - which is exactly the absence this test
 * guards.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, error } = bootApp();
if (error) throw error;

let menus;
let toolIcons;
let featureIcons;

before(async () => {
  await whenReady();

  ({ STATICS_TOOL_MENUS: menus } = require(locate("statics-tools.js")));
  ({ toolIcons, featureIcons } = require(locate("tools.js")));
});

after(() => window.close());

test("every Statics menu tool resolves to an icon in the artwork table", () => {
  for (const [menu, tools] of Object.entries(menus)) {
    for (const tool of tools) {
      const key = tool.iconLabel || tool.label;

      assert.ok(
        typeof toolIcons[key] === "string" && toolIcons[key].includes("<svg"),
        `${menu}/${tool.id} resolves to "${key}", which must be artwork`,
      );
    }
  }
});

test("the Point Load button specifically carries its arrow-and-surface icon", () => {
  const pointLoad = menus.load.find((tool) => tool.id === "point-force");

  assert.ok(pointLoad, "the Point Load tool is in the Loads menu");

  const icon = toolIcons[pointLoad.iconLabel || pointLoad.label];

  assert.ok(icon, "the Point Load tool has an icon");
  assert.match(icon, /<svg/, "it is SVG artwork");
  assert.match(icon, /<path/, "and it is drawn, not a placeholder");
});

test("a Point Load feature in the Objects list carries the same icon", () => {
  const feature = featureIcons.force;

  assert.ok(feature, "every force feature has an icon");
  assert.equal(
    feature,
    toolIcons["Point Load"],
    "the feature icon IS the tool's icon, not a second drawing",
  );
});
