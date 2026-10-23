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
import { applyStyle, createSvgElement, paintColour } from "../svg-primitives.js";
import { processLabelPoint } from "../../../features/workspace/model/thermodynamics/process-labels.js";
import { processSegmentPoints } from "../../../features/workspace/model/thermodynamics/process-curves.js";
import { processDiagramPaths } from "../../../features/workspace/model/thermodynamics/saturation-curve.js";
import { cylinderPoint, pistonFraction, stopperPaths } from "../../../features/workspace/model/thermodynamics/piston-cylinder.js";
import { tankPaths } from "../../../features/workspace/model/thermodynamics/tank.js";
import { turbineCompressorPoints } from "../../../features/workspace/model/thermodynamics/turbine-compressor.js";

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
            if (index >= (entity.metadata.stateCount ?? points.length)) return;
            const labelPoint = toScreen(processLabelPoint(geometry, index, scale));
            processOverlay.appendChild(createSvgElement("circle", { cx: point.x, cy: point.y, r: 3, fill: colour }));
            processOverlay.appendChild(createSvgElement("circle", {
                cx: labelPoint.x, cy: labelPoint.y, r: 9, fill: "white", stroke: "none", cursor: "move"
            }));
            const label = createSvgElement("text", {
                x: labelPoint.x, y: labelPoint.y, fill: colour, "font-size": 12, "font-family": "sans-serif", cursor: "move",
                "text-anchor": "middle", "dominant-baseline": "central"
            });
            label.textContent = String(index + 1);
            processOverlay.appendChild(label);
            if (!index) return;
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
            const text = createSvgElement("text", {
                x: point.x, y: point.y, fill: paintColour(style.stroke || enggTheme.defaultLineColour()),
                "font-size": 12, "text-anchor": "end", "font-family": "sans-serif",
                "data-saturation-axis": key, "data-axis-feature-id": entity.id,
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
