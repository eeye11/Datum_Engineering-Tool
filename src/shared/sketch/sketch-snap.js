/*
 * ============================================================
 * THE SNAP CANDIDATES - WHERE A CLICK IS ALLOWED TO LAND
 * ============================================================
 *
 * Add Point offers places a student MEANT, not a pixel they hit:
 *
 *     grid intersection        a corner of a cell
 *     horizontal midpoint      halfway across a cell, on a line
 *     vertical midpoint        on a line, halfway up
 *     grid-cell centre         halfway across and halfway up
 *     an existing anchor       exact, because the student placed it
 *     existing geometry        projected onto the real mathematics
 *
 * Everything is computed in MODEL coordinates from the MATHEMATICAL grid
 * interval, so zoom changes how far a candidate LOOKS from the cursor and
 * never where it is. The comparison is made in PIXELS, through the viewport,
 * so the tolerance means the same thing to the hand at any zoom.
 *
 * INDEPENDENT SWITCHES
 * --------------------
 *   snapToGrid             intersections on/off
 *   snapToGridMidpoints    all three midpoint kinds on/off
 *   snapToPoints           existing anchors on/off
 *   snapToGeometry         existing geometry on/off
 *
 * They are independent of the VISIBILITY of the grid: the grid may be hidden
 * and the click may still land on a round number, which is the whole point of
 * snapping by numbers rather than by what is drawn.
 *
 * TIE-BREAKING
 * ------------
 * Nearest wins. When two candidates are equally close - a click exactly on the
 * line between a corner and a midpoint can be equidistant from both - the
 * GRID INTERSECTION wins, then an anchor, then geometry, then a midpoint. The
 * order is how definite the place is: a corner is a corner, a midpoint is the
 * least specific of the three lattice places.
 */

export const SNAP_KINDS = Object.freeze({
  anchor: "anchor",
  geometry: "geometry",
  grid: "grid",
  midpoint: "midpoint",
  centre: "centre",
});

/* How definite each kind of place is; lower wins a tie. */
const RANK = Object.freeze({
  anchor: 0,
  centre: 1,
  geometry: 2,
  grid: 3,
  midpoint: 4,
});

function finite(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/* A pixel distance, from two model points and the viewport's scale. */
function pixelDistance(a, b, viewport) {
  const scaleX = viewport?.scaleX || viewport?.scale || 1;
  const scaleY = viewport?.scaleY || viewport?.scale || 1;

  return Math.hypot(
    (finite(a.x) - finite(b.x)) * scaleX,
    (finite(a.y) - finite(b.y)) * scaleY,
  );
}

/*
 * EVERY CANDIDATE, IN MODEL COORDINATES.
 *
 * `grid` is the model-space interval in force; it is passed in rather than
 * derived here so the DRAWING and the SNAPPING cannot use two different grids.
 */
export function snapCandidates(
  model,
  {
    grid = {},
    interval = null,
    points = [],
    geometryHit = null,
    viewport = null,
    pointTolerancePx = 10,
  } = {},
) {
  const candidates = [];

  /*
   * EXISTING POINTS BEAT EVERYTHING. A place the student already decided is
   * more definite than any lattice place, and a click near it must land on it
   * rather than beside it.
   */
  if (grid.snapToPoints !== false) {
    (Array.isArray(points) ? points : []).forEach((point) => {
      const at = point?.absolute || point;

      if (
        !at ||
        !Number.isFinite(Number(at.x)) ||
        !Number.isFinite(Number(at.y))
      ) {
        return;
      }

      const away = pixelDistance(model, at, viewport);

      if (away <= pointTolerancePx) {
        candidates.push({
          kind: point.role === "centre" ? "centre" : "anchor",
          x: Number(at.x),
          y: Number(at.y),
          awayPx: away,
          pointId: point.id || null,
        });
      }
    });
  }

  /*
   * EXISTING GEOMETRY, PROJECTED ONTO ITS REAL MATHEMATICS - not onto the
   * nearest sample. The adapter has already answered; this only ranks it.
   */
  if (grid.snapToGeometry !== false && geometryHit) {
    const at = { x: finite(geometryHit.x), y: finite(geometryHit.y) };

    candidates.push({
      kind: "geometry",
      x: at.x,
      y: at.y,
      awayPx: pixelDistance(model, at, viewport),
      geometryId: geometryHit.id || geometryHit.element?.id || null,
      parameter: Number.isFinite(geometryHit.t) ? geometryHit.t : null,
    });
  }

  const majorX = finite(interval?.x, finite(grid.majorX, 1));
  const majorY = finite(interval?.y, finite(grid.majorY, 1));

  if (!(majorX > 0) || !(majorY > 0)) {
    return candidates;
  }

  /* ---- grid intersections ---- */
  if (grid.snapToGrid !== false) {
    const x = Math.round(model.x / majorX) * majorX;
    const y = Math.round(model.y / majorY) * majorY;

    candidates.push({
      kind: "grid",
      x: clean(x),
      y: clean(y),
      awayPx: pixelDistance(model, { x, y }, viewport),
    });
  }

  /* ---- midpoints and cell centres ---- */
  if (grid.snapToGridMidpoints !== false) {
    const halfX = majorX / 2;
    const halfY = majorY / 2;

    /* Horizontal midpoint: x halfway between lines, y on a line. */
    const horizontal = {
      x: Math.round((model.x - halfX) / majorX) * majorX + halfX,
      y: Math.round(model.y / majorY) * majorY,
    };

    /* Vertical midpoint: x on a line, y halfway between. */
    const vertical = {
      x: Math.round(model.x / majorX) * majorX,
      y: Math.round((model.y - halfY) / majorY) * majorY + halfY,
    };

    /* Cell centre: halfway in both directions. */
    const centre = {
      x: Math.round((model.x - halfX) / majorX) * majorX + halfX,
      y: Math.round((model.y - halfY) / majorY) * majorY + halfY,
    };

    [horizontal, vertical, centre].forEach((candidate) => {
      candidates.push({
        kind: "midpoint",
        x: clean(candidate.x),
        y: clean(candidate.y),
        awayPx: pixelDistance(model, candidate, viewport),
      });
    });
  }

  return candidates;
}

/* Remove floating-point dust so a stored coordinate is the round number. */
function clean(value) {
  const rounded = Number(Number(value).toFixed(10));

  return Object.is(rounded, -0) ? 0 : rounded;
}

/*
 * THE SNAP DECISION.
 *
 * Returns the chosen candidate's EXACT coordinates - the values that get
 * STORED - or the cursor's own position when nothing is in reach. `snapped`
 * distinguishes the two, so a caller never has to compare coordinates to know
 * whether a snap happened.
 */
export function chooseSnap(model, options = {}) {
  const tolerancePx = finite(
    options.tolerancePx ?? options.grid?.snapTolerancePx,
    22,
  );

  const candidates = snapCandidates(model, options).filter(
    (candidate) =>
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y) &&
      candidate.awayPx <= tolerancePx,
  );

  if (!candidates.length) {
    return {
      x: model.x,
      y: model.y,
      snapped: false,
      kind: null,
      awayPx: Infinity,
    };
  }

  candidates.sort((a, b) => {
    /*
     * A TIE IS A TENTH OF A PIXEL, NOT A FLOATING-POINT COINCIDENCE. Below
     * that, rank decides: a grid intersection beats a midpoint, because a
     * corner is the more definite place to have meant.
     */
    if (Math.abs(a.awayPx - b.awayPx) > 0.1) {
      return a.awayPx - b.awayPx;
    }

    return (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9);
  });

  const best = candidates[0];

  return {
    x: best.x,
    y: best.y,
    snapped: true,
    kind: best.kind,
    awayPx: best.awayPx,
    pointId: best.pointId || null,
    geometryId: best.geometryId || null,
    parameter: best.parameter ?? null,
  };
}

export default {
  SNAP_KINDS,
  snapCandidates,
  chooseSnap,
};
