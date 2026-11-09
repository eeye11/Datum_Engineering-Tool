/* eslint-disable no-console */
/*
 * ========================================================
 * STROKE CORRECTION: THE GEOMETRY, NOT THE PREVIEW
 * ========================================================
 *
 * The previous suite could only say that a Corrected path existed. A path that
 * exists may be the student's own ink, redrawn. These tests measure the
 * GEOMETRY: how far a line's samples stray from the line the correction
 * returned, how many samples a clean curve keeps, whether an endpoint moved,
 * whether a corner survived.
 *
 * Registered with node:test so `npm test` enforces it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

const { createHarness } = require("./harness-renderer.cjs");

const { dom } = createHarness(projectRoot, JSDOM, require);
const { loadModule } = require("./helpers/source-path.cjs");

const correction = loadModule("math-sketch-correction.js");

/* ------------------------------------------------------------ helpers */

/* A deterministic pseudo-random tremor, so a failing case is reproducible. */
function tremor(index, seed = 1) {
  const value = Math.sin(index * 12.9898 * seed + seed * 78.233) * 43758.5453;

  return value - Math.floor(value) - 0.5;
}

/* A hand-drawn straight line between two points. */
function wobblyLine(
  from,
  to,
  { steps = 120, amplitude = 0.06, seed = 1 } = {},
) {
  const points = [];

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const length = Math.hypot(dx, dy);

  const nx = -dy / length;
  const ny = dx / length;

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;

    /* The tremor fades in and out at the ends, as a real one does. */
    const envelope = Math.sin(Math.PI * t);

    const offset = tremor(index, seed) * amplitude * envelope;

    points.push({
      x: from.x + dx * t + nx * offset,
      y: from.y + dy * t + ny * offset,
    });
  }

  return points;
}

/* A curve, sampled and then wobbled. */
function wobblyCurve(shape, { steps = 140, amplitude = 0.05, seed = 2 } = {}) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const at = shape(index / steps);

    return {
      x: at.x + tremor(index, seed) * amplitude,
      y: at.y + tremor(index + 7, seed) * amplitude,
    };
  });
}

/* The largest distance from any of `points` to the segment a-b. */
function maxDeviation(points, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  return Math.max(
    ...points.map((point) => {
      if (lengthSquared <= 1e-12) {
        return Math.hypot(point.x - a.x, point.y - a.y);
      }

      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
        ),
      );

      return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    }),
  );
}

/* The polyline of a corrected result, whether it is a line or a spline. */
function drawnPoints(result) {
  if (result.segments && result.segments.length) {
    const sampled = [result.segments[0].from];

    result.segments.forEach((segment) => {
      const steps = 6;

      for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const u = 1 - t;

        sampled.push({
          x:
            u * u * u * segment.from.x +
            3 * u * u * t * segment.control1.x +
            3 * u * t * t * segment.control2.x +
            t * t * t * segment.to.x,
          y:
            u * u * u * segment.from.y +
            3 * u * u * t * segment.control1.y +
            3 * u * t * t * segment.control2.y +
            t * t * t * segment.to.y,
        });
      }
    });

    return sampled;
  }

  return result.points;
}

/* Total turning of a polyline, in radians - how wiggly its direction is. */
function totalTurning(points) {
  let turning = 0;

  for (let index = 2; index < points.length; index += 1) {
    const a = points[index - 2];
    const b = points[index - 1];
    const c = points[index];

    const angleA = Math.atan2(b.y - a.y, b.x - a.x);
    const angleB = Math.atan2(c.y - b.y, c.x - b.x);

    let difference = angleB - angleA;

    while (difference > Math.PI) difference -= 2 * Math.PI;
    while (difference < -Math.PI) difference += 2 * Math.PI;

    turning += Math.abs(difference);
  }

  return turning;
}

const close = (a, b, tolerance = 0.15) => Math.abs(a - b) <= tolerance;

/* ------------------------------------------------------------- lines */

test("1. a wobbly horizontal line becomes a horizontal line", () => {
  const raw = wobblyLine({ x: -4, y: 1 }, { x: 4, y: 1 }, { amplitude: 0.12 });

  const inputDeviation = maxDeviation(raw, raw[0], raw[raw.length - 1]);

  const result = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );

  assert.equal(result.correction.kind, "horizontal");
  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].y, result.points[1].y);

  /*
   * THE RAW SAMPLES' DISTANCE FROM THE CORRECTED LINE is the measure that
   * matters: it is how far the student's ink was from the line they meant. The
   * hand's tremor is that distance, and the corrected geometry is the line.
   */
  const outputDeviation = maxDeviation(raw, result.points[0], result.points[1]);

  assert.ok(
    outputDeviation < 0.2,
    `the ink strays ${outputDeviation.toFixed(3)} from the corrected line`,
  );

  assert.equal(inputDeviation > 0.05, true);

  /* It is the line the student meant, not one shifted by the tremor. */
  assert.ok(close(result.points[0].y, 1, 0.05), String(result.points[0].y));
  assert.ok(close(result.points[0].x, -4), String(result.points[0].x));
  assert.ok(close(result.points[1].x, 4), String(result.points[1].x));
});

test("2. a wobbly vertical line becomes a vertical line", () => {
  const raw = wobblyLine(
    { x: 2, y: -3 },
    { x: 2, y: 3 },
    { amplitude: 0.12, seed: 5 },
  );

  const result = correction.correctStroke({ points: raw });

  assert.equal(result.correction.kind, "vertical");
  assert.equal(result.points[0].x, result.points[1].x);
  assert.ok(close(result.points[0].x, 2, 0.05), String(result.points[0].x));
  assert.ok(close(result.points[0].y, -3), String(result.points[0].y));
  assert.ok(close(result.points[1].y, 3), String(result.points[1].y));
});

test("3. a slightly noisy diagonal keeps its slope and loses its tremor", () => {
  const raw = wobblyLine(
    { x: 0, y: 0 },
    { x: 4, y: 3 },
    { amplitude: 0.05, seed: 9 },
  );

  const inputDeviation = maxDeviation(raw, raw[0], raw[raw.length - 1]);

  const result = correction.correctStroke({ points: raw });

  assert.equal(result.correction.kind, "line");
  assert.equal(result.points.length, 2);

  const slope =
    (result.points[1].y - result.points[0].y) /
    (result.points[1].x - result.points[0].x);

  assert.ok(close(slope, 0.75, 0.02), `slope ${slope}`);

  /*
   * THE CORRECTED LINE LIES WITHIN THE TREMOR OF EVERY SAMPLE - so the line is
   * the stroke's centre, not one of its wobbles. The tremor was 0.05 either
   * side, so anything much beyond that would mean the fit had chased the noise.
   */
  const outputDeviation = maxDeviation(raw, result.points[0], result.points[1]);

  assert.ok(
    outputDeviation < 0.12,
    `the ink strays ${outputDeviation.toFixed(3)} from the corrected line`,
  );

  assert.equal(inputDeviation > 0.01, true);
});

/* ------------------------------------------------------------ curves */

test("4. a smooth arc is kept as a curve, undamaged", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.002, seed: 3 },
  );

  const result = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );

  assert.equal(result.correction.kind, "curve");
  assert.ok(result.segments.length > 1);

  const drawn = drawnPoints(result);

  assert.ok(close(Math.max(...drawn.map((point) => point.y)), 3, 0.08));
  assert.ok(close(drawn[0].x, -4, 0.15));
  assert.ok(close(drawn[drawn.length - 1].x, 4, 0.15));
});

test("5. a noisy curved stroke becomes measurably smoother", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.09, seed: 11 },
  );

  const result = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );

  assert.equal(result.correction.kind, "curve");

  const drawn = drawnPoints(result);

  assert.ok(
    totalTurning(drawn) < totalTurning(raw) * 0.6,
    `turning ${totalTurning(drawn).toFixed(2)} from ${totalTurning(raw).toFixed(2)}`,
  );
});

test("6. an S-shaped curve stays an S", () => {
  const raw = wobblyCurve(
    (t) => ({
      x: -4 + 8 * t,
      y: Math.sin(t * Math.PI * 2) * 2,
    }),
    { amplitude: 0.03, seed: 4 },
  );

  const result = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );

  assert.equal(result.correction.kind, "curve");

  const drawn = drawnPoints(result);

  /*
   * AN S GOES UP AND THEN DOWN: it has a maximum AND a minimum, on opposite
   * sides of its own mid-level. A correction that flattened it into one hump
   * would have only one of them.
   */
  const peak = Math.max(...drawn.map((point) => point.y));
  const trough = Math.min(...drawn.map((point) => point.y));

  assert.ok(peak > 1 && trough < -1, `peak ${peak.toFixed(2)}, trough ${trough.toFixed(2)}`);
  assert.ok(close(Math.max(...drawn.map((point) => point.y)), 2, 0.35));
  assert.ok(close(Math.min(...drawn.map((point) => point.y)), -2, 0.35));
});

/* ------------------------------------------------------------- mixed */

test("7. a straight run and a curve in one stroke both survive", () => {
  /*
   * A horizontal run from -4 to 0, then an arch from 0 to 4. The join at x = 0
   * is a real change of shape: the correction must not round it into one bow,
   * and must not straighten the arch away either.
   */
  const raw = [];

  for (let index = 0; index <= 50; index += 1) {
    const t = index / 50;

    raw.push({
      x: -4 + 4 * t,
      y: tremor(index, 2) * 0.03,
    });
  }

  for (let index = 1; index <= 60; index += 1) {
    const t = index / 60;

    raw.push({
      x: 4 * t,
      y: 2 * Math.sin((Math.PI / 2) * t) + tremor(index, 3) * 0.03,
    });
  }

  const result = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );

  const drawn = drawnPoints(result);

  const flatRun = drawn.filter((point) => point.x < -0.3);
  const archRun = drawn.filter((point) => point.x > 0.6);

  assert.ok(
    Math.max(...flatRun.map((point) => Math.abs(point.y))) < 0.12,
    `the straight run is flat: ${Math.max(...flatRun.map((point) => Math.abs(point.y))).toFixed(3)}`,
  );

  assert.ok(
    Math.max(...archRun.map((point) => point.y)) > 1.5,
    "the curved section still rises",
  );

  /* And the join is not smoothed away. */
  const join = drawn.reduce((best, point) =>
    Math.abs(point.x) < Math.abs(best.x) ? point : best,
  );

  assert.ok(Math.abs(join.y) < 0.15, `join at (${join.x}, ${join.y})`);
});

test("8. a genuine corner is not rounded off", () => {
  /* A right angle drawn as one stroke: across, then up. */
  const raw = [];

  for (let index = 0; index <= 40; index += 1) {
    raw.push({ x: -3 + (3 * index) / 40, y: tremor(index, 4) * 0.02 });
  }

  for (let index = 1; index <= 40; index += 1) {
    raw.push({ x: tremor(index, 5) * 0.02, y: (3 * index) / 40 });
  }

  const result = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );

  /*
   * THE CORNER IS A VERTEX OF THE CORRECTED PATH, AND THE PATH TURNS THERE.
   *
   * A correction that fitted one curve through the whole stroke would pass
   * NEAR the corner and leave a rounded bend; the path is asked whether one of
   * its own points sits on it, and whether the two arms leave it at an angle.
   */
  const cornerIndex = result.points.reduce(
    (best, point, index) =>
      Math.hypot(point.x, point.y) < Math.hypot(result.points[best].x, result.points[best].y)
        ? index
        : best,
    0,
  );

  const corner = result.points[cornerIndex];

  assert.ok(
    Math.hypot(corner.x, corner.y) < 0.25,
    `nearest vertex (${corner.x.toFixed(2)}, ${corner.y.toFixed(2)})`,
  );

  const armA = Math.atan2(
    corner.y - result.points[0].y,
    corner.x - result.points[0].x,
  );

  const endPoint = result.points[result.points.length - 1];

  const armB = Math.atan2(corner.y - endPoint.y, corner.x - endPoint.x);

  let turn = Math.abs(armB - armA);

  if (turn > Math.PI) {
    turn = 2 * Math.PI - turn;
  }

  assert.equal(
    turn > Math.PI / 3,
    true,
    `arms meet at ${((turn * 180) / Math.PI).toFixed(0)} degrees`,
  );

  /*
   * AND THE PATH IS SMALL: a right angle is three points, not the forty the
   * student's hand produced, and not a spline invented to round it. A fitted
   * curve here would carry a Bezier chain; a cornered path may carry none.
   */
  assert.ok(
    result.points.length <= 8,
    `${result.points.length} points for a right angle`,
  );
});

/* --------------------------------------------------------- endpoints */

test("9. the student's endpoints are kept exactly", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -3 + 6 * t, y: 2 * Math.sin(Math.PI * t) }),
    { amplitude: 0.06, seed: 6 },
  );

  const result = correction.correctStroke({ points: raw });

  assert.ok(close(result.points[0].x, raw[0].x, 1e-9));
  assert.ok(close(result.points[0].y, raw[0].y, 1e-9));
  assert.ok(
    close(
      result.points[result.points.length - 1].x,
      raw[raw.length - 1].x,
      1e-9,
    ),
  );
  assert.ok(
    close(
      result.points[result.points.length - 1].y,
      raw[raw.length - 1].y,
      1e-9,
    ),
  );
});

test("9b. a stroke pinned to a point starts exactly on it", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -3 + 6 * t, y: 2 * Math.sin(Math.PI * t) }),
    { amplitude: 0.05, seed: 8 },
  );

  const result = correction.correctStroke(
    { points: raw },
    { pinStart: { x: -3, y: 0 }, pinEnd: { x: 3, y: 0 } },
  );

  assert.deepEqual(result.points[0], { x: -3, y: 0 });
  assert.deepEqual(result.points[result.points.length - 1], { x: 3, y: 0 });
});

/* ------------------------------------------------------- short strokes */

test("10. a very short stroke is returned unchanged rather than fitted", () => {
  const raw = [
    { x: 0, y: 0 },
    { x: 0.1, y: 0.02 },
  ];

  const result = correction.correctStroke({ points: raw });

  assert.equal(result.points.length, 2);
  assert.equal(result.segments.length, 0);

  const single = correction.correctStroke({ points: [{ x: 1, y: 1 }] });

  assert.equal(single.correction.kind, "none");

  const empty = correction.correctStroke({ points: [] });

  assert.equal(empty.points.length, 0);
});

/* --------------------------------------------------------- invariance */

test("11. correcting a corrected stroke does not deform it", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.07, seed: 12 },
  );

  const once = correction.correctStroke(
    { points: raw },
    { strength: "medium" },
  );
  const twice = correction.correctStroke(
    { points: once.points },
    { strength: "off" },
  );

  /*
   * CORRECTING A CORRECTED CURVE MUST NOT DEFORM IT. A shape that shrinks on
   * every pass is what progressively destroys a curve through undo, redo and
   * a reopen; the correction is not allowed to be lossy that way.
   */
  assert.ok(
    Math.abs(twice.points.length - once.points.length) <= 1,
    `${once.points.length} then ${twice.points.length}`,
  );

  const drift = Math.max(
    ...once.points.map((point, index) =>
      twice.points[index]
        ? Math.hypot(
            point.x - twice.points[index].x,
            point.y - twice.points[index].y,
          )
        : 0,
    ),
  );

  assert.ok(drift < 0.35, `drift ${drift.toFixed(3)}`);
});

test("12. changing the smoothing strength changes the result", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.09, seed: 13 },
  );

  const light = correction.correctStroke({ points: raw }, { strength: "light" });
  const strong = correction.correctStroke(
    { points: raw },
    { strength: "strong" },
  );

  assert.equal(light.correction.kind, "curve");
  assert.equal(strong.correction.kind, "curve");

  assert.ok(
    totalTurning(drawnPoints(strong)) < totalTurning(drawnPoints(light)),
    `strong ${totalTurning(drawnPoints(strong)).toFixed(2)} vs light ${totalTurning(drawnPoints(light)).toFixed(2)}`,
  );

  /* And every strength is smoother than the ink it started from. */
  assert.ok(totalTurning(drawnPoints(strong)) < totalTurning(raw));
});

test("13. correction off keeps the raw geometry", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.08, seed: 14 },
  );

  const off = correction.correctStroke({ points: raw }, { strength: "off" });

  assert.equal(off.correction.kind, "none");
  assert.equal(off.points.length, raw.length);

  /* Every point is exactly where it was drawn. */
  const drift = Math.max(
    ...raw.map((point, index) =>
      Math.hypot(point.x - off.points[index].x, point.y - off.points[index].y),
    ),
  );

  assert.equal(drift, 0);
});

test("14. a clean stroke is left nearly as it is", () => {
  const clean = Array.from({ length: 41 }, (_, index) => ({
    x: -2 + (4 * index) / 40,
    y: 2 * Math.sin((Math.PI / 2) * (index / 40)),
  }));

  const result = correction.correctStroke(
    { points: clean },
    { strength: "medium" },
  );

  const drawn = drawnPoints(result);

  const drift = Math.max(
    ...clean.map((point) =>
      Math.min(
        ...drawn.map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
      ),
    ),
  );

  /*
   * A FEW VERTICES APART, A SAMPLE SITS ON A CHORD - so the tolerance is a
   * quarter unit on a curve two units tall, which is nothing a student would
   * see. What must not change is the SHAPE, and the peak below is that check.
   */
  assert.ok(drift < 0.3, `a clean curve moved by ${drift.toFixed(3)}`);

  assert.ok(close(Math.max(...drawn.map((point) => point.y)), 2, 0.06));
});

/* --------------------------------------------------- no drift over time */

test("15. repeated correction does not progressively deform a curve", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.08, seed: 21 },
  );

  /*
   * WHAT A STUDENT ACTUALLY DOES: draw, adjust the smoothing, look at the
   * overlay, undo, redo, save, reopen. Each of those re-runs the correction on
   * the geometry the last one produced - so a correction that shrinks or drifts
   * a curve on every pass would slowly eat the student's sketch. Ten passes are
   * asked for here, and the last must still be the first.
   */
  let current = correction.correctStroke({ points: raw }, { strength: "medium" });

  const first = current.points.map((point) => ({ ...point }));
  const firstSegments = current.segments.map((segment) => ({ ...segment }));

  for (let pass = 0; pass < 10; pass += 1) {
    current = correction.correctStroke(
      { points: current.points, corrected: true, noise: current.band },
      { strength: "medium" },
    );
  }

  /*
   * THE MEASURE IS THE CURVE, NOT ITS VERTEX COUNT.
   *
   * A later pass may choose a different - equally correct - set of vertices, so
   * the vertices cannot be compared one for one. What is compared is the SHAPE:
   * the first result's spline is sampled, and each sample is asked how far it is
   * from the tenth result's spline. A curve that kept its shape answers a third
   * of a unit; one being eaten pass by pass does not.
   */
  const nearestOnCurve = (point, curve) =>
    Math.min(
      ...curve.map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
    );

  const before = drawnPoints({ points: first, segments: firstSegments });
  const after = drawnPoints(current);

  const drift = Math.max(
    ...before.map((point) => nearestOnCurve(point, after)),
  );

  assert.ok(drift < 0.35, `ten passes moved the curve by ${drift.toFixed(3)}`);

  /*
   * AND IT DOES NOT GAIN VERTICES. A corrected curve starts with a handful of
   * shape points; a correction that added one per pass would eventually draw a
   * hedgehog. One extra is allowed - a corrected curve can acquire a single
   * vertex on its second pass while the noise band settles - but not growth.
   */
  assert.ok(
    current.points.length <= first.length + 1,
    `${first.length} points became ${current.points.length}`,
  );

  assert.ok(close(Math.max(...current.points.map((point) => point.y)), 3, 0.2));
});

test("16. the correction does not depend on the canvas or the viewport", () => {
  const raw = wobblyCurve(
    (t) => ({ x: -4 + 8 * t, y: 3 * Math.sin(Math.PI * t) }),
    { amplitude: 0.07, seed: 31 },
  );

  /*
   * The pipeline works in GRAPH coordinates, so the only zoom-dependent input -
   * the tolerance converted from a screen distance - must not change the shape.
   * A wider tolerance is the same stroke cleaned a little more coarsely, which
   * is what a hand drawn on a zoomed-out canvas gets.
   */
  const at100 = correction.correctStroke({ points: raw }, { strength: "medium" });
  const at400 = correction.correctStroke(
    { points: raw },
    { strength: "medium", tolerance: 0.02 },
  );

  assert.equal(at100.correction.kind, at400.correction.kind);

  const drift = Math.max(
    ...drawnPoints(at100).map((point) =>
      Math.min(
        ...drawnPoints(at400).map((other) =>
          Math.hypot(point.x - other.x, point.y - other.y),
        ),
      ),
    ),
  );

  assert.ok(drift < 0.25, `the two tolerances differ by ${drift.toFixed(3)}`);
});

void dom;
