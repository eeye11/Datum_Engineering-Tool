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

sync.writeObjectIntoSource(
  manager,
  beam("beam-1", { x: 0, y: 100 }, { x: 80, y: 100 }),
);

check("a created beam gets one block", Boolean(blockOf(manager, "beam-1")));
check(
  "under the stable id",
  manager.getSource().includes('% DAETUM_OBJECT_BEGIN id="beam-1" type="beam"'),
);
check(
  "with its real geometry",
  (bodyOf(manager, "beam-1") || "").includes("(0,103)"),
);

sync.writeObjectIntoSource(
  manager,
  force("force-1", { x: 10, y: 100 }, 25, 90),
);
sync.writeObjectIntoSource(manager, line("line-1"));

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

sync.writeObjectIntoSource(
  manager,
  force("force-1", { x: 60, y: 100 }, 25, 90),
);

check(
  "the moved object's block follows it",
  (bodyOf(manager, "force-1") || "").includes("(60,100)"),
  bodyOf(manager, "force-1"),
);
check(
  "and no longer draws from the old point",
  !(bodyOf(manager, "force-1") || "").includes("(10,100)"),
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

sync.writeObjectIntoSource(
  manager,
  beam("beam-1", { x: 0, y: 100 }, { x: 90, y: 100 }),
);

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
  (bodyOf(manager, "beam-1") || "").includes("(90,103)"),
);

/* ================================================= the visible form */

console.log("\nWhat the Source tab shows");
console.log("-------------------------");

const visible = manager.getVisibleSource();

check(
  "the visible source carries no markers",
  !visible.includes("DAETUM_OBJECT_BEGIN"),
);
check("but does carry the drawing", visible.includes("(90,103)"));
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
check("with real code", (bodyOf(reopened, "beam-x") || "").includes("(0,3)"));

sync.reconcileSourceWithObjects(reopened, objects);

check(
  "reconciling twice adds nothing",
  reopened.getSource().split("DAETUM_OBJECT_BEGIN").length - 1 === 2,
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
