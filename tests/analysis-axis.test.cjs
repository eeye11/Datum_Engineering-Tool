
const path = require("path");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * THE ANALYSIS AXIS OF A SLOPING BODY.
 *
 * §5 of the specification: the analysis coordinate system must use the
 * body's own engineering direction, so a Beam drawn at an angle produces
 * an axis at the same angle and its stations still line up along it.
 *
 * A screen-aligned axis would be horizontal whatever the member does, so
 * this checks the angle of the axis against the angle of the span it came
 * from, and checks that it is the same LENGTH - a diagram that is not the
 * same length as its beam is a different diagram, not a scaled one.
 *
 * It also pins the offset behaviour, because that is what keeps a placed
 * diagram where the student put it when the beam is later resized.
 */


global.window = {
  crypto: {
    randomUUID: () => "analysis-axis-uuid"
  }
};

loadModule("feature-geometry.js");
loadModule("body-frames.js");
loadModule("analysis-dependencies.js");

const deps = global.window.enggAnalysisDependencies;

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`
    );
  }
};

console.log("\n  the analysis axis follows its body\n");

const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

const beam = (x1, y1, x2, y2) => ({
  id: "beam-1",
  type: "beam",
  geometry: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, depth: 12 }
});

const angleOf = (from, to) =>
  Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI);

/* A LEVEL beam - the common case. */
{
  const source = beam(0, 0, 300, 0);
  const axis = deps.axisFromSource(source, -60);

  check("a level beam gives a level axis", near(axis.start.y, -60), `y = ${axis.start.y}`);
  check("the axis starts at the beam's own start", near(axis.start.x, 0), `x = ${axis.start.x}`);
  check("the axis is as long as the beam", near(axis.length, 300), `length = ${axis.length}`);
  check("the axis starts at the beam's start", near(axis.end.x, 300), `x = ${axis.end.x}`);
}

/* A SLOPING beam - the case the specification calls out. */
[
  [0, 0, 200, 120],
  [-100, 40, 100, -40],
  [0, 0, 60, 180]
].forEach(([x1, y1, x2, y2], i) => {
  const source = beam(x1, y1, x2, y2);
  const axis = deps.axisFromSource(source, 40);

  const memberAngle = angleOf(
    { x: x1, y: y1 },
    { x: x2, y: y2 }
  );

  const axisAngle = angleOf(axis.start, axis.end);

  // Angles wrap at 180, so compare the direction VECTOR rather than degrees.
  const dx = axis.end.x - axis.start.x;
  const dy = axis.end.y - axis.start.y;
  const len = Math.hypot(dx, dy);
  const memberLen = Math.hypot(x2 - x1, y2 - y1);

  check(
    `sloping body ${i + 1}: the axis is parallel to its member, not to the screen`,
    near(dx / len, (x2 - x1) / memberLen, 1e-9) &&
      near(dy / len, (y2 - y1) / memberLen, 1e-9),
    `axis ${dx / len},${dy / len} vs member ${(x2 - x1) / memberLen},${(y2 - y1) / memberLen} ` +
      `(axis angle ${axisAngle.toFixed(2)}, member angle ${memberAngle.toFixed(2)})`
  );

  check(
    `sloping body ${i + 1}: the axis is the member's own length`,
    near(axis.length, memberLen, 1e-9),
    `axis ${axis.length} vs member ${memberLen}`
  );
});

/*
 * THE OFFSET IS ALONG THE MEMBER'S NORMAL, so a diagram stays a fixed
 * DISTANCE from a sloping member rather than at a fixed world y.
 */
{
  const source = beam(0, 0, 200, 120);
  const offset = 60;

  const axis = deps.axisFromSource(source, offset);

  const span = deps.spanOf(source);
  const dx = span.end.x - span.start.x;
  const dy = span.end.y - span.start.y;
  const len = Math.hypot(dx, dy);
  const normal = { x: -dy / len, y: dx / len };

  check(
    "the diagram is placed along the member's NORMAL, not at a world y",
    near(axis.start.x, span.start.x + normal.x * offset, 1e-9) &&
      near(axis.start.y, span.start.y + normal.y * offset, 1e-9),
    `axis ${axis.start.x},${axis.start.y}; expected ${
      span.start.x + normal.x * offset
    },${span.start.y + normal.y * offset}`
  );
}

/* The stored offset round-trips, so a later refresh is stable. */
{
  const source = beam(0, 0, 300, 0);
  const axis = deps.axisFromSource(source, -60);
  const stored = deps.verticalOffsetOf(axis, source);

  /*
   * A NUMBER, not an object - commitAnalysisAxis wraps it as
   * `{ distance: verticalOffsetOf(...) }` when it stores it, so reading
   * a `.distance` off the return value reads a property that is not
   * there. And it is the offset as given: placing at -60 puts the axis
   * 60 units along the normal, which is -60 for a member running along
   * +x, because that normal points at negative y.
   */
  check("the vertical offset is a plain distance, not an object", typeof stored === "number" && near(stored, -60, 1e-9), `stored = ${JSON.stringify(stored)}`);
}

/* A body with no span cannot carry a diagram. */
{
  check(
    "a body with no span has no axis",
    deps.axisFromSource({ id: "x", geometry: {} }, -60) === null
  );

  check(
    "a zero-length body has no axis",
    deps.axisFromSource(beam(10, 10, 10, 10), -60) === null
  );
}

/*
 * ============================================================
 * THE GRAPH'S RANGE IS THE MEMBER'S, AND FOLLOWS IT
 * ============================================================
 *
 * The x domain of an AFD/SFD/BMD is the body it describes. That makes it
 * DERIVED, and a derived value that is only written once is a bug waiting for
 * the first Length edit: the axis was rebuilt to the new length and the range
 * stayed at the old one, so the graph was drawn correctly and every station on
 * it read off the wrong scale.
 *
 * Measured ALONG the body, so a sloping member gets the same 0 to L as a level
 * one - which is what makes a station at 2 m sit under the station at 2 m.
 */
console.log("\n  the range follows the member, not the moment of creation\n");

/*
 * A drawing state holding just what the dependency layer reads. The beam is
 * replaced by mutating it between calls rather than by building a second state,
 * because the property under test is that a refresh PICK UP A CHANGE rather
 * than that it can be handed one.
 */
const state = {
  objects: [],
  display: {},
  styleDefaults: {},
};

const withSource = (length) =>
  beam(0, 0, length, 0);

{
  /*
   * A DIAGRAM REFRESHED AGAINST A BODY, which is what the dependency layer
   * does whenever the body or anything on it changes.
   */
  const source = withSource(300);

  

  const diagram = {
    id: "sfd-1",
    type: "analysis-diagram",
    engineering: { discipline: "statics", analysisKind: "shear-force-diagram", sourceFeatureId: source.id },
    geometry: {
      start: { x: 0, y: -60 },
      end: { x: 300, y: -60 },
      mode: "plot",
      sourceOffset: { distance: -60 },
      /*
       * What the range looked like when the diagram was created. It must NOT
       * survive the refresh below - it is the whole of the fault.
       */
      localRange: { from: 0, to: 100 }
    }
  };

  state.objects = [source, diagram];

  deps.refreshAnalysis(diagram, state);

  check(
    "a refresh restates the range from the body it describes",
    diagram.geometry.localRange &&
      near(diagram.geometry.localRange.to, 300, 1e-9),
    `localRange = ${JSON.stringify(diagram.geometry.localRange)}`,
  );

  check(
    "and the axis is the same length as the range",
    near(
      Math.hypot(
        diagram.geometry.end.x - diagram.geometry.start.x,
        diagram.geometry.end.y - diagram.geometry.start.y
      ),
      300,
      1e-9
    ),
    `axis length = ${
      Math.hypot(
        diagram.geometry.end.x - diagram.geometry.start.x,
        diagram.geometry.end.y - diagram.geometry.start.y
      )
    }`,
  );

  /* Now the member is lengthened, which is the case that used to go stale. */
  source.geometry.end = { x: 700, y: 0 };

  deps.refreshAnalysis(diagram, state);

  check(
    "lengthening the member restates the range with it",
    diagram.geometry.localRange &&
      near(diagram.geometry.localRange.to, 700, 1e-9),
    `localRange = ${JSON.stringify(diagram.geometry.localRange)}`,
  );

  check(
    "the range still starts at zero, measured along the member",
    diagram.geometry.localRange &&
      near(diagram.geometry.localRange.from, 0, 1e-9)
  );

  check(
    "and the axis grew with the member rather than staying put",
    near(diagram.geometry.end.x - diagram.geometry.start.x, 700, 1e-9),
    `axis = ${diagram.geometry.start.x}..${diagram.geometry.end.x}`,
  );
}

/* A SLOPING member still gets 0 to L along its own direction. */
{
  const source = {
    id: "beam-slope",
    type: "beam",
    geometry: { start: { x: 0, y: 0 }, end: { x: 300, y: 400 }, depth: 12 }
  };

  const diagram = {
    id: "bmd-1",
    type: "analysis-diagram",
    engineering: { discipline: "statics", analysisKind: "bending-moment-diagram", sourceFeatureId: source.id },
    geometry: {
      start: { x: 0, y: -60 },
      end: { x: 300, y: 400 },
      mode: "plot",
      localRange: { from: 0, to: 100 }
    }
  };

  state.objects = [source, diagram];

  deps.refreshAnalysis(diagram, state);

  check(
    "a sloping member's range is its length, not its width",
    diagram.geometry.localRange &&
      near(diagram.geometry.localRange.to, 500, 1e-9),
    `localRange = ${JSON.stringify(diagram.geometry.localRange)}, expected 500`,
  );
}

/*
 * THE STUDENT'S EXPRESSIONS ARE LEFT ALONE.
 *
 * An expression's own range says where that relation EXISTS - it is part of
 * what was written - so a longer body must not quietly stretch it. The diagram
 * stops covering the new ground, which is visible and correctable; silently
 * redrawing someone's equations is not.
 */
{
  const source = withSource(300);



  const diagram = {
    id: "sfd-2",
    type: "analysis-diagram",
    engineering: { discipline: "statics", analysisKind: "shear-force-diagram", sourceFeatureId: source.id },
    geometry: {
      start: { x: 0, y: -60 },
      end: { x: 300, y: -60 },
      mode: "plot",
      sourceOffset: { distance: -60 },
      expressions: [
        {
          id: "expr-1",
          relationType: "functionX",
          expression: "10",
          xRange: { start: 0, end: 120 }
        }
      ]
    }
  };

  state.objects = [source, diagram];

  deps.refreshAnalysis(diagram, state);

  check(
    "an expression's own range is the student's, and is not rewritten",
    diagram.geometry.expressions &&
      diagram.geometry.expressions[0] &&
      near(diagram.geometry.expressions[0].xRange.end, 120, 1e-9),
    `xRange = ${JSON.stringify(
      diagram.geometry.expressions &&
        diagram.geometry.expressions[0] &&
        diagram.geometry.expressions[0].xRange
    )}`,
  );
}

console.log(
  `\n  ${pass} passed, ${fail} failed\n`
);

if (fail) {
  process.exitCode = 1;
}
