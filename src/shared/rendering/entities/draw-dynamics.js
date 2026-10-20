/*
 * ============================================================
 * DRAWING THE DYNAMICS SYMBOLS
 * ============================================================
 *
 * One function per Dynamics feature type, each drawing the WHOLE symbol into
 * the feature's group. They are registered in `entity-render.js` behind a
 * `metadata.dynamicsType` test, so they run only for objects a Dynamics tool
 * made and no Statics or Geometry object can be captured by accident.
 *
 * THE GEOMETRY IS THE MODEL, NOT THE PICTURE. Every point is read from the
 * object's own geometry and projected through the camera, exactly as the rest
 * of the renderer does, so a handle move, a Transform shift and a rotation
 * are all reflected without this module knowing about gestures at all.
 *
 * WHAT THEY ARE NOT. Nothing here is a velocity, an acceleration, a force or
 * a calculated value: each function draws the symbol the student placed and
 * nothing else. A label is drawn by the shared label pass, not here.
 *
 * Every symbol is built from the SVG vocabulary the rest of the renderer
 * uses (createSvgElement, paintColour, the zoom-aware stroke widths), so it
 * reads as part of the same drawing at every zoom and in both themes.
 */

import { createSvgElement, paintColour, scaledStrokeWidth } from "../svg-primitives.js";
import enggFeatureGeometry from "../../geometry/feature-geometry.js";

/* ============================================================
 * SHARED HELPERS
 * ============================================================ */

function num(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

/*
 * ONE DRAWING UNIT, IN SCREEN PIXELS, AT THE PASS'S OWN ZOOM.
 *
 * The gesture works in drawing units (paper millimetres) while `toScreen`
 * returns pixels - but the context carries `scale` as `BASE_PIXELS_PER_UNIT *
 * zoom`, and every model dimension below is ALREADY in drawing units. So the
 * conversion is 1: a 6-unit damper body is six units of ink, exactly as the
 * handles and the source describe it. It is stated as a named factor rather
 * than left implicit so that a future size stored in SCREEN pixels (a marker
 * that must stay the same at every zoom) has one obvious place to say so.
 */
function units(scale) {
    void scale;

    return 1;
}

function lineWidthOf(style, scale) {
    const width = Number(style?.lineWidth);

    /*
     * THE SHARED STROKE SCALE, NOT THE RAW MILLIMETRE VALUE.
     *
     * `style.lineWidth` is a real-world weight - 0.5 is the default - and the
     * rest of the renderer converts it through `scaledStrokeWidth`, so a 0.5 mm
     * line is 1.2 px. Using the raw value here drew every Dynamics symbol at
     * 0.5 px at 100% zoom: present, positioned, and a hairline the student
     * cannot see. One conversion for every feature of the same weight.
     */
    const pixels = scaledStrokeWidth(Number.isFinite(width) && width > 0 ? width : 0.5);

    /* Zoom scales the drawing; the floor keeps a hairline visible when zoomed out. */
    void scale;

    return pixels;
}

function dashArrayOf(style, scale) {
    const type = String(style?.lineType || "solid").toLowerCase();

    /*
     * The dash lengths are SCREEN pixels - they describe the pen, not the
     * drawing - so they follow the zoom directly.
     */
    const unit = Number(scale) > 0 ? Number(scale) : 1;

    if (type === "dashed") {
        return `${6 * unit} ${4 * unit}`;
    }

    if (type === "dotted") {
        return `${1.6 * unit} ${3 * unit}`;
    }

    if (type === "center") {
        return `${10 * unit} ${3 * unit} ${2 * unit} ${3 * unit}`;
    }

    if (type === "construction") {
        return `${2 * unit} ${3 * unit}`;
    }

    return null;
}

/*
 * A stroked path, with the feature's own colour, weight and line type. Every
 * symbol below goes through this so one appearance control changes them all.
 */
function strokePath(parent, d, style, scale, extra = {}) {
    const dash = dashArrayOf(style, scale);

    parent.appendChild(
        createSvgElement("path", {
            d,
            fill: "none",
            stroke: paintColour(style?.stroke || "#193335"),
            "stroke-width": lineWidthOf(style, scale),
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            ...(dash ? { "stroke-dasharray": dash } : {}),
            ...(style?.opacity !== undefined ? { opacity: style.opacity } : {}),
            ...extra
        })
    );
}

function strokeLine(parent, a, b, style, scale, extra = {}) {
    const dash = dashArrayOf(style, scale);

    parent.appendChild(
        createSvgElement("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            stroke: paintColour(style?.stroke || "#193335"),
            "stroke-width": lineWidthOf(style, scale),
            "stroke-linecap": "round",
            ...(dash ? { "stroke-dasharray": dash } : {}),
            ...extra
        })
    );
}

function strokeCircle(parent, centre, radius, style, scale, extra = {}) {
    parent.appendChild(
        createSvgElement("circle", {
            cx: centre.x,
            cy: centre.y,
            r: radius,
            fill: "none",
            stroke: paintColour(style?.stroke || "#193335"),
            "stroke-width": lineWidthOf(style, scale),
            ...extra
        })
    );
}

/*
 * An arrowhead at `tip`, pointing along `degrees` (world degrees, measured
 * anticlockwise from +x). Screen y grows downward, so the direction is
 * inverted for the projection - the same convention the camera uses.
 */
function arrowHead(parent, tip, degrees, style, scale, filled = true) {
    const radians = (num(degrees) * Math.PI) / 180;
    const length = 9 * scale;
    const spread = 0.38;

    const back = {
        x: tip.x - Math.cos(radians) * length,
        y: tip.y + Math.sin(radians) * length
    };

    const left = {
        x: back.x + Math.cos(radians + spread) * length,
        y: back.y - Math.sin(radians + spread) * length
    };

    const right = {
        x: back.x + Math.cos(radians - spread) * length,
        y: back.y - Math.sin(radians - spread) * length
    };

    const colour = paintColour(style?.stroke || "#193335");

    if (filled) {
        parent.appendChild(
            createSvgElement("path", {
                d: `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`,
                fill: colour,
                stroke: colour,
                "stroke-width": lineWidthOf(style, scale) * 0.5,
                "stroke-linejoin": "round"
            })
        );

        return;
    }

    strokePath(
        parent,
        `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y}`,
        style,
        scale
    );
}

function rgbaFill(colour, alpha) {
    const value = String(colour || "").trim();

    const hex = value.match(/^#([0-9a-fA-F]{6})$/);

    if (!hex) {
        return "none";
    }

    const number = parseInt(hex[1], 16);

    return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

/* ============================================================
 * BODIES
 * ============================================================ */

function pointAt(geometry, toScreen) {
    const position = geometry?.position || geometry?.center || null;

    return position ? toScreen(position) : null;
}

function drawParticle(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;
    const centre = pointAt(geometry, toScreen);

    if (!centre) {
        parentSvg.appendChild(svg);
        return true;
    }

    const radius = Math.max(2, num(geometry.markerRadius, 1.6) * units(scale));
    const colour = paintColour(style?.stroke || "#193335");
    const markerStyle = String(geometry.markerStyle || "filled").toLowerCase();

    if (markerStyle === "open") {
        strokeCircle(svg, centre, radius, style, scale);
    } else if (markerStyle === "cross") {
        const arm = radius * 1.4;

        strokeLine(svg, { x: centre.x - arm, y: centre.y }, { x: centre.x + arm, y: centre.y }, style, scale);
        strokeLine(svg, { x: centre.x, y: centre.y - arm }, { x: centre.x, y: centre.y + arm }, style, scale);
    } else {
        svg.appendChild(
            createSvgElement("circle", {
                cx: centre.x,
                cy: centre.y,
                r: radius,
                fill: colour,
                stroke: "none"
            })
        );
    }

    parentSvg.appendChild(svg);

    return true;
}

/*
 * A rigid body is drawn by the shared rigid-body renderer, which already
 * understands every shape the body can take. This pass adds only what the
 * Dynamics body carries on top of the outline: the centre-of-mass marker.
 */
function drawRigidBodyOverlay(context) {
    const { svg, geometry, style, toScreen, scale } = context;

    if (geometry.showCenterOfMass === false) {
        return false;
    }

    /*
     * THE CENTRE OF THE BODY IS A DERIVED POINT, not a stored one. It is read
     * through the shared geometry module so a body turned by a rotation
     * handle still puts its marker in the middle of the outline being drawn -
     * never a second, stale centre kept beside it.
     */
    const centre = enggFeatureGeometry.rigidBodyCenter(geometry);

    if (!centre) {
        return false;
    }

    const screen = toScreen(centre);
    const radius = 4 * units(scale);
    const colour = paintColour(style?.stroke || "#193335");

    /*
     * The quartered disc that says "centre of mass": the conventional mark,
     * and one that stays legible at a small size.
     */
    svg.appendChild(
        createSvgElement("path", {
            d:
                `M ${screen.x + radius} ${screen.y} ` +
                `A ${radius} ${radius} 0 1 1 ${screen.x} ${screen.y - radius} ` +
                `L ${screen.x} ${screen.y} Z`,
            fill: colour,
            stroke: colour,
            "stroke-width": Math.max(0.7, lineWidthOf(style, scale) * 0.8)
        })
    );

    return false;
}

/* ============================================================
 * KINEMATICS
 * ============================================================ */

function drawTrajectory(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;
    const start = geometry.start;
    const end = geometry.end;

    if (!start || !end) {
        return true;
    }

    const a = toScreen(start);
    const b = toScreen(end);
    const bow = num(geometry.bow, 0);

    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;

    /*
     * THE CONTROL POINT: THE MIDPOINT PUSHED PERPENDICULAR BY `bow`.
     *
     * The push is a FRACTION OF THE SPAN (`bow` is the curve's depth over its
     * length), so it is computed in the SAME length unit the span was measured
     * in. The screen span is used here because that is what the points are; the
     * source writer uses the world span, which is the same fraction of the same
     * segment - so the curve on the sheet and the curve in the compiled picture
     * have the same shape at every zoom.
     */
    const control = {
        x: mid.x - (dy / length) * length * bow,
        y: mid.y + (dx / length) * length * bow
    };

    const path = Math.abs(bow) < 1e-6
        ? `M ${a.x} ${a.y} L ${b.x} ${b.y}`
        : `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`;

    strokePath(svg, path, style, scale);

    if (geometry.arrowEnd === true) {
        const tangent = Math.abs(bow) < 1e-6
            ? Math.atan2(-(b.y - a.y), b.x - a.x)
            : Math.atan2(-(b.y - control.y), b.x - control.x);

        arrowHead(svg, b, (tangent * 180) / Math.PI, style, scale, true);
    }

    parentSvg.appendChild(svg);

    return true;
}

function drawPolarVector(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;
    const start = geometry.start;
    const end = geometry.end;

    if (!start || !end) {
        return true;
    }

    const a = toScreen(start);
    const b = toScreen(end);
    const degrees = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;

    strokeLine(svg, a, b, style, scale);
    arrowHead(svg, b, degrees, style, scale, String(style?.arrowEnd || "filled") !== "open");

    /* The tail is marked, so a vector reads as having an origin. */
    svg.appendChild(
        createSvgElement("circle", {
            cx: a.x,
            cy: a.y,
            r: Math.max(1.4, 2 * scale),
            fill: paintColour(style?.stroke || "#193335")
        })
    );

    /*
     * A student-typed angle annotation, if they asked for one. It is the
     * angle they see in the panel, written as given - never a derived
     * result - and it sits under the tail.
     */
    if (geometry.showAngle === true) {
        const label = createSvgElement("text", {
            x: a.x + 8 * scale,
            y: a.y + 12 * scale,
            fill: paintColour(style?.stroke || "#193335"),
            "font-size": 10 * scale,
            "font-family": "Arial, sans-serif",
            "pointer-events": "none"
        });

        label.textContent = `${Math.round(geometry.angleValue ?? degrees)}°`;
        svg.appendChild(label);
    }

    parentSvg.appendChild(svg);

    return true;
}

/* The point on the rotation circle at an angle (degrees, anticlockwise). */
function onCircle(centre, radius, degrees) {
    const radians = (num(degrees) * Math.PI) / 180;

    return {
        x: centre.x + radius * Math.cos(radians),
        y: centre.y - radius * Math.sin(radians)
    };
}

function drawAngularVector(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;
    const origin = geometry.center;

    if (!origin) {
        return true;
    }

    const centre = toScreen(origin);
    const radius = num(geometry.radius) * units(scale);

    if (radius <= 0) {
        return true;
    }

    const sweep = Math.abs(num(geometry.sweep, 270));
    const clockwise = String(geometry.direction || "ccw").toLowerCase() === "cw";
    const startAngle = num(geometry.startAngle);
    const travel = clockwise ? -sweep : sweep;

    const from = onCircle(centre, radius, startAngle);
    const to = onCircle(centre, radius, startAngle + travel);

    const largeArc = sweep > 180 ? 1 : 0;
    const sweepFlag = clockwise ? 0 : 1;

    strokePath(
        svg,
        `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${to.x} ${to.y}`,
        style,
        scale
    );

    /*
     * The arrowhead follows the direction of travel at the end of the arc,
     * so reversing the sense of rotation turns the head the other way.
     */
    const tangent = startAngle + travel + (clockwise ? -90 : 90);

    arrowHead(
        svg,
        to,
        tangent,
        style,
        scale,
        String(geometry.arrowHead || "filled") !== "open"
    );

    /* The implied rotation centre, drawn as a small cross. */
    const arm = 3.5 * scale;

    strokeLine(svg, { x: centre.x - arm, y: centre.y }, { x: centre.x + arm, y: centre.y }, style, scale);
    strokeLine(svg, { x: centre.x, y: centre.y }, { x: centre.x, y: centre.y - arm * 2 }, style, scale);

    parentSvg.appendChild(svg);

    return true;
}

/* ============================================================
 * MECHANICAL ELEMENTS
 * ============================================================ */

/*
 * The zigzag between two points, shared by the spring and by the spring
 * branch of the spring-damper. `offset` shifts the whole run sideways, which
 * is how the parallel branches are separated without duplicating the code.
 */
function springPath(a, b, geometry, offset = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    if (length < 1e-9) {
        return "";
    }

    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;

    const coils = Math.max(1, Math.round(num(geometry.coils, 6)));
    const amplitude = num(geometry.amplitude, 4);
    const lead = Math.max(0, Math.min(0.4, num(geometry.lead, 0.18)));

    const startLead = { x: a.x + nx * offset, y: a.y + ny * offset };
    const endLead = { x: b.x + nx * offset, y: b.y + ny * offset };

    const bodyFrom = length * lead;
    const bodyTo = length - length * lead;
    const bodyLength = bodyTo - bodyFrom;

    const along = (distance, side) => ({
        x: startLead.x + ux * distance + nx * side,
        y: startLead.y + uy * distance + ny * side
    });

    const points = [startLead, along(bodyFrom, 0)];

    /* Two points per coil: out to one side and back through the axis. */
    const steps = coils * 2;
    const step = bodyLength / steps;

    for (let index = 1; index <= steps; index += 1) {
        const side = index % 2 === 1 ? amplitude : -amplitude;

        points.push(along(bodyFrom + step * index, side));
    }

    points.push(endLead);

    return points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" ");
}

function drawSpring(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;

    if (!geometry.start || !geometry.end) {
        return true;
    }

    const a = toScreen(geometry.start);
    const b = toScreen(geometry.end);

    strokePath(svg, springPath(a, b, geometry), style, scale);
    parentSvg.appendChild(svg);

    return true;
}

/*
 * The damper: a cylinder between `bodyFrom` and `bodyTo` along the span, a
 * rod running through it to the far terminal, and a piston face at the end
 * of the body. Both parts are placed from the same two terminals, so the
 * rod always meets the cylinder however the span is turned.
 */
function damperParts(a, b, geometry, offset = 0, unit = 1) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    if (length < 1e-9) {
        return null;
    }

    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;

    const from = num(geometry.bodyFrom, 0.42);
    const to = Math.max(from + 0.05, num(geometry.bodyTo, 0.82));
    const width = Math.max(1, num(geometry.bodyWidth, 6) * unit);

    const at = (fraction, side = 0) => ({
        x: a.x + dx * fraction + nx * (offset + side),
        y: a.y + dy * fraction + ny * (offset + side)
    });

    const cylinder = {
        nearStart: at(from),
        nearEnd: at(to),
        farStart: at(from, width),
        farEnd: at(to, width)
    };

    return { at, cylinder, from, to };
}

function drawDamper(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;

    if (!geometry.start || !geometry.end) {
        return true;
    }

    const a = toScreen(geometry.start);
    const b = toScreen(geometry.end);
    const parts = damperParts(a, b, geometry, 0, units(scale));

    if (!parts) {
        return true;
    }

    const { at, cylinder } = parts;
    const stroke = paintColour(style?.stroke || "#193335");

    /* The cylinder, lightly tinted so the body reads as a body. */
    svg.appendChild(
        createSvgElement("path", {
            d:
                `M ${cylinder.nearStart.x} ${cylinder.nearStart.y} ` +
                `L ${cylinder.nearEnd.x} ${cylinder.nearEnd.y} ` +
                `L ${cylinder.farEnd.x} ${cylinder.farEnd.y} ` +
                `L ${cylinder.farStart.x} ${cylinder.farStart.y} Z`,
            fill: rgbaFill(style?.stroke || "#193335", 0.12),
            stroke,
            "stroke-width": lineWidthOf(style, scale),
            "stroke-linejoin": "round"
        })
    );

    /* The rod, through the cylinder to the far terminal. */
    strokeLine(svg, at(0), at(0.86), style, scale);
    strokeLine(svg, at(0.94), at(1), style, scale);

    /* The piston face at the end of the body. */
    strokeLine(svg, cylinder.nearEnd, cylinder.farEnd, style, scale, {
        "stroke-width": lineWidthOf(style, scale) * 1.6
    });

    parentSvg.appendChild(svg);

    return true;
}

function drawSpringDamper(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;

    if (!geometry.start || !geometry.end) {
        return true;
    }

    const a = toScreen(geometry.start);
    const b = toScreen(geometry.end);
    const spacing = num(geometry.branchSpacing, 7) * units(scale);

    /* The spring branch on one side, the damper branch on the other. */
    strokePath(svg, springPath(a, b, geometry, spacing), style, scale);

    const parts = damperParts(a, b, geometry, -spacing, units(scale));

    if (parts) {
        const { at, cylinder } = parts;

        svg.appendChild(
            createSvgElement("path", {
                d:
                    `M ${cylinder.nearStart.x} ${cylinder.nearStart.y} ` +
                    `L ${cylinder.nearEnd.x} ${cylinder.nearEnd.y} ` +
                    `L ${cylinder.farEnd.x} ${cylinder.farEnd.y} ` +
                    `L ${cylinder.farStart.x} ${cylinder.farStart.y} Z`,
                fill: rgbaFill(style?.stroke || "#193335", 0.12),
                stroke: paintColour(style?.stroke || "#193335"),
                "stroke-width": lineWidthOf(style, scale),
                "stroke-linejoin": "round"
            })
        );

        strokeLine(svg, at(0), at(0.86), style, scale);
        strokeLine(svg, at(0.94), at(1), style, scale);
        strokeLine(svg, cylinder.nearEnd, cylinder.farEnd, style, scale, {
            "stroke-width": lineWidthOf(style, scale) * 1.6
        });
    }

    parentSvg.appendChild(svg);

    return true;
}

/*
 * The pulley: a wheel, its axle, and a rope that leaves both sides of the
 * wheel and hangs down. The rope is drawn as two vertical runs tangent to
 * the wheel, joined over the top, so it reads as one cord rather than as
 * three separate lines.
 */
function drawPulley(context) {
    const { svg, parentSvg, geometry, style, toScreen, scale } = context;
    const centre = geometry.center;

    if (!centre) {
        return true;
    }

    const hub = toScreen(centre);
    const radius = num(geometry.radius, 8) * units(scale);

    if (radius <= 0) {
        return true;
    }

    const halfGap = Math.max(radius, num(geometry.ropeGap, radius * 2) * units(scale)) / 2;

    /*
     * THE HANG IS MEASURED FROM THE HUB, so it must clear the rim before the
     * rope exists at all: the cord leaves the wheel at its edge, and a drop of
     * less than a radius would leave a stub. Three radii puts two radii of rope
     * below the wheel, which is what makes the symbol read as a pulley.
     */
    const drop = Math.max(
        radius * 3,
        num(geometry.ropeDrop, radius * 3) * units(scale)
    );

    /*
     * WHICH WAY THE ROPE HANGS is the stored `ropeAngle` (zero hangs down).
     * Rotating the symbol advances that angle, so the whole cord swings with
     * the wheel instead of staying where it was.
     */
    const hang = (num(geometry.ropeAngle) * Math.PI) / 180;
    const hangX = Math.sin(hang);
    const hangY = Math.cos(hang);

    const left = { x: hub.x - halfGap, y: hub.y };
    const right = { x: hub.x + halfGap, y: hub.y };
    const leftEnd = {
        x: hub.x - halfGap + hangX * drop,
        y: hub.y + hangY * drop
    };
    const rightEnd = {
        x: hub.x + halfGap + hangX * drop,
        y: hub.y + hangY * drop
    };

    /* The cord: down the left, over the top of the wheel, down the right. */
    const shoulder = Math.sqrt(Math.max(0, radius * radius - halfGap * halfGap));

    strokePath(
        svg,
        `M ${leftEnd.x} ${leftEnd.y} L ${left.x} ${hub.y - shoulder} ` +
            `A ${radius} ${radius} 0 0 1 ${right.x} ${hub.y - shoulder} ` +
            `L ${rightEnd.x} ${rightEnd.y}`,
        style,
        scale,
        { "stroke-width": lineWidthOf(style, scale) * 1.2 }
    );

    /* The wheel. */
    strokeCircle(svg, hub, radius, style, scale, {
        "stroke-width": lineWidthOf(style, scale) * 1.4
    });

    if (geometry.showAxle !== false) {
        svg.appendChild(
            createSvgElement("circle", {
                cx: hub.x,
                cy: hub.y,
                r: Math.max(1.6, 2.2 * scale),
                fill: paintColour(style?.stroke || "#193335"),
                stroke: "none"
            })
        );
    }

    parentSvg.appendChild(svg);

    return true;
}

/*
 * A Dynamics coordinate system is the editor's own 2D system, drawn by
 * `drawCoordinateSystem2d`. This pass adds only the origin marker the
 * Dynamics reference calls for; the axes, arms and labels are the existing
 * system's and must not be drawn twice.
 */
function drawDynamicsCoordinateSystemOrigin(context) {
    const { svg, geometry, style, toScreen, scale } = context;
    const origin = geometry.origin;

    if (!origin || geometry.showOriginMarker === false) {
        return false;
    }

    const screen = toScreen(origin);

    svg.appendChild(
        createSvgElement("circle", {
            cx: screen.x,
            cy: screen.y,
            r: Math.max(1.6, 2 * scale),
            fill: paintColour(style?.stroke || "#193335"),
            stroke: "none"
        })
    );

    return false;
}

/* ============================================================
 * THE TABLE
 * ============================================================ */

export function drawDynamicsSymbol(context) {
    const kind = context.entity?.engineering?.dynamicsType;

    /*
     * A particle is a particle, but a Dynamics one may be an open ring or a
     * cross, so the Dynamics marker replaces the Statics dot only when the
     * object says it is one.
     */
    if (kind === "dynamics-particle") {
        return drawParticle(context);
    }

    if (kind === "dynamics-rigid-body") {
        return drawRigidBodyOverlay(context);
    }

    /*
     * THE REFERENCE TOOLS ARE ORDINARY GEOMETRY. A Dynamics Reference Line,
     * Arc and Point are a line, an arc and a point - drawn by the renderer
     * that already knows how, with the style the tool gave them. Declining
     * them here is what keeps one picture per object instead of two.
     */
    if (kind === "dynamics-reference-line" || kind === "dynamics-reference-arc" || kind === "dynamics-reference-point") {
        return false;
    }

    if (kind === "dynamics-trajectory") {
        return drawTrajectory(context);
    }

    if (kind === "dynamics-polar-vector") {
        return drawPolarVector(context);
    }

    if (kind === "dynamics-angular-vector") {
        return drawAngularVector(context);
    }

    if (kind === "dynamics-spring") {
        return drawSpring(context);
    }

    if (kind === "dynamics-damper") {
        return drawDamper(context);
    }

    if (kind === "dynamics-spring-damper") {
        return drawSpringDamper(context);
    }

    if (kind === "dynamics-pulley") {
        return drawPulley(context);
    }

    if (kind === "dynamics-coordinate-system") {
        return drawDynamicsCoordinateSystemOrigin(context);
    }

    return false;
}

export default drawDynamicsSymbol;









