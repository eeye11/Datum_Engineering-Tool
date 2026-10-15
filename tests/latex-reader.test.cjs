/*
 * READING LaTeX DRAWING CODE.
 *
 * DAETUM's own reader turns the drawing commands it understands into real
 * features, in drawing units (1 mm each; LaTeX's default unit is 1 cm), and
 * reports every statement it cannot use with its line number - nothing is
 * silently dropped.
 */
const test = require("node:test");
const assert = require("node:assert");
const { loadModule } = require("./helpers/source-path.cjs");

const { readLatexDrawing, plainText } = loadModule("latex-reader.js");

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} is not ${expected}`);

const read = (code) => readLatexDrawing(code);
const types = (result) => result.features.map((f) => (f.type === "annotate" ? `annotate:${f.annotateKind}` : f.type));

test("a line, in LaTeX's default unit of 1 cm = 10 drawing units", () => {
  const result = read("\\begin{tikzpicture}\\draw (0,0) -- (4,0);\\end{tikzpicture}");

  assert.deepStrictEqual(types(result), ["line"]);
  assert.deepStrictEqual(result.features[0].geometry.start, { x: 0, y: 0 });
  assert.deepStrictEqual(result.features[0].geometry.end, { x: 40, y: 0 });
  assert.deepStrictEqual(result.diagnostics, []);
});

test("commands work without a tikzpicture around them", () => {
  assert.deepStrictEqual(types(read("\\draw (0,0) -- (1,1);")), ["line"]);
});

test("units: absolute lengths, and the picture's x and y units", () => {
  const absolute = read("\\draw (0,0) -- (20mm, 1cm);").features[0].geometry.end;
  assert.deepStrictEqual(absolute, { x: 20, y: 10 });

  const units = read("\\begin{tikzpicture}[x=1mm, y=1mm, scale=0.5]\\draw (0,0) -- (150,25);\\end{tikzpicture}");
  /* scale changes the printed size only, so DAETUM's own export reads back at its coordinates */
  assert.deepStrictEqual(units.features[0].geometry.end, { x: 150, y: 25 });
});

test("polylines, triangles, rectangles: what a closed path IS", () => {
  const result = read([
    "\\draw (0,0) -- (1,0) -- (1,1) -- (0,2);",
    "\\draw (0,0) -- (3,0) -- (0,4) -- cycle;",
    "\\draw (0,0) -- (2,0) -- (2,1) -- (0,1) -- cycle;",
    "\\draw (5,5) rectangle (7,6);"
  ].join("\n"));

  assert.deepStrictEqual(types(result), ["polyline", "triangle", "rectangle", "rectangle"]);
  const [, , closed, drawn] = result.features;
  assert.deepStrictEqual(closed.geometry.position, { x: 0, y: 10 });
  assert.strictEqual(closed.geometry.width, 20);
  assert.strictEqual(closed.geometry.height, 10);
  assert.deepStrictEqual(drawn.geometry.position, { x: 50, y: 60 });
});

test("circles and arcs", () => {
  const result = read([
    "\\draw (1,1) circle[radius=0.5];",
    "\\draw (2,2) circle (3mm);",
    "\\draw (3,0) arc[start angle=0, end angle=90, radius=3];",
    "\\draw (0,0) arc (180:360:1);"
  ].join("\n"));

  assert.deepStrictEqual(types(result), ["circle", "circle", "arc", "arc"]);
  assert.deepStrictEqual(result.features[0].geometry.center, { x: 10, y: 10 });
  near(result.features[0].geometry.radius, 5, "radius");
  near(result.features[1].geometry.radius, 3, "radius in mm");

  const arc = result.features[2].geometry;
  near(arc.center.x, 0, "arc centre x");
  near(arc.center.y, 0, "arc centre y");
  near(arc.radius, 30, "arc radius");
  near(arc.startAngle, 0, "start");
  near(arc.endAngle, Math.PI / 2, "end");
});

test("named coordinates, relative points, polar points, and the -| corner", () => {
  const result = read([
    "\\coordinate (A) at (0,0);",
    "\\coordinate (B) at (2,1);",
    "\\draw (A) -- (B);",
    "\\draw (A) -- ++(1,0) -- ++(0,1);",
    "\\draw (0,0) -- (90:2);",
    "\\draw (A) -| (B);"
  ].join("\n"));

  assert.deepStrictEqual(types(result), ["line", "polyline", "line", "polyline"]);
  assert.deepStrictEqual(result.features[1].geometry.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  near(result.features[2].geometry.end.x, 0, "polar x");
  near(result.features[2].geometry.end.y, 20, "polar y");
  assert.deepStrictEqual(result.features[3].geometry.points, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }]);
});

test("arrows become arrow annotations, with the head where LaTeX puts it", () => {
  const result = read([
    "\\draw[->] (0,0) -- (1,0);",
    "\\draw[<-] (0,1) -- (1,1);",
    "\\draw[-Stealth] (0,2) -- (1,2);"
  ].join("\n"));

  assert.deepStrictEqual(types(result), ["annotate:arrow", "annotate:arrow", "annotate:arrow"]);
  assert.deepStrictEqual(result.features[0].geometry.end, { x: 10, y: 0 }, "-> points at the second point");
  assert.deepStrictEqual(result.features[1].geometry.end, { x: 0, y: 10 }, "<- points at the first point");
});

test("text: \\node and an inline node become notes, in plain text", () => {
  const result = read([
    "\\node at (1,2) {$F = 50$ N at $30^\\circ$};",
    "\\draw (0,0) -- (1,0) node[right] {A};"
  ].join("\n"));

  const notes = result.features.filter((f) => f.annotateKind === "note");
  assert.strictEqual(notes.length, 2);
  assert.strictEqual(notes[0].text, "F = 50 N at 30°");
  assert.deepStrictEqual(notes[0].geometry.position, { x: 10, y: 20 });
  assert.strictEqual(notes[1].text, "A");
  assert.strictEqual(plainText("50\\% of \\$x \\& $\\theta$ \\\\ line two"), "50% of $x & θ\nline two");
});

test("styles: colour, width, dashes, fill", () => {
  const result = read([
    "\\definecolor{steel}{HTML}{336699}",
    "\\draw[red, thick, dashed] (0,0) -- (1,0);",
    "\\draw[draw=steel, line width=1pt, dotted] (0,1) -- (1,1);",
    "\\fill[blue!50] (0,0) rectangle (1,1);"
  ].join("\n"));

  const [first, second, filled] = result.features;
  assert.strictEqual(first.style.stroke, "#ff0000");
  assert.strictEqual(first.style.lineType, "dashed");
  assert.ok(first.style.lineWidth > 0.5, "thick is heavier than the default");
  assert.strictEqual(second.style.stroke, "#336699");
  assert.strictEqual(second.style.lineType, "dotted");
  assert.strictEqual(filled.style.fill, "#8080ff");
});

test("scopes shift and rotate what they contain", () => {
  const result = read([
    "\\begin{scope}[shift={(1,1)}]",
    "  \\draw (0,0) -- (1,0);",
    "\\end{scope}",
    "\\begin{scope}[rotate=90]",
    "  \\draw (0,0) -- (1,0);",
    "\\end{scope}",
    "\\draw (0,0) -- (1,0);"
  ].join("\n"));

  assert.deepStrictEqual(result.features[0].geometry.start, { x: 10, y: 10 });
  near(result.features[1].geometry.end.x, 0, "rotated x");
  near(result.features[1].geometry.end.y, 10, "rotated y");
  assert.deepStrictEqual(result.features[2].geometry.end, { x: 10, y: 0 }, "a scope ends at \\end{scope}");
});

test("what it cannot draw is reported with its line, never silently dropped", () => {
  const result = read([
    "\\begin{tikzpicture}",
    "\\draw (0,0) -- (1,0);",
    "\\foreach \\x in {1,2,3} \\draw (\\x,0) -- (\\x,1);",
    "\\draw ($(0,0)+(1,1)$) -- (2,2);",
    "\\draw (0,0) -- (P);",
    "\\shade (0,0) rectangle (1,1);",
    "\\draw (0,0) .. controls (1,1) and (2,1) .. (3,0);",
    "\\end{tikzpicture}"
  ].join("\n"));

  assert.deepStrictEqual(types(result), ["line", "line"]);
  const lines = result.diagnostics.map((d) => d.line);
  assert.ok(lines.includes(3), "the loop, on line 3");
  assert.ok(lines.includes(4), "the calculation, on line 4");
  assert.ok(lines.includes(5), "the undefined coordinate, on line 5");
  assert.ok(lines.includes(6), "the shading, on line 6");
  assert.ok(result.diagnostics.find((d) => d.line === 7 && /straight/.test(d.message)), "the curve, approximated, on line 7");
  assert.strictEqual(result.statements, 6);
});

test("comments are ignored, and an empty input says what to write", () => {
  assert.deepStrictEqual(types(read("% \\draw (0,0) -- (9,9);\n\\draw (0,0) -- (1,1); % trailing")), ["line"]);

  const empty = read("Hello world");
  assert.strictEqual(empty.features.length, 0);
  assert.strictEqual(empty.diagnostics[0].severity, "error");
});
