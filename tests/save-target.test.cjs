/*
 * ========================================================
 * SAVE WRITES BACK TO THE FILE THAT WAS OPENED
 * ========================================================
 *
 * THE BUG THIS PINS DOWN. Save fell through to Save As every time, for a file
 * that had just been opened.
 *
 * The cause was a missing capability, not a wrong branch: `save()` needs a
 * FILE HANDLE, and Open used a plain `<input type="file">`, which hands over a
 * `File` - a read-only snapshot with no way to write back to where it came
 * from. So an opened document had no save target at all, and Save asked the user
 * to choose a filename for a file they had chosen moments earlier.
 *
 * The fix is to open through `showOpenFilePicker` where the browser provides it,
 * because that is the only route that yields a handle Save can write to.
 */

const fs = require("fs");

const { locate } = require("./helpers/source-path.cjs");

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

const save = fs.readFileSync(locate("file-save.js"), "utf8");
const commands = fs.readFileSync(locate("document-commands.js"), "utf8");

console.log("\n  a file that was OPENED can be written back to\n");

check(
  "there is a picker that returns a real file handle",
  /function openWithPicker\(\)/.test(save) &&
    /window\.showOpenFilePicker\(/.test(save),
  "an <input type=file> gives contents only - no handle to write back to",
);

check(
  "the capability is checked separately from the save picker",
  /function supportsOpenPicker\(\)/.test(save) &&
    /showOpenFilePicker/.test(save),
  "a browser can have one without the other",
);

check(
  "OPENING goes through that picker when it is available",
  /if \(enggFileSave\.supportsOpenPicker\(\)\)/.test(commands) &&
    /openWithPicker\(\)/.test(commands),
);

check(
  "and the handle is remembered BEFORE the file is read",
  /setFileHandle\(chosen\.handle\)[\s\S]{0,200}openChosenFile/.test(commands),
  "the save target exists from the moment the document is open",
);

check(
  "the opened file's handle is recorded on the recent entry",
  /handle: enggFileSave\.currentFileHandle\(\)/.test(commands),
);

console.log("\n  Save writes back; Save As is the only thing that asks\n");

check(
  "Save tries the existing handle FIRST",
  /export async function saveDrawing[\s\S]{0,200}enggFileSave\.save\(/.test(
    commands,
  ),
);

check(
  "Save falls through to Save As only when there is nowhere to write",
  /if \(!saved\) \{[\s\S]{0,900}return await saveDrawingAs\(\)/.test(commands),
  "a never-saved document has no path, so choosing one is the only option",
);

check(
  "a Save As success makes the NEW file the document's file",
  /if \(!result\.image\) \{[\s\S]{0,200}documentFileName = result\.name/.test(
    commands,
  ),
);

console.log("\n  a failed save keeps the document and its target\n");

check(
  "the dirty state is NOT cleared on failure",
  /saved && saved\.error[\s\S]{0,600}return false;/.test(commands),
);

check(
  "and the file name is not changed either",
  !/saved && saved\.error[\s\S]{0,400}documentFileName =/.test(commands),
);

check(
  "the write is atomic - committed only by close()",
  /createWritable\(\)[\s\S]{0,500}await writable\.close\(\)/.test(save),
  "an interrupted write must leave the previous file intact",
);

console.log("\n  the document's name is shown without its extension\n");

check(
  "only the FINAL .enggdraw is stripped",
  /name\.slice\(0, -suffix\.length\)/.test(commands) &&
    /endsWith\(suffix\.toLowerCase\(\)\)/.test(commands),
  "Statics.V2.Final.enggdraw must read Statics.V2.Final",
);

check(
  "a document with no file reads Untitled",
  /if \(!name\) \{\s*\n\s*return "Untitled";/.test(commands),
);

check(
  "the header carries the base name and an unsaved mark",
  /headerDocumentBaseName/.test(commands) &&
    /headerDocumentDirty/.test(commands) &&
    /mark\.hidden = !documentDirty/.test(commands),
);

check(
  "and the mark follows the flag from the one place the flag is set",
  /function markDocumentDirty[\s\S]{0,3000}refreshDocumentTitle\(\)/.test(
    commands,
  ) &&
    /function markDocumentClean[\s\S]{0,400}refreshDocumentTitle\(\)/.test(
      commands,
    ),
);

check(
  "the window title stays DAETUM, without the drawing name",
  /document\.title = "DAETUM"/.test(commands),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}