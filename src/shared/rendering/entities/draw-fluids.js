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
import enggJunction from "../../../features/workspace/model/fluids/junction.js";
import enggTheme from "../../../components/layout/workspace/theme.js";
import { drawingState } from "../../../features/workspace/editor-state.js";

function finitePoint(point) {
    return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/*
 * ============================================================
 * THE RUNS A BEND JOINS, FROM THE RECORD IT CARRIES
 * ============================================================
 *
 * `elbowWallArcsFor` needs to know WHICH STRAIGHT WALL each arc continues, and
 * that depends on the direction each run was actually drawn in. The fitting
 * records the pair (and, by run id, the end of each it holds), so the runs are
 * looked up here rather than guessed from the bend's geometry.
 *
 * `connections` is positional in the fitting's own order - the run the bend
 * ARRIVES from first, the one it LEAVES along second - so the lookup is by
 * position, not by id, and a missing run leaves that side to the default.
 */
function joinedRunsOf(elbow) {
    const ids = elbow?.engineering?.connections;

    if (!Array.isArray(ids) || ids.length !== 2) {
        return {};
    }

    const objects = drawingState.objects || [];
    const find = (id) => (id ? objects.find((object) => object.id === id) || null : null);

    return {
        incoming: find(ids[0]),
        outgoing: find(ids[1])
    };
}

/*
 * A RUN'S WALLS, WITH THE END THAT MEETS A BEND CUT TO THE BEND'S SEAM.
 *
 * Each run end that carries a bend's trim is moved onto the point the bend's
 * matching arc starts at - `elbowJunctionsFor`'s seam - so wall and arc share one
 * coordinate. Everything else about the wall is untouched: same line, same
 * offset, same direction; only the reach of the joining end is made exact, and
 * it is flagged `capped` so it is drawn with a butt cap (the other ends keep
 * their round ones).
 */
function seamPipeWalls(walls, run) {
    const trims = run?.geometry?.trims || {};

    const joints = (run?.geometry?.bendJoints && typeof run.geometry.bendJoints === "object")
        ? run.geometry.bendJoints
        : null;

    if (!joints || !Array.isArray(walls) || walls.length !== 2) {
        return walls;
    }

    const seamSide = (end) => (["start", "end"].includes(end) && Number(trims[end]) > 0 ? joints[end] : null);

    return walls.map((wall, index) => {
        const held = ["start", "end"].filter((end) => seamSide(end));

        if (!held.length) {
            return wall;
        }

        /* The wall drawn on side `index` at that end meets that seam. */
        let result = { ...wall };
        let seamed = false;

        held.forEach((end) => {
            const seam = joints[end]?.[index];

            if (finitePoint(seam)) {
                result = { ...result, [end]: { x: seam.x, y: seam.y } };
                seamed = true;
            }
        });

        return seamed ? { ...result, seams: true } : result;
    });
}

export function drawPipeDuct({ svg, entity, geometry, style, toScreen }) {
    if (!finitePoint(geometry.start) || !finitePoint(geometry.end)) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

    /*
     * A RUN'S ENDPOINTS ARE ALREADY THE WALLS' ENDS. A joined run has had its
     * `start`/`end` moved onto the elbow's tangent points, so the centreline as
     * stored IS the visible one - trimming it again by `geometry.trims` would
     * shorten it a second time and leave the bend a trim short of its pipe.
     *
     * THE END THAT MEETS A BEND IS CUT TO THE BEND'S OWN SEAM - the point
     * `elbowJunctionsFor` hands the arc - so a wall can never run a fraction past
     * the arc, or stop just short of it, however the run was re-seated.
     */
    const walls = seamPipeWalls(enggPipeDuct.boundaryLinesOf(entity), entity);

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

        /*
         * A WALL STOPS ON ITS END POINT.
         *
         * A ROUND cap paints a half-line-width semicircle BEYOND the end point.
         * At a bend that semicircle is drawn into the arc, which begins on that
         * very point - the small bulge that reads as an overlap at every joint.
         *
         * So the cap follows the END, not the wall: a line has one cap for both
         * ends in SVG, and a wall joined to a bend must therefore be BUTT. A wall
         * with no seam at either end keeps the round caps the drawing convention
         * uses elsewhere.
         *
         * `capped` is set by `seamPipeWalls` on the wall that has NO seam, so it
         * is read the other way round: an UNcapped wall is the one at a bend.
         */
        svg.appendChild(createSvgElement("line", {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linecap": boundary.seams ? "butt" : "round",
            ...(dash ? { "stroke-dasharray": dash } : {})
        }));
    });

    return false;
}

export function drawElbow({ svg, entity, geometry, style, toScreen }) {
    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);

    /*
     * THE TWO WALLS COME FROM THE MODEL, NOT FROM A SIGN GUESSED HERE.
     *
     * `elbowWallArcsFor` builds each wall's arc on its own radius about the
     * bend's centre, so a bend whose two runs are drawn at different widths
     * still meets both of them exactly - and it names the arc each RUN's line
     * continues, so a left turn and a right turn are drawn with the same code.
     *
     * It also decides whether the bend is drawable at all: a radius the arms
     * cannot hold, or a corner that does not turn, produces no walls and
     * nothing is drawn, exactly as before.
     */
    const walls = enggPipeDuct.elbowJunctionsFor(entity, joinedRunsOf(entity));

    if (!walls) {
        return true;
    }

    const steps = 32;

    const wallPoints = (wall) =>
        Array.from({ length: steps + 1 }, (_, index) => toScreen(wall.pointAt(index / steps)));

    [walls.outer, walls.inner].forEach((wall) => {
        const points = wallPoints(wall);

        /*
         * THE ARC MEETS ITS STRAIGHT WALL SQUARELY.
         *
         * A round cap would push the stroke half a line-width PAST the arc's end
         * point - which, at a junction where the straight wall already ends, is a
         * stub drawn over the pipe. A butt cap stops exactly on the end point, so
         * the arc begins at the very pixel the wall stops at. The same cap on both
         * is what makes the junction invisible.
         */
        svg.appendChild(createSvgElement("path", {
            d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
            fill: "none",
            stroke,
            "stroke-width": scaledStrokeWidth(style.lineWidth),
            "stroke-linecap": "butt",
            "stroke-linejoin": "miter",
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
        const region = [...wallPoints(walls.outer), ...wallPoints(walls.inner).reverse()];

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

/*
 * ============================================================
 * A JUNCTION - ONE CONTINUOUS CONTOUR ROUND THE HUB
 * ============================================================
 *
 * The shape is `enggJunction.junctionOutline` and nothing else, for the same
 * reason the elbow reads its walls from the model: the canvas, the source
 * writer and the selection bounds then describe ONE loop.
 *
 * The contour already carries every branch's mouth at the port its pipe
 * meets, at that pipe's OWN width - so a junction joining a wide run to two
 * narrow ones is drawn as one blended fitting. The connected pipes draw
 * their own walls up to those mouths; this draws only what belongs to the
 * fitting.
 */
export function drawJunction({ svg, entity, toScreen }) {
    const style = entity?.style || {};

    const outline = enggJunction.junctionOutline(entity);

    if (!outline.length) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);

    const points = outline.map(toScreen);

    const d = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") + " Z";

    /* THE FILL GOES UNDER THE OUTLINE: the outline IS the boundary. */
    if (style.fillMode === "solid") {
        svg.appendChild(createSvgElement("path", {
            d,
            fill: paintColour(style.fill || stroke),
            stroke: "none"
        }));
    }

    /*
     * A ROUND JOIN, unlike the elbow's miter: the contour is sampled, so its
     * shoulders are many short chords and a miter would spike at each one.
     */
    svg.appendChild(createSvgElement("path", {
        d,
        fill: "none",
        stroke,
        "stroke-width": scaledStrokeWidth(style.lineWidth),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...(dash ? { "stroke-dasharray": dash } : {})
    }));

    /*
     * THE TICK FOR AN UNCONNECTED BRANCH. A port is a place a pipe can be
     * snapped to, so it must be visible - but it is not pipework, and it goes
     * as soon as a pipe is joined there.
     */
    (entity?.geometry?.branches || []).forEach((branch) => {
        if (branch?.connected) {
            return;
        }

        const port = enggJunction.branchPort(entity, branch);
        const hub = entity?.geometry?.position;

        if (!finitePoint(port) || !finitePoint(hub)) {
            return;
        }

        const from = toScreen(port);
        const to = toScreen({ x: port.x + (port.x - hub.x) * 0.18, y: port.y + (port.y - hub.y) * 0.18 });

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
}
