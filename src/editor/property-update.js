/*
 * Applying an edited property to a feature.
 */

import enggLoadProfile from "../features/analysis/load-profile.js";
import enggQuantities from "../core/units/quantities.js";
import { COORDINATE_SYSTEM_TYPE } from "./constants.js";
import { drawingState } from "./editor-state.js";
import { moveRigidBodyTo, resizeRigidBody, setRigidBodyRadius } from "./property-inputs.js";
import { isLoadGeometry, pointAtStation, relativeParentOf } from "./relative-coordinates.js";
import { worldLengthOf } from "./handles.js";

/*
 * ========================================================
 * THE DISPLAY UNIT A LENGTH FIELD IS READ IN, RESOLVED ONCE
 * ========================================================
 *
 * Every length field on a Features panel is captioned by the unit the
 * student has SELECTED for that feature (`object.lengthUnit`) - mm, cm, m,
 * in or ft - and the panel converts the stored world length into that unit
 * for display. The setter must therefore read the same unit back when a
 * value is typed, or the number crosses the boundary a second time.
 *
 * That is the metre/millimetre defect: the panel showed 5 m and the setter
 * converted the typed number as though it were millimetres, so the value
 * landed at a thousandth of what the student entered and read back as 0.005.
 *
 * So the resolution lives HERE, once, as a helper every length branch below
 * shares. The fallback is the sheet's own base unit (mm), which is what a
 * feature that predates the unit field was always read in - the same
 * convention the coordinate reader in feature-panel-markup follows.
 */
function displayLengthUnitOf(object) {
    const stored = object?.lengthUnit;

    return enggQuantities.isUnitFor("length", stored)
        ? stored
        : "mm";
}

/*
 * A length typed in the field's own display unit, in WORLD units.
 *
 * `worldLengthOf` forwards to `dimensions.fromEngineering`, which is the ONE
 * conversion from a typed engineering length to geometry units. Every branch
 * below goes through this helper rather than calling `fromEngineering` with a
 * hardcoded unit of its own, so a coordinate, a radius, a width and a side
 * length cannot resolve the typed unit differently - which is exactly how the
 * metre field came to be read in millimetres.
 */
function worldLengthInDisplayUnits(object, value) {
    return worldLengthOf(value, displayLengthUnitOf(object));
}
import { applyTriangleSidesAndAngles } from "./triangle-editing.js";

import { pistonFraction, setStopperFraction } from "../features/thermodynamics/piston-cylinder.js";

export function updateFeatureProperty(object, key, value, typedUnit) {
    const g = object.geometry;
    if (object.metadata?.thermodynamicsKind === "saturation-curve" && ["xLabel", "yLabel"].includes(key)) {
        g[key] = String(value ?? "");
        return true;
    }
    const fixed = name => Boolean(object.constraints?.[name]);
    const positive = value > 0;

    if (key === "pistonHeight" && object.metadata?.thermodynamicsKind === "piston-cylinder") {
        const height = worldLengthInDisplayUnits(object, value);
        if (!Number.isFinite(height) || !(g.height > 0)) return false;
        g.pistonFraction = pistonFraction({ ...g, pistonFraction: height / g.height });
        return true;
    }
    if (key === "stopperHeight" && object.metadata?.thermodynamicsKind === "piston-cylinder" && g.hasStoppers) {
        const height = worldLengthInDisplayUnits(object, value);
        if (!Number.isFinite(height) || !(g.height > 0)) return false;
        setStopperFraction(g, height / g.height);
        return true;
    }

    /*
     * ========================================================
     * THE FEATURE'S LABEL, WHICH IS NOT ITS NAME
     * ========================================================
     *
     * A feature has TWO pieces of text, and they mean different things:
     *
     *   `name`   what it is called in a schedule - "Line 3", "Beam 1"
     *   `label`  what is WRITTEN BESIDE IT ON THE SHEET - "AB", "x", "datum"
     *
     * The Features panel's Label field was bound to `name`, so typing in it
     * silently renamed the feature and the drawing never changed - the field
     * accepted text and did nothing visible, which is exactly the fault
     * reported. This is the branch that makes the field write a LABEL, which the
     * renderer then draws.
     *
     * IT IS HANDLED BEFORE EVERY TYPE BRANCH, so it applies to Line, Point and
     * every other feature through one rule rather than a branch each - the same
     * shape as the name itself.
     *
     * IT IS NOT BLOCKED BY A LOCK. Locking is a constraint on GEOMETRY, and a
     * locked feature must still be labelable: a student fixes a point in place
     * precisely so they can annotate it without moving it. Returning `true` here
     * regardless of `fixed(...)` is that decision, made once.
     */
    if (key === "label") {
        object.label = String(value ?? "");
        return true;
    }

    /*
     * ========================================================
     * A LOCKED FEATURE'S POSITION CANNOT BE TYPED EITHER
     * ========================================================
     *
     * `object.locked` is what the Features panel's Locked checkbox writes, and
     * `drag.js` already refuses to begin a drag on a locked feature. That covers
     * the POINTER, but not the PANEL: a coordinate field wrote straight to the
     * geometry and would happily move a feature the student had locked, so the
     * one control that is supposed to hold it in place could be bypassed by
     * typing - the very thing the lock exists to prevent.
     *
     * NOTHING ELSE IS AFFECTED. A lock is a constraint on POSITION, so only a
     * key that names a point is refused: the label, the line width, the colour
     * and the line type are all independent of where the feature is, and a
     * student locks a feature precisely so they can keep annotating and styling
     * it. The three length keys are included because on a line each of them
     * MOVES an endpoint - a Length edit without the lock would slide the end of
     * a "fixed" line.
     */
    const POSITION_KEYS = /^(start|end|center|centre|origin|position)\.(x|y)$/;

    if (
        object.locked === true &&
        (POSITION_KEYS.test(key) || key === "length" || key === "angle")
    ) {
        return false;
    }

    /*
     * ========================================================
     * A COORDINATE THE PANEL SHOWS IN MILLIMETRES
     * ========================================================
     *
     * Every X and Y the Features panel shows is a PHYSICAL POSITION, so
     * the panel states it in the sheet's units and the geometry stores it
     * in world units. The two are related by the ONE document scale, and
     * this is where the typed millimetres become world units.
     *
     * It has to happen on the way IN as well as on the way OUT: the panel
     * now converts for display (see `coordinate` in feature-panel-markup),
     * so a writer that copied the typed number straight into the geometry
     * would move a feature to the wrong place on any calibrated sheet -
     * typing 500 on a 1 unit = 4 mm sheet would put it 500 world units
     * away, which is 2 m, not 500 mm.
     *
     * The keys are matched by shape rather than by type, because the same
     * coordinate is called `position`, `start`, `end`, `center`, `centre`,
     * `origin` or an indexed point depending on the feature - and a list
     * of types would be a list to forget one from.
     *
     * ANGLES ARE NOT CONVERTED. A degree is not a length, and running one
     * through the scale would produce a different angle.
     */
    const LENGTH_AXIS = /\.(x|y)$/;

    const isLengthCoordinate =
        LENGTH_AXIS.test(key) &&
        (key.startsWith('position.') ||
            key.startsWith('start.') ||
            key.startsWith('end.') ||
            key.startsWith('center.') ||
            key.startsWith('centre.') ||
            key.startsWith('origin.') ||
            key.startsWith('rigidCentre.') ||
            key.startsWith('points.'));

    /*
     * ========================================================
     * THE DISPLAY UNIT A LENGTH FIELD IS BEING READ IN
     * ========================================================
     *
     * A coordinate can be READ in mm, cm, m, inches or feet. That choice is
     * stored on the feature (`object.lengthUnit`), and the panel shows the
     * number in it - so an entry typed while the field reads "in" is INCHES,
     * and has to become millimetres before the scale turns it into world units:
     *
     *     typed -> [ display unit -> mm ] -> worldLengthOf -> world
     *
     * WITHOUT THIS the two halves disagree: the panel would divide by 25.4 to
     * show inches, and the setter would multiply the typed inches by the scale
     * as though they were millimetres - so editing a field moved the feature by
     * a factor of 25.4. That is the defect this closes, and it is why the
     * conversion is here rather than in the panel.
     *
     * IT WRITES THE UNIT TOO. `lengthUnit` is itself a property, so changing the
     * selector is one undoable edit like any other, and it persists in the
     * document with the drawing.
     *
     * THE RESOLUTION IS THE SHARED HELPER ABOVE, not an inline fallback - the
     * same one function every length branch below reads, so the setter and the
     * panel cannot resolve the unit differently.
     */
    if (key === 'lengthUnit') {
        const unit = String(value ?? '');

        /*
         * A UNIT THE LENGTH QUANTITY DOES NOT HAVE IS REFUSED, not stored - so a
         * coordinate can never be left asking to be read in a force or a moment.
         * The check is the shared table's, not a local list of names.
         */
        if (unit && !enggQuantities.isUnitFor('length', unit)) {
            return false;
        }

        /*
         * MILLIMETRES ARE STORED AS ABSENT. mm is the sheet's own unit and the
         * state every geometry feature was in before this field existed, so
         * leaving it off keeps the saved shape of an untouched drawing identical
         * - the same convention a dimension's `displayUnit` already follows.
         */
        object.lengthUnit = unit && unit !== 'mm' ? unit : undefined;

        return true;
    }

    /*
     * ========================================================
     * A UNIT TYPED BESIDE THE NUMBER OVERRIDES THE FIELD'S
     * ========================================================
     *
     * The field's selector states the unit a BARE number is in - that is what
     * the label promises - but a student who types "5 mm" has named their unit
     * explicitly, and that choice must win over the dropdown. Reading "5 mm" as
     * five of whatever the dropdown says is a thousand-fold error in the
     * direction the student guarded against.
     *
     * So `typedUnit`, when the panel has one, is used here instead of the
     * feature's stored unit. It arrives already canonicalised by the shared
     * table, so this trusts it as far as the length quantity goes and falls
     * back to the stored unit when it is absent.
     */
    const displayUnit = displayLengthUnitOf(object);

    /*
     * ========================================================
     * A TYPED LENGTH CROSSES THE SCALE EXACTLY ONCE
     * ========================================================
     *
     * `worldLengthOf(typed, unit)` forwards straight to
     * `dimensions.fromEngineering(state, typed, unit)`, which is the ONE
     * conversion from a typed length to world units and ALREADY understands the
     * unit it is handed. So the typed number and the field's unit go in together
     * and nothing else is done to them:
     *
     *     typed (in the field's unit) -> fromEngineering -> world units
     *
     * CONVERTING TO MILLIMETRES FIRST AND THEN CALLING `worldLengthOf` WOULD
     * CONVERT TWICE. The millimetre figure would be handed back to the scale with
     * no unit of its own, so the scale would read those millimetres AS THOUGH THEY
     * WERE THE DISPLAY UNIT - the second pass undoing the first, and the value
     * landing at the wrong physical position. On a field showing inches, typing
     * "2" must be 50.8 mm on the sheet, not 2 mm.
     */
    const worldValue = isLengthCoordinate
        ? worldLengthOf(value, displayUnit)
        : value;

    /*
     * NOTHING NON-FINITE REACHES THE GEOMETRY.
     *
     * A typed value arrives from a number input, and a half-typed one is
     * `NaN`. `fromEngineering` reports 0 for a non-finite input, so without
     * this guard a bad value would be WRITTEN as zero - collapsing a feature
     * to nothing rather than being refused, which is the more destructive of
     * the two outcomes and the harder one to notice.
     *
     * `worldValue` is what every coordinate branch below writes, so refusing
     * here covers all of them at once. Infinity is refused for the same
     * reason: it is finite-looking in a field and produces an unusable
     * feature.
     */
    if (isLengthCoordinate && !Number.isFinite(worldValue)) {
        return false;
    }

    /*
     * A RELATIVE coordinate is an offset from the parent the
     * feature is drawn under, and is answered here for every type
     * at once rather than inside each type's own block.
     *
     * Writing it moves the CHILD by the given offset from where
     * the parent is now, and touches nothing about the parent. The
     * stored geometry is still absolute - the parent may be
     * dragged, loaded, or re-parented later, and the absolute
     * position has to survive all of that - so the local value is
     * translated through the parent's live origin rather than
     * stored. That is what makes the relationship hold: drag the
     * parent and the child follows it, and the offset shown in the
     * panel is still the same offset.
     */
    const relative = /^relative\.([xy])$/.exec(key);

    /*
     * THE LENGTH OF A STRAIGHT BODY IS EDITABLE.
     *
     * Length is presented in the panel as a number, and until now it was
     * read-only because it is DERIVED from the two ends - so a reader
     * was right to treat it as a measurement of the member rather than
     * something to type into.
     *
     * It is a real property now, and it has to be applied to the GEOMETRY
     * rather than to the number on screen. Setting the stored value and
     * redrawing would change the label and nothing else, leaving a beam
     * that still spans the old distance but claims a new one - which is
     * exactly the kind of contradiction that makes every downstream
     * number wrong, because the spans, the support positions and the
     * analysis all read the ends.
     *
     * THE START IS THE ANCHOR. The far end is moved along the member's
     * existing direction until it sits the requested distance from the
     * start, so the member's orientation is preserved and the body grows
     * or shrinks about the end the student placed first. That is the
     * same anchor the panel's other relative edits use, and it means a
     * body resized this way stays put where it was pinned.
     *
     * A zero-length request is refused: it would collapse the member to a
     * point, which is not a body and cannot carry a load or be snapped
     * to. The near-zero floor keeps the direction well defined instead.
     */
    if (key === "length" && positive && g.start && g.end) {
        if (fixed("length")) return false;

        /*
         * A LENGTH MUST BE A FINITE NUMBER BEFORE IT MOVES ANYTHING.
         *
         * `positive` admits Infinity, and a member stretched to Infinity
         * has no usable geometry left - every dependent value becomes
         * Infinity or NaN and the feature can no longer be edited back.
         * A non-finite length is refused rather than applied.
         */
        if (!Number.isFinite(Number(value))) return false;

        const dx = g.end.x - g.start.x;
        const dy = g.end.y - g.start.y;
        const current = Math.hypot(dx, dy);

        /*
         * A body with no direction yet - two ends on the same point -
         * cannot be stretched, because there is nothing to stretch
         * along. Editing the start or the end gives it a direction
         * first.
         */
        if (current <= 1e-6) {
            return false;
        }

        /*
         * THE PANEL SPEAKS MILLIMETRES; THE GEOMETRY WORKS IN WORLD UNITS.
         *
         * The Features panel shows Length as a physical size and the
         * creation popup asks for one, so a student typing 750 means
         * 750 mm. That has to become world units before the end is
         * moved, or the beam grows to 750 world units and is then
         * reported back as several metres - the same number meaning
         * two different lengths depending on who is reading it.
         *
         * This is the SAME conversion the creation popup uses, which
         * is what keeps the two routes from disagreeing about what a
         * millimetre is.
         *
         * IT IS TYPED IN THE FIELD'S OWN SELECTED UNIT, so the resolution
         * goes through the one display-unit helper rather than assuming
         * millimetres - a student reading in metres types 5 and means 5 m,
         * which is 5000 world units on a 1 mm-per-unit sheet, not 5.
         */
        const world = worldLengthInDisplayUnits(object, value);

        g.end = {
            x: g.start.x + (dx / current) * world,
            y: g.start.y + (dy / current) * world
        };

        /*
         * Nothing to do about the attachments.
         *
         * They used to be stored as an absolute distance along the
         * member, which meant a resize had to walk every child and
         * rescale it by hand. An attachment is now stored as the
         * FRACTION of the member it sits at, so the far end moving is
         * all it takes: half of a longer member is still half of it, and
         * every support, connection and load on the member is carried
         * along by its own stored value.
         *
         * Leaving it out is what makes the rule single: there is one
         * representation, so a resize cannot need a special case and a
         * drag cannot disagree with it.
         */
        return true;
    }

    if (relative) {
        if (fixed(key)) return false;

        const parent = object.parentId
            ? drawingState.objects.find(
                  (candidate) =>
                      candidate.id === object.parentId
              )
            : null;

        if (!parent) {
            return false;
        }

        const origin =
            parent.geometry?.start ||
            parent.geometry?.position ||
            parent.geometry?.origin;

        if (!origin) {
            return false;
        }

        const axis = relative[1];

        /*
         * A RELATIVE NUMBER IS A LENGTH, SO IT IS WRITTEN IN THE FIELD'S
         * OWN DISPLAY UNIT.
         *
         * The reader above prints the offset through mmOf and the unit
         * selector, so the panel shows engineering units. Writing it
         * straight into the geometry treats that number as world units,
         * which on any calibrated sheet lands the child at a completely
         * different place than the number just read - the row stops being
         * the same measurement it is supposed to be editable.
         *
         * Converting here through the shared display-unit helper is what
         * makes Relative To a live measurement in both directions: what
         * the panel prints is exactly what the panel accepts, in whatever
         * unit the field is read in.
         */
        const worldValue = worldLengthInDisplayUnits(object, value);

        /*
         * The same places the panel reads as this feature's
         * anchor, written together: a force is positioned by its
         * application point, a support by its position, a load by
         * the start of the span it acts on. Moving only the start
         * of a load would leave its far end behind and shorten the
         * loaded region, so all of a feature's span is carried
         * across by the same amount.
         */
        if (g.start && g.end) {
            const shiftX =
                axis === "x"
                    ? worldValue - (g.start.x - origin.x)
                    : 0;

            const shiftY =
                axis === "y"
                    ? worldValue - (g.start.y - origin.y)
                    : 0;

            [g.start, g.end].forEach((point) => {
                point.x += shiftX;
                point.y += shiftY;
            });

            if (g.position) {
                g.position = { ...g.start };
            }

            return true;
        }

        if (g.position) {
            if (axis === "x") {
                g.position.x = origin.x + worldValue;
            } else {
                g.position.y = origin.y + worldValue;
            }

            if (g.start) {
                g.start = { ...g.position };
            }

            return true;
        }

        return false;
    }

    if (object.type === 'triangle') {
        /*
         * Point coordinates are the source of truth in
         * Points mode; sides and angles rebuild the
         * points in Sides & Angles mode.
         */
        const pointMatch =
            /^points\.(\d)\.([xy])$/.exec(key);

        if (pointMatch) {
            const index =
                Number(pointMatch[1]);

            const axis =
                pointMatch[2];

            if (
                fixed(`points.${index}`) ||
                !g.points?.[index]
            ) {
                return false;
            }

            /*
             * A TRIANGLE VERTEX IS A PHYSICAL POSITION, so the typed value
             * crosses the document scale once, here. Writing the raw number
             * would put the vertex four times too far on a 1 unit = 4 mm
             * sheet and the panel would read the same wrong number back.
             */
            g.points[index][axis] =
                worldValue;

            return true;
        }

        /*
         * ========================================================
         * A TRIANGLE EDGE, REFERENCED BY ITS OWN NAME
         * ========================================================
         *
         * Smart Dimension identifies a clicked side as `segment{i}Start` /
         * `segment{i}End`, so a dimension on a triangle side names THAT side
         * rather than the feature. The value it carries is the side's
         * LENGTH, so the edit is applied to the triangle's own `side{i}`
         * property - which already knows how to move the far vertex and
         * leave the rest of the triangle's relationships standing.
         *
         * `side{i}` is the vertex that OPENS the edge, matching the closed
         * chain the edges are derived from: segment0 is A-B so side0 is A,
         * segment1 is B-C so side1 is B, segment2 is C-A so side2 is C. The
         * index is therefore read straight from the key and the two
         * vocabularies cannot drift.
         *
         * THIS IS WHY THE EDGE NEEDS A NAME AT ALL. Without it a triangle
         * side had no key to write, so the dimension could measure a side but
         * never set one - and the "edit" would silently do nothing.
         */
        const segmentMatch =
            /^segment(\d)(Start|End|Mid)$/.exec(key);

        if (segmentMatch) {
            const index = Number(segmentMatch[1]);

            if (fixed(`segment${index}`)) {
                return false;
            }

            /*
             * `side{N}` IS ONE-BASED; `segment{N}` IS ZERO-BASED.
             *
             * segment0 is the edge A-B, which the sides-and-angles solver
             * calls side1. Passing the segment index straight through would
             * edit the NEXT edge round - so a dimension on AB would resize BC.
             * The two vocabularies are related here, once, and nowhere else.
             */
            const sideKey = `side${index + 1}`;

            /*
             * THE SOLVER WORKS IN WORLD UNITS, so the typed length is
             * converted first, in the field's own display unit - the same
             * shared helper every other length branch uses. It compares the
             * new length against the other two sides, which are world
             * lengths, so handing it the raw number would both break that
             * triangle-inequality test and stretch the edge by the scale
             * factor.
             */
            const world = worldLengthInDisplayUnits(object, value);

            if (!Number.isFinite(world)) {
                return false;
            }

            return applyTriangleSidesAndAngles(
                object,
                sideKey,
                world
            );
        }

        /*
         * SIDES ARE LENGTHS, SO THEY CROSS THE SCALE; ANGLES ARE NOT.
         *
         * The solver works entirely in WORLD units: it compares the new
         * length against the other two sides, which are world lengths, and
         * then rebuilds the points from them. Handing it the typed number
         * unconverted therefore did two wrong things at once - it broke the
         * triangle-inequality test, and it stretched the edge by the scale
         * factor. On a 1 unit = 4 mm sheet a side typed as 200 came out at
         * 800 mm.
         *
         * An angle is a degree, not a length, so it is passed through as it
         * was typed.
         */
        if (key.startsWith('side')) {
            const world = worldLengthInDisplayUnits(object, value);

            if (!Number.isFinite(world)) {
                return false;
            }

            return applyTriangleSidesAndAngles(
                object,
                key,
                world
            );
        }

        if (key.startsWith('angle')) {
            return applyTriangleSidesAndAngles(
                object,
                key,
                value
            );
        }

        return false;
    }

    if (key.startsWith('points.')) {
        const [, index, axis] = key.split('.');
        if (fixed(`points.${index}`) || !g.points?.[index]) return false;
        g.points[index][axis] = worldValue;
        return true;
    }

    if (object.type === 'line') {
        const start = g.start;
        const end = g.end;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        if (key.startsWith('start.') || key.startsWith('end.')) {
            const [pointKey, axis] = key.split('.');
            if (fixed(pointKey) || (fixed('start') && fixed('end'))) return false;
            const point = g[pointKey];
            const otherKey = pointKey === 'start' ? 'end' : 'start';
            const other = g[otherKey];
            /*
             * A LINE'S ENDPOINT IS A PHYSICAL POSITION, so the typed value
             * arrives in millimetres and becomes world units once, here.
             * Writing the raw number would place the end four times too far
             * on a 1 unit = 4 mm sheet, and the panel would then read the
             * same wrong number back - a feature that agreed with itself
             * while disagreeing with the sheet.
             */
            const next = { ...point, [axis]: worldValue };
            if (fixed('length') || fixed('angle')) {
                if (fixed(otherKey)) {
                    // A single coordinate cannot be changed independently when
                    // the opposite endpoint and a dimension are both fixed.
                    return false;
                }
                const sign = pointKey === 'start' ? 1 : -1;
                const proposedAngle = Math.atan2(
                    (next.y - other.y) * -sign,
                    (next.x - other.x) * -sign
                );
                const direction = fixed('angle') ? angle : proposedAngle;
                const extent = fixed('length') ? length :
                    Math.hypot(next.x - other.x, next.y - other.y);
                point[axis] = worldValue;
                other.x = next.x + sign * extent * Math.cos(direction);
                other.y = next.y + sign * extent * Math.sin(direction);
            } else {
                point[axis] = worldValue;
            }
            return true;
        }
        if (key === 'length' && positive && !fixed('length')) {
            if (fixed('end') && fixed('start')) return false;

            /*
             * THE PANEL SPEAKS MILLIMETRES, THE GEOMETRY WORKS IN
             * WORLD UNITS.
             *
             * The Features panel shows Length as a physical size, so
             * a student typing 500 there means 500 mm. The end is
             * moved to that distance from the anchor, which means
             * the value has to become world units first - otherwise
             * "500" would silently become a beam of 500 world units
             * and then be reported back as something over a metre.
             *
             * The conversion is the SAME one the creation popup uses,
             * which is what keeps the two routes from disagreeing: a
             * length typed at creation and the same length typed in
             * the panel move the beam by the same amount.
             *
             * TYPED IN THE FIELD'S OWN UNIT, so the shared helper
             * resolves the display unit rather than this branch assuming
             * millimetres.
             */
            const world = worldLengthInDisplayUnits(object, value);

            const target = fixed('end') ? start : end;
            const anchor = fixed('end') ? end : start;
            const direction = fixed('end') ? angle + Math.PI : angle;
            target.x = anchor.x + world * Math.cos(direction);
            target.y = anchor.y + world * Math.sin(direction);
            return true;
        }
        if (key === 'angle' && !fixed('angle')) {
            if (fixed('start') && fixed('end')) return false;
            const radians = value * Math.PI / 180;
            if (fixed('end')) {
                start.x = end.x - length * Math.cos(radians);
                start.y = end.y - length * Math.sin(radians);
            } else {
                end.x = start.x + length * Math.cos(radians);
                end.y = start.y + length * Math.sin(radians);
            }
            return true;
        }
        return false;
    }

    if (object.type === "force") {
        /*
         * A Point Force is one vector, and the panel offers it two
         * ways: as a magnitude and a direction, or as the two
         * components it is made of. Each edit is therefore
         * applied to the CURRENT vector and then written back
         * through the one function that updates every
         * representation of it at once.
         *
         * Doing it this way is what makes the two views
         * interchangeable: typing a magnitude and switching to
         * components shows the components that magnitude implies,
         * and typing a component and switching back shows the
         * magnitude and angle those components imply.
         */
        if (
            key === 'start.x' ||
            key === 'start.y'
        ) {
            if (fixed('start') || !g.start) return false;

            const axis = key.split('.')[1];

            g.start[axis] = worldValue;
            g.position = {
                x: g.start.x,
                y: g.start.y
            };

            return true;
        }

        /*
         * THE APPLICATION POINT IS THE SAME PLACE AS THE START.
         *
         * A force is positioned by `position`, and `start` is kept in step
         * with it - `setForceVector` writes both. The panel offers the
         * application point, so the panel's key has to be answered here
         * rather than falling through to the generic position handler,
         * which this branch never reaches: it returns false for anything it
         * does not recognise.
         *
         * It was missing, so typing an application point on a calibrated
         * sheet did nothing at all - the field looked editable and silently
         * refused the edit.
         */
        if (
            key === 'position.x' ||
            key === 'position.y'
        ) {
            if (fixed('position') || !g.position) return false;

            const axis = key.split('.')[1];

            g.position[axis] = worldValue;
            g.start = {
                x: g.position.x,
                y: g.position.y
            };

            return true;
        }

        const vector =
            enggLoadProfile.forceVector(g);

        if (key === 'magnitude') {
            if (fixed('magnitude')) return false;

            /*
             * A TYPED NUMBER IS IN THE UNIT THE STUDENT IS READING, so it is
             * taken back to the base unit - N - before it is stored. The panel
             * converts base -> display for reading, so this is the other half
             * of the same pair: without it, typing 0.25 against a kN force
             * would store 0.25 N and the force would become a thousandth of
             * what the student entered.
             *
             * `convertValue` returns the value unchanged when the unit is
             * unknown, so a feature with no unit at all is unaffected.
             *
             * AN EXPLICITLY TYPED UNIT WINS over the field's stored unit - the
             * same rule the length fields follow. "5 kN" typed into a field
             * reading N means 5 kN, and the selector is moved to match by the
             * binding layer, which writes `forceUnit` before this value is
             * applied. So the resolution reads the CURRENT unit of the
             * geometry, which already reflects the typed unit when there was
             * one.
             */
            const entered =
                enggQuantities?.convertValue?.(
                    value,
                    'force',
                    enggLoadProfile.forceUnit(g),
                    'N'
                ) ?? value;

            enggLoadProfile.setForceVector(
                g,
                entered,
                vector.angle
            );
            return true;
        }

        if (key === 'forceUnit') {
            /*
             * THE UNIT IS THE LABEL; THE MAGNITUDE IS ALWAYS IN N.
             *
             * The stored magnitude is the base-unit value, so switching the
             * unit writes the label and nothing else - the panel converts the
             * number for READING. Writing N·m here would be a second conversion
             * of a number that is not in N·m, which is how a value drifts every
             * time the unit is toggled.
             */
            enggLoadProfile.setForceUnit(g, value);

            return true;
        }

        if (key === 'angle') {
            if (fixed('angle')) return false;
            enggLoadProfile.setForceVector(
                g,
                vector.magnitude,
                value
            );
            return true;
        }

        if (key === 'forceX' || key === 'forceY') {
            if (fixed(key)) return false;

            /*
             * A COMPONENT IS STATED IN THE FORCE'S OWN UNIT, exactly as the
             * magnitude is. The panel shows Fx and Fy converted from N into
             * the force's unit, so a number typed back is taken from that
             * unit to N before the vector is composed - the mirror of the
             * display conversion. Without it, typing 2 against a kN force
             * stored 2 N and the arrow shrank a thousandfold.
             */
            const unit = enggLoadProfile.forceUnit(g);

            const enteredX =
                key === 'forceX'
                    ? enggQuantities?.convertValue?.(value, 'force', unit, 'N') ?? value
                    : vector.fx;

            const enteredY =
                key === 'forceY'
                    ? enggQuantities?.convertValue?.(value, 'force', unit, 'N') ?? value
                    : vector.fy;

            enggLoadProfile.setForceVector(
                g,
                Math.hypot(enteredX, enteredY),
                Math.atan2(enteredY, enteredX) * 180 / Math.PI
            );

            return true;
        }

        return false;
    }

    if (object.type === "load") {
        /*
         * A Distributed Load is one continuous load, and each of
         * its properties is a parameter of that load rather than
         * a separate thing to be edited.
         *
         * The direction is one value shared by every arrow, which
         * is what keeps the field parallel. The interval is a
         * sampling parameter, not a list of forces: changing it
         * changes how finely the same continuous load is drawn.
         * The defining points are the shape of the profile, and a
         * position is stored as a fraction along the body so
         * moving or resizing the body carries the profile with it.
         *
         * EITHER WAY the value is a length typed in the field's own
         * display unit: with a parent it is a station along the body's
         * axis, without one it is a coordinate on the sheet - and both
         * cross the scale the same way, which `worldValue` already is.
         */
        if (
            key === 'start.x' ||
            key === 'start.y' ||
            key === 'end.x' ||
            key === 'end.y'
        ) {
            if (fixed(key)) return false;

            const [pointKey, axis] = key.split('.');

            g[pointKey][axis] = worldValue;

            return true;
        }

        if (key === 'direction') {
            if (fixed('direction')) return false;
            enggLoadProfile.setLoadDirection(g, value);
            return true;
        }

        if (key === 'interval') {
            if (fixed('interval')) return false;
            enggLoadProfile.setLoadInterval(g, value);
            return true;
        }

        if (key === 'magnitude') {
            if (fixed('magnitude')) return false;

            /*
             * ONE MAGNITUDE FOR THE ENTIRE LOADED REGION.
             *
             * A Distributed Load is a single uniform load, so a magnitude
             * typed into its panel is the intensity of the whole region -
             * not one arrow's share of it. The profile is written as two
             * points of the same value, which is exactly what a uniform
             * load is, and the derived intensity follows from them.
             *
             * AN EXPLICITLY TYPED UNIT IS RECORDED ALONGSIDE THE VALUE.
             * The stored number is in the unit the load states, so "5
             * N/mm" typed into a field reading kN/m is a different
             * physical load from "5 kN/m" by a factor of a thousand -
             * storing the number and keeping the old unit would silently
             * multiply the load. Recording the typed unit keeps the
             * number and the unit naming the same quantity, which is the
             * same rule every unit-bearing field follows.
             */
            if (
                typedUnit &&
                enggQuantities.isUnitFor('distributedLoad', typedUnit) &&
                typedUnit !== enggLoadProfile.loadUnit(g)
            ) {
                enggLoadProfile.setLoadUnit(g, typedUnit);
            }

            enggLoadProfile.setProfilePoints(
                g,
                [
                    { t: 0, magnitude: value },
                    { t: 1, magnitude: value }
                ]
            );

            return true;
        }

        if (key === 'loadUnit') {
            /*
             * THE UNIT IS A LABEL, NOT A CONVERSION.
             *
             * kN/m and N/mm are the same physical quantity - one
             * kilonewton per metre IS one newton per millimetre - so switching
             * between them leaves the stored magnitudes exactly as they are
             * and only changes how they are written. Reinterpreting the number
             * (turning "5 kN/m" into "0.005 N/mm") would silently change the
             * load, which is the opposite of what changing a unit means.
             */
            enggLoadProfile.setLoadUnit(g, value);

            return true;
        }

        if (key === 'intensity') {
            if (fixed('intensity')) return false;

            /*
             * Intensity is the mean of the profile, so writing it
             * scales the whole load uniformly rather than
             * overwriting a single arrow's length.
             */
            const points =
                enggLoadProfile.profilePoints(g);

            const peak =
                enggLoadProfile.peakMagnitude(g);

            if (peak <= 0) {
                return false;
            }

            enggLoadProfile.setProfilePoints(
                g,
                points.map(point => ({
                    t: point.t,
                    magnitude: point.magnitude * value / peak
                }))
            );

            return true;
        }

        const loadPoint =
            /^loadPoint\.(\d+)\.(magnitude|t)$/.exec(key);

        if (loadPoint) {
            const index =
                Number(loadPoint[1]);

            const field =
                loadPoint[2];

            if (fixed(key)) return false;

            const points =
                enggLoadProfile.profilePoints(g);

            if (!points[index]) {
                return false;
            }

            if (field === 'magnitude') {
                points[index].magnitude =
                    Math.max(0, value);
            } else {
                /*
                 * A position of 100 is the far end of the body,
                 * so a value typed as a percentage is divided
                 * back down to the fraction the model stores. It is
                 * clamped rather than rejected, because a point
                 * dragged just past the end belongs at the end.
                 */
                const moved = Math.max(
                    0,
                    Math.min(1, value / 100)
                );

                points[index].t = moved;
            }

            /*
             * A point dragged onto its neighbour describes two
             * magnitudes at one location, which the profile
             * supports and the renderer draws. Nothing is merged
             * away here, because a magnitude the user can still
             * see listed must not vanish from the drawing.
             */
            enggLoadProfile.setProfilePoints(
                g,
                points
            );

            return true;
        }

        return false;
    }

    if (
        object.type === "varying-load"
    ) {
        if (
            key === 'direction'
        ) {
            if (fixed('direction')) return false;
            enggLoadProfile.setLoadDirection(g, value);
            return true;
        }

        if (key === 'interval') {
            if (fixed('interval')) return false;
            enggLoadProfile.setLoadInterval(g, value);
            return true;
        }

        if (key === 'startIntensity' || key === 'endIntensity') {
            if (fixed(key)) return false;

            /*
             * AN INTENSITY IS A PHYSICAL QUANTITY stated in the load's own
             * distributed-load unit - not a length and not a bare number.
             * The unit travels beside the value: an explicitly typed unit is
             * recorded so the number and the unit keep naming the same
             * quantity, exactly as the uniform load's magnitude does.
             */
            if (
                typedUnit &&
                enggQuantities.isUnitFor('distributedLoad', typedUnit) &&
                typedUnit !== enggLoadProfile.loadUnit(g)
            ) {
                enggLoadProfile.setLoadUnit(g, typedUnit);
            }

            g[key] = Math.max(0, value);
            return true;
        }
    }

    if (
        object.type === "support" ||
        object.type === "body" ||
        object.type === "particle" ||
        object.type === "moment" ||
        object.type === "load" ||
        object.type === "varying-load" ||
        object.type === "pin-support" ||
        object.type === "roller-support" ||
        object.type === "fixed-support" ||
        object.type === "smooth-support" ||
        object.type === "pin-connection" ||
        object.type === "fixed-connection" ||
        object.type === "slider-connection" ||
        object.type === "connection"
    ) {
        /*
         * Statics features edit through the same property
         * pipeline as geometry, so snapping, constraints
         * and undo all behave identically.
         */
        if (key.startsWith('position.')) {
            if (fixed('position')) return false;
            g.position[key.split('.')[1]] = worldValue;
            return true;
        }

        if (
            key === 'start.x' || key === 'start.y' ||
            key === 'end.x' || key === 'end.y'
        ) {
            const [pointKey, axis] = key.split('.');

            if (fixed(pointKey)) return false;

            /*
             * ========================================================
             * A LOAD'S X IS A STATION, NOT A COORDINATE
             * ========================================================
             *
             * The panel shows a load's two stations as Start and End, and
             * the two are the same numbers as `start.x` and `end.x` - so
             * the key has to mean the same thing here as it does there.
             *
             * Writing the raw x would be right for a horizontal beam and
             * wrong for every other one: on a vertical member every station
             * reads as zero, so the field would look broken and the load
             * would move across the sheet rather than along the beam. The
             * value is therefore converted from a station into a world
             * point ON THE PARENT'S AXIS, which is where a station means
             * what it says.
             *
             * A STATION IS TYPED IN THE FIELD'S OWN DISPLAY UNIT, so the
             * shared helper resolves it - the same rule every other length
             * write follows.
             *
             * THE Y IS NOT WRITTEN AT ALL.
             *
             * It used to be writable, and it was the load's outline height
             * - stored independently of the body and of the direction.
             * That independence is what let a reversed load keep its
             * outline on the side it started: the arrows turned over and
             * the outline stayed, and no field anywhere recorded which side
             * the outline was meant to be on. Deriving the height from the
             * body and the direction removes the disagreement by removing
             * the second answer.
             */
            if (axis === "y" && isLoadGeometry(object)) {
                return false;
            }

            if (axis === "x") {
                const parent =
                    relativeParentOf(object);

                if (parent) {
                    /*
                     * THE STATION IS TYPED IN THE FIELD'S OWN DISPLAY UNIT,
                     * and `pointAtStation` projects in WORLD units - so the
                     * shared conversion runs first, exactly as it does for
                     * the coordinate fields above.
                     */
                    const placed =
                        pointAtStation(
                            parent,
                            worldLengthInDisplayUnits(object, value)
                        );

                    if (!placed) {
                        return false;
                    }

                    g[pointKey].x = placed.x;
                    g[pointKey].y = placed.y;

                    return true;
                }
            }

            /*
             * NO PARENT, so the value is a plain coordinate. It is still a
             * length typed in the field's own unit, and it crosses the
             * scale the same way every other coordinate does.
             */
            g[pointKey][axis] = worldLengthInDisplayUnits(object, value);

            return true;
        }

        /*
         * ========================================================
         * A CHILD'S `relative.x` IS ITS STATION
         * ========================================================
         *
         * The panel shows a force, a moment or a support as a distance
         * along the body, and "Along Body" writes `relative.x`. It used to
         * write an OFFSET from the parent's start, in x and y, so the same
         * field meant two different things depending on which feature was
         * selected - which is not a property, it is a coincidence.
         *
         * A station is one number measured along the parent's own axis, and
         * it is the only figure a child of a body has. It is also what the
         * panel reads, so the round trip - shown, edited, redrawn - ends
         * where it started.
         *
         * A CHILD WITH NO PARENT KEEPS ITS ABSOLUTE POSITION.
         *
         * A force placed on empty canvas is a legitimate thing to draw, and
         * it has no axis to be measured along; refusing the edit would take
         * away a control the panel still shows.
         */
        if (
            key === "relative.x" ||
            key === "relative.y"
        ) {
            if (fixed("relative")) return false;

            if (key === "relative.y") {
                /*
                 * Never writable. The height of a child comes from the
                 * body's own normal and the force's direction; a field here
                 * would be a third answer to the same question.
                 */
                return false;
            }

            const parent =
                            relativeParentOf(object);

                        /*
                         * A STATION IS A LENGTH, SO IT IS WRITTEN IN MILLIMETRES.
                         *
                         * "Along Body" is printed through mmOf, like every other
                         * physical row on the panel, but pointAtStation projects onto
                         * the parent's axis in WORLD units. Passing millimetres
                         * straight in put the child at a distance the number never
                         * described, and the fault is invisible on an uncalibrated
                         * sheet - which is where a student meets it first.
                         *
                         * Converted here for the same reason as the relative-offset
                         * branch above: one conversion, so what the panel shows is
                         * what the panel accepts.
                         *
                         * TYPED IN THE FIELD'S OWN UNIT, so the shared helper
                         * resolves the display unit rather than this branch
                         * assuming millimetres.
                         */
                        const station =
                            worldLengthInDisplayUnits(object, value);

                        const placed = parent
                            ? pointAtStation(parent, station)
                            : null;

            if (parent && !placed) {
                return false;
            }

            const target =
                g.position || g.start;

            if (!target) {
                return false;
            }

            if (parent) {
                target.x = placed.x;
                target.y = placed.y;
            } else {
                /*
                 * A FORCE IN FREE SPACE has no axis to be measured along, so
                 * the x the field shows is a coordinate - and it is a length
                 * typed in the field's own unit, crossing the scale like
                 * every other coordinate.
                 */
                target.x = worldLengthInDisplayUnits(object, value);
            }

            /*
             * A FORCE CARRIES ITS TAIL AND ITS HEAD, and moving the tail
             * must move the head with it at the same length and direction.
             * Writing the tail alone would stretch the arrow as though the
             * magnitude had changed, which is a different edit entirely.
             */
            if (
                object.type === "force" &&
                g.end &&
                Number.isFinite(g.end.x) &&
                g.start
            ) {
                const dx = g.end.x - g.start.x;
                const dy = g.end.y - g.start.y;

                g.end.x = target.x + dx;
                g.end.y = target.y + dy;
            }

            if (g.position && g.start) {
                g.position.x = target.x;
                g.position.y = target.y;
            }

            return true;
        }

        if (key === 'magnitude') {
            if (fixed(key)) return false;
            if (!Number.isFinite(value)) return false;

            /*
             * A MOMENT'S MAGNITUDE IS STORED IN N·m, so a number typed while
             * the panel is reading in kN·m is converted back to base before it
             * is written - the mirror of the conversion the panel does for
             * display. Without it, typing 0.25 against a kN·m moment would
             * store 0.25 N·m.
             */
            g[key] =
                enggQuantities?.convertValue?.(
                    value,
                    'moment',
                    enggLoadProfile.momentUnit(g),
                    'N·m'
                ) ?? value;

            return true;
        }

        if (
            key === 'angle' ||
            key === 'separation' ||
            key === 'intensity' ||
            key === 'orientation' ||
            key === 'reaction'
        ) {
            if (fixed(key)) return false;
            if (!Number.isFinite(value)) return false;
            g[key] = value;
            return true;
        }

        if (key === 'momentUnit') {
            /*
             * THE MOMENT'S UNIT IS A LABEL, NOT A CONVERSION.
             *
             * 1 kN\u00b7m and 1000 N\u00b7m are the same moment, so switching
             * between the units leaves the stored magnitude exactly as it is
             * and only changes how it is written.
             */
            enggLoadProfile.setMomentUnit(g, value);

            return true;
        }

        return false;
    }

    if (object.type === 'rigid-body') {
        /*
         * A rigid body is one body whose outline can change, so
         * its properties are written through the shape-aware
         * keys the panel shows. Writing a centre moves the body
         * whole, and writing a size changes the current shape
         * rather than replacing the body.
         */
        if (key.startsWith('rigidCentre.')) {
            if (fixed('rigidCentre')) return false;
            moveRigidBodyTo(object, key.split('.')[1], value);
            return true;
        }

        if (key === 'rigidWidth' || key === 'rigidHeight') {
            if (fixed(key) || !positive) return false;

            /*
               * MILLIMETRES IN, WORLD UNITS STORED - the same contract
               * every other length in the panel works to, so a body
               * sized in the creation popup and one sized in its own
               * properties come out the same size.
               *
               * TYPED IN THE FIELD'S OWN UNIT, so the shared helper
               * resolves the display unit - the same rule every length
               * branch follows.
               */
             const millimetres = worldLengthInDisplayUnits(object, value);

             resizeRigidBody(object, key === 'rigidWidth' ? 'width' : 'height', millimetres);
            return true;
        }

        if (key === 'rigidRadius') {
            if (fixed(key) || !positive) return false;

            /*
             * MILLIMETRES IN, WORLD UNITS STORED - as for every other
             * length the panel edits.
             *
             * TYPED IN THE FIELD'S OWN UNIT, through the shared helper.
             */
            const millimetres = worldLengthInDisplayUnits(object, value);

            setRigidBodyRadius(object, millimetres);
            return true;
        }

        if (key === 'rigidSides') {
            if (fixed(key)) return false;
            const sides = Math.round(value);
            if (!Number.isFinite(sides) || sides < 3) return false;
            g.sides = sides;
            return true;
        }

        if (key === 'rigidRotation') {
            if (fixed(key)) return false;
            if (!Number.isFinite(value)) return false;
            g.rotation = value;
            return true;
        }

        if (key.startsWith('points.')) {
            const [, index, axis] = key.split('.');
            if (fixed(`points.${index}`) || !g.points?.[index]) return false;
            g.points[index][axis] = worldValue;
            return true;
        }

        return false;
    }

    if (
        object.type === 'beam' ||
        object.type === 'truss' ||
        object.type === 'cable' ||
        object.type === 'shaft'
    ) {
        /*
         * Slender members edit through their endpoints, plus
         * whichever property belongs to their own role.
         */
        if (
            key === 'start.x' || key === 'start.y' ||
            key === 'end.x' || key === 'end.y'
        ) {
            const [pointKey, axis] = key.split('.');
            if (fixed(pointKey)) return false;
            g[pointKey][axis] = worldValue;
            return true;
        }

        if (
            key === 'depth' ||
            key === 'panels' ||
            key === 'tension' ||
            key === 'diameter' ||
            key === 'torque' ||
            key === 'startIntensity' ||
            key === 'endIntensity'
        ) {
            if (fixed(key)) return false;
            if (!Number.isFinite(value)) return false;

            /*
             * A SHAFT'S TORQUE IS A MOMENT, so it is stated in the feature's
             * moment unit and an explicitly typed unit is recorded beside
             * the value - the same rule every other statics magnitude
             * follows. The panel reads the number back in that unit.
             */
            if (
                key === 'torque' &&
                typedUnit &&
                enggQuantities.isUnitFor('moment', typedUnit) &&
                typedUnit !== enggLoadProfile.momentUnit(g)
            ) {
                enggLoadProfile.setMomentUnit(g, typedUnit);
            }

            g[key] = value;
            return true;
        }

        /*
         * A TRUSS'S HEIGHT IS A PHYSICAL LENGTH, SO IT CROSSES THE SCALE.
         *
         * It is the envelope the structure stands in - read live off the
         * drawn members - and the panel captions it in millimetres like every
         * other length. It was not handled here at all, so typing a height
         * silently did nothing while the field looked editable.
         *
         * `depth` and `diameter` above are NOT converted, because they are
         * not lengths the student measures: they are cross-section and
         * rendering parameters that never appear as a dimension.
         */
        if (key === 'height') {
            if (fixed(key)) return false;

            const worldHeight = worldLengthInDisplayUnits(object, value);

            if (!Number.isFinite(worldHeight)) return false;

            g.height = worldHeight;
            return true;
        }

        return false;
    }

    if (object.type === 'point') {
        if (fixed('position')) return false;
        const target = g.position || g.point || g;
        const [part, axis] = key.split('.');
        if (part !== 'position') return false;

        /*
         * `worldValue`, NOT the raw typed number.
         *
         * Every other coordinate branch writes the converted value; this one
         * wrote what the student typed straight into the geometry. On a
         * calibrated sheet that put the point in the wrong place by the scale
         * factor, and with a display unit chosen it ignored the unit as well -
         * so typing "2" in a field reading inches stored 2 world units instead
         * of 2 inches. `worldValue` is the typed number in the field's own unit,
         * already converted to world units through the document scale.
         */
        target[axis] = worldValue;
        return true;
    }

    if (object.type === 'circle' || object.type === 'arc') {
        if (key.startsWith('center.')) {
            if (fixed('center')) return false;
            g.center[key.split('.')[1]] = worldValue;
            return true;
        }
        if ((key === 'radius' || key === 'diameter') && positive && !fixed(key) && !fixed(key === 'radius' ? 'diameter' : 'radius')) {
            /*
             * MILLIMETRES IN, WORLD UNITS STORED - the same contract
             * the span and rectangle setters use, and the same
               * conversion the creation popup applies. A Diameter is
               * halved on the way in, after the conversion, so "50 mm"
               * becomes a radius of 25 mm whether it was typed in the
               * panel or in the creation popup.
               *
               * TYPED IN THE FIELD'S OWN UNIT, through the shared helper -
               * the same rule every other length branch follows, so a
               * radius read in metres is typed in metres too.
               */
             const millimetres = worldLengthInDisplayUnits(object, value);

            g.radius =
                key === 'radius'
                    ? millimetres
                    : millimetres / 2;

            return true;
        }
        if (object.type === 'arc') {
            if (fixed(key)) return false;
            if (key === 'startAngle' || key === 'endAngle') {
                if (fixed('includedAngle')) return false;
                g[key] = value * Math.PI / 180;
                g.sweep = g.endAngle - g.startAngle;
                return true;
            }
            if (key === 'includedAngle') {
                if (fixed('endAngle')) return false;
                g.sweep = value * Math.PI / 180;
                g.endAngle = g.startAngle + g.sweep;
                return true;
            }
        }
        return false;
    }

    if (object.type === 'rectangle') {
        /*
         * ========================================================
         * THE ANCHOR CORNER IS THE STORED POSITION
         * ========================================================
         *
         * `geometry.position` IS the top-left corner of the rectangle in world
         * space - the same point the panel now labels Position X / Position Y. So
         * this is a direct write: no halving, no re-derivation, and no dependency
         * on `width` or `height`, which is why resizing cannot move the anchor.
         *
         * `fixed('position')` is the engineering constraint check, and the shared
         * lock check at the top of this function already refuses a `position.x`
         * write on a LOCKED rectangle. The two are deliberately different gates:
         * locked means "cannot be moved through any editing operation", fixed
         * means "this quantity is prescribed within the constraint model".
         */
        if (key.startsWith('position.')) {
            if (fixed('position')) return false;

            const axis = key.split('.')[1];

            if (!g.position) return false;

            g.position[axis] = worldValue;

            return true;
        }

        /*
         * THE CENTRE KEYS ARE KEPT SO OLDER BINDINGS STILL WRITE.
         *
         * The panel no longer shows a centre, but a document or a binding saved
         * against the previous panel can still send one. Answering it keeps a
         * rectangle editable rather than silently refusing an edit - the same
         * backward-compatibility rule the centre-based geometry representation
         * already follows everywhere else.
         */
        if (key.startsWith('centre.')) {
            if (fixed('centre')) return false;
            const axis = key.split('.')[1];
            g.position[axis] = axis === 'x' ? worldValue - g.width / 2 : worldValue + g.height / 2;
            return true;
        }
        if ((key === 'width' || key === 'height') && positive && !fixed(key)) {
            /*
             * The panel shows these as MILLIMETRES and the geometry
             * stores WORLD UNITS, so the value crosses the document
             * scale on the way in. This is the same conversion the
               * creation popup applies, which is what makes a Width
               * typed at creation and a Width typed in the panel produce
               * the same rectangle.
               *
               * TYPED IN THE FIELD'S OWN UNIT, through the shared helper.
               */
             g[key] = worldLengthInDisplayUnits(object, value);
            return true;
        }
        if (key === 'rotation' && !fixed(key)) {
            g.rotation = value;
            return true;
        }
        return false;
    }

    if (object.type === 'polygon') {
        /*
         * Every edit writes to the polygon's defining
         * parameters. The vertices are derived from
         * these, so there is no second copy to keep in
         * sync.
         */
        if (key.startsWith('center.')) {
            if (fixed('center')) return false;
            g.center[key.split('.')[1]] = worldValue;
            return true;
        }
        if (key === 'sides') {
            if (fixed('sides')) return false;
            const sides = Math.round(value);
            if (!Number.isFinite(sides) || sides < 3) return false;
            g.sides = sides;
            return true;
        }
        if (key === 'radius') {
            if (fixed('radius') || !positive) return false;

            /*
             * MILLIMETRES IN, WORLD UNITS STORED - as for every other
             * length in the panel.
             *
             * TYPED IN THE FIELD'S OWN UNIT, through the shared helper.
             */
            g.radius = worldLengthInDisplayUnits(object, value);

            return true;
        }
        if (key === 'rotation') {
            if (fixed('rotation')) return false;
            g.rotation = value * Math.PI / 180;
            return true;
        }
        return false;
    }

    if (
        object.type ===
            "reference-axis-x-positive" ||
        object.type ===
            "reference-axis-x-negative" ||
        object.type ===
            "reference-axis-y-positive" ||
        object.type ===
            "reference-axis-y-negative"
    ) {
        /*
         * Each axis edits only its own geometry, so a
         * change to one never moves the other three.
         */
        if (key.startsWith('origin.')) {
            if (fixed('origin')) return false;
            g.origin[key.split('.')[1]] = worldValue;
            return true;
        }
        if (key === 'axisLength') {
            if (fixed('axisLength') || !positive) return false;

            /*
             * MILLIMETRES IN, WORLD UNITS STORED.
             *
             * The panel captions this field with a unit and enters
             * millimetres, and the geometry is in world units - so
             * writing `value` straight through stores a number that
             * means nothing, and an axis typed as 100 mm becomes 100
             * world units long instead of the length the student asked
             * for.
             *
             * This is the SAME conversion every other length setter
             * and the creation popup use. A length that is correct
             * through one route and wrong through another is worse
             * than one that is consistently wrong, because there is
             * then no single place to look for the mistake.
             *
             * TYPED IN THE FIELD'S OWN UNIT, through the shared helper.
             */
            g.axisLength = worldLengthInDisplayUnits(object, value);

            return true;
        }
        return false;
    }

    if (object.type === COORDINATE_SYSTEM_TYPE) {
        /*
         * One feature, four independent extensions.
         * Writing one length never touches the others.
         */
        if (key.startsWith('origin.')) {
            if (fixed('origin')) return false;
            g.origin[key.split('.')[1]] = worldValue;
            return true;
        }

        if (
            [
                'xPositiveLength',
                'xNegativeLength',
                'yPositiveLength',
                'yNegativeLength',
                'xAxisLength',
                'yAxisLength',
                'axisLength'
            ].includes(key)
        ) {
            if (fixed(key) || !positive) return false;

            /*
             * MILLIMETRES IN, WORLD UNITS STORED - as for every other
             * length the panel edits, and for the same reason: a raw
             * write would make a 50 mm axis 50 world units long.
             *
             * TYPED IN THE FIELD'S OWN UNIT, through the shared helper.
             */
            g[key] = worldLengthInDisplayUnits(object, value);

            return true;
        }

        /*
         * THE AXIS LABELS.
         *
         * The stored text is the user's, and an EMPTY string is stored as an
         * empty string - clearing a label means "no label here", so falling
         * back to "X" would silently undo the student's decision every time
         * they cleared the field.
         */
        if (key === 'xLabel' || key === 'yLabel') {
            g[key] = String(value ?? '');

            return true;
        }
    }

    if (object.type === 'dimension') {
        /*
         * WHICH LENGTH UNIT A DIMENSION READS IN.
         *
         * The measurement itself is never stored - it is recomputed from the
         * referenced geometry on every panel draw and every redraw - so this
         * writes NO value at all. It records only the unit the student wants
         * the number WRITTEN in, and `formatMeasurement` does the conversion
         * through the shared unit table.
         *
         * That is what keeps a dimension DRIVING across a unit change: the
         * reference, the placement and the world-scale relationship are all
         * untouched, so a 100 mm span read in cm shows "10 cm" and still
         * updates the moment the geometry it measures moves.
         *
         * A unit the length quantity does not have is refused rather than
         * stored, so a dimension can never be left asking to be read in a
         * force or a moment.
         */
        if (key === 'displayUnit') {
            const unit = String(value ?? '');

            if (unit && !enggQuantities?.isUnitFor?.('length', unit)) {
                return false;
            }

            /*
             * THE SHEET'S OWN UNIT IS STORED AS NULL. A dimension read in mm -
             * the unit the sheet already works in - keeps no override, which is
             * the state every dimension had before this field existed.
             */
            object.displayUnit = unit && unit !== 'mm' ? unit : null;

            return true;
        }

        /*
         * THE DRIVING / DRIVEN STATE.
         *
         * A Driven dimension reports the geometry instead of controlling it.
         * The panel offers it as a word - "Driving" or "Driven" - so this is
         * read as a statement rather than as a boolean, exactly as a moment's
         * `direction` is.
         *
         * NOTHING ELSE IS TOUCHED. Switching to Driven RELEASES the constraint
         * implicitly, because a Driven dimension simply refuses to move
         * geometry (see `dimension-edit.applyDimensionValue`) - and the current
         * geometry is preserved exactly, which is what the requirement asks
         * for. Switching back to Driving re-enables the control without moving
         * anything until the student next edits the value.
         */
        if (key === 'driven') {
            object.driven = value === true || value === 'driven';

            return true;
        }

        return false;
    }

    if (object.type === 'variable-dimension') {
        /*
         * THE SYMBOL IS THE VALUE.
         *
         * Stored exactly as typed, INCLUDING an empty string: clearing the
         * field is how a student says they have named the variable but not
         * written it yet, so falling back to a default would overwrite their
         * intent on every keystroke.
         *
         * WRITTEN TO THE FEATURE, NOT TO ITS GEOMETRY. The model keeps the
         * symbol on the variable itself (`variable.symbol`), because that is
         * where the renderer, the hit test and `variableText` read it - so this
         * used to write to `geometry.symbol`, a place nothing reads, and an
         * edit appeared to do nothing at all.
         *
         * ANYTHING IS ACCEPTED: a name, a number, or an expression such as
         * `L/2`. This is the student's own algebra and it is never evaluated,
         * rewritten or reduced to a number here.
         *
         * Nothing else about the feature changes: the references, the placement
         * and every relationship stay exactly as they were, so editing the
         * symbol cannot detach the variable from the geometry it names.
         */
        if (key === 'symbol') {
            const text = String(value ?? '');

            object.symbol = text;

            /*
             * WRITING A SYMBOL CLEARS THE UNKNOWN MARK, and clearing the symbol
             * does not set it. They are two different statements - "here is my
             * value" and "this is not known" - so one must not silently imply
             * the other. The checkbox below is how the student makes the second
             * one.
             */
            if (text) {
                object.unknown = false;
            }

            return true;
        }

        if (key === 'unknown') {
            const isUnknown = value === true || value === 'true';

            object.unknown = isUnknown;

            /*
             * MARKING IT UNKNOWN CLEARS ANY SYMBOL, because a feature cannot
             * both state a value and state that it has none. The same rule the
             * Statics quantities follow: setting one state clears the others.
             */
            if (isUnknown) {
                object.symbol = '';
            }

            return true;
        }

        if (key.startsWith('placement.')) {
            const axis = key.split('.')[1];

            /*
             * A PLACEMENT IS A POSITION ON THE SHEET, so it is a length
             * typed in the field's own display unit - the same conversion
             * every other coordinate write runs. Writing the raw number
             * would put a moved annotation four times too far on any
             * calibrated sheet.
             */
            g.placement = g.placement || { x: 0, y: 0 };
            g.placement[axis] = worldLengthInDisplayUnits(object, value);

            return true;
        }
    }

    if (object.type === 'annotate') {
        /*
         * ========================================================
         * AN ANNOTATE FEATURE'S OWN FIELDS
         * ========================================================
         *
         * A note, a label, a leader, a callout, an arrow, a symbol, a
         * tolerance and a table all store their specifics on `geometry`,
         * which is where the renderer, the hit test and the save path all
         * read them from - see features/annotations/annotate-model.js. So
         * the panel writes there too, and nothing has to be copied about: a
         * value typed in the panel IS the value drawn and saved.
         *
         * A PLACEMENT COORDINATE is handled by the shared length-coordinate
         * branch at the top of this function, which already converts typed
         * millimetres to world units for any key beginning `position.`,
         * `start.` or `end.` - so a moved note and a moved arrow both land
         * where the student typed, through the one conversion.
         */
        if (key === 'text') {
            object.text = String(value ?? '');

            return true;
        }

        if (key === 'annotateKind') {
            /*
             * The KIND is not retyped here - it is chosen by which tool made
             * the feature - so this only guards against a panel writing a
             * kind the model does not know.
             */
            return false;
        }

        if (key === 'symbolId') {
            g.symbolId = String(value ?? 'datum');

            return true;
        }

        if (key === 'toleranceMode') {
            g.toleranceMode = String(value ?? 'symmetric');

            return true;
        }

        if (
            key === 'toleranceValue' ||
            key === 'toleranceUpper' ||
            key === 'toleranceLower'
        ) {
            const field =
                key === 'toleranceValue'
                    ? 'value'
                    : key === 'toleranceUpper'
                      ? 'upper'
                      : 'lower';

            g.toleranceValues = g.toleranceValues || {};
            g.toleranceValues[field] = value;

            return true;
        }

        if (key === 'rows' || key === 'columns') {
            const number = Math.max(
                1,
                Math.round(Number(value) || 1)
            );

            const nextRows =
                key === 'rows' ? number : Number(g.rows) || 1;

            const nextColumns =
                key === 'columns' ? number : Number(g.columns) || 1;

            /*
             * RESIZING KEEPS WHAT WAS TYPED. The cell list is rebuilt to the
             * new shape, preserving every cell that still exists and blanking
             * the ones that are new - so growing a table never loses work and
             * shrinking one never leaves a cell with no grid position.
             */
            const oldCells = Array.isArray(g.cells) ? g.cells : [];
            const oldColumns = Number(g.columns) || 1;

            const cells = [];

            for (let row = 0; row < nextRows; row += 1) {
                for (let column = 0; column < nextColumns; column += 1) {
                    const kept =
                        row < (Number(g.rows) || 1) &&
                        column < oldColumns
                            ? oldCells[row * oldColumns + column]
                            : '';

                    cells.push(kept === undefined ? '' : kept);
                }
            }

            g.rows = nextRows;
            g.columns = nextColumns;
            g.cells = cells;

            return true;
        }

        const cellMatch = /^cell\.(\d+)$/.exec(key);

        if (cellMatch) {
            const index = Number(cellMatch[1]);

            if (!Array.isArray(g.cells)) {
                g.cells = [];
            }

            g.cells[index] = String(value ?? '');

            return true;
        }

        if (key.startsWith('start.') || key.startsWith('end.')) {
            const [pointKey, axis] = key.split('.');

            g[pointKey] = g[pointKey] || { x: 0, y: 0 };
            g[pointKey][axis] = worldValue;

            return true;
        }
    }
    return false;
}
