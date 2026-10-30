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
import enggFlowArrow from "../../../features/workspace/model/fluids/flow-arrow.js";
import enggReducer from "../../../features/workspace/model/fluids/reducer-expander.js";
import enggEquipment from "../../../features/workspace/model/fluids/inline-equipment.js";
import enggVessel from "../../../features/workspace/model/fluids/reservoir-tank.js";
import enggFluidLevel from "../../../features/workspace/model/fluids/fluid-level.js";
import enggFlowArrows from "../../../features/workspace/model/fluids/flow-arrows.js";
import enggPressureProfile from "../../../features/workspace/model/fluids/pressure-profile.js";
import enggSectionPlane from "../../../features/workspace/model/fluids/section-plane.js";
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
    /*
     * A RUN THAT HAS BEEN CUT CARRIES NO TRIM RECORD - a junction, a reducer or
     * a piece of inline equipment cuts it by moving its ends, and the joint
     * belongs to the fitting. `geometry.start`/`end` are then the visible ends,
     * and `boundaryLinesOf` already draws the walls between them - through the
     * span's line, which is the same line. Nothing extra is needed here.
     */
    const trims = run?.geometry?.trims || {};

    void trims;

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

/*
 * ============================================================
 * THE CONTRACT, WHICH IS THE RENDERER'S
 * ============================================================
 *
 * `appendEntity` (entity-render.js) hands every drawer its own `<g>` as `svg`
 * and the picture as `parentSvg`. The drawer fills the group and appends it to
 * the picture, then returns true; a degenerate feature returns true WITHOUT
 * appending, and nothing is drawn. That is how every drawer in this folder
 * reports itself - a group that is never appended is a feature that draws
 * nothing.
 *
 * THE FLUIDS DRAWERS USED TO INVERT IT - they appended into the group and
 * returned FALSE for "drawn", so `appendEntity` carried on falling through the
 * renderer list (harmless, because no later drawer matches a pipe) and then
 * dropped the group on the floor, because it was never appended to the parent.
 * The run, the bend, the junction and the flow arrow were therefore drawn into
 * a detached group and never appeared on the sheet.
 */

export function drawPipeDuct({ svg, parentSvg, entity, geometry, style, toScreen }) {
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

        parentSvg.appendChild(svg);
        return true;
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

    parentSvg.appendChild(svg);
    return true;
}

export function drawElbow({ svg, parentSvg, entity, geometry, style, toScreen }) {
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

    parentSvg.appendChild(svg);
    return true;
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
export function drawJunction({ svg, parentSvg, entity, toScreen }) {
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

    parentSvg.appendChild(svg);
    return true;
}

/*
 * ========================================================
 * THE FLOW ARROW ON THE SHEET
 * ========================================================
 *
 * A flow arrow is a SHAFT and a HEAD, drawn on its host pipe's centreline and
 * pointing along the flow. It is the same shape the tool previews and the TikZ
 * writes, derived from the attachment in one place (`describeFlowArrow`), so
 * the canvas, the compiled picture and the attachment model cannot disagree.
 *
 * ========================================================
 * PARALLEL TO THE RUN'S EDGES
 * ========================================================
 *
 * The arrow's axis is the run's own direction, and its barbs sit ON the
 * centreline - not on the walls either side of it. Because the attachment is
 * the fraction along the run, the arrow sits centred by construction: there is
 * no offset stored, so none can drift sideways off the centreline. That is the
 * requirement's "parallel to the pipe edges" made true by the model rather than
 * enforced by a correction.
 *
 * ========================================================
 * A MISSING HOST DRAWS NOTHING
 * ========================================================
 *
 * An arrow whose pipe has gone cannot be drawn - there is no centreline to sit
 * on and no direction to point along. Returning true without appending an
 * element is the same answer a degenerate run gives: the drawing stays honest
 * rather than inventing geometry the attachment cannot describe.
 */
export function drawFlowArrow({ svg, parentSvg, entity, toScreen }) {
    /*
     * THE SHAPE COMES FROM THE MODEL, NOT FROM A COPY OF IT HERE.
     *
     * `flowArrowShape` is the same function the tool preview, the TikZ writer
     * and the hit test read, so the arrow on the sheet, the arrow under the
     * pointer while it is being placed, and the arrow the source compiles are
     * ONE shape by construction. Shape drawn again in this file would be a
     * second opinion about the arrow's length and proportions, free to drift.
     *
     * ============================================================
     * A SHAFT AND A HEAD - NOT A TRIANGLE
     * ============================================================
     *
     * A flow arrow is the conventional engineering direction arrow: a thin LINE
     * along the run, with a small head at its tip. The head is a quarter of the
     * arrow's length, so the shaft is always the longer part - at every size,
     * in every style - and the symbol reads as direction on a run rather than as
     * a filled shape sitting on it.
     */
    const shape = enggFlowArrow.flowArrowShape(entity);

    if (!shape) {
        return true;
    }

    const style = entity?.style || {};
    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const width = scaledStrokeWidth(style.lineWidth);

    /*
     * THE SHAFT. One line from the tail to the head's base, in the arrow's own
     * line style - so Solid, Dashed and Dotted apply to the stem, which is the
     * part of the symbol long enough to show a dash pattern at all.
     */
    const shaftStart = toScreen(shape.shaft.start);
    const shaftEnd = toScreen(shape.shaft.end);

    svg.appendChild(createSvgElement("line", {
        x1: shaftStart.x,
        y1: shaftStart.y,
        x2: shaftEnd.x,
        y2: shaftEnd.y,
        stroke,
        "stroke-width": width,
        "stroke-linecap": "round",
        ...(dash ? { "stroke-dasharray": dash } : {})
    }));

    const screenTip = toScreen(shape.tip);
    const screenBarbFirst = toScreen(shape.barbFirst);
    const screenBarbSecond = toScreen(shape.barbSecond);

    const d =
        `M ${screenTip.x} ${screenTip.y} ` +
        `L ${screenBarbFirst.x} ${screenBarbFirst.y} ` +
        `L ${screenBarbSecond.x} ${screenBarbSecond.y} Z`;

    /*
     * THE HEAD IS OUTLINED ALWAYS, AND FILLED ONLY WHEN ASKED.
     *
     * Arrowhead Fill decides whether the little head is solid or open - it
     * fills the HEAD, never the arrow, and it does not touch the shaft. An
     * unfilled head is drawn as its outline alone, which is the open arrow of a
     * conventional drawing.
     */
    const filled = style.headingFillMode === "solid";

    if (filled) {
        svg.appendChild(createSvgElement("path", {
            d,
            fill: paintColour(style.headingFill || style.stroke || enggTheme.defaultLineColour()),
            stroke: "none"
        }));
    }

    svg.appendChild(createSvgElement("path", {
        d,
        fill: "none",
        stroke,
        "stroke-width": width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
    }));

    parentSvg.appendChild(svg);
    return true;
}

/*
 * ============================================================
 * A NOTE ON ORIENTATION, CONFIRMED AGAINST THE REAL ENGINE
 * ============================================================
 *
 * The compiled picture this renderer draws is Y-FLIPPED: a Point Force
 * written `(0,0) -- (100,0)` compiles to a segment ending at the picture's
 * RIGHT, while the same command compiled by the bundled TikZ service alone
 * puts it on the LEFT. The flip is therefore this drawing pipeline's own
 * convention, applied after compilation.
 *
 * EVERY SHAPE ABOVE IS UNAFFECTED, because each is emitted from its model
 * coordinates through `toScreen` and the flip is applied to the whole layer.
 * The Flow Arrow is no exception: it emits the shaft's two ends and the
 * head's three corners exactly as the model resolves them, and its arrowhead
 * therefore lands on the same side as the force arrow above - i.e. it agrees
 * with every other directional symbol in the drawing.
 *
 * This is recorded rather than corrected. "Correcting" it here would turn the
 * Flow Arrow's head round in the DRAWING while the source, the handles and
 * the hit test all still pointed the other way - and it would leave this one
 * symbol disagreeing with every arrow beside it.
 */

/* ============================================================
 * THE REDUCER / EXPANDER
 * ============================================================
 *
 * Two walls that taper from one connected segment's width to the other's. The
 * taper comes from the model (`wallsOf`), which reads BOTH pipes' separations -
 * so the fitting meets each run's walls exactly, and moving or widening either
 * run re-shapes it on the next frame with no update step.
 *
 * A filled taper is the closed region between its two walls, drawn behind them.
 */
export function drawReducer({ svg, parentSvg, entity, style, toScreen }) {
    const walls = enggReducer.wallsOf(entity, drawingState.objects);

    if (!walls) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const width = scaledStrokeWidth(style.lineWidth);

    if (style.fillMode === "solid") {
        const points = [walls.start.a, walls.end.a, walls.end.b, walls.start.b]
            .map(toScreen)
            .map((point) => `${point.x},${point.y}`)
            .join(" ");

        svg.appendChild(createSvgElement("polygon", {
            points,
            fill: paintColour(style.fill || stroke),
            stroke: "none"
        }));
    }

    walls.walls.forEach((wall) => {
        const from = toScreen(wall.start);
        const to = toScreen(wall.end);

        svg.appendChild(createSvgElement("line", {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke,
            "stroke-width": width,
            "stroke-linecap": "round",
            ...(dash ? { "stroke-dasharray": dash } : {})
        }));
    });

    parentSvg.appendChild(svg);
    return true;
}

/* ============================================================
 * THE INLINE EQUIPMENT - PUMP, VALVE, FLOW METER
 * ============================================================
 *
 * The symbol's own strokes and fills, from the model, placed by its own frame.
 * There is no branch per type here: the model says what the symbol is made of,
 * so a depiction change or a new equipment type draws itself.
 */
export function drawEquipment({ svg, parentSvg, entity, style, toScreen }) {
    const frame = enggEquipment.frameOf(entity);

    if (!frame) {
        return true;
    }

    const shape = enggEquipment.symbolGeometry(entity);

    if (!shape.strokes.length && !shape.fills.length) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const width = scaledStrokeWidth(style.lineWidth);

    /*
     * A LENGTH DRAWS AT THE CAMERA'S SCALE. The symbol's radius is a length in
     * world units, not a point, so it is measured from one placed unit rather
     * than stored as a pixel size - which is what keeps it the right size at
     * every zoom and in the exported picture.
     */
    const scale = lengthScaleOf(toScreen);

    const place = (local) => toScreen(localToDrawing(frame, local));

    const filled = style.fillMode === "solid";
    const fillInk = paintColour(style.fill || stroke);

    shape.fills.forEach((part) => {
        if (part.kind === "polygon") {
            const points = part.points.map(place).map((point) => `${point.x},${point.y}`).join(" ");

            svg.appendChild(createSvgElement("polygon", {
                points,
                fill: filled || part.fillsWith === "stroke" ? (part.fillsWith === "stroke" ? stroke : fillInk) : "none",
                stroke: "none"
            }));

            return;
        }

        if (part.kind === "dot") {
            const at = place(part.centre);

            svg.appendChild(createSvgElement("circle", {
                cx: at.x,
                cy: at.y,
                r: Math.max(0.9, part.radius * scale),
                fill: stroke,
                stroke: "none"
            }));
        }
    });

    shape.strokes.forEach((part) => {
        if (part.kind === "circle") {
            const centre = place(part.centre);

            svg.appendChild(createSvgElement("circle", {
                cx: centre.x,
                cy: centre.y,
                r: part.radius * scale,
                fill: filled ? fillInk : "none",
                stroke,
                "stroke-width": width,
                ...(dash ? { "stroke-dasharray": dash } : {})
            }));

            return;
        }

        if (part.kind === "polygon") {
            const points = part.points.map(place).map((point) => `${point.x},${point.y}`).join(" ");

            svg.appendChild(createSvgElement("polygon", {
                points,
                fill: "none",
                stroke,
                "stroke-width": width,
                "stroke-linejoin": "round",
                ...(dash ? { "stroke-dasharray": dash } : {})
            }));

            return;
        }

        if (part.kind === "line") {
            const from = place(part.start);
            const to = place(part.end);

            svg.appendChild(createSvgElement("line", {
                x1: from.x,
                y1: from.y,
                x2: to.x,
                y2: to.y,
                stroke,
                "stroke-width": width,
                "stroke-linecap": "round",
                ...(dash ? { "stroke-dasharray": dash } : {})
            }));
        }
    });

    parentSvg.appendChild(svg);
    return true;
}

/* The symbol's own frame, as the one transform the model states. */
function localToDrawing(frame, local) {
    return enggEquipment.localToWorld(frame, local);
}

/*
 * THE PIXELS ONE WORLD UNIT DRAWS AT, for a length the symbol stores.
 *
 * A symbol's radius is a LENGTH, not a point: it is placed relative to its
 * centre, and then drawn at the camera's scale - the same way a pipe's wall
 * offset is. Reading it from two placed points keeps it exact at every zoom.
 */
function lengthScaleOf(toScreen) {
    const origin = toScreen({ x: 0, y: 0 });
    const unit = toScreen({ x: 1, y: 0 });

    return Math.max(1e-6, Math.hypot(unit.x - origin.x, unit.y - origin.y));
}

/* ============================================================
 * THE RESERVOIR / TANK
 * ============================================================
 *
 * Three walls (plus a top for a closed tank), one object. An open reservoir's
 * mouth is open - it is not drawn - which is the whole visual difference.
 */
export function drawVessel({ svg, parentSvg, entity, toScreen }) {
    const segments = enggVessel.vesselSegments(entity);

    if (!segments.length) {
        return true;
    }

    const style = entity?.style || {};
    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const width = scaledStrokeWidth(style.lineWidth);

    if (style.fillMode === "solid") {
        const points = enggVessel
            .vesselOutline(entity)
            .map(toScreen)
            .map((point) => `${point.x},${point.y}`)
            .join(" ");

        svg.appendChild(createSvgElement("polygon", {
            points,
            fill: paintColour(style.fill || stroke),
            stroke: "none"
        }));
    }

    segments.forEach((segment) => {
        const from = toScreen(segment.start);
        const to = toScreen(segment.end);

        svg.appendChild(createSvgElement("line", {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke,
            "stroke-width": width,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            ...(dash ? { "stroke-dasharray": dash } : {})
        }));
    });

    parentSvg.appendChild(svg);
    return true;
}

/* ============================================================
 * THE FLUID LEVEL
 * ============================================================
 *
 * One line across the vessel's interior, at the stored height. Its ends come
 * from the VESSEL, so it can never draw through a wall or outlive its host.
 */
export function drawFluidLevel({ svg, parentSvg, entity, toScreen }) {
    const segment = enggFluidLevel.levelSegment(entity, drawingState.objects);

    if (!segment) {
        return true;
    }

    const style = entity?.style || {};
    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());

    /* The level's convention is a dashed line; the student's line type overrides it. */
    const dash = dashPatternFor(style.lineType) || "8 5";

    const from = toScreen(segment.start);
    const to = toScreen(segment.end);

    svg.appendChild(createSvgElement("line", {
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        stroke,
        "stroke-width": scaledStrokeWidth(style.lineWidth),
        "stroke-linecap": "round",
        "stroke-dasharray": dash
    }));

    parentSvg.appendChild(svg);
    return true;
}

/* ============================================================
 * THE FREE FLOW ARROW
 * ============================================================
 *
 * A shaft with a head at its tip, drawn along the two points the student
 * dragged. It is ONE object: the head is the arrow's end, not a second shape.
 */
export function drawFreeFlowArrow({ svg, parentSvg, entity, style, toScreen }) {
    const span = enggFlowArrows.freeArrowSpan(entity);

    if (!span) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const width = scaledStrokeWidth(style.lineWidth);

    const head = Math.max(1, Math.min(span.length * 0.3, Number(style.arrowSize) > 0 ? Number(style.arrowSize) / 2.4 * 10 : 5));
    const half = head * 0.42;

    const across = { x: -span.direction.y, y: span.direction.x };

    const base = {
        x: span.end.x - span.direction.x * head,
        y: span.end.y - span.direction.y * head
    };

    const from = toScreen(span.start);
    const to = toScreen(base);

    svg.appendChild(createSvgElement("line", {
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        stroke,
        "stroke-width": width,
        "stroke-linecap": "round",
        ...(dash ? { "stroke-dasharray": dash } : {})
    }));

    const tip = toScreen(span.end);
    const barbFirst = toScreen({ x: base.x + across.x * half, y: base.y + across.y * half });
    const barbSecond = toScreen({ x: base.x - across.x * half, y: base.y - across.y * half });

    const d = `M ${tip.x} ${tip.y} L ${barbFirst.x} ${barbFirst.y} L ${barbSecond.x} ${barbSecond.y} Z`;

    if (style.headingFillMode === "solid") {
        svg.appendChild(createSvgElement("path", {
            d,
            fill: paintColour(style.headingFill || style.stroke || enggTheme.defaultLineColour()),
            stroke: "none"
        }));
    }

    svg.appendChild(createSvgElement("path", {
        d,
        fill: "none",
        stroke,
        "stroke-width": width,
        "stroke-linejoin": "round"
    }));

    parentSvg.appendChild(svg);
    return true;
}

/* ============================================================
 * THE FLOW DIRECTION DIAGRAM
 * ============================================================
 *
 * One or more arrows ON a pipe's centreline, pointing along it (or against it),
 * derived from the annotation and its host - so a moved or re-angled pipe takes
 * its arrows with it.
 */
export function drawFlowDirection({ svg, parentSvg, entity, style, toScreen }) {
    const shapes = enggFlowArrows.directionArrowShapes(entity, drawingState.objects);

    if (!shapes.length) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const dash = dashPatternFor(style.lineType);
    const width = scaledStrokeWidth(style.lineWidth);

    shapes.forEach((shape) => {
        const head = Math.max(1, shape.length * 0.38);
        const base = {
            x: shape.end.x - shape.direction.x * head,
            y: shape.end.y - shape.direction.y * head
        };

        const from = toScreen(shape.start);
        const to = toScreen(shape.end);

        svg.appendChild(createSvgElement("line", {
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke,
            "stroke-width": width,
            "stroke-linecap": "round",
            ...(dash ? { "stroke-dasharray": dash } : {})
        }));

        const across = { x: -shape.direction.y, y: shape.direction.x };
        const half = head * 0.45;

        const tip = toScreen(shape.end);
        const barbFirst = toScreen({ x: base.x + across.x * half, y: base.y + across.y * half });
        const barbSecond = toScreen({ x: base.x - across.x * half, y: base.y - across.y * half });

        svg.appendChild(createSvgElement("path", {
            d: `M ${tip.x} ${tip.y} L ${barbFirst.x} ${barbFirst.y} L ${barbSecond.x} ${barbSecond.y} Z`,
            fill: style.headingFillMode === "solid" ? stroke : "none",
            stroke,
            "stroke-width": width,
            "stroke-linejoin": "round"
        }));
    });

    parentSvg.appendChild(svg);
    return true;
}

/* ============================================================
 * THE PRESSURE PROFILE
 * ============================================================
 *
 * The frame, the two axes, optional grid and ticks, the plotted points and the
 * straight line through them. EVERY coordinate is derived from the student's
 * rows and the four limits - nothing is interpolated and no point is invented.
 */
export function drawPressureProfile({ svg, parentSvg, entity, style, toScreen }) {
    const frame = enggPressureProfile.profileFrame(entity);
    const area = enggPressureProfile.plotArea(entity);

    if (!frame || !area) {
        return true;
    }

    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const width = scaledStrokeWidth(style.lineWidth);
    const muted = paintColour(enggTheme.defaultLineColour());

    const axes = enggPressureProfile.axesOf(entity);

    const strokeLine = (from, to, extra = {}) => {
        const a = toScreen(from);
        const b = toScreen(to);

        svg.appendChild(createSvgElement("line", {
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            stroke,
            "stroke-width": width,
            "stroke-linecap": "round",
            ...extra
        }));
    };

    /* The frame itself - the graph's boundary, so it is visibly a placed object. */
    const corners = [
        { x: frame.position.x, y: frame.position.y },
        { x: frame.position.x + frame.width, y: frame.position.y },
        { x: frame.position.x + frame.width, y: frame.position.y + frame.height },
        { x: frame.position.x, y: frame.position.y + frame.height }
    ];

    for (let index = 0; index < 4; index += 1) {
        strokeLine(corners[index], corners[(index + 1) % 4], { "stroke-width": Math.max(0.5, width * 0.6) });
    }

    /* The two axes. */
    strokeLine(area.origin, area.xEnd, { "stroke-width": width });
    strokeLine(area.origin, area.yEnd, { "stroke-width": width });

    /* Grid and ticks, drawn lightly so the data reads first. */
    if (enggPressureProfile.showGridOf(entity)) {
        enggPressureProfile.ticksFor(axes.xMin, axes.xMax).forEach((value) => {
            const at = enggPressureProfile.dataToDrawing(entity, { position: value, pressure: axes.yMin });

            if (at) {
                strokeLine(at, { x: at.x, y: area.top }, { stroke: muted, "stroke-width": Math.max(0.4, width * 0.5), "stroke-dasharray": "3 4" });
            }
        });

        enggPressureProfile.ticksFor(axes.yMin, axes.yMax).forEach((value) => {
            const at = enggPressureProfile.dataToDrawing(entity, { position: axes.xMin, pressure: value });

            if (at) {
                strokeLine(at, { x: area.right, y: at.y }, { stroke: muted, "stroke-width": Math.max(0.4, width * 0.5), "stroke-dasharray": "3 4" });
            }
        });
    }

    /* The plotted data: the points, and a straight segment from each to the next. */
    const points = enggPressureProfile.plottedPoints(entity);

    if (points.length > 1) {
        const d = points.map((point, index) => {
            const at = toScreen(point);

            return `${index ? "L" : "M"} ${at.x} ${at.y}`;
        }).join(" ");

        svg.appendChild(createSvgElement("path", {
            d,
            fill: "none",
            stroke,
            "stroke-width": width,
            "stroke-linejoin": "round",
            "stroke-linecap": "round"
        }));
    }

    if (enggPressureProfile.showPointsOf(entity)) {
        points.forEach((plot) => {
            const at = toScreen(plot);

            svg.appendChild(createSvgElement("circle", {
                cx: at.x,
                cy: at.y,
                r: 3,
                fill: paintColour(style.fill || stroke),
                stroke
            }));
        });
    }

    /*
     * THE AXES' OWN TEXT: the tick values, the axis titles and their units, and
     * the graph's name. They are DERIVED from the same `axes` fields the Features
     * tab edits, so a retitled axis or a changed limit moves the visible text with
     * it - the picture never states a scale the panel does not hold.
     */
    const label = (x, y, text, { anchor = "middle", size = 11, baseline = "middle" } = {}) => {
        if (!String(text ?? "").trim()) {
            return;
        }

        const at = toScreen({ x, y });

        const node = createSvgElement("text", {
            x: at.x,
            y: at.y,
            fill: stroke,
            "font-size": size,
            "text-anchor": anchor,
            "dominant-baseline": baseline
        });

        node.textContent = String(text);

        svg.appendChild(node);
    };

    const round = (value) => {
        const number = Number(value);

        return Number.isFinite(number) ? String(Number(number.toFixed(3))) : "";
    };

    enggPressureProfile.ticksFor(axes.xMin, axes.xMax).forEach((value) => {
        const at = enggPressureProfile.dataToDrawing(entity, { position: value, pressure: axes.yMin });

        if (at) {
            label(at.x, at.y - frame.height * 0.045, round(value), { size: 9 });
        }
    });

    enggPressureProfile.ticksFor(axes.yMin, axes.yMax).forEach((value) => {
        const at = enggPressureProfile.dataToDrawing(entity, { position: axes.xMin, pressure: value });

        if (at) {
            label(at.x - frame.width * 0.02, at.y, round(value), { anchor: "end", size: 9 });
        }
    });

    const unitSuffix = (unit) => (String(unit ?? "").trim() ? ` (${String(unit).trim()})` : "");

    label(
        (area.left + area.right) / 2,
        frame.position.y + frame.height * 0.035,
        `${axes.xTitle}${unitSuffix(axes.xUnit)}`,
        { size: 11 }
    );

    label(
        frame.position.x + frame.width * 0.02,
        (area.bottom + area.top) / 2,
        `${axes.yTitle}${unitSuffix(axes.yUnit)}`,
        { size: 11, anchor: "start" }
    );

    if (enggPressureProfile.graphNameOf(entity).trim()) {
        label(
            frame.position.x + frame.width / 2,
            frame.position.y + frame.height - frame.height * 0.025,
            enggPressureProfile.graphNameOf(entity),
            { size: 12 }
        );
    }

    parentSvg.appendChild(svg);
    return true;
}

/* ============================================================
 * THE SECTION PLANE
 * ============================================================
 *
 * The trace, the two viewing arrows and the student's own identifier - one
 * object. The identifier is drawn only when the student typed one.
 */
export function drawSectionPlane({ svg, parentSvg, entity, toScreen }) {
    const span = enggSectionPlane.sectionSpan(entity);

    if (!span) {
        return true;
    }

    const style = entity?.style || {};
    const stroke = paintColour(style.stroke || enggTheme.defaultLineColour());
    const width = scaledStrokeWidth(style.lineWidth);

    const from = toScreen(span.start);
    const to = toScreen(span.end);

    svg.appendChild(createSvgElement("line", {
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        stroke,
        "stroke-width": width,
        "stroke-linecap": "round",

        /* The section trace's convention: a long dash unless the student says otherwise. */
        "stroke-dasharray": dashPatternFor(style.lineType) || "8 5"
    }));

    if (enggSectionPlane.showSectionArrowsOf(entity)) {
        enggSectionPlane.sectionArrows(entity).forEach((arrow) => {
            const start = toScreen(arrow.start);
            const end = toScreen(arrow.end);

            svg.appendChild(createSvgElement("line", {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                stroke,
                "stroke-width": width,
                "stroke-linecap": "round"
            }));

            /* The head: a small V at the arrow's end, in the same ink. */
            const across = { x: -arrow.direction.y, y: arrow.direction.x };
            const back = { x: arrow.end.x - arrow.direction.x * 1.6, y: arrow.end.y - arrow.direction.y * 1.6 };

            [1, -1].forEach((side) => {
                const barb = toScreen({
                    x: back.x + across.x * 0.9 * side,
                    y: back.y + across.y * 0.9 * side
                });

                svg.appendChild(createSvgElement("line", {
                    x1: end.x,
                    y1: end.y,
                    x2: barb.x,
                    y2: barb.y,
                    stroke,
                    "stroke-width": width,
                    "stroke-linecap": "round"
                }));
            });
        });
    }

    const identifier = enggSectionPlane.sectionIdentifierOf(entity);

    if (identifier.trim()) {
        const at = toScreen(enggSectionPlane.sectionLabelPoint(entity));

        const text = createSvgElement("text", {
            x: at.x,
            y: at.y,
            fill: stroke,
            "font-size": 12,
            "text-anchor": "middle",
            "dominant-baseline": "middle"
        });

        text.textContent = identifier;

        svg.appendChild(text);
    }

    parentSvg.appendChild(svg);
    return true;
}
