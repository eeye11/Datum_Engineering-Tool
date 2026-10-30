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
import { createSvgElement, dashPatternFor, paintColour, scaledStrokeWidth } from "../svg-primitives.js";
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

    /*
     * A RUN WITH A BEND FITTED IS DRAWN SHORT: its walls stop at the elbow's
     * tangent points, so the arcs take over exactly where the straight wall
     * ends and the two do not overlap. `trimmedCentreline` is the one place
     * that arithmetic lives, so the canvas, the source and the mesh all shorten
     * the run the same way.
     */
    const centreline = enggPipeDuct.trimmedCentreline(entity) || geometry;

    const walls = enggPipeDuct.boundaryLines(centreline.start, centreline.end, entity.engineering || {});

    if (!walls.length) {
        return true;
    }

    /*
     * THE BORE IS A CLOSED REGION.
     *
     * Two walls and the two end caps enclose it, so a filled pipe is ONE
     * shape rather than two lines with a colour between them. The caps are
     * drawn as part of the outline only when the walls are not filled - a filled
     * run is already closed, and doubling its end edge would print it darker.
     */
    const filled = style.fillMode === "solid";

    const [first, second] = walls;

    if (filled) {
        const points = [first.start, first.end, second.end, second.start]
            .map(toScreen)
            .map((point) => `${point.x},${point.y}`)
            .join(" ");

        svg.appendChild(createSvgElement("polygon", {
            points,
            fill: paintColour(style.fill || stroke),
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linejoin": "round"
        }));

        return false;
    }

    const dash = dashPatternFor(style.lineType);

    walls.forEach((boundary) => {
        const from = toScreen(boundary.start);
        const to = toScreen(boundary.end);

        svg.appendChild(createSvgElement("line", {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linecap": "round",
            ...(dash ? { "stroke-dasharray": dash } : {})
        }));
    });

    return false;
}

export function drawElbow({ svg, entity, geometry, style, toScreen }) {
    const engineering = entity.engineering || {};

    /*
     * THE BEND IS TAKEN FROM THE ELBOW'S OWN ENDS AND ANGLE, so a MANUAL fitting
     * - whose two ends are what the student dragged - and a GENERATED one, whose
     * ends are the points its runs meet it at, are drawn by one function.
     *
     * `elbowLegs` supplies the length of each arm, which is what lets the two
     * tangent points be placed on the arms rather than only inside legs already
     * occupied by a pipe.
     */
    const curves = enggPipeDuct.elbowGeometry(
        geometry.previous,
        geometry.position,
        geometry.next,
        engineering.bendRadius,
        enggPipeDuct.elbowLegs(entity)
    );

    if (!curves) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const separation = enggPipeDuct.boundarySeparation(engineering);
    const sweep = ((curves.endAngle - curves.startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

    /*
     * THE BEND HAS TWO ENDS, AND THEY MAY BE DRAWN AT DIFFERENT WIDTHS.
     *
     * An elbow is the boundary at which two runs are allowed to differ, so the
     * fitting runs `startSeparation` on the incoming side and `endSeparation` on
     * the outgoing one - the same numbers those runs' own walls use. The two
     * wall radii therefore interpolate around the arc, which is what keeps each
     * border CONTINUOUS with the straight wall it meets. A bend drawn at one
     * width would leave a step wherever the far run is wider or narrower.
     */
    const startSeparation = Number(engineering.startSeparation) > 0
        ? Number(engineering.startSeparation)
        : separation;

    const endSeparation = Number(engineering.endSeparation) > 0
        ? Number(engineering.endSeparation)
        : separation;

    const steps = 24;

    const wallPoints = (side) =>
        Array.from({ length: steps + 1 }, (_, index) => {
            const t = index / steps;
            const angle = curves.startAngle + sweep * t;
            const half = (startSeparation + (endSeparation - startSeparation) * t) / 2;
            const radius = curves.radius + side * half;

            return toScreen({
                x: curves.centre.x + radius * Math.cos(angle),
                y: curves.centre.y + radius * Math.sin(angle)
            });
        });

    [1, -1].forEach((side) => {
        const points = wallPoints(side);

        svg.appendChild(createSvgElement("path", {
            d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
            fill: "none",
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linecap": "round",
            ...(dash ? { "stroke-dasharray": dash } : {})
        }));
    });

    /*
     * A FILLED ELBOW FILLS THE REGION BETWEEN ITS TWO BOUNDARIES - the same
     * closure a filled run uses, made of the outer wall, the end edge, the
     * inner wall and the other end edge. It is inserted UNDER the walls as one
     * shape, so the filling introduces no extra selectable object and no
     * visible end caps: the walls themselves are the boundary.
     */
    if (style.fillMode === "solid") {
        const region = [...wallPoints(1), ...wallPoints(-1).reverse()];

        const first = svg.firstChild;

        const fillPath = createSvgElement("path", {
            d:
                region.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") +
                " Z",
            fill: paintColour(style.fill || stroke),
            stroke: "none"
        });

        if (first) {
            svg.insertBefore(fillPath, first);
        } else {
            svg.appendChild(fillPath);
        }
    }

    /*
     * NO END MARKS.
     *
     * The bend used to draw a short cross-mark across each tangent point. That
     * was a stand-in for a corner closure: with the runs TRIMMED back to
     * those points, the arcs are already tangent to the walls, so a mark would
     * draw a stroke across the bore of the pipe - which is not what a fitting
     * looks like.
     */
}
