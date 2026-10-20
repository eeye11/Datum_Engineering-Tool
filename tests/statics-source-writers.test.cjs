/* eslint-disable no-console */
/*
 * ========================================================
 * STATICS SOURCE GENERATOR - ALL 26 SOURCE-BACKED TOOLS
 * ========================================================
 *
 * The Source tab is only worth having if the code it shows is the code that
 * draws the picture. These tests drive the real `staticsSourceWriter` with
 * objects of every Statics type and check that:
 *
 *   1. The TikZ carries the COMMITTED coordinates, not a placeholder.
 *   2. Appearance chosen in Features reaches the source (colour, thickness,
 *      dash, fill, arrow heads, orientation).
 *   3. The engineering values are the OBJECT'S, and a display length is never
 *      confused with a physical magnitude.
 *   4. Text nodes appear only where the object's own drawing calls for text.
 *   5. The source map associates EVERY command of a multi-element object with
 *      that one object.
 *   6. The standalone export packages the same picture with the libraries and
 *      colour definitions it needs.
 *
 * The writer is pure - it takes an object and returns a string - so it is
 * exercised directly, without a canvas, exactly as the geometry suite does.
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

const { loadModule } = require("./helpers/source-path.cjs");

loadModule("load-profile.js");
loadModule("diagram-equations.js");

const statics = loadModule("statics.js");

const write = (object, options) => statics.serializeStaticsObject(object, options);

/* ============================================================ helpers */

/* The names the model's own `addObject` gives these types. */
const LABELS = {
  beam: "Beam 1",
  force: "Point Force 1",
  load: "Distributed Load 1",
  "varying-load": "Varying Distributed Load 1",
  moment: "Applied Moment 1",
  truss: "Truss 1",
  cable: "Cable 1",
  shaft: "Shaft 1",
  particle: "Particle 1",
  "rigid-body": "Rigid Body 1",
};

function objectOf(type, geometryData, style = {}, extra = {}) {
  return {
    id: `${type}-test`,
    type,
    name: LABELS[type] || `${type} 1`,
    geometry: geometryData,
    style: { stroke: "#193335", lineWidth: 0.75, lineType: "solid", ...style },
    ...extra,
  };
}

const has = (text, fragment) => typeof text === "string" && text.includes(fragment);

const count = (text, pattern) => (String(text || "").match(pattern) || []).length;

/* A \draw or \fill bracket must never contain a \definecolor. */
const preludesAreOutsideBrackets = (text) =>
  !String(text || "")
    .split("\n")
    .some((line) => /\[[^\]]*\\definecolor/.test(line));

/* ========================================================== Selection */

console.log("\nSelection");
console.log("---------");

check("Select is not a source-backed object at all", statics.isStaticsSourceType("select") === false);
check("and a selection type writes nothing", write(objectOf("select", {})) === null);

/* ============================================================= Bodies */

console.log("\nBodies");
console.log("------");

const particle = write(objectOf("particle", { position: { x: 30, y: 40 } }));

check("a particle writes a marker at its committed position", has(particle, "(30,40) circle[radius="), particle);
check("and no automatic label", !has(particle, "\\node"), particle);

const rigid = write(objectOf("rigid-body", { position: { x: 10, y: 60 }, width: 40, height: 20, rotation: 0 }));

check(
  "a rigid body is its stored outline, not a generic rectangle",
  has(rigid, "(10,60)") && has(rigid, "(50,60)") && has(rigid, "(50,80)") && has(rigid, "(10,80)") && has(rigid, "-- cycle"),
  rigid,
);
check("and it carries no automatic text", !has(rigid, "\\node"), rigid);

const turnedBody = write(objectOf("rigid-body", { position: { x: 0, y: 0 }, width: 10, height: 10, rotation: 45 }));

check("a rotated body keeps its rotation in the corners", !has(turnedBody, "(10,0)") && count(turnedBody, /--/g) >= 3, turnedBody);

const beam = write(objectOf("beam", { start: { x: 0, y: 100 }, end: { x: 120, y: 100 }, depth: 12 }));

check("a beam is drawn between its committed endpoints", has(beam, "(0,103)") && has(beam, "(120,103)") && has(beam, "(0,97)"), beam);
check("as a member with depth, closed", has(beam, "-- cycle"), beam);
check("with no automatic label", !has(beam, "\\node"), beam);

const truss = write(
  objectOf("truss", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    members: [
      { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { start: { x: 0, y: 0 }, end: { x: 50, y: 30 } },
      { start: { x: 50, y: 30 }, end: { x: 100, y: 0 } },
    ],
  }),
);

check("a truss writes every stored member", has(truss, "(0,0) -- (100,0)") && has(truss, "(0,0) -- (50,30)"), truss);
check("not as one unrelated line", count(truss, /\\draw/g) >= 3, truss);
check("and every shared joint once", count(truss, /\\fill/g) === 3, truss);

const cable = write(objectOf("cable", { start: { x: 0, y: 0 }, end: { x: 80, y: 0 }, sag: 12 }));

check("a cable follows its stored path", has(cable, ".. controls") && has(cable, "(0,0)") && has(cable, "(80,0)"), cable);

const shaft = write(objectOf("shaft", { start: { x: 0, y: 0 }, end: { x: 90, y: 0 }, diameter: 16 }));

check("a shaft writes its profile", has(shaft, "-- cycle") && has(shaft, "(0,8)") && has(shaft, "(90,8)"), shaft);
check("its end markings", count(shaft, /--/g) >= 5, shaft);
check("and its axis", has(shaft, "dash pattern"), shaft);

/* ===================================================== Point Force */

console.log("\nPoint Force");
console.log("-----------");

const force = write(
  objectOf("force", { start: { x: 20, y: 20 }, end: { x: 20, y: 80 }, position: { x: 20, y: 20 }, magnitude: 60, angle: 90 }),
);

check("a force is an arrow from its application point", has(force, "(20,20) -- (20,80)"), force);
check("with an arrow head at the far end", has(force, "-{Latex}"), force);
check("and its label plus its magnitude, kept apart", has(force, "{Point Force 1}") && has(force, "F = 60"), force);

/*
 * THE VALUE IS THE LABEL, NOT THE LENGTH. A force drawn 30 long stating 500 N
 * is written 30 long; a force with no drawn end (an old file) is written at its
 * magnitude, which is how it looked before arrows kept their drawn length.
 */
const labelledForce = write(
  objectOf("force", { start: { x: 0, y: 0 }, end: { x: 30, y: 0 }, magnitude: 500, angle: 0 }),
);

check("the drawn arrow is written at its drawn length", has(labelledForce, "(0,0) -- (30,0)"), labelledForce);
check("and the value is only its label", has(labelledForce, "F = 500"), labelledForce);

const legacyForce = write(objectOf("force", { start: { x: 0, y: 0 }, magnitude: 60, angle: 0 }));

check("a force with no drawn end is drawn at its magnitude", has(legacyForce, "(0,0) -- (60,0)"), legacyForce);

const hiddenValue = write(
  objectOf("force", { start: { x: 0, y: 0 }, magnitude: 60, angle: 0 }, {}, { annotationDisplay: { showMagnitude: false } }),
);

check("a hidden value leaves the annotation out", !has(hiddenValue, "F = 60"), hiddenValue);
check("but keeps the force's own label", has(hiddenValue, "{Point Force 1}"), hiddenValue);

const renamed = write(objectOf("force", { start: { x: 0, y: 0 }, magnitude: 60, angle: 0 }, {}, { label: "P" }));

check("a custom label replaces the generated one", has(renamed, "{P}"), renamed);

/* ================================================== Distributed Load */

console.log("\nDistributed Load");
console.log("----------------");

const load = write(
  objectOf(
    "load",
    {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      intensity: 5,
      direction: -90,
      interval: 25,
      loadUnit: "kN/m",
      points: [
        { t: 0, magnitude: 5 },
        { t: 1, magnitude: 5 },
      ],
      normalSide: 1,
    },
    {},
  ),
);

check("a load writes its loaded span", has(load, "(0,0) -- (100,0)"), load);
check("a row of arrows standing off the body", count(load, /-{Latex}/g) >= 4, load);
check("its envelope", has(load, "fill=daetumC193335") && has(load, "-- cycle"), load);
check("its label and intensity", has(load, "{Distributed Load 1}") && has(load, "w = 5"), load);

const respaced = write(
  objectOf("load", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    intensity: 5,
    direction: -90,
    interval: 50,
    points: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 5 },
    ],
    normalSide: 1,
  }),
);

check(
  "arrow spacing is a display property: fewer arrows at a wider interval",
  count(respaced, /-{Latex}/g) < count(load, /-{Latex}/g),
  `${count(respaced, /-{Latex}/g)} vs ${count(load, /-{Latex}/g)}`,
);
check("and the intensity it states is unchanged", has(respaced, "w = 5"), respaced);

/* ========================================== Varying Distributed Load */

console.log("\nVarying Distributed Load");
console.log("------------------------");

const varying = write(
  objectOf("varying-load", {
    start: { x: 0, y: 0 },
    end: { x: 90, y: 0 },
    startIntensity: 0,
    endIntensity: 8,
    direction: -90,
    interval: 15,
    loadUnit: "kN/m",
    points: [
      { t: 0, magnitude: 0 },
      { t: 1, magnitude: 8 },
    ],
    normalSide: 1,
  }),
);

check(
  "a triangular load tapers from zero",
  varying.split("\n").some((line) => /-- \(90,-8\)/.test(line)),
  varying,
);
check("and its taper is a real envelope", has(varying, "-- cycle"), varying);
check("with both end intensities stated", has(varying, "{$0\\ kN/m$}") && has(varying, "{$8\\ kN/m$}"), varying);

const trapezoid = write(
  objectOf("varying-load", {
    start: { x: 0, y: 0 },
    end: { x: 9, y: 0 },
    startIntensity: 2,
    endIntensity: 8,
    direction: -90,
    interval: 45,
    points: [
      { t: 0, magnitude: 2 },
      { t: 1, magnitude: 8 },
    ],
    normalSide: 1,
  }),
);

const arrowLengths = (text) => [...String(text).matchAll(/\(([-\d.]+),([-\d.]+)\) -- \(([-\d.]+),([-\d.]+)\)/g)]
  .map((match) => Math.abs(Number(match[4]) - Number(match[2])))
  .filter((length) => length > 0);

const lengths = arrowLengths(trapezoid);

check(
  "a trapezoidal load has a short first arrow and a long last one",
  lengths.length >= 2 && lengths[0] < lengths[lengths.length - 1],
  lengths.join(", "),
);

/* ============================================================ Moment */

console.log("\nMoment");
console.log("------");

const moment = write(objectOf("moment", { position: { x: 40, y: 40 }, magnitude: 10, direction: "CCW", unit: "N\\cdot m" }));

check("a moment is a curved arrow", has(moment, "arc[start angle=") && has(moment, "radius="), moment);
check("at its application point", has(moment, "(40,40) circle[radius=0.6]"), moment);
check("its label and magnitude", has(moment, "{Applied Moment 1}") && has(moment, "M = 10"), moment);

const clockwise = write(objectOf("moment", { position: { x: 0, y: 0 }, magnitude: 10, direction: "CW" }));

check("reversing the sense reverses the sweep", (() => {
  const start = Number((clockwise.match(/start angle=([-\d.]+)/) || [])[1]);
  const end = Number((clockwise.match(/end angle=([-\d.]+)/) || [])[1]);

  return end < start;
})(), clockwise);

const small = write(objectOf("moment", { position: { x: 0, y: 0 }, magnitude: 5, direction: "CCW" }));
const big = write(objectOf("moment", { position: { x: 0, y: 0 }, magnitude: 500, direction: "CCW" }));

check(
  "the drawn radius does not follow the magnitude",
  (small.match(/radius=([\d.]+)/) || [])[1] === (big.match(/radius=([\d.]+)/) || [])[1],
  `${(small.match(/radius=([\d.]+)/) || [])[1]} vs ${(big.match(/radius=([\d.]+)/) || [])[1]}`,
);

/* =========================================================== Supports */

console.log("\nSupports");
console.log("--------");

const pin = write(objectOf("pin-support", { position: { x: 50, y: 0 }, orientation: Math.PI / 2, flipped: false }));
const roller = write(objectOf("roller-support", { position: { x: 50, y: 0 }, orientation: Math.PI / 2, flipped: false }));
const fixed = write(objectOf("fixed-support", { position: { x: 0, y: 0 }, orientation: Math.PI / 2, flipped: false }));
const smooth = write(objectOf("smooth-support", { position: { x: 50, y: 0 }, orientation: Math.PI / 2, flipped: false }));

check("a pin support is a triangle on its ground line", has(pin, "-- cycle") && has(pin, "line width=0.35pt"), pin);
check("a roller support adds its two rollers", count(roller, /circle\[radius=1.5\]/g) === 2, roller);
check("a fixed support is a wall with hatching", has(fixed, "line width=0.35pt") && !has(fixed, "-- cycle"), fixed);
check("a smooth support is a rounded contact", has(smooth, "circle[radius=2]"), smooth);
check("the four symbols are genuinely different", new Set([pin, roller, fixed, smooth]).size === 4);
check("and none carries an automatic label", ![pin, roller, fixed, smooth].some((text) => has(text, "\\node")));

const pinVertical = write(objectOf("pin-support", { position: { x: 50, y: 0 }, orientation: 0, flipped: false }));

check("orientation turns the symbol", pin !== pinVertical, `${pin}\n---\n${pinVertical}`);

/* ========================================================= Connections */

console.log("\nConnections");
console.log("-----------");

const pinJoint = write(objectOf("pin-connection", { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } }));
const fixedJoint = write(objectOf("fixed-connection", { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } }));
const sliderJoint = write(objectOf("slider-connection", { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } }));

check("a pin connection is a joint circle at its anchor", has(pinJoint, "(10,10) circle[radius=2]"), pinJoint);
check("a fixed connection is a rigid block", has(fixedJoint, "-- cycle") && has(fixedJoint, "(6,6)") && has(fixedJoint, "(14,14)"), fixedJoint);
check("a slider connection has its slot and its block", count(sliderJoint, /--/g) >= 6, sliderJoint);
check("the three are distinct", new Set([pinJoint, fixedJoint, sliderJoint]).size === 3);
check("and none carries an automatic label", ![pinJoint, fixedJoint, sliderJoint].some((text) => has(text, "\\node")));

/* =========================================================== Analysis */

console.log("\nAnalysis");
console.log("--------");

const resultant = write(
  objectOf("resultant", { start: { x: 0, y: 0 }, end: { x: 30, y: 40 }, magnitude: 50, angle: 53.13, forceX: 30, forceY: 40 }),
);

check("a resultant is its calculated arrow", has(resultant, "(0,0) -- (30,40)"), resultant);
check("with its label and magnitude", has(resultant, "{R}") && has(resultant, "R = 50"), resultant);

const components = write(
  objectOf("force-components", {
    position: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
    end: { x: 30, y: 40 },
    horizontal: { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
    vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 40 } },
    forceX: 30,
    forceY: 40,
  }),
);

check("force components write both component arrows", has(components, "(0,0) -- (30,0)") && has(components, "(0,0) -- (0,40)"), components);
check("and the closing decomposition line", has(components, "(30,0) -- (0,40)") && has(components, "dashed"), components);
check("with their labels and values", has(components, "F_x") && has(components, "F_y"), components);

const sfd = write(
  objectOf(
    "analysis-diagram",
    {
      start: { x: 0, y: -120 },
      end: { x: 100, y: -120 },
      diagramType: "sfd",
      mode: "plot",
      localRange: { from: 0, to: 5 },
      expressions: [
        { id: "e1", relationType: "functionX", visible: true, expression: "10 - 2x", xRange: { start: 0, end: 5 } },
        { id: "e2", relationType: "verticalLine", visible: true, x: 5, yRange: { start: 0, end: -5 } },
      ],
    },
  ),
);

check("an SFD writes its zero axis", has(sfd, "(0,-120) -- (100,-120)"), sfd);
check("and the calculated curve", count(sfd, /\\draw/g) >= 3, sfd);
/* Units are set in maths mode, so a BMD's `N\cdot m` compiles too. */
check(
  "with the diagram's title and axes",
  has(sfd, "{SFD}") && has(sfd, "$V$ ($\\mathrm{N}$)") && has(sfd, "$x$ ($\\mathrm{m}$)"),
  sfd,
);

const emptyPlot = write(
  objectOf("analysis-diagram", {
    start: { x: 0, y: -120 },
    end: { x: 100, y: -120 },
    diagramType: "bmd",
    mode: "plot",
    localRange: { from: 0, to: 5 },
    expressions: [],
  }),
);

check("an empty BMD plots no curve at all", !has(emptyPlot, "line width=1.1pt"), emptyPlot);

const orphan = write(
  objectOf("analysis-diagram", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    diagramType: "afd",
  }, {}, { engineering: { unresolved: true } }),
);

check("an orphaned diagram writes nothing", orphan === null, orphan);

/* ========================================================== Reference */

console.log("\nReference");
console.log("---------");

const system = write(
  objectOf("coordinate-system-2d", {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
    xLabel: "x",
    yLabel: "y",
    originLabel: "O",
  }),
);

check("a coordinate system writes both arms", has(system, "(-20,0) -- (20,0)") && has(system, "(0,-20) -- (0,20)"), system);
check("with their names", has(system, "{x}") && has(system, "{y}") && has(system, "{O}"), system);

const rotatedSystem = write(
  objectOf("coordinate-system-2d", {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
    rotation: Math.PI / 2,
  }),
);

check("a rotated system keeps the two arms square", has(rotatedSystem, "(0,-20) -- (0,20)") || has(rotatedSystem, "(0,20) -- (0,-20)"), rotatedSystem);

const unlabelledSystem = write(
  objectOf("coordinate-system-2d", {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
    showLabels: false,
  }),
);

check("hiding the labels omits the nodes", !has(unlabelledSystem, "\\node"), unlabelledSystem);

const referencePoint = write(objectOf("point", { position: { x: 5, y: 6 } }));

check("a reference point is a marker and a named coordinate", has(referencePoint, "(5,6) circle[radius=") && has(referencePoint, "\\coordinate"), referencePoint);
check("with no label", !has(referencePoint, "\\node"), referencePoint);

const referenceLine = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 30, y: 40 } }, { lineType: "construction" }));

check("a reference line runs between its endpoints", has(referenceLine, "(0,0) -- (30,40)"), referenceLine);
check("in its own style", has(referenceLine, "dash pattern"), referenceLine);

/* Stored in radians, as every arc is; written in degrees. */
const referenceArc = write(objectOf("arc", { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2 }));

check("a reference arc writes its own radius and sweep", has(referenceArc, "radius=10") && has(referenceArc, "start angle=0") && has(referenceArc, "end angle=90"), referenceArc);

/* ======================================================= Colours */

console.log("\nColours");
console.log("-------");

const redBeam = write(objectOf("beam", { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { stroke: "#FF0000", lineWidth: "thick" }));

check("a hex colour becomes a named definition", has(redBeam, "\\definecolor{daetumCFF0000}{RGB}{255,0,0}"), redBeam);
check("used by the path", has(redBeam, "draw=daetumCFF0000"), redBeam);
check("and a named thickness becomes a pen width", has(redBeam, "line width="), redBeam);
check("with no definition inside an option list", preludesAreOutsideBrackets(redBeam), redBeam);

const filledBody = write(
  objectOf("rigid-body", { position: { x: 0, y: 0 }, width: 10, height: 10, rotation: 0 }, { fillMode: "solid", fill: "#00FF00" }),
);

check("a solid fill reaches the source", has(filledBody, "fill=daetumC00FF00"), filledBody);

const allObjects = [
  particle,
  rigid,
  beam,
  truss,
  cable,
  shaft,
  force,
  load,
  varying,
  moment,
  pin,
  roller,
  fixed,
  smooth,
  pinJoint,
  fixedJoint,
  sliderJoint,
  resultant,
  components,
  sfd,
  system,
  referencePoint,
  referenceLine,
  referenceArc,
];

check("every generated command is well-formed (no color in an option bracket)", allObjects.every(preludesAreOutsideBrackets));

/* ==================================================== Source map */

console.log("\nSource map");
console.log("----------");

const drawing = statics.generateStaticsTikzWithSourceMap([
  objectOf("beam", { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, {}, { id: "beam-a" }),
  objectOf("shaft", { start: { x: 0, y: -30 }, end: { x: 100, y: -30 }, diameter: 12 }, {}, { id: "shaft-b" }),
  objectOf("truss", { start: { x: 0, y: 50 }, end: { x: 100, y: 50 }, panels: 3 }, {}, { id: "truss-c" }),
]);

check("the map holds every object", drawing.map.ids().join(",") === "beam-a,shaft-b,truss-c", drawing.map.ids().join(","));

const shaftRegion = drawing.map.region("shaft-b");
const shaftLines = drawing.source.split("\n").slice(shaftRegion.bodyStartLine, shaftRegion.bodyEndLine + 1);

check(
  "a multi-command object maps ALL of its commands",
  shaftLines.filter((line) => line.includes("\\draw") || line.includes("\\definecolor")).length >= 4,
  `${shaftLines.filter((line) => line.includes("\\draw")).length} commands`,
);
check(
  "and none of another object's",
  !shaftLines.some((line) => line.includes("(0,0) -- (100,0)")),
  shaftLines.join("\n"),
);

const trussRegion = drawing.map.region("truss-c");
const trussLines = drawing.source.split("\n").slice(trussRegion.bodyStartLine, trussRegion.bodyEndLine + 1);

check(
  "a truss maps every member and joint",
  trussLines.filter((line) => line.includes("\\draw") || line.includes("\\fill")).length >= 8,
  trussLines.join("\n"),
);

check("the block list keeps every object", drawing.blocks.length === 3);

/* =================================================== Objects deleted */

console.log("\nDeleting an object");
console.log("------------------");

const withTwo = statics.generateStaticsTikz([
  objectOf("beam", { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, {}, { id: "beam-a" }),
  objectOf("force", { start: { x: 0, y: 10 }, magnitude: 20, angle: 90 }, {}, { id: "force-b" }),
]);

const forcesOnly = statics.generateStaticsTikz([
  objectOf("force", { start: { x: 0, y: 10 }, magnitude: 20, angle: 90 }, {}, { id: "force-b" }),
]);

check("a deleted object's source is gone", !has(forcesOnly, "beam-a"), forcesOnly);
check("and the surviving object is untouched", has(withTwo, "force-b") && has(forcesOnly, "force-b"));
check("including its text node", has(forcesOnly, "F = 20"), forcesOnly);

/* ================================================ Standalone export */

console.log("\nStandalone export");
console.log("-----------------");

check("every listed object produced source", allObjects.every((text) => typeof text === "string" && text.length > 0), allObjects.map((text) => text === null).join(","));

/*
 * DAETUM's default ink. It is the colour an object gets when the theme has
 * not been asked for anything else, and the standalone document must declare
 * it exactly once - however many objects use it.
 */

const source = statics.generateStaticsTikz([
  objectOf("beam", { start: { x: 0, y: 100 }, end: { x: 120, y: 100 }, depth: 12 }, {}, { id: "exported-beam" }),
  objectOf("force", { start: { x: 0, y: 0 }, magnitude: 20, angle: 90 }, {}, { id: "exported-force" }),
]);

const standalone = statics.wrapAsStandaloneTex(source);

check("the document uses the standalone class", has(standalone, "\\documentclass[tikz, border=5mm]{standalone}"));
check("it loads tikz and arrows.meta", has(standalone, "\\usepackage{tikz}") && has(standalone, "arrows.meta"));
check("it declares the colours it uses", has(standalone, "\\definecolor{daetumC193335}{RGB}{25,51,53}"), standalone.slice(0, 400));
check("and it has document boundaries", has(standalone, "\\begin{document}") && has(standalone, "\\end{document}"));
check(
  "with the picture unchanged inside",
  has(standalone, "(0,103)") && has(standalone, "(120,103)") && has(standalone, "% DAETUM_OBJECT_BEGIN id=\"exported-beam\""),
  standalone.slice(0, 1200),
);
check(
  "the preamble declares a colour once, not once per object that uses it",
  standalone.split("\\begin{document}")[0].split("\\definecolor{daetumC193335}{RGB}").length - 1 === 1,
  String(standalone.split("\\begin{document}")[0].split("\\definecolor{daetumC193335}").length - 1),
);

/* =========================================================== Wiring */

console.log("\nWiring");
console.log("------");

check("the writer type table covers every Statics source type", statics.STATICS_SOURCE_TYPES.length >= 26);
check("and it does not claim the Select tool", !statics.isStaticsSourceType("select"));
check("an unknown type writes nothing", write(objectOf("not-a-statics-type", {})) === null);
check("a missing object writes nothing", write(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
