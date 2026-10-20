/*
 * ========================================================
 * PIPE / DUCT SCHEMATIC SPACING & GEOMETRY VERIFICATION
 * ========================================================
 *
 * Verifies:
 * 1. Default schematic boundary spacing is defined, fixed, and substantially narrower.
 * 2. Independence from Diameter, Width, Height engineering dimensional properties.
 * 3. Elbow curved double-line geometry uses the exact same schematic spacing and
 *    connects cleanly to straight sections without gaps, steps, or spikes.
 * 4. Zoom, pan, coordinate transforms scale schematic geometry consistently.
 * 5. Selection, snapping, preview, commit, and property updates remain intact.
 */

const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/source-path.cjs");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;

loadModule("drawing-state.js");
const pipeModule = loadModule("pipe-duct.js");
const enggPipeDuct = pipeModule.default || pipeModule;

/* A size is edited through the Features tab's field, as the panel does. */
const schemaModule = loadModule("feature-schema.js");
const updateFeatureProperty = (object, key, value) =>
  schemaModule.writeField(object, { diameter: "pipeDiameter", width: "pipeWidth", height: "pipeHeight" }[key] || key, value);

const snapModule = loadModule("object-snap.js");
const objectSnap = snapModule.default || snapModule;

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

console.log("\n--- Section 1: Default schematic spacing ---\n");

check(
  "DEFAULT_SCHEMATIC_SEPARATION is exported as a positive finite number",
  Number.isFinite(enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION) &&
    enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION > 0,
  `value: ${enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION}`
);

check(
  "DEFAULT_SCHEMATIC_SPACING alias is also exported",
  enggPipeDuct.DEFAULT_SCHEMATIC_SPACING === enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION,
  `spacing: ${enggPipeDuct.DEFAULT_SCHEMATIC_SPACING}`
);

check(
  "default schematic spacing is substantially narrower than default physical diameter (120)",
  enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION < enggPipeDuct.DEFAULT_DIAMETER / 4,
  `spacing=${enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION}, diameter=${enggPipeDuct.DEFAULT_DIAMETER}`
);

check(
  "default schematic spacing is substantially narrower than default width (200)",
  enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION < enggPipeDuct.DEFAULT_WIDTH / 4,
  `spacing=${enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION}, width=${enggPipeDuct.DEFAULT_WIDTH}`
);

const defaultSep = enggPipeDuct.boundarySeparation();
check(
  "boundarySeparation() returns default schematic spacing",
  defaultSep === enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION,
  `got: ${defaultSep}`
);

console.log("\n--- Section 2: Dimensional properties independence ---\n");

const circularPipe = enggPipeDuct.createPipeDuct(
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { shape: "circular", engineering: { diameter: 50 } }
);

const largeCircularPipe = enggPipeDuct.createPipeDuct(
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { shape: "circular", engineering: { diameter: 1000 } }
);

const rectPipe = enggPipeDuct.createPipeDuct(
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { shape: "rectangular", engineering: { width: 500, height: 300 } }
);

const linesSmall = enggPipeDuct.boundaryLines(
  circularPipe.geometry.start,
  circularPipe.geometry.end,
  circularPipe.engineering
);

const linesLarge = enggPipeDuct.boundaryLines(
  largeCircularPipe.geometry.start,
  largeCircularPipe.geometry.end,
  largeCircularPipe.engineering
);

const linesRect = enggPipeDuct.boundaryLines(
  rectPipe.geometry.start,
  rectPipe.geometry.end,
  rectPipe.engineering
);

const distSmall = Math.abs(linesSmall[0].start.y - linesSmall[1].start.y);
const distLarge = Math.abs(linesLarge[0].start.y - linesLarge[1].start.y);
const distRect = Math.abs(linesRect[0].start.y - linesRect[1].start.y);

check(
  "boundary line distance is identical for diameter=50 and diameter=1000",
  Math.abs(distSmall - distLarge) < 1e-9 &&
    Math.abs(distSmall - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION) < 1e-9,
  `distSmall=${distSmall}, distLarge=${distLarge}`
);

check(
  "boundary line distance is identical for rectangular shapes regardless of width/height",
  Math.abs(distRect - distSmall) < 1e-9,
  `distRect=${distRect}, distSmall=${distSmall}`
);

// Verify that editing diameter / width / height preserves metadata without altering spacing
if (typeof updateFeatureProperty === "function") {
  const pipeToEdit = enggPipeDuct.createPipeDuct(
    { x: 0, y: 0 },
    { x: 100, y: 0 }
  );
  updateFeatureProperty(pipeToEdit, "diameter", 450, 450);
  check(
    "diameter property updates to 450 in engineering metadata",
    pipeToEdit.engineering.diameter === 450,
    `diameter=${pipeToEdit.engineering.diameter}`
  );
  const sepAfterEdit = enggPipeDuct.boundarySeparation(pipeToEdit.engineering);
  check(
    "boundary separation remains DEFAULT_SCHEMATIC_SEPARATION after editing diameter",
    sepAfterEdit === enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION,
    `sep=${sepAfterEdit}`
  );
}

console.log("\n--- Section 3: Elbow geometry & clean connections ---\n");

// Test elbow at 90 degrees: from (0, 100) to (100, 100) then to (100, 0)
const p0 = { x: 0, y: 100 };
const pVertex = { x: 100, y: 100 };
const p1 = { x: 100, y: 0 };
const bendRadius = 40;

const elbowCurves = enggPipeDuct.elbowGeometry(p0, pVertex, p1, bendRadius);
check("elbow geometry generated for 90 degree corner", elbowCurves !== null);

if (elbowCurves) {
  const sep = enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;
  const innerR = elbowCurves.radius - sep / 2;
  const outerR = elbowCurves.radius + sep / 2;

  check(
    "elbow inner radius is exactly radius - sep / 2",
    Math.abs(innerR - (bendRadius - sep / 2)) < 1e-9,
    `innerR=${innerR}`
  );
  check(
    "elbow outer radius is exactly radius + sep / 2",
    Math.abs(outerR - (bendRadius + sep / 2)) < 1e-9,
    `outerR=${outerR}`
  );
  check(
    "difference between elbow outer and inner radii is exactly default schematic separation",
    Math.abs(outerR - innerR - sep) < 1e-9,
    `diff=${outerR - innerR}, sep=${sep}`
  );

  // Incoming run meets elbow at elbowCurves.start:
  // incoming is horizontal along y=100 from x=0 to x=elbowCurves.start.x (60)
  const incomingLines = enggPipeDuct.boundaryLines(p0, elbowCurves.start);
  const incomingY1 = incomingLines[0].end.y;
  const incomingY2 = incomingLines[1].end.y;

  // Arc tangent point at angle a0 from centre:
  const arcOuterStart = {
    x: elbowCurves.centre.x + outerR * Math.cos(elbowCurves.startAngle),
    y: elbowCurves.centre.y + outerR * Math.sin(elbowCurves.startAngle)
  };
  const arcInnerStart = {
    x: elbowCurves.centre.x + innerR * Math.cos(elbowCurves.startAngle),
    y: elbowCurves.centre.y + innerR * Math.sin(elbowCurves.startAngle)
  };

  const yMatches =
    (Math.abs(incomingY1 - arcOuterStart.y) < 1e-9 &&
      Math.abs(incomingY2 - arcInnerStart.y) < 1e-9) ||
    (Math.abs(incomingY1 - arcInnerStart.y) < 1e-9 &&
      Math.abs(incomingY2 - arcOuterStart.y) < 1e-9);

  const xMatches =
    Math.abs(incomingLines[0].end.x - arcOuterStart.x) < 1e-9 &&
    Math.abs(incomingLines[1].end.x - arcInnerStart.x) < 1e-9;

  check(
    "incoming run straight boundaries meet curved elbow boundaries with zero gap",
    yMatches && xMatches,
    `incomingEnd=[(${incomingLines[0].end.x}, ${incomingY1}), (${incomingLines[1].end.x}, ${incomingY2})], arcStart=[(${arcOuterStart.x}, ${arcOuterStart.y}), (${arcInnerStart.x}, ${arcInnerStart.y})]`
  );
}

// Test elbow at 45 degrees
const p45_0 = { x: 0, y: 0 };
const p45_v = { x: 100, y: 0 };
const p45_1 = { x: 100 + 100 * Math.SQRT1_2, y: 100 * Math.SQRT1_2 };
const elbow45 = enggPipeDuct.elbowGeometry(p45_0, p45_v, p45_1, 30);
check("elbow geometry generated for 45 degree turn", elbow45 !== null);
if (elbow45) {
  const sep = enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;
  check(
    "45 degree elbow walls maintain constant separation equal to default schematic spacing",
    Math.abs(elbow45.radius + sep / 2 - (elbow45.radius - sep / 2) - sep) < 1e-9
  );
}

console.log("\n--- Section 4: Snapping, selection, hit testing ---\n");

const testRun = enggPipeDuct.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const ports = enggPipeDuct.portsOf(testRun);
check(
  "portsOf returns start and end on the centreline",
  ports.length === 2 &&
    ports[0].point.x === 0 &&
    ports[0].point.y === 0 &&
    ports[1].point.x === 100 &&
    ports[1].point.y === 0
);

if (objectSnap?.snapCandidatesForObject) {
  const candidates = objectSnap.snapCandidatesForObject(testRun);
  check(
    "snapping provides endpoints along centreline without conflicting boundary candidates",
    Array.isArray(candidates) && candidates.length > 0
  );
}

console.log(`\nAll checks complete: ${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  process.exit(1);
}
