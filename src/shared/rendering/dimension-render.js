/*
 * Dimensions and variable dimensions: their lines, arrowheads and text.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 *
 * EVERYTHING DRAWN HERE COMES FROM THE MODEL'S `graphicsFor`.
 *
 * The model owns the measurement and the construction geometry - witness
 * lines, the dimension line, the arrowheads' places and directions, the arc of
 * an angle and the leader of a radius - and this file only projects those
 * world points into screen space and paints them. That is what makes the
 * canvas and the TikZ writer agree: they read the SAME description, so a
 * dimension that looks right here cannot compile to a different picture.
 *
 * DOCUMENT SPACE SIZES, VIEWPORT TRANSFORM ONLY.
 *
 * A dimension's pens and its type are stated in DOCUMENT units by
 * `dimension-layout.js` - a drawing unit is a millimetre of paper, and a
 * point size is converted once into millimetres of type. This file paints
 * those millimetres through the camera (2.4 px per unit at 100%, the same
 * factor every other stroke and glyph on the sheet uses), so a label and the
 * geometry beside it always scale TOGETHER. Nothing here multiplies a size by
 * the zoom: zoom is a viewport transform, and the stored value is what the
 * export prints.
 */
import enggDimensionModel from "../../features/workspace/model/dimensions/dimension-model.js";
import enggTheme from "../../components/layout/workspace/theme.js";
import enggCanvasPalette from "./canvas-palette.js";
import { frameCenter } from "../geometry/dimension-layout.js";
import {
  createSvgElement,
  paintColour,
  scaledStrokeWidth,
  STROKE_SCALE,
  zoomedFontHere,
} from "./svg-primitives.js";
import {
  dimensionArrowMm,
  dimensionPens,
} from "../geometry/dimension-layout.js";

/*
 * The three weights, as multipliers of the object's own pen. They are exported
 * names so a reader (and a test) can see the hierarchy the source writer also
 * honours; the values themselves live in `dimension-layout.js`, which is the
 * one place a document-space size is decided.
 */
export const DIMENSION_LINE_WEIGHT = 1;
export const DIMENSION_WITNESS_WEIGHT = 0.8;
export const DIMENSION_TEXT_WEIGHT = 1;

/*
 * THE SMALLEST A DIMENSION LABEL IS PAINTED ON SCREEN, in CSS pixels.
 *
 * A viewport floor, not a document size: the stored point size and the printed
 * `\fontsize` are unaffected, and at any zoom above 1 the label's own document
 * size takes over. It exists because 11 pt of paper is under ten pixels at 100%
 * and a dimension a reader cannot read is not a dimension.
 */
export const SCREEN_LABEL_MIN_PX = 15;

/*
 * A DIMENSION ARROWHEAD, in CSS pixels.
 *
 * The head's LENGTH is the document's `dimensionArrowMm` (mm of paper) painted
 * through the same `STROKE_SCALE` the lines use - which, because the canvas
 * draws a millimetre of drawing as `STROKE_SCALE` pixels, means the triangle
 * and the printed `Latex` head are the same size relative to the drawing.
 */
function arrowHeadSize(lineWidth) {
  return Math.max(4, scaledStrokeWidth(dimensionArrowMm({ lineWidth })));
}

/*
 * A DIMENSION ARROWHEAD.
 *
 * Deliberately NOT called appendArrowHead: this file already has
 * a function of that name, declared later and for force arrows,
 * and because both are function declarations inside the same
 * scope the later one wins. Calling the name from here silently
 * invoked the force version, which takes an ANGLE IN RADIANS and a
 * size in a different argument position - so passing a direction
 * vector produced NaN and every dimension arrowhead collapsed.
 */
function appendDimensionArrowHead(svg, tip, pointing, size, fill) {
  /*
   * A direction that is not a direction cannot be pointed
   * along. Skipping leaves the dimension line, which still
   * reads correctly, instead of an invalid polygon that takes
   * the whole drawing's SVG with it.
   */
  if (
    !pointing ||
    !Number.isFinite(pointing.x) ||
    !Number.isFinite(pointing.y) ||
    !tip ||
    !Number.isFinite(tip.x) ||
    !Number.isFinite(tip.y)
  ) {
    return;
  }

  const angle = Math.atan2(pointing.y, pointing.x);

  /*
   * A HEAD IS A SLIM TRIANGLE, not an equilateral blot: the half-angle is set
   * by the document's head WIDTH (0.8 of its length), so the same proportions
   * are used on every dimension and the printed `Latex` head looks like the
   * one on screen.
   */
  const half = Math.atan(0.4);

  svg.appendChild(
    createSvgElement("polygon", {
      points: [
        `${tip.x},${tip.y}`,
        `${tip.x - size * Math.cos(angle - half)},${tip.y - size * Math.sin(angle - half)}`,
        `${tip.x - size * Math.cos(angle + half)},${tip.y - size * Math.sin(angle + half)}`,
      ].join(" "),
      fill,
      stroke: fill,
      "stroke-width": 0.5,
      "stroke-linejoin": "miter",
      "pointer-events": "none",
    }),
  );
}

/*
 * DIMENSION TEXT
 *
 * Placed with the frame the model computed, so a vertical
 * dimension reads bottom-to-top and an angled one follows the
 * line without ever turning upside down. A canvas-coloured glyph halo
 * keeps crossing lines from obscuring the value.
 *
 * THE TEXT IS IN-PAGE TEXT WITH THE DIMENSION'S OWN ID.
 *
 * It carries the dimension's id in `data-dimension-id`, so a click or a
 * double-click on the number can be told apart from one on the line - which is
 * what lets the number be edited IN PLACE while the line stays a move target.
 * There is no plate, no popup and no handle over it.
 */
function appendDimensionText(svg, text, frame, stroke, toScreen, object) {
  if (!text || !frame || !toScreen) {
    return;
  }

  const centre = frameCenter(frame);

  if (!centre) {
    return;
  }

  const origin = toScreen(centre);

  const lines = String(text).split("\n");

  /*
   * THE LABEL'S SIZE, IN THE CANVAS'S OWN PIXELS.
   *
   * The label's TYPE HEIGHT in drawing units is the model's own `fontWorld`
   * (`points / POINTS_PER_MM`) - a millimetre figure - and the canvas paints one
   * drawing unit as `STROKE_SCALE` pixels, the same factor every other stroke
   * uses. That is ONE multiplication of a document length; re-converting the
   * stored POINTS (pt -> mm -> px) painted an 11 pt label at three times its
   * document size, which is what made the number huge.
   *
   * AND THE RESULT HAS A READABLE FLOOR. A label's printed size is a paper
   * figure, and at 100% zoom 11 pt of paper is under ten screen pixels - legible
   * on the page, not on a monitor. The floor is the size a screen glyph needs to
   * be READ; it changes how the number is shown, never what the document stores
   * or what the source prints, and it keeps the label's proportion to the
   * drawing because the drawing's own strokes have the same kind of floor.
   */
  const fontWorld = Number(frame?.fontWorld) || Number(frame?.label?.fontWorld) || 0;

  const fontSize = zoomedFontHere(
    fontWorld > 0
      ? Math.max(SCREEN_LABEL_MIN_PX, fontWorld * STROKE_SCALE)
      : SCREEN_LABEL_MIN_PX,
  );
  const lineHeight = fontSize * 1.15;

  const group = createSvgElement("g", {
    transform: `translate(${origin.x} ${origin.y}) rotate(${-Number(frame.angle || 0)})`,
    class: "drawing-dimension-text",
    ...(object?.id ? { "data-dimension-id": object.id } : {}),
  });

  // A narrow canvas-coloured halo separates glyphs from crossing lines.
  // Background is paper, so do not send it through ink contrast mapping
  // (that turns a white plate into white ink on the dark canvas).
  const background =
    enggCanvasPalette.CANVAS_BACKGROUND[enggCanvasPalette.activeCanvasTheme()];

  lines.forEach((line, index) => {
    const span = createSvgElement("text", {
      x: 0,
      y: (index - (lines.length - 1) / 2) * lineHeight,
      fill: stroke,
      stroke: background,
      "stroke-width": Math.max(2, fontSize * 0.18),
      "stroke-linejoin": "round",
      "paint-order": "stroke fill",
      class: "drawing-dimension-label",
      "font-size": fontSize,
      "font-family": "Arial, sans-serif",
      "font-weight": object?.style?.bold === true ? "bold" : "normal",
      "font-style": object?.style?.italic === true ? "italic" : "normal",
      "text-anchor":
        frame.alignment === "left"
          ? "start"
          : frame.alignment === "right"
            ? "end"
            : "middle",
      "dominant-baseline": "middle",
    });

    span.textContent = line;
    group.appendChild(span);
  });

  svg.appendChild(group);
}

/*
 * A DIMENSION, drawn as a dimension.
 *
 * The geometry comes from the model's graphicsFor, which is where the
 * measurement, the offset chosen by the student and the arrowhead convention
 * all live. This function only converts those world points to screen and draws
 * them.
 *
 * Nothing here is an ordinary Line feature: the witness lines belong to this
 * dimension for as long as the dimension exists, are regenerated whenever it is
 * drawn, and cannot be picked on their own.
 */
function appendDimensionEntity(svg, entity, state, toScreen, style) {
  const model = enggDimensionModel;

  if (!model) {
    return;
  }

  const graphics = model.graphicsFor(entity, state);

  if (!graphics) {
    return;
  }

  /*
   * A DIMENSION IS AN ANNOTATION WITH ONE APPEARANCE.
   *
   * Driving and Driven dimensions share the same visual treatment: each uses its
   * own stroke colour, like every other annotation on the sheet.
   *
   * WHAT THIS PASS PAINTS AT IS THE DOCUMENT'S OWN GATE. Pens and heads are
   * painted from the document's millimetres, as they always were; a label below
   * `SCREEN_LABEL_MIN_PX` is shown at that readable floor. That is where the
   * change ends - no stored size, no point value and no exported source is
   * touched by how large a glyph has to be to read on a monitor.
   */
  const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

  /*
   * THE PENS COME FROM THE DOCUMENT, not from a pixel figure. `dimensionPens`
   * answers millimetres of paper; `scaledStrokeWidth` paints them at the
   * canvas's own pixels-per-unit, exactly as every other stroke on the sheet
   * is painted.
   */
  const pens = dimensionPens(style);

  const lineWidth = scaledStrokeWidth(pens.line);
  const witnessWidth = scaledStrokeWidth(pens.witness);

  const head = arrowHeadSize(style.lineWidth);

  const drawLine = (from, to, { dashed = false, width = lineWidth } = {}) => {
    const a = toScreen(from);
    const b = toScreen(to);

    svg.appendChild(
      createSvgElement("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke,
        "stroke-width": width,
        "stroke-linecap": "butt",
        ...(dashed
          ? {
              "stroke-dasharray": `${Math.max(3, witnessWidth * 4)} ${Math.max(2, witnessWidth * 3)}`,
            }
          : {}),
      }),
    );
  };

  const drawArrowheads = () => {
    (graphics.arrowheads || []).forEach((arrow) => {
      if (!arrow?.at || !arrow.direction) {
        return;
      }

      const at = toScreen(arrow.at);

      appendDimensionArrowHead(svg, at, arrow.direction, head, stroke);
    });
  };

  /*
   * WITNESS (EXTENSION) LINES
   *
   * Drawn lighter and dashed, from the measured point out past the dimension
   * line. Their stand-off and overshoot are the model's - the same numbers the
   * TikZ source writes - so the canvas is not stopping them somewhere else.
   */
  (graphics.extensions || []).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 2 || !pair[0] || !pair[1]) {
      return;
    }

    drawLine(pair[0], pair[1], {
      dashed: true,
      width: witnessWidth,
    });
  });

  /*
   * AN ARC LENGTH OR AN ANGLE, DRAWN ALONG ITS ARC.
   *
   * The model supplies the concentric arc (following the feature's own sweep),
   * the two radii out to its ends, and an arrowhead at each end lying along the
   * tangent. An angular dimension's arc is the same construction; a right angle
   * is drawn as the model's square marker.
   */
  if (graphics.kind === "arc-length" || graphics.kind === "angular") {
    const arc = (graphics.arc || []).filter(
      (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y),
    );

    if (arc.length >= 2) {
      const polyline = (points, width) =>
        svg.appendChild(
          createSvgElement("polyline", {
            class:
              graphics.kind === "angular"
                ? graphics.rightAngle
                  ? "drawing-right-angle-marker"
                  : "drawing-angle-arc"
                : "drawing-arc-length",
            points: points
              .map((point) => {
                const p = toScreen(point);
                return `${p.x},${p.y}`;
              })
              .join(" "),
            fill: "none",
            stroke,
            "stroke-width": width,
            "stroke-linecap": "butt",
          }),
        );

      polyline(arc, lineWidth);

      /*
       * The radial line of a right-angle marker joins the arc's two ends, and
       * its legs already run along the two measured directions.
       */
    }

    drawArrowheads();

    appendDimensionText(
      svg,
      graphics.text,
      graphics.textFrame,
      stroke,
      toScreen,
      entity,
    );

    return;
  }

  if (Array.isArray(graphics.line) && graphics.line.length === 2) {
    drawLine(graphics.line[0], graphics.line[1]);
  }

  drawArrowheads();

  if (graphics.leader?.from && graphics.leader?.to) {
    drawLine(graphics.leader.from, graphics.leader.to, {
      width: witnessWidth,
    });
  }

  appendDimensionText(
    svg,
    graphics.text,
    graphics.textFrame,
    stroke,
    toScreen,
    entity,
  );
}

/*
 * THE THREE WEIGHTS ARE `export const` ABOVE, so they are already part of this
 * module's exports - naming them again here is a duplicate export, which is a
 * SyntaxError in an ES module and stops the whole application loading.
 */
export {
  arrowHeadSize,
  appendDimensionArrowHead,
  appendDimensionText,
  appendDimensionEntity,
};
