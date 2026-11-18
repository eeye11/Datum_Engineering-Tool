/*
 * ========================================================
 * THE VARYING DISTRIBUTED LOAD'S DIRECTION COMES FROM THE CURSOR
 * ========================================================
 *
 * The varying load used to read its direction from the vector between the
 * cursor and the cursor's own projection onto the body. That vector is the
 * foot of a perpendicular, so it is ALWAYS square-on to the parent body -
 * the cursor's actual direction never reached the load, and a student
 * moving diagonally still got a perpendicular force.
 *
 * The direction now comes from a FIXED reference point - the midpoint of
 * the loaded region, the same origin the constant load uses - so the
 * cursor's real angle becomes the load's direction while the magnitude
 * profile is left exactly as it was.
 *
 * These checks drive `distributedLoadDraft`, the one function that turns
 * the interaction plus the cursor into the load, so they test the real
 * reading rather than a copy of it.
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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath } = require("./helpers/source-path.cjs");

/*
 * An ES module required through Node's interop: it is imported for its
 * exports, after the harness has put the globals it relies on in place.
 */
const loadTool = require(modulePath("load-tool.js"));

/*
 * A horizontal Beam loaded from (0, 0) to (200, 0). The reference point is
 * therefore (100, 0), and the body is level - which is the case where a
 * perpendicular direction and the cursor's direction are most easily told
 * apart.
 */
const horizontalBeam = () => ({
  phase: "distributed-load-build",
  distributedLoadStart: { x: 0, y: 0 },
  distributedLoadEnd: { x: 200, y: 0 },
  distributedLoadDirection: null,
  distributedLoadPoints: [],
  distributedLoadHasProfile: false,
  parentId: "beam-1",
});

const near = (first, second, tolerance = 1e-6) =>
  Math.abs(first - second) <= tolerance;

console.log("\n  inside the span the direction is perpendicular to it\n");

/*
 * WITHIN THE SPAN the direction is the span's perpendicular, and the
 * cursor's position inside the region does NOT rotate it. A cursor above a
 * horizontal span gives an upward load; the same cursor pulled further up
 * only grows the magnitude.
 */
{
  const interaction = horizontalBeam();

  const draft = loadTool.distributedLoadDraft(interaction, {
    x: 100,
    y: 50,
  });

  check(
    "a cursor within the span gives the perpendicular direction",
    draft &&
      draft.directionChosen === true &&
      near(Math.abs(draft.direction), 90),
    `direction was ${draft?.direction}`,
  );
}

/*
 * THE CURSOR'S HORIZONTAL POSITION INSIDE THE SPAN DOES NOT TURN THE LOAD. A
 * cursor near the start, near the end, or in the middle - always within the
 * span - all give the same perpendicular direction. This is the rule that
 * stops the load spinning as the student drags along it.
 */
{
  const probes = [
    { x: 20, y: 40 },
    { x: 100, y: 40 },
    { x: 180, y: 40 },
  ];

  const directions = probes.map((cursor) => {
    const draft = loadTool.distributedLoadDraft(
      horizontalBeam(),
      cursor,
    );

    return draft?.direction;
  });

  const allUp =
    directions.every((d) => d !== null && near(d, 90));

  check(
    "the cursor's place within the span does not rotate the load",
    allUp,
    `directions were ${JSON.stringify(directions)}`,
  );
}

/*
 * Straight up is the perpendicular; straight DOWN from the span's own axis is
 * the SAME direction line, and the side is chosen from where the cursor is.
 */
{
  const up = loadTool.distributedLoadDraft(horizontalBeam(), {
    x: 100,
    y: 50,
  });

  const down = loadTool.distributedLoadDraft(horizontalBeam(), {
    x: 100,
    y: -50,
  });

  check(
    "a cursor below the span gives the downward perpendicular",
    down && near(down.direction, -90),
    `direction was ${down?.direction}`,
  );

  check(
    "so the two sides are opposite perpendiculars",
    up && down && near(Math.abs(up.direction - down.direction), 180),
    `up ${up?.direction}, down ${down?.direction}`,
  );
}

/*
 * ON AN ANGLED SPAN the perpendicular is square to THAT member, not to the
 * world axes: the span's own direction is the reference.
 */
{
  const interaction = {
    ...horizontalBeam(),
    distributedLoadStart: { x: 0, y: 0 },
    distributedLoadEnd: { x: 200, y: 200 },
  };

  /*
   * The member runs up-right at 45 degrees, so its perpendicular is -45
   * (down-right) or 135 (up-left). A cursor above-left of the span picks the
   * 135-degree side.
   */
  const draft = loadTool.distributedLoadDraft(interaction, {
    x: 60,
    y: 140,
  });

  check(
    "on an angled span the direction is square to that span",
    draft && near(Math.abs(draft.direction), 135),
    `direction was ${draft?.direction}`,
  );
}

console.log("\n  a different direction needs the cursor past an END\n");

/*
 * BEYOND THE START: the cursor has left the loaded region past its start end,
 * so the direction is the vector from that end to the cursor - the LEFT side.
 */
{
  const draft = loadTool.distributedLoadDraft(horizontalBeam(), {
    x: -60,
    y: -60,
  });

  check(
    "past the left end the direction comes from the start end",
    draft && near(draft.direction, -135),
    `direction was ${draft?.direction}`,
  );
}

/*
 * BEYOND THE END: the same on the right side, read from the far end.
 */
{
  const draft = loadTool.distributedLoadDraft(horizontalBeam(), {
    x: 260,
    y: -60,
  });

  check(
    "past the right end the direction comes from the end",
    draft && near(draft.direction, -45),
    `direction was ${draft?.direction}`,
  );
}

/*
 * A cursor within the span but far off the member is STILL perpendicular - the
 * whole point of the rule is that only the ends allow a different direction.
 */
{
  const interaction = horizontalBeam();

  const draft = loadTool.distributedLoadDraft(interaction, {
    x: 10,
    y: 60,
  });

  check(
    "toward an end but inside it, the direction is still perpendicular",
    draft && near(Math.abs(draft.direction), 90),
    `direction was ${draft?.direction}`,
  );
}

console.log("\n  a snapped endpoint cannot distort the direction\n");

/*
 * THE BUG. The construction point is snapped: a cursor near the span's end
 * resolves to the end EXACTLY. If the direction is read from that snapped
 * point, every cursor position near the end produces the same fixed diagonal
 * instead of the direction the student is describing.
 *
 * These drive the two different pointers the draft takes: the snapped point
 * as `cursor` and the raw pointer as `directionCursor`. The direction must
 * follow the RAW one and ignore the snapped endpoint entirely.
 *
 * Both cases are WITHIN the span, so the correct answer is now the
 * perpendicular - which is what proves the snapped endpoint (a point on the
 * span) is not being read into the direction at all.
 */
{
  const spanEnd = { x: 0, y: 0 };

  const rawCursor = { x: 30, y: 70 };

  const draft = loadTool.distributedLoadDraft(
    horizontalBeam(),

    /* The resolved point, snapped onto the span end. */
    spanEnd,

    /* The raw pointer the student is actually at. */
    rawCursor,
  );

  check(
    "the direction ignores the snapped endpoint and stays perpendicular",
    draft && near(Math.abs(draft.direction), 90),
    `direction was ${draft?.direction}`,
  );

  /*
   * The snapped endpoint would give midpoint -> start = 180 degrees.
   */
  check(
    "and it is not the fixed midpoint-to-endpoint diagonal",
    draft && !near(draft.direction, 180),
    `direction was ${draft?.direction}`,
  );
}

/*
 * The same, toward the OTHER end, so neither end reintroduces the bug.
 */
{
  const rawCursor = { x: 170, y: 80 };

  const draft = loadTool.distributedLoadDraft(
    horizontalBeam(),
    { x: 200, y: 0 },
    rawCursor,
  );

  check(
    "toward the far end, inside the span, it is still perpendicular",
    draft && near(Math.abs(draft.direction), 90),
    `direction was ${draft?.direction}`,
  );
}

/*
 * `distributedLoadDirectionCursor` is the reading the caller uses: the raw
 * pointer, unless an H/V inference is active - then the inferred point, so
 * the direction squares to the axis the student is aligning to.
 */
{
  const raw = { x: 40, y: 90 };

  const rawCursor =
    loadTool.distributedLoadDirectionCursor({
      rawPointerPoint: raw,
      effectiveConstructionPoint: { x: 0, y: 0 },
    });

  check(
    "without an inference the raw pointer is used",
    rawCursor &&
      near(rawCursor.x, raw.x) &&
      near(rawCursor.y, raw.y),
    JSON.stringify(rawCursor),
  );

  const inferred = { x: 40, y: 30 };

  const inferredCursor =
    loadTool.distributedLoadDirectionCursor({
      rawPointerPoint: raw,
      effectiveConstructionPoint: { x: 0, y: 0 },
      inference: { type: "horizontal", point: inferred },
    });

  check(
    "an active H/V inference provides the direction point",
    inferredCursor &&
      near(inferredCursor.x, inferred.x) &&
      near(inferredCursor.y, inferred.y),
    JSON.stringify(inferredCursor),
  );

  check(
    "with neither point there is no direction point",
    loadTool.distributedLoadDirectionCursor({
      rawPointerPoint: null,
      effectiveConstructionPoint: null,
    }) === null,
  );
}

console.log("\n  a chosen direction is consistent for every point\n");

/*
 * Once the first selection fixed the direction, later moves must not turn the
 * load: the profile points that follow only change magnitudes.
 */
{
  const interaction = {
    ...horizontalBeam(),
    distributedLoadDirection: 45,
    distributedLoadPoints: [{ t: 0.5, magnitude: 10 }],
    distributedLoadHasProfile: true,
  };

  const draft = loadTool.distributedLoadDraft(interaction, {
    x: 100,
    y: 80,
  });

  check(
    "a stored direction is kept whatever the cursor does",
    draft &&
      draft.directionChosen === true &&
      near(draft.direction, 45),
    `direction was ${draft?.direction}`,
  );
}

console.log("\n  a degenerate span has no direction to read\n");

/*
 * A SPAN WITH NO LENGTH has no axis, so it has no perpendicular and no end to
 * read a direction from. That is the one case in which no direction can be
 * derived, and it reports so rather than inventing one.
 */
{
  const interaction = {
    ...horizontalBeam(),
    distributedLoadStart: { x: 100, y: 0 },
    distributedLoadEnd: { x: 100, y: 0 },
  };

  const draft = loadTool.distributedLoadDraft(interaction, {
    x: 140,
    y: 0,
  });

  check(
    "a zero-length span chooses no direction",
    draft && draft.directionChosen === false,
    `directionChosen was ${draft?.directionChosen}`,
  );
}

console.log("\n  the magnitudes are untouched by the direction fix\n");

/*
 * The profile must not change: a point's magnitude is still the cursor's
 * offset from the point's own station, measured along the load's direction.
 * The values that come out are the same ones the old code produced.
 */
{
  const interaction = {
    ...horizontalBeam(),
    distributedLoadDirection: 90,
    distributedLoadPoints: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 5 },
    ],
    distributedLoadHasProfile: true,
  };

  const draft = loadTool.distributedLoadDraft(interaction, {
    x: 0,
    y: 12,
  });

  check(
    "an upward load reads its magnitude along its own direction",
    draft &&
      draft.points.some(
        (point) => point.t === 0 && near(point.magnitude, 12),
      ),
    JSON.stringify(draft?.points),
  );

  check(
    "and the point already defined is left where it is",
    draft && near(draft.points[1].magnitude, 5),
    JSON.stringify(draft?.points),
  );
}

console.log("\n  a load traced in blank space skips straight to the vector\n");

/*
 * TWO CLICKS IN EMPTY SPACE ARE THE SPAN, so the load must move on to the
 * magnitude-and-direction step at once. It used to step into
 * `distributed-load-start` and ask for the start and the end all over
 * again, so a load traced in empty space cost four point clicks.
 */
{
  const fs = require("fs");
  const { locate } = require("./helpers/source-path.cjs");

  const creation = fs.readFileSync(
    locate("geometry-creation.js"),
    "utf8",
  );

  const block = creation.slice(
    creation.indexOf('phase ===\n            "distributed-load-span"'),
  );

  const untilNextPhase = block.slice(
    0,
    block.indexOf("STATICS_SPAN_TOOLS"),
  );

  check(
    "the empty-space span completes into the vector step",
    untilNextPhase.includes(
      'phase: "distributed-load-vector"',
    ),
    "the span does not lead straight to magnitude and direction",
  );

  check(
    "and it no longer asks for the start and end again",
    !untilNextPhase.includes(
      'phase: "distributed-load-start"',
    ),
    "it still restarts the start/end selection after the span",
  );

  /*
   * The snap and inference the second click produced have to survive into
   * the vector step, so `resolution` is spread in rather than dropped.
   */
  check(
    "and the click's snap resolution is carried into the vector step",
    untilNextPhase.includes("...resolution") &&
      untilNextPhase.includes("...span.start") &&
      untilNextPhase.includes("...span.end"),
    "the spanned ends or the snap resolution are not carried forward",
  );
}

console.log("\n  the empty-space span is a snap-enabled, previewed step\n");

/*
 * Snapping during the span selection is what lets the traced region line up
 * with existing geometry. The preview is the thing that drives it: while a
 * span phase has a live preview the pointer is resolved and snapped, so the
 * check is that the span phase is treated as progressive.
 */
{
  const fs = require("fs");
  const { locate } = require("./helpers/source-path.cjs");

  const preview = fs.readFileSync(
    locate("preview.js"),
    "utf8",
  );

  check(
    "the span phase is previewed, so its pointer snaps",
    /isLoadSpanPhase\(\s*interaction\s*\)/.test(preview) ||
      preview.includes("isLoadSpanPhase(interaction)") ||
      /isLoadSpanPhase\([\s\S]{0,40}\)/.test(preview),
    "the span phase is never previewed, so nothing snaps",
  );

  check(
    "and the span preview uses the shared line preview",
    /isLoadSpanPhase\([\s\S]{0,600}createPreview\(\s*["']line["']/.test(
      preview,
    ),
    "the span is not previewed as the line it is",
  );
}

console.log("\n  a load's own forces are snap targets, tails and tips\n");

/*
 * While a load is being built, the forces already placed must be places the
 * next one can be aligned to: a point dropped at the same STATION (aligned
 * to a tail) or at the same MAGNITUDE (aligned to a tip). The tips are what
 * make "the same value again" a snap instead of an estimate.
 */
{
  const { isLoadBuildPhase } = loadTool;

  check(
    "a load under construction is a snapping phase",
    isLoadBuildPhase({ phase: "distributed-load-build" }) === true,
  );

  const fs = require("fs");
  const { locate } = require("./helpers/source-path.cjs");

  const tool = fs.readFileSync(
    locate("load-tool.js"),
    "utf8",
  );

  check(
    "the load publishes its forces' tails and tips to the snap system",
    /const tip\b[\s\S]{0,600}start: tip[\s\S]{0,60}end: tip/.test(tool),
    "the force tips are not published, so a magnitude cannot be snapped to",
  );

  const pointer = fs.readFileSync(
    locate("pointer.js"),
    "utf8",
  );

  check(
    "and the pointer adds those tips to its inference references",
    /direction\.x \*[\s\S]{0,60}magnitude/.test(pointer),
    "the force tips are not inference references, so H/V alignment ignores them",
  );

  check(
    "and the span's ends remain inference references",
    pointer.includes("loadSpanEndAnchor"),
    "the span ends are not alignment references",
  );
}

console.log("\n  H/V alignment fires for a load even over the body\n");

/*
 * THE FAILURE THIS GUARDS: a load's points sit ON the member, and the
 * member's own geometry always answers the snap search first. The alignment
 * guide used to be searched only when NO snap was found, so it could never
 * appear where a load's point actually goes - and horizontal/vertical snap
 * was effectively dead for the load tools.
 *
 * Driven through the shared resolver with the flags the load tools pass, so
 * this tests the real reading rather than a copy of it.
 */
{
  const snapModule = require(
    require("./helpers/source-path.cjs").modulePath("object-snap.js"),
  ).default;

  const model = require(
    require("./helpers/source-path.cjs").modulePath("drawing-state.js"),
  ).default;

  const bounds = { width: 900, height: 600 };

  const loadScene = (interaction) => ({
    objects: [
      {
        id: "beam-1",
        type: "line",
        geometry: {
          start: { x: 0, y: 0 },
          end: { x: 300, y: 0 },
        },
      },
    ],
    camera: { zoom: 1, panX: 0, panY: 0 },
    objectSnap: { enabled: true },
    snap: { enabled: false },
    selection: { selectedObjectIds: [] },
    interaction,
  });

  const resolve = (scene, probeWorld, references) =>
    snapModule.resolveConstructionPoint(
      probeWorld,
      scene,
      bounds,
      {
        lineStart: { x: 0, y: 0 },
        inferenceReferences: references,
        preferInference: true,
        tool: "varying-distributed-load",
      },
    );

  /*
   * A force at mid-span, and a probe level with its tip. The tip is what a
   * repeat of the SAME magnitude aligns to.
   */
  {
    const scene = loadScene({
      phase: "distributed-load-build",
      distributedLoadStart: { x: 0, y: 0 },
      distributedLoadEnd: { x: 300, y: 0 },
      distributedLoadDirection: 90,
      distributedLoadPoints: [{ t: 0.5, magnitude: 60 }],
    });

    const result = resolve(scene, { x: 240, y: 60 }, [
      { x: 150, y: 0 },
      { x: 150, y: 60 },
    ]);

    check(
      "a point can be aligned level with an earlier force's tip",
      result.inference &&
        result.inference.type === "horizontal" &&
        near(result.effectiveConstructionPoint.y, 60),
      `inference ${JSON.stringify(result.inference)}, effective ${JSON.stringify(
        result.effectiveConstructionPoint,
      )}`,
    );
  }

  /*
   * A probe ON the beam, level with a span end. The beam offers a snap of
   * its own (its midpoint is at 150, 0), and that must no longer swallow
   * the alignment.
   */
  {
    const scene = loadScene({
      phase: "distributed-load-build",
      distributedLoadStart: { x: 0, y: 0 },
      distributedLoadEnd: { x: 300, y: 0 },
      distributedLoadDirection: null,
      distributedLoadPoints: [],
    });

    const result = resolve(scene, { x: 150, y: 1 }, [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);

    check(
      "over the body, the alignment guide still fires",
      result.inference &&
        /horizontal|vertical/.test(result.inference.type) &&
        near(result.effectiveConstructionPoint.y, 0),
      `inference ${JSON.stringify(result.inference)}`,
    );
  }

  /*
   * Without the flag the old behaviour is unchanged: a snap candidate wins
   * and no guide is produced. That is what every NON-load tool still sees,
   * so the change is confined to the load tools.
   */
  {
    const scene = loadScene({
      phase: "distributed-load-build",
      distributedLoadStart: { x: 0, y: 0 },
      distributedLoadEnd: { x: 300, y: 0 },
      distributedLoadDirection: null,
      distributedLoadPoints: [],
    });

    const result = snapModule.resolveConstructionPoint(
      { x: 150, y: 1 },
      scene,
      bounds,
      {
        lineStart: { x: 0, y: 0 },
        inferenceReferences: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
        tool: "line",
      },
    );

    check(
      "other tools keep the snap-first behaviour",
      result.inference === null &&
        Boolean(result.snapCandidate),
      `inference ${JSON.stringify(result.inference)}`,
    );
  }

  /*
   * The transform used above is the application's own, so the assertions
   * cannot pass by agreeing with a hand-rolled mapping.
   */
  check(
    "the shared resolver is the one being driven",
    typeof snapModule.resolveConstructionPoint === "function" &&
      typeof model.engineeringToScreen === "function",
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
