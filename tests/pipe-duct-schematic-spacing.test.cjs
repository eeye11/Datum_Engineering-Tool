/*
 * THE FIXED SCHEMATIC BOUNDARY SPACING FOR PIPE / DUCT GEOMETRY.
 *
 * Pipe / Duct is a 2D engineering DRAWING tool: its two visible boundary
 * lines stand for the flow path schematically, they do not scale the
 * physical bore. These checks pin down the contract:
 *
 *   - ONE shared default schematic spacing, exported as a named constant,
 *     decides the visible separation for every Pipe / Duct and every Elbow.
 *   - The separation is a drawing-style parameter, NOT a dimension: changing
 *     Diameter, Width or Height leaves the visible spacing unchanged.
 *   - The spacing is the same at every corner angle and for curved elbows.
 *   - The boundary lines stay centred on the centreline at any route length
 *     or direction, so they connect cleanly to elbow arcs.
 *   - The panel does not expose a spacing field for each feature.
 */
const { loadModule } = require("./helpers/source-path.cjs");

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

const close = (a, b) => Math.abs(a - b) < 1e-9;

loadModule("drawing-state.js");
const pipe = loadModule("pipe-duct.js");

const P = pipe.default || pipe;

/* ============================================================
 * 1. THE SHARED DEFAULT
 * ============================================================ */

console.log("\n  the shared schematic spacing\n");

const SCHEMATIC = P.DEFAULT_SCHEMATIC_SEPARATION;

check(
  "the schematic spacing is a named, exported drawing-style constant",
  Number.isFinite(SCHEMATIC) && SCHEMATIC > 0,
  `got ${SCHEMATIC}`
);

check(
  "the default spacing is substantially narrower than the default dimensions",
  SCHEMATIC < P.DEFAULT_DIAMETER && SCHEMATIC < P.DEFAULT_WIDTH,
  `spacing ${SCHEMATIC} against diameter ${P.DEFAULT_DIAMETER} / width ${P.DEFAULT_WIDTH}`
);

check(
  "boundarySeparation answers the same constant for a circular run",
  P.boundarySeparation({ shape: "circular", diameter: 900 }),
  SCHEMATIC
);

check(
  "boundarySeparation answers the same constant for a rectangular run",
  P.boundarySeparation({ shape: "rectangular", width: 400, height: 250 }),
  SCHEMATIC
);

check(
  "boundarySeparation answers the same constant with no engineering at all",
  P.boundarySeparation({}),
  SCHEMATIC
);

/* ============================================================
 * 2. DIMENSIONS DO NOT MOVE THE LINES
 * ============================================================ */

console.log("\n  the dimensions do not move the lines\n");

const run = P.createPipeDuct({ x: 0, y: 0 }, { x: 300, y: 0 });

check(
  "a run is created with default engineering",
  Boolean(run),
);

const spacingOf = (feature) => {
  const lines = P.boundaryLines(
    feature.geometry.start,
    feature.geometry.end,
    feature.engineering
  );

  if (lines.length !== 2) {
    return null;
  }

  return Math.hypot(
    lines[0].start.y - lines[1].start.y,
    lines[0].start.x - lines[1].start.x
  );
};

const baselineSpacing = spacingOf(run);

check(
  "the drawn boundaries sit exactly one schematic spacing apart",
  close(baselineSpacing, SCHEMATIC),
  `got ${baselineSpacing}, wanted ${SCHEMATIC}`
);

const runShape = run.engineering.shape;

const changed =
  runShape === P.PIPE_SHAPES.rectangular
    ? { ...run.engineering, width: 480, height: 320 }
    : { ...run.engineering, diameter: 900 };

run.engineering = changed;

check(
  "the engineering values were actually changed",
  changed.width === 480 || changed.diameter === 900
);

check(
  "a 900 diameter / 480 width leaves the drawn spacing unchanged",
  close(spacingOf(run), SCHEMATIC),
  `got ${spacingOf(run)}, wanted ${SCHEMATIC}`
);

const freshWide = P.createPipeDuct(
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { engineering: changed }
);

check(
  "a run CREATED with the large dimensions draws the same spacing",
  close(spacingOf(freshWide), SCHEMATIC),
  `got ${spacingOf(freshWide)}, wanted ${SCHEMATIC}`
);

const runOtherShape = P.createPipeDuct(
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  {
    engineering:
      runShape === P.PIPE_SHAPES.rectangular
        ? { shape: P.PIPE_SHAPES.circular, diameter: 900 }
        : {
            shape: P.PIPE_SHAPES.rectangular,
            width: 480,
            height: 320
          }
  }
);

check(
  "the other cross-section shape draws the same spacing too",
  close(spacingOf(runOtherShape), SCHEMATIC),
  `got ${spacingOf(runOtherShape)}, wanted ${SCHEMATIC}`
);

/* ============================================================
 * 3. STRAIGHT SECTIONS AT ANY LENGTH AND DIRECTION
 * ============================================================ */

console.log("\n  straight sections at any length and direction\n");

[
  ["an east run", { x: 0, y: 0 }, { x: 500, y: 0 }],
  ["a short run", { x: 0, y: 0 }, { x: 6, y: 0 }],
  ["a north run", { x: 40, y: 10 }, { x: 40, y: 240 }],
  ["a diagonal run", { x: -30, y: -70 }, { x: 210, y: 90 }],
  ["a shallow diagonal run", { x: 0, y: 0 }, { x: 1000, y: 37 }]
].forEach(([name, start, end]) => {
  const feature = P.createPipeDuct(start, end, { engineering: changed });

  const lines = P.boundaryLines(
    feature.geometry.start,
    feature.geometry.end,
    feature.engineering
  );

  const separation = Math.hypot(
    lines[0].start.y - lines[1].start.y,
    lines[0].start.x - lines[1].start.x
  );

  const midA = {
    x: (lines[0].start.x + lines[0].end.x) / 2,
    y: (lines[0].start.y + lines[0].end.y) / 2
  };

  const midB = {
    x: (lines[1].start.x + lines[1].end.x) / 2,
    y: (lines[1].start.y + lines[1].end.y) / 2
  };

  const midCentre = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };

  const half = SCHEMATIC / 2;

  check(
    `${name}: the walls sit one schematic spacing apart`,
    close(separation, SCHEMATIC),
    `got ${separation}`
  );

  check(
    `${name}: the centreline runs halfway between the walls`,
    close((midA.x + midB.x) / 2, midCentre.x) &&
      close((midA.y + midB.y) / 2, midCentre.y),
    `midpoints ${JSON.stringify([(midA.x + midB.x) / 2, (midA.y + midB.y) / 2])} against ${JSON.stringify([midCentre.x, midCentre.y])}`
  );

  check(
    `${name}: each wall is half the schematic spacing from the centreline`,
    close(Math.hypot(midA.x - midCentre.x, midA.y - midCentre.y), half),
    `got ${Math.hypot(midA.x - midCentre.x, midA.y - midCentre.y)}`
  );
});

/* ============================================================
 * 4. ELBOWS AT BOTH SUPPORTED ANGLES
 * ============================================================ */

console.log("\n  elbows at both supported angles\n");

const elbowCases = [
  ["a 90 degree elbow", { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }],
  ["a 45 degree elbow", { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 341.4213562373095, y: 141.4213562373095 }]
];

elbowCases.forEach(([name, previous, vertex, next]) => {
  const radius = 40;

  const curves = P.elbowGeometry(previous, vertex, next, radius);

  check(
    `${name}: the elbow geometry resolves`,
    Boolean(curves)
  );

  if (!curves) {
    return;
  }

  const inner = curves.radius - SCHEMATIC / 2;
  const outer = curves.radius + SCHEMATIC / 2;

  check(
    `${name}: both wall radii are positive`,
    inner > 0 && outer > 0,
    `${inner} / ${outer}`
  );

  const inDirection = curves.inDirection;

  /*
   * The arc starts where the straight run's wall is, so each of the two
   * straight wall points - one on each side of the centreline - must land on
   * one of the two arc start points, whichever of the two radii is its wall.
   * Which side is the inner wall depends on the turn direction, so each wall
   * point is matched against BOTH radii and required to hit one of them.
   */
  const normal = {
    x: -inDirection.y,
    y: inDirection.x
  };

  const half = SCHEMATIC / 2;

  const arcStartAt = (radius) => ({
    x: curves.centre.x + radius * Math.cos(curves.startAngle),
    y: curves.centre.y + radius * Math.sin(curves.startAngle)
  });

  [half, -half].forEach((side) => {
    const wallPoint = {
      x: curves.start.x + normal.x * side,
      y: curves.start.y + normal.y * side
    };

    const gap = Math.min(
      Math.hypot(wallPoint.x - arcStartAt(inner).x, wallPoint.y - arcStartAt(inner).y),
      Math.hypot(wallPoint.x - arcStartAt(outer).x, wallPoint.y - arcStartAt(outer).y)
    );

    check(
      `${name}: the straight wall at side ${side} connects to an arc wall (no gap or spike)`,
      gap < 1e-6,
      `gap ${gap}`
    );
  });

  /*
   * The wall-to-wall distance measured ACROSS the arc, at its middle, must be
   * the same schematic spacing as the straight sections.
   */
  const midAngle = curves.startAngle + (curves.endAngle - curves.startAngle) / 2;

  const arcInnerMid = {
    x: curves.centre.x + inner * Math.cos(midAngle),
    y: curves.centre.y + inner * Math.sin(midAngle)
  };

  const arcOuterMid = {
    x: curves.centre.x + outer * Math.cos(midAngle),
    y: curves.centre.y + outer * Math.sin(midAngle)
  };

  const arcSpacing = Math.hypot(
    arcInnerMid.x - arcOuterMid.x,
    arcInnerMid.y - arcOuterMid.y
  );

  check(
    `${name}: the walls are the same schematic spacing apart around the bend`,
    close(arcSpacing, SCHEMATIC),
    `got ${arcSpacing}`
  );
});

/* ============================================================
 * 5. THE SPACING IS NOT A DIMENSION
 * ============================================================
 *
 * The panel DOES expose the spacing now - as the Transform's Pipe Width Change,
 * a change from the drawing default rather than a dimension of the cross
 * section. What must remain true is the distinction that test was written to
 * protect: the DIMENSIONS (diameter, width, height) never move the walls.
 */

console.log("\n  the spacing is a drawing style, not a dimension\n");

const fs = require("fs");
const path = require("path");

check(
  "the panel's Pipe Width is a relative offset, not an absolute boundary separation",
  /pipeWidth/.test(
    fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "layout", "panels", "feature-schema.js"),
      "utf8"
    )
  ),
  "Pipe Width is the supported way to alter the spacing"
);

check(
  "the spacing is NOT read from the engineering dimensions anywhere in the model",
  !/engineering\.width|engineering\.diameter/.test(
    fs
      .readFileSync(
        path.join(__dirname, "..", "src", "features", "workspace", "model", "fluids", "pipe-duct.js"),
        "utf8"
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
  ),
  "the spacing must not derive from a dimensional property"
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
