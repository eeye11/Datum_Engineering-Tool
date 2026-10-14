/*
 * ========================================================
 * LOAD DIRECTION IS SEPARATE FROM THE SPAN
 * ========================================================
 *
 * WHERE a load exists and HOW it is directed are two independent geometric
 * systems, for both distributed loads:
 *
 *   - the SPAN (start/end) and the PROFILE POINTS say where the load acts;
 *   - one FIXED reference point and the cursor say which way it pushes.
 *
 * The defects these tests pin down all come from the two systems leaking
 * into one another:
 *
 *   - moving the cursor along the span rotated the load, because the
 *     direction was measured from a point that moved (or from a snapped
 *     endpoint, which jumps to the end of the span);
 *   - a load could be committed with a direction nobody chose, because a
 *     placeholder angle was stored when the vector was empty;
 *   - an unknown direction still drew arrows, because the model fell back to
 *     a default the moment the value was marked unknown.
 *
 * These drive the real draft functions - the ones that turn an interaction
 * plus a cursor into the load - so they test the reading the preview and the
 * commit both use.
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
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, rendererSource } = require("./helpers/source-path.cjs");

const loadTool = require(modulePath("load-tool.js"));
const profile = require(modulePath("load-profile.js")).default;
const { drawingState } = require(modulePath("editor-state.js"));

const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const degreesOf = (from, to) =>
  (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/*
 * A LEVEL span from (0, 0) to (300, 0), so the fixed reference is (150, 0).
 * A level body is where a span-derived direction and a cursor-drawn one are
 * most easily told apart.
 */
const levelSpan = {
  start: { x: 0, y: 0 },
  end: { x: 300, y: 0 },
  reference: { x: 150, y: 0 },
};

/*
 * An ANGLED span, so a direction correlated with the body angle - the
 * defect this guards - would show up immediately.
 */
const angledSpan = {
  start: { x: 0, y: 0 },
  end: { x: 200, y: 200 },
  reference: { x: 100, y: 100 },
};

const constantInteraction = (span) => ({
  phase: "distributed-load-vector",
  loadSourceId: "body-1",
  loadStart: { ...span.start },
  loadEnd: { ...span.end },
  loadReferencePoint: { ...span.reference },
  loadDirection: null,
  loadMagnitude: 0,
});

const varyingInteraction = (span, points = []) => ({
  phase: "distributed-load-build",
  distributedLoadStart: { ...span.start },
  distributedLoadEnd: { ...span.end },
  distributedLoadDirection: null,
  distributedLoadPoints: points,
  distributedLoadHasProfile: points.length > 0,
  parentId: "body-1",
});

const withConstant = (span) => {
  drawingState.interaction = constantInteraction(span);

  return drawingState.interaction;
};

const withVarying = (span, points) => {
  drawingState.interaction = varyingInteraction(span, points);

  return drawingState.interaction;
};

/* ---------------------------------------------------------------- */
console.log("\n  uniform load: the direction is the cursor vector\n");

/*
 * Up from the reference is vertical; down is the opposite vertical.
 */
[
  [{ x: 150, y: 80 }, 90],
  [{ x: 150, y: -80 }, -90],
  [{ x: 260, y: 0 }, 0],
  [{ x: 40, y: 0 }, 180],
].forEach(([cursor, expected]) => {
  withConstant(levelSpan);

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    `a cursor at ${cursor.x},${cursor.y} gives ${expected} degrees`,
    draft && near(draft.direction, expected),
    `direction was ${draft?.direction}`,
  );
});

/* ---------------------------------------------------------------- */
console.log("\n  uniform load: arbitrary angles are honoured\n");

[17, 34, 52, -20, -67].forEach((degrees) => {
  withConstant(levelSpan);

  const radians = (degrees * Math.PI) / 180;

  const cursor = {
    x: 150 + Math.cos(radians) * 100,
    y: 0 + Math.sin(radians) * 100,
  };

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    `a ${degrees} degree cursor gives ${degrees} degrees`,
    draft && near(draft.direction, degrees, 1e-9),
    `direction was ${draft?.direction}`,
  );
});

/* ---------------------------------------------------------------- */
console.log("\n  uniform load: moving along the span does not rotate it\n");

/*
 * THE CROSS-SPAN TEST. The cursor slides from left of the reference to right
 * of it, at a CONSTANT height above the span. The direction must be the true
 * angle of the vector from the fixed reference at every position - never
 * snapped to 180 or 0 because the cursor passed near an end.
 */
{
  const heights = [
    { label: "left", x: 20 },
    { label: "centre", x: 150 },
    { label: "right", x: 280 },
  ];

  heights.forEach(({ label, x }) => {
    withConstant(levelSpan);

    const cursor = { x, y: 80 };

    const expected = degreesOf(levelSpan.reference, cursor);

    const draft = loadTool.constantLoadDraft(
      drawingState.interaction,
      cursor,
      cursor,
    );

    check(
      `at the ${label} of the span the direction is the cursor's angle`,
      draft && near(draft.direction, expected, 1e-9),
      `direction was ${draft?.direction}, expected ${expected}`,
    );
  });
}

/*
 * THE ENDPOINT TEST. The cursor moves diagonally toward each end. The
 * direction must never become the midpoint-to-endpoint diagonal.
 */
{
  [
    { cursor: { x: 2, y: 80 }, forbidden: 180 },
    { cursor: { x: 298, y: 80 }, forbidden: 0 },
  ].forEach(({ cursor, forbidden }) => {
    withConstant(levelSpan);

    const draft = loadTool.constantLoadDraft(
      drawingState.interaction,
      cursor,
      cursor,
    );

    check(
      `moving toward the ${forbidden === 180 ? "start" : "end"} does not jump to ${forbidden}`,
      draft && !near(draft.direction, forbidden, 1e-3),
      `direction was ${draft?.direction}`,
    );
  });
}

/* ---------------------------------------------------------------- */
console.log("\n  uniform load: a snapped endpoint cannot become the direction\n");

/*
 * The resolved construction point has snapped onto the span end, while the
 * raw cursor is above the reference. The direction must follow the raw one.
 */
{
  withConstant(levelSpan);

  const draft = loadTool.constantLoadDraft(
    drawingState.interaction,
    { x: 0, y: 0 },
    { x: 150, y: 80 },
  );

  check(
    "the snapped start is ignored for direction",
    draft && near(draft.direction, 90),
    `direction was ${draft?.direction}; the snapped end would give 180`,
  );

  withConstant(levelSpan);

  const far = loadTool.constantLoadDraft(
    drawingState.interaction,
    { x: 300, y: 0 },
    { x: 150, y: 80 },
  );

  check(
    "the snapped end is ignored for direction",
    far && near(far.direction, 90),
    `direction was ${far?.direction}; the snapped end would give 0`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  uniform load: the body angle has no authority\n");

/*
 * THE BODY-ANGLE INDEPENDENCE TEST. For a set of body angles, establish the
 * SAME cursor direction each time. The load direction must not correlate
 * with the body angle.
 */
{
  const bodies = [
    { angle: 0, end: { x: 300, y: 0 } },
    { angle: 15, end: { x: 290, y: 78 } },
    { angle: 30, end: { x: 260, y: 150 } },
    { angle: 45, end: { x: 212, y: 212 } },
    { angle: 75, end: { x: 78, y: 290 } },
    { angle: 90, end: { x: 0, y: 300 } },
  ];

  const chosen = [0, 90, 30, -45];

  bodies.forEach(({ angle, end }) => {
    const mid = { x: end.x / 2, y: end.y / 2 };

    chosen.forEach((degrees) => {
      const radians = (degrees * Math.PI) / 180;

      const cursor = {
        x: mid.x + Math.cos(radians) * 100,
        y: mid.y + Math.sin(radians) * 100,
      };

      withConstant({
        start: { x: 0, y: 0 },
        end,
        reference: mid,
      });

      const draft = loadTool.constantLoadDraft(
        drawingState.interaction,
        cursor,
        cursor,
      );

      check(
        `a ${angle} degree body can carry a ${degrees} degree load`,
        draft && near(draft.direction, degrees, 1e-9),
        `direction was ${draft?.direction}`,
      );
    });
  });
}

/* ---------------------------------------------------------------- */
console.log("\n  varying load: one common direction from the fixed reference\n");

/*
 * The varying load must read its direction the same way: fixed reference,
 * cursor vector. A cursor above the reference is vertical regardless of
 * where the profile points are.
 */
{
  withVarying(levelSpan, [
    { t: 0, magnitude: 5 },
    { t: 0.5, magnitude: 10 },
    { t: 1, magnitude: 15 },
  ]);

  const cursor = { x: 150, y: 80 };

  const draft = loadTool.distributedLoadDraft(
    drawingState.interaction,
    cursor,
    cursor,
  );

  check(
    "a cursor above the reference gives a vertical varying load",
    draft && near(draft.direction, 90),
    `direction was ${draft?.direction}`,
  );
}

/*
 * Moving the cursor along the span must not swing the direction: inside the
 * loaded region the direction stays square-on to the span, whatever the
 * profile says and wherever along the span the cursor is.
 */
{
  [
    { x: 10, y: 80 },
    { x: 150, y: 80 },
    { x: 290, y: 80 },
  ].forEach((cursor) => {
    withVarying(levelSpan, [
      { t: 0, magnitude: 5 },
      { t: 0.5, magnitude: 10 },
      { t: 1, magnitude: 15 },
    ]);

    const draft = loadTool.distributedLoadDraft(
      drawingState.interaction,
      cursor,
      cursor,
    );

    check(
      `at x=${cursor.x} the varying direction is the span's perpendicular`,
      draft && near(Math.abs(draft.direction), 90, 1e-9),
      `direction was ${draft?.direction}`,
    );
  });
}

/* ---------------------------------------------------------------- */
console.log("\n  varying load: profile points are not direction anchors\n");

/*
 * THE PROFILE-POINT TEST. A stored direction must survive any profile -
 * adding points, moving them, changing magnitudes - because the profile says
 * where the load acts and the direction says which way.
 */
{
  const stored = 30;

  const profiles = [
    [{ t: 0, magnitude: 1 }],
    [
      { t: 0, magnitude: 1 },
      { t: 1, magnitude: 2 },
    ],
    [
      { t: 0, magnitude: 5 },
      { t: 0.25, magnitude: 10 },
      { t: 0.6, magnitude: 2 },
      { t: 1, magnitude: 8 },
    ],
  ];

  profiles.forEach((points) => {
    withVarying(levelSpan, points);

    drawingState.interaction.distributedLoadDirection = stored;

    const draft = loadTool.distributedLoadDraft(
      drawingState.interaction,
      { x: 150, y: 80 },
      { x: 150, y: 80 },
    );

    check(
      `a ${points.length}-point profile keeps the stored direction`,
      draft && near(draft.direction, stored),
      `direction was ${draft?.direction}`,
    );
  });
}

/*
 * And an angle away from the body's own orientation, on an ANGLED body, to
 * prove the profile and the body are not steering it.
 */
{
  withVarying(angledSpan, [
    { t: 0, magnitude: 5 },
    { t: 1, magnitude: 5 },
  ]);

  drawingState.interaction.distributedLoadDirection = 0;

  const draft = loadTool.distributedLoadDraft(
    drawingState.interaction,
    { x: 200, y: 100 },
    { x: 200, y: 100 },
  );

  check(
    "an angled body can carry a horizontal varying load",
    draft && near(draft.direction, 0),
    `direction was ${draft?.direction}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  a direction nobody chose is never committed\n");

/*
 * A cursor INSIDE the loaded span still has a direction - the span's
 * perpendicular - so the first point can be placed without dragging off the
 * load. Only a degenerate span leaves no direction to read.
 */
{
  withVarying(levelSpan, []);

  const draft = loadTool.distributedLoadDraft(
    drawingState.interaction,
    { x: 150, y: 0 },
    { x: 150, y: 0 },
  );

  check(
    "a cursor within the span reports the perpendicular direction",
    draft &&
      draft.directionChosen === true &&
      near(Math.abs(draft.direction), 90),
    `directionChosen ${draft?.directionChosen}, direction ${draft?.direction}`,
  );
}

/*
 * And a committed direction is only ever one that was chosen - the build
 * refuses the placeholder.
 */
{
  const source = require("fs").readFileSync(
    modulePath("load-tool.js"),
    "utf8",
  );

  check(
    "the varying commit requires a chosen direction",
    /A FINISHED LOAD MUST HAVE A DIRECTION THE STUDENT CHOSE[\s\S]{0,900}!draft\.directionChosen/.test(
      source,
    ),
    "the commit can store the placeholder angle",
  );

  check(
    "the uniform commit refuses an empty vector",
    /length\s*<\s*1e-6/.test(source),
    "a zero-length drag can be committed",
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  an unknown direction draws no arrows\n");

/*
 * `?` on the direction is a real state: there is no authoritative angle. The
 * model must report that rather than falling back to straight down, and the
 * renderer skips the arrows when it does.
 */
{
  check(
    "an unknown direction reports no angle",
    profile.loadDirection({
      direction: 45,
      directionUnknown: true,
    }) === null,
    `got ${profile.loadDirection({
      direction: 45,
      directionUnknown: true,
    })}`,
  );

  check(
    "a known zero degree direction is still zero",
    profile.loadDirection({ direction: 0 }) === 0,
    `got ${profile.loadDirection({ direction: 0 })}`,
  );

  check(
    "a load with no stored direction keeps its documented default",
    profile.loadDirection({}) === profile.DEFAULT_LOAD_DIRECTION,
    `got ${profile.loadDirection({})}`,
  );

  const renderer = rendererSource();

  check(
    "the renderer draws no arrows without a direction",
    /NO DIRECTION, NO LOAD DRAWN[\s\S]{0,900}appendDerivedMagnitude/.test(
      renderer,
    ),
    "the renderer draws arrows for a load with no direction",
  );
}

/* ---------------------------------------------------------------- */
console.log("\n  the direction is one shared angle for every arrow\n");

/*
 * The renderer must read ONE direction from the feature and use it for every
 * arrow - there is no direction interpolation along the profile.
 */
{
  const source = require("fs").readFileSync(
    modulePath("load-profile.js"),
    "utf8",
  );

  check(
    "there is no directionAt(t) in the profile model",
    !/directionAt/.test(source),
    "the profile interpolates direction, which cannot be right",
  );

  const renderer = rendererSource();

  check(
    "the renderer takes the direction from the feature once",
    /const direction\s*=\s*enggLoadProfile\.unitVector\(/.test(
      renderer,
    ),
    "the renderer does not read a single direction",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
