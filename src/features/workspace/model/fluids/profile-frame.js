/*
 * ========================================================
 * THE PROFILE FRAME: ONE GRAPH MODEL, TWO GRAPHS
 * ========================================================
 *
 * Pressure Profile and Flow Profile are the SAME KIND OF OBJECT drawn from the
 * same maths:
 *
 *   a FRAME          geometry.position / width / height, in drawing units
 *   a PLOT AREA      the frame less the room the axes' text needs
 *   TWO AXES         a title, a unit and a range each
 *   STUDENT ROWS     a list of { position, value } pairs, and nothing else
 *
 * What differs between them is WHAT the rows mean and how a value is validated
 * - a pressure and a flow rate are not the same quantity - and that is why the
 * quantity rules live in each profile's own module while the geometry lives
 * here.
 *
 * ========================================================
 * ONE MAPPING, AND ITS INVERSE
 * ========================================================
 *
 * `dataToDrawing` and `drawingToData` are the only conversion between an
 * engineering row and a point on the sheet. A drag writes the row through the
 * inverse, and the renderer plots the row through the mapping, so the table,
 * the plotted point and the source cannot disagree about a number.
 *
 * NOTHING HERE IS A SOLVER. A row is interpolated only for DRAWING - a straight
 * segment from one supplied point to the next - and an empty table draws an
 * empty plot area with its axes, never an invented line.
 */

import {
  DEFAULT_PROFILE_HEIGHT,
  DEFAULT_PROFILE_WIDTH,
  finitePoint,
  finiteNumber
} from "./fluids-shared.js";

/* The share of the frame the plot area occupies, leaving room for the text. */
export const PLOT_INSET = Object.freeze({ left: 0.14, right: 0.05, top: 0.08, bottom: 0.14 });

export const MIN_PROFILE_SIDE = 6;
export const MAX_PROFILE_POINTS = 200;

/* The cross-field key a row's value is stored under, for either profile. */
export const VALUE_KEY = "value";

void finiteNumber;

/* ============================================================
 * THE FRAME AND ITS PLOT AREA
 * ============================================================ */

export function profileFrame(profile) {
  const position = profile?.geometry?.position;

  if (!finitePoint(position)) {
    return null;
  }

  const width = Math.abs(Number(profile.geometry.width));
  const height = Math.abs(Number(profile.geometry.height));

  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  return { position: { x: position.x, y: position.y }, width, height };
}

/* The plot area's four corners inside the frame. */
export function plotArea(profile) {
  return plotAreaOfFrame(profileFrame(profile));
}

export function plotAreaOfFrame(frame) {
  if (!frame) {
    return null;
  }

  const left = frame.position.x + frame.width * PLOT_INSET.left;
  const right = frame.position.x + frame.width * (1 - PLOT_INSET.right);
  const bottom = frame.position.y + frame.height * PLOT_INSET.bottom;
  const top = frame.position.y + frame.height * (1 - PLOT_INSET.top);

  return {
    left,
    right,
    bottom,
    top,
    width: right - left,
    height: top - bottom,
    origin: { x: left, y: bottom },
    xEnd: { x: right, y: bottom },
    yEnd: { x: left, y: top }
  };
}

/* ============================================================
 * THE FOUR LIMITS
 * ============================================================
 *
 * `axes` is whatever the profile module calls a range - four numbers with text
 * beside them - normalised here so a degenerate (min >= max) edit can never
 * reach the mapping and divide by zero.
 */
export function normalisedLimits(axes, fallback = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 }) {
  const value = (candidate, back) => (Number.isFinite(Number(candidate)) ? Number(candidate) : back);
  const span = (low, high, backLow, backHigh) =>
    high > low ? { low, high } : { low: backLow, high: backHigh };

  const x = span(
    value(axes?.xMin, fallback.xMin),
    value(axes?.xMax, fallback.xMax),
    fallback.xMin,
    fallback.xMax
  );

  const y = span(
    value(axes?.yMin, fallback.yMin),
    value(axes?.yMax, fallback.yMax),
    fallback.yMin,
    fallback.yMax
  );

  return { xMin: x.low, xMax: x.high, yMin: y.low, yMax: y.high };
}

/* ============================================================
 * DATA <-> DRAWING
 * ============================================================ */

export function dataToDrawingPoint(profile, limits, value) {
  const area = plotArea(profile);

  if (!area || !limits) {
    return null;
  }

  const fx = (Number(value.position) - limits.xMin) / (limits.xMax - limits.xMin);
  const fy = (Number(value.value) - limits.yMin) / (limits.yMax - limits.yMin);

  return {
    x: area.left + fx * area.width,
    y: area.bottom + fy * area.height
  };
}

export function drawingToDataPoint(profile, limits, point) {
  const area = plotArea(profile);

  if (!area || !limits || !finitePoint(point)) {
    return null;
  }

  return {
    position: limits.xMin + ((point.x - area.left) / area.width) * (limits.xMax - limits.xMin),
    value: limits.yMin + ((point.y - area.bottom) / area.height) * (limits.yMax - limits.yMin)
  };
}

/* The tick values of one axis: five even stops, including both limits. */
export function ticksFor(low, high, count = 4) {
  const span = high - low;

  return Array.from({ length: count + 1 }, (_, index) => low + (span * index) / count);
}

/* ============================================================
 * CREATION AND RESIZE
 * ============================================================ */

/*
 * A NEW FRAME, refused when it would not enclose a plot area.
 *
 * The profile module passes its own type in, so the frame code owns the
 * geometry and the profile owns the identity.
 */
export function profileFrameFromDrag(from, to) {
  if (!finitePoint(from) || !finitePoint(to)) {
    return null;
  }

  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);

  if (width < MIN_PROFILE_SIDE || height < MIN_PROFILE_SIDE) {
    return null;
  }

  return {
    position: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
    width,
    height
  };
}

export function defaultProfileFrame(position) {
  if (!finitePoint(position)) {
    return null;
  }

  return {
    position: { x: position.x, y: position.y },
    width: DEFAULT_PROFILE_WIDTH,
    height: DEFAULT_PROFILE_HEIGHT
  };
}

export function resizeProfileFrame(profile, width, height) {
  const w = Number(width);
  const h = Number(height);

  if (!profile || !(w >= MIN_PROFILE_SIDE) || !(h >= MIN_PROFILE_SIDE)) {
    return false;
  }

  profile.geometry = { ...profile.geometry, width: w, height: h };

  return true;
}

/* ============================================================
 * THE ROWS
 * ============================================================ */

/*
 * The student's rows, read from under `key`, as finite pairs only.
 *
 * `key` is the field the value is stored under - `pressure` for a pressure
 * profile, `value` for a flow profile - so the same reader serves both.
 */
export function readRows(profile, key, listKey = "points") {
  const rows = Array.isArray(profile?.engineering?.[listKey]) ? profile.engineering[listKey] : [];

  return rows
    .map((row) => ({
      position: Number(row?.position),
      value: Number(row?.[key])
    }))
    .filter((row) => Number.isFinite(row.position) && Number.isFinite(row.value));
}

export function writeRows(profile, key, rows, listKey = "points") {
  profile.engineering = {
    ...(profile.engineering || {}),
    [listKey]: rows.map((row) => ({ position: Number(row.position), [key]: Number(row.value) }))
  };

  return true;
}

/* Round a value for display only - the stored number is never rewritten. */
export function roundedForDisplay(value, places = 3) {
  const number = Number(value);

  return Number.isFinite(number) ? Number(number.toFixed(places)) : 0;
}

/*
 * A NEW ROW: the next even station, and the middle of the plot's own range.
 *
 * A row the student adds is a REAL row they then edit - it is never a value
 * guessed from its neighbours, and it is never "nothing": an empty table draws
 * no line, so adding one is what makes a graph exist.
 */
export function nextRowFor(existing, limits) {
  const last = existing.length ? existing[existing.length - 1] : null;

  return {
    position: last
      ? Math.min(limits.xMax, Number(last.position) + (limits.xMax - limits.xMin) / 4)
      : limits.xMin,
    value: (limits.yMin + limits.yMax) / 2
  };
}

/*
 * SET LIMITS TO FIT SUPPLIED DATA - a convenience, never an automatic scale.
 *
 * It returns the four numbers so the caller writes them into ITS OWN axes
 * fields, which is what keeps a student able to see and edit what it did. An
 * empty table changes nothing.
 */
export function fittedLimits(rows) {
  if (!rows.length) {
    return null;
  }

  const pad = (values) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || Math.abs(high) || 1;

    return { low: low - span * 0.05, high: high + span * 0.05 };
  };

  const x = pad(rows.map((row) => row.position));
  const y = pad(rows.map((row) => row.value));

  return { xMin: x.low, xMax: x.high, yMin: y.low, yMax: y.high };
}

const enggProfileFrame = {
  PLOT_INSET,
  MIN_PROFILE_SIDE,
  MAX_PROFILE_POINTS,
  VALUE_KEY,
  profileFrame,
  plotArea,
  plotAreaOfFrame,
  normalisedLimits,
  dataToDrawingPoint,
  drawingToDataPoint,
  ticksFor,
  profileFrameFromDrag,
  defaultProfileFrame,
  resizeProfileFrame,
  readRows,
  writeRows,
  roundedForDisplay,
  nextRowFor,
  fittedLimits
};

export default enggProfileFrame;
