/*
 * ========================================================
 * PLACEHOLDERS, AND THE LEADER PEN
 * ========================================================
 *
 * Two things the Annotate system must get right, and both are about an
 * annotation being a REAL feature with structured data rather than a glyph:
 *
 *   1. A text-bearing annotation created without content is a valid feature
 *      that SHOWS a contextual placeholder - "Enter note", "Enter label" - and
 *      STORES the empty string. The placeholder is never saved as content.
 *
 *   2. A leader and a callout are a PEN: an attachment, zero or more BENDS and
 *      an endpoint, held as ONE ordered list. Adding a bend splits a segment at
 *      its midpoint (so the line does not jump); removing one reconnects the
 *      neighbours (so the path is never left broken).
 */

const { JSDOM } = require("jsdom");

const { loadModule } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.window.crypto = { randomUUID: () => "annotate-placeholder-uuid" };

for (const name of [
  "quantities.js",
  "annotate-model.js",
  "drawing-state.js",
  "renderer.js",
]) {
  loadModule(name);
}

const annotate = require(
  require("./helpers/source-path.cjs").modulePath("annotate-model.js"),
).default;

const renderer = require(
  require("./helpers/source-path.cjs").modulePath("renderer.js"),
).default;

console.log("\n  a placeholder is shown, never stored\n");

{
  const note = annotate.createAnnotate({
    kind: "note",
    position: { x: 0, y: 0 },
  });

  check(
    "a new note stores an EMPTY string, not a phrase",
    note.text === "",
    JSON.stringify(note.text),
  );

  check(
    "and it DISPLAYS a contextual placeholder",
    annotate.displayTextOf(note) === "Enter note",
    annotate.displayTextOf(note),
  );

  check("which is not its content", annotate.hasContent(note) === false);

  check(
    "and it is flagged as a placeholder for the renderer",
    annotate.isPlaceholder(note) === true,
  );

  note.text = "Check the weld";

  check(
    "writing real content replaces the placeholder",
    annotate.displayTextOf(note) === "Check the weld",
  );

  check(
    "and it is no longer a placeholder",
    annotate.isPlaceholder(note) === false,
  );
}

console.log("\n  every text kind has its OWN prompt\n");

{
  const label = annotate.createAnnotate({
    kind: "label",
    position: { x: 0, y: 0 },
  });
  const callout = annotate.createAnnotate({
    kind: "callout",
    start: { x: 0, y: 0 },
    end: { x: 5, y: 5 },
  });

  check(
    "a label says Enter label",
    annotate.displayTextOf(label) === "Enter label",
  );
  check(
    "a callout says Enter callout",
    annotate.displayTextOf(callout) === "Enter callout",
  );

  check(
    "an arrow has no text and no placeholder",
    annotate.displayTextOf(
      annotate.createAnnotate({
        kind: "arrow",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 5 },
      }),
    ) === "",
  );

  check(
    "a symbol still draws its glyph rather than a placeholder",
    annotate.displayTextOf(
      annotate.createAnnotate({
        kind: "symbol",
        position: { x: 0, y: 0 },
        symbolId: "datum",
      }),
    ) === annotate.SYMBOL_BY_ID.datum.text,
  );
}

console.log("\n  the placeholder reaches the sheet, muted\n");

{
  const host = global.document.createElement("div");
  global.document.body.appendChild(host);

  const note = annotate.createAnnotate({
    kind: "note",
    position: { x: 0, y: 0 },
  });

  renderer.renderDrawing(
    {
      objects: [note],
      camera: { zoom: 1, panX: 0, panY: 0 },
      grid: { visible: false, spacing: 5 },
      snap: { enabled: false },
      display: {},
      styleDefaults: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
      selection: {
        selectedObjectIds: [],
        boxSelectionIds: [],
        hoveredObjectId: null,
      },
      interaction: { phase: "idle", preview: null, previewObjects: [] },
    },
    host,
  );

  const texts = [...host.querySelectorAll("text")].map(
    (node) => node.textContent,
  );

  check(
    "the empty note is still a visible, legible thing",
    texts.some((text) => text.includes("Enter note")),
    JSON.stringify(texts),
  );

  const placeholderNode = [...host.querySelectorAll("text")].find((node) =>
    String(node.textContent).includes("Enter note"),
  );

  check(
    "and it is drawn muted, so it reads as not-yet-written",
    placeholderNode && placeholderNode.getAttribute("fill") !== "#000000",
    placeholderNode?.getAttribute("fill"),
  );
}

console.log("\n  the leader is one ordered path\n");

{
  const leader = annotate.createAnnotate({
    kind: "leader",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 10 },
  });

  check(
    "a bare leader is attachment then endpoint",
    annotate.leaderPathPoints(leader).length === 2,
  );

  const index = annotate.addLeaderBend(leader, 0);

  check("adding a bend returns its index", index === 0);

  const path = annotate.leaderPathPoints(leader);

  check(
    "the bend sits at the MIDPOINT of the segment it split",
    path.length === 3 && path[1].x === 5 && path[1].y === 5,
    JSON.stringify(path),
  );

  check(
    "so the drawn line does not jump when the bend is added",
    path[0].x === 0 && path[2].x === 10,
  );

  leader.geometry.bends[0] = { x: 3, y: 8 };

  check("the bend can be moved", annotate.leaderPathPoints(leader)[1].x === 3);

  annotate.removeLeaderBend(leader, 0);

  check(
    "removing it RECONNECTS the neighbours",
    annotate.leaderPathPoints(leader).length === 2,
  );

  annotate.translateAnnotation(leader, 2, 3);

  check(
    "moving the leader moves its bends too",
    annotate.leaderPathPoints(leader)[0].x === 2,
  );
}

console.log("\n  a bent leader draws as a polyline\n");

{
  const leader = annotate.createAnnotate({
    kind: "leader",
    start: { x: 0, y: 0 },
    end: { x: 20, y: 0 },
  });

  annotate.addLeaderBend(leader, 0);

  const host = global.document.createElement("div");
  global.document.body.appendChild(host);

  renderer.renderDrawing(
    {
      objects: [leader],
      camera: { zoom: 1, panX: 0, panY: 0 },
      grid: { visible: false, spacing: 5 },
      snap: { enabled: false },
      display: {},
      styleDefaults: { stroke: "#000000", lineWidth: 0.5, lineType: "solid" },
      selection: {
        selectedObjectIds: [],
        boxSelectionIds: [],
        hoveredObjectId: null,
      },
      interaction: { phase: "idle", preview: null, previewObjects: [] },
    },
    host,
  );

  const polyline = host.querySelector("polyline");

  check(
    "it is drawn as a polyline through every path point",
    polyline && String(polyline.getAttribute("points")).split(" ").length === 3,
    polyline?.getAttribute("points"),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
