/*
 * ========================================================
 * THE PICTURE IS SEATED AT THE DRAWING'S ORIGIN
 * ========================================================
 *
 * The Drawing Space paints the compiled TikZ picture in its own layer and
 * states that layer's viewBox from the camera. That is only meaningful if the
 * picture's (0,0) IS the drawing's (0,0) - otherwise the whole sheet is painted
 * a fixed distance from where the model says its objects are.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The seating was wrong by exactly half
 * the origin mark (0.355 pt) in both axes, and the error was invisible to every
 * other check in the repository: the source compiled, the picture was
 * populated, the DOM was correct. Only comparing a known world coordinate
 * against its compiled position catches it.
 *
 * The measurement runs the REAL TikZ engine, because the numbers being checked
 * come from its own SVG writer.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

const PT_PER_UNIT = 72.27 / 25.4;

let engine = null;

async function tikz() {
  if (!engine) {
    engine = await import("../server/tikz.js");
    await engine.loadTikz();
  }

  return engine;
}

/* The first two numbers of a path's `d`, which is its start point. */
function pathStart(attributes) {
  const d = /\sd="([^"]+)"/.exec(attributes)?.[1] || "";
  const numbers = d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g)?.map(Number) || [];

  return { x: numbers[0], y: numbers[1] };
}

function inkAttributes(svg) {
  return [...String(svg).matchAll(/<path\b([^>]*)\/?>/g)]
    .map((match) => match[1])
    .filter((attributes) => !/\sfill="red"/.test(attributes));
}

/*
 * A drawing whose FIRST command starts at a known world point, compiled and
 * seated exactly as the Drawing Space asks for it.
 */
async function seatedStart(worldX, worldY) {
  const service = await tikz();

  const body =
    `\\begin{tikzpicture}[x=1mm, y=1mm]\n` +
    `\\draw (${worldX},${worldY}) -- (${worldX + 20},${worldY + 10});\n` +
    `\\end{tikzpicture}`;

  const svg = await service.renderTikz(body, { anchorOrigin: true });
  const ink = inkAttributes(svg)[0];

  assert.ok(ink, "the compiled picture must contain the drawn line");

  const start = pathStart(ink);
  const translate = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(svg);

  assert.ok(translate, "a seated picture carries the origin translation");

  return {
    x: start.x + Number(translate[1]),
    y: start.y + Number(translate[2])
  };
}

test("the compiled picture puts the drawing's (0,0) at its own (0,0)", async () => {
  const result = await seatedStart(0, 0);

  assert.ok(
    Math.abs(result.x) < 0.01 && Math.abs(result.y) < 0.01,
    `a shape drawn at the origin must sit at the picture's origin (got ${result.x}, ${result.y})`,
  );
});

test("a shape drawn at a known place lands at that place", async () => {
  /*
   * Checked at several positions, including negative ones, so an error that
   * happens to cancel at the origin cannot pass. SVG's y runs DOWN and TikZ's
   * runs UP, so a world y of +15 is 15 units ABOVE the origin - a negative
   * page y.
   */
  const cases = [
    { x: 30, y: 0 },
    { x: -22.5, y: 15 },
    { x: 100, y: -40 },
    { x: -60, y: -25 },
  ];

  for (const point of cases) {
    const result = await seatedStart(point.x, point.y);
    const expectedX = point.x * PT_PER_UNIT;
    const expectedY = -point.y * PT_PER_UNIT;

    assert.ok(
      Math.abs(result.x - expectedX) < 0.01 && Math.abs(result.y - expectedY) < 0.01,
      `a shape at world (${point.x}, ${point.y}) must land at ` +
        `(${expectedX.toFixed(2)}, ${expectedY.toFixed(2)}) - got ` +
        `(${result.x.toFixed(2)}, ${result.y.toFixed(2)})`,
    );
  }
});

test("a picture with no origin mark is returned unchanged", async () => {
  const service = await tikz();
  const body = `\\begin{tikzpicture}[x=1mm, y=1mm]\n\\draw (0,0) -- (10,10);\n\\end{tikzpicture}`;

  const plain = await service.renderTikz(body, { anchorOrigin: false });

  assert.doesNotMatch(String(plain), /translate\(/, "unseated pictures are left alone");
});
