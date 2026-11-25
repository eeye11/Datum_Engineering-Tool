/*
 * ========================================================
 * THE DRAWING LOOKS THE SAME AT EVERY ZOOM
 * ========================================================
 *
 * Zooming is a VIEW operation. It moves the drawing under the camera and
 * changes nothing about it - which has to hold for every object, not only for
 * text: a circle stays a circle, a stroke keeps its weight RELATIVE to the
 * drawing, and an arrowhead keeps its proportion to its shaft.
 *
 * The failures this test exists for are all the same mistake in different
 * disguises: a WORLD size written as a fixed number of pixels. A symbol sized
 * `9` with no zoom, a stroke pinned by `non-scaling-stroke`, an arrowhead
 * measured for the screen rather than for the sheet. Each looks plausible on
 * its own and each breaks a different shape when the student zooms.
 *
 * Nothing here renders in a browser, so these are the properties that can be
 * checked from the source: one conversion, stated once, and applied by the
 * things that need it.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const {
  modulePath,
  rendererSource,
  stylesheetSource,
} = require("./helpers/source-path.cjs");

const renderingSource = (name) => fs.readFileSync(modulePath(name), "utf8");

const renderer = rendererSource();
const dimensions = renderingSource("dimension-render.js");
const heat = renderingSource("draw-heat-transfer.js");
const symbols = renderingSource("symbol-render.js");
const canvasRender = fs.readFileSync(modulePath("canvas-render.js"), "utf8");

/* ============================================================
 * ONE SCALE
 * ============================================================ */

test("a stroke's PAINTED width is the stored weight at every zoom", () => {
  /*
   * `scaledStrokeWidth` returns overlay PIXELS, and the caller has already
   * projected the geometry through the camera - so the zoom has to be divided
   * back out or the width is multiplied by the viewport a second time.
   */
  const body =
    /function scaledStrokeWidth\(lineWidth\) \{([\s\S]*?)\n    \}/.exec(
      renderer,
    )?.[1];

  assert.ok(body, "the shared stroke scale must exist");

  assert.match(
    body,
    /\/\s*zoom/,
    "the width is written in world pixels, so the camera's zoom must be divided out",
  );
});

test("the compiled picture's strokes are not pinned against the camera", () => {
  const body =
    /function showStrokesAtScreenWidth\(layer\) \{([\s\S]*?)\n\}/.exec(
      canvasRender,
    )?.[1];

  assert.ok(body, "the canvas must adopt the picture's strokes");

  const code = body.replace(/\/\*[\s\S]*?\*\//g, "");

  assert.doesNotMatch(
    code,
    /non-scaling-stroke/,
    "pinning every compiled stroke held it at a pixel width while the drawing grew - the " +
      "picture must keep the weight the source states",
  );
});

test("no dimension stroke is pinned against the camera either", () => {
  const painted = dimensions.replace(/\/\*[\s\S]*?\*\//g, "");

  assert.doesNotMatch(
    painted,
    /non-scaling-stroke/,
    "a dimension is part of the drawing; its pens must scale with it",
  );
});

test("the picture layer is placed with one uniform scale", () => {
  /*
   * The viewBox and the layer's pixel size differ by the same ratio on both
   * axes, so `meet` and `none` describe the same transform - except that `meet`
   * re-centres the picture when rounding makes the ratios differ in the last
   * decimal, which slides the drawing off its own grid.
   */
  const body = /function positionPictureLayer\([\s\S]*?\n\}/.exec(
    canvasRender,
  )?.[0];

  assert.ok(body, "the picture must be positioned by the camera");

  assert.match(
    body,
    /preserveAspectRatio",\s*"none"/,
    "one scale for both axes is what the viewBox already states",
  );
});

/* ============================================================
 * SHAPES AND SYMBOLS ARE THE DRAWING'S SIZE
 * ============================================================ */

test("a support symbol is the drawing's size, not the window's", () => {
  const body = /function appendSupportSymbol\(([\s\S]*?)\n    \}/.exec(
    symbols,
  )?.[1];

  assert.ok(body, "the support symbol must exist");

  /*
   * A SUPPORT'S SIZES GO THROUGH THE ONE CONVERSION, `worldLength`, so they are
   * the drawing's size rather than a fixed number of screen pixels. The test used
   * to look for a literal `* zoom`, which is the same idea written per painter -
   * and six painters writing it six ways is exactly what was fixed.
   */
  assert.match(
    body,
    /const size = worldLength\(9\)/,
    "a support sized in bare pixels stays the same size while its beam grows",
  );

  assert.match(
    body,
    /const ground = worldLength\(26\)/,
    "the ground line is the drawing's too",
  );

  /*
   * AND NOTHING IN THE SYMBOL RE-DIVIDES BY THE ZOOM. A `/ zoom` here is the
   * old per-painter correction, which held the pen at a screen width.
   */
  assert.doesNotMatch(
    body.replace(/\/\*[\s\S]*?\*\//g, ""),
    /\/\s*zoom/,
    "a symbol's pen is stated, not divided back through the camera",
  );
});

test("a connection symbol scales with the drawing", () => {
  const body = /function appendConnectionSymbol\(([\s\S]*?)\n    \}/.exec(
    symbols,
  )?.[1];

  assert.ok(body);

  assert.match(body, /worldLength\(8\)/, "the joint's block is a world size");
  assert.match(body, /worldLength\(4\)/, "the joint's circle is a world size");
});

test("a marker, a node and an arrowhead are world sizes", () => {
  const geometry = renderingSource("draw-geometry.js");
  const geometryCode = geometry.replace(/\/\*[\s\S]*?\*\//g, "");

  assert.match(
    geometryCode,
    /const pointRadius =\s*\(?[^;]*\*\s*zoom/s,
    "a point's marker radius is a world size",
  );

  /* The heat-transfer painters read the camera through one named helper. */
  assert.match(
    heat,
    /function screenScale\(\)/,
    "one scale for every heat mark",
  );
  assert.match(
    heat,
    /r: radius \* screenScale\(\)/,
    "a thermal node's dot is drawn at the world radius",
  );
  assert.match(
    heat,
    /screenScale\(\),?\s*\)/,
    "a heat arrowhead is sized for the drawing",
  );
});

test("a dimension's arrowhead scales with the drawing", () => {
  const body = /function arrowHeadSize\(lineWidth\) \{([\s\S]*?)\n\}/.exec(
    dimensions,
  )?.[1];

  assert.ok(body);

  assert.match(
    body,
    /\*\s*zoom/,
    "the head's length is drawing units and its tip is already projected",
  );
});

test("a dynamics arrowhead is a world size and its dashes are not scaled twice", () => {
  const dynamics = renderingSource("draw-dynamics.js");

  assert.match(
    dynamics,
    /Math\.max\(4, num\(style\?\.arrowheadSize, 9\)\) \* view/,
    "the head is the stored world size, converted once",
  );

  const dashes = /function dashArrayOf\(style, scale\) \{([\s\S]*?)\n\}/.exec(
    dynamics,
  )?.[1];

  assert.ok(dashes);

  assert.doesNotMatch(
    dashes,
    /const unit = Number\(scale\) > 0 \? Number\(scale\) : 1;[\s\S]*SCREEN/,
    "a dash pattern is part of the drawing, not a screen distance",
  );
});

/* ============================================================
 * THE GRID IS THE PAPER, AND THE PICTURE IS THE DRAWING
 * ============================================================ */

test("the grid is drawn underneath, so it cannot hide the ink", () => {
  const body = /function renderEngineeringGrid\([\s\S]*?\n    \}/.exec(
    renderer,
  )?.[0];

  assert.ok(body, "the grid must exist");

  assert.match(
    body,
    /insertBefore\(grid, svg\.firstElementChild\)/,
    "a full-sheet grid appended last paints over every feature drawn before it",
  );
});

/* ============================================================
 * THE SIDEBARS
 * ============================================================ */

test("the sidebars' widths are one clamp, applied to both", () => {
  const panelResize = fs.readFileSync(modulePath("panel-resize.js"), "utf8");

  assert.match(panelResize, /MIN_WIDTH = \d+/, "a usable minimum");
  assert.match(
    panelResize,
    /MAX_WIDTH = \d+/,
    "a maximum, so the drawing stays usable",
  );
  assert.match(
    panelResize,
    /MAX_SHARE = 0\.\d+/,
    "no single panel may take most of the window",
  );
  assert.match(
    panelResize,
    /MIN_CANVAS_WIDTH = \d+/,
    "the canvas is reserved before a panel grows",
  );

  assert.match(
    panelResize,
    /function workspaceColumns\([\s\S]*?minmax\(0, 1fr\)/,
    "the canvas is the flexible track, so it takes exactly what a panel gives up",
  );
});

test("a resize redraws, and moves nothing else", () => {
  const panelResize = fs.readFileSync(modulePath("panel-resize.js"), "utf8");

  assert.doesNotMatch(
    panelResize,
    /camera\.zoom\s*=|panCamera|setCameraZoom/,
    "resizing a sidebar is a layout change, not a view change",
  );

  assert.match(
    panelResize,
    /notifyResized\(\)/,
    "the canvas is re-measured, which is all a new width needs",
  );
});

test("both rails carry a resize handle on their inner edge", () => {
  const sidePanels = stylesheetSource("editor/side-panels.css");

  assert.match(
    sidePanels,
    /\.drawing-panel-resizer \{/,
    "the handle has a rule",
  );
  assert.match(sidePanels, /cursor: col-resize/, "and it reads as a splitter");
});

/*
 * A DRAG TO NOTHING IS THE HIDE BUTTON, NOT A THIRD STATE.
 *
 * The panel may be dragged all the way shut, and when it is, it must BE hidden -
 * the same class, the same reclaimed track, the same Show control - rather than a
 * separately-styled zero-width panel that only looks the same.
 */
test("dragging a sidebar to its minimum hides it through the Hide path", () => {
  const panelResize = fs.readFileSync(modulePath("panel-resize.js"), "utf8");

  assert.match(
    panelResize,
    /COLLAPSE_BELOW/,
    "there is a threshold past which a drag means hidden",
  );

  assert.match(
    panelResize,
    /installPanelCollapse/,
    "the collapse is the layout's own, handed in rather than re-implemented",
  );

  assert.match(
    panelResize,
    /applyCollapsed\(side, true\)/,
    "a drag past the threshold calls that collapse",
  );
});

/*
 * THE MINIMUM IS ZERO, SO THE SLIDER HAS NOWHERE IT CANNOT GO.
 *
 * A positive floor would stop the drag short of the state the Hide button
 * reaches, and the two gestures would disagree about how small a sidebar can be.
 */
test("the drag limits allow a completely hidden sidebar", () => {
  const panelResize = fs.readFileSync(modulePath("panel-resize.js"), "utf8");

  assert.match(
    panelResize,
    /return \{\s*min: 0,\s*max:/,
    "the minimum width is zero - the hidden state",
  );
});

/*
 * HIDE KEEPS THE WIDTH IT LEAVES.
 *
 * A collapsed rail is its 22px strip, so the width to come back at has to be
 * remembered - otherwise Show reopens the panel at the handle's own width.
 */
test("the last expanded width is remembered, never the collapsed strip", () => {
  const panelResize = fs.readFileSync(modulePath("panel-resize.js"), "utf8");

  assert.match(
    panelResize,
    /lastExpandedWidths\[side\] =/,
    "the expanded width is recorded",
  );

  assert.match(
    panelResize,
    /function lastExpandedWidth\(side/,
    "and answered by name",
  );
});

/*
 * THE WIDTHS OUTLIVE THE SESSION.
 *
 * The student's sidebar size is an interface preference, stored beside the other
 * `datum:` preferences rather than in the drawing.
 */
test("the sidebar widths persist as a datum: preference", () => {
  const panelResize = fs.readFileSync(modulePath("panel-resize.js"), "utf8");

  assert.match(panelResize, /datum:sidebar-widths/, "under one key for the pair");
  assert.match(panelResize, /JSON\.parse/, "read back through a parse that can fail");
  assert.match(
    panelResize,
    /clampPanelWidth\(left, viewport, right\)/,
    "and clamped against the viewport it is restored into",
  );
});

/*
 * THE HANDLE DOES NOT TAKE THE HIDE BUTTON'S PRESS, AND OUTLIVES A HIDE.
 *
 * It is pinned to the rail's canvas-facing edge rather than sharing the arrow's
 * space, and it stays on the 22px strip so a hidden panel can be dragged open.
 */
test("the handle sits past the toggle and stays on a collapsed rail", () => {
  const sidePanels = stylesheetSource("editor/side-panels.css");
  const layout = fs.readFileSync(
    modulePath("workspace-layout.js"),
    "utf8",
  );

  assert.match(
    sidePanels,
    /\.drawing-panel-rail-collapsed > \.drawing-panel-resizer \{[\s\S]*?position: absolute/,
    "the collapsed strip keeps its handle",
  );

  assert.match(
    layout,
    /resizer\.hidden = false/,
    "hiding the panel does not take the handle away",
  );
});
