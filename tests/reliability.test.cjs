/*
 * ========================================================
 * RELIABILITY: FAIL SAFELY, PRESERVE THE WORK
 * ========================================================
 *
 * The rules this file pins, all of which exist to stop a failure becoming lost
 * work:
 *
 *   - A FAILED WRITE IS NOT A SAVE. The document stays dirty, its name is not
 *     adopted, and the failure is reported rather than thrown past the caller
 *     or swallowed.
 *   - THE LAST GOOD FILE SURVIVES. The write is committed only by `close()`, so
 *     an interrupted or failed write leaves the previous version untouched.
 *   - RECOVERED WORK IS UNSAVED WORK. A recovered document is dirty, because
 *     the copy existed precisely because a save did not happen.
 *   - A RECOVERY COPY IS KEPT SEPARATELY from the official file, and is only
 *     cleared by a successful save or by the user declining it.
 *   - A RENDERING FAILURE IS CONTAINED. One feature that cannot be drawn does
 *     not stop the others, and is never removed from the model.
 *   - FAILURES ARE RECORDED, not swallowed.
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");

const { modulePath, locate, rendererSource } = require("./helpers/source-path.cjs");

const projectRoot = require("path").join(__dirname, "..");

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
  /* A real origin, so localStorage exists - the recovery copy uses it. */
  url: "https://datum.test/"
});

global.window = dom.window;
global.document = dom.window.document;
global.Blob = dom.window.Blob;
global.URL = dom.window.URL;
global.Element = dom.window.Element;

/* ---------------------------------------------------------------- */
/* 1. A FAILED WRITE IS REPORTED, NOT THROWN, AND NOT A SAVE          */
/* ---------------------------------------------------------------- */

async function main() {
console.log("\n  a failed write is reported and does not become a save\n");

{
  const file = require(modulePath("document-file.js")).default;
  const save = require(modulePath("file-save.js")).default;

  const BODY = { objects: [], sheets: [] };

  /*
   * A handle whose write refuses - a full disk, a revoked permission, a file
   * that has gone. This is the failure the user must be told about.
   */
  let aborted = false;

  save.setFileHandle({
    name: "Beam.tex",
    createWritable: async () => ({
      write: async () => {
        throw new Error("disk full");
      },
      close: async () => {},
      abort: async () => {
        aborted = true;
      },
    }),
  });

  let thrown = null;
  let result = null;

  try {
    result = await save.save(BODY);
  } catch (error) {
    thrown = error;
  }

  check(
    "a failed write does not throw out of save()",
    thrown === null,
    thrown ? thrown.message : "",
  );

  check(
    "it reports an error instead of a name",
    result && typeof result.error === "string",
    JSON.stringify(result),
  );

  check(
    "the message says the work is still open",
    result && /still open/i.test(result.error),
    result ? result.error : "",
  );

  check(
    "the temporary file is aborted, so nothing half-written remains",
    aborted === true,
  );

  check(
    "the handle is still the document's file, so a retry goes to the same place",
    save.currentFileHandle() && save.currentFileHandle().name === "Beam.tex",
  );

  /* And a healthy write still returns the name. */
  save.setFileHandle({
    name: "Beam.tex",
    createWritable: async () => ({
      write: async () => {},
      close: async () => {},
    }),
  });

  const ok = await save.save(BODY);

  check(
    "a successful write still returns the file's name",
    ok === "Beam.tex",
    String(ok),
  );

  /*
   * AN IMPORTED .enggdraw IS NEVER WRITTEN OVER. Its handle is not a save
   * target: Save returns null (the caller then runs Save As), and nothing is
   * written into the old file.
   */
  let wroteLegacy = false;

  save.setFileHandle({
    name: "Old Beam.enggdraw",
    createWritable: async () => {
      wroteLegacy = true;

      return { write: async () => {}, close: async () => {} };
    },
  });

  const legacy = await save.save(BODY);

  check(
    "Save refuses an imported .enggdraw and hands over to Save As",
    legacy === null && wroteLegacy === false,
    `returned ${legacy}, wrote ${wroteLegacy}`,
  );

  void file;
}

/* ---------------------------------------------------------------- */
/* 2. A FAILED PICKER IS REPORTED, NOT THROWN                          */
/* ---------------------------------------------------------------- */

console.log("\n  a save panel that fails is reported\n");

{
  const save = require(modulePath("file-save.js")).default;

  save.forgetFileHandle();

  global.window.showSaveFilePicker = async () => {
    throw new Error("the platform refused");
  };

  let thrown = null;
  let result = null;

  try {
    result = await save.saveAs({ objects: [], sheets: [] }, "x.tex", {});
  } catch (error) {
    thrown = error;
  }

  check(
    "a non-cancellation picker failure does not throw",
    thrown === null,
    thrown ? thrown.message : "",
  );

  check(
    "it is returned as a reported error",
    result && typeof result.error === "string",
    JSON.stringify(result),
  );

  /* Cancelling is still silent, because it is not a failure. */
  global.window.showSaveFilePicker = async () => {
    const error = new Error("cancelled");
    error.name = "AbortError";
    throw error;
  };

  const cancelled = await save.saveAs({ objects: [], sheets: [] }, "x.tex", {});

  check("cancelling still returns null and reports nothing", cancelled === null);
}

/* ---------------------------------------------------------------- */
/* 3. THE RECOVERY COPY IS SEPARATE AND HONEST                         */
/* ---------------------------------------------------------------- */

console.log("\n  the recovery copy is separate from the file\n");

{
  const recovery = require(modulePath("document-recovery.js")).default;

  recovery.clear
    ? recovery.clear()
    : global.window.localStorage.removeItem(recovery.STORAGE_KEY);

  const document = {
    units: "mm",
    sheets: [
      {
        id: "s1",
        name: "Structure",
        scale: { mmPerUnit: 2.5, unit: "mm" },
        objects: [{ id: "beam_1", type: "beam" }]
      }
    ],
    activeSheetId: "s1"
  };

  recovery.write(document, "Beam.tex");

  const read = recovery.read();

  check("a recovery copy can be written and read", Boolean(read));

  check(
    "the copy names the file it belongs to",
    read && read.fileName === "Beam.tex",
  );

  check(
    "the copy holds the DOCUMENT, not a picture of it",
    read && read.document && Array.isArray(read.document.sheets),
  );

  check(
    "the copy keeps the sheet's World Scale",
    read &&
      read.document.sheets[0].scale &&
      read.document.sheets[0].scale.mmPerUnit === 2.5,
  );

  const described = recovery.describe();

  check(
    "the prompt describes what would come back",
    described && described.features === 1 && described.sheets === 1,
    JSON.stringify(described),
  );

  recovery.discard();

  check("discarding removes the copy", recovery.available() === false);
}

/* ---------------------------------------------------------------- */
/* 4. ERRORS ARE RECORDED, NOT SWALLOWED                               */
/* ---------------------------------------------------------------- */

console.log("\n  caught failures are recorded\n");

{
  const log = require(modulePath("error-log.js")).default;

  log.clear();

  globalThis.__DATUM_QUIET_ERRORS__ = true;

  log.reportError("render feature", new Error("boom"), {
    featureId: "beam_1",
    featureType: "beam"
  });

  const entries = log.recent();

  check("the failure is kept", entries.length === 1);

  check(
    "it names the operation that failed",
    entries[0] && entries[0].operation === "render feature",
  );

  check(
    "it carries the context that identifies the feature",
    entries[0] &&
      entries[0].context.featureId === "beam_1" &&
      entries[0].context.featureType === "beam",
  );

  check(
    "the log is bounded",
    log.MAX_ENTRIES > 0 && log.MAX_ENTRIES <= 500,
    String(log.MAX_ENTRIES),
  );

  globalThis.__DATUM_QUIET_ERRORS__ = false;
  log.clear();
}

/* ---------------------------------------------------------------- */
/* 5. A RENDERING FAILURE CANNOT DELETE OR BLANK                       */
/* ---------------------------------------------------------------- */

console.log("\n  one unrenderable feature does not take the drawing down\n");

{
  const source = rendererSource();

  check(
    "each feature is drawn inside its own try",
    /state\.objects\.forEach\([\s\S]{0,200}try\s*\{[\s\S]{0,200}appendEntity/.test(
      source,
    ),
    "one throwing feature would abandon the whole repaint",
  );

  check(
    "a failure is COLLECTED, not thrown out of the render",
    /renderFailures\.push/.test(source),
  );

  check(
    "the failure is reported through the error log",
    /enggErrorLog\.reportError/.test(source),
  );

  check(
    "NOTHING IS REMOVED from the model on a render failure",
    !/renderFailures[\s\S]{0,400}(splice|filter|removeObject)/.test(source),
    "a rendering problem must never become data loss",
  );
}

/* ---------------------------------------------------------------- */
/* 6. RECOVERY IS MARKED DIRTY, AND THE GLOBAL HANDLERS ARE INSTALLED  */
/* ---------------------------------------------------------------- */

console.log("\n  recovery is unsaved work, and uncaught errors are recorded\n");

{
  const commands = fs.readFileSync(locate("document-commands.js"), "utf8");

  check(
    "a recovered document is marked DIRTY",
    /markDocumentDirty\(\);[\s\S]{0,240}enggRecovery\.discard\(\)/.test(commands),
    "a recovered document must not claim to be saved",
  );

  check(
    "the recovery prompt names both choices explicitly",
    commands.includes('label: "Recover"') &&
      commands.includes('label: "Discard Recovery"'),
  );

  check(
    "a save failure keeps the document dirty and reports it",
    /saved\.error[\s\S]{0,400}return false;/.test(commands),
    "a failed save must not clear the unsaved state",
  );

  const mainSource = fs.readFileSync(locate("app/entry/main.js"), "utf8");

  check(
    "the global error handlers are installed at start-up",
    mainSource.includes("installGlobalErrorHandlers()"),
  );

  const logSource = fs.readFileSync(locate("error-log.js"), "utf8");

  check(
    "an uncaught error and an unhandled rejection are both recorded",
    logSource.includes('"uncaught error"') &&
      logSource.includes("unhandledrejection"),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void dom;
void projectRoot;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
