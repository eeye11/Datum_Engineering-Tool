/*
 * ========================================================
 * INTERSECTION-BASED TRIM
 * ========================================================
 *
 * Every crossing along a line divides it:
 *
 *   ──────┼──────┼──────┼──────
 *         A      B      C
 *
 * and Trim removes exactly the piece the student points at. That is the whole
 * model, and it replaces a tool that needed the cutting edge chosen as a SECOND
 * selection and could only ever shorten one END of the line - so a middle piece
 * crossed on both sides could not be removed at all.
 *
 * All of it is world-space arithmetic on the stored geometry. Zoom, pan and
 * World Scale cannot move an intersection, so a trim lands exactly on the
 * crossing at any magnification.
 */

const { JSDOM } = require("jsdom");

const { modulePath, rendererSource } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;

const state = require(modulePath("drawing-state.js")).default;

/* The trim model is pure geometry, so it is exercised directly. */
const transforms = require(modulePath("transforms.js"));

/* `trimSegmentAt` is not exported for the app, only for tests. */
const segmentAt =
  transforms.trimSegmentAt ||
  require(modulePath("transforms.js")).default?.trimSegmentAt;

function makeWorld() {
  const st = state.createDrawingState();

  const spine = state.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { style: {} },
  );

  spine.id = "spine";

  const cuts = [100, 200, 300].map((x, index) => {
    const cut = state.geometryFactories.line(
      { x, y: -50 },
      { x, y: 50 },
      { style: {} },
    );

    cut.id = `cut${index}`;

    return cut;
  });

  st.objects = [spine, ...cuts];

  return { st, spine };
}

console.log("\n  crossings divide the line\n");

if (typeof segmentAt !== "function") {
  check(
    "the segment model is available to test",
    false,
    "trimSegmentAt is not exported",
  );
} else {
  const { st, spine } = makeWorld();

  const at = (x) => segmentAt(spine, st.objects, { x, y: 0 });

  const bounds = (segment) =>
    segment ? `${segment.from.x}-${segment.to.x}` : "none";

  check("the first piece runs from the start to the first crossing",
    bounds(at(50)) === "0-100", bounds(at(50)));

  check("the middle piece is bounded by two crossings",
    bounds(at(150)) === "100-200", bounds(at(150)));

  check("each middle piece is its own",
    bounds(at(250)) === "200-300", bounds(at(250)));

  check("the last piece runs from the last crossing to the end",
    bounds(at(350)) === "300-400", bounds(at(350)));

  check(
    "a click beyond every crossing is not on the line at all",
    at(-10) === null && at(500) === null,
    `${bounds(at(-10))} / ${bounds(at(500))}`,
  );

  /*
   * NO CROSSING MEANS NO SEGMENT. A line nothing crosses has only itself, and
   * removing it would be Delete rather than Trim - so the tool must decline
   * rather than guess.
   */
  const lonely = state.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { style: {} },
  );

  lonely.id = "lonely";

  check(
    "a line nothing crosses has no trimmable segment",
    segmentAt(lonely, [lonely], { x: 50, y: 0 }) === null,
  );
}

console.log("\n  the pieces are bounded by REAL intersections\n");

{
  const written = require("fs").readFileSync(
    modulePath("transforms.js"),
    "utf8",
  );

  check(
    "the boundaries are found by testing every other feature",
    /function intersectionsAlongLine\(lineObject, objects\)/.test(written),
    "the student should not have to name the cutting edge",
  );

  check(
    "and computed as world-space segment intersections",
    /segmentIntersectionPoint\(g\.start, g\.end, a, b\)/.test(written) &&
      /segmentParameter\(g\.start, g\.end, hit\)/.test(written),
    "screen pixels would break at any other zoom",
  );

  check(
    "crossings are ordered ALONG the line",
    /hits\.sort\(\(first, second\) => first\.t - second\.t\)/.test(written),
  );

  check(
    "and crossings that coincide divide the line once, not twice",
    /Math\.abs\(hit\.t - hits\[index - 1\]\.t\) > 1e-9/.test(written),
  );

  check(
    "a dimension or annotation is not geometry to cut against",
    /other\.type === "dimension"[\s\S]{0,200}other\.type === "annotation"/.test(
      written,
    ),
  );
}

console.log("\n  removing a piece modifies the geometry\n");

{
  const written = require("fs").readFileSync(
    modulePath("transforms.js"),
    "utf8",
  );

  check(
    "the first piece is removed by moving the start to the crossing",
    /touchesStart && !segment\.touchesEnd[\s\S]{0,200}g\.start = \{ \.\.\.segment\.to \}/.test(
      written,
    ),
  );

  check(
    "the last piece by moving the end",
    /touchesEnd && !segment\.touchesStart[\s\S]{0,200}g\.end = \{ \.\.\.segment\.from \}/.test(
      written,
    ),
  );

  check(
    "a MIDDLE piece splits the line into the two remaining runs",
    /const originalEnd = \{ \.\.\.g\.end \};[\s\S]{0,600}addObject\(drawingState, tail\)/.test(
      written,
    ),
    "a feature cannot hold a gap, so the two runs become two features",
  );

  check(
    "the ORIGINAL keeps its identity, so references still resolve",
    /g\.end = \{ \.\.\.segment\.from \};[\s\S]{0,400}createGeometryObject\(/.test(
      written,
    ),
  );

  check(
    "one trim is ONE undo step",
    /trimSegmentAtCursor[\s\S]{0,4000}commitDrawingChange\(drawingState, previous\)/.test(
      written,
    ),
    "a trim that produced several history entries would be unusable to undo",
  );

  check(
    "nothing is removed when there is no segment",
    /if \(!segment\) \{[\s\S]{0,400}return false;/.test(written),
  );
}

console.log("\n  the hover preview shows the piece that will go\n");

{
  const modify = require("fs").readFileSync(
    modulePath("modify-tools.js"),
    "utf8",
  );

  const renderer = rendererSource();

  check(
    "Trim is ONE click, not boundary-then-target",
    /if \(session\.kind === "trim"\) \{[\s\S]{0,300}trimSegmentAtCursor\(/.test(
      modify,
    ) &&
      !/trimObjectToBoundary/.test(modify),
  );

  check(
    "the preview uses the SAME function as the commit",
    /trimSegmentAt\(target, drawingState\.objects, point\)/.test(modify) &&
      /trimPreview = \{/.test(modify),
    "a preview that promised one piece and removed another would be worse than none",
  );

  check(
    "it is cleared when there is no segment under the cursor",
    /if \(!segment\) \{\s*\n\s*clearModifyPreview\(\);/.test(modify),
    "a stale highlight would be actively misleading",
  );

  check(
    "and the renderer draws it as an editor-only overlay",
    /state\.interaction\.trimPreview/.test(renderer) &&
      /drawing-trim-preview/.test(renderer),
    "a clean render has no session, so it can never reach paper or a file",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}

void dom;
