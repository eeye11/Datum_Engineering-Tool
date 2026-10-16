/*
 * SAVE AS LaTeX.
 *
 * A document becomes one .tex: a standalone LaTeX file with one picture per
 * sheet, in standard drawing commands, a sentence describing every feature,
 * and the whole document embedded so DAETUM reopens it exactly.
 *
 * Runs the real writer against the booted application (it renders each sheet
 * through the export renderer), so what is tested is what is downloaded.
 */
const test = require("node:test");
const assert = require("node:assert");
const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { error: bootError, window } = bootApp();

/*
 * jsdom lays nothing out, so every element measures 0 x 0 - and the renderer
 * centres the drawing on the canvas it measures. A browser measures the
 * export's off-screen canvas at the size it is styled; this gives jsdom the
 * same answer, so coordinates are tested as a browser produces them.
 */
const measure = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const width = parseFloat(this.style.width) || 0;
  const height = parseFloat(this.style.height) || 0;
  return width && height
    ? { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height }
    : measure.call(this);
};

const model = require(locate("drawing-state.js")).default;
const documentFile = require(locate("document-file.js")).default;
const annotate = require(locate("annotate-model.js"));
const latex = require(locate("latex-document.js"));
const { readLatexDrawing } = require(locate("latex-reader.js"));
const { describeFeature } = require(locate("feature-description.js"));
const { latexText, svgToTikz, createPalette } = require(locate("svg-to-tikz.js"));

const f = model.geometryFactories;

function sheet(id, name, objects, scale = null) {
  return { id, name, version: 1, units: "mm", objects, scale };
}

function documentBody() {
  const beam = { ...f.beam({ x: 0, y: 0 }, { x: 200, y: 0 }, {}), id: "beam-1", name: "Beam 1" };
  const line = { ...f.line({ x: 0, y: 50 }, { x: 100, y: 80 }, {}), id: "line-1", name: "Line 1" };
  const circle = { ...f.circle({ x: 150, y: 60 }, 20, {}), id: "circle-1", name: "Circle 1" };
  const note = {
    ...annotate.createAnnotate({ kind: "note", position: { x: 20, y: 100 }, text: "50% of $load & {50 kN}_" }),
    id: "note-1",
    name: "Note 1"
  };
  const lone = { ...annotate.createAnnotate({ kind: "note", position: { x: 5, y: 5 }, text: "Alone" }), id: "note-2", name: "Note 2" };
  const scale = { mmPerUnit: 10, unit: "m", reference: null };

  return {
    version: 2,
    units: "mm",
    scale: null,
    objects: [],
    sheets: [
      sheet("sheet_a", "Beam & shapes", [beam, line, circle, note], scale),
      sheet("sheet_b", "Just a note", [lone]),
      sheet("sheet_c", "Empty", [])
    ],
    activeSheetId: "sheet_a"
  };
}

test("the application boots", () => {
  assert.strictEqual(bootError, null, bootError && bootError.message);
});

test("one standalone LaTeX document, one picture per sheet", () => {
  const text = latex.writeLatexDocument(documentBody(), { title: "Test", exportedAt: new Date(0) });

  assert.match(text, /^% =+/);
  assert.match(text, /\\documentclass\[tikz, border=5mm\]\{standalone\}/);
  assert.strictEqual((text.match(/\\begin\{document\}/g) || []).length, 1);
  assert.strictEqual((text.match(/\\begin\{tikzpicture\}/g) || []).length, 3);
  assert.strictEqual((text.match(/\\end\{tikzpicture\}/g) || []).length, 3);
  assert.ok(text.indexOf("\\end{document}") < text.indexOf("DAETUM-DOCUMENT-BEGIN"), "the data block follows the document");
});

test("every number written is finite, and pictures carry a bounded scale", () => {
  const text = latex.writeLatexDocument(documentBody());
  const drawn = text.split("\n").filter(line => !line.startsWith("%")).join("\n");

  assert.doesNotMatch(drawn, /NaN|Infinity|undefined/);

  for (const [, scale] of drawn.matchAll(/scale=([-\d.e+]+)\]/g)) {
    assert.ok(Number(scale) >= 0.01 && Number(scale) <= 10, `scale ${scale} out of range`);
  }
});

test("each sheet lists its features, and each feature is described above its commands", () => {
  const text = latex.writeLatexDocument(documentBody());

  assert.match(text, /% Sheet 1 of 3: "Beam & shapes"/);
  assert.match(text, /% World Scale: 1 drawing unit = 10 mm; lengths are given in m\./);
  assert.match(text, /% Features \(\d+\):/);
  assert.match(text, /Beam "Beam 1", from \(0, 0\) to \(200, 0\), length 2 m/);
  assert.match(text, /Circle "Circle 1", centred at \(150, 60\), radius 0\.2 m/);
  assert.match(text, /% Sheet 3 of 3: "Empty"\n% World Scale not set: lengths are in drawing units\.\n% This sheet is empty\./);
});

test("the drawing is in drawing units, y up, with real commands", () => {
  const text = latex.writeLatexDocument(documentBody());
  const first = text.slice(text.indexOf("\\begin{tikzpicture}[x=1mm"), text.indexOf("\\end{tikzpicture}"));

  assert.match(first, /\\draw\[draw=[a-z0-9]+, line width=[\d.]+pt\]/);
  assert.match(first, /circle\[radius=/);
  /* The beam spans x = 0 to 200 in drawing units, whatever the screen size was. */
  assert.match(first, /\(0,-?[\d.]+\) -- \(200,-?[\d.]+\)/);
});

test("canonical source is a complete, comment-free TikZ picture of the active sheet", () => {
  const body = documentBody();
  const source = latex.writeCanonicalTikzPicture(body, "sheet_a");

  assert.match(source, /^\\begin\{tikzpicture\}\[x=1mm,y=1mm\]\n/);
  assert.match(source, /\\end\{tikzpicture\}$/);
  assert.doesNotMatch(source, /DAETUM|^\s*%|scale=/m);
  assert.match(source, /\\draw/);
  assert.match(source, /circle\[radius=/);

  const parsed = readLatexDrawing(source);
  assert.ok(parsed.features.length > 0, "generated TikZ should remain editable");
  assert.deepStrictEqual(
    parsed.diagnostics.filter(diagnostic => diagnostic.severity === "error"),
    []
  );
  const sourceLine = body.sheets[0].objects.find(object => object.type === "line");
  const parsedLine = parsed.features.find(feature => feature.type === "line");
  assert.ok(parsedLine);
  assert.ok(Math.abs(parsedLine.geometry.start.x - sourceLine.geometry.start.x) < 1e-6);
  assert.ok(Math.abs(parsedLine.geometry.start.y - sourceLine.geometry.start.y) < 1e-6);
  assert.ok(Math.abs(parsedLine.geometry.end.x - sourceLine.geometry.end.x) < 1e-6);
  assert.ok(Math.abs(parsedLine.geometry.end.y - sourceLine.geometry.end.y) < 1e-6);
});

test("an empty sheet has an empty TikZ picture without placeholder geometry", () => {
  const source = latex.writeCanonicalTikzPicture(documentBody(), "sheet_c");

  assert.strictEqual(source, "\\begin{tikzpicture}[x=1mm,y=1mm]\n\\end{tikzpicture}");
});

test("text is escaped, so the file compiles", () => {
  assert.strictEqual(latexText("50% of $load & {x}_#~^\\"), "50\\% of \\$load \\& \\{x\\}\\_\\#\\~{}\\^{}\\textbackslash{}");
  assert.strictEqual(latexText("θ = 30° ± 2"), "$\\theta$ = 30$^{\\circ}$ $\\pm$ 2");

  const text = latex.writeLatexDocument(documentBody());
  assert.match(text, /\{50\\% of \\\$load \\& \\\{50 kN\\\}\\_\}/);
});

test("the file reopens as exactly the document that was saved", () => {
  const body = documentBody();
  const back = latex.readEmbeddedDocument(latex.writeLatexDocument(body));

  /* Exactly what opening the same document as an .enggdraw gives. */
  const asEnggdraw = documentFile.readDocument(JSON.parse(JSON.stringify(documentFile.createDocument(body))));

  assert.strictEqual(back.found, true);
  assert.strictEqual(back.ok, true, back.detail);
  assert.deepStrictEqual(back.document, asEnggdraw.document);
  assert.deepStrictEqual(back.document.sheets.map(s => s.objects), body.sheets.map(s => s.objects).map(o => JSON.parse(JSON.stringify(o))));
});

test("the open path gets the .enggdraw envelope itself, as a saved file holds it", () => {
  const text = latex.writeLatexDocument(documentBody());
  const embedded = latex.readEmbeddedEnvelope(text);

  assert.strictEqual(latex.hasEmbeddedDocument(text), true);
  assert.strictEqual(latex.hasEmbeddedDocument("\documentclass{article}"), false);
  assert.strictEqual(embedded.ok, true);
  assert.strictEqual(embedded.envelope.format, "enggdraw");
  assert.strictEqual(embedded.envelope.document.sheets.length, 3);
});

test("a .tex without DAETUM data is recognised as such, and damaged data is refused", () => {
  assert.deepStrictEqual(latex.readEmbeddedDocument("\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}"), { found: false });

  const damaged = "%% DAETUM-DOCUMENT-BEGIN enggdraw base64\n%% not base64 at all!!\n%% DAETUM-DOCUMENT-END";
  const result = latex.readEmbeddedDocument(damaged);
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.ok, false);
});

test("an unknown feature type is still described", () => {
  const sentence = describeFeature({ type: "heat-flux-arrow", name: "q1", geometry: { start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, magnitude: 5, unit: "W/m²" } });
  assert.strictEqual(sentence, 'Heat flux arrow "q1", from (0, 0) to (3, 4), length 5 drawing units, magnitude 5 W/m².');
});

test("SVG arcs become drawing arcs with angles in drawing space", () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(`<svg xmlns="http://www.w3.org/2000/svg"><g data-feature-id="a"><path d="M 10 0 A 10 10 0 0 0 0 -10" stroke="#000000" fill="none"/></g></svg>`);
  const svg = dom.window.document.querySelector("svg");
  /* screen = world (y flipped), one unit per pixel */
  const groups = svgToTikz(svg, { toWorld: (x, y) => ({ x, y: -y }), unitsPerPx: 1, ptPerPx: 1, palette: createPalette() });

  assert.strictEqual(groups.length, 1);
  /* From (10,0) anticlockwise in drawing space to (0,10): 0° to 90°, radius 10. */
  assert.match(groups[0].commands[0], /\(10,0\) arc\[start angle=0, end angle=90, radius=10\]/);
});

/* The booted editor keeps timers alive; leave once the tests have reported. */
test.after(() => {
  setTimeout(() => process.exit(process.exitCode || 0), 100);
});
