/*
 * ========================================================
 * SELECTING SEVERAL RECENT FILES
 * ========================================================
 *
 * A recents list accumulates. Removing files one at a time is tedious, so the
 * list can gather several and act on them together.
 *
 * THE ONE RULE THAT MAKES THIS SAFE: SELECTION IS A SEPARATE MODE, NOT A
 * MODIFIER ON OPENING. A row's normal click OPENS the file. While selection mode
 * is on, that same click SELECTS instead - one or the other, never both - so
 * multi-selection is possible without making opening unpredictable.
 *
 * And the two destructive-sounding actions are kept strictly apart:
 *
 *   Remove from Recents   touches Datum's record ONLY. Works when the file is
 *                         missing, because it never needs the file.
 *   Delete File           the real thing, confirmed by the caller.
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

const popup = fs.readFileSync(locate("open-popup.js"), "utf8");

console.log("\n  selection is its own mode\n");

check(
  "there is a control that enters selection mode",
  /datum-open-select-toggle/.test(popup) &&
    /onEnterSelection/.test(popup),
);

check(
  "a row-click SELECTS while selecting, and OPENS otherwise",
  /if \(handlers\.selecting\) \{[\s\S]{0,400}recentSelection\.add\(entry\.key\)[\s\S]{0,400}return;[\s\S]{0,200}handlers\.onOpenRecent\(entry\)/.test(
    popup
  ),
  "a click must never be both",
);

check(
  "checkboxes appear ONLY while selecting",
  /if \(handlers\.selecting\) \{\s*\n\s*wrapper\.appendChild\(selectionToggle\(entry, handlers\)\)/.test(
    popup
  ),
);

check(
  "the checkbox does not also trigger the row",
  /input\.addEventListener\("click", \(event\) =>[\s\S]{0,200}event\.stopPropagation\(\)/.test(
    popup
  ),
);

console.log("\n  the bulk actions offered depend on what is selected\n");

check(
  "the count is shown",
  /datum-open-selection-count/.test(popup) &&
    /\$\{chosen\.length\} selected/.test(popup),
);

check(
  "Select All, Remove, Clear Selection and Done are always offered",
  /"Select All"/.test(popup) &&
    /"Remove"/.test(popup) &&
    /"Clear Selection"/.test(popup) &&
    /"Done"/.test(popup),
);

check(
  "Delete is offered ONLY when something can actually be deleted",
  /chosen\.some\(\(entry\) => !entry\.missing\)/.test(popup),
  "a missing file cannot be deleted, so the control must not promise it",
);

console.log("\n  removing a recent touches the record, never the file\n");

check(
  "Remove forgets each key, and deletes nothing",
  /onRemoveSelected: \(keys\) => \{[\s\S]{0,200}enggRecentFiles\.forget\(key\)/.test(
    popup
  ) &&
    !/onRemoveSelected[\s\S]{0,300}(delete|remove)File|unlink/.test(popup),
);

check(
  "it works for a MISSING file, because it never opens one",
  !/onRemoveSelected[\s\S]{0,300}(open|read|getFile)\(/.test(popup),
);

check(
  "Delete File is handed to the caller to confirm",
  /onDeleteSelected: \(keys\) =>\s*\n?\s*choose\(\{ action: "delete-recents", keys \}\)/.test(
    popup
  ),
);

console.log("\n  the selection cannot outlive the rows it refers to\n");

check(
  "a key no longer on the list is dropped when the list is rebuilt",
  /const live = new Set\([\s\S]{0,200}\)[\s\S]{0,300}if \(!live\.has\(key\)\)[\s\S]{0,120}recentSelection\.delete\(key\)/.test(
    popup
  ),
  "a removed file must not stay selected",
);

check(
  "selection mode starts OFF each time the popup opens",
  /let selectionActive = false;\s*\n\s*recentSelection\.clear\(\)/.test(popup),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
