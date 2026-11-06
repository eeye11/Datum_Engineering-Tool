/*
 * ONE RENDERER FOR EVERY OUTPUT.
 *
 * The specification is unusually firm about this: dimensions and
 * annotations "must use the same clean drawing-rendering pipeline as the
 * rest of the drawing", and it explicitly forbids "separate visual
 * implementations for each output".
 *
 * That is a rule about the SHAPE of the code, not about what appears on
 * screen, so it is enforced structurally rather than by comparing
 * pixels.
 *
 * The failure it guards against is quiet. A dimension is added to the
 * canvas renderer, and someone later hand-draws a version for the
 * export path. That looks right right up until the two drift apart - a
 * missing arrowhead style, a text frame at a different size, an
 * annotation exported without its leader - and nothing fails, because
 * each version is correct about itself.
 *
 * So each output module is checked for two things:
 *
 *   1. it REACHES the shared renderer, and
 *   2. it does not BUILD SVG geometry of its own.
 *
 * The second is what makes the first meaningful: a module that both
 * delegates and hand-draws has the problem in miniature.
 *
 * An earlier version of this file drove the outputs with a stubbed
 * renderer at runtime. That was abandoned. It needed a dozen editor
 * services injected before it reached the draw, and every one missing
 * surfaced as "the renderer was never called" - indistinguishable from
 * the very thing being guarded against. The behaviour itself is
 * verified in the browser instead, where an exported SVG and a Drawing
 * Reference were each checked to contain the dimension's measured
 * value.
 */
const fs = require("fs");
const path = require("path");

const { locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
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
 * The source tree, WHICH IS NO LONGER ONE DIRECTORY.
 *
 * This used to read `js/engineering-drawing` and take every .js in it.
 * The sources are grouped by ownership now, so the walk goes through
 * `modules` - the same map `locate` resolves against - which keeps this
 * check covering the whole application rather than quietly covering
 * only whatever happens to sit at one level.
 */
const { modules, rendererSource } = require("./helpers/source-path.cjs");

const read = (name) =>
  fs.readFileSync(locate(name), "utf8");

/*
 * The outputs that must share the renderer.
 *
 * PNG, JPG, SVG and print all run through one export module, so
 * covering that module covers all four - which is the point.
 */
const OUTPUTS = [
  ["PNG / JPG / SVG / print", "document-export.js"],
  ["Drawing Reference", "drawing-reference.js"],
  ["Written solution", "written-references.js"]
];

/*
 * An output may reach the renderer DIRECTLY, or through the export
 * pipeline - which is itself the same one, and which is how the Drawing
 * Reference does it.
 *
 * What must never happen is an output building its own geometry, so the
 * reach is followed one hop and the ban on hand-drawn SVG is absolute.
 */
const REACHES_RENDERER = [
  /enggDrawingRenderer\s*\.\s*renderDrawing/,
  /enggDrawingExport\s*\.\s*renderClean/,
  /enggDrawingExport\s*\.\s*renderImage/,
  /enggDrawingSheets\s*\.\s*renderReference/
 ];
/*
 * createElementNS is how an SVG element is made in a document. A module
 * that formats or measures text will not need it, so its presence means
 * a second visual implementation.
 */
const DRAWS_OWN_SVG = [
  /createElementNS/,
  /createElement\(\s*["']svg["']\s*\)/
];

console.log("\nEvery output draws through the shared renderer");

OUTPUTS.forEach(([label, file]) => {
  let source = "";

  try {
    source = read(file);
  } catch (error) {
    check(`${label} module is present`, false, `no ${file}`);
    return;
  }

  check(
    `${label} reaches the shared renderer`,
    REACHES_RENDERER.some((pattern) => pattern.test(source)),
    `${file} never reaches the shared renderer`
  );

  const offenders = DRAWS_OWN_SVG.filter((pattern) => pattern.test(source));

  check(
    `${label} draws no SVG of its own`,
    offenders.length === 0,
    offenders.map(String).join(", ")
  );
});

console.log("\nThe export pipeline is the one that actually draws");

const exporter = read("document-export.js");

check(
  "it calls the shared renderer",
  /enggDrawingRenderer\s*\.\s*renderDrawing/.test(exporter)
);
check(
  "and the Drawing Reference goes through it",
  /enggDrawingExport\s*\.\s*renderClean/.test(read("drawing-reference.js"))
);

console.log("\nAnd that renderer is where dimensions and annotations are drawn");

/* The renderer is split by concern across src/rendering/; read all of it. */
const renderer = rendererSource();

check("it draws dimensions", /entity\.type === "dimension"/.test(renderer));
check("and annotations", /entity\.type === "annotation"/.test(renderer));

console.log(
  "\nAnd no other module builds SVG geometry of its own"
);

/*
 * Modules permitted to touch SVG: the renderer itself, the editor
 * chrome - selection boxes, handles, snap markers, which are view-only
 * and deliberately absent from exports - and the three outputs above.
 */
const SANCTIONED = new Set([
  "renderer.js",
  "ui.js",
  "wiring.js",
  "sheet-tabs.js",
  "document-export.js",
  "drawing-reference.js",
  "written-references.js",
  /* The Source tab's canvas overlay: editor chrome, view-only, like wiring. */
  "source-canvas-bridge.js",
  /* The Plant/Block label writes its own tspan exponent into the entity's SVG. */
  "block-label.js"
]);

/* The drawing controller (src/features/workspace/) builds its own canvas overlay. */
const inEditor = (name) => /[\\/]workspace[\\/]/.test(modules.get(name));

/* The renderer lives in src/shared/rendering/ since the Phase 2 reorganisation. */
const inRenderer = (name) => /[\\/]shared[\\/]rendering[\\/]/.test(modules.get(name));

const offenders = [...modules.keys()]
  .filter((name) => !SANCTIONED.has(name) && !inEditor(name) && !inRenderer(name))
  .filter((name) => DRAWS_OWN_SVG.some((pattern) => pattern.test(read(name))));

check(
  "only the sanctioned modules do",
  offenders.length === 0,
  offenders.join(", ")
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
