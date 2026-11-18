/*
 * ========================================================
 * A VARYING LOAD'S DIRECTION IS ESTABLISHED BY ITS FIRST POINT
 * ========================================================
 *
 * The varying load has ONE direction, and it is square-on to the loaded
 * span by default. The cursor can describe a different direction ONLY by
 * leaving the loaded region - going past one of the span's own ends - and
 * once the first point is placed that direction is the whole load's.
 *
 * Every later profile point contributes a MAGNITUDE and nothing else. Its
 * own cursor position must never re-aim its arrow, and neither must its
 * position along the span, so the arrows stay parallel however the profile
 * varies.
 *
 * These drive `distributedLoadDraft`, the one function that turns the
 * interaction plus the cursor into the load, so they test the real reading.
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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath } = require("./helpers/source-path.cjs");

const loadTool = require(modulePath("load-tool.js"));

const near = (first, second, tolerance = 1e-6) =>
  Math.abs(first - second) <= tolerance;

/*
 * A level span from (0, 0) to (200, 0). Within it, x runs 0..200; a cursor
 * left of x=0 is past the START, right of x=200 is past the END.
 */
const span = () => ({
  phase: "distributed-load-build",
  distributedLoadStart: { x: 0, y: 0 },
  distributedLoadEnd: { x: 200, y: 0 },
  distributedLoadDirection: null,
  distributedLoadPoints: [],
  distributedLoadHasProfile: false,
  parentId: "beam-1",
});

console.log("\n  inside the span the direction is the perpendicular\n");

/* ---------------------------------------------------------------
 * Test A - cursor inside the span stays perpendicular.
 * ------------------------------------------------------------- */
{
  const draft = loadTool.distributedLoadDraft(span(), {
    x: 120,
    y: 30,
  });

  check(
    "Test A: a cursor inside the span gives the perpendicular",
    draft && near(Math.abs(draft.direction), 90),
    `direction was ${draft?.direction}`,
  );
}

/* ---------------------------------------------------------------
 * Test B - moving toward the left end but staying inside stays
 * perpendicular.
 * ------------------------------------------------------------- */
{
  const draft = loadTool.distributedLoadDraft(span(), {
    x: 5,
    y: 30,
  });

  check(
    "Test B: near the left end, inside, still perpendicular",
    draft && near(Math.abs(draft.direction), 90),
    `direction was ${draft?.direction}`,
  );
}

/* ---------------------------------------------------------------
 * Test C - past the left far bound, the direction may turn left.
 * ------------------------------------------------------------- */
{
  const draft = loadTool.distributedLoadDraft(span(), {
    x: -40,
    y: -50,
  });

  check(
    "Test C: past the left end the direction turns to the left side",
    draft &&
      draft.direction < -90 &&
      draft.direction > -180,
    `direction was ${draft?.direction}`,
  );
}

/* ---------------------------------------------------------------
 * Test D - past the right far bound, the direction may turn right.
 * ------------------------------------------------------------- */
{
  const draft = loadTool.distributedLoadDraft(span(), {
    x: 250,
    y: -50,
  });

  check(
    "Test D: past the right end the direction turns to the right side",
    draft &&
      draft.direction < 0 &&
      draft.direction > -90,
    `direction was ${draft?.direction}`,
  );
}

/* ---------------------------------------------------------------
 * Test D2 - and it returns to perpendicular when the cursor comes
 * back inside.
 * ------------------------------------------------------------- */
{
  const outLeft = loadTool.distributedLoadDraft(span(), {
    x: -40,
    y: -50,
  });

  const backInside = loadTool.distributedLoadDraft(span(), {
    x: 100,
    y: -50,
  });

  check(
    "returning inside the span restores the perpendicular",
    outLeft && backInside && near(Math.abs(backInside.direction), 90),
    `out ${outLeft?.direction}, back ${backInside?.direction}`,
  );
}

console.log("\n  the first point's direction is the whole load's\n");

/* ---------------------------------------------------------------
 * Test E/H - a left-directed first point is stored, and later
 * points do NOT re-aim.
 * ------------------------------------------------------------- */
{
  /*
   * FIRST POINT, established with the cursor past the LEFT end, so the
   * direction is the left-side diagonal.
   */
  const first = loadTool.distributedLoadDraft(span(), {
    x: -60,
    y: -60,
  });

  const established = first.direction;

  check(
    "Test E: the first point establishes the direction",
    first && Number.isFinite(established),
    `direction was ${established}`,
  );

  /*
   * Every later point inherits that exact direction, whatever its own
   * cursor does - different magnitudes, different stations, even a cursor
   * that would otherwise aim somewhere else entirely.
   */
  const interactions = [
    { t: 0, magnitude: 100 },
    { t: 0.5, magnitude: 250 },
    { t: 1, magnitude: 500 },
  ].reduce((interaction, point) => {
    interaction.distributedLoadPoints = [
      ...interaction.distributedLoadPoints,
      point,
    ];
    interaction.distributedLoadHasProfile = true;
    interaction.distributedLoadDirection = established;

    return interaction;
  }, span());

  const laterCursors = [
    { x: 50, y: 200 },
    { x: 100, y: -300 },
    { x: 198, y: 40 },
  ];

  laterCursors.forEach((cursor) => {
    const draft = loadTool.distributedLoadDraft(
      interactions,
      cursor,
      cursor,
    );

    check(
      `Test F/G: a later point at ${cursor.x},${cursor.y} keeps the direction`,
      draft && near(draft.direction, established),
      `direction was ${draft?.direction}, expected ${established}`,
    );
  });
}

/* ---------------------------------------------------------------
 * Test H - changing a magnitude changes no direction.
 * ------------------------------------------------------------- */
{
  const established = 135;

  const base = {
    ...span(),
    distributedLoadDirection: established,
    distributedLoadHasProfile: true,
  };

  const small = loadTool.distributedLoadDraft(
    {
      ...base,
      distributedLoadPoints: [{ t: 0.5, magnitude: 10 }],
    },
    { x: 100, y: 60 },
    { x: 100, y: 60 },
  );

  const large = loadTool.distributedLoadDraft(
    {
      ...base,
      distributedLoadPoints: [{ t: 0.5, magnitude: 900 }],
    },
    { x: 100, y: 60 },
    { x: 100, y: 60 },
  );

  check(
    "Test H: a bigger magnitude does not change the direction",
    small &&
      large &&
      near(small.direction, established) &&
      near(large.direction, established),
    `small ${small?.direction}, large ${large?.direction}`,
  );
}

console.log("\n  the profile varies the magnitudes, not the angles\n");

/*
 * THE PROFILE STILL VARIES. Every arrow reads the ONE direction, so they
 * are parallel, and each point's magnitude is its own.
 */
{
  const direction = 90;

  const interaction = {
    ...span(),
    distributedLoadDirection: direction,
    distributedLoadPoints: [
      { t: 0, magnitude: 100 },
      { t: 0.25, magnitude: 250 },
      { t: 0.6, magnitude: 500 },
      { t: 1, magnitude: 300 },
    ],
    distributedLoadHasProfile: true,
  };

  /*
   * The live cursor sits at station 0 - the cursor is at x=0 - so that point
   * is updated to the cursor's offset, 20 along the direction, exactly as
   * the live preview should. The OTHER stations are the profile's and must
   * be untouched.
   */
  const draft = loadTool.distributedLoadDraft(
    interaction,
    { x: 0, y: 20 },
    { x: 0, y: 20 },
  );

  const magnitudes = draft.points.map((point) => point.magnitude);

  check(
    "the stored profile keeps its own magnitudes",
    near(magnitudes[1], 250) &&
      near(magnitudes[2], 500) &&
      near(magnitudes[3], 300),
    JSON.stringify(draft.points),
  );

  check(
    "and the live point follows the cursor's own magnitude",
    near(magnitudes[0], 20),
    JSON.stringify(draft.points),
  );

  check(
    "and every arrow shares the one direction",
    near(draft.direction, direction),
    `direction was ${draft.direction}`,
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
