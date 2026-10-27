/*
 * ========================================================
 * FLOW PROFILE
 * ========================================================
 *
 * An editable engineering profile diagram of STUDENT-SUPPLIED flow values at
 * stations along a route:
 *
 *   engineering.points     [{ position, value }] - the student's OWN rows
 *   engineering.quantity   which flow quantity the values are
 *   engineering.customLabel  its name, when the quantity is "custom"
 *   engineering.axes       the two titles, the two units and the four limits
 *   engineering.grid       whether the grid is drawn
 *   engineering.pointsShown  whether the data markers are drawn
 *   engineering.lineStyle  whether the supplied points are joined with a line
 *   engineering.graphName  the graph's own title
 *   geometry.position / width / height   the frame, in drawing units
 *
 * ========================================================
 * THE SAME FRAMEWORK AS THE PRESSURE PROFILE
 * ========================================================
 *
 * The frame, the plot area, the two axes, the ticks, the data-to-drawing
 * mapping and the rows all live in `profile-frame.js`, and BOTH profiles read
 * them. This module adds the part that is specific to flow: WHICH QUANTITY is
 * being plotted, WHICH UNITS that quantity may be stated in, and how a typed
 * entry is validated against them.
 *
 * A pressure and a flow rate are different quantities, so the two profiles do
 * not share a value model - they share a FRAME.
 *
 * ========================================================
 * NOT A SOLVER, AND NOT A VELOCITY FIELD
 * ========================================================
 *
 * This is NOT a flow arrow, NOT a pipe cross-section and NOT an automatically
 * generated velocity distribution. Every plotted value is one the student typed
 * or dragged; the line through the rows is a drawing style, not an
 * interpolation of physics; and nothing here computes a head loss, a Reynolds
 * number or a derived flow.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import {
  DEFAULT_PROFILE_HEIGHT,
  DEFAULT_PROFILE_WIDTH,
  finitePoint,
} from "./fluids-shared.js";
import enggProfileFrame from "./profile-frame.js";
import enggQuantities from "../../../../shared/units/quantities.js";

export const FLOW_PROFILE_TYPE = "flow-profile";

export const MIN_PROFILE_SIDE = enggProfileFrame.MIN_PROFILE_SIDE;
export const MAX_PROFILE_POINTS = enggProfileFrame.MAX_PROFILE_POINTS;

/* The field a row's flow value is stored under. */
export const VALUE_KEY = "value";

/*
 * ============================================================
 * THE QUANTITIES A FLOW PROFILE MAY PLOT
 * ============================================================
 *
 * `unitQuantity` is the entry in the SHARED unit table the values are read and
 * written in - so a flow profile's units are the application's units, not a
 * list of its own. A custom quantity is dimensionless as far as DAETUM is
 * concerned: it accepts a bare number and no unit suffix.
 */
export const FLOW_QUANTITIES = Object.freeze([
  {
    id: "volumetric-flow-rate",
    label: "Volumetric Flow Rate",
    symbol: "Q",
    unitQuantity: "flowRate",
    defaultUnit: "m³/s",
  },
  {
    id: "mass-flow-rate",
    label: "Mass Flow Rate",
    symbol: "ṁ",
    unitQuantity: "massFlowRate",
    defaultUnit: "kg/s",
  },
  {
    id: "average-velocity",
    label: "Average Velocity",
    symbol: "v",
    unitQuantity: "speed",
    defaultUnit: "m/s",
  },
  {
    id: "custom",
    label: "Custom",
    symbol: "",
    unitQuantity: "custom",
    defaultUnit: "",
  },
]);

export const DEFAULT_FLOW_QUANTITY = "volumetric-flow-rate";

/*
 * What the horizontal axis may measure. Both are validations of the SAME
 * independent coordinate; the station rows stay in drawing/engineering units,
 * so only the axis TITLE changes with the choice.
 */
export const STATION_KINDS = Object.freeze([
  {
    id: "distance",
    label: "Distance Along Route",
    unitQuantity: "length",
    defaultUnit: "m",
  },
  { id: "station", label: "Station", unitQuantity: "length", defaultUnit: "m" },
]);

export const DEFAULT_STATION_KIND = "distance";

export const DEFAULT_AXES = Object.freeze({
  xTitle: "Distance",
  xUnit: "m",
  yTitle: "Flow Rate",
  yUnit: "m³/s",
  xMin: 0,
  xMax: 100,
  yMin: 0,
  yMax: 100,
});

export const PLOT_INSET = enggProfileFrame.PLOT_INSET;

/* The line style of the supplied points - a drawing choice, not physics. */
export const LINE_STYLES = Object.freeze([
  { id: "straight", label: "Straight" },
  { id: "steps", label: "Stepped" },
  { id: "none", label: "Points only" },
]);

export function isFlowProfileType(type) {
  return type === FLOW_PROFILE_TYPE;
}

/* ============================================================
 * THE QUANTITY, AND ITS UNITS
 * ============================================================ */

export function quantityDefinition(id) {
  return FLOW_QUANTITIES.find((entry) => entry.id === id) || FLOW_QUANTITIES[0];
}

export function quantityIdOf(profile) {
  const id = String(profile?.engineering?.quantity ?? DEFAULT_FLOW_QUANTITY);

  return FLOW_QUANTITIES.some((entry) => entry.id === id)
    ? id
    : DEFAULT_FLOW_QUANTITY;
}

export function quantityOf(profile) {
  return quantityDefinition(quantityIdOf(profile));
}

/* The shared unit table's entry the values are stated in. */
export function unitQuantityOf(profile) {
  return quantityOf(profile).unitQuantity;
}

/* The units this profile's quantity may be stated in, in the table's order. */
export function unitsOf(profile) {
  return enggQuantities.unitsFor(unitQuantityOf(profile));
}

/*
 * THE QUANTITY'S NAME, as it reads on the axis and in the table heading.
 *
 * A preset quantity is named by the table; a CUSTOM quantity is named by the
 * student, and falls back to "Quantity" rather than inventing a name.
 */
export function quantityLabelOf(profile) {
  const quantity = quantityOf(profile);

  if (quantity.id !== "custom") {
    return quantity.label;
  }

  const custom = String(profile?.engineering?.customLabel ?? "").trim();

  return custom || "Quantity";
}

export function stationKindOf(profile) {
  const id = String(profile?.engineering?.stationKind ?? DEFAULT_STATION_KIND);

  return STATION_KINDS.some((entry) => entry.id === id)
    ? id
    : DEFAULT_STATION_KIND;
}

/*
 * CHANGE THE QUANTITY, CONVERTING THE STUDENT'S NUMBERS WITH IT.
 *
 * A value is a physical flow in the unit the OLD quantity allowed, and the new
 * quantity has a different dimension - so the rows cannot simply be relabelled.
 * What is preserved is the DISPLAYED NUMBER and the axis unit: the table the
 * student typed is still the table they see, and the axis says which quantity
 * it now states. Nothing is scaled twice, and nothing is silently converted
 * into a quantity it is not.
 */
export function setQuantity(profile, id) {
  if (!FLOW_QUANTITIES.some((entry) => entry.id === id)) {
    return false;
  }

  const definition = quantityDefinition(id);
  const axes = axesOf(profile);

  profile.engineering = {
    ...(profile.engineering || {}),
    quantity: id,
    axes: {
      ...axes,
      yTitle:
        definition.id === "custom"
          ? quantityLabelOf({
              engineering: { ...profile.engineering, quantity: id },
            })
          : definition.label,
      yUnit: enggQuantities.isUnitFor(definition.unitQuantity, axes.yUnit)
        ? axes.yUnit
        : definition.defaultUnit,
    },
  };

  return true;
}

export function setCustomLabel(profile, label) {
  profile.engineering = {
    ...(profile.engineering || {}),
    customLabel: String(label ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim(),
  };

  return true;
}

/*
 * CHANGE THE UNIT, KEEPING THE PHYSICAL VALUE.
 *
 * The rows are stored in the ENGINEERING VALUE the student typed, expressed in
 * the axis's own unit - so changing that unit converts every row ONCE, through
 * the shared conversion, and the plotted graph does not move. That is the
 * guarantee the requirement asks for: the number in the table changes, the
 * physical flow does not.
 *
 * A unit that does not belong to this quantity is REFUSED, not relabelled.
 */
export function setValueUnit(profile, unit) {
  const quantityType = unitQuantityOf(profile);

  if (!enggQuantities.isUnitFor(quantityType, unit)) {
    return false;
  }

  const axes = axesOf(profile);
  const previous = axes.yUnit;

  if (unit === previous) {
    return true;
  }

  const rows = readRows(profile).map((row) => ({
    position: row.position,
    value: enggQuantities.convertValue(row.value, quantityType, previous, unit),
  }));

  profile.engineering = {
    ...(profile.engineering || {}),
    points: rows,
    axes: { ...axes, yUnit: unit },
  };

  return true;
}

/*
 * CHANGE THE STATION AXIS'S UNIT, converting the stations once for the same
 * reason - a station is a distance, and reading 30 m as 30 mm would be a
 * thousand-fold error in the direction the student did not choose.
 */
export function setStationUnit(profile, unit) {
  const axes = axesOf(profile);

  if (!enggQuantities.isUnitFor("length", unit)) {
    return false;
  }

  if (unit === axes.xUnit) {
    return true;
  }

  const convert = (value) =>
    enggQuantities.convertValue(value, "length", axes.xUnit, unit);

  const rows = readRows(profile).map((row) => ({
    position: convert(row.position),
    value: row.value,
  }));

  const limits = {
    xMin: convert(axes.xMin),
    xMax: convert(axes.xMax),
    yMin: axes.yMin,
    yMax: axes.yMax,
  };

  profile.engineering = {
    ...(profile.engineering || {}),
    points: rows,
    axes: { ...axes, xUnit: unit, ...limits },
  };

  return true;
}

/* ============================================================
 * READING A TYPED ENTRY
 * ============================================================
 *
 * The table's cells take a NUMBER, optionally carrying a unit of the profile's
 * own quantity ("2.5 L/s"). The selection of units comes from the shared table,
 * so "5 mm" is refused as a flow rate rather than half-read.
 *
 * A refused entry returns `{ ok: false, message }` - a clear diagnosis the panel
 * shows - and writes nothing.
 */
export function readFlowValue(profile, text) {
  const quantityType = unitQuantityOf(profile);

  if (quantityType === "custom") {
    const trimmed = String(text ?? "").trim();

    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      return {
        ok: false,
        message: "Enter a number - a custom quantity has no units",
      };
    }

    return { ok: true, value: Number(trimmed), unit: "", explicit: false };
  }

  const read = enggQuantities.readQuantity(
    String(text ?? ""),
    quantityType,
    axesOf(profile).yUnit,
  );

  if (!read) {
    const units = unitsOf(profile).join(", ");

    return {
      ok: false,
      message: `"${String(text ?? "").trim()}" is not a ${quantityLabelOf(profile)} - use a number with one of: ${units}`,
    };
  }

  return { ok: true, ...read };
}

export function readStationValue(profile, text) {
  const read = enggQuantities.readQuantity(
    String(text ?? ""),
    "length",
    axesOf(profile).xUnit,
  );

  if (!read) {
    return {
      ok: false,
      message:
        "Enter a station as a number, optionally with a length unit (mm, cm, m)",
    };
  }

  return { ok: true, ...read };
}

/* ============================================================
 * THE AXES
 * ============================================================ */

export function axesOf(profile) {
  const axes = profile?.engineering?.axes || {};

  const value = (candidate, fallback) =>
    Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;

  const limits = enggProfileFrame.normalisedLimits(
    {
      xMin: value(axes.xMin, DEFAULT_AXES.xMin),
      xMax: value(axes.xMax, DEFAULT_AXES.xMax),
      yMin: value(axes.yMin, DEFAULT_AXES.yMin),
      yMax: value(axes.yMax, DEFAULT_AXES.yMax),
    },
    {
      xMin: DEFAULT_AXES.xMin,
      xMax: DEFAULT_AXES.xMax,
      yMin: DEFAULT_AXES.yMin,
      yMax: DEFAULT_AXES.yMax,
    },
  );

  return {
    xTitle: String(axes.xTitle ?? DEFAULT_AXES.xTitle),
    xUnit: String(axes.xUnit ?? DEFAULT_AXES.xUnit),
    yTitle: String(axes.yTitle ?? DEFAULT_AXES.yTitle),
    yUnit: String(axes.yUnit ?? DEFAULT_AXES.yUnit),
    ...limits,
  };
}

export function setAxes(profile, patch = {}) {
  const axes = axesOf(profile);

  const next = {
    ...axes,
    ...Object.fromEntries(
      Object.entries(patch).filter(([key]) => Object.hasOwn(axes, key)),
    ),
  };

  ["xTitle", "xUnit", "yTitle", "yUnit"].forEach((key) => {
    next[key] = String(next[key] ?? "");
  });

  ["xMin", "xMax", "yMin", "yMax"].forEach((key) => {
    const value = Number(next[key]);

    next[key] = Number.isFinite(value) ? value : axes[key];
  });

  if (next.xMax <= next.xMin || next.yMax <= next.yMin) {
    return false;
  }

  profile.engineering = { ...(profile.engineering || {}), axes: next };

  return true;
}

/* ============================================================
 * THE FRAME
 * ============================================================ */

export function profileFrame(profile) {
  return enggProfileFrame.profileFrame(profile);
}

export function plotArea(profile) {
  return enggProfileFrame.plotArea(profile);
}

export function dataToDrawing(profile, row) {
  return enggProfileFrame.dataToDrawingPoint(profile, axesOf(profile), row);
}

export function drawingToData(profile, point) {
  return enggProfileFrame.drawingToDataPoint(profile, axesOf(profile), point);
}

/* The plotted points, in drawing coordinates, from the rows. */
export function plottedPoints(profile) {
  return readRows(profile)
    .map((row, index) => {
      const at = dataToDrawing(profile, row);

      return at ? { ...at, index, row } : null;
    })
    .filter(Boolean);
}

export const ticksFor = enggProfileFrame.ticksFor;

export function graphNameOf(profile) {
  return String(profile?.engineering?.graphName ?? "");
}

export function setGraphName(profile, name) {
  profile.engineering = {
    ...(profile.engineering || {}),
    graphName: String(name ?? ""),
  };

  return true;
}

export function showGridOf(profile) {
  return profile?.engineering?.grid !== false;
}

export function showPointsOf(profile) {
  return profile?.engineering?.pointsShown !== false;
}

export function lineStyleOf(profile) {
  const id = String(profile?.engineering?.lineStyle ?? "straight");

  return LINE_STYLES.some((entry) => entry.id === id) ? id : "straight";
}

export function setLineStyle(profile, id) {
  if (!LINE_STYLES.some((entry) => entry.id === id)) {
    return false;
  }

  profile.engineering = { ...(profile.engineering || {}), lineStyle: id };

  return true;
}

/* ============================================================
 * THE ROWS
 * ============================================================ */

const toRows = (rows) =>
  rows.map((row) => ({
    position: Number(row.position),
    [VALUE_KEY]: Number(row.value),
  }));

export function readRows(profile) {
  return enggProfileFrame.readRows(profile, VALUE_KEY);
}

export function addPoint(profile, row = null) {
  const rows = readRows(profile);

  if (rows.length >= MAX_PROFILE_POINTS) {
    return false;
  }

  const axes = axesOf(profile);

  const next =
    row &&
    Number.isFinite(Number(row.position)) &&
    Number.isFinite(Number(row.value))
      ? { position: Number(row.position), value: Number(row.value) }
      : enggProfileFrame.nextRowFor(rows, axes);

  profile.engineering = {
    ...(profile.engineering || {}),
    points: toRows([...rows, next]),
  };

  return true;
}

export function removePoint(profile, index) {
  const rows = readRows(profile);
  const at = Number(index);

  if (!Number.isInteger(at) || at < 0 || at >= rows.length) {
    return false;
  }

  profile.engineering = {
    ...(profile.engineering || {}),
    points: toRows(rows.filter((_, position) => position !== at)),
  };

  return true;
}

/*
 * EDIT ONE ROW. A patch that states a non-number is REFUSED rather than
 * defaulted, so a malformed entry cannot overwrite a valid row with a zero.
 */
export function setPoint(profile, index, patch = {}) {
  const rows = readRows(profile);
  const at = Number(index);

  if (!Number.isInteger(at) || at < 0 || at >= rows.length) {
    return false;
  }

  const hasPosition = patch.position !== undefined;
  const hasValue = patch.value !== undefined;

  const position = hasPosition ? Number(patch.position) : rows[at].position;
  const value = hasValue ? Number(patch.value) : rows[at].value;

  if (!Number.isFinite(position) || !Number.isFinite(value)) {
    return false;
  }

  const next = rows.map((row, index_) =>
    index_ === at ? { position, value } : row,
  );

  return enggProfileFrame.writeRows(profile, VALUE_KEY, next);
}

/* Replace the whole table - what a source edit to `data=` does. */
export function setRows(profile, rows) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      position: Number(row?.position),
      value: Number(row?.value ?? row?.flow),
    }))
    .filter(
      (row) => Number.isFinite(row.position) && Number.isFinite(row.value),
    );

  return enggProfileFrame.writeRows(profile, VALUE_KEY, clean);
}

/*
 * SET THE LIMITS TO FIT THE DATA - a convenience that WRITES the four fields,
 * so the student sees what it did and can edit it. The stored values never
 * change, only the scale they are drawn on.
 */
export function autoLimits(profile) {
  const fitted = enggProfileFrame.fittedLimits(readRows(profile));

  return fitted ? setAxes(profile, fitted) : false;
}

/* Whether the rows are ordered by station, which a profile line requires. */
export function orderingProblem(profile) {
  const rows = readRows(profile);

  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].position < rows[index - 1].position) {
      return `Point ${index + 1} is before point ${index} - stations must not decrease`;
    }
  }

  return null;
}

/* ============================================================
 * CREATION
 * ============================================================ */

export function createFlowProfile(options = {}) {
  const position = finitePoint(options.position)
    ? { ...options.position }
    : null;

  const width = Number(options.width) || DEFAULT_PROFILE_WIDTH;
  const height = Number(options.height) || DEFAULT_PROFILE_HEIGHT;

  if (!position) {
    return null;
  }

  const quantity = quantityDefinition(
    options.quantity || DEFAULT_FLOW_QUANTITY,
  );

  return enggDrawingState.createGeometryObject(
    FLOW_PROFILE_TYPE,
    { position, width: Math.abs(width), height: Math.abs(height) },
    {
      ...options,
      engineering: {
        points: [],
        quantity: quantity.id,
        customLabel: String(options.customLabel ?? ""),
        stationKind: DEFAULT_STATION_KIND,
        axes: {
          ...DEFAULT_AXES,
          yTitle: quantity.label,
          yUnit: quantity.defaultUnit,
          ...(options.axes || {}),
        },
        graphName: String(options.graphName ?? ""),
        grid: options.grid !== false,
        pointsShown: options.pointsShown !== false,
        lineStyle: LINE_STYLES.some((entry) => entry.id === options.lineStyle)
          ? options.lineStyle
          : "straight",
      },
    },
  );
}

/* A profile from the two corners of a drag, in either direction. */
export function profileFromDrag(from, to, options = {}) {
  const frame = enggProfileFrame.profileFrameFromDrag(from, to);

  return frame ? createFlowProfile({ ...options, ...frame }) : null;
}

export function resizeProfile(profile, width, height) {
  if (!isFlowProfileType(profile?.type)) {
    return false;
  }

  return enggProfileFrame.resizeProfileFrame(profile, width, height);
}

const enggFlowProfile = {
  FLOW_PROFILE_TYPE,
  MIN_PROFILE_SIDE,
  MAX_PROFILE_POINTS,
  VALUE_KEY,
  FLOW_QUANTITIES,
  DEFAULT_FLOW_QUANTITY,
  STATION_KINDS,
  DEFAULT_STATION_KIND,
  DEFAULT_AXES,
  PLOT_INSET,
  LINE_STYLES,
  isFlowProfileType,
  quantityDefinition,
  quantityIdOf,
  quantityOf,
  unitQuantityOf,
  unitsOf,
  quantityLabelOf,
  stationKindOf,
  setQuantity,
  setCustomLabel,
  setValueUnit,
  setStationUnit,
  readFlowValue,
  readStationValue,
  axesOf,
  setAxes,
  profileFrame,
  plotArea,
  dataToDrawing,
  drawingToData,
  plottedPoints,
  ticksFor,
  graphNameOf,
  setGraphName,
  showGridOf,
  showPointsOf,
  lineStyleOf,
  setLineStyle,
  readRows,
  addPoint,
  removePoint,
  setPoint,
  setRows,
  autoLimits,
  orderingProblem,
  createFlowProfile,
  profileFromDrag,
  resizeProfile,
};

export default enggFlowProfile;
