/*
 * ============================================================
 * CURVE TREND ANALYSIS - INCREASING, DECREASING, CONCAVITY
 * ============================================================
 *
 * A general polynomial-type sketch curve is a MATHEMATICAL object, so the
 * questions "is it increasing?" and "is it concave up?" are answered from the
 * curve's own derivatives - never from the look of the rough stroke it came
 * from, and never from the sign of its Y coordinates.
 *
 * WHY THE SAMPLED STROKE CANNOT ANSWER THIS
 * -----------------------------------------
 * A hand's tremor makes the first difference change sign on every second
 * sample and the second difference change sign even more often. Reading the
 * classification off those differences produces "increasing, decreasing,
 * increasing, decreasing..." over a single hump - technically derived from the
 * ink and completely useless. The classification is therefore derived from the
 * RECONSTRUCTED geometry, and small numerical movement is ignored through a
 * tolerance tied to the curve's own size.
 *
 * WHAT IS EXAMINED
 * ----------------
 *
 *   y = f(x)    the curve between two points of a monotone-in-x run. Fitted by
 *               a LOW-DEGREE polynomial (straight, quadratic or cubic - chosen
 *               by which fits, not by preference) because a high-degree fit
 *               between sample points oscillates exactly where nobody is
 *               looking. Its first derivative decides increasing / decreasing /
 *               approximately constant; its second derivative decides concavity
 *               and where concavity changes.
 *
 *   circles     NOT a function of x. A circle is increasing on one arc,
 *               decreasing on another and vertical at two points, so forcing a
 *               single "increasing" onto it would be a lie. It is reported as
 *               closed and skipped.
 *
 *   vertical    a run whose x is (nearly) constant is a vertical line: it is not
 *   runs        a function of x either, and is skipped.
 *
 *   looping     a run whose x reverses direction is skipped for the monotonicity
 *               question in x, and only its own valid properties are reported.
 *
 * INTERVALS, NOT LABELS
 * ---------------------
 * The answer is a list of INTERVALS - [x0, x1, trend, concavity] - so a curve
 * that rises then falls reports both, split at the turning point where the
 * derivative changes sign. Every split has to be MATHEMATICALLY meaningful: a
 * derivative that merely wobbles inside the tolerance never splits anything.
 */

const EPSILON = 1e-9;



/* How far a sample may move and still count as "approximately constant". */
const FLAT_BAND_SHARE = 0.004;

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/* ============================================================
 * SMALL LINEAR ALGEBRA - SOLVING A SMALL NORMAL SYSTEM
 * ============================================================ */

/*
 * Gaussian elimination with partial pivoting, for the tiny systems a
 * polynomial fit produces (at most 4 x 4). Returns null when the system is
 * singular - a fit that cannot be solved is not a fit.
 */
function solve(matrix, vector) {
  const n = vector.length;

  const a = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < n; column += 1) {
    let pivot = column;

    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][column]) < 1e-12) {
      return null;
    }

    [a[column], a[pivot]] = [a[pivot], a[column]];

    for (let row = 0; row < n; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = a[row][column] / a[column][column];

      for (let k = column; k <= n; k += 1) {
        a[row][k] -= factor * a[column][k];
      }
    }
  }

  return a.map((row, index) => row[n] / row[index]);
}

/* ============================================================
 * A LOW-DEGREE POLYNOMIAL THROUGH SAMPLES
 * ============================================================ */

/*
 * Y AS A POLYNOMIAL IN X, OF A CHOSEN DEGREE.
 *
 * The x values are SHIFTED AND SCALED onto [-1, 1] before fitting. A cubic on
 * raw coordinates spanning thousands of units produces normal equations whose
 * conditioning destroys the answer even in double precision; on the unit
 * interval the same fit is well-behaved. The coefficients are kept in the
 * local variable and the derivatives are converted back through the chain
 * rule, so the caller always works in the students's own coordinates.
 */
export function fitPolynomialY(points, degree = 3) {
  const list = (Array.isArray(points) ? points : []).filter(
    (point) =>
      point &&
      Number.isFinite(Number(point.x)) &&
      Number.isFinite(Number(point.y)),
  );

  if (list.length < 2) {
    return null;
  }

  const xs = list.map((point) => Number(point.x));

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);

  const span = xMax - xMin;

  if (!(span > EPSILON)) {
    return null;
  }

  const mid = (xMin + xMax) / 2;
  const half = span / 2;

  /*
   * THE FIT IS BUILT OVER THE STRIP ITSELF, EXACTLY AND WITHOUT CLAMPING.
   *
   * The normal equations are in terms of the actual u of each sample. Clamping
   * a sample at the ends of the strip to get a safer derivative probe would
   * mean fitting a slightly different set of x values from the ones the
   * derivatives are later evaluated at - and a symmetric hump would then come
   * back with a tilt instead of its own two sides.
   */
  const uOf = (x) => (x - mid) / half;

  const order = Math.max(1, Math.min(6, Math.round(degree)));

  const size = order + 1;

  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const v = new Array(size).fill(0);

  list.forEach((point) => {
    const u = uOf(point.x);
    const y = point.y;

    const row = Array.from({ length: size }, (_, power) => u ** power);

    for (let i = 0; i < size; i += 1) {
      v[i] += row[i] * y;

      for (let j = 0; j < size; j += 1) {
        m[i][j] += row[i] * row[j];
      }
    }
  });

  const solved = solve(m, v);

  if (!solved && order > 1) {
    /* A singular system falls back to the highest degree that can be solved. */
    return fitPolynomialY(points, order - 1);
  }

  if (!solved) {
    return null;
  }

  const at = (x) => {
    const u = uOf(x);

    let total = 0;

    for (let power = solved.length - 1; power >= 0; power -= 1) {
      total = total * u + solved[power];
    }

    return total;
  };

  /*
   * THE DERIVATIVES, THROUGH THE CHAIN RULE.
   *
   * The polynomial is in u = (x - mid) / half, so
   *     dy/dx   = (dy/du) / half
   *     d2y/dx2 = (d2y/du2) / half^2
   */
  const slopeAt = (x) => {
    const u = uOf(x);

    let total = 0;

    for (let power = solved.length - 1; power >= 1; power -= 1) {
      total = total * u + power * solved[power];
    }

    return total / half;
  };

  const curvatureAt = (x) => {
    const u = uOf(x);

    let total = 0;

    for (let power = solved.length - 1; power >= 2; power -= 1) {
      total = total * u + power * (power - 1) * solved[power];
    }

    return total / (half * half);
  };

  /* The fit's own error, in model units, so the caller can judge it. */
  let worst = 0;

  list.forEach((point) => {
    worst = Math.max(worst, Math.abs(at(point.x) - point.y));
  });

  return {
    degree: order,
    coefficients: solved,
    mid,
    half,
    xMin,
    xMax,
    at,
    slopeAt,
    curvatureAt,
    worst,
  };
}

/* ============================================================
 * WHETHER X IS MONOTONE (so f(x) is a function on the interval)
 * ============================================================ */

/*
 * The direction x moves in over a run, and whether it ever reverses.
 *
 * A run that reverses in x is a LOOP. It can be curved and smooth, and it is
 * still not a function of x - so it must not be given one monotonicity label.
 */
export function xMonotonicity(points, tolerance = 0) {
  const list = Array.isArray(points) ? points : [];

  let direction = 0;
  let reversals = 0;
  let flat = 0;

  for (let index = 1; index < list.length; index += 1) {
    const step = finite(list[index].x) - finite(list[index - 1].x);

    if (Math.abs(step) <= tolerance) {
      flat += 1;
      continue;
    }

    const sign = Math.sign(step);

    if (direction === 0) {
      direction = sign;
    } else if (sign !== direction) {
      reversals += 1;
    }
  }

  return {
    /* 1 increasing in x, -1 decreasing in x, 0 no meaningful movement. */
    direction,
    reversals,
    flat,
    monotone: reversals === 0 && direction !== 0,
    /* Vertical: x barely moves at all, so it is not a graph of x. */
    vertical: direction === 0,
  };
}

/*
 * THE DIRECTION THE CURVE TRAVELS, MEASURED FROM ITS OWN CHOPS.
 *
 * The tangent at a sample is read across a span either side of it, so the
 * hand's tremor - which reverses from one sample to the next - largely cancels
 * and what remains is the shape. Each tangent carries the x it belongs to, so a
 * candidate polynomial can be asked whether it agrees.
 *
 * This is the one measurement that distinguishes a curve from a line fitted to
 * a curve: both explain the points, only one explains the travelling direction.
 */
export function pathTangents(points) {
  const list = Array.isArray(points) ? points : [];

  if (list.length < 3) {
    return [];
  }

  const step = Math.max(1, Math.round(list.length * 0.03));

  const tangents = [];

  /*
   * THE ENDS ARE NOT PROBED. A one-sided tangent at an end measures the slope
   * THERE, and a polynomial's slope at its own boundary is a fragile thing to
   * match - fitting to it turned a clean hump into a cubic. The interior samples
   * already say where the curve is going at both ends.
   */
  for (let index = step; index < list.length - step; index += step) {
    const before = list[index - step];
    const after = list[index + step];

    const dx = after.x - before.x;
    const dy = after.y - before.y;

    tangents.push({
      at: list[index],
      slope: Math.abs(dx) < EPSILON ? 0 : dy / dx,
      vertical: Math.abs(dx) < EPSILON,
    });
  }

  return tangents.filter((tangent) => !tangent.vertical);
}

/* ============================================================
 * TREND LABELS
 * ============================================================ */

export const TREND_LABELS = Object.freeze({
  increasing: "Increasing",
  decreasing: "Decreasing",
  constant: "Approximately constant",
  rising: "Increasing",
  falling: "Decreasing",
  none: "Trend not a function of x",
});

export const CONCAVITY_LABELS = Object.freeze({
  up: "Concave upward",
  down: "Concave downward",
  flat: "Straight",
  none: "Concavity not applicable",
});

/* ============================================================
 * ANALYSING ONE FUNCTION-TYPE RUN
 * ============================================================ */

/*
 * THE TREND OF ONE RUN OF A CURVE, SPLIT WHERE IT GENUINELY CHANGES.
 *
 * The run is walked in x order, sampling the first and second derivatives of
 * the fitted polynomial. A change of sign counts only when it is sustained:
 * the derivative must stay on the new side for a meaningful distance, which is
 * what stops a single noisy sample from inventing a turning point.
 *
 * The result is a list of intervals with a trend, a concavity, and - where one
 * exists - the turning point or inflection point that separates them.
 */
export function analyseTrend(points, options = {}) {
  const list = Array.isArray(points) ? points : [];

  const tolerance = Math.max(0, Number(options.tolerance) || 0);

  const monotonicity = xMonotonicity(list, tolerance);

  if (list.length < 3) {
    return emptyAnalysis(monotonicity, "too few points");
  }

  /* A vertical or looping run is not a function of x; only say so. */
  if (monotonicity.vertical || !monotonicity.monotone) {
    return emptyAnalysis(
      monotonicity,
      monotonicity.vertical
        ? "the curve is vertical here"
        : "x reverses along the curve",
    );
  }

  /* Work in increasing-x order whichever way the stroke was drawn. */
  const ordered = [...list].sort((a, b) => a.x - b.x);

  const xs = ordered.map((point) => Number(point.x));
  const ys = ordered.map((point) => Number(point.y));

  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);

  const size = Math.max(spanX, spanY, EPSILON);

  const flatBand = size * FLAT_BAND_SHARE;

  /*
   * THE POLYNOMIAL IS THE ONE THAT EXPLAINS THE CURVE - both the y values and
   * the TANGENTS BETWEEN THEM.
   *
   * Fitting y alone is not enough to answer "is this curve increasing?". A
   * symmetric hump is fitted perfectly by a quadratic, whose derivative is
   * positive on one side and negative on the other; the same samples fitted by
   * a straight line have one sign everywhere. Both fit the y values within the
   * noise, and they disagree completely about the shape.
   *
   * The path - the direction the student's curve is travelling at each point -
   * settles it. It is measured from the curve itself, in the middle of each
   * step, so a tremor cannot bias it; the polynomial whose slope matches the
   * path is the one whose derivative is the curve's derivative. The degree is
   * then lowered while the fit stays good, so a curve that is really a line is
   * described as a line.
   */
  const tangents = pathTangents(ordered);

  /*
   * HOW WELL A CANDIDATE EXPLAINS THE CURVE: ITS Y ERROR, AND ITS TANGENT ERROR
   * IN THE SAME UNITS.
   *
   * A y error is a distance; a tangent error is a slope, and multiplying the
   * MEAN slope error by the run's width turns it into the distance the curve
   * would travel wrongly over that width. The two are ADDED, so a candidate is
   * judged on both of its claims: a cubic that follows the points but tilts a
   * symmetric arch scores worse than the quadratic that gets both right, and a
   * line that cannot follow an arch scores worse than either.
   */
  /*
   * THE TWO ERRORS ARE MEASURED IN THE SAME UNITS.
   *
   * A y error is a distance, and a tangent error is multiplied by the run's
   * width to become the distance the curve would travel wrongly over that
   * width. The MEAN tangent error is used, not the worst: a single noisy tangent
   * at an end would otherwise decide the degree by itself.
   */
  const tangentError = (candidate) => {
    if (!tangents.length) {
      return 0;
    }

    const total = tangents.reduce(
      (sum, tangent) =>
        sum + Math.abs(candidate.slopeAt(tangent.at.x) - tangent.slope),
      0,
    );

    return (total / tangents.length) * spanX * 0.35;
  };

  /*
   * A CANDIDATE IS KEPT ONLY IF BOTH PARTS ARE GOOD.
   *
   * The y error and the tangent error must each be within the run's tolerance -
   * the same "close enough to be a description, not a caricature" the line and
   * circle tests use. A cubic that follows the points but tilts a symmetric
   * arch fails on its tangents even though its y error is tiny, which is exactly
   * the case a summed error would let through on a lucky trade-off.
   */
  /*
   * THE TOLERANCE IS A SHARE OF THE RUN'S OWN SIZE - tight enough that a line
   * is never accepted for a curve it visibly misses, loose enough that a hand's
   * tremor is not a shape. Four per cent of the run is roughly the wobble of a
   * careful line and far less than the sag of any real bow.
   */
  const fitTolerance = size * 0.04;

  const agreement = (candidate) =>
    candidate ? Math.max(candidate.worst, tangentError(candidate)) : Infinity;

  const explains = (candidate) =>
    Boolean(candidate) &&
    candidate.worst <= fitTolerance &&
    tangentError(candidate) <= fitTolerance;

  const candidates = [
    fitPolynomialY(ordered, 3),
    fitPolynomialY(ordered, 2),
    fitPolynomialY(ordered, 1),
  ].filter(Boolean);

  let polynomial = null;

  if (candidates.length) {
    /*
     * THE LOWEST DEGREE THAT ACTUALLY EXPLAINS THE CURVE.
     *
     * Degrees are tried from the lowest up, and the first that describes both
     * the points and the travelling direction is taken. Starting low is what
     * keeps an arch a quadratic rather than a cubic that fits the ends and tilts
     * its sides, and what keeps a nearly-straight run a line rather than a
     * spline asked to bend a hair.
     *
     * TWO CLAIMS HAVE TO BE MET, AND THE SECOND IS THE ONE THAT MATTERS HERE.
     *
     * A straight line fitted to a bowl explains its SLOPE everywhere - the
     * bowl's average slope is the line's slope - so slope agreement alone would
     * report a curved run as straight. It does not explain the VERTICAL
     * POSITION: the line misses the bowl's ends by a real distance, which the y
     * error reports. Requiring both is what separates "this curve really is a
     * line" from "this curve's slope happens to average out".
     */
    polynomial =
      candidates
        .slice()
        .sort((a, b) => a.degree - b.degree)
        .find(explains) ||
      candidates.reduce((winner, candidate) =>
        agreement(candidate) < agreement(winner) ? candidate : winner,
      );
  }

  if (!polynomial) {
    return emptyAnalysis(monotonicity, "no stable polynomial fit");
  }

  /*
   * A STRAIGHT FIT HAS NO TURNING POINT AND NO INFLECTION, AND SAYING SO IS
   * THE WHOLE ANSWER.
   *
   * Its derivative is constant and its second derivative is zero, so there is
   * no sign change to find - and running the change detector over a constant
   * slope only risks reading numerical dust as a feature.
   */
  if (polynomial.degree === 1) {
    const rising = polynomial.slopeAt(polynomial.xMin) > 0;

    return {
      monotonicity,
      polynomial,
      intervals: [
        {
          from: round(polynomial.xMin),
          to: round(polynomial.xMax),
          trend: rising ? "increasing" : "decreasing",
          concavity: "flat",
          label: rising ? "Increasing · Straight" : "Decreasing · Straight",
        },
      ],
      turnings: [],
      inflections: [],
      trend: rising ? "increasing" : "decreasing",
      trends: [rising ? "increasing" : "decreasing"],
      concavity: "flat",
      concavities: ["flat"],
      applicable: true,
      summary: `${rising ? "Increasing" : "Decreasing"} · Straight.`,
    };
  }

  /*
   * SAMPLE THE DERIVATIVES ON THE STROKE'S OWN RUN, THROUGH THE FIT.
   *
   * Each sample keeps BOTH halves of the evidence: the fitted curve at that x,
   * and the tangent the stroke itself has there. Between any two samples the
   * fitted slope is monotone, so a sign change between two of them is the only
   * place a turning point can be - and it is reported there rather than
   * inferred from a grid of numbers.
   */
  const samples = ordered.length - 1;

  const steps = ordered.map((point) => ({
    x: point.x,
    slope: polynomial.slopeAt(point.x),
    curvature: polynomial.curvatureAt(point.x),
    y: polynomial.at(point.x),
  }));

  /*
   * A TOLERANCE IS NOT NEEDED, AND WOULD BE WRONG.
   *
   * The derivatives come from a FITTED polynomial, which is smooth: their signs
   * change only where the fitted curve genuinely turns or genuinely changes its
   * bending. The tremor lives in the samples, not in the fit, so there is no
   * floating-point noise in the derivative at all - and choosing a band would
   * only introduce a cut-off whose value decided the answer. The fit was already
   * chosen to be the simplest one that explains the curve, so its own zeroes are
   * the curve's turning and inflection points.
   */
  const slopeSigns = steps.map((step) => Math.sign(step.slope));

  const concavitySigns = steps.map((step) => Math.sign(step.curvature));

  /*
   * A CHANGE HAS TO HOLD. A sign that flips for a single sample and flips back
   * is a coincidence between the fit and a sample; a genuine turning point
   * keeps its new sign. Two samples is what "holds" means on a smooth fit.
   */
  const minRun = 2;

  /*
   * A TURNING POINT MUST BE INSIDE THE DRAWING.
   *
   * A parabola fitted to a bowl of a curve turns just off its end - at x = 0.26
   * of a run that starts at 0 - because the fitted shape continues past the
   * ink. Reporting that as "a turning point" would tell a student the curve
   * has a maximum they cannot see. Only a sign change between two points that
   * were actually drawn is a turning point of this curve.
   */
  /*
   * A CHANGE IN THE FIRST OR LAST FEW PER CENT IS AT THE EDGE OF THE RUN, NOT
   * IN THE DRAWING. A parabola fitted to a bowl of a decreasing curve turns a
   * fifth of the way in - a maximum the student never drew - and reporting it
   * would split "decreasing" into "constant, then decreasing".
   */
  const edge = Math.max(2, Math.round(steps.length * 0.08));

  const inside = (changes) =>
    changes.filter((entry) => entry.index > edge && entry.index < steps.length - edge);

  const turnings = inside(signChangePoints(steps, slopeSigns, minRun));

  /*
   * AN INFLECTION POINT EXISTS ONLY IF THE CURVATURE CHANGES SIGN AT ALL. A
   * straight fit has zero curvature everywhere and no second derivative to
   * change - and a straight run must never be split at dust.
   */
  const curvatureMeaningful = signsPresent(concavitySigns) > 1;

  const inflections = curvatureMeaningful
    ? inside(signChangePoints(steps, concavitySigns, minRun))
    : [];

  /* ---- the intervals, split at the meaningful boundaries ---- */
  const cuts = [
    0,
    ...turnings.map((entry) => entry.index),
    ...inflections.map((entry) => entry.index),
    samples,
  ];

  const uniqueCuts = [...new Set(cuts)].sort((a, b) => a - b);

  const intervals = [];

  for (let index = 0; index < uniqueCuts.length - 1; index += 1) {
    const from = uniqueCuts[index];
    const to = uniqueCuts[index + 1];

    if (to - from < 1) {
      continue;
    }

    const middle = Math.round(from + (to - from) * 0.5);

    const interval = describeInterval(steps, from, to, middle, flatBand);

    if (!interval) {
      continue;
    }

    intervals.push(interval);
  }

  const merged = mergeIntervals(intervals);

  /*
   * THE POINTS, WITH THE FITTED CURVE'S OWN Y - and turned into plain
   * {x, y, kind} records once, so the summary and the inspector read the same
   * numbers rather than re-evaluating the fit.
   */
  const turningPoints = turnings.map((entry) => ({
    x: round(entry.x),
    y: round(polynomial.at(entry.x)),
    kind: entry.from > 0 ? "maximum" : "minimum",
  }));

  const inflectionPoints = inflections.map((entry) => ({
    x: round(entry.x),
    y: round(polynomial.at(entry.x)),
  }));

  /*
   * THE OVERALL DESCRIPTION, from the intervals rather than from one sample:
   * an increasing-then-decreasing curve says exactly that.
   */
  const trends = [...new Set(merged.map((interval) => interval.trend))];

  const concavities = [
    ...new Set(merged.map((interval) => interval.concavity)),
  ];

  return {
    monotonicity,
    polynomial,
    intervals: merged,
    turnings: turningPoints,
    inflections: inflectionPoints,
    trend: trends.join(" then "),
    trends,
    concavity: concavities.join(", then "),
    concavities,
    applicable: true,
    summary: describeSummary(
      merged,
      trends,
      concavities,
      turningPoints,
      inflectionPoints,
    ),
  };
}

function emptyAnalysis(monotonicity, reason) {
  return {
    monotonicity,
    polynomial: null,
    intervals: [],
    turnings: [],
    inflections: [],
    trend: "none",
    trends: [],
    concavity: "none",
    concavities: [],
    applicable: false,
    reason,
    summary:
      monotonicity?.vertical
        ? "Vertical curve - not a function of x, so increasing/decreasing does not apply."
        : "Trend not applicable - the curve is not a function of x.",
  };
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

/*
 * WHERE THE SIGN OF A DERIVATIVE ACTUALLY CHANGES.
 *
 * A change counts only if the new sign holds for `minRun` samples; a spike that
 * flips back immediately is numerical noise, and splitting a curve at noise is
 * how "multiple trend segments detected" came to mean nothing.
 */
/* How many distinct signs a run takes - a straight fit takes one. */
function signsPresent(signs) {
  return new Set(signs).size;
}

function signChangePoints(steps, signs, minRun) {
  const changes = [];

  let index = 1;

  while (index < signs.length) {
    if (signs[index] === 0 || signs[index] === signs[index - 1]) {
      index += 1;
      continue;
    }

    const before = signs[index - 1];
    const after = signs[index];

    if (before !== 0 && after !== 0) {
      /* Sustained? Look ahead `minRun` samples. */
      let holds = true;

      for (
        let look = index;
        look < Math.min(signs.length, index + minRun);
        look += 1
      ) {
        if (signs[look] !== 0 && signs[look] !== after) {
          holds = false;
          break;
        }
      }

      if (holds) {
        const at = steps[index] || steps[index - 1];

        changes.push({
          index,
          x: at.x,
          from: before,
          to: after,
        });
      }
    }

    index += 1;
  }

  return changes;
}

function describeInterval(steps, from, to, middle, flatBand) {
  const start = steps[from];
  const end = steps[to];
  const middleStep = steps[middle];

  if (!start || !end || !middleStep) {
    return null;
  }

  const rises = end.y - start.y;

  /*
   * THE TREND OF AN INTERVAL IS THE SIGN OF ITS DERIVATIVE, READ OVER THE WHOLE
   * INTERVAL RATHER THAN AT ONE SAMPLE.
   *
   * The fitted polynomial's MEAN slope across the interval is the honest
   * summary of "what the curve did here". Reading a single midpoint is what let
   * a symmetric hump - increasing on its left, decreasing on its right - be
   * described as "constant", because its middle sample happens to be flat.
   *
   * A rise the eye could not see - smaller than the curve's own drawn band -
   * is "approximately constant"; anything larger is the side it is on.
   */
  const intervalSlope = (end.y - start.y) / Math.max(end.x - start.x, EPSILON);

  let trend;

  if (Math.abs(rises) <= flatBand) {
    trend = "constant";
  } else if (intervalSlope > 0) {
    trend = "increasing";
  } else {
    trend = "decreasing";
  }

  /*
   * CONCAVITY IS THE SIGN OF THE SECOND DERIVATIVE IN THE MIDDLE OF THE
   * INTERVAL - not at its edge, where a turning point makes it zero.
   */
  const curvature = middleStep.curvature;

  let concavity;

  if (curvature > 0) {
    concavity = "up";
  } else if (curvature < 0) {
    concavity = "down";
  } else {
    concavity = "flat";
  }

  return {
    from: round(start.x),
    to: round(end.x),
    trend,
    concavity,
    label: `${TREND_LABELS[trend] || trend} · ${CONCAVITY_LABELS[concavity] || concavity}`,
  };
}

/* Adjacent intervals with the same trend and concavity are one interval. */
function mergeIntervals(intervals) {
  const merged = [];

  intervals.forEach((interval) => {
    const last = merged[merged.length - 1];

    if (
      last &&
      last.trend === interval.trend &&
      last.concavity === interval.concavity
    ) {
      last.to = interval.to;
      last.label = `${TREND_LABELS[last.trend]} · ${CONCAVITY_LABELS[last.concavity]}`;
      return;
    }

    merged.push({ ...interval });
  });

  return merged;
}

function describeSummary(
  intervals,
  trends,
  concavities,
  turnings,
  inflections,
) {
  if (!intervals.length) {
    return "Trend could not be determined.";
  }

  /*
   * A CURVE THAT RISES AND THEN FALLS SAYS EXACTLY THAT. The trend text is
   * built from the segments in order, so "Increasing, then decreasing" is the
   * honest description of a hump rather than "increasing" for part of it.
   */
  const trendText =
    trends.length === 1
      ? TREND_LABELS[trends[0]] || trends[0]
      : trends.map((trend) => TREND_LABELS[trend] || trend).join(", then ");

  const concavityText =
    concavities.length === 1
      ? CONCAVITY_LABELS[concavities[0]] || concavities[0]
      : concavities
          .map((value) => CONCAVITY_LABELS[value] || value)
          .join(", then ");

  const parts = [`${trendText} · ${concavityText}`];

  /*
   * THE SUMMARY THE BRIEF ASKS FOR: a trend, a concavity, and - where they
   * exist - the turning and inflection points. Nothing is padded with a
   * percentage or a claim the fit cannot support.
   */
  if (turnings.length === 1) {
    parts.push(
      `Turning point (${round(turnings[0].x)}, ${round(turnings[0].y)}) - a ${turnings[0].kind}.`,
    );
  } else if (turnings.length > 1) {
    parts.push(`${turnings.length} turning points.`);
  }

  if (inflections.length === 1) {
    parts.push(
      `Concavity changes at an inflection point (${round(inflections[0].x)}, ${round(inflections[0].y)}).`,
    );
  } else if (inflections.length > 1) {
    parts.push(`${inflections.length} inflection points.`);
  }

  parts[0] = `${parts[0]}.`;

  return parts.join(" ");
}

/* ============================================================
 * THE WHOLE ELEMENT
 * ============================================================ */

/*
 * THE TREND OF A RECONSTRUCTED ELEMENT.
 *
 * A circle, an ellipse or an arc is CLOSED (or angular) and is not a function
 * of x; it is reported as not applicable rather than being forced into a
 * single monotonic label. A curve, line or polyline is analysed run by run
 * between its own vertices, and the runs are reported together.
 */
export function analyseElementTrend(element) {
  const kind = String(element?.kind || element?.type || "curve");

  if (kind === "circle" || kind === "ellipse") {
    return {
      applicable: false,
      kind,
      reason: "a closed curve is not a function of x",
      summary:
        "Closed curve - increasing and decreasing behaviour does not apply as a single function.",
      intervals: [],
      turnings: [],
      inflections: [],
      trend: "none",
      concavity: "none",
    };
  }

  if (kind === "arc") {
    return {
      applicable: false,
      kind,
      reason: "an arc turns through a range of directions",
      summary:
        "Circular arc - its increasing and decreasing behaviour changes along the arc and is not a single function of x.",
      intervals: [],
      turnings: [],
      inflections: [],
      trend: "none",
      concavity: "none",
    };
  }

  const points =
    kind === "curve"
      ? curveSamplePoints(element)
      : (element?.points || []).map((point) => ({
          x: finite(point?.x),
          y: finite(point?.y),
        }));

  if (points.length < 3) {
    return {
      applicable: false,
      kind,
      reason: "too few points",
      summary: "A straight segment has no turning or inflection points.",
      intervals: [],
      turnings: [],
      inflections: [],
      trend: "none",
      concavity: kind === "line" ? "flat" : "none",
    };
  }

  const analysis = analyseTrend(points);

  return {
    ...analysis,
    kind,
    summary: analysis.applicable
      ? analysis.summary
      : analysis.monotonicity?.vertical
        ? "Vertical curve - not a function of x, so increasing/decreasing does not apply."
        : analysis.summary,
  };
}

/* Points along a curve element, from its own Bezier segments when it has them. */
export function curveSamplePoints(element, count = 64) {
  const segments = element?.segments || [];

  if (segments.length) {
    const points = [{ ...segments[0].from }];

    segments.forEach((segment) => {
      const steps = Math.max(2, Math.round(count / segments.length));

      for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const u = 1 - t;

        points.push({
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

    return points;
  }

  return (element?.points || []).map((point) => ({
    x: finite(point?.x),
    y: finite(point?.y),
  }));
}

/* ============================================================
 * CURVE FITTING - CLEAN MATHEMATICAL GEOMETRY FROM A STROKE
 * ============================================================
 *
 * The fitting half of the correction engine: given a hand-drawn run of
 * samples, produce the SIMPLEST mathematical object that explains it.
 *
 * WHY NOT A POLYNOMIAL THROUGH EVERY SAMPLE
 * -----------------------------------------
 * One high-degree polynomial fitted to a whole stroke oscillates between the
 * samples, overshoots at the ends and behaves badly wherever the stroke is
 * sparse. That is a property of polynomial interpolation, not a defect of a
 * particular fitter: a curve that passes exactly through 200 wobbly points is
 * guaranteed to be wild between them.
 *
 * So a general curve is built as a CHAIN OF CUBIC BEZIERS, each fitted to a
 * span of the stroke by ordinary least squares with the joins made
 * continuous. A chain of cubics is a piecewise polynomial - the
 * representation the brief asks for - and it is the one representation that
 * can be smooth, tight to the stroke, and free of the oscillation a global
 * polynomial produces.
 *
 * LEAST SQUARES WITH FIXED END POINTS
 * -----------------------------------
 * A Bernstein-basis least-squares fit of a cubic to its span, with the two end
 * points FIXED at the stroke's own points. Fixing the ends is what makes the
 * chain continuous; solving for the two control points is what makes each span
 * follow the stroke. The result passes exactly through every join and stays
 * as close as the data allows to everything between.
 */

/* The Bernstein basis values of one cubic at parameter t. */
function bernstein(t) {
  const u = 1 - t;

  return [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
}

/*
 * ONE LEAST-SQUARES CUBIC THROUGH A SPAN.
 *
 * `from` and `to` are held fixed; the two control points are solved. Each
 * sample contributes its own chord-length parameter, so the fit follows the
 * SHAPE of the span rather than the density of the samples.
 */
export function fitCubicSpan(samples, from, to) {
  const list = Array.isArray(samples) ? samples : [];

  const third = (value, other) => value + (other - value) / 3;

  const straight = {
    from: { x: from.x, y: from.y },
    control1: { x: third(from.x, to.x), y: third(from.y, to.y) },
    control2: { x: third(to.x, from.x), y: third(to.y, from.y) },
    to: { x: to.x, y: to.y },
  };

  if (list.length < 3) {
    /* Too little evidence for a curve: a straight cubic control is honest. */
    return straight;
  }

  /* Parameters from accumulated chord length - the standard choice. */
  const lengths = [0];

  for (let index = 1; index < list.length; index += 1) {
    lengths.push(
      lengths[index - 1] +
        Math.hypot(list[index].x - list[index - 1].x, list[index].y - list[index - 1].y),
    );
  }

  const total = lengths[lengths.length - 1] || 1;

  /*
   * THE NORMAL EQUATIONS FOR THE TWO CONTROL POINTS.
   *
   * Each sample gives
   *     P(t) = B0 P0 + B1 C1 + B2 C2 + B3 P3
   * so the unknowns C1 and C2 solve a 2x2 system per coordinate against the
   * residual after the fixed ends are subtracted.
   */
  const m = [
    [0, 0],
    [0, 0],
  ];

  const v = [
    [0, 0],
    [0, 0],
  ];

  list.forEach((sample, index) => {
    const [b0, b1, b2, b3] = bernstein(lengths[index] / total);

    const rhs = [
      sample.x - (b0 * from.x + b3 * to.x),
      sample.y - (b0 * from.y + b3 * to.y),
    ];

    [b1, b2].forEach((weight, row) => {
      for (let axis = 0; axis < 2; axis += 1) {
        v[row][axis] += weight * rhs[axis];
      }

      [b1, b2].forEach((other, column) => {
        m[row][column] += weight * other;
      });
    });
  });

  const determinant = m[0][0] * m[1][1] - m[0][1] * m[1][0];

  if (Math.abs(determinant) < 1e-12) {
    return straight;
  }

  const control1 = {
    x: (v[0][0] * m[1][1] - v[1][0] * m[0][1]) / determinant,
    y: (v[0][1] * m[1][1] - v[1][1] * m[0][1]) / determinant,
  };

  const control2 = {
    x: (m[0][0] * v[1][0] - m[1][0] * v[0][0]) / determinant,
    y: (m[0][0] * v[1][1] - m[1][0] * v[0][1]) / determinant,
  };

  return { from: { x: from.x, y: from.y }, control1, control2, to: { x: to.x, y: to.y } };
}

/*
 * A CHAIN OF CUBICS THROUGH THE STROKE'S OWN KEY POINTS.
 *
 * `vertices` are the points the chain must pass through - the stroke's ends,
 * its corners, and any anchor the student pinned. Each consecutive pair is one
 * span, fitted to the samples between them. That is what makes a curve through
 * an anchor pass through it EXACTLY while still being fitted to the ink either
 * side.
 */
export function fitCubicChain(samples, vertices) {
  const list = (Array.isArray(samples) ? samples : []).filter(
    (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  const keys = (Array.isArray(vertices) ? vertices : []).filter(
    (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  if (keys.length < 2) {
    return [];
  }

  const segments = [];

  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index];
    const to = keys[index + 1];

    /*
     * THE SAMPLES BETWEEN THE TWO KEYS, BY POSITION ALONG THE STROKE.
     *
     * The key points are where the chain must pass; the samples in between are
     * the evidence of how it should get there. A key that lies exactly on a
     * sample uses that sample as its boundary, so the span is the stroke's own
     * piece rather than an interpolation across it.
     */
    const fromIndex = nearestSampleIndex(list, from);
    const toIndex = nearestSampleIndex(list, to);

    const low = Math.min(fromIndex, toIndex);
    const high = Math.max(fromIndex, toIndex);

    const span = list.slice(low, high + 1);

    const middle = span.length >= 3 ? span : [from, ...span, to];

    segments.push(fitCubicSpan(middle, from, to));
  }

  return segments;
}

function nearestSampleIndex(samples, point) {
  let best = 0;
  let distance = Infinity;

  samples.forEach((sample, index) => {
    const away = Math.hypot(sample.x - point.x, sample.y - point.y);

    if (away < distance) {
      distance = away;
      best = index;
    }
  });

  return best;
}

/* ============================================================
 * EXTREMA OF A BEZIER CHAIN - FOR AUTOMATIC BOUNDS
 * ============================================================ */

/*
 * THE TIGHT BOUNDS OF A CUBIC.
 *
 * A curve's extent is not the extent of its control points: the curve lies
 * inside their convex hull, and a bound taken from the handles would show a
 * margin nobody drew. The exact extremes are where the derivative is zero -
 * a quadratic in t for each coordinate - so they are solved rather than
 * sampled, and the curve's true extremes are included in the bounds.
 */
function cubicExtremes(p0, p1, p2, p3) {
  /* B'(t) = 3[(1-t)^2 (p1-p0) + 2(1-t)t (p2-p1) + t^2 (p3-p2)] is quadratic. */
  const a = p3 - 3 * p2 + 3 * p1 - p0;
  const b = 2 * (p2 - 2 * p1 + p0);
  const c = p1 - p0;

  const roots = [];

  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      roots.push(-c / b);
    }
  } else {
    const discriminant = b * b - 4 * a * c;

    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);

      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }

  return roots.filter((t) => t > 0 && t < 1);
}

/* Every point of a cubic that could be an extreme in x or in y. */
export function cubicBounds(segment) {
  const { from, control1, control2, to } = segment;

  const points = [from, to];

  const at = (t) => {
    const u = 1 - t;

    return {
      x:
        u * u * u * from.x +
        3 * u * u * t * control1.x +
        3 * u * t * t * control2.x +
        t * t * t * to.x,
      y:
        u * u * u * from.y +
        3 * u * u * t * control1.y +
        3 * u * t * t * control2.y +
        t * t * t * to.y,
    };
  };

  cubicExtremes(from.x, control1.x, control2.x, to.x).forEach((t) => points.push(at(t)));
  cubicExtremes(from.y, control1.y, control2.y, to.y).forEach((t) => points.push(at(t)));

  return points;
}

/*
 * THE GEOMETRIC EXTENT OF AN ELEMENT, IN ITS OWN COORDINATES.
 *
 * Circles and ellipses use their mathematical extremes (not their sampled
 * points, which may miss the top of a circle by a fraction); arcs use their
 * end points and any axis extreme the sweep actually passes; curves use the
 * exact extremes of their cubics. This is the single answer every bounds
 * calculation reads, so a view cannot be fitted to a shape's samples while
 * the shape extends past them.
 */
export function elementExtent(element) {
  const kind = String(element?.kind || element?.type || "curve");

  if (kind === "circle" && element.centre && Number.isFinite(Number(element.radius))) {
    const { x, y } = element.centre;
    const r = Math.abs(Number(element.radius));

    return [
      { x: x - r, y },
      { x: x + r, y },
      { x, y: y - r },
      { x, y: y + r },
    ];
  }

  if (kind === "ellipse" && element.centre) {
    const { x, y } = element.centre;
    const rx = Math.abs(Number(element.radiusX) || 0);
    const ry = Math.abs(Number(element.radiusY) || 0);

    /* An axis-aligned ellipse; its extremes are the four axis points. */
    return [
      { x: x - rx, y },
      { x: x + rx, y },
      { x, y: y - ry },
      { x, y: y + ry },
    ];
  }

  if (kind === "arc" && element.centre) {
    const cx = Number(element.centre.x);
    const cy = Number(element.centre.y);
    const r = Math.abs(Number(element.radius) || 0);

    const start = Number(element.startAngle) || 0;
    let end = Number(element.endAngle);

    const clockwise = Boolean(element.clockwise);

    if (!Number.isFinite(end)) {
      end = start;
    }

    if (clockwise) {
      while (end > start) end -= Math.PI * 2;
    } else {
      while (end < start) end += Math.PI * 2;
    }

    const low = Math.min(start, end);
    const high = Math.max(start, end);

    const points = [
      { x: cx + r * Math.cos(start), y: cy + r * Math.sin(start) },
      { x: cx + r * Math.cos(end), y: cy + r * Math.sin(end) },
    ];

    /* The four axis directions, included only where the arc sweeps through. */
    [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((angle) => {
      let probe = angle;

      while (probe < low) probe += Math.PI * 2;
      while (probe > high) probe -= Math.PI * 2;

      if (probe >= low && probe <= high) {
        points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
    });

    return points;
  }

  if (kind === "rectangle" && element.corner) {
    const { x, y } = element.corner;
    const w = Number(element.width) || 0;
    const h = Number(element.height) || 0;

    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }

  const points = [];

  (element?.segments || []).forEach((segment) => {
    if (segment?.from && segment?.control1 && segment?.control2 && segment?.to) {
      cubicBounds(segment).forEach((point) => points.push(point));
    }
  });

  (element?.points || []).forEach((point) =>
    points.push({ x: Number(point.x), y: Number(point.y) }),
  );

  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export { elementExtent as extentOfElement };

/* shape helpers used by the inspector and by placement bounds */

export default {
  fitPolynomialY,
  xMonotonicity,
  pathTangents,
  analyseTrend,
  analyseElementTrend,
  curveSamplePoints,
  fitCubicSpan,
  fitCubicChain,
  cubicBounds,
  elementExtent,
  TREND_LABELS,
  CONCAVITY_LABELS,
};
