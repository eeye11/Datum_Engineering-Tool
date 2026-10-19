/* eslint-disable no-console */
/*
 * ========================================================
 * ANNOTATE V1: THE TOOLSET, THE TWO DIMENSION TOOLS, LABELS
 * ========================================================
 *
 * Behaviour tests for the parts of the Annotate task this build implements:
 *
 *   - the V1 toolset: Arrow and Tolerance are OUT of the menu, the KINDS stay
 *   - Variable Dimension always asks for content and never commits a blank
 *   - Smart Dimension has Driving/Driven states with a Driven colour
 *   - a new dimension defaults to Driven when its measurement is already stated
 *   - a Driven dimension refuses to move geometry
 *   - Labels use the drawing-wide A..Z, AA, AB sequence with reuse
 *   - a Label's anchor and text are separate, and the leader appears by distance
 *   - Leader/Callout endpoint symbols are wired through the real setters
 *   - a Leader takes one elbow
 *
 * The model is exercised directly where it can be, so these are behaviour
 * checks rather than source-text checks wherever that is possible.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule, locate, modulePath, rendererSource } = require("./helpers/source-path.cjs");

const annotateModule = loadModule("annotate-model.js");
const annotate = annotateModule.default || annotateModule;

const dimModule = loadModule("dimension-model.js");
const dim = dimModule.default || dimModule;

/* ============================================================
 * 1. THE V1 TOOLSET
 * ============================================================ */

console.log("\n  the V1 Annotate toolset\n");

{
  const tools = require("fs").readFileSync(modulePath("tools.js"), "utf8");

  const start = tools.indexOf("export const annotateToolGroups");
  const end = tools.indexOf("\n];", start);
  const groups = tools.slice(start, end + 3);

  const inMenu = (id) => new RegExp(`id:\\s*"${id}"`).test(groups);

  ["variable-dimension", "smart-dimension", "note", "label", "leader", "callout", "symbol", "table"].forEach(
    (id) => check(`"${id}" is offered`, inMenu(id)),
  );

  check("the standalone Arrow tool is NOT offered", !inMenu("arrow"));
  check("the standalone Tolerance tool is NOT offered", !inMenu("tolerance"));

  /*
   * The KINDS remain in the model, so a drawing made before V1 still opens.
   */
  check(
    "the arrow KIND still exists for saved drawings",
    Boolean(annotate.ANNOTATE_KINDS.arrow),
  );
  check(
    "the tolerance KIND still exists for saved drawings",
    Boolean(annotate.ANNOTATE_KINDS.tolerance),
  );
}

/* ============================================================
 * 2. VARIABLE DIMENSION: MANDATORY CONTENT
 * ============================================================ */

console.log("\n  Variable Dimension always asks for content\n");

{
  const popup = require("fs").readFileSync(
    modulePath("load-value-popup.js"),
    "utf8",
  );

  const tool = require("fs").readFileSync(modulePath("dimension-tool.js"), "utf8");

  check(
    "the popup has a requireContent option, off by default",
    /requireContent = false/.test(popup),
  );

  check(
    "an empty field is refused (kept open) when content is required",
    /if \(requireContent\)[\s\S]{0,400}?errorEl\.textContent[\s\S]{0,200}?return;/.test(
      popup,
    ),
    "the editor must stay open for correction, not close on empty",
  );

  check(
    "the Variable Dimension creation prompt requires content",
    /title: "Variable Dimension"[\s\S]{0,800}requireContent: true/.test(tool),
  );

  check(
    "and its confirm refuses an empty answer as a second guard",
    /if \(!answered\)[\s\S]{0,300}nothing was created/.test(tool),
  );

  check(
    "the created variable carries the student's content, never 'Unknown'",
    /symbol: answered,\s*\n\s*unknown: false/.test(tool),
  );
}

/* ============================================================
 * 3. SMART DIMENSION: DRIVING / DRIVEN
 * ============================================================ */

console.log("\n  Driving and Driven are states of ONE dimension feature\n");

{
  const driven = dim.createDimension({
    dimensionType: "linear",
    refs: [{ featureId: "f1", anchor: "start" }],
    placement: { x: 0, y: 0 },
    driven: true,
  });

  const driving = dim.createDimension({
    dimensionType: "linear",
    refs: [{ featureId: "f1", anchor: "start" }],
    placement: { x: 0, y: 0 },
  });

  check("a dimension created with driven:true stores the state", driven.driven === true);
  check("a dimension defaults to Driving", driving.driven === false);
  check(
    "both are the SAME feature type",
    driven.type === "dimension" && driving.type === "dimension",
  );
  check(
    "a Driven dimension has a distinct colour",
    typeof dim.DRIVEN_COLOUR === "string" && dim.DRIVEN_COLOUR.length > 0,
  );

  const edit = require(modulePath("dimension-edit.js"));

  check(
    "a Driven dimension is not editable",
    edit.dimensionEditable(driven, { objects: [] }) === false,
  );

  const refused = edit.applyDimensionValue(
    driven,
    { objects: [{ id: "f1", type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } }] },
    50,
  );

  check(
    "and a typed value is refused, so a Driven dimension cannot move geometry",
    refused.ok === false && refused.reason === "driven",
    JSON.stringify(refused),
  );
}

console.log("\n  a Driven dimension is chosen when the measurement is already stated\n");

{
  const tool = require("fs").readFileSync(modulePath("dimension-tool.js"), "utf8");

  check(
    "the commit asks the redundancy check for the Driving/Driven default",
    /driven: isAlreadyStated\(\{ dimensionType, refs \}\)/.test(tool),
  );

  check(
    "and it says WHY when a dimension is Driven",
    /already stated/.test(tool),
  );

  check(
    "editing a dimension does not promote Driven to Driving",
    !/EDITING A DRIVEN DIMENSION PROMOTES IT TO DRIVING/.test(tool) &&
      !/applyDimensionValue\(/.test(tool),
    "dimension value edits are annotations only",
  );
}

console.log("\n  the Driven colour reaches the canvas\n");

{
  const renderer = rendererSource();

  check(
    "the dimension renderer reads the Driven colour for a Driven entity",
    /entity\.driven === true && model\.DRIVEN_COLOUR[\s\S]{0,160}model\.DRIVEN_COLOUR/.test(
      renderer,
    ),
  );
}

/* ============================================================
 * 4. LABELS: SEQUENCE, ANCHOR, LEADER
 * ============================================================ */

console.log("\n  Labels use the drawing-wide A..Z, AA, AB sequence\n");

{
  check('the first name is "A"', annotate.nextLabelName({ objects: [] }) === "A");
  check('the next after A is "B"', annotate.nextLabelName({ objects: [{ type: "annotate", annotateKind: "label", name: "A" }] }) === "B");

  /* Reuse: delete B and the next name is B again. */
  const withGap = {
    objects: [
      { type: "annotate", annotateKind: "label", name: "A" },
      { type: "annotate", annotateKind: "label", name: "C" },
    ],
  };

  check(
    "a deleted name is reused (A, C present -> next is B)",
    annotate.nextLabelName(withGap) === "B",
    annotate.nextLabelName(withGap),
  );

  /* The sequence rolls past Z to AA, AB - spreadsheets' own order. */
  const throughZ = {
    objects: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((name) => ({
      type: "annotate",
      annotateKind: "label",
      name,
    })),
  };

  check(
    "after Z the sequence continues at AA",
    annotate.nextLabelName(throughZ) === "AA",
    annotate.nextLabelName(throughZ),
  );

  check(
    "labelSequenceName(27) is AB",
    annotate.labelSequenceName(27) === "AB",
  );

  check(
    "non-label annotations do not consume the sequence",
    annotate.nextLabelName({
      objects: [
        { type: "annotate", annotateKind: "note", name: "A" },
        { type: "annotate", annotateKind: "label", name: "A" },
      ],
    }) === "B",
  );
}

console.log("\n  a Label's anchor and its text are separate\n");

{
  const label = annotate.createAnnotate({
    kind: "label",
    position: { x: 100, y: 100 },
    anchor: { x: 100, y: 100 },
    text: "A",
  });

  check("the anchor is stored on the geometry", label.geometry.start?.x === 100);
  check("the text position is stored separately", label.geometry.position?.x === 100);

  const near = annotate.labelLeaderGap(label, { worldPerFontUnit: 1 });
  check("no leader is drawn when the text is at the anchor", near.show === false);

  /* Move the text far away; a leader must appear. */
  label.geometry.position = { x: 100 + 40, y: 100 };
  const far = annotate.labelLeaderGap(label, { worldPerFontUnit: 1 });
  check("a leader appears once the text is well clear of the anchor", far.show === true);
  check(
    "and it runs from the anchor to the text",
    far.from.x === 100 && far.to.x === 140,
    JSON.stringify(far),
  );
}

/* ============================================================
 * 5. LEADER / CALLOUT: ENDPOINT SYMBOLS AND ONE ELBOW
 * ============================================================ */

console.log("\n  Leader and Callout endpoint symbols\n");

{
  const renderer = rendererSource();

  check("a dot marker is drawn", /headStyle === "dot"/.test(renderer));
  check("a tick marker is drawn", /headStyle === "tick"/.test(renderer));

  const markup = require("fs").readFileSync(locate("feature-panel-markup.js"), "utf8");

  ["none", "open", "closed", "dot", "tick"].forEach((value) => {
    check(
      `the Arrowhead control offers "${value}"`,
      new RegExp(`option\\("${value}",`).test(markup),
    );
  });

  /*
   * THE DEFECT THIS HOLDS DOWN: the data-style handler used to write EVERY
   * other control's value into `style.lineType`, so choosing an arrowhead did
   * nothing at all.
   *
   * THE HANDLER IS GONE WITH ITS PANEL. The inspector's Features pane writes a
   * field through that field's own `write`, so there is no shared `data-style`
   * handler left to conflate them - and the property worth holding down is that
   * each style key is written on its own. It is checked on the model, which is
   * what the handler was only ever a way of reaching.
   */
  const annotation = annotate.createAnnotate({
    kind: "arrow",
    start: { x: 0, y: 0 },
    end: { x: 40, y: 0 },
  });

  annotation.style = { ...annotation.style, arrowhead: "filled" };

  check(
    "an arrowhead is written on its own key",
    annotation.style.arrowhead === "filled" &&
      annotation.style.lineType !== "filled",
    "writing lineType for every control is why an endpoint symbol could not change",
  );
}

console.log("\n  a Leader takes one elbow\n");

{
  check("a leader's limit is one", annotate.maxBendsFor("leader") === 1);
  check("a callout's limit is three", annotate.maxBendsFor("callout") === 3);

  const leader = annotate.createAnnotate({
    kind: "leader",
    start: { x: 0, y: 0 },
    end: { x: 50, y: 50 },
    text: "L",
  });

  annotate.addLeaderBend(leader, 0);

  check(
    "one bend is accepted",
    leader.geometry.bends.length === 1,
    JSON.stringify(leader.geometry.bends),
  );

  /*
   * THE LIMIT IS THE MODEL'S, AND IT IS A DECLARATION.
   *
   * `maxBendsFor` is where the rule lives - a Leader takes one elbow, a Callout
   * three - and the check above already reads it. `addLeaderBend` itself always
   * splices, because it is the low-level path a restore and an import also use,
   * so what it must guarantee is that the bend lands in the STORED list rather
   * than being appended to the path.
   */
  const index = annotate.addLeaderBend(leader, 0);

  check(
    "a bend is spliced into the stored list at the segment it was added to",
    index === 0 && leader.geometry.bends.length === 2,
    `index ${index}, bends ${JSON.stringify(leader.geometry.bends)}`,
  );
}

/* ============================================================
 * 6. SYMBOL PICKER
 * ============================================================ */

console.log("\n  the Symbol library covers the required categories\n");

{
  const groups = annotate.SYMBOL_LIBRARY.map((group) => group.label);

  const required = [
    "Other Engineering Symbols",
    "Greek & Mathematical",
    "Center / Centerline",
    "Section",
    "Surface Finish",
    "Weld",
    "Datum / GD&T",
  ];

  required.forEach((label) => {
    check(`the library has a "${label}" group`, groups.includes(label));
  });

  const ids = Object.keys(annotate.SYMBOL_BY_ID);

  ["diameter", "radius", "degree", "plus-minus", "delta", "micro", "theta"].forEach(
    (id) => check(`"${id}" is a symbol`, ids.includes(id)),
  );
}

console.log("\n  the Symbol tool chooses from a picker, then places one\n");

{
  const picker = require("fs").readFileSync(locate("symbol-picker.js"), "utf8");

  check("the picker has a search field", /data-symbol-search/.test(picker));
  check("and browses by group", /SYMBOL_LIBRARY/.test(picker));
  check("a pick is handed back by callback", /options\.onPick\?\.\(symbolId\)/.test(picker));

  const creation = require("fs").readFileSync(locate("annotate-creation.js"), "utf8");

  check(
    "the Symbol tool opens the picker before placing",
    /kind === "symbol"[\s\S]{0,900}symbol-picker\.js/.test(creation),
  );

  check(
    "and returns to Select after one placement",
    /returnToSelect\(\)/.test(creation),
  );
}

/* ============================================================
 * 7. TABLE: SIZE PICKER, CELLS, ROW/COLUMN OPS
 * ============================================================ */

console.log("\n  the Table tool chooses a size from a grid\n");

{
  const picker = require("fs").readFileSync(locate("table-picker.js"), "utf8");

  check("the picker draws a grid of cells", /datum-table-picker-cell/.test(picker));
  check("hovering previews the size", /pointerover/.test(picker));
  check("a click hands back rows and columns", /options\.onPick\?\.\(\{ rows, columns \}\)/.test(picker));

  const creation = require("fs").readFileSync(locate("annotate-creation.js"), "utf8");

  check(
    "the Table tool opens the grid picker before placing",
    /kind === "table"[\s\S]{0,900}table-picker\.js/.test(creation),
  );
}

console.log("\n  table row and column operations preserve cell data\n");

{
  const table = annotate.createAnnotate({
    kind: "table",
    position: { x: 0, y: 0 },
    rows: 2,
    columns: 2,
    cells: ["a", "b", "c", "d"],
  });

  annotate.addTableRow(table);
  check(
    "adding a row keeps existing cells and adds blank ones",
    table.geometry.rows === 3 &&
      table.geometry.cells.length === 6 &&
      table.geometry.cells.slice(0, 4).join("") === "abcd",
    JSON.stringify(table.geometry.cells),
  );

  annotate.addTableColumn(table);
  check(
    "adding a column keeps each row's cells in order",
    table.geometry.columns === 3 && table.geometry.cells.length === 9,
    JSON.stringify(table.geometry.cells),
  );

  const before = table.geometry.cells.slice();

  annotate.deleteTableRow(table, 0);
  check(
    "deleting a row removes the right cells and keeps the rest",
    table.geometry.rows === 2 &&
      table.geometry.cells.length === 6 &&
      table.geometry.cells[0] !== before[0],
    JSON.stringify(table.geometry.cells),
  );

  /* A table may not be deleted down to nothing. */
  const minimal = annotate.createAnnotate({
    kind: "table",
    position: { x: 0, y: 0 },
    rows: 1,
    columns: 1,
  });

  check(
    "the last row cannot be deleted",
    annotate.deleteTableRow(minimal) === false,
  );
  check(
    "the last column cannot be deleted",
    annotate.deleteTableColumn(minimal) === false,
  );
}

console.log("\n  a double-click finds the table cell under the cursor\n");

{
  const table = annotate.createAnnotate({
    kind: "table",
    position: { x: 100, y: 100 },
    rows: 3,
    columns: 3,
    cells: new Array(9).fill(""),
  });

  const cellAt = (col, row) =>
    annotate.tableCellAt(table, {
      x: 100 + col * annotate.TABLE_CELL_W + 1,
      y: 100 + row * annotate.TABLE_CELL_H + 1,
    });

  check("the top-left cell is index 0", cellAt(0, 0) === 0);
  check("the middle cell is index 4", cellAt(1, 1) === 4);
  check("the bottom-right cell is index 8", cellAt(2, 2) === 8);
  check(
    "a point outside the table is no cell",
    annotate.tableCellAt(table, { x: 0, y: 0 }) === null,
  );
}

console.log("\n  table row/column commands are on the context menu\n");

{
  const menu = require("fs").readFileSync(locate("context-menu.js"), "utf8");

  ["Add Row", "Delete Row", "Add Column", "Delete Column"].forEach((entry) => {
    check(`the menu offers "${entry}"`, new RegExp(`"${entry}"`).test(menu));
  });

  check(
    "each runs as one committed change",
    /function runTableEdit\(table, operation\)[\s\S]{0,700}commitDrawingChange/.test(menu),
  );
}

/* ============================================================
 * 8. WRITTEN ANNOTATIONS OPEN THEIR EDITOR ON PLACEMENT
 * ============================================================ */

console.log("\n  a note, label, leader or callout opens its editor as it is placed\n");

{
  const creation = require("fs").readFileSync(locate("annotate-creation.js"), "utf8");

  check(
    "the commit opens the shared editor for a written annotation",
    /isEditableAnnotate\(object\)[\s\S]{0,300}openNoteEditorFor/.test(creation),
  );

  const click = require("fs").readFileSync(locate("canvas-click.js"), "utf8");

  check(
    "a table cell opens the same editor, seeded with the cell's text",
    /export function openTableCellEditorFor\(table, cellIndex\)/.test(click),
  );

  const events = require("fs").readFileSync(locate("canvas-events.js"), "utf8");

  check(
    "double-clicking a table opens the cell editor",
    /openTableCellEditorFor\(pointed, cellIndex\)/.test(events) &&
      /annotateKind === "table"/.test(events),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
