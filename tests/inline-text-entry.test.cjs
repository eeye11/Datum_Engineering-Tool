/*
 * ============================================================
 * ONE TEXT EDITOR, ON THE DRAWING
 * ============================================================
 *
 * The correction this suite holds to:
 *
 *   NO POPUP. Text that appears on the drawing is typed ON the drawing. There
 *   is no modal editor, no `window.prompt`, no `<dialog>` asking for a label,
 *   and no second, private `<input>` for an axis name.
 *
 *   ONE EDITOR. A note, a label, a callout, an equation, a Heat notation, an
 *   axis name and a block's name all go through `note-editor.js`, so the caret,
 *   the appearance, the commit and the undo entry are the same everywhere.
 *
 *   ONE KEYBOARD. Enter commits; Shift+Enter adds a line; Escape cancels; an
 *   empty field never becomes an empty object.
 *
 *   ONE PROPERTY. Committed text lands on the object's `text` (an annotation) or
 *   its `label` (a feature's drawn text) - never on a duplicate object, and the
 *   Features row reads the same value.
 *
 * The structural checks are on the SOURCE and on the MODEL: a headless DOM has
 * no laid-out canvas, and "the editor opened somewhere" is exactly the check
 * that would pass while the popup was still there.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, document, error } = bootApp();
if (error) throw error;

let model;
let state;

const source = (name) => fs.readFileSync(locate(name), "utf8");

before(async () => {
  await whenReady();

  model = require(locate("drawing-state.js")).default;
  state = require(locate("editor-state.js")).drawingState;
});

after(() => window.close());

/* ====================================================== no popups remain */

test("the editor has no modal text-entry path left", () => {
  const editor = source("note-editor.js");

  /*
   * THE MODAL FALLBACK IS GONE - not merely unused. `openModal` built a
   * `drawing-note-dialog` with a title, a field and Apply/Cancel buttons, and it
   * is exactly the interface the correction removes.
   */
  assert.doesNotMatch(editor, /function openModal/, "the modal editor is gone");
  assert.doesNotMatch(editor, /drawing-dimension-dialog|drawing-scale-dialog-actions/, "and its markup with it");
  assert.doesNotMatch(editor, /aria-modal/, "nothing claims to be a modal");
});

test("no text editor is built inline in another module", () => {
  /*
   * A SECOND EDITOR IS A SECOND KEYBOARD. The Thermodynamics axis-name editor
   * used to create its own `<input>` with its own keys and its own commit; it
   * now opens the shared field.
   */
  const axis = source("axis-label-editor.js");

  assert.doesNotMatch(
    axis,
    /createElement\("input"\)/,
    "the axis editor builds no input of its own",
  );
  assert.match(axis, /noteEditor|note-editor\.js/, "it uses the shared editor");
});

test("no tool asks for canvas text through the browser's prompt", () => {
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.name.endsWith(".js")) continue;

      const text = fs.readFileSync(full, "utf8");

      /*
       * A CALL TO A BARE `prompt(`, where the character before it is not part
       * of a longer NAME. `placePrompt(` has a capital P, and a definition is
       * `function prompt(`, so neither is the browser's box.
       */
      /*
       * COMMENTS ARE PROSE. `// ... the prompt (label, hint) ...` mentions the
       * word without calling anything, so they are removed before searching.
       */
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

      const calls = [...code.matchAll(/(^|[^A-Za-z0-9_$.])prompt\s*\(/gm)].filter((match) => {
        const before = code.slice(Math.max(0, match.index - 20), match.index);

        return !/function\s+[A-Za-z0-9_$]*$/.test(before);
      });

      if (calls.length) {
        offenders.push(full);
      }
    }
  };

  walk(locate("note-editor.js").replace(/[\\/][^\\/]+$/, ""));

  assert.deepEqual(
    offenders,
    [],
    `a tool still calls prompt(): ${offenders.join(", ")}`,
  );
});

test("the block tool asks for node counts, not for the block's name", () => {
  const plant = source("plant-tool.js");

  /*
   * REQUIREMENT 8: numeric configuration keeps its interface. What must not
   * remain is a TEXT field in that dialog - the block's name is canvas text and
   * is typed on the block.
   */
  assert.doesNotMatch(
    plant,
    /name="plantLabel"[^>]*type="text"/,
    "no name field in the dialog",
  );
  assert.doesNotMatch(
    plant,
    /name="blockLabel"[^>]*type="text"/,
    "no block-label field either",
  );
  assert.match(
    plant,
    /nameBlockOnCanvas/,
    "the name is typed on the drawing instead",
  );
  assert.match(
    plant,
    /type="number"/,
    "the node counts keep a numeric interface",
  );
});

/* ================================================= one keyboard in the field */

test("Enter commits, Shift+Enter does not, Escape cancels", () => {
  const editor = source("note-editor.js");

  /*
   * The shared handler is the only place these keys are decided, so it is the
   * place to hold to the rule.
   */
  assert.match(editor, /event\.key === "Escape"/, "Escape is handled");
  assert.match(
    editor,
    /if \(event\.shiftKey\)\s*\{\s*return;/,
    "Shift+Enter returns before a commit",
  );
  assert.match(editor, /event\.key !== "Enter"/, "Enter is the commit key");
});

test("the label field is multiline, so a line break survives", () => {
  const editor = source("note-editor.js");

  /* `fieldMarkup(true, ...)` - the multiline builder - is what opens a label. */
  assert.match(
    editor,
    /host\.innerHTML = fieldMarkup\(\s*true,/,
    "the label field is built as a multiline field",
  );
});

/* ============================================ the committed text is stored */

test("a placed note's text is the object's text, and the Features row reads it", () => {
  const schema = require(locate("feature-schema.js"));

  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;

  const previous = model.snapshotDrawing(state);

  const note = model.addObject(
    state,
    model.geometryFactories.annotate({
      kind: "note",
      text: "",
      position: { x: 0, y: 0 },
    }),
  );

  model.commitDrawingChange(state, previous);

  /* What the inline field's commit does. */
  note.text = "Line one\nLine two";
  note.label = note.text;

  assert.equal(schema.readField(note, "label"), "Line one\nLine two");

  /*
   * NO DUPLICATE. Committing text updates the object in place; it does not
   * create a second object to hold the words.
   */
  assert.equal(
    state.objects.filter((object) => object.type === "annotate").length,
    1,
  );
});

test("a feature's drawn label is its own property, and the panel writes the same one", () => {
  const schema = require(locate("feature-schema.js"));

  const line = model.geometryFactories.line({ x: 0, y: 0 }, { x: 10, y: 0 });
  const nameBefore = line.name;

  assert.equal(schema.fieldDefinition("label").write(line, "w = 5 kN/m"), true);

  assert.equal(line.label, "w = 5 kN/m", "the drawn label");
  assert.equal(line.name, nameBefore, "and the object's name is untouched");

  assert.equal(
    schema.readField(line, "label"),
    "w = 5 kN/m",
    "the Features row agrees",
  );
});

test("a block's name is canvas text stored on the object, not a second object", () => {
  const plant = source("plant-tool.js");

  /* The commit writes the metadata the painter reads. */
  assert.match(
    plant,
    /metadata = \{ \.\.\.\(target\.metadata \|\| \{\}\), \[key\]: next \}/,
  );
  assert.match(plant, /const key = isPlant \? "plantLabel" : "blockLabel"/);
});

/* ======================================= the formatting disclosure is separate */

test("text formatting is a closed disclosure under the Label row, not part of entry", () => {
  const pane = source("features-editor.js");

  /* It is appended AFTER the label row ... */
  assert.match(
    pane,
    /key === "label" \? row \+ textFormattingMarkup\(objects\) : row/,
  );

  /* ... it is closed unless opened ... */
  assert.match(pane, /const open = expandedFeatureSections\.has\(id\)/);
  assert.match(pane, /\$\{open \? "" : " hidden"\}/);

  /* ... and it appears only when there is text to format. */
  assert.match(pane, /function hasDisplayedText/);
  assert.match(
    pane,
    /if \(!objects\.length \|\| !objects\.every\(hasDisplayedText\)\)/,
  );

  /* Nothing in the entry path reaches for a formatting control. */
  const editor = source("note-editor.js");
  assert.doesNotMatch(
    editor,
    /noteBold|noteFont|text-formatting/,
    "the editor carries no formatting UI",
  );
});

/* ============================================================ persistence */

test("committed text survives save and reopen", () => {
  state.objects.length = 0;

  const previous = model.snapshotDrawing(state);

  const note = model.addObject(
    state,
    model.geometryFactories.annotate({
      kind: "note",
      text: "",
      position: { x: 0, y: 0 },
    }),
  );

  model.commitDrawingChange(state, previous);

  note.text = "Multi\nline";
  note.label = note.text;

  const saved = JSON.parse(model.serializeDrawing(state));

  assert.equal(
    saved.objects.find((object) => object.id === note.id).text,
    "Multi\nline",
  );

  const reopened = model.createDrawingState();

  model.restoreDocument(reopened, saved);

  assert.equal(
    reopened.objects.find((object) => object.id === note.id).text,
    "Multi\nline",
    "the line break is preserved through a save and a load",
  );
});

void document;
