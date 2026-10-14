/*
 * Vector arrows: forces, distributed-load arrow fields, arrowheads and the
 * moment's rotational arrow.
 *
 * Part of the renderer (see renderer.js), split out by concern.
 */
import enggLoadProfile from "../features/analysis/load-profile.js";
import enggDrawingRotationalArrow from "../features/analysis/rotational-arrow.js";
import enggTheme from "../editor/workspace/theme.js";
import { createSvgElement, paintColour, scaledStrokeWidth } from "./svg-primitives.js";
import { arrowHeadSize } from "./dimension-render.js";


    /*
     * ========================================================
     * A DIRECTION, IN SCREEN SPACE
     * ========================================================
     *
     * TWO WAYS TO KNOW WHICH WAY A VECTOR POINTS, BOTH HANDLED HERE.
     *
     * A force is stored either as two endpoints with the head on one of
     * them, or as a magnitude and an angle. Both are ordinary, and both
     * reach the same shared arrow - so the difference is settled in one
     * place rather than at each call site, where getting it wrong draws a
     * force pointing the wrong way with no error to notice.
     *
     * FROM TWO POINTS: measure the difference. There is no sign to get
     * wrong here, which is the reason this is the preferred form wherever
     * it is available.
     *
     * FROM AN ANGLE: the angle is an ENGINEERING one - measured from the
     * positive x axis, anticlockwise, in a world whose y grows upward. It
     * is turned into a WORLD point one unit away from the world
     * application point and then PROJECTED, rather than being converted by
     * hand.
     *
     * THE WORLD POINT HAS TO BE A WORLD POINT.
     *
     * Adding a world-space offset to an already-projected point mixes the
     * two frames: the offset gets scaled and inverted a second time, which
     * turned a force pointing straight up into one pointing up-and-to-the-
     * right by whatever amount the projection happened to add. The offset
     * is therefore measured from the world application point, and only the
     * result is projected - so the inversion happens exactly once, inside
     * the one function that owns it.
     */
    function forceDirectionOnScreen(
        head,
        tail
    ) {
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;

        const length = Math.hypot(dx, dy);

        if (!(length > 0)) {
            /*
             * A zero-length vector has no direction. Rather than invent
             * one, this returns "no direction" and the arrow is not drawn:
             * a force of magnitude zero is nothing to see, and a default
             * arrow pointing right would be a claim about it.
             */
            return null;
        }

        return { x: dx / length, y: dy / length };
    }

    /* Available to callers of this module;
     * closure; the angle path routes through it. */
    function toScreenUnitDirection(
        toScreen,
        worldAnchor,
        geometry
    ) {
        const angle = Number(geometry.angle);

        if (!Number.isFinite(angle)) {
            return null;
        }

        const radians = angle * Math.PI / 180;

        /*
         * ONE UNIT OF THE WORLD VECTOR, projected by the same transform as
         * every other point. The direction that comes back is in screen
         * units per world unit of the vector, which is the only sense in
         * which a direction exists on the sheet.
         */
        return forceDirectionOnScreen(
            toScreen({
                x: worldAnchor.x + Math.cos(radians),
                y: worldAnchor.y + Math.sin(radians)
            }),
            toScreen(worldAnchor)
        );
    }

    /*
     * ========================================================
     * ONE VECTOR ARROW, IN SCREEN SPACE
     * ========================================================
     *
     * The single place a Statics vector becomes ink. A Point Force, a
     * Resultant, each of a Force Components' three vectors, and a
     * Distributed Load's arrows all come through here, so an arrowhead is
     * computed one way for all of them.
     *
     * WHY IT TAKES TWO POINTS AND NOT AN ANGLE
     * ----------------------------------------
     * The previous version of this took an `angleDegrees` and a
     * `length`, and reconstructed the tip as
     *
     *     y: anchor.y - Math.sin(radians) * length
     *
     * That leading minus is the bug. `anchor` is already a SCREEN point,
     * and screen y grows DOWNWARD, so subtracting the vertical component
     * sent every force drawn through this path to the wrong side of its
     * application point: a force pointing up was drawn pointing down.
     *
     * The caller at the time made it look right by handing in a negated
     * angle (`Math.atan2(-dy, dx)`), so the two sign errors cancelled and
     * the picture happened to be correct - which is exactly why it survived.
     * Two wrongs in one place is not a working arrangement: it cannot be
     * changed, reused for a new vector type, or reasoned about without
     * working out which of the two signs is wrong for a given quadrant.
     *
     * The fix is not to correct the sign but to remove the need for one.
     * A caller that already HAS both ends - which is every vector in this
     * module, since engineering geometry is stored as a tail and a head -
     * hands both over, and the arrowhead direction is measured from them:
     *
     *     angle = atan2(headScreen.y - tailScreen.y,
     *                   headScreen.x - tailScreen.x)
     *
     * ONE conversion, in ONE place: world to screen, at the boundary,
     * through `toScreen`. The engineering vector keeps its own signs, and
     * nothing downstream has to know that the sheet is drawn upside down
     * relative to the axes.
     *
     * The two points are the whole truth about a vector, so a magnitude of
     * zero is now visible as two coincident points rather than having to
     * be inferred from an angle of 0 and a length of 0.
     */
    function appendVectorArrow(
        svg,
        tail,
        head,
        stroke,
        style,
        kind = "solid"
    ) {
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;

        const length = Math.hypot(dx, dy);

        if (length < 0.01) {
            return;
        }

        const construction = kind === "construction";

        svg.appendChild(
            createSvgElement("line", {
                x1: tail.x,
                y1: tail.y,
                x2: head.x,
                y2: head.y,
                stroke,
                "stroke-width":
                    scaledStrokeWidth(
                        Number(style.lineWidth) || 0.5
                    ),
                "stroke-linecap": "round",
                ...(construction
                    ? {
                        "stroke-dasharray": "4 3"
                    }
                    : {})
            })
        );

        if (construction) {
            return;
        }

        /*
         * The head is sized from the line weight like every other
         * arrowhead on the sheet, so a thicker analysis line gets a
         * thicker head rather than the same small triangle that reads
         * as a mistake.
         */
        appendArrowHead(
            svg,
            head,
            Math.atan2(dy, dx),
            stroke,
            arrowHeadSize(
                Number(style.lineWidth) || 0.5
            )
        );
    }

    /*
     * The Analysis tool icons' geometry lives in the same file as the
     * drawing, so an icon and the thing it draws cannot drift apart.
     */
    /*
     * ========================================================
     * A POINT FORCE, AS A VECTOR
     * ========================================================
     *
     * A FORCE IS A VECTOR, so it is drawn by the shared arrow rather than
     * by a routine of its own. This only decides where the two ends are.
     *
     * A force is stored as a fixed pair of endpoints with the arrowhead
     * on one of them, so both ends are known in engineering coordinates and
     * both go through the same projection. There is no angle to recover and
     * no length to rebuild, which is what removes the sign error this used
     * to carry: see appendVectorArrow above.
     */
    function appendForceArrow(
        svg,
        anchor,
        direction,
        length,
        stroke,
        style
    ) {
        /*
         * No direction means nothing to draw, which is what a zero-length
         * vector means and is the only honest reading of it.
         */
        if (!direction) {
            return;
        }

        appendVectorArrow(
            svg,
            anchor,
            {
                x: anchor.x + direction.x * length,
                y: anchor.y + direction.y * length
            },
            stroke,
            style
        );
    }

    /*
     * HOW WIDE AN ARROWHEAD OPENS.
     *
     * The half-angle at the tip, in radians. 0.4 is about 23 degrees each
     * side, which is a long thin head that stays legible on a 0.5 mm shaft
     * without swallowing it.
     *
     * NAMED rather than written as a literal at the two places that need
     * it, because the previous code had 0.4 twice - once per base corner -
     * and two copies of a shape parameter is two chances for them to
     * disagree about how big a head is.
     */
    const ARROW_HEAD_SPREAD = 0.4;

    /*
     * THE TWO BASE CORNERS OF AN ARROWHEAD, one either side of the shaft.
     *
     * Returned rather than appended so that every head on the sheet - the
     * shared vector arrow, the distributed loads' arrows - is built from
     * the same two points. There were three head builders before this, each
     * with its own copy of the shape, and one of them had a sign wrong in a
     * way that was invisible on the axes and wrong on the diagonals. A
     * shape that has been got wrong once should not be reachable twice.
     *
     * BUILT FROM THE AXIS, not by rotating a polar angle. Going backwards
     * from the tip by `theta +/- spread` only produces a symmetric head if
     * both the cosine and the sine are negated; rotating one way and adding
     * the other walks both corners off to the same side.
     */
    function arrowHeadCorners(
        tip,
        radians,
        head
    ) {
        /* The unit axis, pointing the way the arrow points. On screen, so
         * y grows downward and no further inversion belongs here. */
        const axis = {
            x: Math.cos(radians),
            y: Math.sin(radians)
        };

        /* ACROSS the axis, at right angles. */
        const across = {
            x: -axis.y,
            y: axis.x
        };

        const back =
            head * Math.cos(ARROW_HEAD_SPREAD);

        const halfWidth =
            head * Math.sin(ARROW_HEAD_SPREAD);

        return [
            {
                x:
                    tip.x -
                    axis.x * back +
                    across.x * halfWidth,
                y:
                    tip.y -
                    axis.y * back +
                    across.y * halfWidth
            },
            {
                x:
                    tip.x -
                    axis.x * back -
                    across.x * halfWidth,
                y:
                    tip.y -
                    axis.y * back -
                    across.y * halfWidth
            }
        ];
    }

    /*
     * ========================================================
     * A FILLED ARROW HEAD POINTING ALONG A SCREEN ANGLE
     * ========================================================
     *
     * Three points: the tip, and the two base corners `headSize` back from
     * it, one either side of the shaft's axis.
     *
     * ========================================================
     * THE BASE CORNERS WERE ON THE WRONG SIDE OF THE AXIS
     * ========================================================
     *
     * They were placed at
     *
     *     tip.x - head * cos(radians -/+ 0.4)
     *     tip.y + head * sin(radians -/+ 0.4)
     *
     * Note the signs. The x term subtracts and the y term ADDS. For a
     * triangle that is symmetric about the axis, the y term has to
     * subtract too: rotating backwards from the tip by `theta - 0.4` and by
     * `theta + 0.4` walks the axis in opposite directions, and only the
     * cos/sin pair with the SAME sign on both components puts the corners
     * on opposite sides.
     *
     * WITH `+ sin` THE TWO CORNERS LAND ON THE SAME SIDE, and how badly it
     * goes wrong depends on the direction:
     *
     *     angle 0    (horizontal)   looks correct - cos and sin are
     *                               symmetric about 0, so the flip is
     *                               invisible
     *     angle 90   (vertical)     looks correct - sin is symmetric about
     *                               pi/2
     *     angle 45, 135, -45       WRONG - both corners on one side, and
     *                               the head reads as a fin rather than
     *                               an arrow
     *
     * So the bug was invisible on exactly the two axes and broken on the
     * diagonals - which is why it survived being written down as correct,
     * and why every test that used a horizontal or vertical force passed.
     * A test that checks where the TIP is cannot see it at all: the tip
     * was always right.
     */
    function appendArrowHead(
        svg,
        tip,
        radians,
        stroke,
        head
    ) {
        const [left, right] =
            arrowHeadCorners(
                tip,
                radians,
                head
            );

        svg.appendChild(
            createSvgElement("polygon", {
                points: [
                    `${tip.x},${tip.y}`,
                    `${left.x},${left.y}`,
                    `${right.x},${right.y}`
                ].join(" "),
                fill: stroke,
                stroke: "none"
            })
        );
    }

    /*
     * The two ends of one drawn force, as distinct geometry.
     *
     * A force is a LINE with a fixed pair of endpoints, and which
     * end carries the arrowhead is a SEPARATE fact about it. Keeping
     * the two apart is what makes reversing a direction impossible to
     * do by accident:
     *
     *   application - the point on the body where the force acts.
     *                 It is the physical meaning of the load and
     *                 must never move.
     *   far        - the other end of the drawn line. It is a fixed
     *                 piece of geometry, and it must not move either.
     *
     * ========================================================
     * THE LINE IS THE LOAD; THE HEAD IS WHICH WAY IT PUSHES
     * ========================================================
     *
     * The shaft is drawn ALONG THE FORCE DIRECTION itself, so an arrow
     * points the way the load acts - up, down, left, right or any diagonal -
     * and a load at 45 degrees on a level beam genuinely appears at 45
     * degrees rather than being snapped onto the body's normal.
     *
     * `bodyNormal` is still handed in, and still decides which SIDE of the
     * body the arrow is drawn FROM when the direction is square to the span
     * (the ordinary case, where the two agree). The direction is what places
     * the far end; the normal only tells the renderer which of the direction
     * and its opposite is the side the load acts from, so a "down" load hangs
     * below a level beam rather than lying along it.
     */
    function forceEndpoints(
        application,
        direction,
        length,
        bodyNormal
    ) {
        /*
         * THE DIRECTION IS THE LINE. Its screen projection is the only thing
         * that decides where the far end sits, so two loads that differ only
         * in direction draw two different lines - which is the whole point of
         * a direction being a real vector.
         */
        const screenDirection = {
            x: direction.x,
            y: -direction.y
        };

        /*
         * A DEGENERATE DIRECTION - one that could not be read from the
         * pointer - falls back to the span's own normal, so a load that lost
         * its direction still draws the field of arrows it always drew rather
         * than collapsing to a point.
         */
        const usable =
            Math.abs(screenDirection.x) > 1e-9 ||
            Math.abs(screenDirection.y) > 1e-9;

        const screenAway =
            usable
                ? screenDirection
                : bodyNormal
                    ? { x: bodyNormal.x, y: -bodyNormal.y }
                    : { x: 0, y: 1 };

        return {
            application,
            far: {
                x:
                    application.x +
                    screenAway.x * length,
                y:
                    application.y +
                    screenAway.y * length
            }
        };
    }

    /*
     * Where the arrowhead goes on a force line.
     *
     * Reversal flips WHICH endpoint is the head. It does not change
     * the line, so this is a choice between two points that both
     * already exist.
     */
    function arrowheadTip(
        endpoints,
        direction,
        reversed
    ) {
        return reversed
            ? endpoints.application
            : endpoints.far;
    }

    /*
     * The direction the head POINTS, for its own geometry.
     *
     * The head sits on ONE endpoint and points along the line,
     * outward, AWAY from the other endpoint. That is what makes it
     * an arrowhead rather than a fin: the apex is the extreme point
     * of the triangle and the base sits back along the shaft, so the
     * head is attached to the line and its tip is on the endpoint.
     *
     * The head is built from this vector as
     * `tip - head * direction` for the two base corners, so the sign
     * matters: a vector pointing back INTO the line puts the base
     * beyond the endpoint and the tip at the far end of the base,
     * which draws the arrowhead outside the force and pointing the
     * wrong way. Both branches below therefore point outward, away
     * from whichever endpoint is NOT carrying the head:
     *
     *   normal    head on the far end,     points far - application
     *   reversed  head on the application, points application - far
     */
    function arrowheadDirection(
        endpoints,
        reversed
    ) {
        return reversed
            ? {
                  x:
                      endpoints.application.x -
                      endpoints.far.x,
                  y:
                      endpoints.application.y -
                      endpoints.far.y
              }
            : {
                  x:
                      endpoints.far.x -
                      endpoints.application.x,
                  y:
                      endpoints.far.y -
                      endpoints.application.y
              };
    }

    /*
     * The screen length of one arrow of a distributed load.
     *
     * A load's arrows are drawn at the MAGNITUDE itself, in world
     * units converted to screen space by the caller. That is what
     * makes a heavier load look heavier: pulling the cursor
     * further from the body stores a larger magnitude, and the
     * arrow grows with it. There is no ceiling, because a capped
     * arrow stops telling the truth: the drawing would go on
     * saying "this is the biggest force here" for magnitudes
     * that differ several times over, and the student would be
     * shown a load that is not the one they built.
     *
     * The one thing that IS scaled is the head, which follows the
     * shaft rather than sitting at a fixed size, so a long arrow
     * does not end in a head too small to read.
     */
    /*
     * The shared Statics Vector Scale, read once per render.
     *
     * Read from the drawing rather than passed down through every
     * drawing routine, so there is exactly one place that decides how
     * large Statics arrows are and no drawing path can quietly use a
     * different one. A missing or unrecognised value falls back to 1,
     * which is how arrows were drawn before the setting existed.
     */
    function vectorScaleOf(state) {
        /*
         * The load drawing paths already guard their use of the profile,
         * so this guards it too. Falling back to 1 keeps arrows at their
         * true length rather than failing to draw.
         */
        if (typeof enggLoadProfile === "undefined") {
            return 1;
        }

        return enggLoadProfile.vectorScaleFor(state);
    }

    const DISTRIBUTED_LOAD_ARROW_MIN_PX = 2;

    /*
     * A distributed load's arrow length, from its intensity.
     *
     * `scale` is the canvas zoom. It is multiplied by the shared
     * Statics Vector Scale as well, so the arrows on screen are the true
     * intensities drawn at whatever size the user has asked for.
     *
     * The Vector Scale multiplies EVERY arrow by the SAME factor. It is
     * never applied per arrow, which is what keeps a varying load's
     * profile honest: a load rising from 2 to 8 stays in that 1:4
     * relationship at any scale. Normalising each arrow to fit would
     * flatten the profile and hide the very thing the diagram exists to
     * show, so one factor is applied to the whole representation and the
     * shape of it is untouched.
     *
     * The minimum is a legibility floor so a small load still has an
     * arrow that ends in a head big enough to read. It is applied AFTER
     * the scaling, so it cannot flatten the profile either - a tiny
     * arrow is clamped to readable size rather than stretched.
     */
    function distributedLoadArrowLength(
        magnitude,
        scale,
        vectorScale = 1
    ) {
        const world = Math.abs(
            Number(magnitude) || 0
        );

        if (world <= 0) {
            return 0;
        }

        return Math.max(
            DISTRIBUTED_LOAD_ARROW_MIN_PX,
            world *
                Math.max(scale, 1e-6) *
                Math.max(vectorScale, 1e-6)
        );
    }

    /*
     * A force line's weight as it is actually drawn on screen.
     *
     * The Features panel's Line Width is the weight of the feature
     * in world units, but a force's shaft is drawn at the screen
     * scale, so the width is converted the same way the arrow
     * length is. Reading it back as a raw number is what made a
     * thicker load look identical to a thin one: the stored value
     * differs, but the drawn stroke did not.
     */
    function forceStrokeWidth(
        style,
        scale
    ) {
        const width =
            Number(style?.lineWidth);

        if (!Number.isFinite(width) || width <= 0) {
            return 1.3;
        }

        return Math.max(
            0.8,
            width * Math.max(scale, 1e-6)
        );
    }

    /*
     * The head of a distributed load's arrow, scaled to its own
     * shaft so a short arrow and a long one both end in a head
     * that reads as part of the same line, and scaled to the shaft's
     * WEIGHT as well so a heavy force line ends in a heavy head.
     *
     * Sizing the head from the arrow's length alone is not enough:
     * two loads of equal magnitude drawn at different line widths
     * are the same length, and without the width term they would
     * finish in identical heads, so a heavier line would end in a
     * head too small to read as belonging to it.
     */
    function distributedLoadHeadSize(
        length,
        strokeWidth
    ) {
        const width = Math.max(0, Number(strokeWidth) || 0);

        /*
         * The head is a multiple of the SHAFT WIDTH, because the
         * shaft width is what the user actually sets with Line
         * Width, and that weight has to keep reading all the way
         * to the tip. A heavier force line has to end in a heavier
         * head, or the weight the user chose stops at the shaft.
         *
         * The arrow's length is a BOUND and nothing more. Letting
         * length raise the head is what produced the fixed-size
         * behaviour this replaces: a long arrow computed the same
         * oversized head whatever its shaft was doing, so width
         * stopped mattering the moment the arrow got long.
         *
         * The head may never exceed its own shaft, or it stops
         * reading as an arrow and becomes a separate mark.
         */
        return Math.max(
            3,
            Math.min(width * 5, length)
        );
    }

    /*
     * The filled head of a distributed load's arrow, as an SVG
     * points string.
     *
     * It is built from the screen-space direction the arrow was
     * drawn along, so the head is always square to its own shaft
     * no matter which way the load points.
     *
     * IT IS THE SAME HEAD AS EVERY OTHER ARROW, from the same corner
     * builder, with the load's own size. Only the size differs: a load's
     * head is sized from its shaft width and its arrow length, which are
     * things a load has and a plain vector does not.
     */
    function distributedLoadArrowHead(
        tip,
        screenDirection,
        length,
        strokeWidth
    ) {
        const radians =
            Math.atan2(
                screenDirection.y,
                screenDirection.x
            );

        const head =
            distributedLoadHeadSize(
                length,
                strokeWidth
            );

        const corners =
            arrowHeadCorners(
                tip,
                radians,
                head
            );

        return [
            `${tip.x},${tip.y}`,
            ...corners.map(
                corner => `${corner.x},${corner.y}`
            )
        ].join(" ");
    }

    /*
     * THE ROTATIONAL ARROW.
     *
     * One curved arrow, drawn for a Moment: a centre it turns about, a
     * radius, a sense of rotation, and a head ON the curve.
     *
     * The geometry itself - the sweep, the gap, the tangent and the
     * head - is asked of enggDrawingRotationalArrow rather than being
     * worked out here, so the drawing, the hit test and the Features
     * panel are all reading the same arc instead of three roughly
     * similar ones.
     *
     * The radius is a PRESENTATION value and nothing else. It is
     * taken from `arcRadius` when the student has set one and falls
     * back to the shared default otherwise, and it is never derived
     * from the magnitude: on a drawing a moment shows which way
     * something turns, and a moment that grew with its value would
     * be claiming an engineering meaning the symbol does not have.
     */
    function appendRotationalArrow(
        svg,
        center,
        clockwise,
        style = {},
        arcRadius
    ) {
        const rotational =
            enggDrawingRotationalArrow;

        if (!rotational) {
            return;
        }

        const stroke =
            paintColour(style.stroke || enggTheme.defaultLineColour());

        const arc =
            rotational.arcFor(
                center,
                clockwise,
                arcRadius
            );

        /*
         * The curve is drawn at the feature's OWN line weight, through
         * the same conversion every other line on the sheet uses. It
         * used to be a literal 1.6, which meant a moment on a 0.5 mm
         * sheet was drawn three times heavier than the beam it was
         * applied to, and changing the thickness in the panel did
         * nothing to it at all.
         */
        svg.appendChild(
            createSvgElement("path", {
                d: rotational.arcPath(arc),
                fill: "none",
                stroke,
                "stroke-width":
                    scaledStrokeWidth(
                        Number(style.lineWidth) || 0.5
                    ),
                "stroke-linecap": "round"
            })
        );

        /*
         * The head, sized from that same line weight so the two stay
         * in proportion, and placed at the arc's end along its
         * TANGENT - so it lies along the curve instead of pointing
         * inward at the centre, which is the difference between a
         * moment and a force arrow.
         */
        const lineWidth =
            Number(style.lineWidth) || 0.5;

        const head =
            rotational.headPoints(
                arc,
                arrowHeadSize(lineWidth) * 0.8
            );

        svg.appendChild(
            createSvgElement("polygon", {
                points: head
                    .map(
                        (point) =>
                            `${point.x},${point.y}`
                    )
                    .join(" "),
                fill: stroke,
                stroke: "none"
            })
        );

        /*
         * THE CENTRE DOT: THE POINT THE MOMENT IS APPLIED AT.
         *
         * A moment's centre is its APPLICATION POINT - the exact spot the
         * couple acts on - and the curved arrow alone does not say where that
         * is: a reader can see which way something turns without being able to
         * tell the joint it turns about. The dot marks it.
         *
         * IT SITS AT THE ARC'S OWN CENTRE, which is the moment's attachment
         * coordinate passed in by the caller (`toScreen(position)`). There is
         * no offset of any kind, so the moment's attachment point, the centre of
         * the symbol and the centre of the dot are the same point by
         * construction - and they stay together when the moment moves.
         *
         * IT IS DRAWN IN SCREEN SPACE, at a FIXED pixel radius, so it is a
         * constant small marker at every zoom: clearly visible when zoomed out,
         * and never swelling into a blob when zoomed in. That is why it is not
         * derived from the arc radius, which is a presentation size the student
         * may change - the attachment marker must not grow with the symbol.
         *
         * IT IS VISUALLY SUBORDINATE. A dot smaller than the arc's stroke
         * weight times a little would vanish; one as large as the arrowhead
         * would compete with it. The radius below is deliberately between the
         * two, in the panel's own dark stroke, so it reads as an engineering
         * reference mark rather than as a second arrowhead.
         *
         * IT IS NOT A FEATURE. It is drawn as part of the moment and is owned
         * by it - not selectable, not movable and not deletable on its own, so
         * it cannot be separated from the point it marks.
         */
        const centreDotRadius = 2.2;

        svg.appendChild(
            createSvgElement("circle", {
                cx: arc.center.x,
                cy: arc.center.y,
                r: centreDotRadius,
                fill: stroke,
                stroke: "none"
            })
        );
    }

    /*
     * THE SENSE OF ROTATION, AS THE ONE BOOLEAN THE GEOMETRY USES.
     *
     * A feature states its direction as the word "CCW" or "CW",
     * because that is what a student reads and what a saved file
     * should say. The geometry works in a boolean, and the conversion
     * belongs in one function so no two call sites can disagree about
     * which way round a moment turns.
     *
     * A file saved before directions were words stored a `clockwise`
     * flag, and it is still read here. Without that, every moment in
     * an older drawing would silently become anticlockwise the moment
     * it was opened: a direction change nobody asked for and nobody
     * can see.
     */
    function momentIsClockwise(
        geometry
    ) {
        if (
            geometry?.direction != null
        ) {
            return String(geometry.direction) === "CW";
        }

        return geometry?.clockwise === true;
    }

export {
    forceDirectionOnScreen,
    toScreenUnitDirection,
    appendVectorArrow,
    appendForceArrow,
    ARROW_HEAD_SPREAD,
    arrowHeadCorners,
    appendArrowHead,
    forceEndpoints,
    arrowheadTip,
    arrowheadDirection,
    vectorScaleOf,
    DISTRIBUTED_LOAD_ARROW_MIN_PX,
    distributedLoadArrowLength,
    forceStrokeWidth,
    distributedLoadHeadSize,
    distributedLoadArrowHead,
    appendRotationalArrow,
    momentIsClockwise
};
