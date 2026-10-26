/*
 * Drawing one feature: the Fluids flow paths - a Pipe / Duct run and an Elbow.
 *
 * Ported from the fluids/pipe-duct toolset (category/fluids). A run is its two
 * boundary walls, derived from the centreline by the model's `boundaryLines`;
 * an elbow is the two walls bent round the corner, with a short mark at each
 * end where it meets the runs. Both read the feature's own geometry and
 * engineering, so what is drawn is what is stored.
 *
 * Each function draws into its group, from the context appendEntity
 * (entity-render.js) builds, and returns true only to stop the feature being
 * drawn at all.
 */
import { createSvgElement, paintColour, scaledStrokeWidth } from "../svg-primitives.js";
import enggPipeDuct from "../../../features/workspace/model/fluids/pipe-duct.js";
import enggTheme from "../../../components/layout/workspace/theme.js";

function finitePoint(point) {
    return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function drawPipeDuct({ svg, entity, geometry, style, toScreen }) {
    if (!finitePoint(geometry.start) || !finitePoint(geometry.end)) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

    enggPipeDuct.pipeDuctPaths(geometry.start, geometry.end, entity.engineering || {}).forEach((path) => {
        const points = path.map(toScreen);
        svg.appendChild(createSvgElement("path", {
            d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
            fill: "none",
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linecap": "round"
        }));
    });
}

export function drawElbow({ svg, entity, geometry, style, toScreen }) {
    const curves = enggPipeDuct.elbowGeometry(
        geometry.previous,
        geometry.position,
        geometry.next,
        (entity.engineering || {}).bendRadius
    );

    if (!curves) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const separation = enggPipeDuct.boundarySeparation(entity.engineering || {});

    const radii = separation === null
        ? [curves.radius, curves.radius]
        : [curves.radius - separation / 2, curves.radius + separation / 2];

    const sweep = ((curves.endAngle - curves.startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

    radii.forEach((radius) => {
        if (!Number.isFinite(radius) || radius <= 0) {
            return;
        }

        /*
         * The arc is built in world space and mapped point by point, so the
         * screen's y flip is applied the same way as for every other feature.
         */
        const steps = 24;
        const points = Array.from({ length: steps + 1 }, (_, index) => {
            const angle = curves.startAngle + (sweep * index) / steps;

            return toScreen({
                x: curves.centre.x + radius * Math.cos(angle),
                y: curves.centre.y + radius * Math.sin(angle)
            });
        });

        svg.appendChild(createSvgElement("path", {
            d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
            fill: "none",
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linecap": "round"
        }));
    });

    const markLength = separation === null ? 0 : separation / 2;

    [[curves.inDirection, curves.start], [curves.outDirection, curves.end]].forEach(([direction, point]) => {
        if (!direction || !point || markLength <= 0) {
            return;
        }

        const normal = { x: -direction.y, y: direction.x };
        const a = toScreen({ x: point.x - normal.x * markLength, y: point.y - normal.y * markLength });
        const b = toScreen({ x: point.x + normal.x * markLength, y: point.y + normal.y * markLength });

        svg.appendChild(createSvgElement("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            stroke,
            "stroke-width": Math.max(0.5, scaledStrokeWidth(style.lineWidth))
        }));
    });
}
