/*
 * ============================================================
 * A DIMENSION'S LABEL MUST REACH THE PICTURE
 * ============================================================
 *
 * The label is written into the generated source as a `\node`. That is a claim
 * about the SOURCE, and it was true while the label still failed to appear in
 * the rendered TikZ - because the node's `font` option was written as
 *
 *     font=\sffamily\fontsize{11}{13.2}\selectfont
 *
 * with no unit on the two numbers. `\fontsize` takes DIMENSIONS, so inside a
 * node's key-value option list those unit-less numbers are only valid where
 * the parser lets an implicit dimension through. The portable form - `11pt` -
 * states the same physical size and compiles everywhere.
 *
 * So the test does not look for a `\node` and stop there: it renders the
 * generated source with the application's own renderer and checks that the
 * label's glyphs are in the picture. A source-only assertion would have
 * passed all along.
 *
 * The geometry assertions are here for the same reason the brief is: the
 * label's disappearance must not be "fixed" by moving it.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

const { window, error } = bootApp();

if (error) {
  throw error;
}

let state;
let model;
let writer;
let renderTikz;

before(async () => {
  await whenReady();

  state = require(locate("editor-state.js")).drawingState;
  model = require(locate("drawing-state.js")).default;
  writer = require(locate("annotations.js")).annotationSourceWriter;

  /*
   * The renderer is the application's own service. It is only used here when
   * it can be loaded, so the suite still runs on a machine with no TeX - and
   * the source assertions below always run.
   */
  try {
    const service = await import("../server/tikz.js");

    await service.loadTikz();

    renderTikz = service.renderTikz;
  } catch {
    renderTikz = null;
  }
});

after(() => window.close());

/* The brief's rectangle, with a width dimension labelled with `label`. */
function dimensionLabelled(label) {
  state.objects.length = 0;
  state.selection.selectedObjectIds.length = 0;

  const rectangle = model.addObject(
    state,
    model.geometryFactories.rectangle({ x: 0, y: 95.5743 }, 132.7724, 45.6406),
  );

  const dimension = model.addObject(
    state,
    model.geometryFactories.dimension({
      dimensionType: "horizontal",
      refs: [
        { featureId: rectangle.id, anchor: "bottomLeft" },
        { featureId: rectangle.id, anchor: "bottomRight" },
      ],
      placement: { x: 66.3862, y: 40 },
      dimensionKind: label ? "variable" : "smart",
      content: label || "",
    }),
  );

  return { rectangle, dimension };
}

function sourceFor(dimension) {
  return `\\begin{tikzpicture}[x=1mm, y=1mm]\n${writer(dimension, {
    state,
    allObjects: state.objects,
  })}\n\\end{tikzpicture}`;
}

test("the label node uses a font declaration that states its unit", () => {
  const { dimension } = dimensionLabelled("5");
  const source = sourceFor(dimension);
  const node = source.split("\n").find((line) => line.includes("{5}"));

  assert.ok(node, `the label's node is written: ${source}`);

  /*
   * THE TWO FORMS THAT ARE ACCEPTED, AND THE ONE THAT IS NOT.
   *
   * `\fontsize{11pt}{13.2pt}` is the portable form. `\fontsize{11}{13.2}` is
   * the one that left the label out of the picture, and it must not come back.
   */
  assert.match(node, /\\fontsize\{11(\.0+)?pt\}\{13(\.2)?pt\}/, node);
  assert.doesNotMatch(node, /\\fontsize\{11(\.0+)?\}\{/, node);
});

test("an empty label emits no text node at all", () => {
  const { dimension } = dimensionLabelled("");

  assert.equal(
    sourceFor(dimension).includes("\\node"),
    false,
    "no label, no node",
  );
});

test("the label's text is escaped for LaTeX and kept exactly", () => {
  const { dimension } = dimensionLabelled("50% & Ø25");
  const source = sourceFor(dimension);

  assert.match(source, /\{50\\% \\& \\O\{\}25\}/, source);
});

test("the node's coordinates are the label's own, unchanged", () => {
  const { dimension } = dimensionLabelled("5");
  const dimensions = require(locate("dimension-model.js")).default;
  const graphics = dimensions.graphicsFor(dimension, state);

  assert.ok(graphics.textFrame, "a labelled dimension has a frame");

  const node = sourceFor(dimension)
    .split("\n")
    .find((line) => line.includes("{5}"));

  /* The node is written at the frame's centre, through the export transform. */
  const written = /at \(([-\d.]+),([-\d.]+)\)/.exec(node);

  assert.ok(written, node);

  /*
   * THE POSITION IS THE FRAME'S, MAPPED BY THE DRAWING'S EXPORT TRANSFORM -
   * not the frame's raw model coordinate and not a screen position. The
   * transform is affine, so a coordinate written through it has the SAME
   * PLACE relative to the dimension line, which is what has to be true.
   */
  const { transform } = require(locate("source-synchronization.js"));

  const expected = transform
    ? transform.point(graphics.textFrame.x, graphics.textFrame.y)
    : { x: graphics.textFrame.x, y: graphics.textFrame.y };

  assert.ok(
    Math.abs(Number(written[1]) - expected.x) < 1e-3 &&
      Math.abs(Number(written[2]) - expected.y) < 1e-3,
    `the node stands where the frame does: ${node}`,
  );
});

test("the generated source renders the label in the TikZ renderer", async (t) => {
  if (!renderTikz) {
    t.skip("the TikZ renderer is not available on this machine");

    return;
  }

  /*
   * A PICTURE OF THE SAME DIMENSION WITH NO LABEL IS THE CONTROL. TikZJax
   * emits the node's text as a real `<text>` element inside a white-backed
   * group, so the assertions are: a `<text>` containing exactly the label, and
   * an unlabelled picture that has none.
   */
  const { dimension: unlabelled } = dimensionLabelled("");
  const bare = await renderTikz(sourceFor(unlabelled));

  assert.doesNotMatch(bare, /<text\b/, "an unlabelled dimension draws no text");

  for (const label of ["5", "Width", "Wall thickness"]) {
    const { dimension } = dimensionLabelled(label);
    const svg = await renderTikz(sourceFor(dimension));

    /*
     * ONE `<text>` PER GLYPH. TikZJax positions each character separately, so
     * the label is read by concatenating them in document order rather than
     * by taking the first element's content.
     */
    const drawn = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
      .map((match) => match[1])
      .join("")
      .trim();

    /*
     * THE WORDS, IN ORDER. TikZJax sets each run separately and a SPACE IS NOT
     * DRAWN - it is the gap between two runs - so the label is read as its
     * words: every word present, none missing, none reordered.
     */
    const words = label.split(/\s+/).filter(Boolean);

    let cursor = 0;

    for (const word of words) {
      const at = drawn.indexOf(word, cursor);

      assert.ok(at >= 0, `"${word}" is drawn in "${label}": ${svg.slice(-400)}`);

      cursor = at + word.length;
    }

    assert.equal(
      drawn.replace(/\s+/g, ""),
      label.replace(/\s+/g, ""),
      `"${label}" is drawn exactly: ${svg.slice(-400)}`,
    );

    /*
     * THE PLATE IS BEHIND THE GLYPHS, not over them - a white fill drawn
     * after the text would hide it, which is the failure this guards.
     */
    assert.ok(
      svg.indexOf("<text") > svg.indexOf('fill="#fff"'),
      "the backing plate is drawn before the words it breaks the line for",
    );
  }
});
