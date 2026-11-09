/*
 * ============================================================
 * THE MATH / ANALYSIS READERS
 * ============================================================
 *
 * The reader half of the Math writer. A block written by `source-writers/math.js`
 * carries one `% DAETUM MATH: kind=... ...` line naming what it is and the facts
 * its geometry cannot state - a curve's expression, a graph's limits, a
 * construction's type and mode. This module reads that line back and rebuilds
 * the object's model.
 *
 * A BLOCK WHOSE METADATA IS MISSING OR UNREADABLE IS DECLINED (null), never
 * guessed at - the block then keeps its last valid form, exactly as any other
 * unsupported edit does. That is what stops a hand-edited coordinate from
 * silently turning a graph into a rectangle.
 *
 * THE GEOMETRY IS READ FROM THE METADATA, NOT FROM THE COMMANDS. A graph's box,
 * a vector's ends and a triangle's positions are all written as numbers on the
 * metadata line, so a retyped value is read exactly as typed - and the commands
 * below it are the picture, not a second source of truth.
 */

import enggMathModel from "../../../../features/workspace/math/math-model.js";

/* One metadata line, as `{ field, value }` - or null when it is not one. */
const METADATA = /^[ \t]*%[ \t]*DAETUM[ \t]+([A-Z]+)[ \t]*:[ \t]*(.*?)[ \t]*$/;

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

function numberOf(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function flagOf(value, fallback = false) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();

  if (text === "on" || text === "true") {
    return true;
  }

  if (text === "off" || text === "false") {
    return false;
  }

  return fallback;
}

/* The style a block's options state, mapped back to the model's own words. */
function styleFromSource(source, previous = {}) {
  const style = { ...(previous || {}) };

  const definitions = new Map();

  String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const rgb =
        /^[ \t]*\\definecolor\{([^}]*)\}\{RGB\}\{(\d+),(\d+),(\d+)\}/.exec(
          line,
        );

      if (rgb) {
        const hex = [rgb[2], rgb[3], rgb[4]]
          .map((channel) =>
            Math.max(0, Math.min(255, Number(channel)))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");

        definitions.set(rgb[1].trim(), `#${hex}`.toLowerCase());
      }
    });

  const optionLists = [
    ...String(source ?? "").matchAll(
      /\\(?:draw|fill|filldraw)\s*\[([^\]]*)\]/g,
    ),
  ].map((match) => match[1]);

  /*
   * THE LAST STYLE THE BLOCK APPLIES IS THE OBJECT'S OWN.
   *
   * The writer emits the box, the grid and the axes before it emits anything the
   * object IS, so the object's stroke and line type are the LAST `\draw` options
   * in its block. Reading all of them into one style - which is what this used to
   * do - took the GRID's `dashed` for the object's line type, and every save then
   * wrote an object that was one shade more dashed than the one before it: the
   * round trip drifted by itself.
   *
   * `styleOf` in the writer builds each command's options as `[object options,
   * ...own additions]`, so the object's options are that list's PREFIX - which is
   * what `styleOptions` reads back. Here, the first list is the object's own when
   * the block has one; the rest only contribute colour, which is harmless because
   * they share it.
   */
  const ownList = optionLists[optionLists.length - 1] || "";

  const readOptions = (list, into) => {
    list.split(",").forEach((option) => {
      const [rawKey, rawValue] = option.split("=").map((part) => part.trim());
      const key = rawKey.replace(/\s+/g, " ").toLowerCase();

      if (key === "dashed") {
        into.lineType = "dashed";
      } else if (key === "dotted") {
        into.lineType = "dotted";
      } else if (key === "solid") {
        into.lineType = "solid";
      } else if (key === "draw" || key === "color") {
        const value = String(rawValue || "").trim();
        const named = definitions.get(value);

        if (named) {
          into.stroke = named;
        } else if (/^black$/i.test(value)) {
          into.stroke = "#000000";
        }
      }
    });
  };

  /* Colour from every list - a block states one colour and its parts reuse it. */
  optionLists.forEach((list) => readOptions(list, style));

  /*
   * LINE TYPE FROM THE LAST LIST ONLY, because that is the object's own. A
   * block whose last list states no dash is a SOLID object, whatever its grid
   * was drawn with - so that is what `previous` carried, restated.
   */
  const lineTypeOnly = {};

  readOptions(ownList, lineTypeOnly);

  style.lineType = lineTypeOnly.lineType || "solid";

  return style;
}

/* `"1:2 3:4"` -> `[{ x: 1, y: 2 }, { x: 3, y: 4 }]`, dropping what cannot be read. */
function pointsListOf(value) {
  return String(value ?? "")
    .split(/\s+/)
    .map((entry) => entry.split(":").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => ({ id: "", x, y }));
}

/* A written number, when it is a positive length - otherwise null. */
function positiveOrNull(value) {
  const number = numberOf(value, null);

  return number !== null && number > 0 ? number : null;
}

/*
 * WHETHER A BEZIER CHAIN ACTUALLY CURVES.
 *
 * Every control point of a real curve sits off its own chord; the control points
 * of a straight segment's collinear chain sit exactly on it. The test is a share
 * of the chord's length, so it is about shape rather than about units.
 */
function bendsAwayFromChord(segments) {
  if (!Array.isArray(segments) || !segments.length) {
    return false;
  }

  const first = segments[0].from;
  const last = segments[segments.length - 1].to;

  const chord = Math.hypot(last.x - first.x, last.y - first.y);

  if (!(chord > 1e-9)) {
    return true;
  }

  const offset = (point) =>
    Math.abs(
      ((point.x - first.x) * (last.y - first.y) -
        (point.y - first.y) * (last.x - first.x)) /
        chord,
    );

  return segments.some(
    (segment) =>
      offset(segment.control1) > chord * 1e-4 ||
      offset(segment.control2) > chord * 1e-4,
  );
}

/*
 * `"x,y,c1x,c1y,c2x,c2y,x,y ..."` -> the Bezier chain a sketch records, in the
 * object's own graph coordinates. A set that does not read as eight numbers is
 * dropped rather than guessed at.
 */
function splineSegmentsOf(value, graph) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .map((entry) => entry.split(",").map(Number))
    .filter((numbers) => numbers.length === 8 && numbers.every(Number.isFinite))
    .map((numbers) =>
      enggMathModel.graphSegment(
        { geometry: graph.geometry },
        {
          from: { x: numbers[0], y: numbers[1] },
          control1: { x: numbers[2], y: numbers[3] },
          control2: { x: numbers[4], y: numbers[5] },
          to: { x: numbers[6], y: numbers[7] },
        },
      ),
    )
    .filter(Boolean);
}

/* A chain's own vertices, as a sketched component stores them. */
function splinePointsOf(segments) {
  return [
    { x: segments[0].from.x, y: segments[0].from.y },
    ...segments.map((segment) => ({ x: segment.to.x, y: segment.to.y })),
  ];
}

/* `"x:y x:y|x:y"` -> the strokes a sketch records, digitised from their own text. */
function curveStrokesOf(value) {
  return String(value ?? "")
    .split("|")
    .map((run) =>
      run
        .trim()
        .split(/\s+/)
        .map((entry) => entry.split(":").map(Number))
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        .map(([x, y]) => ({ x, y })),
    )
    .filter((run) => run.length > 1);
}

/*
 * A CURVE'S SAMPLES AS THE VERTICES A FIT SHOULD KNOW.
 *
 * A written sketch curve is DIGITISED - every drawn sample is stated, so the
 * restored curve is pixel-identical - but a Bezier chain through every sample
 * is a chain of tiny, noisy segments. The spline is built through the curve's
 * VERTICES instead: the same samples, reduced to the points that carry its
 * shape by the same simplifier the editor uses.
 */
function verticesOf(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return Array.isArray(points) ? points : [];
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1e-9,
  );

  const simplified = enggMathModel.simplifyStroke(
    points,
    Math.max(span * 0.004, 1e-6),
  );

  return simplified.length > 1 ? simplified : points;
}



/* ============================================================
 * THE READERS
 * ============================================================ */

function readPoint(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x = numberOf(settings.x, null);
  const y = numberOf(settings.y, null);

  if (x === null || y === null) {
    return null;
  }

  return {
    type: enggMathModel.MATH_POINT_TYPE,
    geometry: {
      position: { x, y },
      labelOffset: previous?.geometry?.labelOffset || null,
      parentGraphId: settings.graph || null,
      parentCurveId: settings.curve || null,
      curveParameter: previous?.geometry?.curveParameter ?? null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_POINT_TYPE,
      labelMode: ["name", "coordinates", "custom"].includes(settings.label)
        ? settings.label
        : "name",
      labelText: previous?.engineering?.labelText || "",
      showXProjection: flagOf(settings.xproj, false),
      showYProjection: flagOf(settings.yproj, false),
      showCoordinates: previous?.engineering?.showCoordinates !== false,
      snapMode: previous?.engineering?.snapMode || "auto",
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

function readVector(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x1 = numberOf(settings.x1, null);
  const y1 = numberOf(settings.y1, null);
  const x2 = numberOf(settings.x2, null);
  const y2 = numberOf(settings.y2, null);

  if ([x1, y1, x2, y2].some((value) => value === null)) {
    return null;
  }

  return {
    type: enggMathModel.MATH_VECTOR_TYPE,
    geometry: {
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      labelOffset: previous?.geometry?.labelOffset || null,
      parentGraphId: settings.graph || null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_VECTOR_TYPE,
      showComponents: flagOf(settings.components, false),
      showProjectionGuides: flagOf(settings.guides, false),
      showComponentLabels: previous?.engineering?.showComponentLabels === true,
      showMagnitude: previous?.engineering?.showMagnitude === true,
      showDirection: previous?.engineering?.showDirection === true,
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/*
 * A PLOT: ITS BOX, ITS COORDINATE SETTINGS, AND ITS FUNCTIONS.
 *
 * The box and the settings come from the `% DAETUM MATH:` line; the functions
 * come from the `% DAETUM FUNCTION:` lines that follow it, one per component.
 * A function whose expression the evaluator cannot read is DROPPED rather than
 * stored - it would draw nothing, and keeping it would leave the panel
 * claiming a curve the sheet does not show.
 */
function readPlot(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x = numberOf(settings.x, null);
  const y = numberOf(settings.y, null);
  const w = numberOf(settings.w, null);
  const h = numberOf(settings.h, null);

  if ([x, y, w, h].some((value) => value === null) || !(w > 0) || !(h > 0)) {
    return null;
  }

  /*
   * THE COORDINATE SETTINGS ARE RESOLVED FIRST, because a written path has to
   * be turned back from drawing units into the graph coordinates the object
   * stores - through the very mapping the canvas draws with.
   */
  /* A written limit is read back only when it IS a finite number. */
  const limitOf = (key, fallback) => {
    const value = numberOf(settings[key], null);

    return value === null ? fallback : value;
  };

  const geometry = {
    position: { x, y },
    width: w,
    height: h,
    xMin: limitOf("xmin", enggMathModel.DEFAULT_GRAPH_LIMITS.xMin),
    xMax: limitOf("xmax", enggMathModel.DEFAULT_GRAPH_LIMITS.xMax),
    yMin: limitOf("ymin", enggMathModel.DEFAULT_GRAPH_LIMITS.yMin),
    yMax: limitOf("ymax", enggMathModel.DEFAULT_GRAPH_LIMITS.yMax),
    /*
     * A SPACING IS A POSITIVE LENGTH OR IT IS UNSET. `0` cannot be a grid step,
     * so reading it back as one would divide by it - it is read as "not set".
     */
    xTickSpacing: positiveOrNull(settings.xtick),
    yTickSpacing: positiveOrNull(settings.ytick),
    gridDivisions: Math.max(
      1,
      Math.min(10, Math.round(numberOf(settings.griddiv, 1) || 1)),
    ),
    showXAxis: previous?.geometry?.showXAxis !== false,
    showYAxis: previous?.geometry?.showYAxis !== false,
    showGrid: flagOf(settings.grid, true),
    showMinorGrid: previous?.geometry?.showMinorGrid === true,
    showTickLabels: previous?.geometry?.showTickLabels !== false,
    xLabel: previous?.geometry?.xLabel ?? "x",
    yLabel: previous?.geometry?.yLabel ?? "y",
    equalUnits: flagOf(settings.equal, true),
    mode: settings.mode === "sketch" ? "sketch" : "plot",
    /*
     * WHERE THE RANGE CAME FROM, read back so a reopened graph is the one that
     * was saved: an automatic graph follows its geometry again, a manual one
     * keeps the numbers beside it.
     */
    boundsMode: settings.bounds === "manual" ? "manual" : "auto",
    manualBounds:
      settings.bounds === "manual"
        ? {
            xMin: limitOf("xmin", enggMathModel.DEFAULT_GRAPH_LIMITS.xMin),
            xMax: limitOf("xmax", enggMathModel.DEFAULT_GRAPH_LIMITS.xMax),
            yMin: limitOf("ymin", enggMathModel.DEFAULT_GRAPH_LIMITS.yMin),
            yMax: limitOf("ymax", enggMathModel.DEFAULT_GRAPH_LIMITS.yMax),
          }
        : null,
  };

  return {
    type: enggMathModel.MATH_PLOT_TYPE,
    geometry: {
      ...geometry,
      /*
       * THE STUDENT'S OWN POINTS, read back from their own field. A malformed
       * entry is dropped rather than guessed at - a point at a made-up
       * coordinate would be geometry the student never placed.
       */
      points: pointsListOf(settings.points),
      functions: functionsOf(source, previous, geometry),
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_PLOT_TYPE,
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
    /*
     * THE GRAPH'S NAME TRAVELS WITH IT. Without it a reopened object was called
     * "Math Plot" even where the student's own graph said "Graph", and a write,
     * a read and a second write disagreed about the name.
     */
    ...(typeof previous?.name === "string" && previous.name
      ? { name: previous.name }
      : {}),
  };
}

/*
 * THE FUNCTIONS A PLOT BLOCK DECLARES.
 *
 * Each `% DAETUM FUNCTION:` line is one component. A line whose expression is
 * unreadable is skipped, and a component the previous object already had keeps
 * its reconstructed geometry - so a hand-edited expression does not throw away
 * the curve the student drew.
 */
function functionsOf(source, previous, plotGeometry = null) {
  const lines = String(source ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^[ \t]*%[ \t]*DAETUM[ \t]+FUNCTION[ \t]*:/i.test(line));

  const before = enggMathModel.plotFunctions(previous);

  return lines
    .map((line) => {
      const settings = settingsOf(line.replace(/^[^:]*:/, ""));

      const id = String(settings.id || "").trim();

      if (!id) {
        return null;
      }

      const mode = settings.mode === "sketch" ? "sketch" : "plot";
      const expression = String(settings.expression ?? "").trim();

      if (mode === "plot" && (!expression || !enggMathModel.curveExpressionValid(expression))) {
        return null;
      }

      const [min, max] = String(settings.domain || "")
        .split(":")
        .map(Number);

      const existing = before.find((component) => component.id === id);

      /*
       * A SKETCHED CURVE IS REBUILT FROM ITS WRITTEN GEOMETRY, not from the
       * object the editor happens to still hold - otherwise a reopened drawing
       * on another machine would lose every curve. The previous object's copy
       * is the fallback, for a block saved before the geometry was written out.
       */
      /*
       * EACH FIELD IS IN THE UNITS IT WAS WRITTEN IN - and they are not all the
       * same.
       *
       * `curve=` is the component's own `points`, which are GRAPH coordinates, so
       * it is read directly. `trace=` and `spline=` are DRAWING units, because the
       * writer maps them through the plot's own mapping - so those two are
       * converted back. Reading `curve=` through the mapping as well would apply
       * it TWICE, which is exactly the kind of quiet drift that moves a saved
       * curve every time it is reopened.
       */
      const reader = { geometry: plotGeometry || {} };
      const written = curveStrokesOf(settings.curve);
      /*
       * THE ORIGINAL TRACE IS KEPT VERBATIM.
       *
       * `trace=` is what the student drew, so a dot or a two-point trace is a
       * legitimate value - and a trace that went through `curveStrokesOf` (which
       * drops runs shorter than two points) would come back empty and be
       * silently lost on the next save. It is a diagnostic, not geometry, so it
       * is read as the exactly-ordered points it was written as.
       */
      const writtenTrace = pointsListOf(settings.trace).map((at) =>
        enggMathModel.drawingPointToGraph(reader, at),
      );

      /*
       * THE WRITTEN SPLINE, when there is one, IS THE CURVE. It states every
       * control point, so the curve comes back exactly - including a peak a
       * vertex list can lose to simplification. A block written before the
       * spline existed falls back to its vertices, which is still the student's
       * own geometry.
       */
      const writtenSpline = splineSegmentsOf(settings.spline, reader);

      /*
       * A SPLINE THAT DOES NOT BEND IS A LINE, and a straight sketched segment
       * must come back straight.
       *
       * A written spline for a two-point line is collinear by construction - a
       * pair of Bezier halves across a chord - and restoring it as a curve would
       * turn the student's clean segment into a spline on the next save. So a
       * chain whose control points all sit on the chord is dropped, and the
       * vertices are used instead.
       */
      const curvedSpline = bendsAwayFromChord(writtenSpline)
        ? writtenSpline
        : [];

      const points =
        mode === "sketch" && curvedSpline.length
          ? splinePointsOf(curvedSpline)
          : mode === "sketch" && written.length && written[0].length
            ? written[0]
            : existing?.points || [];

      const vertices = mode === "sketch" ? verticesOf(points) : points;

      return {
        id,
        mode,
        expression,
        variable: settings.variable || "x",
        domain: {
          min: Number.isFinite(min) ? min : enggMathModel.DEFAULT_DOMAIN.min,
          max: Number.isFinite(max) ? max : enggMathModel.DEFAULT_DOMAIN.max,
        },
        visible: settings.visible !== "off",
        style: existing?.style || null,
        points,
        segments:
          mode === "sketch" && curvedSpline.length
            ? curvedSpline
            : mode === "sketch" && written.length
              ? vertices.length > 1
                ? enggMathModel.fitCubicBeziers(vertices)
                : []
              : existing?.segments || [],
        originalTrace:
          mode === "sketch" && writtenTrace.length
            ? writtenTrace
            : existing?.originalTrace || [],
        correction:
          mode === "sketch" && settings.shape
            ? { kind: settings.shape }
            : existing?.correction || null,
        showOriginalTrace: existing?.showOriginalTrace === true,
        smoothing: Number(existing?.smoothing) || 0,
        fitType: ["none", "linear", "quadratic", "cubic"].includes(settings.fit)
          ? settings.fit
          : "none",
        fitExpression: String(settings.fitExpression ?? ""),
        showFitExpression: existing?.showFitExpression === true,
      };
    })
    .filter(Boolean);
}

/* The coordinates of every `( x , y )` in the source, in drawing coordinates. */
function coordinatesOf(source) {
  return [
    ...String(source ?? "").matchAll(
      /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g,
    ),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

function readEquation(source, { previous = null } = {}) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x = numberOf(settings.x, null);
  const y = numberOf(settings.y, null);

  if (x === null || y === null) {
    return null;
  }

  /*
   * THE CONTENT IS THE NODE'S OWN TEXT, read from the `\node ... { ... }` the
   * writer emitted - so a retyped equation is the equation.
   */
  const content = nodeContentOf(source);

  if (!content) {
    return null;
  }

  return {
    type: enggMathModel.MATH_EQUATION_TYPE,
    geometry: {
      position: { x, y },
      rotation: Number(previous?.geometry?.rotation) || 0,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_EQUATION_TYPE,
      content,
      fontSize: numberOf(settings.size, 16),
      align: ["left", "center", "right"].includes(settings.align)
        ? settings.align
        : "center",
      verticalAlign: previous?.engineering?.verticalAlign || "middle",
      displayMode: settings.display === "inline" ? "inline" : "display",
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/* The text inside a node's braces, with the maths delimiters removed. */
function nodeContentOf(source) {
  const match =
    /\\node(?:\[[^\]]*\])?\s*at\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;/.exec(
      String(source ?? ""),
    );

  if (!match) {
    return "";
  }

  return match[1]
    .replace(/\s*\\\\\s*/g, "\n")
    .replace(/\$/g, "")
    .trim();
}

function readTangent(
  source,
  { previous = null, hostExists = () => true } = {},
) {
  const settings = settingsOf(metadataOf(source).MATH);

  const cx = numberOf(settings.cx, null);
  const cy = numberOf(settings.cy, null);

  if (cx === null || cy === null) {
    return null;
  }

  const curveId = String(settings.curve || "").trim();

  if (curveId && !hostExists(curveId)) {
    return null;
  }

  const coordinates = coordinatesOf(source);

  if (coordinates.length < 2) {
    return null;
  }

  const [start, end] = coordinates;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  return {
    type: enggMathModel.MATH_TANGENT_TYPE,
    geometry: {
      contact: { x: cx, y: cy },
      start,
      end,
      direction: length > 1e-9 ? { x: dx / length, y: dy / length } : null,
      length: numberOf(
        settings.length,
        length || enggMathModel.DEFAULT_CONSTRUCTION_LENGTH,
      ),
      parentCurveId: curveId || null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_TANGENT_TYPE,
      constructionType: settings.type === "normal" ? "normal" : "tangent",
      mode: settings.mode === "plot" ? "plot" : "sketch",
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

function readSlopeTriangle(
  source,
  { previous = null, hostExists = () => true } = {},
) {
  const settings = settingsOf(metadataOf(source).MATH);

  const x1 = numberOf(settings.x1, null);
  const y1 = numberOf(settings.y1, null);
  const x2 = numberOf(settings.x2, null);
  const y2 = numberOf(settings.y2, null);

  if ([x1, y1, x2, y2].some((value) => value === null)) {
    return null;
  }

  const lineId = String(settings.line || "").trim();

  if (lineId && !hostExists(lineId)) {
    return null;
  }

  return {
    type: enggMathModel.MATH_SLOPE_TRIANGLE_TYPE,
    geometry: {
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      corner: { x: x2, y: y1 },
      parentLineId: lineId || null,
      labelOffset: previous?.geometry?.labelOffset || null,
    },
    engineering: {
      discipline: "math",
      mathType: enggMathModel.MATH_SLOPE_TRIANGLE_TYPE,
      mode: settings.mode === "plot" ? "plot" : "sketch",
      showRise: flagOf(settings.rise, true),
      showRun: flagOf(settings.run, true),
      showSlope: flagOf(settings.slope, false),
      showRightAngle: previous?.engineering?.showRightAngle !== false,
    },
    style: styleFromSource(source, previous?.style),
    id: previous?.id || null,
  };
}

/* ============================================================
 * WHICH READER ANSWERS A BLOCK
 * ============================================================
 *
 * Decided by the block's own `kind=` field, so a block edited into another kind
 * of Math object is read as that kind and the two cannot disagree about what
 * the code means.
 */
export function mathReaderFor(source) {
  const settings = settingsOf(metadataOf(source).MATH);

  switch (settings.kind) {
    case "point":
      return readPoint;
    case "vector":
      return readVector;
    case "plot":
      return readPlot;
    case "equation":
      return readEquation;
    case "tangent":
      return readTangent;
    case "slope-triangle":
      return readSlopeTriangle;
    default:
      return null;
  }
}

/* Whether a block is a Math block at all. */
export function isMathBlock(source) {
  return /^[ \t]*%[ \t]*DAETUM[ \t]+MATH[ \t]*:/m.test(String(source ?? ""));
}

export default {
  mathReaderFor,
  isMathBlock,
};
