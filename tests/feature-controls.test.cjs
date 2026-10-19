/*
 * ========================================================
 * FEATURE CONTROLS: LOCK AND CONSTRAIN
 * ========================================================
 *
 * THE LOCK stops a feature being MOVED. It is deliberately narrow:
 *
 *   - a locked feature is still selectable, still inspectable, still listed
 *   - its properties are still editable through the panel
 *   - unlocking restores normal movement
 *   - the flag travels with the document, so a lock survives Save and Open
 *
 * A lock that also made a feature unselectable or uneditable would not be a
 * lock; it would be a way to lose access to your own drawing.
 *
 * THE CONSTRAIN TOGGLE is checked here too, because the two controls live
 * beside each other and the same mistake would apply to either: a constraint
 * must be REMOVABLE. Checking it pins a value; unchecking it must delete the
 * pin, not leave a constraint that can never be cleared.
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

const drag = fs.readFileSync(locate("drag.js"), "utf8");
const markup = fs.readFileSync(locate("feature-panel-markup.js"), "utf8");

/*
 * THE FIXED TOGGLE'S WRITE PATH LIVES IN THE FEATURE SCHEMA NOW.
 *
 * The old panel bound its own checkbox in `property-binding.js`, which was
 * deleted with that panel. The inspector's Features pane declares `fixed` once -
 * a toggle whose `write` sets `object.locked` - and the pane commits whatever a
 * field writes. So the two things worth asserting are the schema's declaration
 * and the pane's single commit path.
 */
const schema = fs.readFileSync(locate("feature-schema.js"), "utf8");
const editor = fs.readFileSync(locate("features-editor.js"), "utf8");

console.log("\n  the lock stops movement, and only movement\n");

check(
  "a locked feature is refused a manipulation drag",
  /locked[\s\S]{0,400}return false;/.test(drag),
  "the drag entry point does not check the lock",
);

check(
  "the refusal is made at the ONE place every drag begins",
  /export function beginManipulationDrag[\s\S]{0,3000}?\blocked\b/.test(drag),
  "checking per handle would miss a handle added later",
);

check(
  "the user is told why nothing moved",
  /is locked\. Unlock it to move it\./.test(drag),
);

check(
  "the lock does NOT filter the feature out of hit testing",
  !/locked[\s\S]{0,200}objectAtPoint[\s\S]{0,200}return null/.test(drag),
  "a locked feature must stay selectable",
);

console.log("\n  the lock is a document property\n");

check(
  "the panel shows a lock control",
  markup.includes("data-feature-lock"),
);

check(
  "the control reflects the feature's own state, so it cannot lie",
  /object\.locked \? "checked" : ""/.test(markup),
  "the checkbox must be driven by the feature",
);

check(
  "the lock is placed with POSITION, not beside the name",
  /lockRow\(\)/.test(markup) &&
    /rows\.push\(lockRow\(\)\)/.test(markup) &&
    !/featureHeaderMarkup[\s\S]{0,900}data-feature-lock/.test(markup),
  "Locked controls whether a feature can be repositioned, so it belongs to POSITION",
);

check(
  "the lock checkbox is ALWAYS rendered, and only its state changes",
  !/data-feature-lock[\s\S]{0,200}locked \? "" :/.test(markup),
  "a persistent control must never be mounted/unmounted by its own state",
);

check(
  "toggling it is ONE committed change",
  /commitDrawingChange\(drawingState, previous\)/.test(editor),
  "the pane must commit what a field writes, once",
);

check(
  "the flag is a plain document field, so it is saved with the drawing",
  /object\.locked = true/.test(schema) && /delete object\.locked/.test(schema),
  "the lock is not stored on the feature itself",
);

console.log("\n  a constraint can be removed again\n");

check(
  "unchecking a constrain control DELETES the pin",
  /delete object\.locked/.test(schema),
  "a lock that cannot be cleared is not a toggle",
);

check(
  "and a pinned triangle value is preserved elsewhere",
  /constraints\[\s*`\$\{sideKey\}Value`\s*\]/.test(
    fs.readFileSync(locate("triangle-editing.js"), "utf8"),
  ),
  "a cleared pin must not lose the value it was pinned to",
);

console.log("\n  a constraint control is PERSISTENT\n");

{
  const markupSource = fs.readFileSync(locate("feature-panel-markup.js"), "utf8");

  check(
    "the constrain control is rendered whether or not it is checked",
    !/fixed\(key\) \? "" : fixBox/.test(markupSource) &&
      /state: fixBox\(key, label\)/.test(markupSource),
    "hiding the control when it is checked is what made it disappear",
  );

  check(
    "its tooltip names the action it will perform",
    /Unconstrain \$\{label\}/.test(markupSource) &&
      /Constrain \$\{label\}/.test(markupSource),
    "the control must say what clicking it does",
  );
}

console.log("\n  a context menu does not close the surface behind it\n");

{
  const ui = fs.readFileSync(locate("ui.js"), "utf8");

  check(
    "the context menu is NOT built on the modal dialog",
    /function openContextMenu[\s\S]{0,900}closeContextMenu\(\)/.test(ui) &&
      !/function openContextMenu[\s\S]{0,900}openDialog\(/.test(ui),
    "a dialog would close the Open launcher before the menu appeared",
  );

  check(
    "it has no backdrop, so nothing behind it is dismissed or blocked",
    !/engg-context-menu[\s\S]{0,200}backdrop/.test(ui),
  );

  check(
    "it dismisses on Escape without touching anything else",
    /onKeyDown[\s\S]{0,300}Escape[\s\S]{0,200}closeContextMenu\(\)/.test(ui),
  );

  const popup = fs.readFileSync(locate("open-popup.js"), "utf8");

  check(
    "the three-dot button stops its click reaching the card or the backdrop",
    /datum-open-template-menu[\s\S]{0,700}stopPropagation\(\)/.test(popup) &&
      /datum-open-recent-menu[\s\S]{0,700}stopPropagation\(\)/.test(popup),
    "the click must not open the file, use the template, or close the launcher",
  );

  check(
    "a MISSING file still has a menu, so it can be removed",
    /datum-open-recent-menu/.test(popup) &&
      !/if \(entry\.missing\)[\s\S]{0,200}datum-open-recent-menu/.test(popup),
    "removal must not depend on the file being reachable",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
