/*
 * A feature's panel markup.
 */

import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import enggQuantities from "../../../shared/units/quantities.js";
import enggAnalysisDependencies from "../../../features/workspace/model/analysis/analysis-dependencies.js";
import enggLoadProfile from "../../../features/workspace/model/analysis/load-profile.js";
import enggPropertyPanel from "./property-panel.js";
import enggAnnotate from "../../../features/workspace/model/annotations/annotate-model.js";
import enggDimensionModel from "../../../features/workspace/model/dimensions/dimension-model.js";
import { isSaturationCurve } from "../../../features/workspace/model/thermodynamics/saturation-curve.js";
import { isPistonCylinder, pistonFraction, stopperFraction } from "../../../features/workspace/model/thermodynamics/piston-cylinder.js";
import { appearanceMarkup } from "./appearance-panel.js";
import { COORDINATE_SYSTEM_TYPE } from "../../../features/workspace/constants.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { mmOf, staticsRoleLabel } from "../../../features/workspace/interaction/handles.js";
import { absolutePositionRows, relativeCoordinateRows } from "./relative-coordinates.js";
import { analysisPanelRows, arcRadiusRow, distributedLoadPanelMarkup, momentDirectionOf, reverseDirectionMarkup, supportPanelRows } from "../../../features/workspace/statics/statics-panel.js";
import { STATICS_FEATURE_LABELS, staticsConnectionSection } from "../../../features/workspace/statics/statics-tools.js";
import { trianglePropertyMarkup } from "./triangle-panel.js";
import { trussOptimizeMarkup } from "../../../features/workspace/statics/truss-optimizer.js";
import { CONNECTION_TYPES, isConnectionType, isSupportType } from "../../../shared/model/feature-types.js";

/*
 * Shared header for every Features panel: the feature's own name as the
 * panel title, and an editable Feature Name beneath it.
 *
 * It used to render a read-only "Feature Type" field as well. That was an
 * inspector field, not an engineering one: it showed the student a value the
 * model had already told them - the name at the top of this very panel - in a
 * different vocabulary, and for a feature with no friendly label the fallback
 * was the internal type string itself. A student reading "analysis-diagram"
 * learns nothing about the analysis diagram they made, and it is precisely
 * the kind of internal term that has no business being displayed.
 *
 * So the type now appears once, as the title, in the words the student uses.
 * The editable name stays, because what a student calls a feature is theirs to
 * choose and is not the same question as what kind of thing it is.
 *
 * The raw-type fallback is kept, but only in the title - it is how a feature
 * with no registered label is still named at all, rather than being nameless.
 */
export function featureHeaderMarkup(
    object,
    typeLabel
) {
    const panels =
        enggPropertyPanel;

    const name =
        panels && panels.header
            ? panels.header(typeLabel)
            : `<div class="drawing-properties-title">${
                escapeHtmlText(typeLabel)
            }</div>`;

    const nameField =
        panels && panels.nameField
            ? panels.nameField({
                attribute: "feature-name",
                value: object.name,
            })
            : "";

    /*
     * THE LOCK IS NOT HERE.
     *
     * It lives with the POSITION properties (see `lockRow`), because it controls
     * whether the feature can be REPOSITIONED - it is not an identification
     * property like the name and the label, and putting it between them made it
     * read as one.
     */
    return name + nameField;
}

/*
 * Escaping for the rare fallback path above. The shared module owns this
 * normally; this exists only so the header still renders if that module is
 * absent, rather than emitting an unescaped name into the panel.
 */
function escapeHtmlText(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        character =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character],
    );
}

/*
 * A SECTION HEADING, WHICH STANDS OR FALLS WITH ITS FIELDS.
 *
 * The panel is assembled by pushing a heading and then its fields into one
 * list, so a heading cannot know at the moment it is written whether the
 * fields below it will turn out to exist. It is therefore emitted as a
 * MARKER, and `finaliseRows` removes any marker whose following rows are
 * all empty - which is how an APPEARANCE heading over nothing, and the gap
 * left where it was, both disappear.
 *
 * The marker is an HTML comment so a panel that somehow skipped
 * finalisation still renders correctly, with the heading text hidden.
 */
export const section = label =>
    `<!--section:${label}-->`;

/*
 * Drop every heading that is not followed by at least one real field, and
 * drop every empty fragment. This is the single pass that enforces "no
 * empty sections" and "no leftover whitespace from removed fields".
 *
 * A heading is kept only when a non-heading, non-empty row follows it
 * before the next heading. Trailing headings are removed too, because a
 * heading at the end of the panel has nothing under it by definition.
 */
export const finaliseRows = list => {
    const kept = [];

    /*
     * NESTED ROWS ARE FLATTENED FIRST.
     *
     * A helper that builds a whole group of fields - the support panel,
     * a relative-coordinate block - returns its rows as an ARRAY, and the
     * caller pushes that array into the panel's row list as one entry. A
     * pass that only understood strings skipped every such entry, so a
     * support rendered as its title and nothing else: every field it
     * carried was silently discarded here.
     *
     * Flattening means a helper may return one row or many without the
     * caller having to know which, which is the contract the builders
     * already assume.
     */
    const flat = list.flat(Infinity);

    for (let index = 0; index < flat.length; index += 1) {
        const entry = flat[index];

        if (typeof entry !== "string" || entry.trim() === "") {
            continue;
        }

        const marker = /^<!--section:(.*?)-->$/.exec(entry);

        if (!marker) {
            kept.push(entry);
            continue;
        }

        /*
         * Keep the heading only if a real field follows it before the next
         * heading.
         */
        let hasField = false;

        for (let ahead = index + 1; ahead < flat.length; ahead += 1) {
            const next = flat[ahead];

            if (typeof next !== "string" || next.trim() === "") {
                continue;
            }

            if (/^<!--section:(.*?)-->$/.test(next)) {
                break;
            }

            hasField = true;
            break;
        }

        if (hasField) {
            kept.push(
                `<div class="drawing-properties-section">${escapeHtmlText(marker[1])}</div>`,
            );
        }
    }

    return kept.join("");
};

/*
 * The Features panel for a Rigid Body, in whichever shape it
 * currently has.
 *
 * A body stores a centre, a size and an angle regardless of its
 * outline, so the size and rotation controls mean the same thing
 * for every shape. What changes is the shape selector and, for a
 * triangle, the three points that define it.
 */
function rigidBodyShapeMarkup(
    object,
    helpers
) {
    const {
        coordinate,
        scalar,
        section
    } = helpers;

    const geometry = object.geometry || {};

    const shape =
        enggFeatureGeometry.rigidBodyShape(
            geometry
        );

    const centre =
        enggFeatureGeometry.rigidBodyCenter(
            geometry
        ) || { x: 0, y: 0 };

    const rows = [];

    rows.push(section("SHAPE"));

    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Shape</span>
            <select data-rigid-shape aria-label="Shape">
                ${["rectangle", "circle", "triangle", "polygon"]
                    .map(
                        value => `
                            <option
                                value="${value}"
                                ${shape === value ? "selected" : ""}
                            >${value[0].toUpperCase() + value.slice(1)}</option>
                        `
                    )
                    .join("")}
            </select>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `);

    rows.push(section("POSITION"));
    rows.push(coordinate("Centre X", "rigidCentre.x", centre.x, "mm", true));
    rows.push(coordinate("Centre Y", "rigidCentre.y", centre.y, "mm", true));

    if (shape === "circle") {
        rows.push(section("SIZE"));
        rows.push(
            scalar(
                "Radius",
                "rigidRadius",
                mmOf(
                    Number(geometry.radius) ||
                        Math.max(
                            Number(geometry.width) || 0,
                            Number(geometry.height) || 0
                        ) / 2
                ).value,
                mmOf(
                    Number(geometry.radius) ||
                        Math.max(
                            Number(geometry.width) || 0,
                            Number(geometry.height) || 0
                        ) / 2
                ).unit,
                true,
                true
            )
        );
    } else if (shape === "triangle") {
        rows.push(section("VERTICES"));

        (geometry.points || [])
            .filter(Boolean)
            .forEach(
                (point, index) => {
                    rows.push(
                        coordinate(
                            `Point ${index + 1} X`,
                            `points.${index}.x`,
                            point.x,
                            "mm",
                            true
                        )
                    );
                    rows.push(
                        coordinate(
                            `Point ${index + 1} Y`,
                            `points.${index}.y`,
                            point.y,
                            "mm",
                            true
                        )
                    );
                }
            );
    } else if (shape === "polygon") {
        rows.push(section("SIZE"));
        rows.push(
            scalar(
                "Number of Sides",
                "rigidSides",
                Number(geometry.sides) || 4,
                ""
            )
        );
        rows.push(
            scalar(
                "Radius",
                "rigidRadius",
                mmOf(Number(geometry.radius) || 0).value,
                mmOf(Number(geometry.radius) || 0).unit,
                true,
                true
            )
        );
    } else {
        rows.push(section("SIZE"));
        rows.push(
            scalar(
                "Width",
                "rigidWidth",
                mmOf(Number(geometry.width) || 0).value,
                mmOf(Number(geometry.width) || 0).unit,
                true,
                true
            )
        );
        rows.push(
            scalar(
                "Height",
                "rigidHeight",
                mmOf(Number(geometry.height) || 0).value,
                mmOf(Number(geometry.height) || 0).unit,
                true,
                true
            )
        );
    }

    rows.push(section("ROTATION"));
    rows.push(
        scalar(
            "Rotation",
            "rigidRotation",
            Number(geometry.rotation) || 0,
            "Â°"
        )
    );

    return rows.join("");
}

export function featurePropertyMarkup(object) {
    const geometry = object.geometry;
    const constraints = object.constraints || {};
    const rows = [];

    /*
     * ========================================================
     * THE SHARED PANEL VOCABULARY
     * ========================================================
     *
     * Every field below is built through the one property-panel module rather
     * than by hand. That module is where the two rules this panel used to break
     * are enforced:
     *
     *   - NO PUNCTUATION WITHOUT A VALUE. A field with a missing value is not
     *     emitted at all, so a panel cannot show "Direction: ," or leave a
     *     dangling separator where an optional property was absent.
     *   - NO EMPTY SECTIONS. A heading is produced together with the fields
     *     that justify it, or not at all.
     *
     * It also joins a number and its unit in one place (so no field can read
     * "100 NN"), escapes every string that reaches the markup, and drops
     * trailing zeros consistently, so two panels never disagree about how a
     * value is written.
     *
     * `panels` may be absent in a bare test harness, in which case the helpers
     * below return nothing rather than throwing - an absent module leaves a
     * field out, which is the same as an absent value.
     */
    const panels =
        enggPropertyPanel;

    /*
     * A number as panel text. Delegated, because the shared formatter drops
     * trailing zeros and normalises negative zero - and because a missing
     * value must render as an absent field, not as the string "NaN".
     */
    const number = value =>
        panels && panels.number
            ? panels.number(value)
            : Number.isFinite(Number(value))
              ? String(Number(Number(value).toFixed(2)))
              : "";

    const fixed = key => Boolean(constraints[key]);

    /*
     * Shared constraint control. Every editable numeric
     * property gets one, placed after the unit so the
     * order is always Label -> Input -> Unit -> Fix.
     */
    const fixBox = (key, label) => `
        <label class="drawing-property-fix" title="${fixed(key) ? `Unconstrain ${label}` : `Constrain ${label}`}">
            <input type="checkbox" data-fix="${key}"
                aria-label="${fixed(key) ? `Unconstrain ${label}` : `Constrain ${label}`}"
                ${fixed(key) ? "checked" : ""}>
        </label>
    `;

    /*
     * Unknown control for statics values.
     *
     * A quantity marked Unknown is one the student has yet
     * to determine, so it is not the Fix control: Fix pins
     * a value against editing, while `?` says there is no
     * authoritative value at all. It is a property of the
     * value, not a separate tool, so any statics feature
     * can carry it through the same state as its Fix flag.
     */
    const known = key =>
        object.unknownValues?.[key] !== true;

    /*
     * A FREE-TEXT PROPERTY ROW.
     *
     * A label is not a number and not a choice, so it gets a text field in the
     * same row shape as every other property - which is what keeps it aligned
     * with the numeric rows above it instead of introducing a second layout.
     *
     * An EMPTY string is passed through unchanged: for an axis label that is a
     * deliberate state ("no label here"), not a missing value.
     *
     * BUILT FROM THE SHARED ROW, not by hand. It used to write its own
     * `drawing-property-grid` markup - four divs and spans assembled here -
     * which is exactly the fifteenth near-copy the shared vocabulary exists to
     * replace: it escaped with its own hand-rolled `&`/`"`/`<` replacement
     * instead of the shared `escape`, and its row would not follow a change to
     * the shared grid's shape.
     *
     * The FIELD is unchanged - same `data-property` hook, same value, same
     * empty-when-absent rule - so nothing that reads this row can tell the
     * difference except that it is now consistent with every other one.
     */
    const textField = (label, key, value) => {
        if (!panels || !panels.row) {
            return "";
        }

        return (
            panels.row({
                label,
                control: `<input type="text"
                    data-property="${panels.text(key) ?? ""}"
                    class="drawing-property-input"
                    aria-label="${panels.text(label) ?? ""}"
                    value="${panels.text(value) ?? ""}">`,
            }) || ""
        );
    };

    /*
     * THE FEATURE'S FIXED TOGGLE, AS A COMPACT BOOLEAN PROPERTY.
     *
     * `Fixed` says whether the feature's geometry is held against ordinary
     * movement, resizing and reshaping - the brief's name for what the model
     * has always stored as `locked`, and the label the panel shows. The
     * ENFORCEMENT lives in the two places it always has: `drag.js` refuses to
     * begin a manipulation drag, and `property-update.js` refuses a typed
     * coordinate. Nothing about the mechanism changes here - a fixed feature
     * is still selectable, still inspectable, and its appearance is still
     * editable, which is exactly what "fixed" is supposed to protect and no
     * more.
     *
     * It is rendered as a label with a small checkbox beside it, not as a wide
     * value field with a checkbox stranded in the middle of it. The control is
     * ALWAYS rendered and only its `checked` state changes, so it can be
     * toggled back off without Undo.
     */
    const lockRow = () => `
        <div class="drawing-property-grid drawing-property-grid-value drawing-property-grid-lock">
            <span class="drawing-property-grid-label">Fixed</span>
            <span class="drawing-property-lock">
                <label class="drawing-property-fix" title="${object.locked ? "Unfix this feature so it can be moved" : "Fix this feature so it cannot be moved, resized or reshaped"}">
                    <input type="checkbox" data-feature-lock
                        aria-label="${object.locked ? "Unfix this feature" : "Fix this feature"}"
                        ${object.locked ? "checked" : ""}>
                </label>
            </span>
            <span></span>
            <span></span>
        </div>
    `;

    /*
     * A compact `?` toggle, placed after the unit. It reads
     * as a state rather than a word so the property row
     * stays compact and the whole feature is not disabled
     * when a single quantity is Unknown.
     */
    const knownBox = (key, label) => `
        <button type="button"
            class="drawing-property-known${known(key) ? "" : " unknown"}"
            data-known="${key}"
            aria-pressed="${!known(key)}"
            aria-label="Mark ${label} as unknown"
            title="Unknown: ${label} is not specified">
            ?
        </button>
    `;

    /*
     * Known / Unknown applies to a stated engineering quantity - the
     * magnitudes a student writes onto a force, a load or a moment.
     * Those are the values whose being-unknown is a real engineering
     * state rather than a missing number: a reaction the student has
     * still to solve for, a load not yet determined.
     *
     * IT IS TESTED BY WHAT THE QUANTITY IS, NOT BY ITS DISCIPLINE. The
     * old test was `discipline === "statics"`, which refused the `?` to
     * a force while offering it to a support - and a force's magnitude
     * is exactly the quantity a student marks unknown first, because it
     * is the one they are still working out.
     */
    const MAGNITUDE_BEARING = new Set([
        "force",
        "load",
        "varying-load",
        "moment",
        "resultant"
    ]);

    const showKnown =
        MAGNITUDE_BEARING.has(object.type) ||
        object.engineering?.discipline === "statics";

    /*
     * Compact horizontal row: label, one numeric
     * input, optional unit, optional constraint box.
     */
    /*
     * An Unknown quantity has no authoritative number, so
     * its field is emptied and disabled rather than left
     * showing a stale value the user could mistake for the
     * real one. Only that one field is affected.
     */
    const scalar = (
        label,
        key,
        value,
        unit = "",
        editable = true,
        isLength = false
    ) => {
        const isUnknown =
            showKnown &&
            !known(key);

        if (!panels || !panels.scalar) {
            return "";
        }

        /*
         * A LENGTH IS CONVERTED; A QUANTITY IS NOT.
         *
         * The geometry holds world units, which are meaningless until the
         * sheet's scale gives them a size, so a length field must be given
         * a physical number - not the raw world value.
         *
         * IT IS READ IN THE FEATURE'S OWN SELECTED UNIT, exactly as the
         * coordinate fields are: `object.lengthUnit` is the one reading
         * preference, and every length row on the panel - a coordinate, a
         * radius, a width, a span - shows its number in it and offers the
         * same selector to change it. A panel whose coordinates read in
         * metres while its radius still read in millimetres was two units
         * for one feature, and the student had no way to tell which number
         * was in which.
         *
         * THE VALUE ARRIVES ALREADY IN MILLIMETRES - every caller resolves
         * the world length through `mmOf` first - so the display conversion
         * is mm -> chosen unit, the same chain the coordinate helper runs.
         *
         * THE SELECTOR IS THE ONLY STATEMENT OF THE UNIT. The static label
         * is suppressed when a selector is rendered, so the row can never
         * show "5 m [m v]" - the duplication the specification calls out.
         */
        const chosenUnit = isLength
            ? (enggQuantities.isUnitFor("length", object.lengthUnit)
                ? object.lengthUnit
                : "mm")
            : unit;

        const shown = isLength
            ? enggQuantities.convertValue(
                  mmOf(value).value,
                  "length",
                  "mm",
                  chosenUnit
              )
            : value;

        const lengthUnitControl =
            isLength && panels.unitSelect
                ? panels.unitSelect({
                      property: "lengthUnit",
                      units: enggQuantities.unitsFor("length"),
                      current: chosenUnit,
                      label: `${label} unit`,
                      disabled: fixed(key),
                  })
                : null;

        /*
         * An unknown value has no number to state, so the value slot is left
         * empty deliberately - which is a real, meaningful state, not the
         * "absent value" the shared module refuses. It is passed through as
         * an empty string so the field still renders, disabled.
         */
        let field = panels.scalar({
            label,
            key,
            value: isUnknown ? "" : shown,
            unit: lengthUnitControl ? "" : unit,
            unitControl: lengthUnitControl,
            disabled: !editable || isUnknown || fixed(key),
            /*
             * TWO CONTROLS, TWO SLOTS - AND NEITHER WITHOUT THE OTHER.
             *
             * The `?` Unknown toggle belongs to the VALUE: it says something
             * about the number itself, so it is handed to the unit cell and
             * renders immediately beside the value, on the same line -
             * `[ Value ] [ ? ]`. The constraint tick belongs to the ROW: it
             * says "do not let me edit this", so it stays in the trailing
             * state track - `[âœ“]`.
             *
             * The old code put both into the state track. Two controls in a
             * 14px column pushed each other sideways or wrapped the `?` onto
             * a second line, and the reading order could come out as
             * `[ Value ] [âœ“] [ ? ]` - the Unknown marker stranded at the far
             * end of the row, no longer attached to the value it describes.
             *
             * AN UNKNOWN VALUE SHOWS ONLY THE QUESTION MARK: the tick would
             * pin a number that deliberately does not exist.
             */
            unitExtra:
                showKnown
                    ? knownBox(key, label)
                    : "",
            state:
                !isUnknown && editable
                    ? fixBox(key, label)
                    : "",
            classes: isUnknown
                ? "drawing-property-unknown"
                : "",
        });

        return field;
    };

    /*
     * A MAGNITUDE WITH A CHANGEABLE UNIT.
     *
     *   [ 0.25 ] [ kN \u25be ]
     *
     * The same field as `scalar`, except that the unit cell is a SELECT rather
     * than text - which is what makes the unit editable directly from the
     * feature's own panel. Every feature whose magnitude carries a unit uses
     * this ONE control, so it cannot drift between them.
     *
     * THE STORED NUMBER IS CONVERTED FOR DISPLAY, NOT JUST RELABELLED.
     *
     * A feature stores its magnitude in the quantity's BASE unit - N for a
     * force, N\u00b7m for a moment - and this converts that into whichever unit
     * the student has chosen to read it in. So a 250 N force read in kN shows
     * 0.25, and the push has not changed.
     *
     * IT USED TO RELABEL. The stored number was printed unchanged beside
     * whatever unit was picked, so switching a 250 N force to kN showed
     * "250 kN" - a thousand times the load. That is the defect this converts.
     *
     * `quantityType` is what makes the conversion correct rather than guessed:
     * it names the family - force, moment, distributedLoad - and the shared unit
     * table refuses a conversion between families. A caller that does not name a
     * family gets the number unchanged, because there is nothing honest to
     * convert it with.
     */
    const quantityWithUnit = (
        label,
        key,
        value,
        unitProperty,
        units,
        currentUnit,
        editable = true,
        quantityType = null
    ) => {
        const isUnknown = showKnown && !known(key);

        /*
         * BASE -> DISPLAY. The stored value is in the base unit; the student
         * reads it in `currentUnit`. `convertValue` returns the value unchanged
         * when either unit is unknown, so a feature with no quantity type shows
         * its number as before rather than through a guessed factor.
         */
        const baseUnit =
            enggQuantities?.QUANTITY_UNITS?.[quantityType]?.base;

        const shown =
            baseUnit && currentUnit
                ? enggQuantities.convertValue(
                      value,
                      quantityType,
                      baseUnit,
                      currentUnit
                  )
                : value;

        const options = units
            .map(
                unit =>
                    `<option value="${unit}"${
                        unit === currentUnit ? " selected" : ""
                    }>${unit}</option>`
            )
            .join("");

        /*
         * THE UNIT HALF COMES FROM THE SHARED CONTROL.
         *
         * `unitSelect` is the ONE unit selector every panel uses, so it is
         * built there rather than assembled again here - which is what keeps
         * its width, its type size and its dropdown behaviour identical on a
         * force, a moment and a load.
         */
        const unitControl = panels && panels.unitSelect
            ? panels.unitSelect({
                  property: unitProperty,
                  units,
                  current: currentUnit,
                  label: `${label} unit`,
                  disabled: isUnknown,
              })
            : `<select class="drawing-property-unit-select" data-property="${unitProperty}" aria-label="${label} unit">${options}</select>`;

        return `
            <div class="drawing-property-grid drawing-property-grid-value${
                isUnknown ? " drawing-property-unknown" : ""
            }">
                <span class="drawing-property-grid-label">${label}</span>
                ${
                    isUnknown
                        ? `<span class="drawing-property-readonly"></span>`
                        : `<input type="number" step="any"
                            data-property="${key}"
                            aria-label="${label}"
                            ${
                                !editable || fixed(key)
                                    ? "disabled"
                                    : ""
                            }
                            value="${number(shown)}">`
                }
                <span class="drawing-property-unit">
                    ${unitControl}${
                        showKnown ? knownBox(key, label) : ""
                    }</span>
                <span class="drawing-property-state">${
                    !isUnknown && editable ? fixBox(key, label) : ""
                }</span>
            </div>
        `;
    };

    /*
     * ONE COORDINATE FIELD.
     *
     * `label` is the whole label the student reads - "Start X", or "X" under a
     * "Start" heading - and `key` is the property it edits. One call, one field.
     *
     * It used to route through the shared pair-helper, which builds an X row and
     * a Y row from a single label - so `coordinate("Start X", ...)` came out as
     * "Start X X" and "Start X Y", the label doubled because a two-row builder
     * was handed a one-row label. That is where the four nested coordinate
     * combinations on a Beam came from, and none of them was ever a real
     * engineering concept.
     *
     * The pair form is still available where a pair is genuinely wanted.
     */
    const coordinate = (
        label,
        key,
        value,
        unit = "mm",
        isLength = false
    ) => {
        if (!panels || !panels.scalar) {
            return "";
        }

        /*
         * A COORDINATE IS A PHYSICAL LENGTH TOO.
         *
         * A position is stored in WORLD units, so a field captioned "mm"
         * has to be given millimetres - exactly as a Length does. Without
         * this, every X and Y in the application printed the raw world
         * number under a "mm" tag, so on any calibrated sheet the value
         * was wrong by the scale factor while still looking plausible.
         *
         * `isLength` marks the fields that are a physical distance. It
         * defaults to false so an angular coordinate - an angle in degrees
         * - is never converted, because a degree is not a length and
         * passing it through the scale would be a different angle.
         */
        const converts = isLength && unit === "mm";

        const mm = converts ? mmOf(value) : { value, unit };

        /*
         * ====================================================
         * A COORDINATE CAN BE READ AND ENTERED IN ANY LENGTH UNIT
         * ====================================================
         *
         * `mmOf` converts the stored WORLD value into millimetres, which is the
         * sheet's own unit. That used to be the end of it: every X and Y was
         * captioned "mm" with no way to read it in cm, m or inches - so a student
         * working in inches had to convert by hand for every field.
         *
         * The unit below is therefore a DISPLAY unit, sitting on top of the
         * millimetres rather than replacing them:
         *
         *     world -> mmOf -> mm -> convertValue(length, mm, chosen)
         *
         * and entering a value runs the same chain backwards in the setter. The
         * GEOMETRY NEVER MOVES: changing the unit changes which number the same
         * physical position is written as, which is what `convertValue` exists
         * for. A position of 25.4 mm reads "25.4" in mm and "1" in inches, and
         * the drawing is in the same place either way.
         *
         * THE CHOSEN UNIT IS PER FEATURE, stored on the geometry beside the
         * values it displays - the same shape a dimension's `displayUnit` already
         * uses. It is a READING preference, so it travels in the document with
         * the drawing rather than being a global setting that would move when the
         * student opened a second sheet.
         */
        const displayUnits = enggQuantities
            ? enggQuantities.unitsFor("length")
            : [];

        const chosenUnit = converts
            ? (object.lengthUnit || mm.unit)
            : unit;

        const shown = converts
            ? enggQuantities.convertValue(
                  mm.value,
                  "length",
                  "mm",
                  chosenUnit
              )
            : mm.value;

        /*
         * A UNIT ROW IS ONLY OFFERED FOR A PHYSICAL LENGTH. An angle is not a
         * length, so an angle row keeps the plain"Â°" it has always had.
         */
        const lengthUnitControl =
            converts && panels && panels.unitSelect
                ? panels.unitSelect({
                      property: "lengthUnit",
                      units: displayUnits,
                      current: chosenUnit,
                      label: `${label} unit`,
                      disabled: fixed(key),
                  })
                : null;

        const field = panels.scalar({
            label,
            key,
            value: shown,

            /*
             * ================================================
             * THE UNIT IS SHOWN ONCE - BY THE SELECTOR ITSELF
             * ================================================
             *
             * When a unit SELECTOR is rendered, the unit's own text must NOT
             * also be printed beside it. The row renders
             *
             *     <static unit><unitExtra>
             *
             * and `unitExtra` already carries the selector, so passing
             * `chosenUnit` here as well produced the duplication the
             * specification calls out:
             *
             *     [ 5 ]  m  [ m â–¼ ]      <- the reported arrangement
             *
             * The selector IS the statement of the unit - it shows the
             * current choice and is the only control that changes it - so it
             * is the one authority. The static label is passed only when no
             * selector is offered, which is the case that still needs to say
             * what the number is denominated in.
             */
            unit: lengthUnitControl ? "" : converts ? chosenUnit : unit,
            unitControl: lengthUnitControl,
            disabled: fixed(key),

            /*
             * THE CONSTRAIN CONTROL IS ALWAYS RENDERED.
             *
             * It used to be omitted when the property was already fixed, so
             * CLICKING it made it vanish - the one thing a persistent control
             * must never do, because the only way back was Undo. A control's
             * VISIBILITY and its STATE are separate: the checkbox is always
             * here, and `checked` is what changes.
             */
            state: fixBox(key, label),
        });

        return field;
    };

    /*
     * ========================================================
     * A COORDINATE PAIR: ONE HEADING, THEN X AND Y
     * ========================================================
     *
     * A position is an engineering idea with its own name - "Start", "End",
     * "Centre", "Position" - and beneath it two ordinates. That is the form the
     * student reads:
     *
     *     Start
     *     Start X   [ 150 ] mm
     *     Start Y   [ 300 ] mm
     *
     * IT BUILDS ITS FIELD BY CALLING `coordinate` TWICE, not by concatenating
     * numbers. Each call emits ONE field for ONE property, so X edits
     * `start.x` and Y edits `start.y` and neither is a string that merely looks
     * like a coordinate. That is the defect this shape exists to prevent: an
     * earlier pair helper glued two ordinates into a single uneditable value and
     * attached the unit to the second number, so the panel showed
     *
     *     Start
     *     150, 300 mm
     *
     * where the unit appeared to belong to the ordinate and a missing value left
     * a dangling comma behind.
     *
     * THE ORDINATE LABELS ARE GLUED FROM THE PAIR'S OWN NAME - `${label} X` - so
     * a pair called "Centre" cannot produce rows called "Start X". Each ordinate
     * carries the whole label the student reads rather than relying on the
     * heading above, which is what keeps a single field meaningful if the pair is
     * ever split across a layout.
     *
     * `xKey` and `yKey` are separate arguments rather than one key plus a suffix,
     * because a feature does not always store its ordinates adjacent: a Point
     * keeps `position.x`/`position.y`, a Triangle keeps `points.0.x`.
     */

    /*
     * A NUMBER THAT IS TRUE BUT NOT WRITTEN.
     *
     * Joint count, member count, how many supports a beam carries - these
     * are the numbers a student checks a structure against, but none of
     * them is something you type. They are also the numbers that go
     * STALE the moment the structure changes: a beam that gains a
     * support has a different count, and a truss rebuilt at a different
     * panel count has a different number of members.
     *
     * So they are read live off the current feature on every repaint,
     * rather than being stored, and they are shown in the same rows as
     * the fields you can edit - the reader is comparing numbers, and a
     * figure in a different style would read as a different kind of
     * thing. Nothing about them is editable because editing a count is
     * not a thing anyone can mean.
     *
     * A derived ANGLE or LENGTH still carries its unit, though - "0.00" with
     * nothing after it is ambiguous between degrees and millimetres on a
     * panel that also states a Length in mm. So the unit is a third
     * argument, and omitting it is the same mistake as omitting the unit
     * from an editable field.
     */
    const derived = (label, value, unit = "") => {
        if (!panels || !panels.readOnlyQuantity) {
            return "";
        }

        /*
         * A missing derived value is not a field. The shared helper refuses it,
         * so a derived quantity that cannot be computed yet disappears rather
         * than printing an empty row with a unit beside it.
         */
        return panels.readOnlyQuantity(label, value, unit);
    };

    /*
     * THE SQUARED FORM OF A LENGTH UNIT.
     *
     * An Area is a squared length, so its unit is the length unit squared - "mm"
     * becomes "mmÂ²". The shared quantity table already spells its area units that
     * way, so the two agree by construction rather than by a second list being
     * kept in step by hand.
     *
     * A unit that is already a power, or that carries a suffix the table does not
     * use, is squared as it stands: the caption is then merely odd rather than
     * wrong, and a measurement is never silently captioned with the wrong power.
     */
    const squaredUnitOf = (unit = "") => {
        const text = String(unit || "");

        if (text === "") {
            return "";
        }

        /*
         * A unit is written as a symbol and a power - "mm", "mÂ²". Only the SYMBOL
         * is squared, so "mm" becomes "mmÂ²" rather than "mmÂ²Â²".
         */
        const match = /^([^\u00b2\u00b3\^]+)/.exec(text);

        return `${match ? match[1] : text}Â²`;
    };

    /*
     * A COUNT, WHICH IS NOT A MEASUREMENT.
     *
     * Joint Count, Member Count, Segment Count, how many supports a beam
     * carries - these are integers. They went through `derived`, which
     * formats every number to two decimal places, so the panel said
     *
     *     Segment Count
     *     1.00
     *
     * Two decimal places on a count says the number is a measurement taken
     * from something continuous and might not be exact. It is exact: there
     * are four joints or there are not. The decimals also make the column of
     * counts ragged against the lengths above them, so a reader scanning the
     * panel is comparing 1.00 with 400.00 and being invited to.
     *
     * So counts get their own row rather than a format flag, because the
     * distinction is not "how many decimals" - it is that one of these is a
     * counted thing and the other is a measured one.
     */
    const derivedCount = (label, value) => {
        if (!panels || !panels.readOnly) {
            return "";
        }

        if (!Number.isFinite(Number(value))) {
            return "";
        }

        /*
         * A whole number, not a measurement to two decimals: a count is exact,
         * and a column of "4.00" beside lengths reads as though the count were
         * a measurement taken from something continuous.
         */
        return panels.readOnly(label, Math.round(Number(value)));
    };

    /*
     * The free-text name a student gives a feature.
     *
     * A feature's name is how it is referred to in a beam schedule, a
     * member list and a written solution, so it is editable here rather
     * than being fixed at creation. The row is deliberately last in the
     * hierarchy: it is naming, not engineering, and putting it at the
     * top would give it a prominence the other rows do not have.
     */
    /*
     * THE LABEL FIELD.
     *
     * IT SHOWS `object.label`, NOT `object.name`. The field used to display the
     * feature's NAME while being labelled "Label" - so it looked like it was
     * editing a label and was really editing the schedule name, and the drawing
     * showed nothing either way. The two are different pieces of information and
     * now have different fields, side by side: the header's Name, and this.
     *
     * `data-object-label` is the hook the text handler binds to. It is
     * deliberately NOT `data-property`, because that handler is for NUMERIC
     * fields - it runs every value through `Number()` and refuses anything that
     * is not finite, which would silently discard every label a student typed.
     */
    const labelRow = object => {
        if (!panels || !panels.row) {
            return "";
        }

        const label = panels.text(object.label);

        return panels.row({
            label: "Label",
            control: `<input type="text"
                data-object-label
                class="drawing-property-input"
                aria-label="Label"
                placeholder="Text shown beside the feature"
                value="${escapeHtmlText(label === null ? "" : label)}">`,
        });
    };

    /*
     * THE SYMBOL A MAGNITUDE IS WRITTEN UNDER.
     *
     * A force's magnitude reads "F = 100 N", a load's "w = 5 kN/m", a
     * moment's "M = 25 NÂ·m" - and the letter in front is the student's to
     * choose, because on a real sheet a force is as often R_A or W as it
     * is F. This is the field that letter is typed into.
     *
     * IT IS NOT THE FEATURE'S NAME. The name is what the feature is called
     * in a schedule ("Point Force 3"); this is what is printed on the
     * drawing, and the two are genuinely different pieces of information.
     *
     * AN EMPTY FIELD IS A REAL CHOICE - "write the number with no symbol
     * in front of it" - and is kept distinct from "never touched", which
     * falls back to the conventional letter. That distinction is why the
     * input shows the raw stored value and the canvas applies the default
     * only when the field is absent.
     *
     * THE SYMBOL A MAGNITUDE IS WRITTEN UNDER.
     *
     * A force's magnitude reads "F = 100 N", a load's "w = 5 kN/m", a
     * moment's "M = 25 NÂ·m" - and the letter in front is the student's to
     * choose, because on a real sheet a force is as often R_A or W as it
     * is F. This is the field that letter is typed into.
     */
    const magnitudeLabelRow = props => {
        if (!panels || !panels.row) {
            return "";
        }

        const object = props.object;

        const stored = object.magnitudeLabel;

        const value =
            typeof stored === "string"
                ? stored
                : props.defaultLabel || "";

        /*
         * STANDALONE MEANS NO HEADING. The label is a property of the
         * feature, so it is one row, emitted where the caller asks for it -
         * not a section of its own.
         */
        if (props.standalone) {
            return panels.row({
                label: "Label",
                control: `<input type="text"
                    data-magnitude-label
                    class="drawing-property-input"
                    aria-label="Label"
                    placeholder="${escapeHtmlText(props.defaultLabel || "")}"
                    value="${escapeHtmlText(value)}">`,
            });
        }

        return panels.section("ANNOTATION", [
            panels.row({
                label: "Label",
                control: `<input type="text"
                    data-magnitude-label
                    class="drawing-property-input"
                    aria-label="Label"
                    placeholder="${escapeHtmlText(props.defaultLabel || "")}"
                    value="${escapeHtmlText(value)}">`,
            }),
        ]);
    };

    /*
     * The children of a body, grouped by the role they play on it.
     *
     * Counts rather than lists, because a beam with nine supports has
     * nothing useful to say about each of them here: where each one
     * sits and what type it is are already answered by selecting that
     * support. What the beam itself needs to report is whether anything
     * is attached to it at all, and a count says that in one glance
     * without a list that would overflow the panel.
     */
    const attachedCount = (parentId, types) =>
        drawingState.objects.filter(
            object =>
                object.parentId === parentId &&
                (
                    !types ||
                    types.includes(object.type)
                )
        ).length;

     /*
     * Relative position fields, shown INSTEAD of the absolute
     * coordinates for a feature drawn under a parent.
     *
     * These are genuine local coordinates, not relabelled
     * absolute ones: the number stored is the offset from the
     * parent, and writing it moves the child by that offset from
     * where the parent currently is. A child therefore keeps the
     * same relationship to its parent when the parent is dragged,
     * which is what makes the number mean anything after the
     * fact.
     *
     * Defined at module scope as relativeCoordinateRows, because
     * the load panels are separate functions that need it too.
     *
     * The controls it needs are built here rather than passed in.
     * This function takes only the object, so `helpers` is not in
     * scope: referring to it threw a ReferenceError as soon as any
     * feature called this, which is why the Moments, supports,
     * forces, particles and loads never reached their
     * editing page while a Beam - which does not use them - worked
     * fine. The two controls the relative rows need are already
     * defined above, so they are handed over explicitly.
     */
    const relativeRows = (label) =>
        relativeCoordinateRows(
            object,
            label,
            { coordinate, section }
        );

    /*
     * THE STUDENT-FACING NAME, NEVER THE INTERNAL TYPE.
     *
     * Everything above maps a feature type to the words a student would use
     * for it. The final `|| object.type` is the one place an internal string
     * can still reach the panel, and it was how "analysis-diagram" and
     * "force-components" ended up displayed as panel titles.
     *
     * A feature with no registered label is better named for what it is than
     * not named at all, so the fallback stays - but it is a last resort that
     * should not be reached by any feature DAETUM ships.
     */
    const displayLabel =
        (isSaturationCurve(object) ? "Saturation Curve" : "") ||
        (isPistonCylinder(object) ? "Piston Cylinder" : "") ||
        staticsRoleLabel(object) ||
        STATICS_FEATURE_LABELS[object.type] ||
        {
            line: "Line",
            point: "Point",
            polyline: "Polyline",
            triangle: "Triangle",
            polygon: "Polygon",
            circle: "Circle",
            arc: "Arc",
            rectangle: "Rectangle",
            "reference-axis-x-positive": "Reference Axis +X",
            "reference-axis-x-negative": "Reference Axis -X",
            "reference-axis-y-positive": "Reference Axis +Y",
            "reference-axis-y-negative": "Reference Axis -Y",
            [COORDINATE_SYSTEM_TYPE]: "2D Coordinate System",
            /*
             * THE ANALYSIS DIAGRAMS. These have no entry in
             * STATICS_FEATURE_LABELS, so they were falling through to the
             * raw type - which is how a student's SFD was titled
             * "shear-force-diagram" in a panel describing their beam.
             */
            "analysis-diagram": "Analysis Diagram",
            "force-components": "Force Components",
            resultant: "Resultant",
            dimension: "Dimension",

            /*
             * THE ANNOTATE FEATURES, NAMED BY THEIR KIND.
             *
             * They are one TYPE - `annotate` - with an `annotateKind` saying
             * which of the eight they are, so the type alone titled every one
             * of them "annotate" in the panel. A Note, a Leader and a Table
             * are different things to a student, and the panel's first line is
             * where that is said.
             *
             * The kind's own label comes from the annotation model, which is
             * the one place that names these, so this cannot drift from the
             * tool the student picked.
             */
            annotate:
                enggAnnotate?.ANNOTATE_KINDS?.[object.annotateKind]?.label ||
                "Annotation",
        }[object.type];

    const typeLabel = displayLabel || object.type;

    rows.push(featureHeaderMarkup(object, typeLabel));

    /*
     * LABEL SITS BESIDE FEATURE NAME.
     *
     * The two together are the feature's identity - what it is called in a
     * schedule, and the symbol it is written under on the sheet - so they
     * belong together at the top. Pushing it here rather than at the foot of
     * each type's block is what keeps that placement consistent for every
     * feature without repeating the call.
     */
    rows.push(labelRow(object));

    if (object.type === "line") {
        const dx = geometry.end.x - geometry.start.x;
        const dy = geometry.end.y - geometry.start.y;
        rows.push(section("START POINT"));
        rows.push(coordinate("X", "start.x", geometry.start.x, "mm", true));
        rows.push(coordinate("Y", "start.y", geometry.start.y, "mm", true));
        rows.push(section("END POINT"));
        rows.push(coordinate("X", "end.x", geometry.end.x, "mm", true));
        rows.push(coordinate("Y", "end.y", geometry.end.y, "mm", true));

        /*
         * A LINE CAN BE LOCKED, LIKE A POINT AND A BEAM.
         *
         * The MECHANISM was already shared and already covered Lines: `locked`
         * is a property of the feature, and `drag.js` refuses to begin ANY
         * manipulation drag on a locked object, checking in the one place every
         * drag passes through. The panel row is the only thing that was missing -
         * so a Line could be locked in the model and there was no control to do
         * it, which is why the panel appeared to lack the feature entirely.
         *
         * IT IS `lockRow()`, NOT A NEW CONTROL. The same row the Point panel
         * uses means the wording, the tooltip, the checkbox and the enforcement
         * are one behaviour rather than two that can drift - and there is no
         * second control called "Fix" duplicating it.
         *
         * IT SITS WITH THE POSITION CONTROLS, because that is what it constrains.
         */
        rows.push(lockRow());

        rows.push(section("MEASUREMENTS"));
        rows.push(
            scalar(
                "Length",
                "length",
                mmOf(Math.hypot(dx, dy)).value,
                mmOf(Math.hypot(dx, dy)).unit,
                true,
                true
            )
        );
        rows.push(scalar("Angle", "angle", Math.atan2(dy, dx) * 180 / Math.PI, "Â°"));
    } else if (object.type === "point") {
        const position =
            geometry.position || geometry.point || geometry;

        rows.push(section("POSITION"));
        rows.push(coordinate("X", "position.x", position.x, "mm", true));
        rows.push(coordinate("Y", "position.y", position.y, "mm", true));
        rows.push(lockRow());
        rows.push(section("APPEARANCE"));
        rows.push(pointSizeMarkup(object));

        return finaliseRows(rows);
    } else if (object.type === "circle") {
        rows.push(section("CENTER"));
        rows.push(coordinate("X", "center.x", geometry.center.x, "mm", true));
        rows.push(coordinate("Y", "center.y", geometry.center.y, "mm", true));
    } else if (object.type === "arc") {
        rows.push(section("CENTER"));
        rows.push(coordinate("X", "center.x", geometry.center.x, "mm", true));
        rows.push(coordinate("Y", "center.y", geometry.center.y, "mm", true));
        rows.push(section("GEOMETRY"));
        rows.push(scalar("Radius", "radius",
            mmOf(geometry.radius).value, mmOf(geometry.radius).unit));
        rows.push(scalar("Start Angle", "startAngle", geometry.startAngle * 180 / Math.PI, "Â°"));
        rows.push(scalar("End Angle", "endAngle", geometry.endAngle * 180 / Math.PI, "Â°"));
        rows.push(scalar("Included", "includedAngle",
            ((geometry.sweep ?? (geometry.endAngle - geometry.startAngle)) * 180 / Math.PI),
            "Â°", false));
    } else if (object.type === "particle") {
        /*
         * A Particle is defined by its position and its mass, and by
         * nothing else.
         *
         * It is the one body with NO LENGTH, so it must not be offered
         * the line controls: a line type and a line width describe a
         * stroke, and a particle is a filled marker - there is no stroke
         * to style. Those controls used to be suppressed for exactly
         * this reason, which left the particle with no appearance
         * control at all; it now gets the one that applies to it, the
         * size of the marker itself.
         */
        rows.push(relativeRows("POSITION"));
        rows.push(
            absolutePositionRows(object, {
                coordinate,
                section
            })
        );

        rows.push(section("MASS"));
        rows.push(scalar("Mass", "mass",
            Number(geometry.mass) || 0, "kg"));

        rows.push(section("APPEARANCE"));
        rows.push(pointSizeMarkup(object));

        /*
         * APPEARANCE was added above for the marker size, so the
         * shared line controls must not be added again at the foot.
         */
        return `<div class="drawing-properties-block">
            ${finaliseRows(rows)}
        </div>`;
    } else if (object.type === "rigid-body") {
        /*
         * A rigid body is one body whose outline can be any of
         * the supported shapes. Only the properties that
         * actually control the current shape are shown, so the
         * panel always offers everything needed to manipulate
         * the body and nothing that does not apply to it.
         *
         * The Shape control rewrites this same body. It never
         * replaces the feature, so the name, the id and any
         * attached loads all survive the change.
         */
        rows.push(
            rigidBodyShapeMarkup(
                object,
                { coordinate, scalar, section }
            )
        );
    } else if (
        enggAnalysisDependencies.isAnalysisObject(
            object
        )
    ) {
        rows.push(
            ...analysisPanelRows(object)
        );
    } else if (
        object.type === "beam" ||
        object.type === "truss" ||
        object.type === "cable" ||
        object.type === "shaft"
    ) {
        /*
         * Slender members are defined by their two ends, and every
         * one of them is described in the same order: the GEOMETRY that
         * says how big it is, the POSITION that says where its ends
         * are, the ORIENTATION that follows from those ends, whatever
         * else is particular to its type, then the shared APPEARANCE
         * and ANNOTATION.
         *
         * That order is chosen so the fields a reader compares sit
         * next to each other. Length is computed from the two ends
         * below it, so putting it first would invite reading it as an
         * independent number; and Angle is the last of the three
         * because it is derived from the ends as well - it is there to
         * be READ as the member's attitude, and the ends are what you
         * change to alter it.
         */
        /*
         * A LENGTH IN THE PANEL IS AN ENGINEERING LENGTH.
         *
         * The geometry stores world units, which are not a physical
         * size - they only become one through the document scale. So
         * a panel that showed the raw number and captioned it "mm"
         * would print 100.42 mm for a beam the student had sized at
         * 500 mm, and the number would be both wrong and
         * authoritative-looking.
         *
         * `length` is therefore the measured distance in world units,
         * and `mmLength` is that distance in MILLIMETRES - which is
         * what the unit beside the field promises. Both are kept
         * because the geometry still works in world units while the
         * panel has to speak in millimetres.
         */
        const length = Math.hypot(
            geometry.end.x - geometry.start.x,
            geometry.end.y - geometry.start.y
        );

        const mmLength = mmOf(length);

        rows.push(section("GEOMETRY"));

        if (object.type === "truss") {
            /*
             * A truss is not one line but a structure, so its GEOMETRY
             * is the envelope the student asked for - the span it
             * covers, how tall it stands and how many panels it is
             * divided into - rather than a pair of ends. Span and
             * Height are read live off the drawn structure, because
             * the members are what define the extent and a truss whose
             * span disagreed with its own members would be lying.
             *
             * Span is editable and moves the structure's far end along
             * its existing direction, exactly as a beam's Length does.
             */
            /*
             * ONE WORD FOR THIS QUANTITY, EVERYWHERE.
             *
             * It was "Span" on a truss and a cable and "Length" on a
             * beam, a line and a shaft - all of them the same property,
             * `length`, so the same physical thing had two names
             * depending on which feature it was drawn with. A student
             * who learned that "Span" meant the distance end to end
             * then found a beam calling the identical number
             * "Length".
             *
             * "Length" is the word kept. It is the term the creation
             * popup already asks for, the term the Dimension tool
             * reports, and the term the geometry property is called.
             * A span is still a legitimate word in engineering, but it
             * is a DIFFERENT quantity - the horizontal reach of a
             * cable, say, as against how much cable there is - and
             * using it here would mean the word stood for two things
             * across the application.
             */
            rows.push(
                scalar(
                    "Length",
                    "length",
                    mmOf(length).value,
                    mmOf(length).unit,
                    true,
                    true
                )
            );

            rows.push(
                scalar(
                    "Height",
                    "height",
                    mmOf(Number(geometry.height) || 0).value,
                    mmOf(Number(geometry.height) || 0).unit,
                    true,
                    true
                )
            );

            rows.push(section("JOINTS"));
            rows.push(derivedCount("Joint Count",
                (geometry.joints || []).length));

            rows.push(section("MEMBERS"));
            rows.push(derivedCount("Member Count",
                (geometry.members || []).length));

            rows.push(section("OPTIMIZATION"));
            rows.push(`
                <div class="drawing-property-grid drawing-property-grid-value">
                    <span class="drawing-property-grid-label">Panels</span>
                    <input type="number" step="1" min="2"
                        data-property="panels"
                        aria-label="Panels"
                        value="${Math.round(Number(geometry.panels) || 4)}"
                        ${fixed("panels") ? "disabled" : ""}>
                    <span class="drawing-property-unit"></span>
                    <span></span>
                </div>
            `);
            rows.push(trussOptimizeMarkup());
        } else if (object.type === "beam") {
            /*
             * EDITABLE, and applied to the geometry.
             *
             * This used to be a read-only measurement, because Length is
             * derived from the two ends. It is editable now, and typing a
             * new one moves the far end along the beam's existing
             * direction until it reaches that distance from the start -
             * the beam grows or shrinks about the end that was placed
             * first and keeps its attitude.
             */
            rows.push(scalar("Length", "length",
                mmLength.value, mmLength.unit, true, true));
            rows.push(scalar("Height", "depth",
                mmOf(Number(geometry.depth) || 0).value,
                mmOf(Number(geometry.depth) || 0).unit, true, true));
        } else if (object.type === "cable") {
            /*
             * Span and Length are both the spec's own fields, and for
             * a straight cable they are the same number - but they are
             * not the same MEANING: one is how far the cable reaches,
             * the other is how much cable there is, and the second
             * stops being the first the moment a cable is drawn with a
             * sag. They share one GEOMETRY section rather than being
             * split across two, because they are read as one pair.
             *
             * For a straight cable they are the same number, and both are
             * editable, both applied to the geometry the same way.
             */
            /*
             * The cable's cable-length - how much cable there is - is a
             * DIFFERENT quantity from how far it reaches, and the
             * original code said so twice: once in the block comment
             * above and again in a longer one here, explaining why two
             * fields were needed and why one of them was derived.
             *
             * Only one of them is stored. `length` is the reach, and it
             * is the one the creation popup and the Dimension tool
             * both edit. For a straight cable the cable-length equals
             * the reach, so it can be derived from the same geometry
             * rather than stored a second time - which is what stops
             * the panel showing two numbers that quietly disagree the
             * moment the cable is given a sag.
             *
             * The reachable amount of cable is therefore a DERIVED
             * readout, and the field to type into is Length, named the
             * same as everywhere else in the application.
             */
            rows.push(
                scalar(
                    "Length",
                    "length",
                    mmOf(length).value,
                    mmOf(length).unit,
                    true,
                    true
                )
            );

            rows.push(
                derived(
                    "Length",
                    (geometry.segments || []).length
                        ? geometry.length ?? length
                        : length,
                    "mm"
                )
            );

            rows.push(section("SEGMENTS"));
            rows.push(derivedCount("Segment Count",
                (geometry.segments || []).length ||
                Math.max(1, Number(geometry.segmentCount) || 1)));
        } else {
            rows.push(scalar("Length", "length",
                mmOf(length).value, mmOf(length).unit));
            rows.push(scalar("Diameter", "diameter",
                mmOf(Number(geometry.diameter) || 0).value,
                mmOf(Number(geometry.diameter) || 0).unit));
            rows.push(scalar("Radius", "radius",
                mmOf(
                    Number(geometry.radius) ||
                        (Number(geometry.diameter) || 0) / 2
                ).value,
                mmOf(
                    Number(geometry.radius) ||
                        (Number(geometry.diameter) || 0) / 2
                ).unit));
        }

        /*
         * POSITION and ORIENTATION are in the same place for all four
         * types, because all four are straight members whose position
         * IS their two ends and whose orientation is what those ends
         * make.
         */
        rows.push(section("POSITION"));
        rows.push(coordinate("Start X", "start.x", geometry.start.x, "mm", true));
        rows.push(coordinate("Start Y", "start.y", geometry.start.y, "mm", true));
        rows.push(coordinate("End X", "end.x", geometry.end.x, "mm", true));
        rows.push(coordinate("End Y", "end.y", geometry.end.y, "mm", true));
        rows.push(lockRow());

        rows.push(section("ORIENTATION"));
        rows.push(derived("Angle",
            Math.atan2(
                geometry.end.y - geometry.start.y,
                geometry.end.x - geometry.start.x
            ) * 180 / Math.PI, "Â°"));

        /* Whatever is particular to this type, after the shared three. */
        if (object.type === "cable") {
            rows.push(section("CABLE"));
            rows.push(scalar("Tension", "tension",
                Number(geometry.tension) || 0, "N"));
        } else if (object.type === "shaft") {
            rows.push(section("SHAFT"));
            rows.push(scalar("Torque", "torque",
                Number(geometry.torque) || 0, "NÂ·m"));
        } else if (object.type === "beam") {
            rows.push(section("RELATIONSHIPS"));
            rows.push(derivedCount("Supports",
                attachedCount(object.id)));
            rows.push(derivedCount("Connections",
                attachedCount(object.id, CONNECTION_TYPES)));
        }
    } else if (object.type === "force") {
        /*
         * A Point Force is one vector with two equally valid
         * descriptions of it, and the panel offers both through
         * the same segmented control the Triangle uses for its
         * two definitions.
         *
         * The endpoint is deliberately NOT editable. It is the
         * drawn arrow's tip, and it is fully determined by the
         * application point and the vector, so exposing it would
         * offer a third way of editing the same force that could
         * disagree with the other two. The position and
         * orientation of the force are expressed by its
         * application point and its magnitude and direction.
         */
        const mode =
            forcePanelMode(object);

        const vector =
            enggLoadProfile.forceVector(
                geometry
            );

        /*
         * THE FORCE'S OWN UNIT, read from the feature so the panel and the
         * drawing state the magnitude the same way. A force entered in kN
         * reads "kN" here and on the sheet; there is one source for it.
         */
        const forceUnitValue =
            enggLoadProfile.forceUnit(geometry);

        /*
         * THE LABEL IS A FEATURE PROPERTY, AND IT SITS WITH THE NAME.
         *
         * "Feature Name, then Label" is the order the student reasons in: first
         * what this thing is called in a schedule, then what its magnitude is
         * written under on the sheet. There is no ANNOTATION section holding
         * it - a separate heading would imply the label belongs to the
         * drawing's presentation rather than to the force itself.
         */
        rows.push(
            magnitudeLabelRow({
                object,
                defaultLabel: "F",
                standalone: true,
            })
        );

        rows.push(section("FORCE"));

        rows.push(`
            <div class="drawing-segmented" role="group" aria-label="Force definition">
                <button type="button"
                    class="drawing-segmented-option${mode === "polar" ? " active" : ""}"
                    data-force-mode="polar"
                    aria-pressed="${mode === "polar"}">
                    Magnitude &amp; Direction
                </button>
                <button type="button"
                    class="drawing-segmented-option${mode === "components" ? " active" : ""}"
                    data-force-mode="components"
                    aria-pressed="${mode === "components"}">
                    X / Y Components
                </button>
            </div>
        `);

        if (mode === "polar") {
            /*
             * THE FORCE'S MAGNITUDE, WITH ITS UNIT EDITABLE HERE.
             *
             * A Point Force is stated in a force unit, and the student can
             * change that unit from the feature's own panel - the same control
             * a load uses. The number is relabelled, not rescaled: 1 kN and
             * 1000 N are the same force, and the sheet says what this field
             * says.
             */
            rows.push(
                quantityWithUnit(
                    "Magnitude",
                    "magnitude",
                    vector.magnitude,
                    "forceUnit",
                    enggLoadProfile.FORCE_UNITS,
                    forceUnitValue,
                    true,
                    "force"
                )
            );

            rows.push(
                scalar(
                    "Direction",
                    "angle",
                    vector.angle,
                    "Â°"
                )
            );

            /*
             * The same Reverse Direction control the load tools use,
             * built by the same markup helper so a force and a load
             * cannot drift apart in appearance or in behaviour. Only the
             * data attribute differs, because only the handler differs.
             */
            rows.push(
                reverseDirectionMarkup(
                    "data-force-reverse-direction"
                )
            );
        } else {
            /*
             * THE COMPONENTS ARE STATED IN THE FORCE'S OWN UNIT.
             *
             * The stored vector is in N, and the magnitude row above reads
             * in the force's unit, so the components read in that same
             * unit - a force of 5 kN at 37 degrees has components of
             * "4" and "3" in kN, not in N. They used to print the raw N
             * numbers under a kN caption, a thousandfold misstatement the
             * student would copy straight into a calculation.
             *
             * The unit selector is the same one the magnitude row uses,
             * writing the same `forceUnit` property, so the two rows
             * cannot disagree about what the force is denominated in.
             */
            const forceUnitControl =
                panels.unitSelect
                    ? panels.unitSelect({
                          property: "forceUnit",
                          units: enggLoadProfile.FORCE_UNITS,
                          current: forceUnitValue,
                          label: "Force unit",
                      })
                    : null;

            const componentField = (label, key, component) =>
                panels.scalar({
                    label,
                    key,
                    value: enggQuantities.convertValue(
                        component,
                        "force",
                        "N",
                        forceUnitValue
                    ),
                    unit: forceUnitControl ? "" : forceUnitValue,
                    unitControl: forceUnitControl,
                    disabled: fixed(key),
                    unitExtra: showKnown ? knownBox(key, label) : "",
                    state: fixBox(key, label),
                });

            rows.push(
                componentField("X Component", "forceX", vector.fx)
            );

            rows.push(
                componentField("Y Component", "forceY", vector.fy)
            );
        }

        /*
         * THE APPLICATION POINT.
         *
         * On a body, the force is positioned ALONG it - one number, whose height
         * and orientation follow from the member and the force's own direction -
         * so the relative rows below are the whole placement and there is no
         * absolute pair to offer (see `absolutePositionRows`).
         *
         * In free space there is no axis to be measured along, so the absolute X
         * and Y ARE the placement and both are shown.
         */
        rows.push(section("APPLICATION POINT"));
        rows.push(relativeRows("APPLICATION POINT"));
        rows.push(
            absolutePositionRows(object, {
                coordinate,
                section
            })
        );
    } else if (object.type === "moment") {
        /*
         * A MOMENT, IN THE TERMS A MOMENT ACTUALLY HAS.
         *
         * No endpoint X and Y, no length, no components. Those belong
         * to a straight force, and offering them for a moment invites
         * the reader to treat a rotation as a vector - which is the
         * misunderstanding the symbol is supposed to prevent, and the
         * one that makes a moment look like a force with a kink in it.
         *
         * What a moment has instead is a magnitude with a UNIT, a
         * sense of rotation, one point it acts at, and a handful of
         * presentation choices. The magnitude and the direction are the
         * engineering; the radius, the line and the head are the
         * drawing; and the grouping keeps them apart, because
         * resizing the arc must never look like it changes the moment.
         */
        rows.push(section("VALUE"));

        /*
         * THE MOMENT'S UNIT IS EDITABLE HERE, like a load's and a force's.
         *
         * A moment is stated in N\u00b7m or kN\u00b7m, and the student chooses
         * which from the feature's own panel. The stored number is relabelled,
         * not rescaled - 1 kN\u00b7m and 1000 N\u00b7m are the same moment - so the
         * value on the sheet and the value in this field stay one number.
         */
        rows.push(
            quantityWithUnit(
                "Magnitude",
                "magnitude",
                Number(geometry.magnitude) || 0,
                "momentUnit",
                enggLoadProfile.MOMENT_UNITS,
                enggLoadProfile.momentUnit(geometry),
                true,
                "moment"
            )
        );

        rows.push(magnitudeLabelRow({
            object,
            defaultLabel: "M",
        }));

        rows.push(section("DIRECTION"));
        rows.push(`
            <div class="drawing-property-grid drawing-property-grid-value">
                <span class="drawing-property-grid-label">Direction</span>
                <select data-property="direction" aria-label="Direction">
                    <option value="CCW"${
                        momentDirectionOf(geometry) === "CCW"
                            ? " selected"
                            : ""
                    }>Counterclockwise</option>
                    <option value="CW"${
                        momentDirectionOf(geometry) === "CW"
                            ? " selected"
                            : ""
                    }>Clockwise</option>
                </select>
                <span class="drawing-property-unit"></span>
                <span></span>
            </div>
        `);

        /*
         * NO FLIP BUTTON HERE, DELIBERATELY.
         *
         * The Direction dropdown immediately above already offers both
         * senses, so a "Switch Direction" control on a Moment would be a
         * second way of doing what the dropdown does - and a second way
         * is a second place for the two to disagree about what the moment
         * currently is.
         *
         * The load and force tools keep their flip button because their
         * direction is an ANGLE they type, and flipping is a shortcut
         * across a continuous range. A moment has only two senses, CW and
         * CCW, both named in the list; there is nothing for a button to
         * shortcut.
         */

        /*
         * RELATIVE TO THE FEATURE THE MOMENT IS ON.
         *
         * A moment attached to a body reports its position the same
         * way a support does â€” the shared relative-coordinates rows,
         * which name the parent and give the position along it in the
         * sheet's units. When there is no parent the rows render
         * nothing and the absolute coordinates below are the only
         * placement the panel offers, which is the honest state for a
         * moment in free space.
         */
        rows.push(relativeRows("RELATIONSHIP"));

        /*
         * THE APPLICATION POINT, the same rule as a force's.
         *
         * A moment on a body is positioned along it; a moment in free space has
         * the absolute pair and nothing else. `absolutePositionRows` decides
         * which of those applies, so the moment and the force cannot disagree
         * about what a child of a body is offered.
         */
        rows.push(
            absolutePositionRows(object, {
                coordinate,
                section
            })
        );

        rows.push(section("APPEARANCE"));
        rows.push(arcRadiusRow(geometry));
    } else if (
        object.type === "load" ||
        object.type === "varying-load"
    ) {
       /*
        * A Distributed Load and a Varying Distributed Load share ONE
        * panel.
        *
        * They are the same feature with a different distribution: both
        * act over a region of a body and both point the same way. The
        * load's panel itself states the ONE uniform magnitude of the
        * region - see `distributedLoadPanelMarkup`.
        *
        * Every control here writes straight to the model the renderer
        * reads, so a change is visible immediately and the load never has
        * to be deleted and rebuilt.
        */
       rows.push(
           distributedLoadPanelMarkup(
               object,
               { coordinate, scalar, section }
           )
       );
    } else if (
        isSupportType(object.type)
    ) {
        /*
         * Each support variant is its own feature with its own
         * position and orientation, so the panel names the
         * variant the student actually placed.
         */
        rows.push(
            supportPanelRows(object)
        );
    } else if (
        isConnectionType(object.type)
    ) {
        /*
         * Each connection variant is a real feature, so it is
         * named for itself rather than as a generic connection.
         */
        rows.push(section(staticsConnectionSection(object.type)));
        rows.push(coordinate("Start X", "start.x", geometry.start.x, "mm", true));
        rows.push(coordinate("Start Y", "start.y", geometry.start.y, "mm", true));
        rows.push(coordinate("End X", "end.x", geometry.end.x, "mm", true));
        rows.push(coordinate("End Y", "end.y", geometry.end.y, "mm", true));
    } else if (object.type === "connection") {
        rows.push(section("CONNECTION"));
        rows.push(coordinate("Start X", "start.x", geometry.start.x, "mm", true));
        rows.push(coordinate("Start Y", "start.y", geometry.start.y, "mm", true));
        rows.push(coordinate("End X", "end.x", geometry.end.x, "mm", true));
        rows.push(coordinate("End Y", "end.y", geometry.end.y, "mm", true));
        rows.push(scalar("Reaction", "reaction",
            Number(geometry.reaction) || 0, "N"));
    } else if (
        object.type === "support" ||
        object.type === "body"
    ) {
        rows.push(section(
            object.type === "support"
                ? "SUPPORT"
                : "BODY"
        ));
        rows.push(relativeRows("POSITION"));
        rows.push(
            absolutePositionRows(object, {
                coordinate,
                section
            })
        );
    } else if (object.type === "polygon") {
        /*
         * The definition is remembered from creation so
         * the panel can lead with the matching view,
         * but the underlying parameters are the same.
         */
        const definition =
            object.metadata?.definition ||
            "By Centre";

        rows.push(`
            <div class="drawing-property-grid drawing-property-grid-value">
                <span class="drawing-property-grid-label">Definition</span>
                <span class="drawing-property-readonly">${definition}</span>
                <span class="drawing-property-unit"></span>
                <span></span>
            </div>
        `);

        rows.push(section("GEOMETRY"));
        rows.push(`
            <div class="drawing-property-grid drawing-property-grid-value">
                <span class="drawing-property-grid-label">Number of Sides</span>
                <input type="number" step="1" min="3"
                    data-property="sides"
                    aria-label="Number of Sides"
                    value="${Math.round(Number(geometry.sides) || 3)}"
                    ${fixed("sides") ? "disabled" : ""}>
                <span class="drawing-property-unit"></span>
                <span></span>
            </div>
        `);
        rows.push(coordinate("Centre X", "center.x", geometry.center.x, "mm", true));
        rows.push(coordinate("Centre Y", "center.y", geometry.center.y, "mm", true));
        rows.push(scalar("Radius", "radius",
            mmOf(geometry.radius).value, mmOf(geometry.radius).unit));
        rows.push(scalar("Rotation", "rotation",
            (Number(geometry.rotation) || 0) * 180 / Math.PI, "Â°"));
    } else if (
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
         * Legacy reference-axis features from older files
         * are still editable so saved drawings keep
         * working.
         */
        rows.push(section("ORIGIN"));
        rows.push(coordinate("X", "origin.x", geometry.origin.x, "mm", true));
        rows.push(coordinate("Y", "origin.y", geometry.origin.y, "mm", true));
        rows.push(section("GEOMETRY"));
        rows.push(scalar("Axis Length", "axisLength",
            mmOf(Number(geometry.axisLength) || 25).value,
            mmOf(Number(geometry.axisLength) || 25).unit));
    } else if (object.type === "rectangle") {
        /*
         * ========================================================
         * A RECTANGLE IS POSITIONED BY AN ANCHOR CORNER
         * ========================================================
         *
         * The panel used to lead with Centre X / Centre Y. A student laying out a
         * drawing does not know where the centre of a rectangle is - they know
         * where its corner goes, because that is the point they click and the
         * point they dimension to. So the panel states the ANCHOR CORNER.
         *
         * THE TOP-LEFT CORNER IS THE ANCHOR, and it is the corner the model
         * ALREADY stores. `geometry.position` is the top-left of the unrotated
         * rectangle in world space (see `rectangleCorners` in
         * feature-geometry.js, which derives the centre as
         * `position + (width/2, -height/2)`). So Position X / Position Y are read
         * and written DIRECTLY - no derivation, no rounding, and no change to the
         * geometry engine.
         *
         * THIS IS ALSO WHAT MAKES IT BACKWARD COMPATIBLE. A document saved with
         * the old panel stores the same `position`, so every existing rectangle
         * shows its true corner and does not move by so much as a rounding step.
         * The old `centre.*` keys are still accepted by the setter, so a rectangle
         * edited through a stale binding cannot be left unpainted either.
         *
         * ROTATED RECTANGLES. Width and Height are measured along the rectangle's
         * OWN axes, and Rotation turns it about this anchor - so the anchor corner
         * is the one point that does not move when the shape is turned. That is
         * what makes it a stable reference for a rotated rectangle, and it is why
         * the centre-based view was ambiguous for one.
         */
        rows.push(section("GEOMETRY"));
        rows.push(coordinate("Position X", "position.x", geometry.position.x, "mm", true));
        rows.push(coordinate("Position Y", "position.y", geometry.position.y, "mm", true));
        rows.push(scalar("Width", "width",
                mmOf(geometry.width).value, mmOf(geometry.width).unit));
        rows.push(scalar("Height", "height",
                mmOf(geometry.height).value, mmOf(geometry.height).unit));
        if (isPistonCylinder(object)) {
            rows.push(scalar("Piston Height", "pistonHeight",
                mmOf(geometry.height * pistonFraction(geometry)).value, mmOf(geometry.height).unit));
            if (geometry.hasStoppers) {
                rows.push(scalar("Stopper Height", "stopperHeight",
                    mmOf(geometry.height * stopperFraction(geometry)).value, mmOf(geometry.height).unit));
            }
        }
        if (isSaturationCurve(object)) {
            rows.push(section("AXIS LABELS"));
            for (const [caption, key, value] of [
                ["Horizontal Axis", "xLabel", geometry.xLabel ?? ""],
                ["Vertical Axis", "yLabel", geometry.yLabel ?? ""]
            ]) {
                rows.push(panels.row({
                    label: caption,
                    control: `<input type="text" class="drawing-property-input" data-saturation-axis-label="${key}" aria-label="${caption}" value="${escapeHtmlText(value)}">`
                }));
            }
        }
        rows.push(scalar("Rotation", "rotation", geometry.rotation || 0, "Â°"));

        /*
         * ========================================================
         * MEASUREMENTS: CALCULATED, NOT DRIVING
         * ========================================================
         *
         * Area and Perimeter are derived from the physical Width and Height, so
         * they are read-only rows: offering an input would invite the student to
         * type a number that the next repaint would immediately overwrite.
         *
         * THE PHYSICAL DIMENSIONS ARE USED, NOT THE DISPLAYED ONES. `mmOf`
         * resolves the stored world size to millimetres through the document
         * scale, so a 500 mm rectangle reads 250000 mm2 whatever the panel happens
         * to be captioned in. Reading the rounded display value instead would
         * make the area drift as the unit changed.
         *
         * THE UNITS ARE THE SHARED TABLES'. Area is a SQUARED length and goes
         * through the `area` quantity (mm2 / cm2 / m2 / in2 / ft2); Perimeter is a
         * length and goes through `length`. Neither is a formatted string built
         * here, so a unit added to either table appears in this panel too.
         *
         * AN INCOMPLETE RECTANGLE FABRICATES NOTHING. `derived` refuses a
         * non-finite value, so a rectangle whose size is not yet known shows no
         * measurement rather than a confident zero.
         */
        const widthMM = mmOf(geometry.width);
        const heightMM = mmOf(geometry.height);

        rows.push(section("MEASUREMENTS"));
        rows.push(
            derived(
                "Area",
                Math.abs(widthMM.value * heightMM.value),
                squaredUnitOf(widthMM.unit)
            )
        );
        rows.push(
            derived(
                "Perimeter",
                2 * (Math.abs(widthMM.value) + Math.abs(heightMM.value)),
                widthMM.unit
            )
        );
    } else if (object.type === "polyline") {
        rows.push(section("GEOMETRY"));
        (geometry.points || []).forEach((p, index) => {
            rows.push(coordinate(`Point ${index + 1} X`, `points.${index}.x`, p.x, "mm", true));
            rows.push(coordinate(`Point ${index + 1} Y`, `points.${index}.y`, p.y, "mm", true));
        });
    } else if (object.type === "triangle") {
        /*
         * The triangle has its own editor so the
         * Points and Sides & Angles views can share
         * one set of stored points.
         */
        return trianglePropertyMarkup(object, trianglePanelMode(object));
    } else if (object.type === COORDINATE_SYSTEM_TYPE) {
        /*
         * One feature with four independent extensions.
         * Editing any one value changes only that side.
         */
        rows.push(section("ORIGIN"));
        rows.push(coordinate("Origin X", "origin.x", geometry.origin.x, "mm", true));
        rows.push(coordinate("Origin Y", "origin.y", geometry.origin.y, "mm", true));
        rows.push(section("AXIS EXTENSIONS"));

        /*
         * READ IN MILLIMETRES, LIKE EVERY OTHER LENGTH.
         *
         * These were the raw world values captioned "mm" - so an axis
         * 100 world units long reported itself as 100 mm on an
         * uncalibrated sheet, and as something else entirely once a
         * scale existed. `mmOf` is the one conversion, which is what
         * keeps the number here, the number the setter writes, and
         * the number the Dimension tool reports as the same length.
         */
        const axisMm = value =>
            mmOf(Number(value) || 0);

        rows.push(scalar("X Positive Length", "xPositiveLength",
                axisMm(geometry.xPositiveLength ?? geometry.axisLength ?? 25).value,
                axisMm(geometry.xPositiveLength ?? geometry.axisLength ?? 25).unit));
        rows.push(scalar("X Negative Length", "xNegativeLength",
                axisMm(geometry.xNegativeLength ?? geometry.axisLength ?? 25).value,
                axisMm(geometry.xNegativeLength ?? geometry.axisLength ?? 25).unit));
        rows.push(scalar("Y Positive Length", "yPositiveLength",
                axisMm(geometry.yPositiveLength ?? geometry.axisLength ?? 25).value,
                axisMm(geometry.yPositiveLength ?? geometry.axisLength ?? 25).unit));
        rows.push(scalar("Y Negative Length", "yNegativeLength",
                axisMm(geometry.yNegativeLength ?? geometry.axisLength ?? 25).value,
                axisMm(geometry.yNegativeLength ?? geometry.axisLength ?? 25).unit));

        /*
         * THE AXIS LABELS.
         *
         * A text field each, read from the feature and written back to it, so
         * what the sheet shows is what is stored. An EMPTY label is a real,
         * meaningful state - the student has said they want no label there - so
         * it is passed through as an empty string rather than being replaced by
         * the default. The default is only ever applied when the feature is
         * CREATED, in geometry-creation.js.
         */
        rows.push(section("AXIS LABELS"));
        rows.push(textField("X Label", "xLabel", geometry.xLabel ?? ""));
        rows.push(textField("Y Label", "yLabel", geometry.yLabel ?? ""));
    } else if (object.type === "annotate") {
        /*
         * ========================================================
         * AN ANNOTATE FEATURE
         * ========================================================
         *
         * Every annotate kind shares the same panel SKELETON - text,
         * placement, appearance - and adds only the rows its own kind
         * actually has. A note has text and a position; a leader adds its
         * two ends and an arrowhead; a tolerance adds its mode and values; a
         * table adds its grid. NO kind shows a row it has no meaning for,
         * which is the same rule every other panel follows.
         *
         * The order is the application's normal one (spec 60): the feature
         * name and label come from the shared header ABOVE this block, then
         * the primary content, then placement and relationship, then the
         * kind's own settings, and finally Appearance.
         */
        const kind = object.annotateKind;
        const annotate = enggAnnotate;

        /*
         * THE CONTENT.
         *
         * A note, a label, a leader and a callout are written text, so each
         * gets a free-text field. A SYMBOL and a TOLERANCE render from fields
         * of their own rather than from free text, so their content is not a
         * writable field - editing the glyph of a position symbol would let
         * the drawing claim a symbol the library does not contain.
         */
        if (
            kind === "note" ||
            kind === "label" ||
            kind === "leader" ||
            kind === "callout"
        ) {
            rows.push(section("TEXT"));
            rows.push(
                textField(
                    "Text",
                    "text",
                    object.text ?? ""
                )
            );
        }

        if (kind === "label" && annotate) {
            /*
             * WHAT THE LABEL IS ABOUT.
             *
             * A label may read a feature's own Label, so changing that one
             * place updates the drawing - the student never keeps two copies.
             * The row states the target so the association is visible rather
             * than implied.
             */
            rows.push(section("TARGET"));
            rows.push(
                textField(
                    "Linked Feature",
                    "targetFeatureId",
                    object.targetFeatureId ?? ""
                )
            );
        }

        if (kind === "symbol" && annotate) {
            rows.push(section("SYMBOL"));
            rows.push(symbolPickerRow(object));
        }

        if (kind === "tolerance" && annotate) {
            rows.push(section("TOLERANCE"));
            rows.push(toleranceRows(object));
        }

        if (kind === "table" && annotate) {
            rows.push(section("TABLE"));
            rows.push(
                scalar(
                    "Rows",
                    "rows",
                    Number(geometry.rows) || 1,
                    "",
                    true
                )
            );
            rows.push(
                scalar(
                    "Columns",
                    "columns",
                    Number(geometry.columns) || 1,
                    "",
                    true
                )
            );

            /*
             * THE CELLS, one row per cell, in reading order.
             *
             * Rendered from the stored grid so the panel and the drawn
             * table cannot disagree, and so editing a cell writes the cell
             * the student is looking at.
             */
            rows.push(section("CELLS"));

            const columns = Number(geometry.columns) || 1;
            const totalRows = Number(geometry.rows) || 1;
            const cells = Array.isArray(geometry.cells)
                ? geometry.cells
                : [];

            for (let row = 0; row < totalRows; row += 1) {
                for (let column = 0; column < columns; column += 1) {
                    const index = row * columns + column;

                    rows.push(
                        textField(
                            `${columnLetter(column)}${row + 1}`,
                            `cell.${index}`,
                            cells[index] ?? ""
                        )
                    );
                }
            }
        }

        /*
         * PLACEMENT.
         *
         * A point-placed kind shows its position; a geometric kind shows
         * both of its ends, because both are the student's to place and both
         * are stored in drawing units (spec 65).
         */
        rows.push(section("PLACEMENT"));

        if (geometry.position) {
            rows.push(
                coordinate(
                    "Position",
                    "position",
                    geometry.position,
                    "mm",
                    true
                )
            );
        }

        if (geometry.start) {
            rows.push(
                coordinate(
                    kind === "arrow" ? "Start" : "Target",
                    "start",
                    geometry.start,
                    "mm",
                    true
                )
            );
        }

        if (geometry.end) {
            rows.push(
                coordinate(
                    kind === "arrow" ? "End" : "Text Position",
                    "end",
                    geometry.end,
                    "mm",
                    true
                )
            );
        }

        if (kind === "leader" || kind === "callout" || kind === "arrow") {
            rows.push(leaderStyleRows(object));
        }

        /*
         * THE PEN'S PATH, for the two kinds that have one.
         *
         * A leader and a callout are a PEN - attachment, bends, endpoint - and
         * the bends are what carry it around the drawing. The count is shown,
         * and adding or removing a bend is a control rather than something the
         * student has to rebuild the feature to do.
         *
         * ADDING PLACES THE NEW BEND AT THE MIDPOINT of the segment it splits,
         * so the drawn line does not move when it is added - the student then
         * drags it where they want it. REMOVING RECONNECTS the neighbours, so
         * the path stays continuous and can never be left broken.
         */
        if (kind === "leader" || kind === "callout") {
            const bends = Array.isArray(geometry.bends)
                ? geometry.bends.length
                : 0;

            /*
             * HOW MANY ELBOWS THIS KIND MAY HAVE, from the model - so the
             * button's enabled state and the action's own guard cannot
             * disagree. A leader takes ONE elbow in V1.
             */
            const maxBends =
                annotate.maxBendsFor?.(kind) ??
                (kind === "leader" ? 1 : 3);

            const atLimit = bends >= maxBends;

            rows.push(section("PATH"));

            rows.push(`
                <div class="drawing-property-grid drawing-property-grid-value">
                    <span class="drawing-property-grid-label">Bends</span>
                    <span class="drawing-property-derived">${bends}${
                        kind === "leader" ? " of 1" : ""
                    }</span>
                    <span class="drawing-property-unit"></span>
                    <span></span>
                </div>
            `);

            rows.push(`
                <div class="drawing-property-grid drawing-property-grid-value">
                    <span class="drawing-property-grid-label">Path</span>
                    <span class="drawing-property-path-actions">
                        <button type="button"
                            class="drawing-property-action"
                            data-annotate-add-bend
                            aria-label="Add a bend to the leader"
                            ${atLimit ? "disabled" : ""}>Add Bend</button>
                        <button type="button"
                            class="drawing-property-action"
                            data-annotate-remove-bend
                            aria-label="Remove the last bend"
                            ${bends ? "" : "disabled"}>Remove Bend</button>
                    </span>
                    <span class="drawing-property-unit"></span>
                    <span></span>
                </div>
            `);
        }
    } else if (object.type === "dimension") {
        /*
         * ========================================================
         * A MEASURED DIMENSION
         * ========================================================
         *
         *     GENERAL
         *     Value      25.43 mm      (read live from the geometry)
         *
         * THE VALUE IS READ FROM THE GEOMETRY EVERY TIME THIS PANEL IS DRAWN -
         * `measurementFor` recomputes it from the referenced features, the same
         * call the canvas makes - so the panel and the sheet can never state
         * different numbers. There is no stored number to fall out of step,
         * because the number is not stored at all.
         *
         * IT IS SHOWN AS A DERIVED READING, not an input. A dimension is an
         * ANNOTATION: it states what the GEOMETRY is and never moves it. An
         * edited value is written as the dimension's text (the Edit Value
         * action), and changing the geometry remains the student's own act.
         */
        rows.push(section("GENERAL"));
        rows.push(dimensionValueRow(object));
        rows.push(dimensionTypeRow(object));
        rows.push(dimensionEditRow(object));
        rows.push(dimensionUnitRow(object));
    }

    rows.push(appearanceMarkup(object));

    /*
     * NO SECOND TITLE.
     *
     * The header at the top of this panel already states the feature's name -
     * `featureHeaderMarkup` emits it, and the editable name field beneath it.
     * Repeating `object.name` here printed the feature twice, one line under
     * the other, which read as two features rather than one.
     */
    return `<div class="drawing-properties-block">
        ${finaliseRows(rows)}
    </div>`;
}

/*
 * A spreadsheet-style column name: 0 -> A, 25 -> Z, 26 -> AA.
 *
 * Cells are identified to the student by their grid position, not by a
 * numeric index, because "B2" is how a table is read.
 */
function columnLetter(index) {
    let letter = "";
    let n = index;

    do {
        letter =
            String.fromCharCode(65 + (n % 26)) + letter;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);

    return letter;
}

/*
 * The Symbol tool's picker: the library, grouped.
 *
 * A single `<select>` with `<optgroup>`s, written through the same
 * `data-property` mechanism every other panel control uses - so choosing a
 * symbol writes `symbolId` onto the feature through the ONE property
 * setter, and the drawn glyph follows from the model rather than from a
 * second copy here.
 */
function symbolPickerRow(object) {
    const library =
        enggAnnotate?.SYMBOL_LIBRARY || [];

    const current =
        object.geometry?.symbolId || "datum";

    const groups = library
        .map(
            (group) => `
                <optgroup label="${group.label}">
                    ${group.symbols
                        .map(
                            (symbol) => `
                                <option value="${symbol.id}"${
                                    symbol.id === current
                                        ? " selected"
                                        : ""
                                }>${symbol.text}  ${symbol.label}</option>
                            `
                        )
                        .join("")}
                </optgroup>
            `
        )
        .join("");

    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Symbol</span>
            <select data-property="symbolId" aria-label="Symbol">
                ${groups}
            </select>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * A tolerance's mode and the values that mode makes meaningful.
 *
 * ONLY THE FIELDS THE MODE USES ARE SHOWN. A symmetric tolerance has one
 * Â± value; a deviation or a limit tolerance has an upper and a lower; a
 * basic tolerance has none, because its whole meaning is that it is
 * theoretical. Showing all three rows whatever the mode would invite a
 * student to type a lower limit into a symmetric tolerance and have it
 * silently ignored.
 */
function toleranceRows(object) {
    const modes =
        enggAnnotate?.TOLERANCE_MODES || {};

    const mode = object.geometry?.toleranceMode || "symmetric";
    const values = object.geometry?.toleranceValues || {};
    const definition = modes[mode] || modes.symmetric;
    const fields = definition?.fields || [];

    const modeOptions = Object.entries(modes)
        .map(
            ([id, entry]) =>
                `<option value="${id}"${
                    id === mode ? " selected" : ""
                }>${entry.label}</option>`
        )
        .join("");

    const escapeAttr = (value) =>
        String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");

    const numberRow = (label, key, value) => `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">${label}</span>
            <input type="number" step="0.01"
                data-property="${key}"
                aria-label="${label}"
                value="${escapeAttr(value)}">
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;

    let rows = `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Tolerance Type</span>
            <select data-property="toleranceMode" aria-label="Tolerance Type">
                ${modeOptions}
            </select>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;

    if (fields.includes("value")) {
        rows += numberRow(
            "Value (Â±)",
            "toleranceValue",
            values.value ?? 0.1
        );
    }

    if (fields.includes("upper")) {
        rows += numberRow(
            "Upper",
            "toleranceUpper",
            values.upper ?? 0.1
        );
    }

    if (fields.includes("lower")) {
        rows += numberRow(
            "Lower",
            "toleranceLower",
            values.lower ?? -0.1
        );
    }

    /*
     * WHAT IT READS AS ON THE DRAWING, so the student can see the effect of
     * a mode change without looking away from the panel.
     */
    rows += `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Shows</span>
            <span class="drawing-property-derived">${definition?.text(
                values
            ) ?? ""}</span>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;

    return rows;
}

/*
 * A leader's or an arrow's line and head, as two compact choices.
 *
 * These belong to the FEATURE, not to a family of tools: a bent leader and
 * a straight one are the same thing drawn differently, so they are options
 * here rather than separate toolbar buttons (spec 34, 35).
 */
function leaderStyleRows(object) {
    const arrowhead =
        object.style?.arrowhead || "closed";

    const style =
        object.style?.leaderStyle || "straight";

    const option = (value, label, selected) =>
        `<option value="${value}"${
            selected ? " selected" : ""
        }>${label}</option>`;

    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Line</span>
            <select data-style="leaderStyle" aria-label="Leader line style">
                ${option("straight", "Straight", style === "straight")}
                ${option("elbow", "Bent / Elbow", style === "elbow")}
            </select>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>

        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Arrowhead</span>
            <select data-style="arrowhead" aria-label="Arrowhead">
                ${option("none", "None", arrowhead === "none")}
                ${option("open", "Open", arrowhead === "open")}
                ${option("closed", "Closed", arrowhead === "closed")}
                ${option("dot", "Dot", arrowhead === "dot")}
                ${option("tick", "Tick", arrowhead === "tick")}
            </select>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * A MEASURED DIMENSION'S VALUE, read live from the geometry.
 *
 * `measurementFor` recomputes it from the referenced features on every call -
 * the same call the renderer makes - so the panel and the sheet are showing the
 * same reading rather than two numbers that happen to agree. There is no stored
 * value to drift: moving the geometry changes this row on the next redraw.
 *
 * Rendered as a DERIVED value (the inset, non-editable style) because it is a
 * reading, not a setting. The student edits the annotation text through the
 * Edit Value action; the geometry is changed by editing the geometry.
 */
function dimensionValueRow(object) {
    let text;

    try {
        text =
            enggDimensionModel.formatMeasurement(object, drawingState) || "";
    } catch (error) {
        text = "";
    }

    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Value</span>
            <span class="drawing-property-derived">${escapeHtmlText(
                text || "unresolved",
            )}</span>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * WHAT a dimension measures - Length, Angle, Diameter - so the panel says which
 * quantity the value above is.
 */
function dimensionTypeRow(object) {
    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Measures</span>
            <span class="drawing-property-derived">${escapeHtmlText(
                variableMeasureLabel(object.dimensionType),
            )}</span>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * WHICH LENGTH UNIT A DIMENSION IS READ IN.
 *
 * The measurement is always taken in the sheet's own unit; this says only how
 * it is WRITTEN, so a 100 mm span read in cm shows "10 cm" while still
 * measuring 100 mm. It is a CONVERSION, not a relabel, and it is done in
 * `formatMeasurement` through the shared unit table.
 *
 * The control is the ONE unit selector every unit-bearing feature uses, so it
 * has the same width and behaviour as a force's or a moment's.
 *
 * AN ANGLE HAS NO LENGTH UNIT, so no control is offered for an angular
 * dimension - there is nothing to convert it to, and offering degrees beside
 * millimetres would be a category error.
 */
function dimensionUnitRow(object) {
    const angular = object.dimensionType === "angular";

    if (angular) {
        return "";
    }

    const units =
        enggQuantities?.unitsFor?.("length") || ["mm", "cm", "m"];

    const current =
        object.displayUnit || "mm";

    const options = units
        .map(
            unit =>
                `<option value="${unit}"${
                    unit === current ? " selected" : ""
                }>${unit}</option>`
        )
        .join("");

    const control =
        enggPropertyPanel?.unitSelect
            ? enggPropertyPanel.unitSelect({
                  property: "displayUnit",
                  units,
                  current,
                  label: "Dimension unit",
              })
            : `<select class="drawing-property-unit-select" data-property="displayUnit" aria-label="Dimension unit">${options}</select>`;

    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Unit</span>
            <span class="drawing-property-derived"></span>
            <span class="drawing-property-unit">${control}</span>
            <span></span>
        </div>
    `;
}

/*
 * What a dimension's measurement type is called, for the panel row.
 *
 * The student-facing word for each measurement type, shared by the panel row and
 * the tool's status message so the two read the same way.
 */
function variableMeasureLabel(dimensionType) {
    return (
        {
            angular: "Angle",
            "point-line": "Distance",
            horizontal: "Length",
            vertical: "Length",
            aligned: "Length",
            linear: "Length",
            diameter: "Diameter",
            radius: "Radius"
        }[dimensionType] || String(dimensionType)
    );
}

/*
 * THE DIMENSION'S VALUE IS EDITABLE ANNOTATION TEXT.
 *
 * The Edit Value action opens the value popup, which writes the dimension's
 * text - `label` - over the measured number. It never moves geometry: a
 * dimension is an annotation, and the retired Driving/Driven mode (which let a
 * typed value resize the feature it measured) is gone.
 */
function dimensionEditRow() {
    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Edit</span>
            <span class="drawing-property-path-actions">
                <button type="button"
                    class="drawing-property-action"
                    data-dimension-edit-value
                    aria-label="Edit the dimension value">Edit Value</button>
            </span>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * Point markers are drawn at a fixed screen size, so
 * the only meaningful appearance control is the
 * marker size itself.
 */
function pointSizeMarkup(
    object
) {
    /*
     * A marker size is a whole number of pixels. `|| 6` supplies the default
     * for an absent value, and the finiteness test keeps a corrupt stored value
     * from reaching the field as "NaN".
     */
    const stored = Number(object.style.pointSize);

    const size = Number.isFinite(stored) && stored > 0 ? Math.round(stored) : 6;

    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Point Size</span>
            <input type="number" step="1" min="1"
                data-style="pointSize"
                aria-label="Point Size"
                value="${size}">
            <span class="drawing-property-unit">px</span>
            <span></span>
        </div>
    `;
}

/*
 * The triangle panel has two views over the same
 * stored points. The chosen view is remembered per
 * object so switching back and forth preserves the
 * triangle instead of rebuilding it.
 */
export const trianglePanelModes =
    new Map();

function trianglePanelMode(
    object
) {
    return (
        trianglePanelModes.get(
            object.id
        ) || "points"
    );
}

/*
 * The Point Force panel has two views over the SAME force:
 * a magnitude and a direction, or the two components that force
 * is made of. The chosen view is remembered per object, and
 * because both views are read from and written to the one
 * underlying vector, switching between them never changes the
 * force, it only changes which numbers are on screen.
 */
export const forcePanelModes =
    new Map();

function forcePanelMode(
    object
) {
    return (
        forcePanelModes.get(
            object.id
        ) || "polar"
    );
}
