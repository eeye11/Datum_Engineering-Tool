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

/*
 * ========================================================
 * OPEN ROUTES THROUGH THE GUARD AND THE LAUNCHER
 * ========================================================
 *
 * TWO THINGS MUST BOTH BE TRUE, and they pull against each other:
 *
 *   1. Opening replaces the drawing, so it must ask about unsaved changes
 *      FIRST - and the work must run INSIDE the answer, not around it. The old
 *      bug handed the guard an empty action and then returned early on the
 *      guard's synchronous `false` (the answer has not arrived yet), so Open
 *      aborted every time the document was dirty and the chosen file was read
 *      and thrown away.
 *
 *   2. File -> Open must NOT open the operating system's panel directly. It
 *      shows the Datum launcher - Templates, Recent, Import - and the panel is
 *      reached only through Import.
 *
 * The checks that read source do so through plain substring searches
 * (`includes`), not regular expressions, because the defect is a SHAPE of code
 * and a literal string is both clearer to read here and impossible to get
 * subtly wrong with escaping.
 */

const source = fs.readFileSync(locate("document-commands.js"), "utf8");

const compact = source.replace(/\s+/g, " ");

console.log("\n  open asks first, then shows the launcher\n");

check(
  "Open shows the Datum launcher, not the operating system panel",
  source.includes("enggOpenPopup.openOpenPopup("),
  "the launcher is never opened",
);

check(
  "the launcher is shown FIRST, so browsing templates prompts nothing",
  source.indexOf("openOpenPopup()") > -1 &&
    source.indexOf("openOpenPopup()") <
      source.indexOf("confirmDiscardUnsavedChanges(", source.indexOf("openOpenPopup()")),
  "the guard must run per choice, not before the launcher",
);

check(
  "adding a template is NOT guarded, because it replaces nothing",
  source.includes("addTemplateFromFile()") &&
    !/confirmDiscardUnsavedChanges\(\s*\(\)\s*=>\s*addTemplateFromFile/.test(
      source,
    ),
  "+ Add Template must not ask about unsaved changes",
);

check(
  "each launcher choice is carried out through the guard",
  compact.includes(
    "confirmDiscardUnsavedChanges( () => openTemplate(choice.id) )",
  ) &&
    compact.includes(
      "confirmDiscardUnsavedChanges( () => openRecentFile(choice.entry) )",
    ) &&
    compact.includes(
      "confirmDiscardUnsavedChanges( () => importDrawingFile() )",
    ),
  "a launcher choice is carried out without the guard",
);

check(
  "the guard is never handed an empty action that returns early",
  !compact.includes("confirmDiscardUnsavedChanges( () => {} ); return"),
  "an empty action followed by an early return is the original defect",
);

/*
 * IMPORT ACTUALLY READS AND APPLIES THE FILE, through the one loader.
 */
check(
  "the imported file is read",
  source.includes("readAsText(file)"),
  "the file is never read",
);

check(
  "and the text is parsed and applied through loadDrawing",
  /loadDrawing\(\s*parsed,\s*name\s*\)/.test(source),
  "the parsed file never reaches loadDrawing",
);

check(
  "there is ONE document pipeline, not a second way in",
  (source.match(/enggDocumentFile\.readDocument\(/g) || []).length === 2 &&
    (source.match(/loadDrawing\(/g) || []).length >= 3,
  "open, recent, recovery and templates must all use the same loader",
);

/*
 * A BROKEN FILE CHANGES NOTHING. The parse failure returns false rather than
 * throwing, so the drawing the user already has survives a damaged file.
 */
check(
  "an unparseable file is reported and changes nothing",
  /catch\s*\(error\)\s*\{[\s\S]{0,320}return false;/.test(source),
  "a parse failure does not return cleanly",
);

/*
 * THE LAUNCHER ITSELF HAS THE THREE SECTIONS THE DESIGN CALLS FOR.
 */
console.log("\n  the launcher offers Templates, Recent and Import\n");

const popup = fs.readFileSync(locate("open-popup.js"), "utf8");

check(
  "it builds a Templates section",
  popup.includes('section("Templates")'),
  "no Templates section",
);

check(
  "it builds a Recent section",
  popup.includes('section("Recent")'),
  "no Recent section",
);

check(
  "it offers Import .enggdraw as an action",
  popup.includes("Import .enggdraw"),
  "no Import action",
);

check(
  "it offers Cancel",
  popup.includes('label: "Cancel"'),
  "no Cancel action",
);

/*
 * TEMPLATES ARE USER-CREATED, AND THE LIBRARY STARTS EMPTY.
 *
 * Datum ships no example drawings. A template exists only because the user made
 * one from an .enggdraw, and the stored entry holds a COPY of that document's
 * model - not a path to the file, which could be moved or deleted.
 */
console.log("\n  templates are user-created and start empty\n");

const templates = fs.readFileSync(locate("templates.js"), "utf8");

check(
  "the library ships NO built-in templates",
  !templates.includes('id: "blank"') &&
    !templates.includes('id: "statics"') &&
    !templates.includes('id: "diagrams"'),
  "Datum must not pre-populate the template library",
);

check(
  "a template stores the DOCUMENT, not a file path",
  templates.includes("document:") &&
    !templates.includes("sourceFilePath"),
  "a template must keep working after its source is moved or deleted",
);

check(
  "adding a template copies the document",
  /addTemplate[\s\S]{0,600}document: JSON\.parse\(JSON\.stringify\(document\)\)/.test(
    templates,
  ),
  "the stored template must be an independent copy",
);

check(
  "using a template copies it, so the template can never be edited by use",
  /function copyDocumentFor[\s\S]{0,400}JSON\.parse\(JSON\.stringify\(document\)\)/.test(
    templates,
  ),
);

check(
  "deleting a template deletes only the stored copy",
  /function deleteTemplate[\s\S]{0,400}writeAll\(remaining\)/.test(templates) &&
    !/deleteTemplate[\s\S]{0,400}unlink|\.remove\(\)/.test(templates),
  "deleting a template must never touch the user's .enggdraw",
);

check(
  "the popup shows an empty state when there are no templates",
  fs
    .readFileSync(locate("open-popup.js"), "utf8")
    .includes('"No templates yet."'),
);

check(
  "and offers + Add Template",
  fs
    .readFileSync(locate("open-popup.js"), "utf8")
    .includes("+ Add Template"),
);

/*
 * RECENTS KEEP A REOPENABLE REFERENCE, AND ARE CAPPED.
 */
console.log("\n  recents keep what is needed to reopen\n");

const recents = fs.readFileSync(locate("recent-files.js"), "utf8");

check(
  "a recent stores the document, so it can reopen without a handle",
  recents.includes("document: storableDocument(document)"),
  "a recent must keep the document it can reopen",
);

check(
  "a recent stores a real file handle when the browser gave one",
  /handle:\s*handle \|\|/.test(recents),
  "the handle is not kept",
);

check(
  "the list is capped",
  /MAX_RECENTS\s*=\s*\d+/.test(recents) &&
    recents.includes("entries.length > MAX_RECENTS"),
  "recents can grow without limit",
);

check(
  "a missing file is marked, not deleted",
  recents.includes("function markMissing"),
  "a moved file would silently vanish from the list",
);

/*
 * THE NATIVE FORMAT IS NAMED AS THE FORMAT, NOT AS THE APPLICATION.
 */
console.log("\n  the file type is named DAETUM drawing (*.tex)\n");

const fileSave = fs.readFileSync(locate("file-save.js"), "utf8");

check(
  "the document type is labelled DAETUM drawing (*.tex)",
  fileSave.includes('label: "DAETUM drawing (*.tex)"'),
  "the native type must name the format and its extension",
);

check(
  "and it is NOT labelled with the product name",
  !fileSave.includes("Datum drawing") &&
    !fileSave.includes("Datum Drawing") &&
    !fileSave.includes("Datum File") &&
    !fileSave.includes("DAETUM Drawing") &&
    !fileSave.includes("DAETUM File"),
  "the software is Datum; the format is EnggDraw",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
