/*
 * ========================================================
 * GEOMETRY SIDEBAR LAYOUT AND THE FREEFORM POLYGON PREVIEW
 * ========================================================
 *
 * 1. Arc and Polygon list their construction methods INLINE, as an
 *    expandable group under the tool - the layout Statics uses for its
 *    grouped tools - rather than in a floating popup.
 *
 * 2. A Freeform Polygon shows what has been placed while it is drawn: the
 *    outline through its own vertices, a dot on each vertex and a ring on
 *    the first. The preview used to be built by the REGULAR polygon maths,
 *    which ignores the vertices, so nothing was visible.
 *
 * 3. Closing a Freeform Polygon ends the construction, so the next click
 *    starts a new shape instead of extending the finished one.
 *
 * The toolbar and preview need a live page, so - like drag-undo.test.cjs -
 * their shape is pinned in the source. Checked in Chrome as well.
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

const read = (name) => fs.readFileSync(locate(name), "utf8");

console.log("\n  the Geometry sidebar\n");

const tools = read("tools.js");

check(
  "Arc is a grouped tool",
  /\{ id: "arc", label: "Arc", shortcut: "A", submenu: true \}/.test(tools),
);

check(
  "Polygon is a grouped tool",
  /\{ id: "polygon", label: "Polygon", shortcut: "G", submenu: true \}/.test(tools),
);

const toolbar = read("toolbar-render.js");

check(
  "both expand inline, like the Statics groups",
  /expandedToolbarSections = \{[\s\S]*?\barc: false,[\s\S]*?\bpolygon: false,/.test(toolbar),
);

check(
  "the Arc list offers both arc methods",
  /tool\.id === "arc"\s*\?\s*ARC_CREATION_MODES\.map/.test(toolbar) && /data-arc-mode=/.test(toolbar),
);

check(
  "the Polygon list offers both polygon methods",
  /tool\.id === "polygon"\s*\?\s*POLYGON_CREATION_MODES\.map/.test(toolbar) && /data-polygon-mode=/.test(toolbar),
);

check(
  "choosing a method arms the tool and redraws the list",
  /activateArcMode\("arc", button\.dataset\.arcMode\)\s*\.then\(\(\) => renderEngineeringTools/.test(toolbar) &&
    /activatePolygonMode\(button\.dataset\.polygonMode\)\s*\.then\(\(\) => renderEngineeringTools/.test(toolbar),
);

const menus = read("tool-menus.js");

check(
  "the polygon methods are By Sides and By Centre",
  /POLYGON_CREATION_MODES = \[\s*\{ id: "sides", label: "By Sides" \},\s*\{ id: "centre", label: "By Centre" \}/.test(menus),
);

console.log("\n  the Freeform Polygon preview\n");

const previewRender = read("preview-render.js");

check(
  "the polygon preview draws a freeform shape's own vertices",
  /Array\.isArray\(geometry\.points\)\s*\?\s*geometry\.points\.filter\(Boolean\)\s*:\s*enggDrawingState\.polygonVertices\(geometry\)/.test(previewRender),
  "the preview still builds a regular polygon from a freeform shape",
);

check(
  "and marks each placed vertex, with a ring on the first",
  /preview\.metadata\?\.vertexMarkers/.test(previewRender) && /"data-freeform-vertex": "first"/.test(previewRender),
);

const preview = read("preview.js");

check(
  "the construction publishes its vertices and the close state",
  /vertexMarkers: interaction\.points\.map/.test(preview) && /closingVertex:/.test(preview),
);

console.log("\n  closing a Freeform Polygon\n");

const creation = read("geometry-creation.js");
const commitStart = creation.indexOf("export function commitFreeformPolygon");
const commit = creation.slice(commitStart, creation.indexOf("\nexport function", commitStart + 10));

check(
  "the commit ends the construction before adding the shape",
  /clearInteraction\(\s*drawingState\s*\);\s*commitCreatedFeature\(/.test(commit),
  "the finished polygon's vertices stay in progress",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
