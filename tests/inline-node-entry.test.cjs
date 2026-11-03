/* eslint-disable no-console */
/*
 * ========================================================
 * INLINE NODE ENTRY
 * ========================================================
 *
 * The contract this suite holds the node-entry prompt to:
 *
 *   1. It is a SMALL FIELD beside the node, not a full-screen dialog - and the
 *      drawing is not dimmed, replaced or hidden by it.
 *   2. It is anchored to the node in DRAWING space, projected through the live
 *      camera, so it sits on the node at any zoom and pan.
 *   3. It stays inside the window when the node is near an edge, without the
 *      node's own coordinates changing.
 *   4. The field is focused as it opens, typing does not reach the canvas, and
 *      Enter commits / Escape cancels as the existing keyboard rules say.
 *   5. Typing is previewed at the node, and nothing is stored until commit.
 *   6. The committed text becomes the feature's text - one undoable change -
 *      and the preview and prompt are gone afterwards.
 *   7. Repeated entry never leaves a second prompt or a duplicate node.
 *   8. A caller with no node to point at still gets the working modal fallback.
 *
 * The editor is exercised through a real DOM, because it IS a DOM object; the
 * projection is exercised directly, because it is pure geometry.
 */

const { JSDOM } = require("jsdom");

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

/* ------------------------------------------------------------------ window */

const CANVAS = { left: 100, top: 50, width: 800, height: 600 };

const dom = new JSDOM(
  '<!doctype html><html><body><div class="drawing-canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;

/*
 * A KNOWN VIEWPORT. The placement rules are about edges, so the size the tests
 * reason about is stated here rather than assumed - and it is read back from
 * the window the editor itself sees, so the two can never disagree.
 */
const VIEWPORT = {
  width: dom.window.innerWidth,
  height: dom.window.innerHeight,
};

const canvas = dom.window.document.querySelector(".drawing-canvas");

canvas.getBoundingClientRect = () => ({
  left: CANVAS.left,
  top: CANVAS.top,
  right: CANVAS.left + CANVAS.width,
  bottom: CANVAS.top + CANVAS.height,
  width: CANVAS.width,
  height: CANVAS.height,
  x: CANVAS.left,
  y: CANVAS.top,
});

Object.defineProperty(canvas, "clientWidth", { value: CANVAS.width });
Object.defineProperty(canvas, "clientHeight", { value: CANVAS.height });

/*
 * jsdom does not lay out boxes, so an inline prompt measures 0x0. The editor
 * needs a real size to decide which side of the node it fits on, so the box is
 * given one - the same `offsetWidth`/`offsetHeight` a browser would report for
 * a 260px prompt.
 */
const PROMPT_SIZE = { width: 260, height: 44 };

Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get() {
    return this.classList && this.classList.contains("drawing-inline-entry")
      ? PROMPT_SIZE.width
      : 0;
  },
});

Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    return this.classList && this.classList.contains("drawing-inline-entry")
      ? PROMPT_SIZE.height
      : 0;
  },
});

const { loadModule } = require("./helpers/source-path.cjs");

const entry = loadModule("inline-text-entry.js");

loadModule("note-editor.js");

/* The editor is the default export the application publishes. */
const editor = dom.window.enggNoteEditor;

/* ---------------------------------------------------------------- helpers */

const BASE = 2.4;

const camera = (zoom = 1, panX = 0, panY = 0) => ({ zoom, panX, panY });

const projectionFor = (view = camera()) =>
  entry.createProjection(view, { width: CANVAS.width, height: CANVAS.height }, BASE);

const openPrompts = () => dom.window.document.querySelectorAll(".drawing-inline-entry");

const previews = () => dom.window.document.querySelectorAll(".drawing-inline-entry-preview");

const modal = () => dom.window.document.querySelector(".drawing-dimension-dialog");

const keydown = (element, key, extra = {}) =>
  element.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...extra,
    }),
  );

const typeInto = (field, value) => {
  field.value = value;

  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

/* A written note, as the model builds one. */
function note(overrides = {}) {
  return {
    id: "annotate-001",
    type: "annotate",
    annotateKind: "note",
    name: "Note 1",
    text: "",
    geometry: { position: { x: 0, y: 0 } },
    style: { stroke: "#193335", fontSize: 12 },
    ...overrides,
  };
}

/* ============================================================ 1. the maths */

console.log("\nThe node and the prompt agree about where they are");
console.log("---------------------------------------------------");

{
  /* A drawing point at the canvas centre is the canvas centre, at any zoom. */
  [0.5, 1, 2, 4].forEach((zoom) => {
    const p = projectionFor(camera(zoom)).toPixels({ x: 0, y: 0 });

    check(
      `at zoom ${zoom} the origin is the canvas centre`,
      Math.abs(p.x - CANVAS.width / 2) < 1e-9 && Math.abs(p.y - CANVAS.height / 2) < 1e-9,
      JSON.stringify(p),
    );
  });

  const world = { x: 40, y: -25 };
  const view = camera(1.5, 10, -4);
  const screen = projectionFor(view).toPixels(world);
  const back = projectionFor(view).toWorld(screen);

  check(
    "a point and the projection of it are the same place, there and back",
    Math.abs(back.x - world.x) < 1e-9 && Math.abs(back.y - world.y) < 1e-9,
    JSON.stringify(back),
  );

  /* Y is up in the drawing and down on the screen - the camera flips it once. */
  const up = projectionFor(camera()).toPixels({ x: 0, y: 10 });

  check(
    "a higher point is higher on the screen",
    up.y < projectionFor(camera()).toPixels({ x: 0, y: 0 }).y,
  );
}

{
  /* Zoom and pan both move the prompt with the node - not away from it. */
  const object = note({ geometry: { position: { x: 25, y: 33 } } });
  const world = entry.modelPointForTextEntry(object);

  check("a note writes at its placement", world && world.x === 25 && world.y === 33, JSON.stringify(world));

  const at1 = entry.clientPointForObject(object, { camera: camera(1) });
  const at2 = entry.clientPointForObject(object, { camera: camera(2) });
  const atPan = entry.clientPointForObject(object, { camera: camera(1, 50, -20) });

  check(
    "the prompt is offset from the canvas centre by the node's real distance",
    Math.abs(at1.x - CANVAS.left - CANVAS.width / 2 - 25 * BASE) < 1e-6 &&
      Math.abs(at1.y - CANVAS.top - CANVAS.height / 2 + 33 * BASE) < 1e-6,
    JSON.stringify(at1),
  );

  check(
    "twice the zoom moves it twice as far from the centre",
    Math.abs(at2.x - (CANVAS.left + CANVAS.width / 2)) >
      Math.abs(at1.x - (CANVAS.left + CANVAS.width / 2)) * 1.9,
    `${JSON.stringify(at1)} vs ${JSON.stringify(at2)}`,
  );

  check(
    "panning moves it by the pan, in pixels",
    Math.abs(atPan.x - at1.x + 50 * BASE) < 1e-6,
    `${JSON.stringify(at1)} vs ${JSON.stringify(atPan)}`,
  );

  check(
    "and the object's own coordinates are not changed by any of it",
    object.geometry.position.x === 25 && object.geometry.position.y === 33,
  );
}

{
  /* Each written kind writes where it is drawn. */
  const leader = entry.modelPointForTextEntry({
    type: "annotate",
    annotateKind: "leader",
    geometry: { start: { x: 0, y: 0 }, end: { x: 12, y: 7 } },
  });

  check("a leader writes at the far end of its pen", leader && leader.x === 12 && leader.y === 7);

  const callout = entry.modelPointForTextEntry({
    type: "annotate",
    annotateKind: "callout",
    geometry: { start: { x: 0, y: 0 }, end: { x: -5, y: 9 } },
  });

  check("a callout does too", callout && callout.x === -5 && callout.y === 9);

  const label = entry.modelPointForTextEntry({
    type: "annotate",
    annotateKind: "label",
    geometry: { start: { x: 3, y: 3 }, position: { x: 30, y: 3 } },
  });

  check(
    "a label writes at its placement, not at the point it marks",
    label && label.x === 30,
    JSON.stringify(label),
  );

  const unknown = entry.modelPointForTextEntry({ type: "mystery", geometry: {} });

  check("an object with no text place reports none", unknown === null);
}

/* ================================================== 2. opening the prompt */

console.log("\nThe prompt opens beside the node, small and in place");
console.log("-----------------------------------------------------");

{
  let applied = null;

  editor.open({
    text: "",
    multiline: false,
    object: note({ geometry: { position: { x: 0, y: 0 } } }),
    camera: camera(1),
    onApply: (text) => {
      applied = text;
    },
  });

  const prompt = openPrompts()[0];

  check("one prompt is open", openPrompts().length === 1 && Boolean(prompt));
  check("and it is the inline one", editor.isInline() === true);
  check("not a modal dialog", modal() === null);

  const left = Number.parseFloat(prompt.style.left);
  const top = Number.parseFloat(prompt.style.top);
  /* Where the editor measured the node: the canvas's box, centre to centre. */
  const canvasBox = canvas.getBoundingClientRect();
  const centreX = canvasBox.left + canvasBox.width / 2;
  const centreY = canvasBox.top + canvasBox.height / 2;

  check(
    "it sits at the node (the canvas centre here), not at a screen corner",
    /*
     * Within a few pixels of the node on each axis - the prompt is offset
     * just far enough not to sit on it, and the browser rounds the box.
     */
    /*
     * BELOW and to the RIGHT of the node, within a prompt's own offset - the
     * field is nudged off the node so the object under it stays visible.
     */
    left > centreX &&
      left - centreX <= 20 &&
      top > centreY &&
      top - centreY <= 20,
    `centre ${centreX},${centreY} / left ${left}, top ${top}`,
  );

  check(
    "the drawing canvas is still in the page and not covered by a shell",
    Boolean(dom.window.document.querySelector(".drawing-canvas")) &&
      prompt.classList.contains("drawing-inline-entry"),
  );

  check(
    "it is a compact field, not a form: one field and no dialog title",
    Boolean(prompt.querySelector("#noteText")) &&
      !prompt.querySelector(".drawing-dimension-dialog-title") &&
      !prompt.querySelector("[data-note-apply]"),
  );

  const field = prompt.querySelector("#noteText");

  check("the field has focus the moment it opens", dom.window.document.activeElement === field);

  /* Typing is previewed at the node; nothing has been committed. */
  typeInto(field, "Assume no slip");

  const preview = previews()[0];

  check(
    "typing is previewed at the node",
    Boolean(preview) && preview.textContent === "Assume no slip" && preview.hidden === false,
    preview && preview.textContent,
  );
  check("the preview is not stored on the feature", applied === null);

  keydown(field, "Enter");

  check("Enter commits the typed text", applied === "Assume no slip", JSON.stringify(applied));
  check("the prompt closes", openPrompts().length === 0 && modal() === null);
  check("and the preview goes with it", previews().length === 0);
}

{
  /* Escape cancels: nothing is applied, nothing is left behind. */
  let applied = null;
  let cancelled = 0;

  editor.open({
    text: "keep",
    multiline: false,
    object: note(),
    camera: camera(1),
    onApply: (text) => {
      applied = text;
    },
    onCancel: () => {
      cancelled += 1;
    },
  });

  const field = dom.window.document.querySelector("#noteText");

  typeInto(field, "discard me");
  keydown(field, "Escape");

  check(
    "Escape cancels without applying",
    applied === null && cancelled === 1,
    `${JSON.stringify(applied)} / ${cancelled}`,
  );
  check("and nothing is left open or previewed", openPrompts().length === 0 && previews().length === 0);
}

{
  /* A note is multi-line: Enter is a newline, Ctrl+Enter commits. */
  let applied = null;

  editor.open({
    text: "",
    multiline: true,
    object: note(),
    camera: camera(1),
    onApply: (text) => {
      applied = text;
    },
  });

  const field = dom.window.document.querySelector("#noteText");

  keydown(field, "Enter");

  check("a plain Enter does not commit a multi-line note", applied === null && editor.isOpen());

  field.value = "line one\nline two";
  keydown(field, "Enter", { ctrlKey: true });

  check("Ctrl+Enter commits it with its line break", applied === "line one\nline two");
}

{
  /* Typing must never reach whatever listens behind the field. */
  editor.open({ text: "", multiline: false, object: note(), camera: camera(1) });

  const field = dom.window.document.querySelector("#noteText");

  let leaked = 0;
  const spy = () => {
    leaked += 1;
  };

  dom.window.document.addEventListener("keydown", spy);

  keydown(field, "l");
  keydown(field, "ArrowLeft");

  dom.window.document.removeEventListener("keydown", spy);

  check("a keystroke in the field does not reach the document's shortcuts", leaked === 0, `${leaked}`);

  let pressed = 0;
  const pressSpy = () => {
    pressed += 1;
  };

  dom.window.document.addEventListener("pointerdown", pressSpy);

  field.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));

  dom.window.document.removeEventListener("pointerdown", pressSpy);

  check("nor does a press in it reach the canvas", pressed === 0, `${pressed}`);

  editor.close();
}

/* ================================================== 3. edges and the camera */

console.log("\nIt stays in the window, and on its node");
console.log("----------------------------------------");

/*
 * The right edge of the CANVAS falls inside the window (the window is wider
 * than the canvas), so the check is "past the canvas's edge", where a prompt
 * placed naively would be drawn over the inspector.
 */
const rightEdge = entry.clientPointForObject(
  note({ geometry: { position: { x: 166.7, y: 0 } } }),
  { camera: camera(1) },
);

check(
  "the node is at the right edge of the canvas",
  Math.abs(rightEdge.x - (CANVAS.left + CANVAS.width)) < 10,
  `${rightEdge.x} vs ${CANVAS.left + CANVAS.width}`,
);

editor.open({
  text: "",
  multiline: false,
  object: note({ geometry: { position: { x: 166.7, y: 0 } } }),
  camera: camera(1),
});

{
  const prompt = openPrompts()[0];
  const left = Number.parseFloat(prompt.style.left);
  const right = left + PROMPT_SIZE.width;

  check(
    "a prompt at the right edge is pulled fully into the window",
    right <= VIEWPORT.width,
    `right ${right} vs window ${VIEWPORT.width}`,
  );
  check(
    "and it is still beside the node rather than at the far side of the screen",
    left < rightEdge.x,
    `${left} vs ${rightEdge.x}`,
  );
}

editor.close();

{
  /*
   * Near the bottom of the window there is no room below the node, so the
   * prompt opens above it. Panned down, the node leaves the canvas's bottom
   * edge - where a prompt placed below it would be off screen entirely.
   */
  const lowNode = { x: 0, y: -150 };
  const bottom = entry.clientPointForObject(note({ geometry: { position: lowNode } }), {
    camera: camera(1),
  });

  editor.open({
    text: "",
    multiline: false,
    object: note({ geometry: { position: lowNode } }),
    camera: camera(1),
  });

  const prompt = openPrompts()[0];
  const top = Number.parseFloat(prompt.style.top);

  check(
    "a prompt at the bottom opens above its node, fully on screen",
    top + PROMPT_SIZE.height <= VIEWPORT.height && top + PROMPT_SIZE.height <= bottom.y,
    `top ${top}, node ${bottom.y}`,
  );

  editor.close();
}

{
  /*
   * Following the camera: a camera announcement re-places the prompt, and
   * closing it unsubscribes - so a closed prompt can never be moved later.
   *
   * The camera is a plain object with a subscription standing in for the
   * canvas's own announcement; the editor is given the subscription, not the
   * numbers, which is the same contract `canvas-render.js` offers.
   */
  const object = note({ geometry: { position: { x: 0, y: 0 } } });
  const cameraNow = camera(1);

  let listener = null;
  let subscribed = 0;
  let unsubscribed = 0;
  let moves = 0;

  editor.open({
    text: "",
    multiline: false,
    object,
    anchor: () => {
      moves += 1;

      return entry.resolveTextEntryAnchor(object, { camera: cameraNow })?.rect;
    },
    cameraSignal: (fn) => {
      listener = fn;
      subscribed += 1;

      return () => {
        unsubscribed += 1;
      };
    },
  });

  const prompt = openPrompts()[0];
  /*
   * The node is at the drawing's origin - the canvas centre - so a zoom alone
   * does not move it. Panning does, and the prompt must pan with it.
   */
  const before = Number.parseFloat(prompt.style.left);

  cameraNow.panX = -40;
  listener?.();

  const after = Number.parseFloat(prompt.style.left);

  check(
    "the prompt follows its node when the camera changes",
    after !== before,
    `${before} -> ${after}`,
  );
  check("it is re-read through the camera, not remembered", moves >= 2, `${moves}`);
  check("it subscribed once", subscribed === 1, `${subscribed}`);

  editor.close();

  check("closing it stops following the camera", unsubscribed === 1, `${unsubscribed}`);
}

/* ================================================== 4. commit and repeat */

console.log("\nWhat is committed is the feature's text, once");
console.log("-----------------------------------------------");

{
  const object = note();
  const before = JSON.stringify(object);

  editor.open({ text: "", multiline: false, object, camera: camera(1) });

  const field = dom.window.document.querySelector("#noteText");

  typeInto(field, "typed but not committed");

  check("typing alone does not write the feature", JSON.stringify(object) === before);

  keydown(field, "Escape");

  editor.open({ text: "", multiline: false, object, camera: camera(1) });

  check(
    "reopening after a cancel opens exactly one prompt",
    openPrompts().length === 1 && previews().length === 1,
  );

  const again = dom.window.document.querySelector("#noteText");

  keydown(again, "Escape");

  check(
    "and closing it leaves no prompt, no preview and no stray node",
    openPrompts().length === 0 &&
      previews().length === 0 &&
      !dom.window.document.body.textContent.includes("typed but not committed"),
  );
}

{
  /* Opening a second entry over a first replaces it rather than stacking. */
  editor.open({ text: "", multiline: false, object: note(), camera: camera(1) });
  editor.open({ text: "", multiline: false, object: note({ id: "annotate-002" }), camera: camera(1) });

  check("two opens in a row leave one prompt", openPrompts().length === 1 && previews().length === 1);

  editor.close();
}

{
  /* THE MODAL FALLBACK, for a caller with nothing to anchor on. */
  let applied = null;

  editor.open({
    text: "panel edit",
    multiline: false,
    onApply: (text) => {
      applied = text;
    },
  });

  check(
    "an entry with no node falls back to the working dialog",
    Boolean(modal()) && openPrompts().length === 0,
  );
  check("and it is not reported as inline", editor.isInline() === false);

  const field = dom.window.document.querySelector("#noteText");

  check("which still shows the current text and takes focus", field.value === "panel edit", field.value);

  field.value = "panel done";

  dom.window.document
    .querySelector("[data-note-apply]")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  check("and still commits one edit", applied === "panel done" && modal() === null);
}

{
  /* `inline: false` asks for the fallback explicitly. */
  editor.open({ text: "", multiline: false, object: note(), camera: camera(1), inline: false });

  check("a caller can still ask for the dialog", Boolean(modal()) && openPrompts().length === 0);

  editor.close();
}

/* ================================================== 5. placement wiring */

console.log("\nThe placement workflow and the canvas route agree");
console.log("---------------------------------------------------");

{
  const fs = require("fs");
  const { modulePath } = require("./helpers/source-path.cjs");

  const creation = fs.readFileSync(modulePath("annotate-creation.js"), "utf8");
  const click = fs.readFileSync(modulePath("canvas-click.js"), "utf8");
  const renderer = fs.readFileSync(modulePath("renderer.js"), "utf8");

  check(
    "placing a written annotation opens the editor at the clicked node",
    /openNoteEditorFor\?\.\(object, nodePoint\)/.test(creation),
  );

  check(
    "the editor is given the feature, its point and a camera signal",
    /object,?\s*[\r\n]+\s*point: atPoint,/.test(click) && /cameraSignal,/.test(click),
  );

  check(
    "the feature being written is drawn live while the prompt is open",
    /textEntryObjectId/.test(click) && /const textEntryId = textEntryObjectId/.test(renderer),
  );

  check(
    "the canvas announces camera changes to whoever is following it",
    /export function cameraSignal/.test(
      fs.readFileSync(modulePath("canvas-render.js"), "utf8"),
    ),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
