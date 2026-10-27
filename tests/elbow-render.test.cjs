/* eslint-disable no-console */
/*
 * ========================================================
 * THE ELBOW RENDERS IN THE REAL ENGINE
 * ========================================================
 *
 * The specification is explicit that the text looking right is not proof: the
 * generated TikZ has to COMPILE and produce the geometry the canvas draws. So
 * this suite sends the writer's own output through the application's TikZ
 * service (TikZJax, a WebAssembly TeX) and reads the SVG that comes back.
 *
 * WHAT IS CHECKED
 *
 *   - the block compiles at all;
 *   - the picture contains TWO curved paths - the two boundaries of one bend;
 *   - each is an ARC, not a polyline standing in for one, when the two ends are
 *     drawn at one width;
 *   - the appearance the student chose (a dash pattern) reaches the output;
 *   - a filled elbow compiles to ONE closed region rather than two open walls.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return page;
}

function modules() {
  ready();

  return {
    tool: require(locate("pipe-duct-tool.js")),
    sync: require(locate("source-synchronization.js")),
    state: require(locate("editor-state.js")).drawingState,
    schema: require(locate("feature-schema.js")),
    pipe: require(locate("model/fluids/pipe-duct.js")).default
  };
}

function reset(state) {
  state.objects = [];
  state.selection.selectedObjectIds = [];
}

/* The SVG element count of a particular tag. */
function countTag(svg, tag) {
  return (svg.match(new RegExp(`<${tag}\\b`, "g")) || []).length;
}

let renderer = null;

/*
 * THE DRAWING IS A `tikzpicture`. `sourceForObject` returns ONE OBJECT'S BLOCK,
 * which is a fragment of a picture; wrapping it the way the document does is what
 * the canvas renders, so it is what is compiled here.
 */
async function render(block) {
  if (!renderer) {
    renderer = await import("../server/tikz.js");
    await renderer.loadTikz();
  }

  return renderer.renderTikz(`\\begin{tikzpicture}[x=1mm, y=1mm]\n${block}\n\\end{tikzpicture}`);
}

test("E7: a generated elbow's TikZ compiles and draws two curved boundaries", async () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });
  const source = m.sync.sourceForObject(elbow);

  const svg = await render(source);

  assert.ok(typeof svg === "string" && svg.includes("<svg"), "the elbow compiled to a picture");

  /*
   * THE TWO BOUNDARIES, AS CURVES.
   *
   * TikZ compiles both walls into ONE `<path>` whose `d` holds TWO subpaths -
   * each a move followed by cubic curve segments. So the test counts SUBPATHS
   * with curve commands rather than `<path>` elements: two of them is two walls,
   * and a straight line (which TikZ writes with `l`) would not count at all.
   */
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map((match) => match[1]);

  const subpaths = paths.flatMap((d) => d.split(/(?=M)/).filter(Boolean));

  const curved = subpaths.filter((sub) => /[CcQs]/.test(sub));

  assert.ok(curved.length >= 2, `both boundaries must be curves, found ${curved.length}`);
  assert.ok(countTag(svg, "svg") >= 1);
});

test("E8: the appearance reaches the rendered output", async () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  m.schema.writeField(elbow, "lineType", "dashed");

  const svg = await render(m.sync.sourceForObject(elbow));

  assert.ok(/stroke-dasharray/.test(svg), "a dashed elbow is rendered dashed");
});

test("E9: a filled elbow renders as one closed region", async () => {
  const m = modules();

  reset(m.state);

  const { elbow } = m.tool.commitElbowGesture({ x: 0, y: 0 }, { x: 100, y: 0 });

  m.schema.writeField(elbow, "fillMode", "solid");

  const source = m.sync.sourceForObject(elbow);

  assert.ok(/-- cycle/.test(source), "the source is one closed path");

  const svg = await render(source);

  assert.ok(typeof svg === "string" && svg.includes("<svg"), "the filled elbow compiled");

  /*
   * ONE CLOSED REGION. A `-- cycle` path is compiled with a closing `Z`, and the
   * fill colour TikZ uses for a bare `\\draw[...]` fill is the stroke's own - so
   * the region is present as one path that closes on itself.
   */
  const closed = (svg.match(/<path\b[^>]*\bd="[^"]*[Zz]\s*"/g) || []).length;

  assert.ok(closed >= 1, "the region between the walls is one closed shape");
});

test("E10: an AUTOMATIC non-right elbow compiles and draws its bend", async () => {
  const m = modules();

  reset(m.state);

  /*
   * TWO EXISTING PIPES joined at 30 degrees by endpoint discovery - the case
   * that used to produce no fitting at all, and then produced a skewed one.
   */
  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const radians = (30 * Math.PI) / 180;

  const b = m.pipe.createPipeDuct(
    { x: 100 + 120 * Math.cos(radians), y: 120 * Math.sin(radians) },
    { x: 100, y: 0 }
  );

  m.state.objects = [a, b];

  m.tool.connectPipeEndpoints(b);

  const elbow = m.state.objects.find((object) => object.type === "elbow");

  assert.ok(elbow, "a 30 degree join must earn an elbow");

  const source = m.sync.sourceForObject(elbow);
  const svg = await render(source);

  assert.ok(typeof svg === "string" && svg.includes("<svg"), "the 30 degree elbow compiled");

  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map((match) => match[1]);

  const subpaths = paths.flatMap((d) => d.split(/(?=M)/).filter(Boolean));
  const curved = subpaths.filter((sub) => /[CcQs]/.test(sub));

  assert.ok(curved.length >= 2, `both walls must render as curves, found ${curved.length}`);
});
