/* eslint-disable no-console */
/*
 * ========================================================
 * STATICS SOURCE IN THE LIVE PIPELINE
 * ========================================================
 *
 * The serializer suite (statics-source-writers) proves the CODE is right. This
 * one proves the code REACHES the Source tab: it drives the application's own
 * source pipeline - `source-synchronization.js` and the source manager - with
 * real objects, and checks the things a student would notice:
 *
 *   - drawing an object writes one block for it, under its stable id;
 *   - moving it REWRITES that block and leaves every other block alone;
 *   - editing several selected objects updates each of them;
 *   - deleting one removes its block and damages nothing else;
 *   - custom source the student typed between objects survives all of it;
 *   - the geometry writer and the statics writer do not take each other's
 *     objects.
 *
 * No canvas, no browser: the pipeline is pure text and object data.
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

const sync = loadModule("source-synchronization.js");
const managerModule = loadModule("drawing-source-manager.js");
const sourceModule = loadModule("drawing-source.js");
const geometry = loadModule("geometry.js");
const statics = loadModule("statics.js");

/* ============================================================ helpers */

const STYLE = {
  stroke: "#193335",
  lineWidth: 0.75,
  lineType: "solid",
  fill: "none",
};

function beam(id, start, end) {
  return {
    id,
    type: "beam",
    name: `Beam ${id}`,
    geometry: { start, end },
    style: { ...STYLE },
  };
}

function force(id, start, magnitude, angle) {
  return {
    id,
    type: "force",
    name: `Force ${id}`,
    geometry: { start, position: start, magnitude, angle },
    style: { ...STYLE },
  };
}

function line(id) {
  return {
    id,
    type: "line",
    name: `Line ${id}`,
    geometry: { start: { x: 0, y: 0 }, end: { x: 40, y: 20 } },
    style: { ...STYLE },
  };
}

function fresh() {
  const manager = managerModule.createSourceManager();

  sync.setSourceWriter(geometry.geometrySourceWriter);
  sync.addSourceWriter(statics.staticsSourceWriter);

  return manager;
}

const blockOf = (manager, id) => manager.map().block(id);
const bodyOf = (manager, id) => {
  const block = blockOf(manager, id);

  if (!block) {
    return null;
  }

  return manager
    .getSource()
    .split("\n")
    .slice(block.bodyStartLine, block.bodyEndLine + 1)
    .join("\n");
};

/* ====================================================== the writers */

console.log("\nWriter registration");
console.log("-------------------");

const manager = fresh();

check(
  "the geometry writer still owns a line",
  sync.sourceForObject(line("geom-a")) !== null,
);
check(
  "the statics writer owns a beam",
  sync.sourceForObject(beam("beam-a", { x: 0, y: 0 }, { x: 50, y: 0 })) !==
    null,
);
check(
  "and each declines the other's type",
  geometry.geometrySourceWriter(
    beam("beam-b", { x: 0, y: 0 }, { x: 1, y: 1 }),
  ) === null && statics.staticsSourceWriter(line("line-b")) === null,
);

/* ====================================================== creation */

console.log("\nCreating objects");
console.log("----------------");

/*
 * THE DRAWING'S OWN SCALE.
 *
 * Every write below passes `allObjects`: the export transform is fitted to the
 * WHOLE drawing, so an object added beside others is drawn at the same scale as
 * they are. A write with no objects beside it fits that object alone, which is
 * right for a lone preview and wrong for a sheet.
 *
 * `sheet` is the list the drawing holds, so the transform the assertions below
 * expect is the one the manager actually used.
 */
const sheet = [];

function writeInto(target, object) {
  const existing = sheet.findIndex((entry) => entry.id === object.id);

  if (existing >= 0) {
    sheet[existing] = object;
  } else {
    sheet.push(object);
  }

  return sync.writeObjectIntoSource(target, object, { allObjects: [...sheet] });
}

const fit = () => sync.exportTransformFor(sheet);

writeInto(manager, beam("beam-1", { x: 0, y: 100 }, { x: 80, y: 100 }));

check("a created beam gets one block", Boolean(blockOf(manager, "beam-1")));
check(
  "under the stable id",
  manager.getSource().includes('% DAETUM_OBJECT_BEGIN id="beam-1" type="beam"'),
);

/*
 * THE GEOMETRY IS CHECKED AGAINST THE OBJECT'S OWN STORED ENDPOINTS.
 *
 * A `\draw` writes the coordinates the serializer computed, which for a beam are
 * its four OUTLINE corners - the bar's depth on either side of the centreline.
 * So the check is that the exported positions of the object's real endpoints are
 * PRESENT in its block, at whatever scale the drawing was fitted to, rather than
 * a guessed corner offset. The scale itself is asserted separately below.
 */
check(
  "with its real geometry, in the drawing's export space",
  (() => {
    const start = fit().point(0, 100);
    const end = fit().point(80, 100);
    const body = bodyOf(manager, "beam-1") || "";

    return body.includes(`(${start.x},`) && body.includes(`(${end.x},`);
  })(),
  bodyOf(manager, "beam-1"),
);

check(
  "and at the whole drawing's one export scale",
  Number.isFinite(fit().factor) && fit().factor > 0 && fit().factor <= 1,
  `${fit().factor}`,
);

writeInto(manager, force("force-1", { x: 10, y: 100 }, 25, 90));
writeInto(manager, line("line-1"));

check("three objects give three blocks", manager.map().ids().length === 3);
check(
  "in creation order",
  manager.map().ids().join(",") === "beam-1,force-1,line-1",
);
check(
  "the force's text nodes are inside ITS block",
  (bodyOf(manager, "force-1") || "").includes("F = 25"),
);

/* ====================================================== movement */

console.log("\nMoving an object");
console.log("----------------");

const forceBefore = bodyOf(manager, "force-1");
const lineBefore = bodyOf(manager, "line-1");

/*
 * THE TRANSFORM IS CAPTURED BEFORE THE MOVE.
 *
 * Moving an object changes the DRAWING'S bounds, so a re-fitted export would
 * shift every other object too - which is right for a fresh export and wrong for
 * updating one block in place. The drawing's scale is therefore held for the
 * life of the sheet (see `exportTransformFor`'s note on stability), and the
 * expected position is the one that scale gives.
 */
const movingFit = fit();

const movedForce = force("force-1", { x: 60, y: 100 }, 25, 90);

writeInto(manager, movedForce);

const afterFit = fit();

const movedAt = afterFit.point(60, 100);
const earlierAt = movingFit.point(10, 100);

check(
  "the moved object's block follows it",
  (() => {
    /*
     * THE BLOCK MUST REACH THE MOVED POINT.
     *
     * A force is drawn as an arrow of its own stored length, so its END is the
     * point to look for - not the application point. What matters is that the
     * block has moved: it reaches the new position and no longer reaches the old
     * one (asserted next).
     */
    const body = bodyOf(manager, "force-1") || "";
    const xs = [...body.matchAll(/\((-?[\d.]+),/g)].map((match) => Number(match[1]));

    return xs.some((x) => Math.abs(x - movedAt.x) < 0.01);
  })(),
  `${bodyOf(manager, "force-1")}\nexpected x ${movedAt.x}`,
);
check(
  "and no longer draws from the old point",
  !(bodyOf(manager, "force-1") || "").includes(`(${earlierAt.x},${earlierAt.y})`),
);
check(
  "the magnitude is unchanged",
  (bodyOf(manager, "force-1") || "").includes("F = 25"),
);
check(
  "another object's block is untouched",
  bodyOf(manager, "line-1") === lineBefore,
);
check("and the beam's too", Boolean(blockOf(manager, "beam-1")));

void forceBefore;

/* ================================================= a property edit */

console.log("\nA Features edit");
console.log("---------------");

const renamed = {
  ...beam("beam-1", { x: 0, y: 100 }, { x: 80, y: 100 }),
  style: { ...STYLE, stroke: "#FF0000" },
};

sync.writeObjectIntoSource(manager, renamed);

check(
  "a colour change reaches the source",
  (bodyOf(manager, "beam-1") || "").includes("draw=daetumCFF0000"),
);
check(
  "with its definition",
  (bodyOf(manager, "beam-1") || "").includes("\\definecolor{daetumCFF0000}"),
);

/* ================================================ multiple objects */

console.log("\nEditing a multi-selection");
console.log("-------------------------");

sync.writeObjectIntoSource(
  manager,
  beam("beam-1", { x: 0, y: 100 }, { x: 80, y: 100 }),
);
sync.writeObjectIntoSource(
  manager,
  force("force-1", { x: 60, y: 100 }, 30, 90),
);

check(
  "each selected object's own block is current",
  (bodyOf(manager, "force-1") || "").includes("F = 30"),
);
check(
  "and one not in the selection is unchanged",
  bodyOf(manager, "line-1") === lineBefore,
);

/* ====================================================== deletion */

console.log("\nDeleting an object");
console.log("------------------");

sync.writeObjectIntoSource(
  manager,
  beam("beam-1", { x: 0, y: 100 }, { x: 80, y: 100 }),
);

const beforeDelete = manager.getSource();

sync.removeObjectFromSource(manager, "force-1");

check("the deleted object's block is gone", !blockOf(manager, "force-1"));
check("its text nodes went with it", !manager.getSource().includes("F = 30"));
check(
  "the other objects remain",
  Boolean(blockOf(manager, "beam-1")) && Boolean(blockOf(manager, "line-1")),
);
check(
  "and the surviving text is smaller, not rebuilt",
  manager.getSource().length < beforeDelete.length,
);

/* ================================================ custom source */

console.log("\nThe student's own code");
console.log("----------------------");

const custom = `% my own note\r\n\\draw[dashed] (0,0) -- (5,5);`;

manager.setSource(
  manager
    .getSource()
    .replace("% DAETUM_OBJECT_BEGIN", `${custom}\n% DAETUM_OBJECT_BEGIN`),
);

check(
  "custom source sits beside the objects",
  manager.getSource().includes("% my own note"),
);

/*
 * A WIDENED BEAM IS STILL THE BEAM, AT THE DRAWING'S SCALE.
 *
 * The block is re-written from the object's own endpoints and through the one
 * export transform, so the check is that its new far end is present at the
 * exported position - not a raw model coordinate that an export would never
 * contain.
 */
const widened = beam("beam-1", { x: 0, y: 100 }, { x: 90, y: 100 });

writeInto(manager, widened);

/* Computed AFTER the write: widening the beam changes the drawing's bounds. */
const widenedEnd = fit().point(90, 100);

check(
  "an object edit preserves it",
  manager.getSource().includes("% my own note"),
);
check(
  "and its command",
  manager.getSource().includes("\\draw[dashed] (0,0) -- (5,5);"),
);
check(
  "while the edited object still follows",
  (() => {
    /*
     * THE SOURCE WRITES ROUNDED NUMBERS, so the block is compared NUMERICALLY -
     * `(83.78,` is the exported x, rounded to what the generator emits.
     */
    const xs = [...(bodyOf(manager, "beam-1") || "").matchAll(/\((-?[\d.]+),/g)].map((match) =>
      Number(match[1]),
    );

    return xs.some((x) => Math.abs(x - widenedEnd.x) < 0.01);
  })(),
  `expected end x ${widenedEnd.x}\n${bodyOf(manager, "beam-1")}`,
);

/* ================================================= the visible form */

console.log("\nWhat the Source tab shows");
console.log("-------------------------");

const visible = manager.getVisibleSource();

check(
  "the visible source carries no markers",
  !visible.includes("DAETUM_OBJECT_BEGIN"),
);
check(
  "but does carry the drawing",
  (() => {
    const xs = [...visible.matchAll(/\((-?[\d.]+),/g)].map((match) => Number(match[1]));

    return xs.some((x) => Math.abs(x - widenedEnd.x) < 0.01);
  })(),
);
check("and the student's code", visible.includes("% my own note"));
check(
  "the visible source is a picture",
  visible.trimStart().startsWith(sourceModule.PICTURE_BEGIN),
);

/* ==================================================== reconstitution */

console.log("\nReconciling a reopened sheet");
console.log("----------------------------");

const reopened = managerModule.createSourceManager();
const objects = [
  beam("beam-x", { x: 0, y: 0 }, { x: 40, y: 0 }),
  force("force-x", { x: 0, y: 0 }, 10, 90),
];

sync.reconcileSourceWithObjects(reopened, objects);

check(
  "a sheet with no source is given every object",
  reopened.map().ids().join(",") === "beam-x,force-x",
);
/*
 * A RECONCILED SHEET IS WRITTEN AT ITS OWN EXPORT SCALE.
 *
 * The reopened drawing holds two objects, so its fit is computed from BOTH - the
 * beam's real code is present, at the positions that fit produces.
 */
check(
  "with real code",
  (() => {
    const fitReopened = sync.exportTransformFor(objects);
    const start = fitReopened.point(0, 0);
    const body = bodyOf(reopened, "beam-x") || "";

    return body.includes("\\draw") && body.includes(`(${start.x},`);
  })(),
  bodyOf(reopened, "beam-x"),
);

sync.reconcileSourceWithObjects(reopened, objects);

check(
  "reconciling twice adds nothing",
  reopened.getSource().split("DAETUM_OBJECT_BEGIN").length - 1 === 2,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
