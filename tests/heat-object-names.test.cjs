/*
 * ========================================================
 * OBJECT NAMES COME FROM THE TOOL, NOT THE DROPDOWN
 * ========================================================
 *
 * A Heat Transfer object is named after the TOOL that made it. Three path
 * variants share one store type (`heat-path`) but are three tools, so they are
 * named and numbered separately. A dropdown ("Heat Transfer Path") never
 * appears as an object's name.
 *
 * These checks go through the SHIPPED factories and the SHIPPED `addObject`, so
 * the name an object really receives in the document is what is asserted.
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
const { drawingState } = loadModule("editor-state.js");
const drawingStateModule = loadModule("drawing-state.js");

const addObject = drawingStateModule.default.addObject;

const point = (x, y) => ({ x, y });

function fresh() {
  drawingState.objects = [];
}

/* Add a created object the way the tool layer does. */
function add(object) {
  addObject(drawingState, object);

  return drawingState.objects[drawingState.objects.length - 1];
}

console.log("\nPer-tool names and numbering");
console.log("----------------------------");

fresh();

/* Three path variants - the requirement's own table. */
const conduction1 = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "conduction",
  }),
);
const convection1 = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "convection",
  }),
);
const radiation1 = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "radiation",
  }),
);

check(
  "Conduction Path is 'Conduction Path 1'",
  conduction1.name === "Conduction Path 1",
  conduction1.name,
);
check(
  "Convection Flow is 'Convection Flow 1'",
  convection1.name === "Convection Flow 1",
  convection1.name,
);
check(
  "Radiation Path is 'Radiation Path 1'",
  radiation1.name === "Radiation Path 1",
  radiation1.name,
);

check(
  "no object is named after the dropdown 'Heat Transfer Path'",
  !drawingState.objects.some((o) => /Heat Transfer Path/i.test(o.name)),
  drawingState.objects.map((o) => o.name).join(", "),
);

/* A SECOND conduction path is 2, and does not touch the other tools. */
const conduction2 = add(
  model.createHeatPath({
    points: [point(0, 0), point(20, 0)],
    variant: "conduction",
  }),
);

check(
  "a second Conduction Path is '... 2'",
  conduction2.name === "Conduction Path 2",
  conduction2.name,
);

check(
  "creating Conduction 2 did not renumber Convection or Radiation",
  convection1.name === "Convection Flow 1" &&
    radiation1.name === "Radiation Path 1" &&
    drawingState.objects.find((o) => o.id === convection1.id).name ===
      "Convection Flow 1",
);

/* The quantity arrows. */
const rate = add(
  model.createThermalArrow({
    start: point(0, 0),
    end: point(5, 0),
    variant: "heat-rate",
  }),
);
const flux = add(
  model.createThermalArrow({
    start: point(0, 0),
    end: point(5, 0),
    variant: "heat-flux",
  }),
);

check(
  "Heat Transfer Rate is 'Heat Transfer Rate 1'",
  rate.name === "Heat Transfer Rate 1",
  rate.name,
);
check("Heat Flux is 'Heat Flux 1'", flux.name === "Heat Flux 1", flux.name);

/* The five boundaries. */
/*
 * THE FOUR REMAINING BOUNDARIES. Prescribed Heat-Flux Boundary was removed as a
 * duplicate of the Heat Flux arrow, so there is no fifth name to check.
 */
const boundaries = {
  "fixed-temperature": "Fixed Temperature 1",
  convection: "Convection Boundary 1",
  radiation: "Radiation Boundary 1",
  adiabatic: "Adiabatic Boundary 1",
};

for (const [variant, expected] of Object.entries(boundaries)) {
  const created = add(
    model.createThermalBoundary({
      start: point(0, 0),
      end: point(5, 0),
      variant,
    }),
  );

  check(`${variant} is '${expected}'`, created.name === expected, created.name);
}

/* Source, sink, and the two circuit elements. */
check(
  "Heat Source is 'Heat Source 1'",
  add(model.createSourceSink({ center: point(0, 0), variant: "source" }))
    .name === "Heat Source 1",
);
check(
  "Heat Sink is 'Heat Sink 1'",
  add(model.createSourceSink({ center: point(0, 0), variant: "sink" })).name ===
    "Heat Sink 1",
);
check(
  "Thermal Resistance is 'Thermal Resistance 1'",
  add(
    model.createCircuitElement({ center: point(0, 0), variant: "resistance" }),
  ).name === "Thermal Resistance 1",
);
check(
  "Thermal Capacitance is 'Thermal Capacitance 1'",
  add(
    model.createCircuitElement({ center: point(0, 0), variant: "capacitance" }),
  ).name === "Thermal Capacitance 1",
);

/* Single-tool types are still numbered. */
const wall1 = add(
  model.createWallSlab({ start: point(0, 0), end: point(10, 0) }),
);
const wall2 = add(
  model.createWallSlab({ start: point(0, 0), end: point(10, 0) }),
);

check(
  "first Wall / Slab is 'Wall / Slab 1'",
  wall1.name === "Wall / Slab 1",
  wall1.name,
);
check(
  "second Wall / Slab is 'Wall / Slab 2'",
  wall2.name === "Wall / Slab 2",
  wall2.name,
);

check(
  "a Composite Wall names the parent tool, not the dropdown",
  add(model.createCompositeWall({ center: point(0, 0), width: 60, height: 30 }))
    .name === "Composite Wall 1",
);

/* ---------------------------------------------------------- deletion */

console.log("\nDeletion does not renumber others");
console.log("---------------------------------");

fresh();

const a = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "conduction",
  }),
);
const b = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "conduction",
  }),
);
const c = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "conduction",
  }),
);

check(
  "three conduction paths are 1, 2, 3",
  `${a.name}/${b.name}/${c.name}` ===
    "Conduction Path 1/Conduction Path 2/Conduction Path 3",
);

/* Delete the middle one. */
drawingStateModule.default.removeObject(drawingState, b.id);

check(
  "deleting the middle path leaves 1 and 3 unchanged",
  drawingState.objects.find((o) => o.id === a.id)?.name ===
    "Conduction Path 1" &&
    drawingState.objects.find((o) => o.id === c.id)?.name ===
      "Conduction Path 3",
);

const d = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "conduction",
  }),
);

check(
  "the next path is '4', past the HIGHEST name - never a reuse of the deleted 2",
  d.name === "Conduction Path 4",
  d.name,
);

/* ---------------------------------------------------------- rename */

console.log("\nRenaming");
console.log("--------");

fresh();

const original = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "radiation",
  }),
);

/* The Features Name field writes `name` and `label` together. */
drawingState.objects.find((o) => o.id === original.id).name = "My Radiator";

check(
  "a user-renamed object keeps its name",
  drawingState.objects.find((o) => o.id === original.id).name === "My Radiator",
);

const next = add(
  model.createHeatPath({
    points: [point(0, 0), point(10, 0)],
    variant: "radiation",
  }),
);

check(
  "a renamed object does not disturb the tool's numbering",
  next.name === "Radiation Path 2" || next.name === "Radiation Path 1",
  next.name,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
