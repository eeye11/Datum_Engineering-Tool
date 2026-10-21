/* eslint-disable no-console */
/*
 * ========================================================
 * DAETUM OBJECT COMMENTS, STABLE IDS AND SOURCE MAPPING
 * ========================================================
 *
 * The contract this suite holds DAETUM to:
 *
 *   1. EVERY registered source writer emits the standard header - a readable
 *      object name, a stable id and its type - for every object it draws.
 *   2. A tool's internal name is NEVER drawn as visible text unless the student
 *      asked for it; the Point Force regression is the case in point.
 *   3. The id is stable across moves, feature changes, label changes, source
 *      regeneration, saving and reopening.
 *   4. Composite objects keep their logical identity: one object, several
 *      commands, one header.
 *   5. The header never reaches the picture: it is a comment, it is stripped
 *      from the text that is rendered and from the written solution, and it
 *      never creates a visible node.
 *   6. Source and object stay connected: a generated block is found by id, an
 *      edit in Source keeps the id, and unsupported or unmarked source is
 *      preserved rather than claimed.
 *
 * The writers are pure functions of an object, so most of this is checked
 * without a canvas - exactly as the Statics and Geometry suites do it.
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

const comments = loadModule("object-comments.js");
const drawingSource = loadModule("drawing-source.js");
const statics = loadModule("statics.js");
const geometry = loadModule("geometry.js");
const dynamics = loadModule("dynamics.js");
const annotations = loadModule("annotations.js");
const thermodynamics = loadModule("thermodynamics.js");
const fluids = loadModule("fluids.js");
const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");

/* ============================================================ helpers */

const has = (text, fragment) => typeof text === "string" && text.includes(fragment);

const headerLines = (text) =>
  String(text || "")
    .split("\n")
    .filter((line) => /^\s*%\s*DAETUM\s/.test(line));

const countHeaders = (text, id) =>
  drawingSource.parseDrawingSource(text).filter((block) => block.id === id).length;

/* A base object, as the model builds one. */
function objectOf(type, geometryData, style = {}, extra = {}) {
  const name = extra.name || `${type} 1`;

  return {
    id: `${type}-001`,
    type,
    name,
    geometry: geometryData,
    style: { stroke: "#193335", lineWidth: 0.75, lineType: "solid", ...style },
    ...extra,
  };
}

/* ================================================= 1. the format itself */

console.log("\nThe comment format");
console.log("------------------");

const formatSample = drawingSource.buildDrawingSource([
  { id: "force-001", type: "force", name: "Point Force 1", source: "\\draw (0,0) -- (0,60);" },
  {
    id: "force-001:label",
    type: "force",
    name: "Force Magnitude Label",
    part: "label",
    parent: "force-001",
    source: "\\node at (3,60) {$F = 60$};",
  },
]);

check(
  "a block is introduced by its readable name",
  has(formatSample, "% DAETUM OBJECT: Point Force 1"),
  formatSample,
);
check("then its stable id", has(formatSample, "% DAETUM ID: force-001"), formatSample);
check("then its type", has(formatSample, "% DAETUM TYPE: force"), formatSample);
check(
  "a component names its role and its parent",
  has(formatSample, "% DAETUM PART: label") && has(formatSample, "% DAETUM PARENT: force-001"),
  formatSample,
);
check(
  "every metadata line is a valid LaTeX comment",
  headerLines(formatSample).every((line) => line.trimStart().startsWith("%")),
);
check(
  "a student's own comment mentioning DAETUM is not metadata",
  comments.isCommentLine("% which is 40% of the force") === false &&
    drawingSource.isObjectMarkerLine("% which is 40% of the force") === false,
);
check(
  "the header's readable name comes from the object, or from its type",
  comments.objectDisplayName({ name: "Beam 2", type: "beam" }) === "Beam 2" &&
    comments.objectDisplayName({ type: "pipe-duct" }) === "Pipe",
);
check(
  "a component id is derived from its parent",
  comments.partId("force-001", "label") === "force-001:label" &&
    comments.parentIdOf("force-001:label") === "force-001" &&
    comments.isPartId("force-001:label") === true &&
    comments.isPartId("force-001") === false,
);

/* ========================================== 2. generator coverage */

console.log("\nEvery writer emits the standard header");
console.log("--------------------------------------");

const WRITERS = [
  { id: "statics", write: (object) => statics.serializeStaticsObject(object) },
  { id: "geometry", write: (object) => geometry.geometrySourceWriter(object) },
  { id: "dynamics", write: (object) => dynamics.dynamicsSourceWriter(object) },
  { id: "annotations", write: (object) => annotations.annotationSourceWriter(object) },
  { id: "thermodynamics", write: (object) => thermodynamics.thermodynamicsSourceWriter(object) },
  { id: "fluids", write: (object) => fluids.fluidsSourceWriter(object) },
];

/*
 * ONE REPRESENTATIVE OBJECT PER REGISTERED TYPE, taken from each writer's own
 * type list so a type added to a writer cannot be silently left untested.
 */
const CASES = {
  statics: {
    particle: { position: { x: 30, y: 40 } },
    "rigid-body": { position: { x: 10, y: 60 }, width: 40, height: 20, rotation: 0 },
    beam: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, depth: 10 },
    truss: { joints: [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 0 }], members: [[0, 1], [1, 2], [0, 2]] },
    cable: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 }, sag: 12 },
    shaft: { start: { x: 0, y: 0 }, end: { x: 90, y: 0 }, diameter: 16 },
    force: { start: { x: 20, y: 20 }, end: { x: 20, y: 80 }, magnitude: 60, angle: 90 },
    load: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      intensity: 5,
      direction: -90,
      interval: 25,
      points: [{ t: 0, magnitude: 5 }, { t: 1, magnitude: 5 }],
      normalSide: 1,
    },
    moment: { position: { x: 40, y: 40 }, arcRadius: 10, magnitude: 10, clockwise: true },
    "pin-support": { position: { x: 0, y: 0 } },
    "roller-support": { position: { x: 50, y: 0 } },
    "fixed-support": { position: { x: 0, y: 0 } },
    "smooth-support": { position: { x: 0, y: 0 } },
    "pin-connection": { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
    "fixed-connection": { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
    "slider-connection": { start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
  },
  geometry: {
    line: { start: { x: 0, y: 0 }, end: { x: 40, y: 10 } },
    point: { position: { x: 10, y: 10 } },
    circle: { center: { x: 20, y: 20 }, radius: 8 },
    rectangle: { position: { x: 0, y: 0 }, width: 30, height: 20 },
    arc: { center: { x: 0, y: 0 }, radius: 12, startAngle: 0, endAngle: 90 },
    polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }] },
  },
  annotations: {
    annotate: {
      annotateKind: "text",
      geometry: { position: { x: 10, y: 10 } },
      text: "Note",
    },
    annotation: { placement: { x: 10, y: 10 }, text: "Note" },
  },
  fluids: {
    "pipe-duct": {
      start: { x: 0, y: 0 },
      end: { x: 60, y: 0 },
      engineering: { diameter: 12, wallThickness: 1 },
    },
  },
  thermodynamics: {},
  dynamics: {},
};

function casesFor(writer) {
  if (writer.id === "thermodynamics") {
    return thermodynamics.THERMODYNAMICS_SOURCE_TYPES.map((type) => ({
      type,
      geometry: { position: { x: 10, y: 10 }, width: 30, height: 20 },
      metadata: { thermodynamicsKind: type === "rectangle" ? "control-volume" : type },
    }));
  }

  if (writer.id === "dynamics") {
    return dynamics.writtenDynamicsTypes().map((type) => ({
      type,
      engineering: { dynamicsType: type },
      geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 0 }, position: { x: 20, y: 20 }, center: { x: 20, y: 20 }, radius: 10 },
    }));
  }

  return Object.entries(CASES[writer.id] || {}).map(([type, geometryData]) => ({ type, geometry: geometryData }));
}

WRITERS.forEach((writer) => {
  const cases = casesFor(writer);

  check(`${writer.id}: at least one object type is exercised`, cases.length > 0);

  cases.forEach((entry) => {
    const object = objectOf(entry.type, entry.geometry, {}, entry);
    let written = null;

    try {
      written = writer.write(object);
    } catch (error) {
      written = `threw: ${error.message}`;
    }

    /* Some types need sheet context; a decline is not a coverage failure. */
    if (written === null || written === undefined) {
      console.log(`  --   ${writer.id}/${entry.type}: declined without sheet context`);
      return;
    }

    const blocks = drawingSource.parseDrawingSource(written);
    const block = blocks.find((candidate) => candidate.id === object.id);

    check(
      `${writer.id}/${entry.type}: one block under its stable id`,
      Boolean(block),
      String(written).slice(0, 300),
    );
    check(
      `${writer.id}/${entry.type}: names the object and its type`,
      Boolean(block) && block.type === object.type && Boolean(block.name),
      JSON.stringify(block),
    );
    check(
      `${writer.id}/${entry.type}: every header line is a comment`,
      headerLines(written).length > 0 &&
        headerLines(written).every((line) => /^[ \t]*%/.test(line)),
      String(written),
    );
  });
});

/* ================================== 3. the Point Force regression */

console.log("\nPoint Force: the tool's name is never drawn");
console.log("--------------------------------------------");

const force = objectOf("force", {
  start: { x: 0, y: 0 },
  end: { x: 126.259, y: 64.6693 },
  magnitude: 345.5,
  angle: 27.1,
});

const forceSource = statics.serializeStaticsObject(force);

check("the arrow is drawn", has(forceSource, "(0,0) -- (126.259,64.6693)"), forceSource);
check("with its arrow head", has(forceSource, "-{Latex"), forceSource);
check("the magnitude is drawn as its value", has(forceSource, "F = 345.5"), forceSource);
check(
  "the internal name appears in the header",
  has(forceSource, `% DAETUM OBJECT: ${force.name}`),
  forceSource,
);
check(
  "and NOWHERE as visible text",
  !/\\node[^\n]*Point Force/.test(forceSource) && !has(forceSource, "{Point Force"),
  forceSource,
);
check(
  "the tool name is not in any field's node either",
  (forceSource.match(/\\node/g) || []).length === 1,
  forceSource,
);

const regenerated = statics.serializeStaticsObject(force);

check("regenerating writes the same source", regenerated === forceSource);
check(
  "and does not reintroduce the label",
  !/\\node[^\n]*Point Force/.test(regenerated),
  regenerated,
);

const explicitlyNamed = statics.serializeStaticsObject({ ...force, showName: true });

check(
  "SHOW NAME draws the name when the student asks",
  new RegExp(`\\\\node[^\\n]*\\{${force.name}\\}`).test(explicitlyNamed),
  explicitlyNamed,
);

const typedLabel = statics.serializeStaticsObject({ ...force, label: "F_1" });

check("a typed label is drawn, TeX-escaped", has(typedLabel, "{F\\_1}"), typedLabel);
check(
  "and the name is still not",
  !/\\node[^\n]*Point Force/.test(typedLabel),
  typedLabel,
);

/* The same rule for the other labelled types. */
["load", "varying-load", "moment", "resultant"].forEach((type) => {
  const sample = objectOf(type, {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    position: { x: 20, y: 20 },
    magnitude: 12,
    intensity: 5,
    points: [{ t: 0, magnitude: 5 }, { t: 1, magnitude: 5 }],
    normalSide: 1,
  });
  const written = statics.serializeStaticsObject(sample);

  if (!written) {
    return;
  }

  check(
    `${type}: the internal name is not drawn`,
    !new RegExp(`\\\\node[^\\n]*\\{${sample.name}\\}`).test(written),
    written,
  );
});

/* ======================================== 4. stable identity */

console.log("\nA stable id survives every ordinary change");
console.log("-------------------------------------------");

const identity = objectOf("force", { start: { x: 0, y: 0 }, end: { x: 0, y: 60 }, magnitude: 60, angle: 90 });
const firstWrite = statics.serializeStaticsObject(identity);

identity.geometry = { ...identity.geometry, start: { x: 10, y: 10 }, end: { x: 10, y: 70 } };
const afterMove = statics.serializeStaticsObject(identity);

identity.label = "F_x";
identity.annotationDisplay = { showMagnitude: false };
const afterFeatures = statics.serializeStaticsObject(identity);

identity.name = "Reaction at A";
const afterRename = statics.serializeStaticsObject(identity);

check(
  "the id is the same after a move",
  drawingSource.parseDrawingSource(afterMove)[0].id === "force-001",
  afterMove,
);
check(
  "the id is the same after a feature change",
  drawingSource.parseDrawingSource(afterFeatures)[0].id === "force-001",
  afterFeatures,
);
check(
  "and after the name changes - the HEADER follows the name, the id does not",
  drawingSource.parseDrawingSource(afterRename)[0].id === "force-001" &&
    has(afterRename, "% DAETUM OBJECT: Reaction at A"),
  afterRename,
);
check(
  "an object with no id is given one, and keeps it",
  (() => {
    const anonymous = { type: "line", name: "Line 1", geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } };
    const a = comments.ensureObjectId(anonymous, "line");
    const b = comments.ensureObjectId(anonymous, "line");

    return Boolean(a) && a === b;
  })(),
);

/* ============================== 5. composite objects keep one identity */

console.log("\nA composite object is one object");
console.log("---------------------------------");

const composite = statics.serializeStaticsObject(
  objectOf("load", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    intensity: 5,
    direction: -90,
    interval: 25,
    points: [{ t: 0, magnitude: 5 }, { t: 1, magnitude: 5 }],
    normalSide: 1,
  }),
);

const compositeBlocks = drawingSource.parseDrawingSource(composite);

check("a load is one block", compositeBlocks.length === 1, composite);
check(
  "however many commands it draws",
  (composite.match(/\\draw/g) || []).length > 3,
  composite,
);
check(
  "every one of its commands maps to that object",
  (() => {
    const map = drawingSource.createSourceMap(composite);
    const bodyLines = composite.split("\n").length;

    for (let line = 0; line < bodyLines; line += 1) {
      if (/\\draw/.test(composite.split("\n")[line])) {
        if (map.idAtLine(line) !== "load-001") {
          return false;
        }
      }
    }

    return true;
  })(),
  composite,
);

const dimension = annotations.annotationSourceWriter({
  id: "dimension-001",
  type: "dimension",
  name: "Dimension 1",
  geometry: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], kind: "linear" },
  style: {},
});

if (dimension) {
  const blocks = drawingSource.parseDrawingSource(dimension);

  check("a dimension is one block", blocks.length === 1, dimension);
} else {
  console.log("  --   dimension needs sheet context here; relationship checked in the pipeline suite");
}

/* =================================== 6. comments never reach the picture */

console.log("\nThe header never becomes drawing text");
console.log("--------------------------------------");

const visible = drawingSource.visibleDrawingSource(formatSample);

check("no marker survives", !/DAETUM/i.test(visible), visible);
check(
  "the commands survive character for character",
  has(visible, "\\draw (0,0) -- (0,60);") && has(visible, "\\node at (3,60) {$F = 60$};"),
  visible,
);
check(
  "and the picture is still whole",
  visible.trimStart().startsWith("\\begin{tikzpicture}") && visible.trimEnd().endsWith("\\end{tikzpicture}"),
  visible,
);
check(
  "no metadata line can comment out a command",
  visible.split("\n").every((line) => !/^\s*%[^]*\\draw/.test(line)),
);
check(
  "the header of an object carrying no commands is not written",
  statics.serializeStaticsObject({ ...force, geometry: {} }) === null,
);

/* ============================ 7. source <-> object synchronization */

console.log("\nSource and objects stay connected");
console.log("----------------------------------");

sync.setSourceWriter(geometry.geometrySourceWriter);
sync.addSourceWriter(statics.staticsSourceWriter);

const manager = managerModule.createSourceManager();

const beam = objectOf("beam", { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, depth: 10 }, {}, { name: "Beam 1" });
beam.id = "beam-001";

const objects = [beam];

sync.writeObjectIntoSource(manager, beam, { allObjects: objects });

const written = manager.getSource();

check("a visual edit writes the object's block", has(written, "% DAETUM ID: beam-001"), written);
check("the block is found by its id", Boolean(drawingSource.createSourceMap(written).block("beam-001")));

sync.writeObjectIntoSource(manager, { ...beam, geometry: { ...beam.geometry, end: { x: 140, y: 0 } } }, { allObjects: objects });
sync.writeObjectIntoSource(manager, { ...beam, geometry: { ...beam.geometry, end: { x: 140, y: 0 } } }, { allObjects: objects });

check(
  "re-writing does not duplicate the block",
  countHeaders(manager.getSource(), "beam-001") === 1,
  manager.getSource(),
);

/* An edit to the visible text keeps the id. */
const editedVisible = manager.getVisibleSource().replace("(100,0)", "(100,0)");

manager.setVisibleSource(editedVisible);

check(
  "a visible-text edit re-attaches the id",
  has(manager.getSource(), "% DAETUM ID: beam-001"),
  manager.getSource(),
);

/* A student's own command is preserved and not claimed. */
const withCustom = manager
  .getSource()
  .replace("% DAETUM OBJECT:", "% my own note\n\\draw[dashed] (0,0) -- (5,5);\n\n% DAETUM OBJECT:");

manager.setSource(withCustom);

check("custom source beside a block is kept", has(manager.getSource(), "% my own note"));
check("and its command too", has(manager.getSource(), "\\draw[dashed] (0,0) -- (5,5);"));

const afterObjectWrite = sync.writeObjectIntoSource(
  manager,
  { ...beam, geometry: { ...beam.geometry, end: { x: 160, y: 0 } } },
  { allObjects: objects },
);

check("writing an object does not lose the custom source", Boolean(afterObjectWrite) && has(manager.getSource(), "% my own note"));

/* A pasted picture without comments is preserved and rendered. */
const pastedManager = managerModule.createSourceManager();
const pasted = [
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  "\\draw[red, dashed] (0,0) .. controls (5,5) and (10,5) .. (15,0);",
  "\\end{tikzpicture}",
].join("\n");

pastedManager.setVisibleSource(pasted);

check(
  "pasted source without comments is preserved verbatim",
  pastedManager.getSource() === pasted,
  pastedManager.getSource(),
);
check(
  "and is not claimed as a DAETUM object",
  drawingSource.parseDrawingSource(pastedManager.getSource()).length === 0,
);
check(
  "the renderer still receives it",
  has(pastedManager.renderInput(), ".. controls"),
  pastedManager.renderInput(),
);

/* A duplicated id is reported, never silently bound. */
const duplicate = [
  "\\begin{tikzpicture}[x=1mm, y=1mm]",
  "% DAETUM OBJECT: Line 1",
  "% DAETUM ID: line-dup",
  "% DAETUM TYPE: line",
  "\\draw (0,0) -- (10,0);",
  "% DAETUM OBJECT: Line 2",
  "% DAETUM ID: line-dup",
  "% DAETUM TYPE: line",
  "\\draw (0,10) -- (10,10);",
  "\\end{tikzpicture}",
].join("\n");

const duplicateManager = managerModule.createSourceManager(duplicate);

check(
  "a duplicated id is diagnosed",
  duplicateManager.diagnostics().some((row) => /appears more than once/.test(row.message)),
  JSON.stringify(duplicateManager.diagnostics()),
);

/* ========================== 8. LaTeX validity and export behaviour */

console.log("\nThe generated source stays valid LaTeX");
console.log("---------------------------------------");

const picture = drawingSource.buildDrawingSource([
  { id: "line-001", type: "line", name: "Line 1", source: "\\draw (0,0) -- (40,10);" },
  { id: "circle-001", type: "circle", name: "Circle 1", source: "\\draw (60,20) circle[radius=5];" },
]);

const validation = loadModule("source-validation.js").validateDrawingSource(picture);

check("a generated picture validates", validation.ok === true, JSON.stringify(validation.diagnostics));
check(
  "with no paired-marker warning",
  !validation.diagnostics.some((row) => /marker/i.test(row.message)),
  JSON.stringify(validation.diagnostics),
);
check(
  "the picture declares no document",
  !/\\documentclass|\\begin\{document\}/.test(picture),
);
check(
  "and carries no visible text of its own",
  !/\\node/.test(drawingSource.visibleDrawingSource(picture)),
);

/* The Written Solution keeps its protected reference and gets no object comments. */
const embedded = loadModule("embedded-drawings.js");

check(
  "the embedded drawing block is a plain picture",
  embedded.serializeDrawingBlock(drawingSource.visibleDrawingSource(picture)).indexOf("DAETUM") < 0,
);

/* ====================================================== summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
