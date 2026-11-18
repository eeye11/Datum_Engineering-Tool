/*
 * ========================================================
 * DOUBLE-CLICKING A NOTE OPENS ITS TEXT BOX
 * ========================================================
 *
 * The fault: a Note is placed as an EMPTY box with the message
 * "double-click to write it", and the double-click did nothing. The canvas
 * double-click handler recognised the annotation, stopped the event, and
 * then opened an editor only for a DIMENSION - so a note was left empty
 * with no way to fill it.
 *
 * The fix has two halves, and each is checked here:
 *
 *   1. the drawing controller routes a written annotation to a note editor
 *      (and refuses to open one on a GENERATED annotation, whose text is a
 *      reading of its feature);
 *   2. the note editor itself edits the text and hands it back as one
 *      change, so the caller can commit it as one undoable action.
 *
 * The editor is exercised through a real DOM, because it IS a DOM object.
 */

const fs = require("fs");
const { JSDOM } = require("jsdom");

const { controllerSource, loadModule } = require("./helpers/source-path.cjs");

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
});

global.window = dom.window;
global.document = dom.window.document;

loadModule("note-editor.js");

const editor = global.window.enggNoteEditor;

console.log("\n  the editor opens, edits and returns the text\n");

{
  let applied = null;

  editor.open({
    text: "Original note",
    onApply: (text) => {
      applied = text;
    },
  });

  check("the editor is open", editor.isOpen() === true);

  const field = document.querySelector("#noteText");

  check(
    "it shows the note's current text",
    field && field.value === "Original note",
    field ? JSON.stringify(field.value) : "no field",
  );

  /*
   * THE STUDENT TYPES, THEN CONFIRMS WITH ENTER.
   *
   * There are no Apply/Cancel buttons any more: the field IS the editor, and
   * Enter is the commit key. That is the one keyboard every canvas text field
   * shares.
   */
  field.value = "First line\nSecond line";

  field.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  check(
    "confirming hands the typed text back verbatim, line breaks included",
    applied === "First line\nSecond line",
    JSON.stringify(applied),
  );

  check("and the editor closes", editor.isOpen() === false);
}

console.log("\n  Shift+Enter inserts a line; Enter confirms\n");

{
  let applied = null;

  editor.open({
    text: "",
    onApply: (text) => {
      applied = text;
    },
  });

  const field = document.querySelector("#noteText");

  /* Shift+Enter must NOT close the box - it inserts a line. */
  field.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );

  check(
    "Shift+Enter does not confirm, so a note can have line breaks",
    editor.isOpen() === true && applied === null,
  );

  field.value = "Done";

  field.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );

  check(
    "Enter confirms the note",
    applied === "Done" && editor.isOpen() === false,
    JSON.stringify(applied),
  );
}

console.log("\n  Escape cancels without applying\n");

{
  let applied = null;
  let cancelled = 0;

  editor.open({
    text: "Keep me",
    onApply: (text) => {
      applied = text;
    },
    onCancel: () => {
      cancelled += 1;
    },
  });

  document.querySelector("#noteText").dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );

  check(
    "cancelling applies nothing",
    applied === null && cancelled === 1,
    `applied ${JSON.stringify(applied)}, cancelled ${cancelled}`,
  );

  check("and the editor closes", editor.isOpen() === false);
}

console.log("\n  an empty note is a legitimate edit\n");

{
  let applied = null;

  editor.open({
    text: "Something",
    onApply: (text) => {
      applied = text;
    },
  });

  const empty = document.querySelector("#noteText");

  empty.value = "";

  empty.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  check(
    "clearing a note confirms an empty string rather than being refused",
    applied === "",
    JSON.stringify(applied),
  );
}

console.log(
  "\n  the controller routes a note to this editor and nothing else\n",
);

{
  /*
   * The controller is split across the modules under src/editor/ - the
   * double-click routing in canvas-events.js, openNoteEditorFor in
   * canvas-click.js, Escape in keyboard-shortcuts.js - so the checks
   * below read the controller as one source rather than one file.
   */
  const code = controllerSource();

  check(
    "a written annotation opens the note editor",
    /function openNoteEditorFor/.test(code) &&
      /enggNoteEditor\?\.open/.test(code),
  );

  check(
    "and a GENERATED annotation is refused one",
    /isGenerated\(object\.annotationKind\)/.test(code),
  );

  check(
    "the canvas double-click handler reaches it",
    /openNoteEditorFor\(pointed\)/.test(code),
  );

  /*
   * THE GUARD THAT WAS THE BUG. It named dimensions only, so an
   * annotation fell through to the branch below - which stopped the event
   * and opened no editor, leaving an empty note with no way to write in
   * it. The guard must name annotations too.
   */
  check(
    "an unselected annotation is selected first, not swallowed",
    /pointed\?\.type === "annotation"[\s\S]{0,200}selectedObjectIds\.includes/.test(
      code,
    ),
    "the unselected-feature guard still names dimensions only",
  );

  check(
    "and Escape reaches the note editor like the other dialogs",
    /enggNoteEditor\?\.handleEscape/.test(code),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
