/*
 * ============================================================
 * THE SCHEMATIC FLUIDS READERS
 * ============================================================
 *
 * The reader half of the schematic tools added after Pipe / Duct, Elbow,
 * Junction and the attached Flow Arrow:
 *
 *   reducer-expander        its mode, transition length and two connections
 *   pump / valve / meter    its placement, size, rotation and connected pipes
 *   reservoir-tank          its style and its size
 *   fluid-level             its vessel and its height
 *   flow-arrow (free)       its two ends
 *   flow-direction-diagram  its pipe, position, direction and spacing
 *   pressure-profile        its table and its axis limits
 *   section-plane           its direction, identifier and arrows
 *
 * EVERY READER IS DRIVEN BY THE SAME METADATA LINE ITS WRITER EMITS. A block
 * whose metadata is missing, unreadable or names an object that is not in the
 * drawing is DECLINED (null), never guessed at - the block then keeps its last
 * valid form, exactly as any other unsupported edit does.
 *
 * WHAT IS READ FROM GEOMETRY AND WHAT FROM METADATA:
 *
 *   geometry  where the object is, how big it is, and the points it draws
 *   metadata  what it IS attached to, and the numbers that are not geometry
 *
 * That split is the same one the Flow Arrow already uses, and it is what makes
 * the two round-trip: the source says which pipe a symbol joins, so a typed
 * block rebuilds a REAL connection instead of a lookalike.
 */

import enggReducer from "../../../../features/workspace/model/fluids/reducer-expander.js";
import enggEquipment from "../../../../features/workspace/model/fluids/inline-equipment.js";
import enggVessel from "../../../../features/workspace/model/fluids/reservoir-tank.js";
import enggFlowArrows from "../../../../features/workspace/model/fluids/flow-arrows.js";
import enggPressureProfile from "../../../../features/workspace/model/fluids/pressure-profile.js";
import enggSectionPlane from "../../../../features/workspace/model/fluids/section-plane.js";
import { POINTS_PER_LINE_WIDTH } from "../../../../tool-library/shared/primitives/tikz-style.js";

/* One metadata line, as `{ field, value }` - or null when it is not one. */
const METADATA = /^[ \t]*%[ \t]*DAETUM[ \t]+([A-Z]+)[ \t]*:[ \t]*(.*?)[ \t]*$/;

/* The fields this reader understands, beyond the shared header. */
export const SCHEMATIC_FIELDS = Object.freeze({
  reducer: "REDUCER",
  inline: "INLINE",
  vessel: "VESSEL",
  level: "LEVEL",
  direction: "DIRECTION",
  profile: "PROFILE",
  section: "SECTION"
});

function metadataOf(source) {
  const fields = {};

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const match = METADATA.exec(line);

      if (match) {
        fields[String(match[1]).toUpperCase()] = match[2];
      }
    });

  return fields;
}

/* `a=1 b="two words"` -> `{ a: "1", b: "two words" }`. */
function settingsOf(value) {
  const settings = {};

  const pattern = /([A-Za-z][\w-]*)=(?:"([^"]*)"|(\S*))/g;

  let match = pattern.exec(String(value ?? ""));

  while (match) {
    settings[match[1]] = match[2] !== undefined ? match[2] : match[3];
    match = pattern.exec(String(value ?? ""));
  }

  return settings;
}

/* The numbers, as numbers - with a fallback for anything unreadable. */
function numberOf(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/* The coordinates of every `( x , y )` in the source, in drawing coordinates. */
function coordinatesOf(source) {
  return [...String(source ?? "").matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]) })
  );
}

/*
 * THE `[x=1mm, y=1mm, scale=S]` THE PICTURE IS DRAWN AT.
 *
 * The writer's coordinates are already in the picture's space, so a scale on the
 * picture is not something a reader has to undo - but the value is read anyway so
 * a caller that needs it (a fitted export) has one place to ask.
 */
function pictureScaleOf(source) {
  const match = /\\begin\s*\{tikzpicture\}\s*\[[^\]]*scale\s*=\s*([\d.]+)/.exec(String(source ?? ""));

  return match ? Number(match[1]) : 1;
}

void pictureScaleOf;

/* The style a block's options state, mapped back to the model's own words. */
function baseStyleFromSource(source, previous = {}) {
  const style = { ...(previous || {}) };

  const definitions = new Map();

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const html = /^[ \t]*\\definecolor\{([^}]*)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/.exec(line);

      if (html) {
        definitions.set(html[1].trim(), `#${html[2].toUpperCase()}`.toLowerCase());
        return;
      }

      const rgb = /^[ \t]*\\definecolor\{([^}]*)\}\{RGB\}\{(\d+),(\d+),(\d+)\}/.exec(line);

      if (rgb) {
        const hex = [rgb[2], rgb[3], rgb[4]]
          .map((channel) => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, "0"))
          .join("");

        definitions.set(rgb[1].trim(), `#${hex}`.toLowerCase());
      }
    });

  const optionLists = [...String(source ?? "").matchAll(/\\(?:draw|fill|filldraw)\s*\[([^\]]*)\]/g)].map(
    (match) => match[1]
  );

  optionLists.forEach((list) => {
    list.split(",").forEach((option) => {
      const [rawKey, rawValue] = option.split("=").map((part) => part.trim());
      const key = rawKey.replace(/\s+/g, " ").toLowerCase();

      if (key === "dashed") {
        style.lineType = "dashed";
      } else if (key === "dotted") {
        style.lineType = "dotted";
      } else if (key === "dash pattern") {
        const first = (String(rawValue || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number).find((value) => value > 0) || 1;
        style.lineType = first <= 0.5 ? "dotted" : "dashed";
      } else if (key === "line width") {
        const points = Number((String(rawValue || "").match(/-?\d+(?:\.\d+)?/) || [])[0]);

        if (Number.isFinite(points) && points > 0) {
          style.lineWidth = Number((points / POINTS_PER_LINE_WIDTH).toFixed(3));
        }
      } else if (key === "draw" || key === "color") {
        const value = String(rawValue || "").trim();
        const named = definitions.get(value);

        if (named) {
          style.stroke = named;
        } else if (/^black$/i.test(value)) {
          style.stroke = "#000000";
        } else if (/^none$/i.test(value)) {
          style.stroke = "none";
        }
      } else if (key === "fill") {
        const value = String(rawValue || "").trim();
        const named = definitions.get(value) || (/^black$/i.test(value) ? "#000000" : null);

        if (named) {
          style.fill = named;
          style.fillMode = "solid";
        }
      }
    });
  });

  return style;
}

/* ============================================================
 * THE READERS
 * ============================================================ */

/*
 * A REDUCER IS FOUND BY ITS WEAKEST FACT: the metadata line. Its two walls then
 * give its centre, and the arms give its direction - so a hand-edited taper whose
 * endpoints moved is read as the fitting it now is, not as the one it was.
 *
 * Its connections came from the metadata, because the geometry cannot say which
 * of two connecting pipes is which.
 */
export function readReducer(source, { previous = null, hostExists = () => true } = {}) {
  const settings = settingsOf(metadataOf(source).REDUCER);

  if (!Object.keys(settings).length) {
    return null;
  }

  const coordinates = coordinatesOf(source);

  if (coordinates.length < 4) {
    return null;
  }

  const [startA, endA, startB, endB] = coordinates.slice(0, 4);

  /* The walls both run along the fitting's axis, so the mean of their two ends is its centre. */
  const centre = {
    x: (startA.x + endA.x + startB.x + endB.x) / 4,
    y: (startA.y + endA.y + startB.y + endB.y) / 4
  };

  const wallA = { x: endA.x - startA.x, y: endA.y - startA.y };
  const wallB = { x: endB.x - startB.x, y: endB.y - startB.y };

  const axis = {
    x: (wallA.x / (Math.hypot(wallA.x, wallA.y) || 1) + wallB.x / (Math.hypot(wallB.x, wallB.y) || 1)) / 2,
    y: (wallA.y / (Math.hypot(wallA.x, wallA.y) || 1) + wallB.y / (Math.hypot(wallB.x, wallB.y) || 1)) / 2
  };

  const axisLength = Math.hypot(axis.x, axis.y);

  const startId = settings.start && hostExists(settings.start) ? settings.start : null;
  const endId = settings.end && hostExists(settings.end) ? settings.end : null;

  const ports = String(settings.ports || "end|start").split("|");

  return {
    type: enggReducer.REDUCER_TYPE,
    geometry: {
      position: centre,
      direction: axisLength > 1e-9 ? { x: axis.x / axisLength, y: axis.y / axisLength } : { x: 1, y: 0 }
    },
    engineering: {
      mode: enggReducer.normaliseMode(settings.mode),
      transitionLength: numberOf(settings.length, enggReducer.transitionLengthOf(previous || { engineering: {} })),
      startPipeId: startId,
      endPipeId: endId,
      ports: {
        start: ports[0] === "start" ? "start" : "end",
        end: ports[1] === "end" ? "end" : "start"
      },
      connections: [startId, endId].filter(Boolean)
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/* AN INLINE SYMBOL: a circle or a bow-tie, and the metadata that says what it is. */
export function readEquipment(source, { previous = null, hostExists = () => true } = {}) {
  const settings = settingsOf(metadataOf(source).INLINE);

  if (!Object.keys(settings).length) {
    return null;
  }

  const type = enggEquipment.isEquipmentType(settings.kind) ? settings.kind : previous?.type;

  if (!enggEquipment.isEquipmentType(type)) {
    return null;
  }

  /*
   * THE SYMBOL'S CENTRE AND RADIUS.
   *
   * A circular symbol is written as `(x,y) circle[radius=r]`, so its centre is
   * that point and its radius the stated one. A valve is a bow-tie of two
   * triangles whose centre is the origin of its own frame - the midpoint of the
   * two wedges. Both resolve from the FIRST statement that draws the symbol.
   */
  const coordinates = coordinatesOf(source);
  const radiusMatch = /circle\s*\[\s*radius\s*=\s*([\d.]+)\s*\]/.exec(String(source ?? ""));
  const radius = radiusMatch ? Number(radiusMatch[1]) : numberOf(settings.size, enggEquipment.symbolRadiusOf(previous || {}));

  let centre = previous?.geometry?.position || null;

  if (type === enggEquipment.VALVE_TYPE) {
    const half = radius * enggEquipment.VALVE_HALF_LENGTH_SHARE;
    const apex = coordinates.find((corner) => Math.abs(corner.x) < half * 1.01 && Math.abs(corner.y) < half * 0.01 + 1e-6);

    const tip = coordinates.find((corner) => Math.hypot(corner.x, corner.y) > half * 0.5);

    if (apex && tip) {
      centre = { x: apex.x, y: apex.y };
    } else if (coordinates[0]) {
      centre = coordinates[0];
    }
  } else if (coordinates[0]) {
    centre = coordinates[0];
  }

  if (!centre) {
    return null;
  }

  const pipeIds = String(settings.pipes || "")
    .split("|")
    .map((id) => id.trim())
    .filter((id) => id && hostExists(id));

  return {
    type,
    geometry: {
      position: { x: centre.x, y: centre.y },
      rotation: numberOf(settings.rotation, previous?.geometry?.rotation ?? 0)
    },
    engineering: {
      placement: settings.placement === "inline" ? "inline" : "standalone",
      symbolSize: radius,
      pipeIds,
      ports: previous?.engineering?.ports || { a: null, b: null },
      connections: pipeIds,
      ...(type === enggEquipment.VALVE_TYPE
        ? { depiction: enggEquipment.VALVE_DEPICTIONS.includes(settings.depiction) ? settings.depiction : "generic" }
        : {})
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/* A VESSEL: its outline gives its box, its metadata says open or closed. */
export function readVessel(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).VESSEL);

  const coordinates = coordinatesOf(source);

  if (!coordinates.length) {
    return null;
  }

  const width = numberOf(settings.width, null);
  const height = numberOf(settings.height, null);

  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  /* The top-left corner is the highest and left-most point the outline uses. */
  const minX = Math.min(...coordinates.map((corner) => corner.x));
  const minY = Math.min(...coordinates.map((corner) => corner.y));

  return {
    type: enggVessel.RESERVOIR_TYPE,
    geometry: {
      position: { x: minX, y: minY },
      width,
      height,
      rotation: numberOf(previous?.geometry?.rotation, 0)
    },
    engineering: {
      vesselStyle:
        settings.style === enggVessel.VESSEL_STYLES.closed
          ? enggVessel.VESSEL_STYLES.closed
          : enggVessel.VESSEL_STYLES.open
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/* A LEVEL: it belongs to a vessel, and its height is the fact geometry cannot say. */
export function readFluidLevel(source, { previous = null, hostExists = () => true } = {}) {
  const settings = settingsOf(metadataOf(source).LEVEL);

  const vesselId = String(settings.vessel || "").trim();

  if (!vesselId || !hostExists(vesselId)) {
    return null;
  }

  return {
    type: "fluid-level",
    engineering: {
      vesselId,
      levelPosition: numberOf(settings.level, previous?.engineering?.levelPosition ?? 0)
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/* A FREE ARROW: its two ends, which ARE its geometry. */
export function readFreeFlowArrow(source, { previous = null } = {}) {
  const coordinates = coordinatesOf(source);

  if (coordinates.length < 2) {
    return null;
  }

  /*
   * THE TAIL AND THE TIP CARRY THE HEAD'S CORNERS BETWEEN THEM.
   *
   * The writer emits the shaft first and then the head's three corners, so the
   * tail is the first coordinate and the tip is in the SECOND statement. Picking
   * the tip by its DISTANCE FROM THE TAIL is what keeps a short arrow right: a
   * fixed index would read a barb whenever the head's path came second, and the
   * arrow would come back a fraction of its length.
   */
  const shaft = coordinates[0];

  const farthest = coordinates
    .slice(1)
    .reduce(
      (best, corner) =>
        !best || Math.hypot(corner.x - shaft.x, corner.y - shaft.y) > Math.hypot(best.x - shaft.x, best.y - shaft.y)
          ? corner
          : best,
      null
    );

  const tip = farthest || coordinates[coordinates.length - 1];

  return {
    type: enggFlowArrows.FREE_FLOW_ARROW_TYPE,
    geometry: {
      start: { x: shaft.x, y: shaft.y },
      end: { x: tip.x, y: tip.y }
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/* A DIRECTIONAL ANNOTATION: its pipe and fraction are metadata; its arrows are drawn. */
export function readFlowDirection(source, { previous = null, hostExists = () => true } = {}) {
  const settings = settingsOf(metadataOf(source).DIRECTION);

  const pipeId = String(settings.pipe || "").trim();

  if (!pipeId || !hostExists(pipeId)) {
    return null;
  }

  return {
    type: enggFlowArrows.FLOW_DIRECTION_TYPE,
    engineering: {
      pipeId,
      position: enggFlowArrows.clampDirectionFraction(settings.at),
      reversed: String(settings.dir || "").toLowerCase() === "reverse",
      spacing: String(settings.spacing || "single"),
      arrowSize: numberOf(settings.size, enggFlowArrows.DIRECTION_DEFAULT_FRACTION)
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/*
 * A PRESSURE PROFILE: its limits and units from the metadata, and its FRAME
 * from the axes it draws. The rows are NOT inferred from the plotted line - a
 * plotted point is a drawn position, and a row is a pair of engineering values -
 * so they are stored as the pairs the writer emitted.
 */
export function readPressureProfile(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).PROFILE);

  if (!Object.keys(settings).length) {
    return null;
  }

  const coordinates = coordinatesOf(source);

  if (coordinates.length < 2) {
    return null;
  }

  const [origin, xEnd] = coordinates;

  const plotWidth = Math.abs(xEnd.x - origin.x) || 1;
  const plotHeight = Math.abs(coordinates[1]?.y - origin.y) || 1;

  /* The frame the plot area sits in, from the same inset the model uses. */
  const width = plotWidth / (1 - enggPressureProfile.PLOT_INSET.left - enggPressureProfile.PLOT_INSET.right);
  const height = plotHeight / (1 - enggPressureProfile.PLOT_INSET.top - enggPressureProfile.PLOT_INSET.bottom);

  const position = {
    x: origin.x - width * enggPressureProfile.PLOT_INSET.left,
    y: origin.y - height * enggPressureProfile.PLOT_INSET.bottom
  };

  /*
   * THE STUDENT'S ROWS COME BACK FROM `data=`.
   *
   * `position/pressure` pairs, `;`-separated, exactly as the writer emitted them.
   * An unreadable pair is DROPPED rather than guessed at, and a block written
   * without `data=` keeps the rows it already had - so an edit to the axes or to
   * the frame never silently empties the table.
   */
  const rows = Array.isArray(previous?.engineering?.points)
    ? previous.engineering.points.map((row) => ({ ...row }))
    : [];

  const dataSetting = String(settings.data ?? "").trim();

  const parsedRows = dataSetting
    ? dataSetting
        .split(";")
        .map((pair) => {
          const [position, pressure] = pair.split("/").map((value) => Number(value));

          return Number.isFinite(position) && Number.isFinite(pressure) ? { position, pressure } : null;
        })
        .filter(Boolean)
    : null;

  return {
    type: enggPressureProfile.PRESSURE_PROFILE_TYPE,
    geometry: {
      position,
      width,
      height
    },
    engineering: {
      /* The rows are the student's; an edit to the drawing never invents one. */
      points: parsedRows || rows,
      graphName: String(settings.name ?? previous?.engineering?.graphName ?? ""),
      axes: {
        xMin: numberOf(settings.x, enggPressureProfile.DEFAULT_AXES.xMin),
        xMax: numberOf(settings.xmax, enggPressureProfile.DEFAULT_AXES.xMax),
        yMin: numberOf(settings.y, enggPressureProfile.DEFAULT_AXES.yMin),
        yMax: numberOf(settings.ymax, enggPressureProfile.DEFAULT_AXES.yMax),
        xTitle: settings.xtitle ?? enggPressureProfile.DEFAULT_AXES.xTitle,
        xUnit: settings.xunit ?? enggPressureProfile.DEFAULT_AXES.xUnit,
        yTitle: settings.ytitle ?? enggPressureProfile.DEFAULT_AXES.yTitle,
        yUnit: settings.yunit ?? enggPressureProfile.DEFAULT_AXES.yUnit
      },
      grid: settings.grid !== "off",
      pointsShown: settings.points !== "off"
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/* A SECTION MARK: two ends from its trace, direction and identifier from metadata. */
export function readSectionPlane(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).SECTION);

  const coordinates = coordinatesOf(source);

  if (coordinates.length < 2) {
    return null;
  }

  const [start, end] = coordinates;

  return {
    type: enggSectionPlane.SECTION_PLANE_TYPE,
    geometry: {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y }
    },
    engineering: {
      direction: settings.direction === "reverse" ? "reverse" : "forward",
      identifier: String(settings.identifier || ""),
      showArrows: settings.arrows !== "off"
    },
    style: baseStyleFromSource(source, previous?.style),
    id: previous?.id || null
  };
}

/*
 * WHICH READER ANSWERS A BLOCK - decided by its OWN metadata line, so a block
 * that is edited into another kind of object is read as that kind and the two
 * cannot disagree about what the code means.
 */
export function schematicReaderFor(body) {
  const fields = metadataOf(body);

  if (fields.REDUCER) {
    return readReducer;
  }

  if (fields.INLINE) {
    return readEquipment;
  }

  if (fields.VESSEL) {
    return readVessel;
  }

  if (fields.LEVEL) {
    return readFluidLevel;
  }

  if (fields.PROFILE) {
    return readPressureProfile;
  }

  if (fields.SECTION) {
    return readSectionPlane;
  }

  /* `DIRECTION` is shared with the older Flow Arrow form; `pipe=` tells them apart. */
  if (fields.DIRECTION && /(^|\s)pipe=/.test(fields.DIRECTION)) {
    return readFlowDirection;
  }

  return null;
}

export default {
  SCHEMATIC_FIELDS,
  readReducer,
  readEquipment,
  readVessel,
  readFluidLevel,
  readFreeFlowArrow,
  readFlowDirection,
  readPressureProfile,
  readSectionPlane,
  schematicReaderFor
};
