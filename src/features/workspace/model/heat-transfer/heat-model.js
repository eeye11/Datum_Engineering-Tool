/*
 * ========================================================
 * HEAT TRANSFER: THE MODEL
 * ========================================================
 *
 * The feature types of the Heat Transfer workspace, the factories that create
 * them, and the geometry each one is described by. Every object here is a
 * genuine drawing feature - created through the document's own
 * `createGeometryObject`, so it gets the standard ID, name, style, metadata,
 * selection, undo, save and source treatment of every other DAETUM feature.
 *
 * ========================================================
 * ONE TYPE PER OBJECT, AND THE VARIANT ON THE OBJECT
 * ========================================================
 *
 * A Heat Transfer object is ONE stored type with a `variant` where the tool is
 * a dropdown:
 *
 *   "thermal-region"         variant: solid | fluid | surroundings | insulation
 *   "wall-slab"              (no variant - it is exactly two parallel lines)
 *   "composite-wall"         (layers are the model, not a variant)
 *   "fin"                    (no variant)
 *   "heat-path"              variant: conduction | convection | radiation
 *   "thermal-arrow"          variant: heat-rate | heat-flux
 *   "thermal-boundary"       variant: fixed-temperature | convection | radiation
 *                            | adiabatic | heat-flux
 *   "thermal-contact"        (variant decides the interface pattern)
 *   "heat-source-sink"       variant: source | sink
 *   "thermal-circuit-node"   (no variant)
 *   "thermal-circuit-element" variant: resistance | capacitance
 *   "temperature-marker"     (no variant)
 *   "isotherm"               (no variant)
 *   "control-volume"         (no variant)
 *
 * The variant is recorded on the object AND in its `engineering` record, so
 * the Features tab, the renderer, the source writer and a saved file all read
 * the same answer.
 *
 * ========================================================
 * THE GEOMETRY IS DRAWING COORDINATES, NEVER SCREEN PIXELS
 * ========================================================
 *
 * Every length, thickness, arrow size, wave amplitude, hatch spacing and font
 * size below is a drawing-coordinate amount. Nothing here reads the zoom, the
 * canvas size or a pixel, so an object keeps its proportions however far the
 * sheet is zoomed.
 */

import enggDrawingState from "../../../../shared/model/drawing-state.js";
import {
  defaultHeatNotation,
  heatLabelFamily,
  isGeneratedHeatNotation,
} from "./heat-notation.js";
import {
  DEFAULT_ARROW_LENGTH,
  DEFAULT_FIN_THICKNESS,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_NODE_RADIUS,
  DEFAULT_SYMBOL_HALF,
  DEFAULT_SYMBOL_SPACING,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  COMPOSITE_LAYER_INCREMENT,
  MIN_LAYER_WIDTH,
  MIN_WALL_THICKNESS,
  centredRectangleCorners,
  finiteNumber,
  finitePoint,
  midpoint,
  normalOf,
  unitVector,
} from "./heat-shared.js";

/* ============================================================
 * THE FEATURE TYPES
 * ============================================================ */

export const HEAT_TYPES = Object.freeze({
  region: "thermal-region",
  wallSlab: "wall-slab",
  compositeWall: "composite-wall",
  fin: "fin",
  heatPath: "heat-path",
  thermalArrow: "thermal-arrow",
  thermalBoundary: "thermal-boundary",
  thermalContact: "thermal-contact",
  sourceSink: "heat-source-sink",
  circuitNode: "thermal-circuit-node",
  circuitElement: "thermal-circuit-element",
  temperatureMarker: "temperature-marker",
  isotherm: "isotherm",
  controlVolume: "control-volume",
});

const TYPE_SET = new Set(Object.values(HEAT_TYPES));

export function isHeatType(type) {
  return TYPE_SET.has(type);
}

/* The variants each dropdown type understands. */
export const HEAT_VARIANTS = Object.freeze({
  region: ["solid", "fluid", "surroundings", "insulation"],
  heatPath: ["conduction", "convection", "radiation"],
  thermalArrow: ["heat-rate", "heat-flux"],
  thermalBoundary: [
    "fixed-temperature",
    "convection",
    "radiation",
    "adiabatic",
  ],
  sourceSink: ["source", "sink"],
  circuitElement: ["resistance", "capacitance"],
});

/*
 * ============================================================
 * THE DEFAULT OBJECT NAME - THE ACTUAL TOOL'S NAME
 * ============================================================
 *
 * An object is named after the TOOL that made it, not after the storage type
 * or the dropdown it was found behind. A Conduction Path, a Convection Flow
 * and a Radiation Path are all `heat-path` features, but they are three
 * different tools, so they are named - and numbered - separately:
 * "Conduction Path 1", "Convection Flow 1", "Radiation Path 1".
 *
 * The dropdown ("Heat Transfer Path") is a way of organising the toolbar; it
 * never appears as an object's name. A tool with no variant - a Wall / Slab, a
 * Fin - names the object after the tool itself, which is the type's name.
 *
 * NUMBERING IS PER NAME. `addObject` numbers features per TYPE, which would
 * make three different path tools "Heat Transfer Path 1..3". Each factory
 * therefore hands the object a name that is UNIQUE on the sheet, choosing the
 * next free `Name N` for THAT name - see `nextHeatName` - so each tool keeps
 * its own sequence and creating one never advances another.
 */
export const HEAT_TOOL_NAMES = Object.freeze({
  heatPath: {
    conduction: "Conduction Path",
    convection: "Convection Flow",
    radiation: "Radiation Path",
  },
  thermalArrow: {
    "heat-rate": "Heat Transfer Rate",
    "heat-flux": "Heat Flux",
  },
  thermalBoundary: {
    "fixed-temperature": "Fixed Temperature",
    convection: "Convection Boundary",
    radiation: "Radiation Boundary",
    /* The long label is shortened to what the student would call it. */
    adiabatic: "Adiabatic Boundary",
  },
  sourceSink: {
    source: "Heat Source",
    sink: "Heat Sink",
  },
  circuitElement: {
    resistance: "Thermal Resistance",
    capacitance: "Thermal Capacitance",
  },
});

/* ============================================================
 * THE SHEET, PUBLISHED - NOT IMPORTED
 * ============================================================
 *
 * Naming needs the objects already on the sheet, and this model is imported BY
 * the document layer - so importing the live document back would close a cycle
 * and read `undefined` at load time. The editor publishes a reader here once,
 * the same arrangement the Fluids models use for their host lookups, so every
 * factory sees the sheet as it is NOW rather than as it was on import.
 */
let objectListReader = () => [];

export function setHeatObjectListLookup(reader) {
  objectListReader = typeof reader === "function" ? reader : () => [];
}

/*
 * THE SHEET, AS PUBLISHED.
 *
 * A reader (the source writer) that needs a parent's CURRENT position asks
 * here. It answers an empty list when no document is published - a test, or an
 * export of a single object - and a caller must then fall back to the stored
 * geometry, which is correct because nothing has moved.
 */
export function readHeatObjects() {
  try {
    return objectListReader() || [];
  } catch {
    return [];
  }
}

/*
 * The next free `<base> N` for a tool name, numbered per NAME.
 *
 * The sheet is read for names that are already `<base>` or `<base> <n>`, and
 * one past the highest is used. Deleting "Conduction Path 2" does not renumber
 * anything - the next one is chosen past the HIGHEST existing, never by a
 * count - so an unrelated object's name never changes.
 */
export function nextHeatName(base, objects = objectListReader()) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`);

  let highest = 0;

  (Array.isArray(objects) ? objects : []).forEach((object) => {
    const match = pattern.exec(String(object?.name || ""));

    if (!match) {
      return;
    }

    const number = match[1] ? Number(match[1]) : 1;

    if (Number.isFinite(number) && number > highest) {
      highest = number;
    }
  });

  return `${base} ${highest + 1}`;
}

/*
 * THE DEFAULT NAME FOR A SINGLE-TOOL TYPE.
 *
 * A Wall / Slab, a Fin or a Thermal Region has no dropdown, so its name is the
 * type's own label - but it is still NUMBERED, and numbered per NAME, so the
 * first is "Wall / Slab 1" rather than a bare "Wall / Slab" and a second is
 * "Wall / Slab 2".
 */
export function defaultHeatName(base) {
  return nextHeatName(base);
}

/* The tool name for a variant, or null when the variant has no entry. */
export function heatToolName(type, variant) {
  const table = variantOfTypeOf(type);

  return (table && variant ? table[variant] : null) || null;
}

function variantOfTypeOf(type) {
  switch (type) {
    case HEAT_TYPES.heatPath:
      return HEAT_TOOL_NAMES.heatPath;
    case HEAT_TYPES.thermalArrow:
      return HEAT_TOOL_NAMES.thermalArrow;
    case HEAT_TYPES.thermalBoundary:
      return HEAT_TOOL_NAMES.thermalBoundary;
    case HEAT_TYPES.sourceSink:
      return HEAT_TOOL_NAMES.sourceSink;
    case HEAT_TYPES.circuitElement:
      return HEAT_TOOL_NAMES.circuitElement;
    default:
      return null;
  }
}

/*
 * THE DEFAULT LABEL each variant carries on the sheet.
 *
 * THE FALLBACK, WHEN THERE IS NO NOTATION FAMILY. The counted defaults - T₁,
 * Q̇₁, Rₜₕ₁ and the rest - come from `heat-notation.js`, which numbers each
 * family from the labels already on the sheet. This table is what remains for
 * a tool that has no family (a Boundary's annotation is supplied by its own
 * notation, so it is absent here) and is kept small on purpose: one default
 * per quantity, never a second convention.
 *
 * A tool ABSENT here and absent from the family table - a Wall / Slab, a Path,
 * a Region - carries NO automatic label at all, which is the requirement's
 * explicit list of tools that communicate themselves by their geometry.
 */
export const HEAT_DEFAULT_LABELS = Object.freeze({
  region: { solid: "", fluid: "", surroundings: "", insulation: "" },
  heatPath: { conduction: "", convection: "", radiation: "" },
  thermalArrow: { "heat-rate": "\\dot{Q}", "heat-flux": "q''" },
  thermalBoundary: {
    "fixed-temperature": "T_s",
    convection: "h",
    radiation: "\\varepsilon",
    adiabatic: "",
  },
  sourceSink: { source: "\\dot{Q}", sink: "\\dot{Q}" },
  circuitElement: { resistance: "R_{th}", capacitance: "C_{th}" },
});

/*
 * THE DEFAULT LABEL FOR A TOOL, COUNTED BY FAMILY.
 *
 * The family counter is read from the sheet, so the first T is T₁ and the next
 * temperature object of any tool sharing the T family is T₂. A tool with no
 * family gets an empty label - it generates no text.
 */
export function heatDefaultLabel(type, variant, objects = []) {
  const family = heatLabelFamily(type, variant);

  if (!family) {
    return "";
  }

  return defaultHeatNotation(family, objects);
}

/*
 * THE LABEL'S OWN ANCHOR, in drawing units.
 *
 * A label hangs off a point of its parent - the far end of an arrow, the centre
 * of a symbol, the midpoint of a boundary - and then carries its own offset.
 * That anchor is what makes the label FOLLOW its parent through a move or a
 * rotation while the offset preserves wherever the student dragged it.
 */
export function heatLabelAnchor(object) {
  const g = object?.geometry || {};
  const type = object?.type;

  if (type === HEAT_TYPES.thermalArrow || type === HEAT_TYPES.thermalBoundary || type === HEAT_TYPES.thermalContact) {
    if (finitePoint(g.start) && finitePoint(g.end)) {
      return { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };
    }
  }

  if (finitePoint(g.center)) {
    return { x: g.center.x, y: g.center.y };
  }

  if (Array.isArray(g.points) && g.points.length) {
    const valid = g.points.filter(finitePoint);

    if (valid.length) {
      return { x: valid[valid.length - 1].x, y: valid[valid.length - 1].y };
    }
  }

  if (finitePoint(g.position)) {
    return {
      x: g.position.x + finiteNumber(g.width) / 2,
      y: g.position.y - finiteNumber(g.height) / 2,
    };
  }

  return null;
}

/*
 * WHERE THE LABEL IS DRAWN: its anchor plus its own offset, in drawing units.
 *
 * `labelOffset` is the student's placement relative to the parent, so moving
 * the parent carries the label with it and a moved label keeps its position
 * when the parent moves again.
 */
export function heatLabelPosition(object) {
  const anchor = heatLabelAnchor(object);

  if (!anchor) {
    return null;
  }

  const offset = object?.geometry?.labelOffset;
  const dx = finiteNumber(offset?.x, 0);
  const dy = finiteNumber(offset?.y, 0);

  return { x: anchor.x + dx, y: anchor.y + dy };
}

/*
 * THE LABEL CONTENT FOR A NEW OBJECT.
 *
 * The counted notation when the tool has a family, otherwise the tool's own
 * plain fallback - and EMPTY when it has neither, so no text is generated for
 * a Wall / Slab, a Path or a Region.
 *
 * The sheet is read here, at creation time, so the index reflects everything
 * drawn so far - including objects restored from a file.
 */
function newHeatLabel(objects, type, variant) {
  const counted = heatDefaultLabel(type, variant, objects);

  if (counted) {
    return counted;
  }

  const table = HEAT_DEFAULT_LABELS[type];

  return (table && variant ? table[variant] : "") || "";
}

/* The label's own text, from whichever reading it has. */
export function heatLabelTextOf(object) {
  if (typeof object?.label === "string" && object.label.trim()) {
    return object.label;
  }

  if (typeof object?.name === "string") {
    return object.name;
  }

  return "";
}

/* ============================================================
 * READING THE VARIANT, ONE PLACE
 * ============================================================
 *
 * The variant is read here and NOWHERE ELSE. `createGeometryObject` spreads
 * `content` onto the feature, so a Heat Transfer object carries `variant` as a
 * field of its own; `addObject` keeps `engineering`, so it is mirrored there
 * too. Reading either form through this one accessor keeps a document written
 * in either shape readable.
 */
export function variantOf(object) {
  return object?.variant || object?.engineering?.variant || null;
}

/* The object's attached text label, as it is written on the sheet. */
export function heatLabelOf(object) {
  if (typeof object?.label === "string") {
    return object.label;
  }

  const type = object?.type;
  const variant = variantOf(object);

  return HEAT_DEFAULT_LABELS[type]?.[variant] ?? "";
}

/* ============================================================
 * 1. THE THERMAL REGION
 * ============================================================
 *
 * A closed rectangular region. The interior can be transparent or filled; an
 * Insulation region applies an insulation-style fill by default while remaining
 * editable through Appearance. The rectangle is stored as a corner position, a
 * width, a height and a rotation - the SAME shape a Rectangle uses, so the
 * shared corner and rotation handles edit it without a second implementation.
 */
export function createThermalRegion({
  position,
  width,
  height,
  rotation = 0,
  variant = "solid",
  style = {},
  name,
}) {
  if (!finitePoint(position)) {
    return null;
  }

  const regionVariant = HEAT_VARIANTS.region.includes(variant)
    ? variant
    : "solid";

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.region,
    {
      position: { x: position.x, y: position.y },
      width: finiteNumber(width, DEFAULT_WALL_HEIGHT),
      height: finiteNumber(height, DEFAULT_WALL_HEIGHT),
      rotation: finiteNumber(rotation, 0),
    },
    {
      name: typeof name === "string" ? name : defaultHeatName("Thermal Region"),
      style: { ...style },
      content: { variant: regionVariant },
      engineering: { variant: regionVariant },
      metadata: { heatTransfer: true },
    },
  );
}

/* The four corners of a Thermal Region, for the renderer and the hit test. */
export function regionCorners(object) {
  const g = object?.geometry || {};

  return centredRectangleCorners(
    {
      x: finiteNumber(g.position?.x) + finiteNumber(g.width) / 2,
      y: finiteNumber(g.position?.y) + finiteNumber(g.height) / 2,
    },
    finiteNumber(g.width),
    finiteNumber(g.height),
    (finiteNumber(g.rotation) * 180) / Math.PI,
  );
}

/* ============================================================
 * 2. THE WALL / SLAB
 * ============================================================
 *
 * EXACTLY TWO PARALLEL LINES. Not a closed rectangle, no end caps, no internal
 * divisions, no filled area. The model is a centreline (start and end) and a
 * thickness; the two drawn lines are derived from it, so they are ALWAYS
 * parallel, ALWAYS the thickness apart and ALWAYS symmetric about the
 * centreline.
 *
 * THE THREE HANDLES:
 *
 *   start      the midpoint of the starting end - moves both lines' starts
 *   end        the midpoint of the ending end - moves both lines' ends
 *   thickness  the middle of the wall - drags the two lines apart, symmetrically
 *
 * Because the two lines are derived, a thickness drag moves them BOTH about a
 * FIXED centreline and leaves the length unchanged - which is exactly the
 * required behaviour, and it is structural rather than remembered.
 */
export function createWallSlab({
  start,
  end,
  thickness = DEFAULT_WALL_THICKNESS,
  style = {},
  name,
}) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.wallSlab,
    {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      thickness: Math.max(
        MIN_WALL_THICKNESS,
        finiteNumber(thickness, DEFAULT_WALL_THICKNESS),
      ),
    },
    {
      name: typeof name === "string" ? name : defaultHeatName("Wall / Slab"),
      style: { ...style },
      content: {},
      engineering: {},
      metadata: { heatTransfer: true },
    },
  );
}

/*
 * The two boundary lines of a Wall / Slab, derived from its centreline and
 * thickness. Each is { start, end }; line[0] is on the normal side, line[1]
 * the opposite. Returns null for a degenerate centreline.
 */
export function wallSlabLines(object) {
  const g = object?.geometry || {};
  const start = g.start;
  const end = g.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const direction = unitVector(start, end);

  if (!direction) {
    return null;
  }

  const normal = normalOf(direction);
  const half =
    Math.max(
      MIN_WALL_THICKNESS,
      finiteNumber(g.thickness, DEFAULT_WALL_THICKNESS),
    ) / 2;

  const offset = (point, sign) => ({
    x: point.x + normal.x * half * sign,
    y: point.y + normal.y * half * sign,
  });

  return [
    { start: offset(start, 1), end: offset(end, 1) },
    { start: offset(start, -1), end: offset(end, -1) },
  ];
}

/* The midpoint of the wall's starting end - the Start Handle's anchor. */
export function wallSlabStartMid(object) {
  const g = object?.geometry || {};

  return finitePoint(g.start) ? { x: g.start.x, y: g.start.y } : null;
}

/* The midpoint of the wall's ending end - the End Handle's anchor. */
export function wallSlabEndMid(object) {
  const g = object?.geometry || {};

  return finitePoint(g.end) ? { x: g.end.x, y: g.end.y } : null;
}

/*
 * The Thickness Handle's anchor: the middle of the wall, pushed out to the
 * first line so the drag reads as pulling the face away from the centreline.
 */
export function wallSlabThicknessAnchor(object) {
  const lines = wallSlabLines(object);

  if (!lines) {
    return null;
  }

  return midpoint(lines[0].start, lines[0].end);
}

/*
 * SET THE WALL'S THICKNESS.
 *
 * The two lines are derived, so this is the ONLY edit a thickness drag ever
 * makes: it writes the one number both faces are drawn from, clamped to the
 * minimum, and the centreline and length are untouched by construction.
 */
export function setWallSlabThickness(object, thickness) {
  if (!object) {
    return false;
  }

  object.geometry = {
    ...(object.geometry || {}),
    thickness: Math.max(
      MIN_WALL_THICKNESS,
      finiteNumber(thickness, DEFAULT_WALL_THICKNESS),
    ),
  };

  return true;
}

/* ============================================================
 * 3. THE COMPOSITE WALL
 * ============================================================
 *
 * ONE closed rectangular wall divided into adjacent material layers. The model
 * is a centre, a width, a height, a rotation (degrees) and an array of layer
 * widths (drawing units). The outer rectangle and every internal divider are
 * DERIVED from that, so:
 *
 *   - the divider count is always `layers.length - 1`;
 *   - the layer widths always sum to the wall's width;
 *   - resizing the wall scales every layer proportionally;
 *   - rotating the wall rotates every divider with it;
 *   - a divider drag changes two adjacent layer widths and no other.
 *
 * THE LAYERS ARE THE MODEL. A child layer is identifiable by its index, so the
 * Features panel can name and style one layer without breaking the parent.
 */

/*
 * THE LAYER COUNT FOR A WIDTH.
 *
 * N = max(2, floor(W / p)), with `p` the source-defined COMPOSITE_LAYER_INCREMENT.
 * Drawing-coordinate arithmetic, so the count is independent of the zoom.
 */
export function compositeLayerCount(width) {
  const w = Math.abs(finiteNumber(width, 0));

  return Math.max(2, Math.floor(w / COMPOSITE_LAYER_INCREMENT));
}

/* `count` equal layer widths, summing to `width`. */
export function equalLayers(width, count) {
  const n = Math.max(2, Math.round(finiteNumber(count, 2)));
  const each = Math.abs(finiteNumber(width, n * COMPOSITE_LAYER_INCREMENT)) / n;

  return Array.from({ length: n }, () => each);
}

export function createCompositeWall({
  center,
  width,
  height,
  rotation = 0,
  layers,
  style = {},
  name,
}) {
  if (!finitePoint(center)) {
    return null;
  }

  const w = Math.abs(finiteNumber(width, COMPOSITE_LAYER_INCREMENT * 2));
  const layerWidths =
    Array.isArray(layers) && layers.length >= 2
      ? layers.map((layer) =>
          Math.max(MIN_LAYER_WIDTH, finiteNumber(layer, w / layers.length)),
        )
      : equalLayers(w, compositeLayerCount(w));

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.compositeWall,
    {
      center: { x: center.x, y: center.y },
      width: w,
      height: Math.abs(finiteNumber(height, DEFAULT_WALL_HEIGHT)),
      rotation: finiteNumber(rotation, 0),
      layers: layerWidths,
    },
    {
      name: typeof name === "string" ? name : defaultHeatName("Composite Wall"),
      style: { ...style },
      content: {},
      engineering: {},
      metadata: { heatTransfer: true },
    },
  );
}

/* The layers of a Composite Wall, as their widths - at least two. */
export function compositeLayers(object) {
  const layers = object?.geometry?.layers;

  if (Array.isArray(layers) && layers.length >= 2) {
    return layers.map((layer) =>
      Math.max(MIN_LAYER_WIDTH, finiteNumber(layer, MIN_LAYER_WIDTH)),
    );
  }

  return equalLayers(
    object?.geometry?.width,
    compositeLayerCount(object?.geometry?.width),
  );
}

/*
 * THE OUTER RECTANGLE AND THE INTERNAL DIVIDERS, DERIVED.
 *
 * Returns the four outer corners and, for each internal divider, its two
 * endpoints. Divider `i` sits between layer `i` and layer `i + 1`, measured
 * along the wall's local x axis from its left face. All in world coordinates.
 */
export function compositeWallGeometry(object) {
  const g = object?.geometry || {};

  if (!finitePoint(g.center)) {
    return null;
  }

  const width = Math.abs(finiteNumber(g.width, COMPOSITE_LAYER_INCREMENT * 2));
  const height = Math.abs(finiteNumber(g.height, DEFAULT_WALL_HEIGHT));
  const rotation = finiteNumber(g.rotation, 0);
  const layers = compositeLayers(object);

  const corners = centredRectangleCorners(g.center, width, height, rotation);
  const frame = { center: g.center, rotation };

  /*
   * The layers are laid out along the LOCAL x axis from -width/2. The stored
   * widths are normalised to sum to the wall width, so a saved file whose
   * layers drifted by float noise still fills its rectangle exactly.
   */
  const total = layers.reduce((sum, layer) => sum + layer, 0) || 1;

  let cursor = -width / 2;

  const layerRects = layers.map((layer) => {
    const fraction = layer / total;
    const localWidth = fraction * width;
    const rect = {
      left: cursor,
      right: cursor + localWidth,
      width: localWidth,
    };

    cursor += localWidth;

    return rect;
  });

  const local = (x, y) => ({
    x:
      frame.center.x +
      x * Math.cos((rotation * Math.PI) / 180) -
      y * Math.sin((rotation * Math.PI) / 180),
    y:
      frame.center.y +
      x * Math.sin((rotation * Math.PI) / 180) +
      y * Math.cos((rotation * Math.PI) / 180),
  });

  const dividers = layerRects.slice(0, -1).map((rect) => ({
    start: local(rect.right, -height / 2),
    end: local(rect.right, height / 2),
  }));

  return { corners, dividers, layerRects, width, height, rotation, frame };
}

/*
 * RESIZE A COMPOSITE WALL.
 *
 * The existing layer count is PRESERVED and every layer width is scaled by the
 * same factor, so the layers keep their relative proportions. This is the
 * post-placement behaviour: ordinary resizing never adds or removes a division.
 */
export function resizeCompositeWall(object, width, height) {
  if (!object) {
    return false;
  }

  const g = object.geometry || {};
  const oldWidth = Math.abs(
    finiteNumber(g.width, COMPOSITE_LAYER_INCREMENT * 2),
  );
  const newWidth = Math.abs(finiteNumber(width, oldWidth));
  const scale = oldWidth > 1e-12 ? newWidth / oldWidth : 1;

  const layers = compositeLayers(object).map((layer) =>
    Math.max(MIN_LAYER_WIDTH, layer * scale),
  );

  object.geometry = {
    ...g,
    width: newWidth,
    height: Math.abs(finiteNumber(height, g.height || DEFAULT_WALL_HEIGHT)),
    layers,
  };

  return true;
}

/*
 * MOVE ONE INTERNAL DIVIDER.
 *
 * `index` is the divider between layer `index` and layer `index + 1`, and
 * `delta` is how far it is dragged along the wall's local x axis (drawing
 * units). The two adjacent layers change; every other divider stays put;
 * dividers cannot cross; and every layer keeps at least MIN_LAYER_WIDTH.
 *
 * Returns true when the divider actually moved.
 */
export function moveCompositeDivider(object, index, delta) {
  if (!object) {
    return false;
  }

  const layers = compositeLayers(object);

  if (index < 0 || index >= layers.length - 1) {
    return false;
  }

  const amount = finiteNumber(delta, 0);

  if (!Number.isFinite(amount) || Math.abs(amount) < 1e-12) {
    return false;
  }

  const left = layers[index];
  const right = layers[index + 1];

  /*
   * Clamp the drag so neither adjacent layer goes below its minimum. Moving
   * the divider right grows the right layer and shrinks the left, so the most
   * it can move right is what leaves the left at its minimum; and the other
   * way for a leftward drag.
   */
  const clamped = Math.min(
    right - MIN_LAYER_WIDTH,
    Math.max(MIN_LAYER_WIDTH - left, amount),
  );

  if (Math.abs(clamped) < 1e-12) {
    return false;
  }

  const next = layers.slice();

  next[index] = left + clamped;
  next[index + 1] = right - clamped;

  object.geometry = { ...(object.geometry || {}), layers: next };

  return true;
}

/*
 * SET A COMPOSITE WALL'S LAYER COUNT from a freshly drawn width.
 *
 * Used ONLY by the placement gesture: as the drag widens the rectangle, the
 * layer count is regenerated from the width and the layers are redistributed
 * equally. Post-placement resizing goes through `resizeCompositeWall`, which
 * preserves the count.
 */
export function setCompositeWallWidth(object, width) {
  if (!object) {
    return false;
  }

  const w = Math.abs(finiteNumber(width, COMPOSITE_LAYER_INCREMENT * 2));

  object.geometry = {
    ...(object.geometry || {}),
    width: w,
    layers: equalLayers(w, compositeLayerCount(w)),
  };

  return true;
}

/* ============================================================
 * 4. THE FIN
 * ============================================================
 *
 * An elongated rectangular fin attached to a base surface. The model is a base
 * attachment point, a length direction, a length and a thickness; the rectangle
 * and its four handles are derived. Moving the fin preserves its geometry and
 * its attachment relationship, because the attachment IS the model.
 */
export function createFin({
  base,
  end,
  thickness = DEFAULT_FIN_THICKNESS,
  style = {},
  name,
}) {
  if (!finitePoint(base) || !finitePoint(end)) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.fin,
    {
      base: { x: base.x, y: base.y },
      end: { x: end.x, y: end.y },
      thickness: Math.max(
        MIN_LAYER_WIDTH,
        finiteNumber(thickness, DEFAULT_FIN_THICKNESS),
      ),
    },
    {
      name: typeof name === "string" ? name : defaultHeatName("Fin"),
      style: { ...style },
      content: {},
      engineering: {},
      metadata: { heatTransfer: true },
    },
  );
}

/*
 * The Fin's rectangle, derived: its base centre is the attachment, its length
 * runs from base to end, and its thickness is perpendicular. Returns the four
 * corners and the attachment, or null for a degenerate fin.
 */
export function finGeometry(object) {
  const g = object?.geometry || {};

  if (!finitePoint(g.base) || !finitePoint(g.end)) {
    return null;
  }

  const direction = unitVector(g.base, g.end);

  if (!direction) {
    return null;
  }

  const normal = normalOf(direction);
  const half =
    Math.max(
      MIN_LAYER_WIDTH,
      finiteNumber(g.thickness, DEFAULT_FIN_THICKNESS),
    ) / 2;

  const corner = (along, side) => ({
    x: along.x + normal.x * half * side,
    y: along.y + normal.y * half * side,
  });

  return {
    base: { x: g.base.x, y: g.base.y },
    end: { x: g.end.x, y: g.end.y },
    thicknessAnchor: midpoint(g.base, g.end) && {
      x: midpoint(g.base, g.end).x + normal.x * half,
      y: midpoint(g.base, g.end).y + normal.y * half,
    },
    corners: [
      corner(g.base, 1),
      corner(g.end, 1),
      corner(g.end, -1),
      corner(g.base, -1),
    ],
    direction,
    normal,
  };
}

/* ============================================================
 * 5-7. THE PATHS, ARROWS AND BOUNDARIES - ONE SPAN/POINT MODEL
 * ============================================================
 *
 * The Heat Transfer Paths, the Thermal Transfer Arrows and the Thermal
 * Boundaries all share a points-based model: an ordered list of drawing
 * points. A span is two points; a polyline path is two or more. The decoration
 * - the arrowhead, the streamline smoothing, the radiation wave, the boundary
 * symbols - is GENERATED from those points at draw time, never stored as
 * separate geometry, so editing a point updates the whole symbol.
 */
export function createHeatPath({
  points,
  variant = "conduction",
  style = {},
  name,
}) {
  const pathVariant = HEAT_VARIANTS.heatPath.includes(variant)
    ? variant
    : "conduction";
  const pts = (Array.isArray(points) ? points : []).filter(finitePoint);

  if (pts.length < 2) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.heatPath,
    {
      points: pts.map((p) => ({ x: p.x, y: p.y })),
      reversed: false,
    },
    {
      /*
       * NAMED AFTER THE TOOL, NOT THE TYPE. A Conduction Path, a Convection
       * Flow and a Radiation Path are all `heat-path`, but each is its own
       * tool and its own name, so each keeps its own numbering.
       */
      name:
        typeof name === "string"
          ? name
          : nextHeatName(HEAT_TOOL_NAMES.heatPath[pathVariant]),
      style: { ...style },
      content: { variant: pathVariant },
      engineering: { variant: pathVariant },
      metadata: { heatTransfer: true },
    },
  );
}

/*
 * ============================================================
 * CONTINUING A HEAT TRANSFER PATH
 * ============================================================
 *
 * A Heat Transfer Path is a CONTINUOUS polyline: an ordered list of points,
 * with each segment the exact straight run the student dragged. Continuing a
 * path APPENDS the segment's far end to that list - it never inserts a control
 * point, re-fits a curve or moves an established vertex.
 *
 * WHY APPEND, NOT RE-FIT. The old implementation rebuilt the whole path from
 * scratch every time it grew, and fed the points to a Catmull-Rom spline. A
 * spline through three or more points bulges between them, so continuing a path
 * made the FIRST segment curve away from the straight line the student drew -
 * the reported "unexpected curvature". Appending a point cannot do that: the
 * earlier points are untouched, and the renderer decides the APPEARANCE
 * (straight, smooth or wavy) without moving any of them.
 */
export function appendHeatPathSegment(object, end) {
  if (!object || !finitePoint(end)) {
    return false;
  }

  const points = Array.isArray(object.geometry?.points)
    ? object.geometry.points.filter(finitePoint)
    : [];

  if (!points.length) {
    return false;
  }

  const last = points[points.length - 1];

  /* A zero-length segment is not a segment. */
  if (Math.hypot(last.x - end.x, last.y - end.y) < 1e-9) {
    return false;
  }

  object.geometry = {
    ...(object.geometry || {}),
    points: [...points, { x: end.x, y: end.y }],
  };

  return true;
}

/*
 * A HEAT FLUX ARROW'S SURFACE-NORMAL ALIGNMENT.
 *
 * A Heat Flux arrow is drawn ON a surface, which is exactly what an arrow
 * snapped to a Thermal Boundary is. Given the boundary, the arrow's direction
 * is set perpendicular to it - pointing OUT of the surface, or INTO it when
 * `inward` is set - so the student never has to eyeball a normal by hand.
 *
 * It reuses the SAME boundary line the boundary itself is drawn on, so the two
 * cannot disagree about where the surface is. Nothing is stored on the
 * boundary; the arrow keeps its own two ends.
 */
export function surfaceNormalArrow(boundary, length = DEFAULT_ARROW_LENGTH, inward = false) {
  const g = boundary?.geometry || {};

  if (!finitePoint(g.start) || !finitePoint(g.end)) {
    return null;
  }

  const direction = unitVector(g.start, g.end);

  if (!direction) {
    return null;
  }

  /* The normal, turned a quarter turn; `inward` flips it through the surface. */
  const normal = normalOf(direction);
  const sign = inward ? -1 : 1;

  const anchor = { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };

  return {
    start: { x: anchor.x, y: anchor.y },
    end: {
      x: anchor.x + normal.x * length * sign,
      y: anchor.y + normal.y * length * sign,
    },
  };
}

/*
 * KEEP EVERY SURFACE ARROW SQUARE TO ITS BOUNDARY.
 *
 * A Heat Flux arrow drawn on a surface IS that surface's normal. When the
 * boundary moves, turns or is resized, the arrow must follow it - otherwise the
 * flux points somewhere the wall does not go, which is a drawing that says
 * something untrue.
 *
 * It runs on every render, beside the label reconcile, so no transform path has
 * to remember it. It only WRITES when the arrow actually needs to change, so an
 * untouched arrow is left byte-identical and Undo sees no spurious edit.
 *
 * An arrow whose boundary is gone is LEFT ALONE rather than deleted: the document
 * already deletes a child with its parent, and removing an arrow because its
 * host was momentarily missing would destroy it during an Undo.
 */
export function reconcileSurfaceArrows(objects = []) {
  const list = Array.isArray(objects) ? objects : [];

  let changed = 0;

  list.forEach((arrow) => {
    if (arrow?.type !== HEAT_TYPES.thermalArrow) {
      return;
    }

    const hostId = arrow.geometry?.surfaceId;

    if (!hostId) {
      return;
    }

    const boundary = list.find((object) => object?.id === hostId);

    if (!boundary || boundary.type !== HEAT_TYPES.thermalBoundary) {
      return;
    }

    const span = surfaceNormalArrow(
      boundary,
      undefined,
      arrow.geometry?.inward === true
    );

    if (!span) {
      return;
    }

    const current = arrow.geometry || {};

    const same =
      Math.abs(Number(current.start?.x) - span.start.x) < 1e-9 &&
      Math.abs(Number(current.start?.y) - span.start.y) < 1e-9 &&
      Math.abs(Number(current.end?.x) - span.end.x) < 1e-9 &&
      Math.abs(Number(current.end?.y) - span.end.y) < 1e-9;

    if (same) {
      return;
    }

    arrow.geometry = { ...current, start: span.start, end: span.end };
    changed += 1;
  });

  return changed;
}

/*
 * FLIP A SURFACE ARROW THROUGH ITS BOUNDARY.
 *
 * The one edit the "Direction" control makes: the arrow keeps its host and its
 * length, and points the other way through the surface.
 */
export function setSurfaceArrowInward(arrow, inward, objects = []) {
  if (!arrow || arrow.type !== HEAT_TYPES.thermalArrow) {
    return false;
  }

  const hostId = arrow.geometry?.surfaceId;

  if (!hostId) {
    return false;
  }

  const boundary = (objects || []).find((object) => object?.id === hostId);

  if (!boundary) {
    return false;
  }

  arrow.geometry = { ...(arrow.geometry || {}), inward: inward === true };

  reconcileSurfaceArrows(objects);

  return true;
}

export function createThermalArrow({
  start,
  end,
  variant = "heat-rate",
  style = {},
  name,
  /* An optional surface the arrow is perpendicular to - a Thermal Boundary. */
  surface = null,
  inward = false,
}) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  const arrowVariant = HEAT_VARIANTS.thermalArrow.includes(variant)
    ? variant
    : "heat-rate";

  /*
   * A SURFACE, WHEN GIVEN, DECIDES THE DIRECTION.
   *
   * `surfaceNormalArrow` produces the two ends perpendicular to the boundary at
   * its midpoint, pointing out (or in, with `inward`). The caller's own two
   * points are then only the fallback, so a snapped arrow ends up normal to the
   * wall it landed on rather than along it.
   */
  const normalSpan = surface ? surfaceNormalArrow(surface, undefined, inward) : null;

  const from = normalSpan ? normalSpan.start : start;
  const to = normalSpan ? normalSpan.end : end;

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.thermalArrow,
    {
      start: { x: from.x, y: from.y },
      end: { x: to.x, y: to.y },
      reversed: false,
      /*
       * THE HOST SURFACE, KEPT AS A RECORD.
       *
       * The id lets the arrow be RE-SQUARED when its boundary moves or turns -
       * `reconcileSurfaceArrows` does that on every render - and `inward` says
       * which way through the surface it points, so the student can flip it from
       * the Features tab without redrawing anything.
       */
      ...(surface && surface.id ? { surfaceId: surface.id } : {}),
      ...(surface ? { inward: inward === true } : {}),
    },
    {
      name:
        typeof name === "string"
          ? name
          : nextHeatName(HEAT_TOOL_NAMES.thermalArrow[arrowVariant]),
      style: { ...style },
      content: {
        variant: arrowVariant,
        label: newHeatLabel(objectListReader(), HEAT_TYPES.thermalArrow, arrowVariant),
      },
      engineering: {
        variant: arrowVariant,
        label: HEAT_DEFAULT_LABELS.thermalArrow[arrowVariant],
      },
      /* The drawn label starts at the arrow's own default label position. */
      label: newHeatLabel(objectListReader(), HEAT_TYPES.thermalArrow, arrowVariant),
      metadata: { heatTransfer: true },
    },
  );
}

export function createThermalBoundary({
  start,
  end,
  variant = "fixed-temperature",
  side = 1,
  spacing = DEFAULT_SYMBOL_SPACING,
  style = {},
  name,
}) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  /*
   * AN UNKNOWN VARIANT FALLS BACK TO A FIXED TEMPERATURE.
   *
   * That is how a document written before the Prescribed Heat-Flux Boundary
   * was removed still opens: its `heat-flux` boundary becomes a fixed
   * temperature one rather than a broken object. The geometry, and therefore
   * the surface the student drew, is untouched - only the decoration differs,
   * and they can change it from the Features tab.
   */
  const boundaryVariant = HEAT_VARIANTS.thermalBoundary.includes(variant)
    ? variant
    : "fixed-temperature";

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.thermalBoundary,
    {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      side: side === -1 ? -1 : 1,
      spacing: Math.max(1, finiteNumber(spacing, DEFAULT_SYMBOL_SPACING)),
    },
    {
      name:
        typeof name === "string"
          ? name
          : nextHeatName(HEAT_TOOL_NAMES.thermalBoundary[boundaryVariant]),
      style: { ...style },
      content: {
        variant: boundaryVariant,
        label: newHeatLabel(objectListReader(), HEAT_TYPES.thermalBoundary, boundaryVariant),
      },
      engineering: {
        variant: boundaryVariant,
        label: HEAT_DEFAULT_LABELS.thermalBoundary[boundaryVariant],
      },
      label: newHeatLabel(objectListReader(), HEAT_TYPES.thermalBoundary, boundaryVariant),
      metadata: { heatTransfer: true },
    },
  );
}

export function createThermalContact({
  start,
  end,
  pattern = "plain",
  style = {},
  name,
}) {
  if (!finitePoint(start) || !finitePoint(end)) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.thermalContact,
    {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    },
    {
      name:
        typeof name === "string" ? name : defaultHeatName("Thermal Contact"),
      style: { ...style },
      content: { pattern },
      engineering: { pattern },
      label: newHeatLabel(objectListReader(), HEAT_TYPES.thermalContact, null),
      metadata: { heatTransfer: true },
    },
  );
}

/*
 * THE DECORATIONS OF A BOUNDARY, GENERATED FROM ITS GEOMETRY.
 *
 * The repeated symbols - convection arrows, radiation marks, insulation
 * hatches, heat-flux arrows - are computed from the boundary's own start, end,
 * side and spacing. They are returned as a list of strokes, each a small
 * polyline, so the canvas and the source writer draw the SAME marks and a
 * resize re-spaces them automatically.
 *
 * `variant` decides the mark's shape; `side` which face it is drawn on.
 */
export function boundaryDecorations(object) {
  const g = object?.geometry || {};
  const start = g.start;
  const end = g.end;

  if (!finitePoint(start) || !finitePoint(end)) {
    return [];
  }

  const direction = unitVector(start, end);

  if (!direction) {
    return [];
  }

  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const side = g.side === -1 ? -1 : 1;
  const normal = {
    x: normalOf(direction).x * side,
    y: normalOf(direction).y * side,
  };
  const spacing = Math.max(1, finiteNumber(g.spacing, DEFAULT_SYMBOL_SPACING));
  const variant = variantOf(object);

  /*
   * The number of marks is derived from the length, so a resized boundary
   * keeps its symbols evenly spread. One mark per spacing interval, at least
   * one, never landing exactly on an endpoint.
   */
  const count = Math.max(1, Math.round(length / spacing));

  const marks = [];

  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    const anchor = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };

    marks.push(boundaryMark(variant, anchor, direction, normal));
  }

  return marks.filter(Boolean);
}

/*
 * ONE BOUNDARY MARK, as a small stroke or arrow.
 *
 * Each returns { kind, points } where points is the stroke to draw; an arrow
 * adds a head. The marks are built from the SAME direction and normal, so a
 * convection arrow and a flux arrow point the same way off the same wall.
 */
function boundaryMark(variant, anchor, direction, normal) {
  const size = DEFAULT_SYMBOL_HALF * 0.8;

  if (variant === "convection" || variant === "heat-flux") {
    /* An arrow pointing AWAY from the boundary along the normal. */
    const tip = {
      x: anchor.x + normal.x * size,
      y: anchor.y + normal.y * size,
    };

    return { kind: "arrow", points: [anchor, tip], tip, direction: normal };
  }

  if (variant === "radiation") {
    /* A short wavy stroke leaving the boundary - three zig-zag points. */
    const step = size / 3;
    const wiggle = size * 0.35;

    const point = (along, sideways) => ({
      x: anchor.x + normal.x * along + direction.x * sideways,
      y: anchor.y + normal.y * along + direction.y * sideways,
    });

    return {
      kind: "wave",
      points: [
        anchor,
        point(step, wiggle),
        point(step * 2, -wiggle),
        point(step * 3, 0),
      ],
    };
  }

  if (variant === "adiabatic") {
    /* An insulation hatch: a short tick leaning off the boundary. */
    const tip = {
      x: anchor.x + normal.x * size * 0.7 + direction.x * size * 0.4,
      y: anchor.y + normal.y * size * 0.7 + direction.y * size * 0.4,
    };

    return { kind: "hatch", points: [anchor, tip] };
  }

  /* fixed-temperature: a small normal tick marking the surface. */
  const tip = {
    x: anchor.x + normal.x * size * 0.5,
    y: anchor.y + normal.y * size * 0.5,
  };

  return { kind: "tick", points: [anchor, tip] };
}

/* ============================================================
 * 8-11. THE SOURCE/SINK AND THE CIRCUIT OBJECTS
 * ============================================================
 *
 * The composite symbols. Each is described by a centre and a rotation (its
 * frame) plus its own size; its ports and its drawn shape are derived from the
 * frame, so moving or rotating the symbol moves its ports with it.
 */
export function createSourceSink({
  center,
  variant = "source",
  rotation = 0,
  style = {},
  name,
}) {
  if (!finitePoint(center)) {
    return null;
  }

  const sourceVariant = HEAT_VARIANTS.sourceSink.includes(variant)
    ? variant
    : "source";

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.sourceSink,
    {
      center: { x: center.x, y: center.y },
      rotation: finiteNumber(rotation, 0),
      size: DEFAULT_SYMBOL_HALF,
    },
    {
      name:
        typeof name === "string"
          ? name
          : nextHeatName(HEAT_TOOL_NAMES.sourceSink[sourceVariant]),
      style: { ...style },
      content: {
        variant: sourceVariant,
        label: newHeatLabel(objectListReader(), HEAT_TYPES.sourceSink, sourceVariant),
      },
      engineering: {
        variant: sourceVariant,
        label: HEAT_DEFAULT_LABELS.sourceSink[sourceVariant],
      },
      label: newHeatLabel(objectListReader(), HEAT_TYPES.sourceSink, sourceVariant),
      metadata: { heatTransfer: true },
    },
  );
}

export function createCircuitNode({ center, style = {}, name }) {
  if (!finitePoint(center)) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.circuitNode,
    {
      center: { x: center.x, y: center.y },
      radius: DEFAULT_NODE_RADIUS,
    },
    {
      name:
        typeof name === "string" ? name : defaultHeatName("Thermal Circuit Node"),
      style: { ...style },
      content: { label: "T" },
      engineering: { label: "T" },
      label: newHeatLabel(objectListReader(), HEAT_TYPES.circuitNode, null),
      metadata: { heatTransfer: true },
    },
  );
}

export function createCircuitElement({
  center,
  variant = "resistance",
  rotation = 0,
  style = {},
  name,
}) {
  if (!finitePoint(center)) {
    return null;
  }

  const elementVariant = HEAT_VARIANTS.circuitElement.includes(variant)
    ? variant
    : "resistance";

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.circuitElement,
    {
      center: { x: center.x, y: center.y },
      rotation: finiteNumber(rotation, 0),
      size: DEFAULT_SYMBOL_HALF,
    },
    {
      name:
        typeof name === "string"
          ? name
          : nextHeatName(HEAT_TOOL_NAMES.circuitElement[elementVariant]),
      style: { ...style },
      content: {
        variant: elementVariant,
        label: newHeatLabel(objectListReader(), HEAT_TYPES.circuitElement, elementVariant),
      },
      engineering: {
        variant: elementVariant,
        label: HEAT_DEFAULT_LABELS.circuitElement[elementVariant],
      },
      label: newHeatLabel(objectListReader(), HEAT_TYPES.circuitElement, elementVariant),
      metadata: { heatTransfer: true },
    },
  );
}

/*
 * THE TWO CONNECTION PORTS OF A CIRCUIT ELEMENT, DERIVED FROM ITS FRAME.
 *
 * A port sits at each end of the symbol along its local x axis, so rotating
 * the element rotates the ports with it and a connector stays attached through
 * every move and rotation. The ports are world points.
 */
export function circuitElementPorts(object) {
  const g = object?.geometry || {};

  if (!finitePoint(g.center)) {
    return null;
  }

  const size = Math.max(1, finiteNumber(g.size, DEFAULT_SYMBOL_HALF));
  const rotation = finiteNumber(g.rotation, 0);
  const frame = { center: g.center, rotation };

  const cos = Math.cos((rotation * Math.PI) / 180);
  const sin = Math.sin((rotation * Math.PI) / 180);
  const place = (x) => ({
    x: frame.center.x + x * cos,
    y: frame.center.y + x * sin,
  });

  void frame;

  return {
    a: place(-size * 1.6),
    b: place(size * 1.6),
  };
}

/* The single connection point of a Thermal Circuit Node. */
export function circuitNodePort(object) {
  const g = object?.geometry || {};

  return finitePoint(g.center) ? { x: g.center.x, y: g.center.y } : null;
}

/* ============================================================
 * 12-14. THE ANALYSIS OBJECTS
 * ============================================================ */

export function createTemperatureMarker({
  center,
  text = "T",
  style = {},
  name,
}) {
  if (!finitePoint(center)) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.temperatureMarker,
    {
      center: { x: center.x, y: center.y },
      radius: DEFAULT_MARKER_RADIUS,
    },
    {
      name:
        typeof name === "string" ? name : defaultHeatName("Temperature Marker"),
      style: { ...style },
      content: { label: text },
      engineering: { label: text },
      /*
       * A Temperature Marker's drawn label is its counted T notation - T₁,
       * T₂, … - unless the caller supplied text, which is used as given.
       */
      label:
        typeof text === "string" && text.trim()
          ? text
          : newHeatLabel(objectListReader(), HEAT_TYPES.temperatureMarker, null),
      metadata: { heatTransfer: true },
    },
  );
}

export function createIsotherm({ points, closed = false, style = {}, name }) {
  const pts = (Array.isArray(points) ? points : []).filter(finitePoint);

  if (pts.length < 2) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.isotherm,
    {
      points: pts.map((p) => ({ x: p.x, y: p.y })),
      closed: closed === true,
    },
    {
      name: typeof name === "string" ? name : defaultHeatName("Isotherm"),
      style: { ...style },
      content: {},
      engineering: {},
      /* An isotherm is a temperature contour: it carries the T notation. */
      label: newHeatLabel(objectListReader(), HEAT_TYPES.isotherm, null),
      metadata: { heatTransfer: true },
    },
  );
}

export function createControlVolume({
  position,
  width,
  height,
  rotation = 0,
  style = {},
  name,
}) {
  if (!finitePoint(position)) {
    return null;
  }

  return enggDrawingState.createGeometryObject(
    HEAT_TYPES.controlVolume,
    {
      position: { x: position.x, y: position.y },
      width: Math.abs(finiteNumber(width, DEFAULT_WALL_HEIGHT)),
      height: Math.abs(finiteNumber(height, DEFAULT_WALL_HEIGHT)),
      rotation: finiteNumber(rotation, 0),
    },
    {
      name:
        typeof name === "string" ? name : defaultHeatName("Control Volume"),
      style: { ...style },
      content: { label: "CV" },
      engineering: { label: "CV" },
      label: newHeatLabel(objectListReader(), HEAT_TYPES.controlVolume, null),
      metadata: { heatTransfer: true },
    },
  );
}

/* The four corners of a Control Volume Boundary. */
export function controlVolumeCorners(object) {
  const g = object?.geometry || {};

  return centredRectangleCorners(
    {
      x: finiteNumber(g.position?.x) + finiteNumber(g.width) / 2,
      y: finiteNumber(g.position?.y) + finiteNumber(g.height) / 2,
    },
    finiteNumber(g.width),
    finiteNumber(g.height),
    (finiteNumber(g.rotation) * 180) / Math.PI,
  );
}

/* ============================================================
 * THE BOUNDS EVERY OBJECT SHARES
 * ============================================================
 *
 * Used by Fit, box selection and the hit test, so every Heat Transfer object
 * answers "where are you" the same way the rest of the drawing does.
 */
export function heatBounds(object) {
  const g = object?.geometry || {};
  const type = object?.type;

  const pointsOf = (pts) => {
    const valid = (pts || []).filter(finitePoint);

    if (!valid.length) {
      return null;
    }

    const xs = valid.map((p) => p.x);
    const ys = valid.map((p) => p.y);

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  };

  if (type === HEAT_TYPES.region || type === HEAT_TYPES.controlVolume) {
    return pointsOf(
      type === HEAT_TYPES.region
        ? regionCorners(object)
        : controlVolumeCorners(object),
    );
  }

  if (type === HEAT_TYPES.compositeWall) {
    return pointsOf(compositeWallGeometry(object)?.corners);
  }

  if (type === HEAT_TYPES.fin) {
    return pointsOf(finGeometry(object)?.corners);
  }

  if (type === HEAT_TYPES.wallSlab) {
    const lines = wallSlabLines(object);

    return lines
      ? pointsOf([lines[0].start, lines[0].end, lines[1].start, lines[1].end])
      : null;
  }

  if (type === HEAT_TYPES.heatPath || type === HEAT_TYPES.isotherm) {
    return pointsOf(g.points);
  }

  if (
    type === HEAT_TYPES.thermalArrow ||
    type === HEAT_TYPES.thermalBoundary ||
    type === HEAT_TYPES.thermalContact
  ) {
    return pointsOf([g.start, g.end]);
  }

  if (
    type === HEAT_TYPES.sourceSink ||
    type === HEAT_TYPES.circuitElement ||
    type === HEAT_TYPES.circuitNode ||
    type === HEAT_TYPES.temperatureMarker
  ) {
    const size =
      Math.max(
        finiteNumber(g.radius, 0),
        finiteNumber(g.size, DEFAULT_SYMBOL_HALF),
      ) * 2;

    return finitePoint(g.center)
      ? {
          minX: g.center.x - size,
          minY: g.center.y - size,
          maxX: g.center.x + size,
          maxY: g.center.y + size,
        }
      : null;
  }

  return null;
}

/*
 * MOVE A HEAT TRANSFER OBJECT BY A DELTA.
 *
 * Every object's stored points are translated, so a move is the same edit for
 * the canvas, the source and a saved file. The variant, the layers and the
 * style are untouched - only the position changes.
 */
export function translateHeatObject(object, dx, dy) {
  if (!object || (!finiteNumber(dx, 0) && !finiteNumber(dy, 0))) {
    return false;
  }

  const move = (point) =>
    finitePoint(point) ? { x: point.x + dx, y: point.y + dy } : point;

  const g = object.geometry || {};

  if (finitePoint(g.position)) {
    g.position = move(g.position);
  }

  if (finitePoint(g.center)) {
    g.center = move(g.center);
  }

  if (finitePoint(g.start)) {
    g.start = move(g.start);
  }

  if (finitePoint(g.end)) {
    g.end = move(g.end);
  }

  if (finitePoint(g.base)) {
    g.base = move(g.base);
  }

  if (Array.isArray(g.points)) {
    g.points = g.points.map(move);
  }

  object.geometry = g;

  return true;
}

const enggHeatModel = {
  HEAT_TYPES,
  HEAT_VARIANTS,
  HEAT_DEFAULT_LABELS,
  HEAT_TOOL_NAMES,
  heatToolName,
  nextHeatName,
  defaultHeatName,
  readHeatObjects,
  setHeatObjectListLookup,
  isHeatType,
  variantOf,
  heatLabelOf,
  heatDefaultLabel,
  heatLabelAnchor,
  heatLabelPosition,
  heatLabelTextOf,
  isGeneratedHeatNotation,

  createThermalRegion,
  regionCorners,

  createWallSlab,
  wallSlabLines,
  wallSlabStartMid,
  wallSlabEndMid,
  wallSlabThicknessAnchor,
  setWallSlabThickness,

  createCompositeWall,
  compositeLayerCount,
  compositeLayers,
  compositeWallGeometry,
  equalLayers,
  resizeCompositeWall,
  moveCompositeDivider,
  setCompositeWallWidth,

  createFin,
  finGeometry,

  createHeatPath,
  appendHeatPathSegment,
  surfaceNormalArrow,
  reconcileSurfaceArrows,
  setSurfaceArrowInward,
  createThermalArrow,
  createThermalBoundary,
  createThermalContact,
  boundaryDecorations,

  createSourceSink,
  createCircuitNode,
  createCircuitElement,
  circuitElementPorts,
  circuitNodePort,

  createTemperatureMarker,
  createIsotherm,
  createControlVolume,
  controlVolumeCorners,

  heatBounds,
  translateHeatObject,
};

export default enggHeatModel;
