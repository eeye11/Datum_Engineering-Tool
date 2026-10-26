/* eslint-disable no-console */
/*
 * ========================================================
 * EVERY TOOL'S GENERATOR EMITS THE COMMENT SCHEMA
 * ========================================================
 *
 * The object-comment suite proves the writers each write a header for the
 * objects it hands them. This one starts from the REGISTRY instead:
 *
 *   - every writer that the source pipeline installs is present;
 *   - every object TYPE a writer declares is exercised through that writer;
 *   - the block it produces carries the standard markers, a readable name, a
 *     stable id, and its type;
 *   - the internal type and name NEVER appear as visible drawing text;
 *   - the same object written twice yields the same id and the same text.
 *
 * It exists because the first pass of this work could pass its own tests by
 * covering Geometry and Forces and saying nothing about Fluids, Thermodynamics
 * or Dynamics. A schema test that does not walk the registry cannot tell the
 * difference, and this one can.
 *
 * The Point Force regression is checked here from the GENERATOR's output, not
 * from a string in the source: the unwanted `Point Force` node was produced by
 * the writer, so the writer is what has to stop producing it.
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
const writerIndex = loadModule("source-writers/index.js");

const writers = {
  statics: loadModule("statics.js"),
  geometry: loadModule("geometry.js"),
  dynamics: loadModule("dynamics.js"),
  annotations: loadModule("annotations.js"),
  thermodynamics: loadModule("thermodynamics.js"),
  fluids: loadModule("fluids.js"),
};

/* ============================================================ the inventory */

console.log("\nThe registry is the inventory");
console.log("------------------------------");

const registered = writerIndex.registeredWriterIds();

check(
  "every category writer is installed by the pipeline",
  ["statics", "geometry", "annotations", "thermodynamics", "fluids", "dynamics"].every(
    (id) => registered.includes(id),
  ),
  registered.join(", "),
);

/* ============================================================ the fixtures */

const point = (x, y) => ({ x, y });

/*
 * ONE OBJECT PER DECLARED TYPE. Each is the smallest object a real tool
 * creates - the same shape the model's factory makes - so a writer is asked for
 * exactly what the tool would ask it for.
 *
 * A type whose writer needs sheet context (an analysis diagram's source data, a
 * control volume's links) is still exercised: the writer either writes it or
 * declines, and a DECLINE IS PRINTED, never counted as coverage.
 */
const STATICS_GEOMETRY = {
  particle: { position: point(30, 40) },
  "rigid-body": { position: point(10, 60), width: 40, height: 20, rotation: 0 },
  beam: { start: point(0, 0), end: point(100, 0), depth: 10 },
  truss: {
    joints: [point(0, 0), point(50, 30), point(100, 0)],
    members: [
      [0, 1],
      [1, 2],
      [0, 2],
    ],
  },
  cable: { start: point(0, 0), end: point(80, 0), sag: 12 },
  shaft: { start: point(0, 0), end: point(90, 0), diameter: 16 },
  force: { start: point(20, 20), end: point(20, 80), magnitude: 60, angle: 90 },
  load: {
    start: point(0, 0),
    end: point(100, 0),
    intensity: 5,
    direction: -90,
    interval: 25,
    points: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 5 },
    ],
    normalSide: 1,
  },
  "varying-load": {
    start: point(0, 0),
    end: point(100, 0),
    intensity: 5,
    direction: -90,
    interval: 25,
    points: [
      { t: 0, magnitude: 0 },
      { t: 1, magnitude: 10 },
    ],
    normalSide: 1,
  },
  moment: { position: point(40, 40), arcRadius: 10, magnitude: 10, clockwise: true },
  "pin-support": { position: point(0, 0) },
  "roller-support": { position: point(50, 0) },
  "fixed-support": { position: point(0, 0) },
  "smooth-support": { position: point(0, 0) },
  "pin-connection": { start: point(0, 0), end: point(40, 0) },
  "fixed-connection": { start: point(0, 0), end: point(40, 0) },
  "slider-connection": { start: point(0, 0), end: point(40, 0) },
  connection: { start: point(0, 0), end: point(40, 0) },
  resultant: {
    start: point(10, 10),
    end: point(30, 40),
    magnitude: 25,
    angle: 60,
  },
  "force-components": {
    start: point(0, 0),
    end: point(30, 40),
    magnitude: 25,
    angle: 60,
  },
  "analysis-diagram": {
    start: point(0, 0),
    end: point(100, 0),
    values: [0, 10, 0],
    samples: [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ],
  },
  "shear-force-diagram": {
    start: point(0, 0),
    end: point(100, 0),
    values: [0, 10, 0],
    samples: [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ],
  },
  "bending-moment-diagram": {
    start: point(0, 0),
    end: point(100, 0),
    values: [0, 10, 0],
    samples: [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ],
  },
  "axial-force-diagram": {
    start: point(0, 0),
    end: point(100, 0),
    values: [0, 10, 0],
    samples: [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ],
  },
  "coordinate-system-2d": { position: point(0, 0), scale: 20 },
  "coordinate-system": { position: point(0, 0), scale: 20 },
  point: { position: point(10, 10) },
  line: { start: point(0, 0), end: point(40, 0) },
  arc: { center: point(0, 0), radius: 20, startAngle: 0, endAngle: 90 },
};

const GEOMETRY_GEOMETRY = {
  line: { start: point(0, 0), end: point(40, 10) },
  point: { position: point(10, 10) },
  circle: { center: point(20, 20), radius: 8 },
  rectangle: { position: point(0, 0), width: 30, height: 20 },
  arc: { center: point(0, 0), radius: 12, startAngle: 0, endAngle: 90 },
  polyline: { points: [point(0, 0), point(10, 10), point(20, 0)] },
  polygon: { center: point(0, 0), radius: 12, sides: 5 },
  triangle: {
    points: [point(0, 0), point(20, 0), point(10, 15)],
    vertices: [point(0, 0), point(20, 0), point(10, 15)],
  },
};

/* Types a writer declares but whose tool needs a live sheet to have a value. */
function declaredTypes(id) {
  switch (id) {
    case "statics":
      return writers.statics.writtenStaticsTypes();
    case "geometry":
      return writers.geometry.writtenGeometryTypes();
    case "dynamics":
      return writers.dynamics.writtenDynamicsTypes();
    case "thermodynamics":
      return [...writers.thermodynamics.THERMODYNAMICS_SOURCE_TYPES];
    case "fluids":
      return [...writers.fluids.FLUIDS_SOURCE_TYPES];
    case "annotations":
      return [...writers.annotations.ANNOTATION_SOURCE_TYPES];
    default:
      return [];
  }
}

function objectFor(id, type) {
  const base = {
    id: `${id}-${type}-001`.replace(/[^\w-]+/g, "-"),
    type,
    name: `${type} 1`,
    style: { stroke: "#193335", lineWidth: 0.75, lineType: "solid" },
  };

  if (id === "statics") {
    return { ...base, geometry: STATICS_GEOMETRY[type] || { position: point(10, 10) } };
  }

  if (id === "geometry") {
    return {
      ...base,
      geometry: GEOMETRY_GEOMETRY[type] || { position: point(10, 10), start: point(0, 0), end: point(20, 0) },
      metadata: { createdBy: "geometry-tool" },
    };
  }

  if (id === "dynamics") {
    return {
      ...base,
      engineering: { dynamicsType: type },
      geometry: {
        start: point(0, 0),
        end: point(40, 0),
        position: point(20, 20),
        center: point(20, 20),
        radius: 10,
        width: 30,
        height: 20,
      },
      label: "A",
    };
  }

  if (id === "thermodynamics") {
    return {
      ...base,
      geometry: { position: point(10, 10), width: 30, height: 20, start: point(0, 0), end: point(40, 0) },
      metadata: {
        thermodynamicsKind:
          type === "rectangle" ? "control-volume" : type,
      },
    };
  }

  if (id === "fluids") {
    return {
      ...base,
      geometry: {
        start: point(0, 0),
        end: point(60, 0),
        position: point(10, 10),
        points: [point(0, 0), point(60, 0)],
        /*
         * A JUNCTION IS THREE ARMS MEETING AT A HUB. The writer needs them to
         * build the contour; without them it correctly declines.
         */
        mainDirection: { x: 1, y: 0 },
        mainBranchId: "a",
        branches: [
          { id: "a", direction: { x: -1, y: 0 }, angle: 180, connected: null },
          { id: "b", direction: { x: 1, y: 0 }, angle: 0, connected: null },
          { id: "c", direction: { x: 0, y: 1 }, angle: 90, connected: null }
        ],
      engineering: { diameter: 12, wallThickness: 1 },
      },
      engineering: { diameter: 12, wallThickness: 1 },
    };
  }

  /* annotations */
  return {
    ...base,
    annotateKind: type === "annotation" ? undefined : "note",
    annotationKind: type === "annotation" ? "note" : undefined,
    text: "Student text",
    geometry: { position: point(10, 10), start: point(0, 0), end: point(30, 20), cells: ["a", "b"], rows: 2, columns: 2 },
    placement: point(10, 10),
  };
}

function write(id, object) {
  const table = {
    statics: (o) => writers.statics.staticsSourceWriter(o),
    geometry: (o) => writers.geometry.geometrySourceWriter(o),
    dynamics: (o) => writers.dynamics.dynamicsSourceWriter(o),
    annotations: (o) => writers.annotations.annotationSourceWriter(o),
    thermodynamics: (o) => writers.thermodynamics.thermodynamicsSourceWriter(o),
    fluids: (o) => writers.fluids.fluidsSourceWriter(o),
  };

  return table[id](object);
}

/* Every metadata line in a piece of source. */
const markers = (text) =>
  String(text || "")
    .split("\n")
    .filter((line) => /^[ \t]*%[ \t]*DAETUM[ \t]/.test(line));

/* Whether an object's name or type is drawn - i.e. appears outside a comment. */
function visibleText(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/^[ \t]*%/.test(line))
    .join("\n");
}

/* ============================================ 1. walk every declared type */

console.log("\nEach writer's declared types");
console.log("-----------------------------");

registered.forEach((id) => {
  const types = declaredTypes(id);

  check(`${id}: declares at least one type`, types.length > 0, `${types.length}`);

  let written = 0;
  let declined = 0;

  types.forEach((type) => {
    const object = objectFor(id, type);
    let source = null;

    try {
      source = write(id, object);
    } catch (error) {
      check(`${id}/${type}: written without throwing`, false, error.message);
      return;
    }

    if (source === null || source === undefined) {
      declined++;
      console.log(`  --   ${id}/${type}: declined (needs sheet context)`);
      return;
    }

    written++;

    const blocks = drawingSource.parseDrawingSource(source);
    const block = blocks.find((candidate) => candidate.id === object.id);

    check(
      `${id}/${type}: one block under the object's own id`,
      Boolean(block),
      String(source).slice(0, 240),
    );

    check(
      `${id}/${type}: carries the OBJECT, ID and TYPE markers`,
      /^% DAETUM OBJECT: \S/m.test(source) &&
        source.includes(`% DAETUM ID: ${object.id}`) &&
        source.includes(`% DAETUM TYPE: ${type}`),
      markers(source).join(" | "),
    );

    check(
      `${id}/${type}: every metadata line is a valid LaTeX comment`,
      markers(source).length > 0 &&
        markers(source).every((line) => /^[ \t]*%[ \t]*DAETUM [A-Z]+: /.test(line)),
      markers(source).join(" | "),
    );

    /*
     * THE INTERNAL NAME AND TYPE MUST NOT BE DRAWN.
     *
     * `force` and "force 1" are checked against the source with the metadata
     * lines removed: a header may - must - say them, the picture may not.
     */
    const visible = visibleText(source);

    check(
      `${id}/${type}: the internal type is not drawn as text`,
      !new RegExp(`[A-Za-z ]${type.replace(/[-]/g, "[- ]")}[A-Za-z ]`).test(
        visible.replace(/\{[^}]*\}/g, "{"),
      ) || !/\\node/.test(visible),
      visible.slice(0, 240),
    );

    check(
      `${id}/${type}: no node is labelled with the object's own name`,
      !visible.includes(`{${object.name}}`) &&
        !visible.includes(`{${comments.objectTypeLabel(type)}}`),
      visible.slice(0, 240),
    );

    /* The identity is stable: a second write is the same block. */
    const again = write(id, object);

    check(
      `${id}/${type}: regenerating does not mint a new id`,
      again === source && object.id === `${id}-${type}-001`.replace(/[^\w-]+/g, "-"),
    );
  });

  check(
    `${id}: most of its declared types are written`,
    written > 0 && written >= declined,
    `${written} written, ${declined} declined`,
  );
});

/* ============================================ 2. the Point Force regression */

console.log("\nThe Point Force regression");
console.log("---------------------------");

{
  /*
   * THE REPORTED EXAMPLE. A Point Force in a Statics sheet used to produce a
   * visible `\node ... {Point Force}` beside the arrow - the tool's own name,
   * written onto the drawing.
   *
   * The fix is in the generator: the writer emits a text node only for the
   * feature's own label, a requested name (`showName`) or content the tool's
   * documented behaviour requires (its magnitude). It never emits the type's
   * readable name on its own.
   */
  const force = {
    id: "force-001",
    type: "force",
    name: "Point Force",
    /* Magnitude and angle are geometry, as the model stores them. */
    geometry: {
      start: point(0, 71.1398),
      end: point(126.259, 6.4705),
      magnitude: 345.5,
      angle: 0,
    },
    style: { stroke: "#000000", lineWidth: 0.75 },
  };

  const source = writers.statics.staticsSourceWriter(force);
  const visible = visibleText(source);

  check("the force arrow is generated", /\\draw/.test(visible), visible);
  check(
    "the magnitude label is generated when enabled",
    /F\s*=\s*345\.5/.test(visible),
    visible,
  );
  check(
    "the internal name is in the metadata",
    source.includes("% DAETUM OBJECT: Point Force") && source.includes("% DAETUM TYPE: force"),
    markers(source).join(" | "),
  );
  check(
    "no visible node says `Point Force`",
    !/\{Point Force\}/.test(visible) && !visible.includes("{Point Force}"),
    visible,
  );
  check(
    "and no visible node says the type",
    !/\{force\}/i.test(visible),
    visible,
  );

  /* Regeneration cannot bring it back. */
  const twice = writers.statics.staticsSourceWriter(force);

  check(
    "regenerating produces byte-identical source",
    twice === source,
    twice === source ? "" : "the second write differed",
  );

  /* A student who ASKS for the name still gets it. */
  const named = writers.statics.staticsSourceWriter({
    ...force,
    id: "force-002",
    showName: true,
    labelName: true,
  });

  check(
    "an explicit request to show the name still works",
    visibleText(named).includes("Point Force"),
    visibleText(named),
  );

  /* And a label the student typed is drawn, exactly as typed. */
  const labelled = writers.statics.staticsSourceWriter({
    ...force,
    id: "force-003",
    label: "F_A",
  });

  check(
    "a student's own label is drawn",
    visibleText(labelled).includes("F\\_A"),
    visibleText(labelled),
  );

  /*
   * THE VERSION OF THIS CHECK THAT MATTERED. The first implementation dropped
   * the label whenever the object already had a value node (its magnitude), so
   * a labelled force drew its label and no magnitude - or, on a type that
   * always carries a value, neither. The label is the student's, and must
   * appear BESIDE the value, not instead of it.
   */
  check(
    "a labelled force draws its label AND its magnitude",
    /F\\_A/.test(visibleText(labelled)) && /F\s*=\s*345\.5/.test(visibleText(labelled)),
    visibleText(labelled),
  );

  /* The magnitude is the tool's documented content, so it obeys the display switch. */
  const magnitudeOff = writers.statics.staticsSourceWriter({
    ...force,
    id: "force-004",
    label: "F_A",
    showValue: false,
  });

  check(
    "switching the value off removes the magnitude and keeps the label",
    !/345\.5/.test(visibleText(magnitudeOff)) && /F\\_A/.test(visibleText(magnitudeOff)),
    visibleText(magnitudeOff),
  );

  const relabelled = writers.statics.staticsSourceWriter({
    ...force,
    id: "force-003",
    label: "F_B",
  });

  check(
    "changing the label keeps the same stable id",
    relabelled.includes("% DAETUM ID: force-003"),
    markers(relabelled).join(" | "),
  );
}

/* ============================================ 3. composite relationships */

console.log("\nA force is one logical object in one region");
console.log("---------------------------------------------");

{
  const source = writers.statics.staticsSourceWriter({
    id: "force-010",
    type: "force",
    name: "Point Force 1",
    geometry: { start: point(0, 0), end: point(0, 60), magnitude: 60 },
    label: "F",
  });

  const blocks = drawingSource.parseDrawingSource(source);

  check("the object's own block is there", blocks.some((block) => block.id === "force-010"));

  /*
   * ONE LOGICAL OBJECT, ONE CONTIGUOUS REGION.
   *
   * The composite contract this project holds its source pipeline to: a force
   * and its label are ONE object and ONE block. The arrow and the text are both
   * inside it, so a targeted edit rewrites them together and a source line
   * anywhere in it resolves to the force - never to a label that is not an
   * object.
   *
   * Component headers (`% DAETUM PART:` / `% DAETUM PARENT:`) are SUPPORTED by
   * the format and the block builder, but are deliberately not emitted inside a
   * logical object: the parser ends a block at the next header, so a child
   * header would split the object into two editable regions. That trade-off is
   * recorded in docs/OBJECT-COMMENTS.md.
   */
  const map = drawingSource.createSourceMap(source);
  const own = map.block("force-010");

  check("the force is exactly one block", blocks.filter((b) => !b.parent).length === 1, JSON.stringify(blocks.map((b) => b.id)));

  check(
    "the arrow and its text are both inside that block",
    /\\draw/.test(own?.lines.join("\n") || "") && /F\\_A|F\s*=/.test(own?.lines.join("\n") || ""),
    (own?.lines || []).join("\n").slice(0, 240),
  );

  check(
    "every line of the object resolves to the object",
    [...Array(source.split("\n").length - 1 + 1).keys()]
      .filter((line) => /\((?:draw|node)/.test(source.split("\n")[line]))
      .every((line) => map.idAtLine(line) === "force-010"),
  );

  check(
    "and the component format is still available to a caller that needs it",
    drawingSource
      .parseDrawingSource(
        drawingSource.renderObjectBlock({
          id: comments.partId("force-010", "label"),
          type: "force",
          name: "Force 010 Label",
          part: "label",
          parent: "force-010",
          source: "\\node at (1,1) {L};",
        }),
      )
      .some((block) => block.part === "label" && block.parent === "force-010"),
  );

  check(
    "the serialized object draws the arrow and its magnitude",
    /\\draw/.test(source) && /F\s*=\s*60/.test(source),
    source.slice(0, 240),
  );

  /* The headers never reach the picture. */
  const visible = drawingSource.visibleDrawingSource(source);

  check(
    "metadata adds no drawing command",
    !/DAETUM/.test(visible),
    visible.slice(0, 200),
  );

  check(
    "and the picture keeps every draw and node command",
    (visible.match(/\\draw/g) || []).length === (source.match(/\\draw/g) || []).length &&
      (visible.match(/\\node/g) || []).length === (source.match(/\\node/g) || []).length,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
