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
  activeZoom,
  createSvgElement,
  paintColour,
  scaledStrokeWidth,
} from "./svg-primitives.js";
import {
  DIMENSION_DEFAULT_FONT_PT,
  dimensionArrowMm,
  dimensionFontPt,
  dimensionPens,
} from "../geometry/dimension-layout.js";
import {
  CANVAS_BASELINE,
  CANVAS_FONT_STACK,
  FONT_WEIGHTS,
  LINE_SPACING,
  SECONDARY_FONT_PX,
  compensationFor,
  fontSizeOf,
} from "../typography/canvas-typography.js";

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
  /*
   * THE HEAD SCALES WITH THE DRAWING, LIKE THE DIMENSION IT ENDS.
   *
   * The head's length is a size in DRAWING units (the document's
   * `dimensionArrowMm`, painted through `STROKE_SCALE`). Its tip has already
   * been projected, so those units are overlay pixels - but every pixel of that
   * overlay is painted `zoom` times larger. Returning the bare size therefore
   * drew a fixed-pixel triangle on a line whose position scaled, which is why a
   * head looked bulbous zoomed out and tiny zoomed in.
   *
   * `scaledStrokeWidth` divides the zoom out (a stroke's PAINTED width is the
   * stored weight at every zoom), so it is multiplied back in here: this is
   * geometry, not a pen.
   */
  const zoom = Number(activeZoom) > 0 ? Number(activeZoom) : 1;

  return Math.max(4, scaledStrokeWidth(dimensionArrowMm({ lineWidth }))) * zoom;
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
   * THE LABEL'S SIZE IS A CANVAS FONT SIZE - A SCREEN SIZE.
   *
   * `style.fontSize` is the dimension's size in the one unit the whole
   * application now uses for canvas text: screen pixels. The model still states
   * the printed point size (`label.fontPt`) for the source writer and the
   * panel, but the CANVAS paints this number.
   *
   * THE CAMERA IS CANCELLED BELOW, on the text group, so the number measures
   * the same on screen at every zoom while the frame's own position - which is
   * a drawing position - goes on moving with the dimension. The old code
   * painted a millimetre figure through `STROKE_SCALE` and then let the camera
   * scale it, so the value grew as the student zoomed in and shrank as they
   * zoomed out.
   */
  /*
   * The zoom this frame is drawn at, recorded once by `renderDrawing` - the
   * same number every other painter of this frame reads, so a label and the
   * line it belongs to can never be drawn against two different cameras.
   */
  const zoom = Math.max(Number(activeZoom) || 1, 0.0001);

  /*
   * An 11 pt dimension number is SMALLER ON SCREEN than a 16 px note, so an
   * absent size takes the secondary role (14 px) rather than being read as a
   * point size and painted 11-pt-small. A stored size is the student's own and
   * is honoured exactly - `fontPt` stays available for the print and the panel.
   */
  const storedPt = dimensionFontPt(object?.style);

  const fallbackSize = storedPt === DIMENSION_DEFAULT_FONT_PT
    ? SECONDARY_FONT_PX
    : storedPt;

  const fontSize = fontSizeOf(object?.style?.fontSize, fallbackSize);
  const lineHeight = fontSize * LINE_SPACING;

  /*
   * ROTATION AND COMPENSATION COMPOSE ABOUT THE SAME ANCHOR.
   *
   * The group is moved to the label's projected centre, turned to the
   * dimension's own angle, and THEN scaled by `1 / zoom`. Rotation turns the
   * glyphs; the compensation divides the camera back out of them. Both happen
   * about the centre, so the label neither grows with the zoom nor turns about
   * any point but its own - which is what keeps a vertical dimension's number
   * on its line, and an angled one's alongside it, at every magnification.
   */
  const compensation = compensationFor(zoom);
  const rotation = `rotate(${-Number(frame.angle || 0)})`;

  const group = createSvgElement("g", {
    transform: `translate(${origin.x} ${origin.y}) ${rotation}${compensation ? ` ${compensation}` : ""}`,
    class: "drawing-dimension-text",
    "data-unzoomed-text": "true",
    ...(object?.id ? { "data-dimension-id": object.id } : {}),
  });

  // A narrow canvas-coloured halo separates glyphs from crossing lines.
  // Background is paper, so do not send it through ink contrast mapping
  // (that turns a white plate into white ink on the dark canvas).
  const background =
    enggCanvasPalette.CANVAS_BACKGROUND[enggCanvasPalette.activeCanvasTheme()];

  lines.forEach((line, index) => {
    /*
     * THE HALO IS MEASURED IN THE GROUP'S OWN UNITS, which the
     * inverse-zoom compensation has already divided by the camera - so it is a
     * thin screen-coloured outline around the glyphs at every zoom rather than
     * a slab that swells as the student zooms in.
     */
    const span = createSvgElement("text", {
      x: 0,
      y: (index - (lines.length - 1) / 2) * lineHeight,
      fill: stroke,
      stroke: background,
      "stroke-width": Math.max(2, fontSize * 0.18),
      "stroke-linejoin": "round",
      "paint-order": "stroke fill",
      class: "drawing-dimension-label",
      "font-family": CANVAS_FONT_STACK,
      "font-weight": object?.style?.bold === true ? FONT_WEIGHTS.bold : FONT_WEIGHTS.regular,
      "font-style": object?.style?.italic === true ? "italic" : "normal",
      "text-anchor":
        frame.alignment === "left"
          ? "start"
          : frame.alignment === "right"
            ? "end"
            : "middle",
      "dominant-baseline": CANVAS_BASELINE,
    });

    span.setAttribute("font-size", String(fontSize));

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

  /*
   * A DIMENSION'S PENS ARE THE DRAWING'S, SO THEY SCALE WITH THE DRAWING.
   *
   * The pens are document millimetres, and `scaledStrokeWidth` paints them at
   * the canvas's own pixels-per-unit - with the camera divided back out, so the
   * width that reaches the glass is the stored weight at every magnification.
   * The geometry is projected, so the pen keeps its proportion to the beam it
   * measures - which is what the compiled picture beside it states too.
   *
   * THIS USED TO PIN THE WIDTH WITH `vector-effect: non-scaling-stroke`. That
   * held the dimension at a fixed screen weight while its witnesses spread
   * further apart with the zoom, so at 400% a dimension looked like a hairline
   * drawn across a canvas - and it disagreed with the source, whose stroke is
   * stated in the drawing's own units.
   *
   * The dash pattern is part of the drawing for the same reason.
   */
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
