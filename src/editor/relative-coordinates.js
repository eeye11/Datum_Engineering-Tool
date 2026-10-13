/*
 * Coordinates relative to a parent feature.
 */

import enggPropertyPanel from "../ui/feature-panel/property-panel.js";
import { drawingState } from "./editor-state.js";
import { mmOf } from "./handles.js";

/*
 * The parent a feature is drawn under, or null.
 *
 * A feature that hangs off a body is positioned BY that body, so
 * the numbers that describe it are best read relative to it. This
 * is the one place that answers "is this a child, and of what", so
 * the panel and the property writer can never disagree about which
 * parent a relative number is measured from.
 */
export function relativeParentOf(object) {
    if (!object?.parentId) {
        return null;
    }

    return (
        drawingState.objects.find(
            (candidate) =>
                candidate.id === object.parentId
        ) || null
    );
}

/*
 * The point on the parent that relative coordinates are measured
 * from.
 *
 * The parent's own START is used where it has one, because a
 * body's ends are what it is identified by in the tree and in any
 * schedule: "25 from the left end of Beam 1" is a real engineering
 * statement, whereas an offset from a body's centre is not
 * something anyone would ask for. A parent with no span uses its
 * position.
 */
function relativeParentOrigin(parent) {
    return (
        parent?.geometry?.start ||
        parent?.geometry?.position ||
        parent?.geometry?.origin ||
        null
    );
}

/*
 * A child feature's own anchor: the point its position refers to.
 *
 * Every feature type stores the same places under different names,
 * and both the panel and the property writer have to agree on which
 * of them a given type is positioned by, so it is named once here.
 */
function relativeChildAnchor(geometry) {
    return (
        geometry?.position ||
        geometry?.start ||
        null
    );
}

/*
 * THE PARENT'S OWN DIRECTION, as a unit vector.
 *
 * A station is a distance ALONG a member, so it can only be measured in
 * the member's frame. This is that frame, and returning null for a parent
 * with no usable span is what lets every caller fall back rather than
 * divide by a length of zero.
 *
 * It is read from the body's own two ends, not from a stored angle: a body
 * can be rotated by moving either end, and an angle field would then be
 * describing where the body was when the angle was last written.
 */
function relativeParentAxis(
    parent
) {
    const from =
        parent?.geometry?.start ||
        parent?.geometry?.position;

    const to = parent?.geometry?.end;

    if (
        !from ||
        !to ||
        !Number.isFinite(from.x) ||
        !Number.isFinite(from.y) ||
        !Number.isFinite(to.x) ||
        !Number.isFinite(to.y)
    ) {
        return null;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const length = Math.hypot(dx, dy);

    if (!(length > 0)) {
        return null;
    }

    return { x: dx / length, y: dy / length };
}

/*
 * ========================================================
 * A CHILD'S POSITION ALONG ITS PARENT
 * ========================================================
 *
 * A child of a body - a force, a load, a moment, a support - is positioned
 * by a DISTANCE ALONG that body, and that is the whole of it. Everything
 * else about where it sits is derived: its height above or below the
 * centreline comes from the direction the force acts, its orientation
 * comes from the body's own normal.
 *
 * IT USED TO SHOW TWO NUMBERS - Offset X and Offset Y - and both were ways
 * to make the feature wrong.
 *
 * They are the child's world position expressed relative to the parent's
 * start: two numbers describing one fact, of which the second is a
 * consequence of the first and of the direction. A student who set both
 * had to keep them consistent with a direction shown elsewhere in the same
 * panel, and nothing checked it - so a load with a positive Offset Y and a
 * downward direction is a field that can be filled in and produces a load
 * sitting on the wrong side of the beam.
 *
 * THE STATION IS PROJECTED, NOT READ OFF `x`.
 *
 * A distance along a member is measured along its axis. Reading
 * `anchor.x` only works for a horizontal member: on a vertical or rotated
 * one every station reads as zero, which makes the field look like a
 * control that does nothing. Projecting onto the parent's own direction
 * means the number means the same thing on any beam.
 */
function stationOf(
    point,
    parent
) {
    if (!point) {
        return 0;
    }

    const origin = relativeParentOrigin(parent);

    if (!origin) {
        return point.x;
    }

    const axis =
        relativeParentAxis(parent);

    if (!axis) {
        return point.x - origin.x;
    }

    return (
        (point.x - origin.x) * axis.x +
        (point.y - origin.y) * axis.y
    );
}

/*
 * ========================================================
 * THE FEATURES THAT ARE A REGION, NOT A POINT
 * ========================================================
 *
 * A Distributed Load and a Varying Distributed Load both act over a SPAN of
 * a body rather than at a spot on it. That is the whole reason they are
 * positioned by two stations and not by one, and the reason their heights
 * are derived: a region has an extent along the member and a height off
 * it, and only the extent is the student's to choose.
 *
 * Named here because three places need the same answer - the panel, the
 * property writer and the station conversion - and a list of two types
 * repeated three times is three chances for one of them to forget the
 * second.
 */
export function isLoadGeometry(
    object
) {
    return (
        object?.type === "load" ||
        object?.type === "varying-load"
    );
}

/*
 * ========================================================
 * A STATION, AS A POINT ON THE SHEET
 * ========================================================
 *
 * The inverse of `stationOf`, and the conversion that makes a station
 * meaningful on a body that is not horizontal.
 *
 * A station is a distance along a member. Turning it back into a position
 * is a projection onto the member's axis from its own start, which is
 * where the member's centreline is - and on the member's centreline,
 * because that is the line a load's extent is measured along and the line
 * a support attaches to.
 *
 * It REFUSES A BODY WITH NO USABLE SPAN, returning null rather than a
 * guessed origin. A load with a parent whose ends are coincident has
 * nowhere to be, and putting it at the world origin would place it
 * somewhere real and wrong; every caller treats null as "this edit cannot
 * be applied" and leaves the drawing as it was.
 */
export function pointAtStation(
    parent,
    station
) {
    if (
        !parent ||
        !Number.isFinite(station)
    ) {
        return null;
    }

    const origin =
        relativeParentOrigin(parent);

    const axis =
        relativeParentAxis(parent);

    if (!origin || !axis) {
        return null;
    }

    return {
        x: origin.x + axis.x * station,
        y: origin.y + axis.y * station
    };
}

/*
 * ========================================================
 * THE RELATIVE-POSITION ROWS FOR A CHILD
 * ========================================================
 *
 * For a child that is a REGION - the two distributed loads - the rows are
 * the region's two ends. For one that is a POINT - a force, a moment, a
 * support - it is the single station along the body.
 *
 * For a load this replaces eight fields with two. It used to offer
 * Start X, Start Y, End X and End Y, plus Offset X and Offset Y from this
 * function: six numbers for the two facts a load actually has - the region
 * it covers and the direction it pushes - with the height of each end
 * stored independently of both.
 *
 * THAT IS WHAT MADE A LOAD FLIPPY. The height of the load's outline was
 * a stored coordinate rather than something derived from the body and the
 * direction, so reversing the direction changed the arrows without moving
 * the outline, and the outline was then on the wrong side of the member
 * with no field anywhere that said so. The load is now positioned by its
 * two stations and its direction alone; the height follows.
 *
 * THE PARENT IS NAMED, AS A ROW.
 *
 * It was a single line of prose - "Relative to: Beam 3" - which is two
 * pieces of information in one unbreakable string. A feature named after
 * something a student typed ("Simply supported beam 3m") produced a line
 * the panel was too narrow to show, and the relation - the one thing this
 * row exists to say - was the part that disappeared. As a row, the name
 * gets its own wrapping column and can break across lines instead of
 * across the edge of the panel.
 */
export function relativeCoordinateRows(
    object,
    label,
    helpers
) {
    const parent = relativeParentOf(object);

    const origin = relativeParentOrigin(parent);

    if (!parent || !origin) {
        return "";
    }

    const { coordinate, section } = helpers;

    /*
     * A HEADING THAT STANDS OR FALLS WITH ITS FIELDS, RESOLVED HERE.
     *
     * This helper returns its heading and its fields as one finished string,
     * so the caller's finalise pass sees a single entry and cannot drop a
     * heading that this function already decided was worth keeping. The shared
     * module's `section` is used directly for that reason: it buffers the
     * fields and emits the heading only if there are any.
     */
    const shared =
        enggPropertyPanel;

    const headed = fields =>
        shared && shared.section
            ? shared.section(label, fields)
            : [section(label), ...fields].join("");

    const geometry = object?.geometry || {};

    const parentName =
        parent.name ||
        parent.type ||
        "another feature";

    const parentRow = `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Relative to</span>
            <span class="drawing-property-readonly">${parentName}</span>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;

    /*
     * A LOAD IS A REGION, and its two stations are the answer to the only
     * question a student has about where it acts.
     *
     * THE STATIONS ARE LENGTH ROWS, so they are read in the feature's own
     * selected unit through the shared coordinate helper - the same rows
     * every other length field uses, with the same selector.
     */
    if (
            object.type === "load" ||
            object.type === "varying-load"
        ) {
            /*
             * A STATION IS A PHYSICAL LENGTH HERE TOO.
             *
             * These two rows went unconverted while the "Along Body" row
             * below - the same measurement of the same kind of child on the
             * same parent - was corrected. So a load's extent was printed in
             * world units carrying an "mm" unit tag, and on any calibrated
             * sheet the number was wrong by the scale factor.
             *
             * It read as plausible because the unit tag is present and the
             * value still grew when you dragged the load further along the
             * beam. Only the magnitude was wrong.
             *
             * THE WRITER IS DELIBERATELY NOT TOUCHED. It hands the raw value
             * to pointAtStation, which projects in world units, so the pair
             * was already consistent with each other - it was the LABEL that
             * disagreed with both. Converting here, and only here, is what
             * makes the two halves say the same thing.
             */
            return headed([
                parentRow,
                coordinate(
                    "Start",
                    "start.x",
                    mmOf(stationOf(geometry.start, parent)).value,
                    "mm",
                    true
                ),
                coordinate(
                    "End",
                    "end.x",
                    mmOf(stationOf(geometry.end, parent)).value,
                    "mm",
                    true
                )
            ]);
        }

    const anchor = relativeChildAnchor(
        geometry
    );

    if (!anchor) {
        return "";
    }

    return headed([
        parentRow,

        /*
         * A STATION IS A PHYSICAL LENGTH, so it is shown in the
         * SHEET'S units.
         *
         * `stationOf` measures in WORLD units, because that is what
         * the load's own geometry, its attachments and the analysis
         * all work in. Showing that raw number under a "mm" caption
         * made the value wrong by exactly the scale factor the moment
         * a sheet was calibrated - a station of 100 world units on a
         * 1 unit = 4 mm sheet read as 100 mm when it was 400.
         *
         * Converted at the panel boundary rather than by changing the
         * stored station, because the stored station is model
         * geometry that everything else reads.
         */
        coordinate(
            "Along Body",
            "relative.x",
            mmOf(stationOf(anchor, parent)).value,
            "mm",
            true
        )
    ]);
}

/*
 * ========================================================
 * THE ABSOLUTE POSITION ROWS, ONLY WHEN THERE IS NO PARENT
 * ========================================================
 *
 * A feature attached to a body is positioned ALONG that body: one number, a
 * distance measured on the member, whose height and orientation follow from the
 * member and the feature's own direction. That is the "Relative To" row set,
 * and on its own it fully describes where the feature is.
 *
 * The absolute X and Y pair is a DIFFERENT question - where on the sheet - and
 * it only means something when there is no body to be measured along. A force
 * placed in free space has two coordinates and nothing else; a force on a beam
 * has one, and its height off the beam is a consequence rather than a choice.
 *
 * SHOWING BOTH WAS REDUNDANT AND WRONG. While they were both on the panel,
 * every absolute Y field was an invitation to move the feature ACROSS its own
 * member - something the relative model does not store and the renderer does
 * not honour, so the number could be typed and the drawing would not follow it.
 * A control that accepts a value and changes nothing is the worst kind: it
 * looks like a property.
 *
 * SO THE Y (and the absolute pair with it) IS OFFERED ONLY WHEN THERE IS NO
 * PARENT. Nothing is left behind - no disabled field, no empty row - because an
 * absent fact is shown by an absent row.
 */
export function absolutePositionRows(
    object,
    helpers
) {
    const parent =
        relativeParentOf(object);

    /*
     * ATTACHED: the relative rows already state where it is, and there is no
     * second coordinate for the student to set.
     */
    if (parent && relativeParentOrigin(parent)) {
        return [];
    }

    const { coordinate, section } = helpers;

    const geometry = object?.geometry || {};

    /*
     * FREE: the absolute pair IS the placement, so both ordinates are offered.
     * The report that an absent Y was removed applies only to the ATTACHED
     * case; a free feature genuinely has two coordinates.
     */
    const anchor =
        geometry.position ||
        geometry.start;

    if (
        !anchor ||
        !Number.isFinite(anchor.x) ||
        !Number.isFinite(anchor.y)
    ) {
        return [];
    }

    const label =
        geometry.position ? "Position" : "Application Point";

    return [
        section("POSITION"),
        coordinate(`${label} X`, "position.x", anchor.x, "mm", true),
        coordinate(`${label} Y`, "position.y", anchor.y, "mm", true)
    ];
}
