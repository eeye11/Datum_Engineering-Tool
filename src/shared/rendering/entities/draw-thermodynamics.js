/*
 * Drawing one feature: the thermodynamics features - a process path's
 * numbered states and direction arrows, the saturation curve (dome) with its
 * axis labels, and the piston-cylinder with its piston, rod and stoppers.
 *
 * Each function draws one kind of feature into its group, from the context
 * appendEntity (entity-render.js) builds. It returns true when the feature
 * is finished, so no later renderer in the table runs for it.
 */
import enggTheme from "../../../components/layout/workspace/theme.js";
import { activeZoom, applyStyle, createSvgElement, paintColour } from "../svg-primitives.js";
import {
    AUXILIARY_FONT_PX,
    CANVAS_BASELINE,
    CANVAS_FONT_STACK,
    LINE_SPACING,
    SECONDARY_FONT_PX,
    fontSizeOf,
    textTransform
} from "../../typography/canvas-typography.js";
import { processLabelPoint } from "../../../features/workspace/model/thermodynamics/process-labels.js";
import { processSegmentPoints } from "../../../features/workspace/model/thermodynamics/process-curves.js";
import { processDiagramPaths } from "../../../features/workspace/model/thermodynamics/saturation-curve.js";
import { cylinderPoint, pistonFraction, stopperPaths } from "../../../features/workspace/model/thermodynamics/piston-cylinder.js";
import { tankPaths } from "../../../features/workspace/model/thermodynamics/tank.js";
import { turbineCompressorPoints } from "../../../features/workspace/model/thermodynamics/turbine-compressor.js";
import { nozzleDiffuserPaths } from "../../../features/workspace/model/thermodynamics/nozzle-diffuser.js";
import { rankineCycleDiagram } from "../../../features/workspace/model/thermodynamics/rankine-cycle.js";

export function drawRankineCycle({ svg, entity, geometry, style, toScreen }) {
    const diagram = rankineCycleDiagram(geometry, entity?.metadata?.problemData);
    for (const wall of diagram.paths) {
        const points = wall.points.map(toScreen);
        const path = createSvgElement("path", { d: points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") });
        applyStyle(path, { ...style, stroke: wall.colour, fill: wall.fill ? (wall.colour === "blue" ? "#d1d1ff" : "#ffd1d1") : "none", fillMode: wall.fill ? "solid" : "none" });
        if (wall.bold) {
            path.setAttribute("stroke-width", String(Math.max(2.5, Number(path.getAttribute("stroke-width")) * 2)));
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
        }
        svg.appendChild(path);
    }
    /*
     * A PROCESS DIAGRAM'S STATES ARE AUXILIARY TYPE, AT A CANVAS SIZE.
     *
     * The size used to be a fraction of the DIAGRAM's on-screen width (so it grew
     * with the drawing and with the zoom, and two diagrams of different sizes had
     * different type). It is now the shared auxiliary role, 12 px, cancelling the
     * camera on the glyphs; `label.fontScale` remains a deliberate per-label
     * emphasis (a state number reads at the stated role, a title may be scaled).
     */
    for (const label of diagram.labels) {
        const labelFontSize = fontSizeOf(
            AUXILIARY_FONT_PX * (label.fontScale || 1),
            AUXILIARY_FONT_PX
        );
        const p = toScreen(label.point);
        const zoom = Math.max(Number(activeZoom) || 1, 0.0001);
        const text = createSvgElement("text", {
            x: p.x,
            y: p.y,
            "text-anchor": "middle",
            "dominant-baseline": CANVAS_BASELINE,
            "font-size": Math.round(labelFontSize * zoom * 1000) / 1000,
            transform: textTransform(p, zoom),
            "font-family": CANVAS_FONT_STACK,
            fill: paintColour("#000000")
        });
        const quantitySubscript = !label.plainText && /^\$([QWqw])_(?:\{([^}]+)\}|([HL]))\$$/.exec(label.latex || "");
        if (!label.plainText && label.latex === "$P_4=P_5=P_{reheat}$") {
            for (const [index, value] of ["4", "5", "reheat"].entries()) {
                const base = createSvgElement("tspan", {});
                base.textContent = index === 0 ? "P" : " = P";
                text.appendChild(base);
                const subscript = createSvgElement("tspan", { "baseline-shift": "sub", "font-size": "70%" });
                subscript.textContent = value;
                text.appendChild(subscript);
            }
        } else if (quantitySubscript) {
            text.textContent = quantitySubscript[1];
            const subscript = createSvgElement("tspan", { "baseline-shift": "sub", "font-size": "70%" });
            subscript.textContent = quantitySubscript[2] || quantitySubscript[3];
            text.appendChild(subscript);
        } else {
            const lines = label.lines || [label.text];
            if (lines.length === 1) text.textContent = lines[0];
            else lines.forEach((line, index) => {
                const span = createSvgElement("tspan", {
                    x: p.x,
                    dy:
                        (index === 0
                            ? -(lines.length - 1) * labelFontSize * 0.6
                            : labelFontSize * LINE_SPACING) * zoom
                });
                span.textContent = line;
                text.appendChild(span);
            });
        }
        svg.appendChild(text);
    }
}

export function drawNozzleDiffuser({ svg, geometry, style, toScreen }) {
    for (const wall of nozzleDiffuserPaths(geometry)) {
        const points = wall.map(toScreen);
        const path = createSvgElement("path", {
            d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")
        });
        applyStyle(path, { ...style, fill: "none" });
        svg.appendChild(path);
    }
}

export function drawTurbineCompressor({ svg, geometry, style, toScreen }) {
    const points = turbineCompressorPoints(geometry).map(toScreen);
    const path = createSvgElement("path", {
        d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") + " Z"
    });
    applyStyle(path, { ...style, fill: "none" });
    svg.appendChild(path);
}

export function drawTank({ svg, geometry, style, toScreen }) {
    for (const outline of tankPaths(geometry)) {
        const points = outline.map(toScreen);
        const path = createSvgElement("path", {
            d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")
        });
        applyStyle(path, { ...style, fill: "none" });
        svg.appendChild(path);
    }
}

    /*
     * A PROCESS PATH'S STATES AND DIRECTION.
     *
     * The numbered state markers and the arrow on each segment are an OVERLAY:
     * built here, but appended last (appendEntity adds `context.overlay` after
     * every other renderer), so they sit on top of the path itself.
     */
    export function drawProcessOverlay(context) {
        const { entity, geometry, style, toScreen, scale } = context;
        const processOverlay = createSvgElement("g");
        const points = (geometry.points || []).map(toScreen);
        const colour = paintColour(style.stroke || "#dc2626");
        points.forEach((point, index) => {
            if (index < (entity.metadata.stateCount ?? points.length)) {
                const labelPoint = toScreen(processLabelPoint(geometry, index, scale));
                processOverlay.appendChild(createSvgElement("circle", { cx: point.x, cy: point.y, r: 3, fill: colour }));
                processOverlay.appendChild(createSvgElement("circle", {
                    cx: labelPoint.x, cy: labelPoint.y, r: 9, fill: "white", stroke: "none", cursor: "move"
                }));
                /* A state's number: auxiliary type at a canvas size. */
                const stateZoom = Math.max(Number(activeZoom) || 1, 0.0001);
                const label = createSvgElement("text", {
                    x: labelPoint.x,
                    y: labelPoint.y,
                    fill: colour,
                    "font-size": Math.round(AUXILIARY_FONT_PX * stateZoom * 1000) / 1000,
                    transform: textTransform(labelPoint, stateZoom),
                    "font-family": CANVAS_FONT_STACK,
                    cursor: "move",
                    "text-anchor": "middle",
                    "dominant-baseline": CANVAS_BASELINE
                });
                label.textContent = String(index + 1);
                processOverlay.appendChild(label);
            }
            if (!index || (Array.isArray(entity.metadata.arrowSegments) && !entity.metadata.arrowSegments.includes(index - 1))) return;
            const segment = processSegmentPoints(geometry, index - 1).map(toScreen);
            const middle = Math.floor(segment.length / 2);
            const previous = segment.length > 2 ? segment[middle - 1] : segment[0];
            const next = segment.length > 2 ? segment[middle + 1] : point;
            const length = Math.hypot(next.x - previous.x, next.y - previous.y);
            if (Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) < 12 || length < 1e-8) return;
            const ux = (next.x - previous.x) / length;
            const uy = (next.y - previous.y) / length;
            const mx = segment.length > 2 ? segment[middle].x : (point.x + previous.x) / 2;
            const my = segment.length > 2 ? segment[middle].y : (point.y + previous.y) / 2;
            processOverlay.appendChild(createSvgElement("polygon", {
                points: `${mx + ux * 4},${my + uy * 4} ${mx - ux * 4 - uy * 3},${my - uy * 4 + ux * 3} ${mx - ux * 4 + uy * 3},${my - uy * 4 - ux * 3}`,
                fill: colour, stroke: "none"
            }));
        });
        context.overlay = processOverlay;
    }

    export function drawSaturationCurve({ svg, entity, geometry, style, toScreen }) {
        for (const [index, points] of processDiagramPaths(geometry, entity).entries()) {
            const screen = points.map(toScreen);
            const path = createSvgElement("path", {
                d: screen.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")
            });
            applyStyle(path, { ...style, fill: "none" });
            if (index === 1 || index === 2) {
                path.setAttribute("fill", paintColour(style.stroke || enggTheme.defaultLineColour()));
                path.setAttribute("stroke", "none");
            }
            svg.appendChild(path);
        }
        for (const [key, x, y] of [["yLabel", 0.04, 0.94], ["xLabel", 0.98, 0.02]]) {
            const label = geometry[key] || "insert axis label";
            const point = toScreen(cylinderPoint(geometry, x, y));
            const axisZoom = Math.max(Number(activeZoom) || 1, 0.0001);
            const text = createSvgElement("text", {
                x: point.x,
                y: point.y,
                fill: paintColour(style.stroke || enggTheme.defaultLineColour()),
                "font-size": Math.round(SECONDARY_FONT_PX * axisZoom * 1000) / 1000,
                transform: textTransform(point, axisZoom),
                "text-anchor": "end",
                "font-family": CANVAS_FONT_STACK,
                "data-saturation-axis": key,
                "data-axis-feature-id": entity.id,
                cursor: "text"
            });
            text.textContent = label;
            svg.appendChild(text);
        }
    }

    export function drawPistonCylinder({ svg, geometry, style, toScreen }) {
        const level = pistonFraction(geometry);
        const thickness = Math.min(0.04, level / 2);
        const paths = [
            [[0, 1], [0, 0], [1, 0], [1, 1]],
            [[0, level], [1, level], [1, level - thickness], [0, level - thickness], [0, level]],
            [[0.5, level], [0.5, 1]],
            ...stopperPaths(geometry)
        ];
        for (const points of paths) {
            const screenPoints = points.map(([x, y]) => toScreen(cylinderPoint(geometry, x, y)));
            const path = createSvgElement("path", {
                d: screenPoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")
            });
            applyStyle(path, { ...style, fill: "none" });
            svg.appendChild(path);
        }
    }
