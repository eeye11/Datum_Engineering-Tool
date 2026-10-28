/*
 * The continuous distributed load, and the shared definition
 * of a force vector.
 *
 * A Distributed Load is ONE feature. What the student places
 * while drawing it are a small number of magnitude-defining
 * points; the row of arrows is the renderer sampling the
 * continuous profile between them. That is why the profile
 * lives here rather than in the renderer: the Features panel,
 * the handles, the fit bounds and the drawing all read the
 * same numbers, so editing a magnitude in the panel moves
 * the arrows instead of rebuilding the feature.
 *
 * A Point Force is the same idea at a single point, so its
 * magnitude/direction <-> component conversions live here too
 * and there is exactly one set of vector rules in the
 * application.
 */
import enggQuantities from "../../../../shared/units/quantities.js";

    /*
     * A load is stored with a direction as a unit vector in
     * degrees plus its own profile points. A load created
     * before that (or by a file written by an older build) has
     * only start/end/intensity, so those are read as a
     * degenerate profile with a downward direction and are
     * migrated by the caller's first write.
     */
    const DEFAULT_LOAD_DIRECTION = -90;

    const MIN_LOAD_INTERVAL = 0.5;
    const MAX_LOAD_INTERVAL = 500;
    const DEFAULT_LOAD_INTERVAL = 20;
    const MAX_LOAD_ARROWS = 200;

    /*
     * ========================================================
     * ONE UNIT FOR A LOAD'S MAGNITUDE
     * ========================================================
     *
     * A distributed load's intensity is stated in kN/m or N/mm, and those
     * two are the SAME physical quantity - one kilonewton per metre is one
     * newton per millimetre - so the STORED NUMBER does not change when the
     * unit does. Only the LABEL changes, and that is what keeps the drawing,
     * the Features panel and every popup reading the same figure rather than
     * two equivalent ones in different clothes.
     *
     * The unit is recorded ON THE LOAD, once, and read from there by
     * everything that displays the magnitude. There is deliberately no
     * drawing-unit and features-unit kept apart, because two copies of one
     * fact are free to drift and a drawing showing 5 kN/m beside a panel
     * showing 5 N/mm is exactly that drift.
     */
    const DEFAULT_LOAD_UNIT = "kN/m";

    /*
     * THE LOAD UNITS COME FROM THE SHARED QUANTITY TABLE.
     *
     * `unitsFor("distributedLoad")` is the ONE list of units a load may be
     * stated in, so the units this module accepts and the units the panel
     * offers cannot drift apart. The literal list is kept only as the fallback
     * for a harness that loads this module on its own.
     */
    const LOAD_UNITS =
        enggQuantities.unitsFor("distributedLoad");

    function isLoadUnit(value) {
        return enggQuantities.isUnitFor(
            "distributedLoad",
            value
        );
    }

    /*
     * The unit a load's magnitude is stated in, defaulting for a load that
     * was written before the unit was recorded. The default is the one the
     * drawing has always used, so an older file reads exactly as it did.
     */
    function loadUnit(geometry) {
        const stored = geometry?.loadUnit;

        return isLoadUnit(stored)
            ? stored
            : DEFAULT_LOAD_UNIT;
    }

    /*
     * CHANGING A LOAD'S UNIT CONVERTS THE STORED NUMBER.
     *
     * The stored magnitude is in the unit the load states, so that convention
     * only survives a unit change if the number is taken to the new unit with
     * it. kN/m and N/mm are numerically identical - one kilonewton per metre
     * IS one newton per millimetre - so between those the conversion is the
     * identity and nothing moves. But the table also carries lbf/ft, which is
     * a genuinely different scale, and relabelling a 5 kN/m load as "5 lbf/ft"
     * would silently multiply it by fourteen.
     *
     * So `convertValue` runs over every magnitude the load carries - the
     * profile points, the derived intensity and the two varying-load ends -
     * through the shared table. The physical load never changes; only the
     * number it is written as does, which is what switching a unit means.
     */
    function setLoadUnit(geometry, unit) {
        if (!geometry) {
            return DEFAULT_LOAD_UNIT;
        }

        if (!isLoadUnit(unit)) {
            return loadUnit(geometry);
        }

        const previous = loadUnit(geometry);

        if (previous !== unit) {
            const convert = value =>
                enggQuantities.convertValue(
                    value,
                    "distributedLoad",
                    previous,
                    unit
                );

            if (Array.isArray(geometry.points) && geometry.points.length) {
                geometry.points = geometry.points.map(point => ({
                    ...point,
                    magnitude: convert(point.magnitude)
                }));
            }

            if (Number.isFinite(Number(geometry.intensity))) {
                geometry.intensity = convert(geometry.intensity);
            }

            for (const key of ["startIntensity", "endIntensity"]) {
                if (Number.isFinite(Number(geometry[key]))) {
                    geometry[key] = convert(geometry[key]);
                }
            }
        }

        geometry.loadUnit = unit;

        return geometry.loadUnit;
    }

    /*
     * A FORCE'S MAGNITUDE IS STATED IN kN OR N
     * ========================================================
     *
     * Same rule as a load's unit, for the same reason: the quantity is what
     * decides the unit, and the unit is recorded ON THE FEATURE so the drawing
     * and the Features panel state the value the same way.
     *
     * kN AND N ARE THE SAME PHYSICAL FAMILY, and switching between them is a
     * CONVERSION. The stored magnitude is held in N - the base unit - and the
     * unit beside it says how it is written, so `250 N` read in kN is `0.25 kN`
     * and the push has not changed.
     *
     * IT USED TO RELABEL INSTEAD, and the difference is a wrong drawing: a
     * force entered as 250 N and switched to kN showed "250 kN" - a thousand
     * times the load the student typed. The stored number stays authoritative
     * in N, which is what makes the conversion exact and one-way rather than a
     * number that drifts every time the unit is toggled.
     */
    const DEFAULT_FORCE_UNIT = "N";

    /*
     * THE FORCE UNITS COME FROM THE SHARED QUANTITY TABLE, like the load
     * and moment lists, so the three families cannot drift apart.
     */
    const FORCE_UNITS =
        enggQuantities.unitsFor("force");

    function isForceUnit(value) {
        return enggQuantities.isUnitFor("force", value);
    }

    function forceUnit(geometry) {
        const stored = geometry?.unit;

        return isForceUnit(stored)
            ? stored
            : DEFAULT_FORCE_UNIT;
    }

    /*
     * `geometry.magnitude` IS ALWAYS IN N.
     *
     * That is the invariant the conversion rests on: the number stored is in
     * the base unit, and the unit field only says how to WRITE it. So there is
     * no conversion to do here at all - changing the unit changes the label,
     * and the magnitude stays the force it always was.
     *
     * The panel reads the magnitude through `forceUnit` and converts for
     * DISPLAY, which is where the arithmetic belongs.
     */
    function setForceUnit(geometry, unit) {
        if (!geometry) {
            return DEFAULT_FORCE_UNIT;
        }

        geometry.unit = isForceUnit(unit)
            ? unit
            : DEFAULT_FORCE_UNIT;

        return geometry.unit;
    }

    /*
     * A MOMENT'S OWN UNIT.
     *
     * The same rule as a force's, applied to the other quantity a feature
     * carries: the unit belongs to the FEATURE, so the panel and the annotation
     * beside the curved arrow state the same thing, and changing the unit
     * relabels the value rather than scaling it.
     *
     * The unit is stored on the feature's geometry under its own key, so a
     * moment and a force can be written in different units without either
     * overwriting the other.
     */
    const DEFAULT_MOMENT_UNIT = "N\u00b7m";

    /*
     * THE MOMENT UNITS COME FROM THE SHARED QUANTITY TABLE, not from a
     * local list.
     *
     * There were TWO moment unit lists in the application - this literal
     * and a second one beside the moment's value popup - so the units a
     * moment could be stated in depended on which part of the code was
     * asking. `unitsFor("moment")` is the ONE list, so a unit added to the
     * table appears everywhere and a unit removed disappears everywhere.
     */
    const MOMENT_UNITS =
        enggQuantities.unitsFor("moment");

    function isMomentUnit(value) {
        return enggQuantities.isUnitFor("moment", value);
    }

    function momentUnit(geometry) {
        const stored = geometry?.momentUnit;

        return isMomentUnit(stored)
            ? stored
            : DEFAULT_MOMENT_UNIT;
    }

    function setMomentUnit(geometry, unit) {
        if (!geometry) {
            return DEFAULT_MOMENT_UNIT;
        }

        geometry.momentUnit = isMomentUnit(unit)
            ? unit
            : DEFAULT_MOMENT_UNIT;

        return geometry.momentUnit;
    }

    /*
     * A NUMBER AND A UNIT READ OFF ONE EDIT, for a popup or a panel field.
     *
     * The value is not converted: kN/m and N/mm are numerically identical,
     * so "5 kN/m" and "5 N/mm" are the same load written two ways. What the
     * student typed is what is stored, with the unit they named beside it.
     */
    function readLoadValue(text, fallbackUnit) {
        const source = String(text ?? "").trim();

        /*
         * A NUMBER, AND OPTIONALLY THE UNIT IT IS IN.
         *
         * The unit may be a load unit (kN/m, N/mm) or an engineering unit a
         * force or a moment is stated in (N, kN, N·m). The token is captured
         * generically and then checked against what the quantity ALLOWS, so
         * the one reader serves every value popup without a per-quantity
         * regex. A unit the quantity does not accept reads as no unit at all,
         * which falls back to the popup's own choice.
         */
        const match = source.match(
            /^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([A-Za-z\u00b7\/]+)?$/
        );

        if (!match) {
            return null;
        }

        const value = Number(match[1]);

        if (!Number.isFinite(value)) {
            return null;
        }

        const named = match[2];

        /*
         * THE TYPED UNIT WINS; otherwise the popup's own unit is kept as-is.
         * The fallback is whatever the unit control is showing, which is
         * already the right quantity's unit - a force reads "N" and a load
         * reads "kN/m" - so it is passed through rather than forced to the
         * load default.
         */
        const fallback =
            typeof fallbackUnit === "string" && fallbackUnit.length
                ? fallbackUnit
                : DEFAULT_LOAD_UNIT;

        return {
            value,
            unit: named || fallback
        };
    }

    function finite(value, fallback = 0) {
        const number = Number(value);

        return Number.isFinite(number) ? number : fallback;
    }

    function clampInterval(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return DEFAULT_LOAD_INTERVAL;
        }

        return Math.min(
            MAX_LOAD_INTERVAL,
            Math.max(MIN_LOAD_INTERVAL, Math.abs(number))
        );
    }

    /*
     * ========================================================
     * A POINT HAS AN IDENTITY OF ITS OWN
     * ========================================================
     *
     * A magnitude annotation belongs to a DEFINING POINT, not to a
     * slot in an array. Storing the link as an array index ties it to
     * the position the point happened to occupy when the label was
     * dragged, so reordering, inserting or removing a point silently
     * reassigns every label after it - a student who moves Point 2's
     * label finds Point 3's label moved instead.
     *
     * So every point carries a stable `id`, minted once when the point
     * is first created, and an annotation records THAT. The id is
     * opaque and never shown; it exists only to make the ownership
     * survive the array changing shape.
     */
    function mintPointId() {
        const generated =
            globalThis.crypto &&
            typeof globalThis.crypto.randomUUID === "function"
                ? globalThis.crypto.randomUUID()
                : `${Date.now()}-${Math.random()
                      .toString(16)
                      .slice(2)}`;

        return `lp-${generated}`;
    }

    /*
     * A deterministic id for a point that was saved before points had
     * one, so a legacy file still develops stable identities rather
     * than new ones on every read - which would orphan every
     * annotation position on reload.
     */
    function legacyPointId(index, point) {
        const t = finite(point?.t);
        return `lp-legacy-${index}-${Math.round(t * 1e6)}`;
    }

    /*
     * The defining points of a load, as a plain list of
     * { id, t, magnitude } sorted along the body.
     *
     * The student's points are stored on the body rather than
     * as absolute world positions, so moving or resizing the
     * body carries the profile with it instead of detaching
     * it.
     */
    function profilePoints(geometry) {
        if (!geometry) {
            return [];
        }

        const stored = Array.isArray(geometry.points)
            ? geometry.points
            : [];

        if (stored.length) {
            /*
             * The order the points are READ in is by position along
             * the body, but identity comes from the point itself. The
             * index is used only to name a legacy point that has no id
             * yet, and only within this one read - so sorting cannot
             * swap two annotations' ownership.
             */
            return stored
                .map((point, index) => ({ point, index }))
                .filter(entry =>
                    entry.point && Number.isFinite(entry.point.t)
                )
                .sort((a, b) => finite(a.point.t) - finite(b.point.t))
                .map(entry => ({
                    id:
                        typeof entry.point.id === "string" &&
                        entry.point.id.length
                            ? entry.point.id
                            : legacyPointId(entry.index, entry.point),
                    t: finite(entry.point.t),
                    magnitude: finite(entry.point.magnitude)
                }));
        }

        /*
         * A VARYING LOAD made by its tool stores the two end
         * intensities, not a profile. It is read as the two-point
         * profile it describes - the same reading `drawnProfile`
         * gives the canvas - so the source and the overlay agree
         * on its arrows. Without this the source writer saw no
         * intensity at all and wrote the load as nothing.
         */
        if (
            geometry.startIntensity !== undefined ||
            geometry.endIntensity !== undefined
        ) {
            return [
                {
                    id: legacyPointId(0, { t: 0 }),
                    t: 0,
                    magnitude: finite(geometry.startIntensity)
                },
                {
                    id: legacyPointId(1, { t: 1 }),
                    t: 1,
                    magnitude: finite(geometry.endIntensity)
                }
            ];
        }

        /*
         * A load with no profile of its own is the original
         * uniform one: the same intensity everywhere along
         * the body. Reading it this way means an old file
         * still draws and still fits without a migration step.
         */
        return [
            {
                id: legacyPointId(0, { t: 0 }),
                t: 0,
                magnitude: finite(geometry.intensity)
            },
            {
                id: legacyPointId(1, { t: 1 }),
                t: 1,
                magnitude: finite(geometry.intensity)
            }
        ];
    }

    /*
     * Write a profile back onto the geometry, keeping the
     * derived uniform intensity in step so anything that
     * still reads `intensity` sees the mean of the profile.
     *
     * AN EXISTING POINT KEEPS ITS ID. A write is how a magnitude edit
     * and a position drag both land, and neither is a reason for the
     * point to become a different point - so the id travels with it.
     * A point that arrives without one is genuinely new (added by the
     * panel or by a paste) and is given one here, once, so it can own
     * an annotation from that moment on.
     */
    function setProfilePoints(geometry, points) {
        const ordered = (points || [])
            .filter(point => point && Number.isFinite(point.t))
            .map(point => ({
                id:
                    typeof point.id === "string" &&
                    point.id.length
                        ? point.id
                        : mintPointId(),
                t: finite(point.t),
                magnitude: finite(point.magnitude)
            }))
            .sort((a, b) => a.t - b.t);

        geometry.points = ordered;

        const mean =
            ordered.length
                ? ordered.reduce(
                    (sum, point) => sum + point.magnitude,
                    0
                ) / ordered.length
                : 0;

        geometry.intensity = mean;

        return ordered;
    }

    /*
     * The direction of a load, in degrees, measured the same
     * way the rest of the drawing measures: counterclockwise
     * from +X in world coordinates, which is what atan2
     * already returns.
     *
     * UNKNOWN IS NOT ZERO, AND IT IS NOT THE DEFAULT EITHER.
     *
     * A load whose direction the student has marked unknown has no
     * authoritative direction, so this reports null rather than falling back
     * to straight down. The fallback exists for a file written before loads
     * carried a direction at all - a real value the drawing was using - but
     * it must never stand in for a direction the student has explicitly
     * declared unknown, because that draws arrows pointing a way nobody
     * chose while the panel shows a blank field.
     */
    function loadDirection(geometry) {
        if (
            geometry &&
            geometry.directionUnknown === true
        ) {
            return null;
        }

        if (
            geometry &&
            Number.isFinite(Number(geometry.direction)) &&
            geometry.direction !== null &&
            geometry.direction !== ""
        ) {
            return finite(geometry.direction, DEFAULT_LOAD_DIRECTION);
        }

        return DEFAULT_LOAD_DIRECTION;
    }

    /*
     * THE SIDE A LOAD IS DRAWN ON, PINNED THE FIRST TIME IT IS KNOWN.
     *
     * Typing a direction is not a reversal - it is the student saying which
     * way the load acts from the outset - so the side is settled the first
     * time it can be, and never revisited. After that the field is read
     * back and ignored, because by then the load exists and its side is
     * part of it.
     *
     * WITHOUT THIS, TYPING A DIRECTION MOVED THE LOAD TO THE OTHER SIDE.
     * The drawn force lines are placed along the span's outward normal, and
     * the sense of that normal was being taken from the direction itself.
     * So setting a direction to the opposite sign moved the outline as
     * well as the arrows - which is a different load, not the same load
     * pointing the other way.
     *
     * A load that has been reversed by the Reverse control keeps the side
     * it was made with, because a reversal explicitly does not move it:
     * `reverseLoadDirection` touches one boolean and nothing here.
     */
    function setLoadDirection(geometry, degrees) {
      geometry.direction = finite(degrees, DEFAULT_LOAD_DIRECTION);

      const side = Number(geometry?.normalSide);

      if (side !== 1 && side !== -1) {
        geometry.normalSide =
          loadNormalSide(geometry);
      }

      return geometry.direction;
    }

    /*
     * Turn a load's force vectors around, by exactly 180 degrees.
     *
     * This is deliberately the smallest possible statement about a
     * reversal: the DIRECTION is negated and nothing else is
     * touched. It is the whole reason the reversal is a function on
     * the model rather than something a caller assembles.
     *
     * What must NOT change, and what would change if a reversal were
     * expressed as a change of span or of end order:
     *
     *   - the loaded span. The span still runs A to B, and the
     *     region the load acts on is the same region.
     *   - the start and end points themselves. A load that
     *     reversed its span would move every force to the other
     *     side of the body, which is a different load.
     *   - every profile point's position and magnitude. The
     *     magnitude profile is the SHAPE of the load; reversing
     *     the direction does not reshape it, so a triangular
     *     profile stays triangular with its peak where it was.
     *   - the object itself. The load is not rebuilt, so its id,
     *     its name, its parent, its style and its place in the
     *     undo history all survive, and copy/paste, mirroring and
     *     saving carry the reversal with the feature.
     *
     * Only the arrowheads move to the far end of each force vector.
     * Applying it twice is therefore a no-op rather than a
     * quarter turn, which is what a user pressing the control
     * twice expects.
     */
    function reverseLoadDirection(geometry) {
      if (!geometry) {
        return DEFAULT_LOAD_DIRECTION;
      }

      /*
       * Reversal is recorded as its OWN flag, not by negating the
       * direction angle.
       *
       * The direction is the LINE OF ACTION - which way the force
       * acts through the body - and it is a real engineering quantity
       * that the Features panel shows and the user types. The flag is
       * a purely visual fact: which end of the drawn line carries the
       * arrowhead. Keeping them apart is what guarantees the two
       * cannot be confused, because nothing in the reversal can reach
       * the geometry: it touches one boolean.
       *
       * Deriving the head from the angle instead would mean the drawn
       * line was `application + direction x length`, so flipping the
       * angle swings the far endpoint to the other side of the body.
       * The line would then genuinely move, which is exactly the
       * transformation a reversal must never perform.
       *
       * IT TOUCHES NOTHING ELSE. `normalSide` in particular: the side the
       * force lines are drawn on is pinned when the load's direction is
       * first set, and a reversal is not that. Reading the side back from
       * the direction here is what made the force lines jump to the other
       * side of the member while the span stayed put - the outline
       * appearing to swap ends with the arrows.
       */
      geometry.reversed = !geometry.reversed;

      return geometry.reversed;
    }

    /*
     * Whether a load is currently drawn with its arrowheads reversed.
     */
    function isLoadReversed(geometry) {
      return Boolean(geometry?.reversed);
    }

    function loadInterval(geometry) {
        return clampInterval(geometry?.interval);
    }

    function setLoadInterval(geometry, value) {
        geometry.interval = clampInterval(value);
        return geometry.interval;
    }

    /*
 * ZERO A COMPONENT THAT IS ONLY ARITHMETICALLY NON-ZERO.
 *
 * `Math.sin(180 * PI / 180)` is 1.2e-14, not 0, and a force pointing exactly
 * west is therefore stored with a sliver of north in it. The sliver is far
 * too small to see, but it is not zero, and anything that asks which WAY a
 * vector points - a screen direction's sign, a component written as "0 N" -
 * answers "up and to the left" for a force that is straight left.
 *
 * A value within a thousandth of zero IS the axis, for the drawing's
 * purposes: a force that is a thousandth of a degree off horizontal is
 * horizontal as far as a reader is concerned, and rounding it away costs
 * nothing. Rounding EVERY component to a fixed number of places, which is the
 * obvious alternative, does cost: a force at 37 degrees is stored accurately
 * and drawn accurately, and rounding its direction cost four digits - enough
 * that a student grabbing the head and letting go found the angle had
 * drifted.
 */
function zeroIfAxis(value) {
    return Math.abs(value) < 1e-3 ? 0 : value;
}

/*
 * An angle folded into a single turn, (-180, 180].
 *
 * Angles are periodic, so `37 + 360` names the same direction as `37` while
 * being a different NUMBER - and the Features panel prints the number. Reversing
 * a force adds a half turn each time, so two reversals used to leave a force
 * stored at `397` where the student began at `37`: the arrow was right and the
 * figure beside it had gained a whole turn. Folding the result keeps the stored
 * angle the one a reader would write, without changing the direction it means.
 *
 * The range is (-180, 180] rather than [-180, 180) so the half-turn case lands
 * on `180`, which is how a reversed force reads: 0 becomes 180, not -180.
 */
function normaliseAngle(degrees) {
    const value = finite(degrees);

    if (!Number.isFinite(value)) {
        return 0;
    }

    let folded = ((value + 180) % 360 + 360) % 360 - 180;

    if (folded === -180) {
        folded = 180;
    }

    return folded;
}

function unitVector(degrees) {
        const radians = finite(degrees) * Math.PI / 180;

        /*
         * THE COMPONENTS ARE CLEANED; THE ANGLE IS RETURNED AS GIVEN.
         *
         * The components are what a direction is read from - a screen
         * direction's sign, a "Fx = 0 N" label - so they go through
         * `zeroIfAxis`. The angle is what the panel shows and what a drag
         * writes back, so it is returned exactly as it came in: rounding it
         * cost four digits on a 37-degree force and bought nothing, since the
         * direction no longer comes from it.
         *
         * It is carried alongside rather than recomputed, because
         * `atan2` of the cleaned components would answer 0 for a force at 270
         * degrees - correct for the drawing, and wrong for the number the
         * student typed.
         */
        return {
            x: zeroIfAxis(Math.cos(radians)),
            y: zeroIfAxis(Math.sin(radians)),
            angle: finite(degrees),
        };
    }

    /*
     * The magnitude of the profile at a fraction t along the
     * body.
     *
     * The profile is piecewise linear between the points the
     * student placed, and held flat outside them, so the shape
     * the student described is the shape that is drawn. A load
     * with a single defining point is uniform at that value.
     */
    function magnitudeAt(geometry, t) {
        const points = profilePoints(geometry);

        if (!points.length) {
            return 0;
        }

        const ratio = Math.max(0, Math.min(1, finite(t)));

        if (points.length === 1) {
            return points[0].magnitude;
        }

        if (ratio <= points[0].t) {
            return points[0].magnitude;
        }

        const last = points[points.length - 1];

        if (ratio >= last.t) {
            return last.magnitude;
        }

        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const next = points[index];

            if (ratio > next.t) {
                continue;
            }

            const span = next.t - previous.t;

            if (Math.abs(span) < 1e-9) {
                return next.magnitude;
            }

            const mix = (ratio - previous.t) / span;

            return (
                previous.magnitude +
                (next.magnitude - previous.magnitude) * mix
            );
        }

        return last.magnitude;
    }

    /*
     * The peak magnitude of a profile, used to scale arrow
     * length so the shape reads clearly at any overall size.
     */
    /*
     * THE LARGEST INTENSITY BY SIZE. A profile may cross zero - part of the
     * span loaded one way and part the other - so the peak is measured on the
     * absolute value; the sign only decides which way an arrow points.
     */
    function peakMagnitude(geometry) {
        return profilePoints(geometry).reduce(
            (peak, point) => Math.max(peak, Math.abs(point.magnitude)),
            0
        );
    }

    /*
     * ============================================================
     * HOW FAR A LOAD'S ARROWS REACH: THE DRAWN HEIGHT
     * ============================================================
     *
     * A distributed load's arrows are as long as the student DREW them: the
     * placement gesture stores `arrowLength`, the reach of the longest arrow,
     * in drawing units, and its handle edits it. The intensities are the
     * load's VALUES - the label text - and they never set the length.
     *
     * They do set the SHAPE of a varying load: each arrow is the drawn height
     * scaled by its intensity over the peak intensity, so a load from 1 to 5
     * kN/m tapers from a fifth of the height to all of it whatever the numbers'
     * units. A uniform load is therefore a row of equal arrows.
     *
     * A load saved before `arrowLength` existed is drawn at its peak intensity
     * - exactly how it looked at the retired Vector Scale's default of 1x - so
     * an old drawing opens unchanged.
     */
    function loadArrowHeight(geometry) {
        const stored = Number(geometry?.arrowLength);

        if (Number.isFinite(stored) && stored > 1e-9) {
            return stored;
        }

        return peakMagnitude(geometry);
    }

    function loadArrowReach(geometry, magnitude) {
        const peak = peakMagnitude(geometry);
        const value = Math.abs(finite(magnitude));

        if (!(peak > 0) || !(value > 0)) {
            return 0;
        }

        return loadArrowHeight(geometry) * value / peak;
    }

    /* Store the drawn height. A non-positive height is refused, not stored. */
    function setLoadArrowHeight(geometry, height) {
        const value = Math.abs(finite(height));

        if (geometry && value > 1e-9) {
            geometry.arrowLength = value;
        }

        return geometry;
    }

    /*
     * The world position of a fraction t along the loaded
     * span.
     */
      /*
       * The body's OUTWARD normal, in world units.
       *
       * A distributed load is applied across a span, and the span's own
       * outward normal is what tells the renderer which side of the body
       * the force lines are drawn on. It is derived from the SPAN and
       * never from the force direction, which is what allows the force
       * direction to change without the drawn line moving.
       *
       * The sense is chosen ONCE, from the direction the load was BUILT
       * with, and then fixed. A downward load draws its lines below the
       * body, and reversing that load keeps them below the body, because
       * "below" is a property of the drawing and "down" is a property of
       * the force. They are separate questions and are answered
       * separately.
       *
       * ========================================================
       * WHY THE SENSE IS TAKEN FROM THE DIRECTION IT WAS BUILT
       * WITH, AND NOT THE CURRENT ONE
       * ========================================================
       *
       * This used to orient the normal against `loadDirection(geometry)`
       * - the CURRENT direction. That is the same function the reverse
       * control writes, so reversing a load re-derived this normal against
       * the reversed direction, flipped it, and moved the whole field of
       * force lines to the other side of the member.
       *
       * The comment above claimed the opposite: that "a reversal changes
       * only the arrowhead and so leaves this agreement - and therefore the
       * drawn line - alone". It did not leave it alone. `reversed` is a
       * flag, not a rotation of the stored angle, so the two disagreeed
       * and the comment described the intended behaviour while the code did
       * the opposite.
       *
       * WHICH SENSE A LOAD IS DRAWN ON IS A FACT ABOUT THE REGION, not a
       * consequence of which way it currently pushes. The region is where
       * the load acts; reversing the force does not move the region. So the
       * side is recorded when the load is created - as the sign of the
       * normal along the span, which is one bit - and read back unchanged
       * afterwards.
       *
       * A file saved before this field existed has no side recorded, so the
       * current direction is the best available answer: it produces the
       * drawing that file was making, rather than an arbitrary choice of
       * side. That is a fallback for reading old drawings, not the rule.
       */
    function loadBodyNormal(geometry) {
      const start = geometry?.start;
      const end = geometry?.end;

      if (!start || !end) {
        return null;
      }

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);

      if (length < 1e-9) {
        return null;
      }

      // A normal to the span, one of the two handednesses.
      const normal = { x: -dy / length, y: dx / length };

      /*
       * The side the load is drawn on, recorded once at creation. ±1 is the
       * sign to flip the computed normal by; anything else is not a side.
       */
      const side = Number(geometry?.normalSide);

      if (side === 1 || side === -1) {
        return side === 1
          ? normal
          : { x: -normal.x, y: -normal.y };
      }

      // An older drawing: fall back to the direction it was last using.
      const direction = unitVector(loadDirection(geometry));

      const agrees =
        normal.x * direction.x + normal.y * direction.y >= 0;

      return agrees
        ? normal
        : { x: -normal.x, y: -normal.y };
    }

    /*
     * THE SIDE A LOAD IS DRAWN ON.
     *
     * The sign that takes the span's own normal to the side the load acts
     * from. It is recorded once, when the load is created, and read back
     * unchanged for the rest of the load's life - so reversing a load
     * reverses its arrows and nothing else.
     *
     * IT IS COMPUTED FROM THE DIRECTION, NEVER ASKED FOR. There is no field
     * on a load saying which side it is on, because a side the student can
     * set is a side the student can set to the wrong value; and it is
     * derived rather than stored as an offset, because the height of a load
     * is a consequence of where it acts, not a free choice.
     *
     * Returns 1 when the span's normal already agrees with the load's
     * direction and -1 when it has to be flipped.
     */
    function loadNormalSide(geometry) {
      const side = Number(geometry?.normalSide);

      if (side === 1 || side === -1) {
        return side;
      }

      const start = geometry?.start;
      const end = geometry?.end;

      if (!start || !end) {
        return 1;
      }

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);

      if (length < 1e-9) {
        return 1;
      }

      const normal = { x: -dy / length, y: dx / length };
      const direction = unitVector(loadDirection(geometry));

      return (
        normal.x * direction.x + normal.y * direction.y >= 0
      )
        ? 1
        : -1;
    }

  function pointAlong(geometry, t) {
        const start = geometry?.start;
        const end = geometry?.end;

        if (!start || !end) {
            return null;
        }

        const ratio = Math.max(0, Math.min(1, finite(t)));

        return {
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio
        };
    }

    /*
     * The world point that corresponds to a point the student
     * clicked, expressed as a fraction along the body.
     *
     * Positions are projected onto the span rather than
     * read from x alone, so the same projection works for a
     * body at any angle. It is the reason a load on an
     * angled member still follows that member.
     */
    function fractionAlong(geometry, point) {
        const start = geometry?.start;
        const end = geometry?.end;

        if (!start || !end || !point) {
            return 0;
        }

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared < 1e-12) {
            return 0;
        }

        return Math.max(
            0,
            Math.min(
                1,
                ((point.x - start.x) * dx +
                    (point.y - start.y) * dy) /
                    lengthSquared
            )
        );
    }

    /*
     * Every arrow the renderer will draw, as
     * { t, magnitude, base, defined }.
     *
     * A defined point is AUTHORITATIVE and always gets its own
     * arrow. The interval only ever fills in BETWEEN defined
     * points.
     *
     * This ordering is the whole point of the function, and it is
     * the reverse of the obvious implementation. Sampling the span
     * at equal intervals and then reading the profile at each
     * sample is simpler to write, and it is wrong: a user who
     * places a point at 37% of the span has said something
     * specific about the load at 37%, and a sample grid of
     * 0, 0.2, 0.4... simply has no arrow there. The drawn profile
     * then smooths across the gap and the user's point becomes an
     * invisible guess about a magnitude that is not drawn
     * anywhere.
     *
     * So the defined points are laid down first, and the interval
     * subdivides the gaps between them. A defined point never
     * moves to suit the interval: it is where the user put it, and
     * the arrows either side of it are the ones that give way.
     */
    function arrowSamples(geometry) {
        const start = geometry?.start;
        const end = geometry?.end;

        if (!start || !end) {
            return [];
        }

        const span =
            Math.hypot(end.x - start.x, end.y - start.y);

        if (span < 1e-9) {
            return [];
        }

        const interval = loadInterval(geometry);

        const defined = profilePoints(geometry);

        /*
         * A load with no profile of its own is uniform, and
         * profilePoints already reports that as defined points at
         * the two ends, so the subdivisions below fill the whole
         * span at the interval. The plain Distributed Load
         * therefore renders exactly as it always did.
         */
        if (!defined.length) {
            return [];
        }

        const sample = t => ({
            t: Math.max(0, Math.min(1, t)),
            magnitude: magnitudeAt(geometry, t),
            base: pointAlong(geometry, t),
            defined: false
        });

        const definedSample = point => ({
            t: point.t,
            magnitude: point.magnitude,
            base: pointAlong(geometry, point.t),
            defined: true
        });

        /*
         * Where a defined point sits, rounded. Two positions that
         * agree to this many places are the same place on the
         * body, and an automatic arrow must not be drawn on top
         * of a user's own.
         */
        const key = t => Math.round(t * 1e6) / 1e6;

        /*
         * Defined points are kept as they are, duplicates and
         * all, because each one is a magnitude the user asked for
         * and therefore owes them an arrow. Two points moved onto
         * the same place describe two magnitudes at one location,
         * which is a real (if unusual) state; drawing both is
         * faithful to it, whereas folding them into one would
         * silently drop a magnitude the user can still see listed
         * in the Features panel.
         */
        const samples = defined.map(definedSample);

        /*
         * Only the automatic arrows are de-duplicated, and only
         * against the defined points. This is the set of places
         * already occupied, so a subdivision landing on one of
         * them yields to the user's arrow instead of replacing it.
         */
        const occupied = new Set(defined.map(point => key(point.t)));

        const place = t => {
            const id = key(t);

            if (occupied.has(id)) {
                return;
            }

            occupied.add(id);

            samples.push(sample(t));
        };

        /*
         * Subdivide each gap between adjacent defined points.
         *
         * Each gap is divided on its own rather than as part of one
         * grid across the whole span, which is what lets the arrows
         * either side of an off-grid defined point be spaced for
         * that gap instead of being pulled onto a global grid that
         * does not include the point.
         */
        for (let index = 1; index < defined.length; index += 1) {
            const from = defined[index - 1].t;
            const to = defined[index].t;

            const gap = to - from;

            if (gap <= 1e-9) {
                continue;
            }

            const gapLength = gap * span;

            const steps = Math.max(
                1,
                Math.min(
                    MAX_LOAD_ARROWS,
                    Math.round(gapLength / interval)
                )
            );

            for (let step = 1; step < steps; step += 1) {
                place(from + (gap * step) / steps);
            }
        }

        /*
         * Ordered along the body, so the renderer draws them in
         * the direction of the load and the profile outline is
         * built from a monotonic list.
         *
         * A stable sort is used so that defined points sharing a
         * position keep their order, which leaves the sequence
         * deterministic rather than dependent on the engine.
         */
        return samples.sort(
            (first, second) => first.t - second.t
        );
    }

    /*
     * The point on the body a defining point belongs at.
     * Editing a point's position writes its world position
     * back and re-derives the fraction, so dragging a point
     * and typing its position do the same thing.
     */
    function profilePointPositions(geometry) {
        return profilePoints(geometry).map(point => ({
            ...point,
            position: pointAlong(geometry, point.t)
        }));
    }

    /*
     * One defining point, looked up by its own identity.
     *
     * This is how an annotation finds the point it belongs to after
     * the array has been reordered, shortened or re-embedded on a
     * moved body: the index is not asked for and not trusted, because
     * it is exactly the thing that changes underneath a label.
     */
    function profilePointById(geometry, pointId) {
        if (!pointId) {
            return null;
        }

        return (
            profilePointPositions(geometry).find(
                point => point.id === pointId
            ) || null
        );
    }

    /*
     * THE LENGTH A FORCE IS DRAWN AT.
     *
     * The arrow is the one the student drew: from `start` to the stored `end`.
     * Its length is a fact about the DRAWING, never derived from the magnitude.
     * A force with no usable `end` - one saved before arrows kept their drawn
     * length - is drawn at its magnitude, which is exactly how it looked then
     * at the default scale, so an old file opens unchanged.
     */
    function drawnLengthOf(geometry) {
        const start = geometry?.start || geometry?.position;
        const end = geometry?.end;

        if (
            start && end &&
            Number.isFinite(Number(start.x)) && Number.isFinite(Number(start.y)) &&
            Number.isFinite(Number(end.x)) && Number.isFinite(Number(end.y))
        ) {
            const length = Math.hypot(
                Number(end.x) - Number(start.x),
                Number(end.y) - Number(start.y)
            );

            if (length > 1e-9) {
                return length;
            }
        }

        return Math.abs(finite(geometry?.magnitude));
    }

    /*
     * Write a force's VALUE and DIRECTION, keeping the arrow it was drawn as.
     *
     * The magnitude is annotation content: typing 20 N or 5 kN changes the
     * label, never how long the arrow is. The direction is geometry, so the
     * drawn arrow is turned to it about the application point at the length it
     * already has. `length` is passed only by a gesture that draws the arrow -
     * the creation drag, a drag of the arrowhead.
     *
     * Every representation is still written here, together, so the panel, a
     * drag and a reversal can never leave them disagreeing.
     */
    function setForceVector(geometry, magnitude, directionDegrees, { length } = {}) {
        const magnitudeValue = Math.max(0, finite(magnitude));
        const direction = finite(directionDegrees);
        const vector = unitVector(direction);

        const drawn =
            Number.isFinite(length) && length > 1e-9
                ? length
                : drawnLengthOf(geometry);

        const start = geometry.start ||
            geometry.position || { x: 0, y: 0 };

        geometry.start = {
            x: finite(start.x),
            y: finite(start.y)
        };

        geometry.position = {
            x: geometry.start.x,
            y: geometry.start.y
        };

        geometry.magnitude = magnitudeValue;
        geometry.angle = direction;

        geometry.end = {
            x: geometry.start.x + zeroIfAxis(vector.x) * drawn,
            y: geometry.start.y + zeroIfAxis(vector.y) * drawn
        };

        /*
         * THE COMPONENTS ARE REWRITTEN TOO, OR THEY BECOME A SECOND TRUTH.
         *
         * A force may be described either as a magnitude and an angle or as
         * its X and Y components, and `forceVector` gives the COMPONENTS the
         * precedence - deliberately, because a student who has just typed Fx
         * and Fy means those whatever the angle field still says.
         *
         * That precedence is what made a reversal come out wrong. This
         * function rewrote `angle` and `end` and left `forceX`/`forceY`
         * pointing the old way, so the object was left holding two
         * contradictory descriptions of one force: the angle said the
         * opposite of the components, and which one a reader believed
         * decided whether the arrow appeared to turn around at all.
         *
         * Pressing "reverse direction" on a force whose components had ever
         * been typed therefore flipped the geometry and not the force - the
         * arrow head moved to the other end of an unchanged vector, which is
         * exactly the "it flips how it is drawn" report.
         *
         * So every representation is written from the one vector here, which
         * is the whole reason this function exists. A component edit goes
         * through `setForceVector` too (see the Features panel), so the two
         * views stay interchangeable in both directions.
         */
        geometry.forceX = vector.x * magnitudeValue;
        geometry.forceY = vector.y * magnitudeValue;

        return geometry;
    }

    /*
     * The same force as components.
     *
     * Fx and Fy are the world projections, and they are what
     * the drawing already stores as the two points of the
     * arrow, so no third representation is invented.
     */
    function forceVector(geometry) {
        const start =
            geometry?.start ||
            geometry?.position ||
            { x: 0, y: 0 };

        /*
         * The stored tip when there is one, and otherwise the vector
         * rebuilt from the stored magnitude AND angle.
         *
         * The angle used to be ignored here, so a force with no stored
         * tip was read as pointing along +x whatever its angle said. The
         * two representations therefore disagreed: a force carrying
         * `angle: 90` reported a direction of 0.
         *
         * Both are written together by setForceVector, so this only
         * arises on hand-authored or older geometry - but it matters
         * because reverseForceDirection reads the direction through this
         * function. A force with no tip would have been turned through a
         * half turn from the wrong starting angle.
         */
        const magnitude = finite(geometry?.magnitude);

        const vector =
            unitVector(finite(geometry?.angle));

        /*
         * THE DIRECTION IS THE STORED ANGLE, NOT THE SPAN.
         *
         * The SPAN - `start` to `end` - is where the force is DRAWN. The direction is
         * which way it PUSHES. They are separate questions, and they have to be read
         * separately: reversing a force turns the second without moving the first, so
         * a force between x=100 and x=150 pushes left rather than right.
         *
         * Deriving the direction from the span - as this did - made the two the same
         * fact, and then a reversal could only move the drawing to express itself,
         * which is how pressing "reverse direction" threw the arrow across to the
         * other side of the application point.
         *
         * The magnitude is still read from the span, because that is the length the
         * arrow is drawn at, and the drawn length is what a student sees and grabs.
         * It is not the magnitude: a force drawn at the shared display scale is a
         * different length from the force it describes.
         */
        const fx = vector.x * magnitude;
        const fy = vector.y * magnitude;

        return {
            x: finite(start.x),
            y: finite(start.y),
            fx,
            fy,
            magnitude,
            angle: finite(geometry?.angle)
        };
    }

    /*
     * The same force, pointing the other way.
     *
     * This is what turns a push into a pull. The arrow stops pointing
     * away from where the force acts and points towards it instead, and
     * the two are the same load read the other way round.
     *
     * THE APPLICATION POINT DOES NOT MOVE. It is where the force acts,
     * and that is the one thing a change of sense must not touch: a
     * force reversed in place is the same force acting at the same
     * place, only drawn the other way round. Sliding the application
     * point would make it a different load at a different location
     * rather than the same load seen from the other side.
     *
     * The vector is therefore mirrored through the application point,
     * which puts the tip at the same distance on the opposite side.
     * Nothing is re-drawn elsewhere, no length is changed, and the
     * segment is simply read in the opposite direction.
     *
     * THE MAGNITUDE is carried through unchanged and stays positive. It
     * is a physical magnitude, not a signed quantity - the sense of the
     * force lives in the direction, which is why this is a rotation by
     * 180 degrees rather than a negation.
     *
     * Written through setForceVector so the application point, the
     * stored magnitude, the stored angle and the drawn tip are all
     * rewritten together by the one function that already owns that
     * relationship, and no field can be left disagreeing with another.
     */
    function reverseForceDirection(geometry) {
        if (!geometry) {
            return geometry;
        }

        const vector = forceVector(geometry);

        /*
         * THE SPAN STAYS AND THE SENSE OF IT CHANGES.
         *
         * The application point and the tip are where the student put them
         * and they are not the thing being reversed. Rotating the stored angle
         * AND rewriting `end` from it - which this did, because it called
         * `setForceVector` - moved the tip across the application point to
         * the opposite side: a force drawn between x=100 and x=150 became one
         * drawn between x=50 and x=100. The same length, and a different
         * piece of the drawing.
         *
         * The length was even right, which is why it was hard to see. What
         * moved was WHERE the arrow lay, and for a force attached to a member
         * that is the whole difference between pressing on the beam from
         * outside and pressing on the empty space beside it.
         *
         * A Distributed Load already works this way - reversing it keeps the
         * span and moves only the arrowheads - and the two tools should not
         * disagree about what reversing means.
         *
         * So the ENGINEERING VECTOR is reversed and the stored span is left
         * exactly where it was. The renderer draws the arrow along the span in
         * the direction the vector now points, which is the only part that
         * needs to know which way the force acts.
         *
         * THE MAGNITUDE is carried through unchanged and stays positive. It
         * is a physical magnitude, not a signed quantity - the sense of the
         * force lives in the direction, which is why this is a rotation by
         * 180 degrees rather than a negation.
         */
        /*
         * THE REVERSED VECTOR, THROUGH THE SHARED COMPONENT CLEANING.
         *
         * `unitVector` zeroes the arithmetic sliver that `Math.sin(180 deg)`
         * leaves behind, so a force pointing exactly west is stored with
         * `forceY` of exactly 0 rather than 1.22e-14. Writing the raw sine here
         * - as this did - put that sliver into the stored components, and
         * anything asking which WAY the force points then answered "up and to
         * the left" for a force that is straight left: the panel printed a
         * non-zero Y component for a horizontal force, and the reversal did not
         * look clean in the data even though the arrow was drawn correctly.
         */
        const reversed = unitVector(vector.angle + 180);

        /*
         * THE ANGLE IS NORMALISED TO (-180, 180].
         *
         * A half turn is periodic, so `angle + 180 + 180` describes the same
         * direction as `angle` - but it is stored as `angle + 360`, and the
         * Features panel prints the stored number. Two reversals therefore
         * showed the student "397 deg" where they started at "37 deg": the
         * drawing was right and the number beside it had drifted a whole turn
         * for no reason they could see.
         *
         * Folding the result back into one turn fixes that without changing the
         * direction the components express, so the arrow, the components and
         * the panel all keep agreeing.
         */
        /*
         * THE DRAWN ARROW TURNS WITH IT, at the length it was drawn. The
         * stored `end` is the arrowhead the Source writes and the canvas draws,
         * so leaving it in place reversed the force in the model while Source
         * went on drawing it the old way round.
         */
        const drawnLength = drawnLengthOf(geometry);

        geometry.angle = normaliseAngle(vector.angle + 180);
        geometry.forceX = reversed.x * vector.magnitude;
        geometry.forceY = reversed.y * vector.magnitude;

        if (geometry.start && drawnLength > 1e-9) {
            geometry.end = {
                x: finite(geometry.start.x) + zeroIfAxis(reversed.x) * drawnLength,
                y: finite(geometry.start.y) + zeroIfAxis(reversed.y) * drawnLength
            };
        }

        /*
         * `position` MIRRORS `start` and is read by some of the panel and by
         * the components' origin, so it follows the same value. Neither is
         * moved - only brought back into step with the point it mirrors.
         */
        if (geometry.start) {
            geometry.position = {
                x: geometry.start.x,
                y: geometry.start.y
            };
        }

        return geometry;
    }

    /*
     * ============================================================
     * THE LINE A FORCE IS DRAWN ALONG.
     * ============================================================
     *
     * The arrow the student drew: from the application point `start` to the
     * stored `end`, with the head at `end`. Every consumer that needs where a
     * force is drawn - the line and its head, the handle, the hit test, the
     * selection bounds, the label anchor, the Source writer - reads it here or
     * from the same stored points, so none of them can disagree.
     *
     * NOTHING IS SCALED. The drawn length is the gesture's, and the magnitude is
     * annotation content. (A shared Vector Scale used to stretch every arrow by
     * magnitude x scale; it is retired, and with it the gap between where an
     * arrow was stored and where it was drawn.)
     *
     * A force with no usable `end` is drawn from `start` along its direction at
     * `drawnLengthOf` - its magnitude - which is how an old file looked.
     */
    function drawnForceAxis(state, geometry) {
        const start = {
            x: finite(geometry?.start?.x, finite(geometry?.position?.x)),
            y: finite(geometry?.start?.y, finite(geometry?.position?.y)),
        };

        const end = geometry?.end;

        if (
            end &&
            Number.isFinite(Number(end.x)) &&
            Number.isFinite(Number(end.y)) &&
            Math.hypot(Number(end.x) - start.x, Number(end.y) - start.y) > 1e-9
        ) {
            return { tail: start, head: { x: Number(end.x), y: Number(end.y) } };
        }

        const vector = forceVector(geometry);
        const length = drawnLengthOf(geometry);

        if (!(length > 1e-9)) {
            return { tail: start, head: start };
        }

        const radians = (vector.angle * Math.PI) / 180;

        return {
            tail: start,
            head: {
                x: start.x + zeroIfAxis(Math.cos(radians)) * length,
                y: start.y + zeroIfAxis(Math.sin(radians)) * length,
            },
        };
    }

    /*
     * ============================================================
     * A DRAG OF THE ARROWHEAD.
     * ============================================================
     *
     * The head is dragged to `point`: the arrow is redrawn to it, so its
     * direction AND its drawn length follow the gesture. The magnitude - the
     * number in the label - is unchanged, because a drag is a drawing action,
     * not a change to the force's stated value.
     *
     * `length` is returned for `setForceVector`, which writes the arrow at it.
     * The length is measured from the application point, the fixed end of the
     * vector, so grabbing the head and releasing it where it is changes nothing.
     */
    function forceVectorFromDrawnPoint(state, geometry, point) {
        const vector = forceVector(geometry);

        const start = {
            x: finite(geometry?.start?.x, finite(geometry?.position?.x)),
            y: finite(geometry?.start?.y, finite(geometry?.position?.y)),
        };

        const length = Math.hypot(point.x - start.x, point.y - start.y);

        if (length <= 1e-9) {
            return {
                magnitude: vector.magnitude,
                angle: vector.angle,
                length: drawnLengthOf(geometry),
            };
        }

        return {
            magnitude: vector.magnitude,
            angle: Math.atan2(point.y - start.y, point.x - start.x) * 180 / Math.PI,
            length,
        };
    }

    /*
     * ============================================================
     * THE OTHER END OF THE SAME LINE. WHERE THE SHAFT COMES FROM.
     * ============================================================
     *
     * `drawnForceEnd` answers where the ARROWHEAD is; this answers where the
     * tail of the shaft is, which is the other end of the same span. Together
     * they draw the line the student put there, with the head on one end or
     * the other - the way a Distributed Load's arrowheads move when it is
     * reversed while its outline stays put.
     *
     * Asking for the two separately is what stops a reversal from appearing to
     * move the arrow: the shaft is the whole span either way, so only the head
     * changes side. With the tail pinned to the application point the shaft
     * would instead reach from the application point to whichever end carries
     * the head, and a reversal would visibly relocate the drawing.
     */
    function drawnForceTail(state, geometry) {
        return drawnForceAxis(state, geometry).tail;
    }

    /*
     * ============================================================
     * WHERE THE ARROWHEAD IS.
     * ============================================================
     *
     * One of the two ends of the drawn line; `drawnForceTail` is the other.
     * Both are read out of the one `drawnForceAxis` result rather than each
     * deciding independently, because a pair that disagreed about which end was
     * which is precisely the fault this was rewritten to remove - and a shaft
     * whose tail was on the wrong side of its own head is a line drawn
     * backwards.
     */
    function drawnForceEnd(state, geometry) {
        return drawnForceAxis(state, geometry).head;
    }

    /*
     * ============================================================
     * THE WHOLE DRAWN FORCE, FROM ONE CALCULATION.
     * ============================================================
     *
     * The single authoritative answer to "where is this force drawn, and which
     * way does it push". Every consumer that needs the force's current drawn
     * geometry asks for it HERE - the line and its arrowhead, the handle, the
     * hit test, the selection bounds, and the magnitude annotation's anchor -
     * so none of them can hold a stale copy of an endpoint from another scale,
     * direction or application point.
     *
     * The two ends come from `drawnForceAxis`, which already decides which end
     * carries the head; it is asked once and both readings are taken from the
     * one result, so the pair cannot disagree about which end is which.
     *
     *   start      the application point - where the force acts
     *   end        the drawn arrowhead
     *   tail       the other end of the drawn line
     *   direction  the direction the force pushes, in degrees
     *   length     the drawn length, `magnitude x scale`
     */
    function forceGeometry(state, geometry) {
        const axis = drawnForceAxis(state, geometry);

        const vector = forceVector(geometry);

        return {
            start: axis.tail,
            end: axis.head,
            tail: axis.tail,
            head: axis.head,
            direction: finite(vector.angle),
            length: Math.hypot(
                axis.head.x - axis.tail.x,
                axis.head.y - axis.tail.y
            ),
        };
    }

    /*
     * THE UNIT A STATION IS MEASURED IN
     * ========================================================
     *
     * A station on a beam can be read as millimetres or as metres, and the
     * two are the same number in different clothes. Which one to show is
     * the student's decision - a 500 mm beam is written either way, and
     * nobody should be told - but the panel has to commit to one and say
     * which, because a bare number beside a beam is a number whose scale
     * the student has to guess from the drawing.
     *
     * IT FOLLOWS THE SHEET, which is drawn in millimetres.
     *
     * That is the one answer that is never wrong: a millimetre is a
     * millimetre whatever the member is. The alternative - inferring
     * metres from the size of a body - would print "5 m" beside a
     * 5000-unit member and be right only by coincidence, which is the same
     * class of bug as the four coordinates this replaced.
     */
    function loadStationUnit() {
        return "mm";
    }

    /*
   * ========================================================
   * IS A POINT ON A LOAD?
   * ========================================================
   *
   * A Distributed Load is one feature and it is drawn as a FIELD: a row of
   * arrows standing off the body, closed by an envelope. Almost all of that
   * ink is nowhere near the two points the model stores, so the ordinary
   * "near the start or near the end" test misses it - and a load whose
   * arrows cannot be clicked is a load the Select tool cannot reach.
   *
   * THREE PLACES ARE HIT, because three things are drawn:
   *
   *   1. THE ARROWS. Each is a shaft from a base on the body out to its tip,
   *      so a click anywhere on a shaft is a click on that arrow.
   *   2. THE ENVELOPE. The polygon joining the tips and closing along the
   *      body - the outline the load is read by. Clicking inside it means
   *      aiming at the load.
   *   3. THE BODY LINE ITSELF, between the two ends.
   *
   * (2) is the one that was missing, and it is the one a student aims at:
   * the outline is the biggest and most obvious part of a uniform load, and
   * clicking the middle of it selected whatever was behind.
   *
   * EACH ARROW'S REACH IS THE ONE THE RENDERER AND THE SOURCE USE
   * (`loadArrowReach`), in the same world units as `point` and the body, so
   * what is clickable is exactly what is drawn, at any zoom. (It used to be
   * the peak intensity times pixels-per-unit times the Vector Scale - a
   * screen length laid along a world-space body, so the clickable field grew
   * with zoom.)
   */
  function loadContainsPoint(
    geometry,
    point,
    tolerance
  ) {
    const start = geometry?.start;
    const end = geometry?.end;

    if (
      !start ||
      !end ||
      !Number.isFinite(start.x) ||
      !Number.isFinite(end.x) ||
      !point ||
      !Number.isFinite(point.x)
    ) {
      return false;
    }

    const samples = arrowSamples(geometry);

    if (!samples.length) {
      return false;
    }

    const peak = peakMagnitude(geometry);

    if (peak <= 0) {
      return false;
    }

    /*
     * The same normal the renderer places the arrows along, and so the same
     * side of the body they are drawn on. Falling back to the force
     * direction is what the renderer does for a degenerate span, and a hit
     * test has to agree with it even there.
     */
    const away =
      loadBodyNormal(geometry) ||
      unitVector(loadDirection(geometry));

    const reachOf = (sample) => loadArrowReach(geometry, sample.magnitude);

    /* 1. The arrows. */
    for (const sample of samples) {
      const tip = {
        x: sample.base.x + away.x * reachOf(sample),
        y: sample.base.y + away.y * reachOf(sample)
      };

      if (
        distanceToSegment(point, sample.base, tip) <=
          tolerance
      ) {
        return true;
      }
    }

    /*
     * THE ENVELOPE, BUILT ONCE.
     *
     * Out along the tips, then back along the body.
     *
     * THE TWO HALVES MUST BE THE TWO ENDS OF THE SAME ARROWS, in reverse
     * order - the tip of the last arrow joins the base of the last arrow.
     * Building the closing half from a second, separately reversed list
     * produces a bow-tie rather than a region, and a bow-tie fills in the
     * wrong places: which is how a hit test ends up accepting points in the
     * corners of the drawing and rejecting the middle of the load.
     */
    const tips = samples.map(sample => ({
      x: sample.base.x + away.x * reachOf(sample),
      y: sample.base.y + away.y * reachOf(sample)
    }));

    const bases = samples
      .slice()
      .reverse()
      .map(sample => ({
        x: sample.base.x,
        y: sample.base.y
      }));

    const envelope = [...tips, ...bases];

    /* 2. Inside the envelope. */
    if (pointInPolygon(point, envelope)) {
      return true;
    }

    /*
     * 2b. ON THE OUTLINE ITSELF.
     *
     * The envelope is drawn as a stroked polygon, so it has a visible edge -
     * and a student aiming at the boundary of a load aims at that edge, not
     * at the interior. A point just outside the region but within the
     * tolerance of it is therefore on the load.
     *
     * This is not a fudge factor. Without it the hit region has a hard edge
     * exactly where the ink is, so clicking a fraction of a pixel off the
     * outline selects the beam behind it: the tolerance would apply to
     * everything else on screen and to nothing here.
     *
     * It also covers the gap between two arrows. The arrows stand at the
     * sample interval, so the envelope between them is visible but no
     * individual shaft reaches it, and a click there belongs to the load.
     */
    if (
      envelope.some(
        (vertex, index) =>
          distanceToSegment(
            point,
            vertex,
            envelope[(index + 1) % envelope.length]
          ) <= tolerance
      )
    ) {
      return true;
    }

    /*
     * 3. The body line itself, which is the edge of that region and is
     * drawn whether or not there are any arrows.
     */
    return (
      distanceToSegment(point, start, end) <=
      tolerance
    );
  }

  function distanceToSegment(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const lengthSquared = dx * dx + dy * dy;

    if (!(lengthSquared > 1e-12)) {
      return Math.hypot(
        point.x - from.x,
        point.y - from.y
      );
    }

    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - from.x) * dx +
          (point.y - from.y) * dy) /
          lengthSquared
      )
    );

    return Math.hypot(
      point.x - (from.x + t * dx),
      point.y - (from.y + t * dy)
    );
  }

  /*
   * Standard crossing test. Boundary behaviour is left to the tolerance
   * tests above and below - a point exactly on the edge is close enough to
   * the outline either way, so the tie-break here would not change what the
   * student gets.
   */
  function pointInPolygon(point, polygon) {
    let inside = false;

    for (
      let i = 0, j = polygon.length - 1;
      i < polygon.length;
      j = i++
    ) {
      const a = polygon[i];
      const b = polygon[j];

      const straddles =
        a.y > point.y !== b.y > point.y;

      if (
        straddles &&
        point.x <
          ((b.x - a.x) * (point.y - a.y)) /
            (b.y - a.y) +
            a.x
      ) {
        inside = !inside;
      }
    }

    return inside;
  }

  /*
   * ========================================================
   * A VARYING LOAD'S PROFILE, AS THE DRAWS IT
   * ========================================================
   *
   * A varying load stores an intensity at each end; the renderer draws it by
   * sampling a profile built from them. That conversion was written out
   * again at every place that needed the profile - the fit bounds, and the
   * hit test - and each copy was a chance for the two to disagree about how
   * long a 0-to-20 taper is.
   *
   * So it is built here, once, and read by everything. A caller that wants
   * the drawn shape of either kind of load asks for it here rather than
   * knowing how either is stored.
   *
   * A UNIFORM LOAD IS ITSELF A PROFILE - two equal points - so both kinds
   * come back in the same shape and a caller does not branch on the type.
   */
  function drawnProfile(geometry) {
    if (!geometry) {
      return null;
    }

    if (geometry.points) {
      return geometry;
    }

    if (
      geometry.startIntensity === undefined &&
      geometry.endIntensity === undefined
    ) {
      return null;
    }

    return {
      start: geometry.start,
      end: geometry.end,
      direction: geometry.direction,
      interval: geometry.interval,
      points: [
        {
          t: 0,
          magnitude: Math.max(
            0,
            Math.abs(Number(geometry.startIntensity) || 0)
          )
        },
        {
          t: 1,
          magnitude: Math.max(
            0,
            Math.abs(Number(geometry.endIntensity) || 0)
          )
        }
      ]
    };
  }

  const enggLoadProfile = {
      DEFAULT_LOAD_DIRECTION,
      DEFAULT_LOAD_INTERVAL,
      DEFAULT_LOAD_UNIT,
      DEFAULT_FORCE_UNIT,
      DEFAULT_MOMENT_UNIT,
      FORCE_UNITS,
      LOAD_UNITS,
      MOMENT_UNITS,
        arrowSamples,
        clampInterval,
        drawnForceEnd,
        drawnForceTail,
        drawnForceAxis,
        drawnProfile,
        forceGeometry,
        forceVector,
        forceVectorFromDrawnPoint,
        fractionAlong,
        isLoadReversed,
        loadBodyNormal,
        loadDirection,
        loadInterval,
        loadUnit,
        forceUnit,
        setForceUnit,
        isForceUnit,
        isMomentUnit,
        momentUnit,
        setMomentUnit,
        loadContainsPoint,
        loadNormalSide,
        loadStationUnit,
        magnitudeAt,
        mintPointId,
        peakMagnitude,
        pointAlong,
        profilePointById,
        profilePointPositions,
        profilePoints,
        readLoadValue,
        reverseForceDirection,
        reverseLoadDirection,
        setForceVector,
        setLoadDirection,
        setLoadInterval,
        setLoadUnit,
        setProfilePoints,
        unitVector,
        loadArrowHeight,
        loadArrowReach,
        setLoadArrowHeight
    };

export default enggLoadProfile;
