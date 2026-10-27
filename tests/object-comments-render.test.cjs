/* eslint-disable no-console */
/*
 * ========================================================
 * THE GENERATED SOURCE, COMPILED BY THE REAL TIKZ ENGINE
 * ========================================================
 *
 * String matching cannot tell whether the picture is right. This suite compiles
 * the generated source with the application's own renderer and inspects what
 * came out:
 *
 *   - the DAETUM headers compile to NOTHING: with them and without them the
 *     picture has the same paths and the same text;
 *   - a Point Force draws its arrow and its magnitude, and the words
 *     "Point Force" never appear;
 *   - a composite symbol (a support) draws all of its primitives as one object;
 *   - the picture is valid LaTeX with no document declarations of its own.
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

loadModule("load-profile.js");
loadModule("diagram-equations.js");

const statics = loadModule("statics.js");
const geometry = loadModule("geometry.js");
const source = loadModule("drawing-source.js");

let engine = null;

async function tikz() {
  if (!engine) {
    engine = await import("../server/tikz.js");
    await engine.loadTikz();
  }

  return engine;
}

const texts = (svg) =>
  [...String(svg).matchAll(/<text\b[^>]*>([^<]*)</g)]
    .map((match) => match[1].trim())
    .filter(Boolean);

const paths = (svg) => (String(svg).match(/<path\b/g) || []).length;

const objectOf = (type, name, geometryData) => ({
  id: `${type}-001`,
  type,
  name,
  geometry: geometryData,
  style: { stroke: "#000000" },
});

(async () => {
  const service = await tikz();

  /* ============================================ the Point Force example */

  console.log("\nA Point Force compiles to its arrow and its magnitude");
  console.log("-----------------------------------------------------");

  const force = objectOf("force", "Point Force", {
    start: { x: 0, y: 71.1398 },
    end: { x: 126.259, y: 6.4705 },
    magnitude: 345.5,
    angle: -27.1,
  });

  const forcePicture = source.buildDrawingSource([
    {
      id: force.id,
      type: "force",
      name: force.name,
      source: statics.serializeStaticsObject(force),
    },
  ]);

  const forceSvg = await service.renderTikz(
    source.visibleDrawingSource(forcePicture),
  );
  const forceText = texts(forceSvg);

  check(
    "the picture compiles",
    forceSvg.includes("<svg"),
    String(forceSvg).slice(0, 200),
  );
  check("the arrow is drawn", paths(forceSvg) >= 1, String(paths(forceSvg)));
  check(
    "the magnitude is drawn",
    forceText.join(" ").includes("345"),
    JSON.stringify(forceText),
  );
  check(
    "and the tool's name never appears",
    !forceText.some((text) => /Point\s*Force/i.test(text)),
    JSON.stringify(forceText),
  );

  /* ======================================= headers compile to nothing */

  console.log("\nThe headers never change the picture");
  console.log("-------------------------------------");

  const line = objectOf("line", "Line 1", {
    start: { x: 0, y: 0 },
    end: { x: 40, y: 10 },
  });

  const picture = source.buildDrawingSource([
    {
      id: force.id,
      type: "force",
      name: force.name,
      source: statics.serializeStaticsObject(force),
    },
    {
      id: line.id,
      type: "line",
      name: line.name,
      source: geometry.geometrySourceWriter(line),
    },
  ]);

  const withHeaders = await service.renderTikz(picture);
  const withoutHeaders = await service.renderTikz(
    source.visibleDrawingSource(picture),
  );

  check(
    "the same paths",
    paths(withHeaders) === paths(withoutHeaders),
    `${paths(withHeaders)} vs ${paths(withoutHeaders)}`,
  );
  check(
    "and the same text",
    JSON.stringify(texts(withHeaders)) ===
      JSON.stringify(texts(withoutHeaders)),
    `${JSON.stringify(texts(withHeaders))} vs ${JSON.stringify(texts(withoutHeaders))}`,
  );
  check(
    "the header text is nowhere in the picture",
    !texts(withoutHeaders).some((text) => /DAETUM/i.test(text)),
    JSON.stringify(texts(withoutHeaders)),
  );

  /* ================================== one object, several primitives */

  console.log("\nA composite symbol is one object");
  console.log("---------------------------------");

  const support = objectOf("pin-support", "Pin Support", {
    position: { x: 20, y: 0 },
  });
  const supportSource = statics.serializeStaticsObject(support);

  const supportPicture = source.buildDrawingSource([
    {
      id: support.id,
      type: support.type,
      name: support.name,
      source: supportSource,
    },
  ]);

  const supportSvg = await service.renderTikz(
    source.visibleDrawingSource(supportPicture),
  );
  const supportBlocks = source.parseDrawingSource(supportPicture);

  check(
    "its source is ONE block",
    supportBlocks.length === 1,
    JSON.stringify(supportBlocks.map((b) => b.id)),
  );
  check(
    "under the object's id",
    supportBlocks[0]?.id === support.id,
    JSON.stringify(supportBlocks.map((b) => b.id)),
  );
  check(
    "its primitives are all drawn",
    paths(supportSvg) >= 1,
    String(paths(supportSvg)),
  );
  check(
    "and every primitive is inside that one block",
    (() => {
      const map = source.createSourceMap(supportPicture);
      const lines = supportPicture.split("\n");

      return lines.every(
        (text, index) =>
          !/^\\draw/.test(text) || map.idAtLine(index) === support.id,
      );
    })(),
    supportPicture,
  );
  check(
    "the block header is written once",
    supportPicture.split(`% DAETUM ID: ${support.id}`).length - 1 === 1,
    supportPicture,
  );

  /* =============================================== validity of the text */

  console.log("\nThe picture is a fragment, not a document");
  console.log("------------------------------------------");

  check("no document class", !/\\documentclass/.test(picture));
  check("no document environment", !/\\begin\{document\}/.test(picture));
  check(
    "exactly one picture",
    (picture.match(/\\begin\{tikzpicture\}/g) || []).length === 1,
  );
  check(
    "every metadata line is a comment",
    picture
      .split("\n")
      .filter((text) => text.includes("DAETUM"))
      .every((text) => text.trimStart().startsWith("%")),
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }

  setImmediate(() => process.exit(process.exitCode || 0));
})();
