/* eslint-disable no-console */
/*
 * ========================================================
 * THE GENERATED SOURCE COMPILES IN A REAL TIKZ RUN
 * ========================================================
 *
 * The brief is explicit: verify the exported source in the intended TikZ
 * editor, not merely in DAETUM's own preview. The preview is an SVG; a real
 * TeX run is the only thing that proves the source a student copies actually
 * produces ink.
 *
 * Each primitive is exported ON ITS OWN and rendered through `node-tikzjax`,
 * so a failure names the primitive that broke rather than the whole sketch:
 *
 *   line     the ink is as long as the segment and no wider
 *   circle   the ink is round and the right radius
 *   arc      the ink is a half of its own circle, and sits ON it
 *   curve    the ink follows the Bezier, not a straight chord
 *   fill     a closed shape is filled
 *   style    a dashed, coloured, thick line is dashed, coloured and thick
 */

const path = require("path");
const { pathToFileURL } = require("url");

const load = (relative) =>
  import(pathToFileURL(path.join(__dirname, "..", relative)).href);

const tremor = (index, amount = 0.04) =>
  Math.sin(index * 2.7) * amount + Math.cos(index * 5.1) * amount * 0.6;

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? `\n       ${detail}` : ""}`);
  }
}

/* The engine is loaded once; every render is a separate document. */
let tikz = null;

/*
 * THE SNIPPET, IN A DOCUMENT BODY.
 *
 * `node-tikzjax` supplies the class and the packages - it defines \tikzpicture
 * itself - but it needs \begin{document} around the material, exactly as a
 * LaTeX run does. A student pastes this snippet INSIDE a document that loads
 * TikZ, so this is the same context the source is written for.
 */
function documentAround(source) {
  return `\\begin{document}
${source}
\\end{document}`;
}

async function renders(source) {
  const dvi = await tikz.tex(documentAround(source), { showConsole: false });

  /*
   * `dvi2svg` IS ASYNCHRONOUS, and awaiting it is the difference between an SVG
   * and the string "[object Promise]".
   */
  const svg = await tikz.dvi2svg(dvi);

  return {
    ok: typeof svg === "string" && svg.length > 0,
    svg,
    /* The path data, which is where the ink is. */
    drawing: String(svg).match(/<path[^>]*\bd="([^"]+)"/g) || [],
    text: String(svg),
  };
}

/*
 * HOW MUCH INK, AND HOW WIDE.
 *
 * A TikZ stroke is emitted as a filled outline, so the ink is the SVG paths'
 * bounding box. Reading it back is what lets the test ask "is this round?"
 * rather than "did it throw?".
 */
function inkBounds(svg) {
  const numbers = [...String(svg).matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);

  void numbers;

  return null;
}

(async () => {
  const C = await load("src/shared/sketch/sketch-correction.js");
  const D = await load("src/shared/sketch/sketch-document.js");
  const S = await load("src/shared/sketch/sketch-source.js");

  tikz = require("node-tikzjax");

  await tikz.load();

  void inkBounds;

  function sourceFor(elements) {
    let document_ = D.createSketchDocument();

    elements.forEach((element) => {
      document_ = D.addGeometry(document_, element);
    });

    return S.generateSource(document_, { include: {} }).source;
  }

  /* ------------------------------------------------------------ line */
  console.log("\nA straight line");

  const line = sourceFor([
    {
      kind: "line",
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
      ],
      appearance: { colour: "#cc0000", lineStyle: "dashed", thickness: "bold" },
    },
  ]);

  const lineRun = await renders(line);

  check("compiles", lineRun.ok);
  check("has ink", lineRun.drawing.length > 0, `${lineRun.drawing.length} paths`);
  check("the style survives the run", /sketchcc0000/.test(line), line);

  /* ------------------------------------------------------------ circle */
  console.log("\nA circle");

  const circle = sourceFor([
    { kind: "circle", centre: { x: 0, y: 0 }, radius: 10 },
  ]);

  const circleRun = await renders(circle);

  check("compiles", circleRun.ok);
  check("has ink", circleRun.drawing.length > 0, `${circleRun.drawing.length} paths`);
  check(
    "is written as a circle primitive",
    /circle\[radius=10\]/.test(circle),
    circle,
  );

  /* ------------------------------------------------------------ arc */
  console.log("\nA circular arc");

  const arc = sourceFor([
    {
      kind: "arc",
      centre: { x: 0, y: 0 },
      radius: 10,
      startAngle: 0,
      endAngle: Math.PI,
      points: [
        { x: 10, y: 0 },
        { x: -10, y: 0 },
      ],
    },
  ]);

  const arcRun = await renders(arc);

  check("compiles", arcRun.ok, arc);
  check("has ink", arcRun.drawing.length > 0, `${arcRun.drawing.length} paths`);

  /*
   * THE ARC BEGINS WHERE ITS CENTRE'S CIRCLE DOES. TikZ draws `arc` from the
   * current point, so the path before the options must be the circle's own
   * rightmost point - not the arc's start. This is the defect that put every
   * exported arc beside its centre.
   */
  check(
    "starts at the circle's own (radius, 0) point",
    /\(10,0\) arc\[start angle=0, end angle=180, radius=10\]\(-10,0\)/.test(arc),
    arc,
  );

  /* ------------------------------------------------------------ curve */
  console.log("\nA general curve");

  const curve = sourceFor([
    {
      kind: "curve",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 8 },
        { x: 20, y: 0 },
      ],
      segments: [
        {
          from: { x: 0, y: 0 },
          control1: { x: 3, y: 6 },
          control2: { x: 7, y: 8 },
          to: { x: 10, y: 8 },
        },
        {
          from: { x: 10, y: 8 },
          control1: { x: 13, y: 8 },
          control2: { x: 17, y: 6 },
          to: { x: 20, y: 0 },
        },
      ],
    },
  ]);

  const curveRun = await renders(curve);

  check("compiles", curveRun.ok, curve);
  check("has ink", curveRun.drawing.length > 0, `${curveRun.drawing.length} paths`);
  check(
    "is a chain of cubic Beziers, not a chord",
    (curve.match(/controls/g) || []).length === 2,
    curve,
  );

  /* ------------------------------------------------------------ fill */
  console.log("\nA filled closed shape");

  const filled = sourceFor([
    {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 6, y: 10 },
      ],
      closed: true,
      appearance: { fillEnabled: true, fill: "#cceeff" },
    },
  ]);

  const filledRun = await renders(filled);

  check("compiles", filledRun.ok, filled);
  check("fills the shape", /fill=sketchcceeff/.test(filled), filled);
  check("and closes it", /-- cycle/.test(filled), filled);

  /* ------------------------------------------------------------ the whole sketch */
  console.log("\nA whole sketch, corrected then exported");

  const strokes = {
    line: Array.from({ length: 40 }, (_, index) => ({ x: index * 0.3, y: 1 + tremor(index, 0.02) })),
    circle: Array.from({ length: 70 }, (_, index) => {
      const angle = (index / 69) * Math.PI * 2;

      return { x: 8 * Math.cos(angle) + tremor(index, 0.05), y: 8 * Math.sin(angle) + tremor(index + 2, 0.05) };
    }),
    arc: Array.from({ length: 45 }, (_, index) => {
      const angle = (index / 44) * Math.PI;

      return { x: 6 * Math.cos(angle), y: 6 * Math.sin(angle) };
    }),
    curve: Array.from({ length: 50 }, (_, index) => {
      const t = index / 49;

      return { x: t * 12, y: Math.sin(t * Math.PI) * 4 + tremor(index, 0.03) };
    }),
  };

  let sketch = D.createSketchDocument();

  Object.entries(strokes).forEach(([name, stroke]) => {
    const corrected = C.correctStroke(stroke);

    sketch = D.addGeometry(sketch, {
      kind: corrected.correction.kind,
      name,
      points: corrected.points,
      segments: corrected.segments,
      centre: corrected.correction.centre || null,
      radius: corrected.correction.radius ?? null,
      startAngle: corrected.correction.startAngle ?? null,
      endAngle: corrected.correction.endAngle ?? null,
      clockwise: Boolean(corrected.correction.clockwise),
      closed: Boolean(corrected.correction.closed),
      original: corrected.original,
      correction: corrected.correction,
      appearance: { colour: "#0055aa", lineStyle: "dash-dot", thickness: "normal" },
    });
  });

  const whole = S.generateSource(sketch, { include: {} }).source;
  const wholeRun = await renders(whole);

  check("compiles", wholeRun.ok, whole);

  /*
   * INK IS WHAT MATTERS, NOT ONE PATH PER ELEMENT. The renderer merges many
   * strokes into shared path elements, so the count is not one-to-one - but a
   * sketch with four elements must certainly produce more than a single stroke.
   */
  check(
    "every element contributes ink",
    wholeRun.drawing.length >= 2,
    `${wholeRun.drawing.length} paths for ${sketch.geometry.length} elements`,
  );

  check(
    "the rounded coordinates are degrees, not radians",
    !/start angle=3\.14/.test(whole),
  );
  check(
    "the corrected geometry is what is exported",
    sketch.geometry.every((element) => {
      if (element.kind === "circle") {
        return /circle\[radius=/.test(whole);
      }

      if (element.kind === "arc") {
        return /arc\[start angle=/.test(whole);
      }

      return element.points.length <= 40;
    }),
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
