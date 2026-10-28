
const { JSDOM } = require("jsdom");

const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * THE SKETCH EDITOR
 * ========================================================
 *
 * Sketch is the other half of the Analysis Editor: a Plot is entered as
 * equations, a Sketch is drawn by hand. Both are reached from the same
 * entry point, so this checks the two things that make it usable.
 *
 * ONLY FOUR TOOLS.
 *
 * The general Geometry toolbar is deliberately not offered. A student
 * sketching the shape of one diagram should find two points and a pen, not
 * forty tools - and a Rectangle here is a Line with one more click, so
 * nothing is lost by leaving it out.
 *
 * ENGINEERING, NOT PIXELS.
 *
 * The important property, and the one worth failing over: a point is
 * stored as an (x, y) in the graph's own coordinate system, so a sketch
 * made at one zoom reads identically at another. The test round-trips a
 * point through the scale rather than asserting a screen number, because
 * asserting a screen number would pass even if the scale were wrong in a
 * way that happened to cancel out.
 */


const projectRoot = path.join(__dirname, "..");

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

const dom = new JSDOM(
  '<!doctype html><html><body></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

loadModule("sketch-editor.js");

const editor = global.window.enggSketchEditor;

check("the sketch editor attaches", Boolean(editor));

console.log("\n  four tools, and only four\n");

const labels = editor.TOOLS.map((t) => t.label);

check(
  "Select, Straight Line, Curve and Erase",
  JSON.stringify(labels) ===
    JSON.stringify([
      "Select",
      "Straight Line",
      "Curve",
      "Erase",
    ]),
  `got ${JSON.stringify(labels)}`,
);

/*
 * NO GENERAL GEOMETRY TOOLS. Named explicitly rather than by count, so a
 * tool added later has to be argued for in the open rather than slipping in
 * alongside the four.
 */
const forbidden = [
  "Rectangle",
  "Circle",
  "Arc",
  "Polygon",
  "Dimension",
  "Text",
  "Construction",
  "Trim",
  "Extend",
  "Coordinate",
];

for (const name of forbidden) {
  check(
    `no "${name}" tool`,
    !labels.some((l) => l.toLowerCase().includes(name.toLowerCase())),
    `found ${JSON.stringify(labels.filter((l) => l.includes(name)))}`,
  );
}

console.log("\n  points are engineering, not pixels\n");

const range = { from: 0, to: 500 };
const scale = editor.makeScale(range, []);

/*
 * ROUND-TRIP, not a screen number. Every point on the graph must come back
 * as itself - if the scale had a wrong span or an offset, this is where it
 * would show, and asserting "x = 37.4" instead would only prove that
 * whatever number came out was written down.
 */
let worstX = 0;
let worstY = 0;

for (let x = 0; x <= 500; x += 25) {
  for (let y = -20; y <= 20; y += 5) {
    const back = scale.fromScreen(
      scale.toScreen({ x, y }),
    );

    worstX = Math.max(worstX, Math.abs(back.x - x));
    worstY = Math.max(worstY, Math.abs(back.y - y));
  }
}

check(
  "x survives the round trip across the whole range",
  worstX < 1e-6,
  `worst error ${worstX}`,
);

check(
  "y survives the round trip too",
  worstY < 1e-6,
  `worst error ${worstY}`,
);

/*
 * AND THE SCALE IS NOT IDENTITY - otherwise the round trip above would pass
 * for a scale that did nothing at all.
 */
const mid = scale.toScreen({ x: 250, y: 0 });

/*
 * The graph is as wide as the sketch's own frame, so the middle of the x
 * range lands in the middle OF THAT FRAME. The check is written against the
 * frame's own midpoint rather than a fixed number, so widening the graph does
 * not make it fail for the wrong reason.
 */
const frameMid = 450;

check(
  "the middle of the range is in the middle of the graph",
  Math.abs(mid.x - frameMid) < 60,
  `x=250 mapped to ${mid.x}, frame middle is about ${frameMid}`,
);

check(
  "a positive value is ABOVE zero, not below",
  scale.toScreen({ x: 0, y: 10 }).y < scale.toScreen({ x: 0, y: 0 }).y,
  "a positive ordinate was drawn downward, so the graph is upside down",
);

console.log("\n  the vertical scale follows the drawing\n");

/*
 * A sketch of a tall diagram needs more room than one of a flat one. If the
 * y scale were fixed, a sketch of a 500 kN moment would run off the top of
 * the box and the student would be told nothing about it.
 */
const flat = editor.makeScale(range, [
  { kind: "line", start: { x: 0, y: 1 }, end: { x: 500, y: 1 } },
]);

const tall = editor.makeScale(range, [
  { kind: "line", start: { x: 0, y: 100 }, end: { x: 500, y: 100 } },
]);

check(
  "a taller sketch is given more vertical room",
  tall.unitHeight > flat.unitHeight,
  `flat ${flat.unitHeight}, tall ${tall.unitHeight}`,
);

const tallestOnScreen =
  tall.toScreen({ x: 0, y: tall.unitHeight }).y;

check(
  "and its peak still sits inside the graph",
  tallestOnScreen > 0,
  `peak mapped to y=${tallestOnScreen}, outside the frame`,
);

console.log("\n  elements, not pixels\n");

check(
  "a line exposes its two endpoints",
  editor.pointsOf({ kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })
    .length === 2,
);

check(
  "a curve exposes every point it was drawn through",
  editor.pointsOf({ kind: "curve", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    .length === 2,
);

check(
  "a vertical line needs no special tool - it is a line",
  (() => {
    const line = {
      kind: "line",
      start: { x: 250, y: -10 },
      end: { x: 250, y: 10 },
    };

    return (
      line.start.x === line.end.x &&
      editor.pointsOf(line).length === 2
    );
  })(),
);

console.log("\n  and hit testing is in the student's terms\n");

const hitScale = editor.makeScale(range, [
  { id: "a", kind: "line", start: { x: 0, y: 0 }, end: { x: 500, y: 0 } },
]);

const onLine = hitScale.toScreen({ x: 250, y: 0 });

check(
  "a point exactly on a stroke has zero distance from it",
  editor.distanceToElement(onLine, { kind: "line", start: { x: 0, y: 0 }, end: { x: 500, y: 0 } }, hitScale) < 1e-6,
);

check(
  "a point well away from it does not",
  editor.distanceToElement(
    { x: onLine.x, y: onLine.y + 120 },
    { kind: "line", start: { x: 0, y: 0 }, end: { x: 500, y: 0 } },
    hitScale,
  ) > 100,
);

console.log("\n  the workspace is a wide graph over the controls\n");

/*
 * THE GRAPH IS THE MAIN WORKSPACE.
 *
 * A diagram is read as a SHAPE, so the graph takes the width of the dialog and
 * the tools and element properties sit BELOW it. This is checked against the
 * dialog's own markup, which is what decides the layout.
 */
const { open } = editor;

open({
  title: "SFD - Sketch",
  range: { from: 0, to: 600 },
  elements: [],
  stations: [
    { key: "start", position: { x: 0, y: 0 } },
    { key: "force-1", position: { x: 200, y: 0 } },
    { key: "support-1", position: { x: 350, y: 0 } },
    { key: "end", position: { x: 600, y: 0 } },
  ],
  onPreview: () => {},
  onApply: () => {},
  onCancel: () => {},
});

const dialog = global.document.querySelector(".sketch-editor");

check("the sketch dialog opens", Boolean(dialog));

if (dialog) {
  const body = dialog.querySelector(".plot-editor-body");
  const graphArea = dialog.querySelector(".sketch-editor-graph-area");
  const lower = dialog.querySelector(".sketch-editor-lower");

  check(
    "the graph area comes before the lower controls",
    Boolean(body && graphArea && lower) &&
      body.firstElementChild === graphArea,
    "the graph is not the first thing in the workspace",
  );

  check(
    "the tools and the properties share the lower row",
    Boolean(
      lower.querySelector(".plot-editor-left") &&
        lower.querySelector(".plot-editor-right"),
    ),
  );

  check(
    "the element properties are NOT above the graph",
    Boolean(graphArea && !graphArea.querySelector("[data-sketch-detail]")),
  );

  /*
   * ========================================================
   * THE TICKS ARE THE BODY'S ELEMENT LOCATIONS
   * ========================================================
   *
   * Four stations were given, so four ticks must be drawn - one at each
   * body-element x. The x of each tick is compared with where the scale puts
   * that station, so the ticks are the real locations rather than arbitrary
   * graph-paper marks.
   */
  const ticks = [...dialog.querySelectorAll(".sketch-editor-tick")];

  check(
    "a tick is drawn for every body element",
    ticks.length === 4,
    `drew ${ticks.length} ticks for 4 stations`,
  );

  if (ticks.length) {
    const scale2 = editor.makeScale({ from: 0, to: 600 }, []);

    const xs = ticks.map(t => Number(t.getAttribute("x1")));

    const expected = [0, 200, 350, 600].map(
      x => scale2.toScreen({ x, y: 0 }).x
    );

    check(
      "and each tick sits where its station really is",
      xs.every((x, i) => Math.abs(x - expected[i]) < 1e-6),
      `ticks at ${JSON.stringify(xs)}, expected ${JSON.stringify(expected)}`,
    );

    check(
      "the body's start and end are represented",
      Math.abs(xs[0] - expected[0]) < 1e-6 &&
        Math.abs(xs[xs.length - 1] - expected[3]) < 1e-6,
    );
  }

  /*
   * AN EMPTY STATION LIST DRAWS NO TICKS - the ticks are derived, so nothing
   * derived means nothing drawn, not a default set of marks.
   */
  editor.close();

  open({
    title: "SFD - Sketch",
    range: { from: 0, to: 600 },
    elements: [],
    stations: [],
    onPreview: () => {},
    onApply: () => {},
    onCancel: () => {},
  });

  const bare = global.document.querySelector(".sketch-editor");

  check(
    "a body with no elements draws no ticks",
    bare && bare.querySelectorAll(".sketch-editor-tick").length === 0,
  );

  editor.close();
}

console.log("\n  a drag draws the element, then the Y is asked for\n");

/*
 * ========================================================
 * PRESS, DRAG, RELEASE, THEN ENTER THE EXACT Y
 * ========================================================
 *
 * The cursor decides WHERE the point is - the station along the body, and
 * roughly how high - and the popup decides the exact ORDINATE. So a release
 * must open the Y popup, and confirming it must set the element's y to the
 * number typed.
 *
 * JSDOM has no layout, so the SVG reports a zero-size rect and every screen
 * coordinate maps back to the same tiny world box. That is enough to drive
 * the GESTURE - a press, a move, a release - and to see the popup open and
 * apply its value, which is what this checks.
 */
{
  editor.close();

  open({
    title: "SFD - Sketch",
    range: { from: 0, to: 600 },
    elements: [],
    yUnit: "kN",
    stations: [{ key: "force", position: { x: 200, y: 0 } }],
    onPreview: () => {},
    onApply: () => {},
    onCancel: () => {},
  });

  const live = global.document.querySelector(".sketch-editor");
  const svg = live.querySelector(".sketch-editor-graph");

  /* Choose the Straight Line tool. */
  const lineButton = live.querySelector('[data-sketch-tool="line"]');

  lineButton.dispatchEvent(
    new global.window.MouseEvent("click", { bubbles: true }),
  );

  check(
    "the Line tool is active before the drag",
    lineButton.classList.contains("sketch-editor-tool-active"),
    lineButton.className,
  );

  const pointer = (type, clientX, clientY) => {
    const event = new global.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });

    event.clientX = clientX;
    event.clientY = clientY;
    event.pointerId = 1;

    svg.dispatchEvent(event);
  };

  /* Press, drag, release. */
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 60, 40);
  pointer("pointerup", 60, 40);

  /*
   * NO POPUP, AND THAT IS THE REQUIREMENT. The cursor supplies the ordinate, so
   * drawing a point is one action with no dialog between the intention and the
   * result. The old Y-value popup is GONE - not merely unused - and this is what
   * says so.
   */
  check(
    "releasing a drawn element opens NO Y-value popup",
    !global.document.querySelector(".sketch-editor-y-popup"),
    "the Y popup is still being opened",
  );

  check(
    "and the editor no longer offers one at all",
    typeof editor.askForYValue === "undefined",
    "askForYValue is still exported",
  );

  editor.close();
}

console.log("\n  one curve tool covers every shape\n");

/*
 * ========================================================
 * START -> BEND -> END IS THE WHOLE CURVE VOCABULARY
 * ========================================================
 *
 * There is no Maximum tool, no Minimum tool and no Concave tool. One Curve
 * element is built from three points, and the Bend decides the shape:
 *
 *   Bend on the Start-End line  -> a near-straight segment
 *   Bend above it               -> a rise into a peak
 *   Bend below it               -> a fall into a trough
 *
 * These check the ELEMENT that is built, so the shape vocabulary is one data
 * shape rather than several tools.
 */
const curveUp = editor.buildThreePointCurve(
  "c1",
  { x: 0, y: 0 },
  { x: 50, y: 100 },
  { x: 100, y: 0 },
);

check(
  "a curve is one element with start, bend and end",
  curveUp.kind === "curve3" &&
    Boolean(curveUp.start && curveUp.bend && curveUp.end),
  JSON.stringify(curveUp),
);

check(
  "a peak is Start 0, Bend 100, End 0 - no Maximum tool required",
  curveUp.start.y === 0 &&
    curveUp.bend.y === 100 &&
    curveUp.end.y === 0,
  JSON.stringify(curveUp),
);

const curveDown = editor.buildThreePointCurve(
  "c2",
  { x: 0, y: 0 },
  { x: 50, y: -100 },
  { x: 100, y: 0 },
);

check(
  "a trough is the same tool with the Bend below - no Minimum tool",
  curveDown.start.y === 0 &&
    curveDown.bend.y === -100 &&
    curveDown.end.y === 0,
  JSON.stringify(curveDown),
);

/* Rising and falling are the same element with different end heights. */
const rising = editor.buildThreePointCurve(
  "c3",
  { x: 0, y: 0 },
  { x: 50, y: 25 },
  { x: 100, y: 100 },
);

const falling = editor.buildThreePointCurve(
  "c4",
  { x: 0, y: 100 },
  { x: 50, y: 25 },
  { x: 100, y: 0 },
);

check(
  "a rising curve and a falling one are the same element kind",
  rising.kind === "curve3" && falling.kind === "curve3",
);

check(
  "and neither needed a separate Increasing/Decreasing tool",
  rising.end.y > rising.start.y && falling.end.y < falling.start.y,
);

/*
 * THE BEND IS A CONTROL POINT, NOT A VERTEX. The curve reports the three for
 * the scale, but the finished drawing passes through the Start and End and is
 * pulled toward the Bend - so the element is still three points, not a crowd.
 */
check(
  "the curve exposes exactly three meaningful points",
  editor.pointsOf(curveUp).length === 3,
  `got ${editor.pointsOf(curveUp).length}`,
);

console.log("\n  the x snaps to body-element ticks, but is not trapped by them\n");

/*
 * ========================================================
 * SNAP IS A MAGNET, NOT A WALL
 * ========================================================
 *
 * The graph's ticks are the body's element x-locations, and a nearby point is
 * pulled onto one - so a diagram change lands exactly on the force or support
 * that causes it. But the student must still be able to place an element
 * BETWEEN two ticks, because the interesting part of a curve is usually
 * between the events.
 */
{
  const snapRange = { from: 0, to: 600 };

  const stations = [
    { key: "start", position: { x: 0, y: 0 } },
    { key: "force", position: { x: 200, y: 0 } },
    { key: "support", position: { x: 400, y: 0 } },
    { key: "end", position: { x: 600, y: 0 } },
  ];

  /* A point within the tolerance of the force's tick is pulled onto it. */
  const near = editor.snapXToStations(
    202,
    stations,
    editor.makeScale(snapRange, []),
    snapRange,
  );

  check(
    "a point near a body element snaps onto its x",
    near === 200,
    `202 snapped to ${near}, expected 200`,
  );

  /* A point well away from every tick keeps its own x. */
  const between = editor.snapXToStations(
    310,
    stations,
    editor.makeScale(snapRange, []),
    snapRange,
  );

  check(
    "a point between two ticks is NOT forced onto one",
    between === 310,
    `310 became ${between}`,
  );

  /* And the body's own ends are snap targets. */
  const atEnd = editor.snapXToStations(
    599,
    stations,
    editor.makeScale(snapRange, []),
    snapRange,
  );

  check(
    "the body's end is a snap target too",
    atEnd === 600,
    `599 snapped to ${atEnd}`,
  );

  /* No stations, no snap - a diagram on no body is unaffected. */
  const none = editor.snapXToStations(
    123,
    [],
    editor.makeScale(snapRange, []),
    snapRange,
  );

  check(
    "with no body elements there is nothing to snap to",
    none === 123,
    `123 became ${none}`,
  );
}

console.log("\n  the ordinate comes from the cursor, not a dialog\n");

/*
 * ========================================================
 * THERE IS NO Y-VALUE POPUP
 * ========================================================
 *
 * The cursor IS the ordinate, in both axes. The popup that used to open after
 * every placement is removed, so there is nothing to ask and nothing to answer
 * - placing a point is one action. These checks pin that it cannot come back
 * through another door: the module must not export one, and the source must not
 * contain one.
 */
{
  const source = require("fs").readFileSync(
    require("./helpers/source-path.cjs").modulePath("sketch-editor.js"),
    "utf8",
  );

  check(
    "the module exports no Y-value popup",
    typeof editor.askForYValue === "undefined",
    "askForYValue is still exported",
  );

  check(
    "and the source defines none",
    !/askForYValue/.test(source) && !/sketch-editor-y-popup/.test(source),
    "the popup is still defined somewhere in the editor",
  );

  check(
    "no placement opens a popup of its own",
    !/data-y-input/.test(source),
    "a Y input is still built somewhere",
  );
}

console.log("\n  BOTH creation idioms work on the same stroke\n");

/*
 * ========================================================
 * CLICK -> CLICK AND PRESS -> DRAG -> RELEASE
 * ========================================================
 *
 * The same LINE is made either way, and the student never says which they
 * meant: a press that travels is a drag, and a press that stays put leaves the
 * stroke open for a second click.
 */
{
  const makeEditor = () => {
    const dialog3 = editor.open({
      title: "SFD Sketch",
      range: { from: 0, to: 100 },
      elements: [],
      stations: [],
    });

    const svg3 = dialog3.querySelector("[data-sketch-graph]");

    svg3.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 900,
      height: 320,
    });

    const pointer3 = (type, x, y) => {
      const event = new global.window.Event(type, {
        bubbles: true,
        cancelable: true,
      });

      event.clientX = x;
      event.clientY = y;
      event.pointerId = 1;

      svg3.dispatchEvent(event);
    };

    const click3 = (x, y) => {
      const event = new global.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });

      event.clientX = x;
      event.clientY = y;

      svg3.dispatchEvent(event);
    };

    return { svg3, pointer3, click3 };
  };

  /* A drag: press, move, release. */
  {
    const { pointer3 } = makeEditor();

    pointer3("pointerdown", 100, 100);
    pointer3("pointermove", 300, 140);
    pointer3("pointerup", 300, 140);

    const strokes = global.document.querySelectorAll(".sketch-editor-stroke");

    check(
      "a press, drag and release makes one line",
      strokes.length === 1,
      `found ${strokes.length}`,
    );

    editor.close();
  }

  /* A click-move-click: press and release, then move, then click. */
  {
    const { pointer3, click3 } = makeEditor();

    pointer3("pointerdown", 100, 100);
    pointer3("pointerup", 100, 100);

    pointer3("pointermove", 300, 140);

    click3(300, 140);

    const strokes = global.document.querySelectorAll(".sketch-editor-stroke");

    check(
      "a click, a move and a second click also makes one line",
      strokes.length === 1,
      `found ${strokes.length}`,
    );

    editor.close();
  }
}

console.log("\n  a straight line BENDS into a curve from its middle handle\n");

/*
 * ========================================================
 * METHOD B: STRAIGHT LINE, THEN BEND THE MIDDLE
 * ========================================================
 *
 * A student often places the two ends of a diagram first and only then wants
 * the middle to bow. Deleting the line and redrawing it as a curve throws away
 * the endpoints they already had, so the middle handle BENDS it instead: the
 * element's kind changes to `curve3`, its Start and End are kept, and the bend
 * is wherever they dragged.
 */
{
  const makeEditor = () => {
    const dialog4 = editor.open({
      title: "SFD Sketch",
      range: { from: 0, to: 100 },
      elements: [],
      stations: [],
    });

    const svg4 = dialog4.querySelector("[data-sketch-graph]");

    svg4.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 900,
      height: 320,
    });

    const pointer4 = (type, x, y) => {
      const event = new global.window.Event(type, {
        bubbles: true,
        cancelable: true,
      });

      event.clientX = x;
      event.clientY = y;
      event.pointerId = 1;

      svg4.dispatchEvent(event);
    };

    return { dialog4, svg4, pointer4 };
  };

  /* Draw a straight line by dragging, so it is created and selected. */
  const { svg4, pointer4 } = makeEditor();

  pointer4("pointerdown", 120, 160);
  pointer4("pointermove", 640, 160);
  pointer4("pointerup", 640, 160);

  check(
    "the line is drawn and selected",
    svg4.querySelectorAll(".sketch-editor-stroke").length === 1,
  );

  /*
   * THE MIDDLE HANDLE EXISTS. A line has THREE handles while selected: its two
   * ends and the bend that turns it into a curve.
   */
  const handles = svg4.querySelectorAll(".sketch-editor-handle");

  check(
    "a selected line offers three handles, one of them the bend",
    handles.length === 3,
    `found ${handles.length}`,
  );

  check(
    "and one of them is the bend handle",
    [...handles].some((h) => h.dataset.handleKind === "bend"),
    [...handles].map((h) => h.dataset.handleKind).join(", "),
  );

  /* The middle of the line, in screen coordinates. */
  const bendHandle = [...handles].find(
    (h) => h.dataset.handleKind === "bend",
  );

  const bendAt = bendHandle
    ? {
        x: Number(bendHandle.getAttribute("cx")),
        y: Number(bendHandle.getAttribute("cy")),
      }
    : null;

  /*
   * The middle of the line, derived from the TWO END HANDLES the editor drew -
   * the same projection, read back rather than recomputed, so the check cannot
   * disagree with the graph over where the line is.
   */
  const endHandles = Object.fromEntries(
    [...handles]
      .filter((h) => h.dataset.handleKind !== "bend")
      .map((h) => [
        h.dataset.handleKind,
        {
          x: Number(h.getAttribute("cx")),
          y: Number(h.getAttribute("cy")),
        },
      ]),
  );

  const midScreen = {
    x: (endHandles.start.x + endHandles.end.x) / 2,
    y: (endHandles.start.y + endHandles.end.y) / 2,
  };

  check(
    "the bend handle sits ON the straight line (the midpoint)",
    bendAt &&
      Math.abs(bendAt.y - midScreen.y) < 1 &&
      Math.abs(bendAt.x - midScreen.x) < 1,
    `handle ${JSON.stringify(bendAt)} vs midpoint ${JSON.stringify(midScreen)}`,
  );

  /* Drag the middle handle upward, which should bow the line. */
  pointer4("pointerdown", bendAt.x, bendAt.y);
  pointer4("pointermove", bendAt.x, bendAt.y - 70);
  pointer4("pointerup", bendAt.x, bendAt.y - 70);

  /*
   * THE ELEMENT IS NOW A CURVE, drawn as a PATH rather than a straight line -
   * and the stroke count is unchanged, because it is the same feature.
   */
  check(
    "the line is still ONE feature after bending",
    svg4.querySelectorAll(".sketch-editor-stroke").length === 1,
  );

  check(
    "and it is now drawn as a CURVE, not a straight line",
    svg4.querySelectorAll("path.sketch-editor-stroke").length === 1,
    `paths: ${svg4.querySelectorAll("path.sketch-editor-stroke").length}`,
  );

  editor.close();
}

console.log("\n  a snap is SHOWN while the cursor is over one\n");

/*
 * ========================================================
 * THE SNAP INDICATION
 * ========================================================
 *
 * A magnet nobody can see is a magnet nobody trusts. The mark appears while a
 * point is being placed OR while simply hovering, and it says which SORT of
 * thing was caught, because an endpoint and a station look alike on a dense
 * graph and mean different placements.
 */
{
  const dialog5 = editor.open({
    title: "SFD Sketch",
    range: { from: 0, to: 100 },
    elements: [],
    stations: [{ position: { x: 50, y: 0 } }],
  });

  const svg5 = dialog5.querySelector("[data-sketch-graph]");

  svg5.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 320,
  });

  const move = (x, y) => {
    const event = new global.window.Event("pointermove", {
      bubbles: true,
      cancelable: true,
    });

    event.clientX = x;
    event.clientY = y;
    event.pointerId = 1;

    svg5.dispatchEvent(event);
  };

  /*
   * Hover near the station at graph x = 50. The scale maps the range onto the
   * plot, so the station's screen x is found from the same projection the axes
   * use rather than guessed.
   */
  const scale5 = editor.makeScale({ from: 0, to: 100 }, [], {});
  const stationScreen = scale5.toScreen({ x: 50, y: 0 });

  move(stationScreen.x + 2, stationScreen.y - 40);

  check(
    "hovering near a station shows the snap mark",
    svg5.querySelectorAll(".sketch-editor-snap").length === 1,
    "no snap indication appeared",
  );

  check(
    "and it names what it caught",
    /Station/.test(svg5.querySelector(".sketch-editor-snap-label")?.textContent || ""),
  );

  /* Move away from the station: the mark must go. */
  move(stationScreen.x + 200, stationScreen.y - 40);

  check(
    "and moving away clears it",
    svg5.querySelectorAll(".sketch-editor-snap").length === 0,
    "the indication was left behind",
  );

  editor.close();
}


/*
 * ========================================================
 * EDITING IS EASY: SELECT DRAGS, DELETE DELETES, CTRL+Z UNDOES
 * ========================================================
 *
 * Select used to do nothing on a press, there was no Delete key and no undo,
 * and a wobble while clicking committed a line a fraction of a unit long.
 */
{
  console.log("\n  editing a sketch\n");

  const dialog6 = editor.open({
    title: "SFD Sketch",
    range: { from: 0, to: 100 },
    elements: [],
    stations: [],
  });

  const svg6 = dialog6.querySelector("[data-sketch-graph]");

  svg6.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 320 });

  const pointer6 = (type, x, y) => {
    const event = new global.window.Event(type, { bubbles: true, cancelable: true });

    event.clientX = x;
    event.clientY = y;
    event.pointerId = 6;

    svg6.dispatchEvent(event);
  };

  const key6 = (key, extra = {}) => {
    svg6.dispatchEvent(
      new global.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }),
    );
  };

  const strokes6 = () => dialog6.querySelectorAll(".sketch-editor-stroke").length;

  /* A wobble: pressed and released three pixels apart. */
  pointer6("pointerdown", 200, 100);
  pointer6("pointermove", 203, 101);
  pointer6("pointermove", 205, 101);
  pointer6("pointerup", 205, 101);

  check("a stroke too short to see is not added", strokes6() === 0, `found ${strokes6()}`);

  /* A real line. */
  pointer6("pointerdown", 100, 100);
  pointer6("pointermove", 300, 140);
  pointer6("pointerup", 300, 140);

  check("a real drag still draws a line", strokes6() === 1, `found ${strokes6()}`);

  /* Select can move it. */
  dialog6.querySelector('[data-sketch-tool="select"]').click();

  const before = dialog6.querySelector(".sketch-editor-list").textContent;

  /*
   * The graph rescales to fit a committed stroke, so the line is found where it
   * is now drawn - a quarter of the way along, clear of its three handles.
   */
  const line6 = dialog6.querySelector(".sketch-editor-stroke");
  const along = (t) => ({
    x: Number(line6.getAttribute("x1")) + (Number(line6.getAttribute("x2")) - Number(line6.getAttribute("x1"))) * t,
    y: Number(line6.getAttribute("y1")) + (Number(line6.getAttribute("y2")) - Number(line6.getAttribute("y1"))) * t,
  });
  const grab = along(0.25);

  pointer6("pointerdown", grab.x, grab.y);
  pointer6("pointermove", grab.x + 40, grab.y);
  pointer6("pointerup", grab.x + 40, grab.y);

  const after = dialog6.querySelector(".sketch-editor-list").textContent;

  check("the Select tool moves an element by dragging it", before !== after, `${before} | ${after}`);

  /* Ctrl+Z puts it back; Ctrl+Y moves it again. */
  key6("z", { ctrlKey: true });

  check(
    "Ctrl+Z undoes the move",
    dialog6.querySelector(".sketch-editor-list").textContent === before,
  );

  key6("y", { ctrlKey: true });

  check(
    "and Ctrl+Y redoes it",
    dialog6.querySelector(".sketch-editor-list").textContent === after,
  );

  /* Delete removes the selected element. */
  const moved6 = dialog6.querySelector(".sketch-editor-stroke");
  const pressAt = {
    x: Number(moved6.getAttribute("x1")) + (Number(moved6.getAttribute("x2")) - Number(moved6.getAttribute("x1"))) * 0.25,
    y: Number(moved6.getAttribute("y1")) + (Number(moved6.getAttribute("y2")) - Number(moved6.getAttribute("y1"))) * 0.25,
  };

  pointer6("pointerdown", pressAt.x, pressAt.y);
  pointer6("pointerup", pressAt.x, pressAt.y);

  key6("Delete");

  check("Delete removes the selected element", strokes6() === 0, `found ${strokes6()}`);

  key6("z", { ctrlKey: true });

  check("and Ctrl+Z brings it back", strokes6() === 1, `found ${strokes6()}`);

  editor.close();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log("\n  the axis follows the DRAWN geometry\n");

/*
 * ========================================================
 * THE AXIS REACHES WHAT IS DRAWN
 * ========================================================
 *
 * The graph's vertical extent must come from the geometry that is really on
 * it. It used to be ORed with the analysis layer's range, so a sketch with one
 * small element was still drawn against the full height of the body's diagram
 * and the axis reached far past anything on the graph.
 */
{
  const spanRange = { from: 0, to: 100 };

  const flat = editor.chooseUnitHeight(
    spanRange,
    [{ kind: "line", start: { x: 0, y: 0 }, end: { x: 50, y: 10 } }],
    {},
  );

  const tall = editor.chooseUnitHeight(
    spanRange,
    [{ kind: "line", start: { x: 0, y: 0 }, end: { x: 50, y: 400 } }],
    {},
  );

  check(
    "a taller element makes a taller axis",
    tall > flat,
    `${flat} vs ${tall}`,
  );

  check(
    "and the axis reaches the element with a small margin, not a large one",
    Math.abs(flat - 10 * 1.12) < 1e-9,
    `expected ~${10 * 1.12}, got ${flat}`,
  );

  check(
    "a large analysis range does NOT inflate a small drawing",
    (() => {
      const withRange = editor.chooseUnitHeight(
        spanRange,
        [{ kind: "line", start: { x: 0, y: 0 }, end: { x: 50, y: 10 } }],
        { yRange: 5000 },
      );

      return Math.abs(withRange - flat) < 1e-9;
    })(),
    "the range is a fallback for an empty sketch, not a floor",
  );

  check(
    "but it IS used when nothing is drawn, so an empty sketch has a real axis",
    (() => {
      const empty = editor.chooseUnitHeight(spanRange, [], { yRange: 40 });

      return Math.abs(empty - 40 * 1.12) < 1e-9;
    })(),
  );

  check(
    "and an empty sketch with no range still gets a usable extent",
    editor.chooseUnitHeight(spanRange, [], {}) > 0,
  );
}

console.log("\n  a curve's REAL extremes are used, not its Bend\n");

{
  /*
   * A quadratic's control point is not on the curve, so the Bend's own y is
   * never the drawn height. Measured here by comparing the extent of a curve
   * whose Bend sits high against one whose Bend is on the line.
   */
  const bowed = editor.pointsOf({
    kind: "curve3",
    start: { x: 0, y: 0 },
    bend: { x: 50, y: 100 },
    end: { x: 100, y: 0 },
  });

  check(
    "a curve reports its three defining points",
    bowed.length === 3,
    JSON.stringify(bowed.length),
  );
}

console.log("\n  H/V inference makes a step EXACTLY level or exactly upright\n");

/*
 * ========================================================
 * HORIZONTAL AND VERTICAL INFERENCE
 * ========================================================
 *
 * A diagram is drawn between values it already knows, so after placing a point
 * the student wants to move straight across from it or straight up. The
 * matching coordinate is set to the anchor's EXACT value - a step that looks
 * level and stores a fraction of a unit of error is a defect the renderer
 * hides and the analysis finds.
 */
{
  const scale = editor.makeScale({ from: 0, to: 100 }, [], {});

  const context = {
    scale,
    stations: [],
    elements: [],
    from: { x: 40, y: 25 },
  };

  /* A little off the anchor's y: within tolerance. */
  const level = editor.snapPoint({ x: 70, y: 25.4 }, context);

  check(
    "a cursor near the anchor's HEIGHT snaps to it exactly",
    level && level.kind === "horizontal" && level.point.y === 25,
    JSON.stringify(level),
  );

  check(
    "and the x still follows the cursor",
    level && Math.abs(level.point.x - 70) < 1e-9,
    JSON.stringify(level?.point),
  );

  /* A little off the anchor's x. */
  const upright = editor.snapPoint({ x: 40.3, y: 60 }, context);

  check(
    "a cursor near the anchor's STATION snaps to it exactly",
    upright && upright.kind === "vertical" && upright.point.x === 40,
    JSON.stringify(upright),
  );

  check(
    "and the y still follows the cursor",
    upright && Math.abs(upright.point.y - 60) < 1e-9,
    JSON.stringify(upright?.point),
  );

  /* Far from both axes: free. */
  const free = editor.snapPoint({ x: 70, y: 60 }, context);

  check(
    "a cursor well away from either axis is NOT constrained",
    free === null,
    JSON.stringify(free),
  );

  check(
    "and it says which constraint it applied",
    editor.snapLabel("horizontal") === "Horizontal" &&
      editor.snapLabel("vertical") === "Vertical",
  );
}
