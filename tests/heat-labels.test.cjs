/*
 * ========================================================
 * HEAT TRANSFER LABELS - NOTATION, COUNTERS AND OWNERSHIP
 * ========================================================
 *
 * The requirement's Tests A-E at the MODEL level, through the shipped
 * factories, the shipped child-annotation builder and the shipped drawing
 * document. Each check names the behaviour it pins.
 *
 * What is NOT tested here and why: the inline field's focus and selection are a
 * DOM behaviour (asserted separately in note-editor's own suite), and the
 * canvas drag is asserted through the same functions the drag calls
 * (`rememberHeatLabelOffset`, `reconcileHeatLabels`).
 */
const { JSDOM } = require("jsdom");
const path = require("path");

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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

["drawingToolMessage"].forEach((id) => {
  if (!document.getElementById(id)) {
    const element = document.createElement("div");
    element.id = id;
    document.body.appendChild(element);
  }
});

const { loadModule } = require("./helpers/source-path.cjs");

const model = loadModule("heat-model.js");
const labels = loadModule("heat-labels.js");
const notation = loadModule("heat-notation.js");
const math = loadModule("math-expression.js");
const toolsRef = loadModule("heat-tools.js");
const { drawingState } = loadModule("editor-state.js");
const drawingStateModule = loadModule("drawing-state.js");

const point = (x, y) => ({ x, y });

/* Every object added, with its child label attached, the way the tool does. */
function place(build) {
  const parent = build();

  if (!parent) {
    return null;
  }

  drawingStateModule.default.addObject(drawingState, parent);

  const stored = drawingState.objects.find((o) => o.id === parent.id) || parent;

  const label = labels.createHeatLabel(stored, {
    objects: drawingState.objects,
  });

  if (label) {
    drawingStateModule.default.addObject(drawingState, label);
  }

  return { parent: stored, label };
}

function fresh() {
  drawingState.objects = [];
  drawingState.selection = drawingState.selection || {};
  drawingState.selection.selectedObjectIds = [];
}

/* ---------------------------------------------------------- Test A */

console.log("\nTest A - sequential notation");
console.log("----------------------------");

fresh();

const markers = [0, 1, 2].map((index) =>
  place(() =>
    model.createTemperatureMarker({ center: point(index * 10, 0), text: "T" }),
  ),
);

/*
 * THE NOTATION IS MATHEMATICAL MARKUP - `T_1` - not a pre-composed "T₁".
 * The canvas typesets it, the Features field shows it and the source writes
 * `$T_1$`, all from this one string. The plain-text reading of it is `T₁`.
 */
check(
  "three Temperature Markers are T_1, T_2, T_3",
  markers.map((m) => m.label?.text).join(",") === "T_1,T_2,T_3",
  markers.map((m) => m.label?.text).join(","),
);

check(
  "the markup reads as real subscripts as plain text",
  math.mathExpressionToPlainText("T_2") === "T₂" &&
    math.mathExpressionToPlainText("T_{s,1}") === "Tₛ,₁",
  math.mathExpressionToPlainText("T_{s,1}"),
);

const node = place(() => model.createCircuitNode({ center: point(50, 0) }));

check(
  "a Thermal Circuit Node on the same sheet is T_4 (the shared T family)",
  node.label?.text === "T_4",
  node.label?.text,
);

/* Change T₂ to T∞: the counter must NOT reset. */
const second = drawingState.objects.find((o) => o.id === markers[1].label.id);
second.text = "T∞";

const another = place(() =>
  model.createTemperatureMarker({ center: point(60, 0), text: "T" }),
);

check(
  "after T_2 becomes T_\\infty the next temperature label is T_5",
  another.label?.text === "T_5",
  another.label?.text,
);

check(
  "the edited label kept the student's text",
  drawingState.objects.find((o) => o.id === markers[1].label.id)?.text === "T∞",
);

/* Duplicate family: Q shares between Heat Transfer Rate and Heat Source. */
fresh();

const rate = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(10, 0),
    variant: "heat-rate",
  }),
);
const source = place(() =>
  model.createSourceSink({ center: point(20, 0), variant: "source" }),
);
const sink = place(() =>
  model.createSourceSink({ center: point(30, 0), variant: "sink" }),
);

check(
  "Heat Transfer Rate is \\dot{Q}_1",
  rate.label?.text === "\\dot{Q}_1",
  rate.label?.text,
);

check(
  "Heat Source continues the SAME Q family: \\dot{Q}_2",
  source.label?.text === "\\dot{Q}_2",
  source.label?.text,
);

check(
  "Heat Sink is \\dot{Q}_3",
  sink.label?.text === "\\dot{Q}_3",
  sink.label?.text,
);

/* The q'' family, across two Heat Flux arrows. */
fresh();

const flux = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(10, 0),
    variant: "heat-flux",
  }),
);
const flux2 = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(10, 0),
    variant: "heat-flux",
  }),
);

check(
  "two Heat Flux arrows are q''_1 and q''_2 (the q family)",
  flux.label?.text === "q''_1" && flux2.label?.text === "q''_2",
  `${flux.label?.text} / ${flux2.label?.text}`,
);

/*
 * THE PRESCRIBED HEAT-FLUX BOUNDARY IS GONE.
 *
 * It duplicated the Heat Flux arrow, so the boundary dropdown has exactly four
 * entries and `heat-flux` is no longer a boundary variant.
 */
check(
  "the Thermal Boundary dropdown has exactly four options",
  toolsRef.HEAT_TOOL_MENUS["thermal-boundary"].length === 4,
  String(toolsRef.HEAT_TOOL_MENUS["thermal-boundary"].length),
);

check(
  "Prescribed Heat-Flux Boundary is no longer a boundary variant",
  !toolsRef.HEAT_TOOL_MENUS["thermal-boundary"].some(
    (item) => item.id === "heat-flux-boundary"
  ),
);

/* ---------------------------------------------------------- tools with no label */

console.log("\nTools that generate no label");
console.log("----------------------------");

fresh();

for (const [name, build] of [
  [
    "Thermal Region",
    () =>
      model.createThermalRegion({
        position: point(0, 0),
        width: 40,
        height: 20,
      }),
  ],
  [
    "Wall / Slab",
    () => model.createWallSlab({ start: point(0, 0), end: point(40, 0) }),
  ],
  [
    "Composite Wall",
    () =>
      model.createCompositeWall({ center: point(0, 0), width: 60, height: 30 }),
  ],
  ["Fin", () => model.createFin({ base: point(0, 0), end: point(30, 0) })],
  [
    "Conduction Path",
    () =>
      model.createHeatPath({
        points: [point(0, 0), point(30, 0)],
        variant: "conduction",
      }),
  ],
]) {
  const placed = place(build);

  check(`${name} creates NO automatic label`, placed && placed.label === null);
}

/* ---------------------------------------------------------- Test C/D */

console.log("\nTest C/D - ownership, movement and offsets");
console.log("------------------------------------------");

fresh();

const boundary = place(() =>
  model.createThermalBoundary({
    start: point(0, 0),
    end: point(100, 0),
    variant: "convection",
  }),
);

check(
  "the label is a CHILD annotation of its boundary",
  boundary.label &&
    boundary.label.type === "annotate" &&
    boundary.label.metadata.heatParentId === boundary.parent.id &&
    boundary.label.parentId === boundary.parent.id,
);

check(
  "the label has its own id",
  Boolean(boundary.label.id) && boundary.label.id !== boundary.parent.id,
);

/* Moving the PARENT carries the label. */
const parent = drawingState.objects.find((o) => o.id === boundary.parent.id);
const label = drawingState.objects.find((o) => o.id === boundary.label.id);

const before = { ...label.geometry.position };

parent.geometry = {
  ...parent.geometry,
  start: { x: 0, y: 50 },
  end: { x: 100, y: 50 },
};

labels.reconcileHeatLabels(drawingState.objects);

const after = {
  ...drawingState.objects.find((o) => o.id === label.id).geometry.position,
};

check(
  "moving the parent moves the label with it",
  Math.abs(after.y - (before.y + 50)) < 1e-6,
  `before=${before.y} after=${after.y}`,
);

check(
  "the label's relative position to the parent is preserved",
  Math.abs(after.x - before.x) < 1e-6,
);

/* Moving the LABEL alone does not move the parent. */
const parentBefore = JSON.stringify(
  drawingState.objects.find((o) => o.id === boundary.parent.id).geometry,
);

const liveLabel = drawingState.objects.find((o) => o.id === label.id);
liveLabel.geometry = { ...liveLabel.geometry, position: { x: 200, y: 200 } };
labels.rememberHeatLabelOffset(
  liveLabel,
  drawingState.objects.find((o) => o.id === boundary.parent.id),
);

check(
  "moving the label leaves the parent unchanged",
  JSON.stringify(
    drawingState.objects.find((o) => o.id === boundary.parent.id).geometry,
  ) === parentBefore,
);

/* Move the parent AGAIN: the label's new relative place is kept. */
const storedOffset = {
  ...drawingState.objects.find((o) => o.id === label.id).metadata
    .heatLabelOffset,
};

const parentNow = drawingState.objects.find((o) => o.id === boundary.parent.id);
parentNow.geometry = {
  ...parentNow.geometry,
  start: { x: -30, y: 50 },
  end: { x: 70, y: 50 },
};

labels.reconcileHeatLabels(drawingState.objects);

const anchor = labels.heatParentAnchor(parentNow);
const expected = { x: anchor.x + storedOffset.x, y: anchor.y + storedOffset.y };
const actual = drawingState.objects.find((o) => o.id === label.id).geometry
  .position;

check(
  "moving the parent again preserves the label's RELATIVE position",
  Math.abs(actual.x - expected.x) < 1e-6 &&
    Math.abs(actual.y - expected.y) < 1e-6,
  `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
);

/* ---------------------------------------------------------- Test E */

console.log("\nTest E - the label object carries its own text style");
console.log("-----------------------------------------------------");

fresh();

const styled = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(40, 0),
    variant: "heat-rate",
  }),
);

const styledLabel = drawingState.objects.find((o) => o.id === styled.label.id);

check(
  "a label's latest text, colour, size and style live on the label object",
  (() => {
    styledLabel.text = "Q̇in";
    styledLabel.style = {
      ...(styledLabel.style || {}),
      labelColour: "#aa0000",
      labelSize: 18,
      labelBold: true,
      labelAnchor: "middle",
    };

    const live = drawingState.objects.find((o) => o.id === styled.label.id);

    return (
      live.text === "Q̇in" &&
      live.style.labelColour === "#aa0000" &&
      live.style.labelSize === 18 &&
      live.style.labelBold === true &&
      live.style.labelAnchor === "middle"
    );
  })(),
);

/* ---------------------------------------------------------- Objects tab */

console.log("\nObjects tab");
console.log("----------");

fresh();

const listedArrow = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(40, 0),
    variant: "heat-rate",
  })
);

const objectsList = loadModule("objects-list.js");
const objectsMarkup = objectsList.objectsListMarkup(
  drawingState.objects,
  []
);

check(
  "the parent object has a row",
  objectsMarkup.includes("Heat Transfer Rate 1"),
);

check(
  "the automatic label has NO row, top-level or nested",
  !/Q̇|\\dot\{Q\}|Label|Text 1/.test(objectsMarkup.replace(/Heat Transfer Rate 1/g, "")),
  objectsMarkup,
);

check(
  "the list holds exactly ONE row for one labelled object",
  (objectsMarkup.match(/role="option"/g) || []).length === 1,
  String((objectsMarkup.match(/role="option"/g) || []).length),
);

void listedArrow;

/*
 * A STUDENT'S OWN TEXT IS STILL AN OBJECT. The exclusion is for labels CARRIED
 * by a heat object, never for text the student made with the Text tool.
 */
const ownNote = (() => {
  const annotate = loadModule("annotate-model.js");
  const created = annotate.createAnnotate({ kind: "note", text: "My note" });
  drawingStateModule.default.addObject(drawingState, created);
  return created;
})();

const withNote = objectsList.objectsListMarkup(drawingState.objects, []);

check(
  "a user-created Text object keeps its own row",
  withNote.includes("My note") || withNote.includes("Note"),
);

void ownNote;

/* ---------------------------------------------------------- label placement */

console.log("\nDefault label placement");
console.log("------------------------");

fresh();

/* A horizontal convection boundary decorates one side; the label goes the other. */
const placedBoundary = place(() =>
  model.createThermalBoundary({
    start: point(0, 0),
    end: point(100, 0),
    variant: "convection",
    side: 1,
  })
);

const boundaryOffset = placedBoundary.label.metadata.heatLabelOffset;

check(
  "a boundary's label is offset off the line, not on it",
  Math.abs(boundaryOffset.x) + Math.abs(boundaryOffset.y) > 4,
  JSON.stringify(boundaryOffset),
);

check(
  "it is on the side AWAY from the decorations",
  boundaryOffset.y < 0,
  JSON.stringify(boundaryOffset),
);

const placedArrow = place(() =>
  model.createThermalArrow({
    start: point(0, 0),
    end: point(50, 0),
    variant: "heat-rate",
  })
);

const arrowOffset = placedArrow.label.metadata.heatLabelOffset;

check(
  "an arrow's label sits BESIDE the body, clear of the shaft",
  Math.abs(arrowOffset.y) > 4,
  JSON.stringify(arrowOffset),
);

const placedNode = place(() => model.createCircuitNode({ center: point(0, 0) }));
const nodeOffset = placedNode.label.metadata.heatLabelOffset;

check(
  "a node's label clears the dot rather than covering it",
  Math.hypot(nodeOffset.x, nodeOffset.y) > 4,
  JSON.stringify(nodeOffset),
);

/* ---------------------------------------------------------- Features tab */

console.log("\nFeatures tab structure");
console.log("----------------------");

const schema = loadModule("feature-schema.js");
schema.setPanelObjectLookup(() => drawingState.objects || []);

fresh();

const tabWall = (() => {
  const wall = model.createWallSlab({ start: point(0, 0), end: point(40, 0) });
  drawingStateModule.default.addObject(drawingState, wall);
  return drawingState.objects[0];
})();

check(
  "a Wall / Slab is Object, Appearance, Transform - no Label section",
  schema.groupsFor(tabWall).map((g) => g.id).join(",") ===
    "object,appearance,transform",
  schema.groupsFor(tabWall).map((g) => g.id).join(","),
);

fresh();

const tabArrow = (() => {
  const arrow = model.createThermalArrow({
    start: point(0, 0),
    end: point(40, 0),
    variant: "heat-rate",
  });
  drawingStateModule.default.addObject(drawingState, arrow);
  const stored = drawingState.objects[0];
  const label = labels.createHeatLabel(stored, { objects: drawingState.objects });
  drawingStateModule.default.addObject(drawingState, label);
  return stored;
})();

check(
  "a labelled object is Object, Appearance, LABEL, Transform - in that order",
  schema.groupsFor(tabArrow).map((g) => g.id).join(",") ===
    "object,appearance,label,transform",
  schema.groupsFor(tabArrow).map((g) => g.id).join(","),
);

const tabLabel = drawingState.objects.find(
  (o) => o.type === "annotate" && o.metadata?.heatParentId
);

check(
  "a selected label shows text controls only (no Appearance geometry)",
  schema.groupsFor(tabLabel).map((g) => g.id).join(",") ===
    "object,label,transform",
  schema.groupsFor(tabLabel).map((g) => g.id).join(","),
);

/* ---------------------------------------------------------- rotation */

console.log("\nLabel under rotation");
console.log("--------------------");

fresh();

const rotatedBoundary = place(() =>
  model.createThermalBoundary({
    start: point(0, 0),
    end: point(100, 0),
    variant: "radiation",
    side: 1,
  })
);

const rotLabel = rotatedBoundary.label;
const rotOffset = { ...rotLabel.metadata.heatLabelOffset };

/* Rotate the boundary through 90 degrees about its own start. */
const rotParent = drawingState.objects.find((o) => o.id === rotLabel.metadata.heatParentId);
rotParent.geometry = {
  ...rotParent.geometry,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 100 },
};

labels.reconcileHeatLabels(drawingState.objects);

const afterRotation = drawingState.objects.find((o) => o.id === rotLabel.id);
const rotAnchor = labels.heatParentAnchor(rotParent);

check(
  "a rotated parent still carries its label",
  Math.abs(afterRotation.geometry.position.x - (rotAnchor.x + rotOffset.x)) < 1e-6 &&
    Math.abs(afterRotation.geometry.position.y - (rotAnchor.y + rotOffset.y)) < 1e-6,
  JSON.stringify(afterRotation.geometry.position),
);

check(
  "the label's angle is never stored, so the text stays UPRIGHT",
  afterRotation.rotation === undefined &&
    afterRotation.geometry.rotation === undefined,
);

check(
  "the label keeps its original RELATIVE offset through the rotation",
  Math.abs(afterRotation.metadata.heatLabelOffset.x - rotOffset.x) < 1e-9 &&
    Math.abs(afterRotation.metadata.heatLabelOffset.y - rotOffset.y) < 1e-9,
  JSON.stringify(afterRotation.metadata.heatLabelOffset),
);

/* ---------------------------------------------------------- notation units */

console.log("\nNotation");
console.log("--------");

check(
  "a counted index is written as real subscript characters",
  notation.subscriptIndex(3) === "₃" && notation.subscriptIndex(12) === "₁₂",
);

check(
  "a default is written as MATHEMATICAL MARKUP (T_1), not a pre-composed glyph",
  notation.HEAT_NOTATION_FAMILIES.T.label(1) === "T_1" &&
    notation.HEAT_NOTATION_FAMILIES.Q.label(2) === "\\dot{Q}_2",
  notation.HEAT_NOTATION_FAMILIES.T.label(1),
);

check(
  "the notation parser reads sub, super, grouped and accented scripts",
  (() => {
    const sub = math.parseMathExpression("T_1");
    const grouped = math.parseMathExpression("T_{s,1}");
    const sup = math.parseMathExpression("10^{-3}");
    const accent = math.parseMathExpression("\\dot{Q}");

    return (
      sub.some((r) => r.type === "sub" && r.value === "1") &&
      grouped.some((r) => r.type === "sub" && r.value === "s,1") &&
      sup.some((r) => r.type === "sup" && r.value === "-3") &&
      accent.some((r) => r.type === "accent" && r.value === "Q")
    );
  })(),
);

check(
  "Greek commands render as their symbol",
  math.mathExpressionToPlainText("\\varepsilon_1") === "ε₁" &&
    math.mathExpressionToPlainText("\\alpha") === "α" &&
    math.mathExpressionToPlainText("\\infty") === "∞",
  math.mathExpressionToPlainText("\\varepsilon_1"),
);

check(
  "no raw markup ever reaches the plain-text reading",
  !/[_^\\]/.test(math.mathExpressionToPlainText("q''_{in}")),
  math.mathExpressionToPlainText("q''_{in}"),
);

check(
  "an edited label becomes the student's and stops counting",
  notation.isGeneratedHeatNotation("T", "T_2") === true &&
    notation.isGeneratedHeatNotation("T", "T₂") === true &&
    notation.isGeneratedHeatNotation("T", "T_\\infty") === false &&
    notation.isGeneratedHeatNotation("T", "T_{hot}") === false,
);

check(
  "the counters are per sheet: a fresh sheet starts at 1",
  notation.nextHeatNotationIndex("T", []) === 1,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
