/*
 * ============================================================
 * THE SHARED SKETCH RENDERER
 * ============================================================
 *
 * One painter for sketch geometry, used by the editor's canvas, the placement
 * preview and the main drawing space. If the editor and the sheet could paint
 * the same element differently, the preview would be a promise the placement
 * might not keep - so they share this file instead.
 *
 * WHAT IT DRAWS, AND WHAT IT DOES NOT
 * -----------------------------------
 * It draws GEOMETRY: paths, circles, ellipses, rectangles, arcs and fills, with
 * the model-space appearance that is stored on each element.
 *
 * It does NOT draw editing aids. Anchor markers, guide markers, control
 * handles, selection outlines and the correction preview are the EDITOR's, they
 * live in a layer of their own above the geometry, and nothing here is allowed
 * to reach into them. That separation is what lets "editor aids must not appear
 * in the final drawing" be true by construction: the placement path never calls
 * the code that draws them.
 *
 * ZOOM INDEPENDENCE
 * -----------------
 * Every stroke is painted with `vector-effect: non-scaling-stroke`, so a line
 * thickness is the same on screen at any zoom and the same in the SVG. The
 * stored thickness is never multiplied by the viewport's scale.
 */

import { appearanceCss, isClosed } from "./sketch-appearance.js";
import { adapterFor } from "./sketch-geometry-adapters.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      element.setAttribute(key, String(value));
    }
  });

  return element;
}

function round(value) {
  return Number(value).toFixed(2);
}

/* A model point, as an SVG pixel, through the viewport. */
function px(point, toScreen) {
  const at = toScreen(point);

  return `${round(at.x)} ${round(at.y)}`;
}

/*
 * A PATH THROUGH MODEL POINTS.
 *
 * A curve is drawn through its own cubic segments when it has them, so the ink
 * on screen is the geometry that will be committed - not a polyline that
 * approximates it and would show a polygon where a smooth curve belongs.
 */
export function pathData(element, toScreen) {
  if (element.segments?.length) {
    const [first] = element.segments;

    const parts = [`M ${px(first.from, toScreen)}`];

    element.segments.forEach((segment) => {
      parts.push(
        `C ${px(segment.control1, toScreen)} ${px(segment.control2, toScreen)} ${px(segment.to, toScreen)}`,
      );
    });

    if (isClosed(element)) {
      parts.push("Z");
    }

    return parts.join(" ");
  }

  const points = element.points || [];

  if (!points.length) {
    return "";
  }

  const body = points
    .map((point, index) => `${index ? "L" : "M"} ${px(point, toScreen)}`)
    .join(" ");

  return isClosed(element) ? `${body} Z` : body;
}

/*
 * ONE ELEMENT, AS AN SVG NODE.
 *
 * `themeInk` is the colour the document's DEFAULT follows. A student's picked
 * colour ignores it, which is the appearance module's rule and not a second
 * one invented here.
 */
export function renderElement(
  element,
  /* `modelScale` is pixels per model unit - the viewport's own scale. */
  { toScreen, themeInk = "#000000", fill = null, modelScale = 1 } = {},
) {
  const style = appearanceCss(element.appearance, {
    themeInk,
    resolvedFill: fill,
  });

  const common = {
    stroke: style.stroke,
    "stroke-width": style.strokeWidth,
    "stroke-linecap": style.strokeLinecap,
    "stroke-linejoin": style.strokeLinejoin,
    "stroke-dasharray": style.strokeDasharray,
    "vector-effect": style.vectorEffect,
    fill: style.fill,
    "fill-opacity": style.fill === "none" ? null : style.fillOpacity,
    "data-sketch-geometry": element.id,
  };

  const kind = element.kind;

  if (kind === "circle" && element.centre && element.radius !== null) {
    const centre = toScreen(element.centre);

    return createSvgElement("circle", {
      ...common,
      cx: round(centre.x),
      cy: round(centre.y),
      r: round(element.radius * modelScale),
    });
  }

  if (kind === "ellipse" && element.centre) {
    const centre = toScreen(element.centre);

    /*
     * AN ELLIPSE IS DRAWN FROM ITS OWN TWO RADII, never from the canvas's
     * shape: the viewport has already applied the equal-scale rule, so the ink
     * here is what the geometry is.
     */
    return createSvgElement("ellipse", {
      ...common,
      cx: round(centre.x),
      cy: round(centre.y),
      rx: round(element.radiusX * modelScale),
      ry: round(element.radiusY * modelScale),
      transform: element.rotation
        ? `rotate(${round((element.rotation * 180) / Math.PI)} ${round(centre.x)} ${round(centre.y)})`
        : null,
    });
  }

  if (kind === "arc" && element.centre) {
    const adapter = adapterFor(element);
    const start = toScreen(adapter.pointAt(0));
    const end = toScreen(adapter.pointAt(1));

    const radius = element.radius * modelScale;

    const sweep = adapter.endAngle - adapter.startAngle;
    const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
    const direction = sweep >= 0 ? 1 : 0;

    return createSvgElement("path", {
      ...common,
      d: `M ${round(start.x)} ${round(start.y)} A ${round(radius)} ${round(radius)} 0 ${largeArc} ${direction} ${round(end.x)} ${round(end.y)}`,
    });
  }

  if (kind === "rectangle" && element.corner) {
    const topLeft = toScreen(element.corner);
    const bottomRight = toScreen({
      x: element.corner.x + (element.width || 0),
      y: element.corner.y + (element.height || 0),
    });

    return createSvgElement("rect", {
      ...common,
      x: round(Math.min(topLeft.x, bottomRight.x)),
      y: round(Math.min(topLeft.y, bottomRight.y)),
      width: round(Math.abs(bottomRight.x - topLeft.x)),
      height: round(Math.abs(bottomRight.y - topLeft.y)),
    });
  }

  return createSvgElement("path", {
    ...common,
    d: pathData(element, toScreen),
  });
}

/* A group of elements. */
export function renderGeometry(elements, options = {}) {
  const group = createSvgElement("g", { class: "sketch-geometry" });

  (elements || []).forEach((element) => {
    if (element.visible === false) {
      return;
    }

    const node = renderElement(element, options);

    if (node) {
      group.appendChild(node);
    }
  });

  return group;
}

export default {
  pathData,
  renderElement,
  renderGeometry,
  createSvgElement,
};
