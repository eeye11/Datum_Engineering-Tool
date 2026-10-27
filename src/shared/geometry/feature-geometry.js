/*
 * Shared feature geometry.
 *
 * This is the one place that knows how many points a
 * feature is made of and where they are. Move, rotate and
 * handle placement all read it, so a point can never be
 * transformed for one of them and missed by another. That
 * is the class of bug where a rectangle's corners fly
 * apart or a truss joint drifts away from its members.
 *
 * Nothing here knows about Statics: the same registry
 * describes a rectangle, a truss and a Point Force, which
 * is what keeps them on one shared system.
 */
import enggDrawingState from "../model/drawing-state.js";
import enggBodyFrames from "./body-frames.js";
import { isConnectionType, isSupportType } from "../model/feature-types.js";
import { DYNAMICS_OWN_TYPES } from "../../features/workspace/dynamics/dynamics-hierarchy.js";
import { coordinateSystemArms } from "./feature-handles.js";

/*
 * The centre of a feature, in world coordinates.
 *
 * Every point of a coherent feature averages to the
 * same value, so the centre is derived from the actual
 * geometry rather than stored. It can therefore never
 * go stale after an edit or a transform.
 */
function centerOf(
    geometry,
    type
) {
    const points =
        definingPoints(
            geometry,
            type
        );

    if (!points.length) {
        return null;
    }

    return {
        x:
            points.reduce(
                (total, point) =>
                    total + point.x,
                0
            ) / points.length,

        y:
            points.reduce(
                (total, point) =>
                    total + point.y,
                0
            ) / points.length
    };
}

/*
 * Every point that defines a feature's shape.
 *
 * A shape built from a centre, a size and a rotation
 * (a Rectangle or a Rigid Body) is expanded into its
 * corners here, so the transform layer always moves
 * concrete points and never has to special-case a
 * parameterised shape. The corners are recomputed from
 * the current rotation on every call, so a handle can
 * never be placed from a stale angle.
 */
function definingPoints(
    geometry,
    type
) {
    const g = geometry || {};

    const point = value =>
        value &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y)
            ? value
            : null;

    const valid = list =>
        list.filter(point);

    /*
     * Rectangle-like shapes store a top-left corner, a
     * size and a rotation. Their four real corners are
     * what must move together, so they are expanded
     * rather than approximated by the corner plus a
     * size.
     */
    if (type === "rectangle") {
        return valid(
            rectangleCorners(g)
        );
    }

    /*
     * A rigid body may be a circle, a triangle or a polygon
     * instead of a rectangle. Resolving it through the shape
     * it currently has means the transform layer, the
     * renderer and the handles all follow a change of shape
     * without any of them needing a case for it.
     */
    if (type === "rigid-body") {
        const shape = rigidBodyShape(g);

        return shape === "rectangle"
            ? valid(
                  rectangleCorners(g)
              )
            : valid(
                  definingPoints(
                      g,
                      shape
                  )
              );
    }

    if (type === "polygon") {
        return valid(
            enggDrawingState
                .polygonVertices(g)
        );
    }

    if (type === "circle") {
        const centre =
            point(g.center);

        if (!centre) {
            return [];
        }

        /*
         * A circle is rotationally symmetric, so its
         * defining points are a pair on the diameter.
         * Rotating it about its own centre is therefore
         * a no-op, which is the correct result.
         */
        return [
            {
                x:
                    centre.x -
                    g.radius,

                y: centre.y
            },

            {
                x:
                    centre.x +
                    g.radius,

                y: centre.y
            }
        ];
    }

    if (type === "arc") {
        const centre =
            point(g.center);

        if (!centre) {
            return [];
        }

        /*
         * An arc stores angles rather than a start and
         * an end point, so its two ends are resolved
         * from the current angles. They follow the
         * rotation with the centre, which is what stops
         * the ends separating from the arc.
         */
        return valid([
            {
                x:
                    centre.x +
                    g.radius *
                        Math.cos(g.startAngle),

                y:
                    centre.y +
                    g.radius *
                        Math.sin(g.startAngle)
            },

            {
                x:
                    centre.x +
                    g.radius *
                        Math.cos(g.endAngle),

                y:
                    centre.y +
                    g.radius *
                        Math.sin(g.endAngle)
            }
        ]);
    }

    if (type === "point") {
        return valid([
            g.position || g.point || g
        ]);
    }

    if (type === "particle") {
        return valid([
            g.position
        ]);
    }

    /*
     * Every span-defined feature: the structural
     * members, the loads, the connections and the Point
     * Force. A force is a vector from its application
     * point to its end, so both ends must move together
     * or the arrow stops being the force it describes.
     */
    if (
        isSupportType(type)
    ) {
        /*
         * A SUPPORT MOVES ALONG ITS BODY, NOT FREELY.
         *
         * Two things are returned and they are different kinds of
         * thing. The distance along the body is what the student
         * actually controls, and the attachment point is the world
         * position that distance denotes.
         *
         * The attachment is returned as well so that a drag which
         * takes the support past the end of its body is CLAMPED to
         * the body rather than being allowed to fly off along the
         * centreline's infinite extension - which is what moving
         * the single stored render position allowed, and how a
         * support ended up somewhere with no beam under it.
         */
        return valid([
            g.position,
            g.attachment
        ]);
    }

    if (
        type === "line" ||
        type === "beam" ||
        type === "truss" ||
        type === "cable" ||
        type === "shaft" ||
        type === "load" ||
        type === "varying-load" ||
        type === "force" ||
        type === "connection" ||
        isConnectionType(type) ||

        /*
         * A PIPE / DUCT RUN IS A STRAIGHT SPAN BETWEEN TWO ENDS, exactly as a
         * Beam is, so it moves and rotates through the same two points. Its
         * two visible boundary lines are derived from that centreline and are
         * NOT defining points of their own - moving the run carries both walls
         * because both walls come from these two ends.
         */
        type === "pipe-duct" ||

        /* A SECTION TRACE IS A SPAN TOO: two points, and a move carries both. */
        type === "section-plane"
    ) {
        return valid([
            g.start,
            g.end
        ]);
    }

    /*
     * A VESSEL AND A GRAPH FRAME ARE BOXES: their anchor and their far corner,
     * so a move carries the whole box.
     */
    if (type === "reservoir-tank" || type === "pressure-profile") {
        const width = Number(g.width) || 0;
        const height = Number(g.height) || 0;

        return valid([
            g.position,
            g.position ? { x: g.position.x + width, y: g.position.y + height } : null
        ]);
    }

    /*
     * A SYMBOL IS MOVED BY ITS OWN MODEL, not by translating point lists: an
     * inline symbol follows its pipe and a taper is derived from its two pipes.
     * Its position is the one point a transform may see.
     */
    if (type === "pump" || type === "valve" || type === "flow-meter" || type === "reducer-expander") {
        return valid([g.position]);
    }

    /* A FLUID LEVEL IS ITS OWN DERIVED LINE, from its vessel and its height. */
    if (type === "fluid-level") {
        return valid([g.start, g.end]);
    }

    /*
     * AN ELBOW IS A FITTING BETWEEN TWO RUNS. It is anchored at its corner and
     * carries the two adjoining directions with it, so a move translates the
     * corner AND both directions - the fitting keeps its shape wherever it is
     * put, and its endpoints stay where the adjoining runs meet it.
     */
    if (type === "elbow") {
        if (g.previous && g.next && g.position) {
            return valid([g.previous, g.position, g.next]);
        }

        return valid([g.position]);
    }

    /*
     * THE ANALYSIS OBJECTS MOVE, BUT NOT LIKE EVERYTHING ELSE.
     *
     * An analysis object is a READING of other features, and it
     * is re-derived from them after every edit. So a move cannot
     * simply translate its geometry: the next refresh would put it
     * straight back where the source says it belongs, and the drag
     * would appear to do nothing at all.
     *
     * What it does instead is record WHERE THE STUDENT PUT IT as
     * an offset from the source, and the refresh applies that
     * offset to the values it re-derives. The student keeps
     * control of the placement; the source keeps control of the
     * numbers. Both are true at once, which is what makes moving a
     * diagram possible without the diagram ever becoming a lie.
     *
     * So the moved point here is the offset, not the geometry. Only
     * the two ends are returned: the analysis registry owns every
     * other derived point, and duplicating them here would let a
     * move and a refresh disagree about where the object is.
     */
    if (
        type === "resultant" ||
        type === "force-components"
    ) {
        return valid([
            g.start,
            g.end
        ]);
    }

    if (type === "analysis-diagram") {
        return valid([
            g.start,
            g.end
        ]);
    }

    if (type === "moment") {
        /*
         * A rotational feature is defined by the single point it
         * turns about, which is the whole of what a move has to
         * carry.
         */
        return valid([
            g.position
        ]);
    }

    if (
        isSupportType(type)
    ) {
        return valid([
            g.position
        ]);
    }

    /*
     * A DYNAMICS SYMBOL MOVES AS ONE PIECE.
     *
     * A spring, a damper, a vector or a pulley is defined by its stored
     * fields, and the whole symbol moves when they all move. Everything it
     * stores is a point (the terminals, the centre) or a scalar measured
     * FROM one of those points (a coil height, a body width, a radius, a
     * rope swing), so translating the points is enough - nothing here needs
     * the scalars, because they travel with the points they hang from.
     */
    if (DYNAMICS_OWN_TYPES.has(type)) {
        return valid([
            g.start,
            g.end,
            g.center,
            g.position
        ]);
    }

    /*
     * A COORDINATE SYSTEM IS DEFINED BY ITS ORIGIN AND ITS ARM ENDS.
     *
     * The arms are derived from the stored lengths and rotation, so they are
     * expanded here like a rectangle's corners: moving or turning the system
     * moves every arm end with it, and the bounds - and so the rotation
     * handle - enclose the whole symbol rather than collapsing onto its
     * single origin point.
     */
    if (type === "coordinate-system-2d") {
        return valid(
            coordinateSystemArms(g).map(arm => arm.end).concat(
                g.origin ? [g.origin] : []
            )
        );
    }

    /*
     * Anything else that stores an explicit point list
     * (a Triangle or a Polyline) moves each of its
     * points, which is what keeps a triangle's vertices
     * together.
     */
    if (Array.isArray(g.points)) {
        return valid(g.points);
    }

    return [];
}

/*
 * The four corners of a rectangle-like shape, honouring
 * its current rotation. The position is the top-left
 * corner and the height extends downward in world
 * space.
 */
function rectangleCorners(
    g
) {
    if (
        !g ||
        !Number.isFinite(g.position?.x) ||
        !Number.isFinite(g.position?.y) ||
        !Number.isFinite(g.width) ||
        !Number.isFinite(g.height)
    ) {
        return [];
    }

    const centre = {
        x: g.position.x + g.width / 2,
        y: g.position.y - g.height / 2
    };

    const angle =
        ((Number(g.rotation) || 0) *
            Math.PI) /
        180;

    const cos =
        Math.cos(angle);

    const sin =
        Math.sin(angle);

    return [
        [-g.width / 2, g.height / 2],
        [g.width / 2, g.height / 2],
        [g.width / 2, -g.height / 2],
        [-g.width / 2, -g.height / 2]
    ].map(([dx, dy]) => ({
        x:
            centre.x +
            dx * cos -
            dy * sin,

        y:
            centre.y +
            dx * sin +
            dy * cos
    }));
}

/*
 * A rectangle-like shape written back from its centre and
 * an absolute rotation.
 *
 * Rotation keeps a rectangle valid because the stored
 * rotation and the stored corner are derived from the
 * same rotation. The size never changes, so the shape
 * cannot drift out of being a rectangle however many
 * times it is turned.
 */
function setRectangleFromCentre(
    g,
    centre,
    degrees
) {
    g.position = {
        x: centre.x - g.width / 2,
        y: centre.y + g.height / 2
    };

    g.rotation =
        ((degrees % 360) + 360) % 360;
}

/*
 * Rotate every defining point of a feature about a
 * pivot, by the same transform.
 *
 * P' = R(P - pivot) + pivot
 *
 * The point list is resolved before anything is written,
 * so a feature whose rotation changes how its own points
 * are derived (a Rectangle, a Polygon) still rotates all
 * of its corners together.
 */
function rotateObjectAbout(
    object,
    pivot,
    radians
) {
    const g = object.geometry;

    if (
        !g ||
        !pivot
    ) {
        return;
    }

    const type =
        object.type;

    const cos =
        Math.cos(radians);

    const sin =
        Math.sin(radians);

    const turn = point => {
        const dx =
            point.x - pivot.x;

        const dy =
            point.y - pivot.y;

        point.x =
            pivot.x +
            dx * cos -
            dy * sin;

        point.y =
            pivot.y +
            dx * sin +
            dy * cos;
    };

    /*
     * A shape stored as a centre, a size and an angle
     * rotates by turning its centre and accumulating
     * its angle. Its corners are never stored, so there
     * is no second copy of them to fall out of step.
     */
    if (type === "rectangle") {
        const centre = {
            x: g.position.x + g.width / 2,
            y: g.position.y - g.height / 2
        };

        turn(centre);

        const currentDegrees =
            ((Number(g.rotation) || 0) %
                360 +
                360) %
            360;

        setRectangleFromCentre(
            g,
            centre,
            currentDegrees +
                (radians * 180) / Math.PI
        );

        return;
    }

    if (type === "rigid-body") {
        /*
         * A rigid body rotates according to the shape it
         * currently has. A shape with its own angle stores
         * the turn; a shape made of points has every one of
         * those points turned together about the same pivot,
         * so no vertex can be left behind.
         */
        rotateRigidBody(
            g,
            pivot,
            radians,
            turn
        );

        return;
    }

    if (type === "polygon") {
        turn(g.center);

        /*
         * A POLYGON STORES ITS ANGLE IN DEGREES.
         *
         * Every other stored angle on the sheet - a rectangle's rotation, a
         * force's direction - is in degrees, and the Features panel reads and
         * writes this one as degrees too. Adding the raw radian value here
         * turned a polygon by about a fifty-seventh of the angle asked for,
         * so a "Rotate 90" on a hexagon barely moved it.
         */
        g.rotation =
            (Number(g.rotation) || 0) +
            (radians * 180) / Math.PI;

        return;
    }

    if (type === "arc") {
        turn(g.center);

        g.startAngle += radians;
        g.endAngle += radians;

        return;
    }

    /*
     * A COORDINATE SYSTEM TURNS BY ITS OWN STORED ROTATION.
     *
     * The system keeps its origin and derives its four arms from the stored
     * lengths and `rotation`, so there are no arm-end points to turn - the
     * whole drawing follows the one angle. Advancing `rotation` by the turn
     * (in degrees, like every other stored angle) rotates the axes about the
     * pivot while the origin stays put when it IS the pivot, which is what the
     * rotation handle promises.
     */
    if (type === "coordinate-system-2d") {
        if (g.origin) {
            turn(g.origin);
        }

        g.rotation =
            (Number(g.rotation) || 0) +
            (radians * 180) / Math.PI;

        return;
    }

    /*
     * A truss the student built is defined by its own
     * members, so every member turns with the same pivot
     * and the same angle. The span end points that the
     * selection box and the rotation handle use follow the
     * outer joints, so a rotated truss stays one structure
     * rather than splitting into lines.
     */
    if (type === "truss" && Array.isArray(g.members)) {
        g.members.forEach((member) => {
            turn(member.start);
            turn(member.end);
        });

        if (g.start) turn(g.start);
        if (g.end) turn(g.end);

        return;
    }

    /*
     * A DYNAMICS SYMBOL TURNS WHOLE, AND ITS OWN ANGLES TURN WITH IT.
     *
     * The points turn through the shared path below; what a Dynamics symbol
     * additionally stores are the angles its own drawing is measured in - a
     * pulley's rope swing, a polar vector's direction, an angular vector's
     * start and sweep. Advancing each stored angle by the turn is what keeps
     * the symbol's drawing rotating WITH the shape rather than staying
     * pinned to the sheet while its outline spins.
     */
    if (DYNAMICS_OWN_TYPES.has(type)) {
        const degrees = (radians * 180) / Math.PI;

        ["ropeAngle", "startAngle", "endAngle", "sweep", "angle", "direction"].forEach((key) => {
            if (Number.isFinite(Number(g[key]))) {
                g[key] = Number(g[key]) + degrees;
            }
        });

        return;
    }

    /*
     * Every other feature is a set of concrete points,
     * so rotating the resolved list moves all of them
     * with the same pivot and the same angle. This is
     * the shared path that fixes vertices, joints,
     * endpoints and symbols separating from their
     * features.
     */
    definingPoints(
        g,
        type
    ).forEach(turn);

    /*
     * ========================================================
     * AND THE STORED DIRECTIONS TURN WITH THE SHAPE
     * ========================================================
     *
     * A force, a distributed load, a moment and a support each carry an
     * ANGLE as well as points: the direction the arrow points, the way the
     * load pushes, which way the moment turns and which way the support
     * faces. Translating their points moves them but leaves those angles
     * behind - so a rotated force would still point the way it did before,
     * and a support would still face the old direction.
     *
     * Advancing each stored angle by the same turn is what keeps the
     * engineering direction consistent with the drawn geometry when the
     * object is rotated by its handle. The angles are stored in DEGREES and
     * in the same anticlockwise sense the rotation is, so the arithmetic is
     * a plain addition.
     */
    const degrees = (radians * 180) / Math.PI;

    const advanceAngle = (key) => {
        if (
            Number.isFinite(
                Number(g[key])
            )
        ) {
            g[key] =
                Number(g[key]) + degrees;
        }
    };

    if (type === "force") {
        advanceAngle("angle");
    } else if (
        type === "load" ||
        type === "varying-load"
    ) {
        advanceAngle("direction");
    } else if (isSupportType(type)) {
        advanceAngle("orientation");
    } else if (type === "moment") {
        /*
         * A moment does not point: it turns. Rotating its symbol about the
         * application point is the identity, so nothing here changes its
         * clockwise/counterclockwise sense - only the drawn sweep, which is
         * derived from the geometry.
         */
    }
}

/*
 * Rotate a rigid body in whichever form its current shape
 * is stored.
 *
 * The angle-based shapes accumulate their rotation; the
 * point-based ones have every point transformed together.
 * Both keep the same pivot, so a change of shape can never
 * leave part of the body behind.
 */
function rotateRigidBody(g, pivot, radians, turn) {
    const shape = rigidBodyShape(g);

    if (shape === "rectangle") {
        const centre = {
            x: g.position.x + g.width / 2,
            y: g.position.y - g.height / 2
        };

        turn(centre);

        setRectangleFromCentre(
            g,
            centre,
            (Number(g.rotation) || 0) + (radians * 180) / Math.PI
        );

        return;
    }

    if (shape === "circle") {
        /*
         * A circle is rotationally symmetric, so a turn
         * leaves it looking identical. The stored angle is
         * still advanced so the Features panel reports it.
         */
        if (g.center) {
            turn(g.center);
        }

        g.rotation = (Number(g.rotation) || 0) + radians;

        return;
    }

    if (shape === "polygon") {
        if (g.center) {
            turn(g.center);
        }

        g.rotation = (Number(g.rotation) || 0) + radians;

        return;
    }

    (g.points || []).filter(Boolean).forEach(turn);
}

/*
 * Move every defining point of a feature by a delta.
 *
 * As with rotation, a parameterised shape moves by its
 * stored anchor, and a point-defined shape moves each
 * of its points, so no part is ever left behind.
 */
function translateObject(
    object,
    deltaX,
    deltaY,
    lookup
) {
    const g = object.geometry;

    if (!g) {
        return;
    }

    if (
        object.type ===
            "rectangle" ||
        object.type ===
            "rigid-body"
    ) {
        /*
         * A rigid body is moved by whatever anchor its
         * current shape stores, so a body that has become a
         * circle or a triangle still moves as one piece.
         */
        moveAnchor(
            g,
            object.type,
            deltaX,
            deltaY
        );

        return;
    }

    /*
     * THE SCHEMATIC OBJECTS THAT TRANSLATE WHOLE.
     *
     * A vessel, a graph frame, a section trace and a free arrow move by their
     * stored geometry, exactly as a rectangle or a line does. The objects that
     * are constrained by a host - a reducer, an inline symbol, a fluid level,
     * a direction arrow - are deliberately NOT here: their own drag branches
     * move them along what they belong to, and a generic translation would
     * carry derived geometry off it.
     */
    if (
        object.type === "reservoir-tank" ||
        object.type === "pressure-profile"
    ) {
        if (g.position) {
            g.position.x += deltaX;
            g.position.y += deltaY;
        }

        return;
    }

    if (object.type === "section-plane" || object.type === "flow-arrow") {
        [g.start, g.end].forEach((at) => {
            if (at) {
                at.x += deltaX;
                at.y += deltaY;
            }
        });

        return;
    }

    if (
        object.type === "pump" ||
        object.type === "valve" ||
        object.type === "flow-meter" ||
        object.type === "reducer-expander"
    ) {
        if (g.position) {
            g.position.x += deltaX;
            g.position.y += deltaY;
        }

        return;
    }

    if (
        object.type === "circle" ||
        object.type === "arc" ||
        object.type === "polygon"
    ) {
        if (!g.center) {
            return;
        }

        g.center.x += deltaX;
        g.center.y += deltaY;
        return;
    }

    if (
        object.type === "resultant" ||
        object.type === "force-components" ||
        object.type === "analysis-diagram"
    ) {
        /*
         * AN ANALYSIS OBJECT IS MOVED BY RECORDING AN OFFSET.
         *
         * Everything else on the sheet is moved by translating its
         * geometry, because its geometry is the thing itself. An
         * analysis object is different: its numbers are re-derived
         * from its sources after every edit, so translating the
         * geometry here would be undone by the very next refresh
         * and the drag would appear to do nothing.
         *
         * So the drag is recorded as an OFFSET FROM THE SOURCE and
         * the refresh applies it to whatever it derives. The
         * student's placement survives; the source's values
         * survive; neither overrides the other. That is what lets
         * a diagram sit under its beam and still follow the beam
         * when the beam is resized.
         *
         * THE OFFSET IS SET, NOT COMPOSED.
         *
         * The delta reaching here is the distance from where the drag
         * BEGAN, not the distance since the last pointermove, so this
         * function is a set rather than a nudge - and the offset has to
         * be set to that total rather than added to what is already
         * there.
         *
         * It used to compose, so three moves of ten units recorded
         * thirty on the first, sixty on the second and ninety on the
         * third: the diagram overtook the cursor by a growing margin and
         * was the feature everybody reported as flying off. Two drags of
         * the same distance also produced two different results, which
         * is the same fault seen from the other side.
         */
        g.placementOffset = {
            x: deltaX,
            y: deltaY
        };

        /*
         * THE INK IS TRANSLATED TOO, so the object follows the hand on
         * this frame rather than waiting for the commit that triggers
         * the refresh.
         *
         * THIS IS NOT A SECOND TRANSLATION. `translateObject` is called
         * once per move for a given feature, and this IS that call's
         * translation. The double-translation fault was in the OFFSET
         * being composed while the ink was separately translated, so the
         * recorded offset grew faster than the drawing moved and the two
         * disagreed - visible as the object snapping back on refresh.
         * Setting the offset to the same delta that moves the ink is
         * what keeps them equal.
         *
         * `definingPoints` TAKES THE GEOMETRY AND THE TYPE, and this used
         * to be handed the OBJECT - so the type arrived as undefined,
         * none of the feature-specific branches matched, and the points
         * it did walk were not the analysis object's own. The offset was
         * recorded and the ink never moved, so a drag showed the drawing
         * standing still and then jumping on the commit that refreshed
         * it. Passing the two arguments it is declared to take is what
         * makes it move with the hand.
         */
        definingPoints(
            object.geometry,
            object.type
        ).forEach(
            point => {
                point.x += deltaX;
                point.y += deltaY;
            }
        );

        return;
    }

    if (
        isSupportType(object.type)
    ) {
        /*
         * A SUPPORT SLIDES ALONG ITS BODY, AND STAYS OUTSIDE IT.
         *
         * The drag is resolved onto the body's centreline, so a
         * support can only ever be dragged along the member it is
         * attached to and is clamped to the member's ends. Moving
         * the stored render position instead - which is what this
         * did before - let a support be dragged off the beam,
         * through it, or off past its end while still claiming to
         * be attached to it.
         *
         * The projection is onto the centreline and NOT onto the
         * drawn position, so a support dragged from the symbol
         * rather than from the centreline still lands on the
         * member: the grab point is offset from the body, and
         * using it directly would shift every drop by that offset.
         */
        const parent =
            typeof lookup === "function"
                ? lookup(object.parentId)
                : null;

        if (!parent) {
            return;
        }

        const frames = enggBodyFrames;

        const frame = frames.frameOf(parent);

        if (!frame) {
            return;
        }

        /*
         * Where the attachment currently is, on the member as it is
         * NOW. Asked for as a world point because the drag below
         * works in world space; the stored fraction is what makes the
         * drag survive a resize.
         */
        const attachment =
            frames.attachmentPoint(
                frame,
                g.attachment
            );

        if (!attachment) {
            return;
        }

        /*
         * WHERE THE DRAG WOULD PUT THE ATTACHMENT, MEASURED ON THE MEMBER.
         *
         * The projection is onto the centreline and NOT onto the drawn position,
         * so a support dragged from the symbol rather than from the centreline still
         * lands on the member: the grab point is offset from the body, and using it
         * directly would shift every drop by that offset.
         *
         * AND THE DELTA IS FROM THE START OF THE DRAG, not from the last pointermove
         * - which is the same rule the rest of the move obeys, and the reason this
         * used to walk away from the cursor. The old code asked where the attachment
         * was NOW and added the whole distance travelled so far, so every move put
         * it further along than the pointer had gone and the support ran off to the
         * end of the member.
         */
        const moved = frames.pointAt(
            frame,
            Math.min(
                frame.length,
                Math.max(0, frames.positionOn(frame, {
                    x: attachment.x + deltaX,
                    y: attachment.y + deltaY
                }))
            )
        );

        const placement =
            frames.supportPlacement(
                parent,
                moved,
                g.flipped === true
            );

        /*
         * Stored as the FRACTION the drag landed on, not as the
         * millimetres travelled. That is what keeps a drag fixed-
         * distance on a member while still surviving a later resize.
         */
        g.attachment =
            frames.attachmentFor(
                frame,
                moved
            );

        if (placement) {
            g.position = placement.render;
        }

        return;
    }

    if (object.type === "truss" && Array.isArray(g.members)) {
        g.members.forEach((member) => {
            member.start.x += deltaX;
            member.start.y += deltaY;
            member.end.x += deltaX;
            member.end.y += deltaY;
        });

        if (g.start) {
            g.start.x += deltaX;
            g.start.y += deltaY;
        }

        if (g.end) {
            g.end.x += deltaX;
            g.end.y += deltaY;
        }

        return;
    }

    definingPoints(
        g,
        object.type
    ).forEach(point => {
        point.x += deltaX;
        point.y += deltaY;
    });
}

/*
 * Move a shape by whichever single anchor it stores.
 *
 * A rigid body can hold a corner, a centre or a list of
 * points depending on its shape, so moving it through one
 * helper is what keeps every shape translating as a single
 * coherent body rather than only the rectangle one.
 */
function moveAnchor(
    g,
    type,
    deltaX,
    deltaY
) {
    if (
        type !== "rigid-body" ||
        rigidBodyShape(g) === "rectangle"
    ) {
        g.position.x += deltaX;
        g.position.y += deltaY;
        return;
    }

    if (g.center) {
        g.center.x += deltaX;
        g.center.y += deltaY;
        return;
    }

    if (Array.isArray(g.points)) {
        g.points.forEach(point => {
            point.x += deltaX;
            point.y += deltaY;
        });
    }
}

/*
 * The shapes a Rigid Body can take.
 *
 * A rigid body is one body, and these are the outlines it
 * can have. Changing the shape rewrites the same body
 * rather than replacing it, so its identity, its name and
 * its attachments all survive the change.
 */
const RIGID_BODY_SHAPES = [
  "rectangle",
  "circle",
  "triangle",
  "polygon"
];

/*
 * The shape a rigid body currently has.
 *
 * A body created before shapes existed has no stored shape
 * and is a rectangle, which is the shape it was drawn as.
 */
function rigidBodyShape(geometry) {
  const shape = geometry?.shape;
  return RIGID_BODY_SHAPES.includes(shape) ? shape : "rectangle";
}

/*
 * The centre of a rigid body, whatever shape it has.
 *
 * Each shape keeps a centre, so reading it through one helper
 * means a change of shape does not make the body jump.
 */
function rigidBodyCenter(geometry) {
  if (!geometry) return null;

  if (rigidBodyShape(geometry) === "polygon") {
    return geometry.center || null;
  }

  if (rigidBodyShape(geometry) === "circle") {
    return geometry.center || null;
  }

  if (rigidBodyShape(geometry) === "triangle") {
    return triangleCenter(geometry.points) || geometry.position || null;
  }

  return {
    x: geometry.position.x + geometry.width / 2,
    y: geometry.position.y - geometry.height / 2
  };
}

/*
 * The centre of a triangle from its three points.
 */
function triangleCenter(points) {
  const valid = (points || []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );

  if (valid.length < 3) return null;

  return {
    x: (valid[0].x + valid[1].x + valid[2].x) / 3,
    y: (valid[0].y + valid[1].y + valid[2].y) / 3
  };
}

/*
 * Three points for a triangle of the given size, centred.
 *
 * A body that changes shape into a triangle needs real points,
 * because a triangle has no width and height to fall back on.
 * They are derived from the centre and the current size so the
 * body keeps the place and the rough extent it already had.
 */
function trianglePointsFor(centre, width, height) {
  const w = (Number(width) || 50) / 2;
  const h = (Number(height) || 50) / 2;

  return [
    { x: centre.x, y: centre.y + h },
    { x: centre.x - w, y: centre.y - h },
    { x: centre.x + w, y: centre.y - h }
  ];
}

const enggFeatureGeometry = {
  RIGID_BODY_SHAPES,
  centerOf,
  definingPoints,
  rectangleCorners,
  rigidBodyCenter,
  rigidBodyShape,
  rotateObjectAbout,
  setRectangleFromCentre,
  translateObject,
  triangleCenter,
  trianglePointsFor
};

export default enggFeatureGeometry;
