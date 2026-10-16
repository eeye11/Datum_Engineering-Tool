/*
 * The Statics sections of a feature's panel: vectors, annotations, supports and loads.
 */

import enggBodyFrames from "../../../shared/geometry/body-frames.js";
import enggDimensions from "../../../shared/scale/dimensions.js";
import enggAnalysisDependencies from "../model/analysis/analysis-dependencies.js";
import enggDiagramEquations from "../model/analysis/diagram-equations.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import enggDrawingRotationalArrow from "../model/analysis/rotational-arrow.js";
import enggQuantities from "../../../shared/units/quantities.js";
import enggAnnotationModel from "../model/annotations/annotation-model.js";
import enggSketchEditor from "../../../shared/ui/editors/sketch-editor.js";
import enggPropertyPanel from "../../../components/layout/panels/property-panel.js";
import { drawingState } from "../editor-state.js";
import { mmOf } from "../interaction/handles.js";
import { relativeCoordinateRows } from "../../../components/layout/panels/relative-coordinates.js";
import { staticsSupportSection } from "./statics-tools.js";

/*
 * ========================================================
 * VECTOR SCALE IS NOT HERE ANY MORE
 * ========================================================
 *
 * The Vector Scale control used to be rendered at the top of this panel - a
 * STATICS DISPLAY block offering the decades and a custom box - because it
 * decides how large every force and load arrow is drawn.
 *
 * It is a SHEET-WIDE display setting, though, not a property of the feature in
 * front of the student, and a sheet-wide control does not belong in a panel
 * that describes one feature: it lived inside a long scrolling list where it
 * was easy to miss, and there was only ever one of it while the panel could
 * show many features. It now sits on the TOP TOOLBAR beside Magnitudes, where
 * every other global display control already is, and it is editable there
 * without selecting anything.
 *
 * The reading and writing are unchanged - `load-profile.vectorScaleFor` and
 * `state.statics.vectorScale` are still the one source of truth - so nothing
 * about how an arrow is drawn is affected by where the control lives.
 */

/*
 * The Reverse Direction control for a load.
 *
 * Turning a load around is a single, frequent adjustment - a
 * sign the user got the way round on the first attempt, or a
 * direction to be swapped while testing - so it is a button
 * rather than something to be typed as a number. Typing
 * direction - 180 by hand is easy to get wrong for an angle
 * like 135, and impossible to get right for a value the user
 * has not read precisely.
 *
 * The control sits directly under the Direction field it
 * changes, so the value it edits and the control that edits it
 * are read together and the displayed direction is always the
 * one currently in force.
 */
export function reverseDirectionMarkup(
    control = "data-load-reverse-direction"
) {
    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label"></span>
            <button type="button"
                class="drawing-property-action drawing-property-action-icon-only"
                ${control}
                aria-label="Reverse Direction"
                title="Reverse Direction">
                <span class="drawing-property-action-icon"
                    aria-hidden="true">&#8593;&#8595;</span>
            </button>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `;
}

/*
 * ========================================================
 * THE ANNOTATION CONTROLS FOR A MAGNITUDE-BEARING FEATURE
 * ========================================================
 *
 * A force, a load, a moment, a resultant and a force-components pair each
 * carry an engineering magnitude, and each can have that magnitude written
 * beside it on the sheet as a box the student can drag to where there is room.
 *
 * These switches control WHETHER that box appears. They do not hold the value
 * - the value belongs to the feature, and the box prints it from there every
 * frame - and they are not the place the magnitude is edited. A number typed
 * here would be a second copy of one already on the force, free to disagree
 * with it.
 *
 * So this is two checkboxes and a heading, and the whole engineering half of
 * the feature is elsewhere.
 *
 * WHY THE BOX IS CONTROLLED TWICE
 *
 * There is a sheet-wide switch as well, and the relationship is deliberate:
 * the per-feature switch may only NARROW the sheet-wide one. A sheet full of
 * twenty forces is unreadable with twenty boxes on it, so a student switches
 * off the seventeen that do not matter; turning the whole class off is not a
 * way to cope, because it also loses the three that did.
 *
 * So a feature switched off here stays off even when the sheet is turned back
 * on - the choice is remembered on the feature, not recomputed from the global
 * switch. `annotationDisplay` is where it is stored, and the annotation model
 * reads the same field, so the checkbox and the box on the sheet cannot
 * disagree about whether it is showing.
 *
 * Only features that actually HAVE a magnitude are given these controls. A
 * beam has no magnitude to annotate, so it gets no ANNOTATION heading - see
 * `magnitudeBearingTypes` below, and note that the section is omitted entirely
 * for every other feature rather than rendered empty.
 */
export function annotationSectionMarkup(
    object,
    types
) {
    const panels =
        enggPropertyPanel;

    /*
     * NO SHARED MODULE, NO SECTION. The fallback renders nothing rather than a
     * second copy of these controls that would drift from this one.
     */
    if (!panels) {
        return "";
    }

    /*
     * THE FEATURES THAT HAVE A MAGNITUDE TO ANNOTATE.
     *
     * A list, not a guess: the question "does this feature have an
     * engineering magnitude" has to be answered once, and answered the same
     * way by the panel and by the renderer. Answering it per-panel is how a
     * Beam ends up with a Show Magnitude switch that does nothing.
     */
    if (
        !types ||
        !types.has(object.type)
    ) {
        return "";
    }

    const model =
        enggAnnotationModel;

    const state = drawingState;

    /*
     * Read through the model's own predicate rather than by inspecting the
     * state here. The panel and the renderer must be asking one question of
     * one function; a panel that read `display.showMagnitudes` directly would
     * ignore the per-feature setting and show a box the sheet does not have.
     */
    const shown = model
        ? model.magnitudeShownFor(object, state)
        : true;

    /*
     * THERE IS NO "Show Unit" CONTROL, AND THERE IS NO REASON FOR ONE.
     *
     * It was offered here as an informational readout of the sheet's
     * unit setting, on the reasoning that the annotation model might
     * hide units. It does not: `unitSuffix` accepts the flag and then
     * deliberately ignores it, because a magnitude without its unit is
     * not the same quantity as one with it.
     *
     * So the switch reported a setting the user could not change and
     * that nothing acted on - a dead control that looked meaningful.
     * Removed rather than disabled, because a switch that cannot be
     * flipped is worse than no switch: it implies a choice that does
     * not exist.
     */
    const fields = [
        panels.toggle({
            label: "Show Magnitude",
            attribute: "data-feature-show-magnitude",
            on: shown,
        }),
    ];

    return panels.section("ANNOTATION", fields);
}

/*
 * THE FEATURE TYPES THAT CARRY SOMETHING WORTH ANNOTATING.
 *
 * Not written here. The annotation model owns this question, because it is
 * the same question it already answers internally when it decides whether a
 * box can be produced - and a second list would be a second answer.
 *
 * That is not hypothetical. The first version of this named
 * "distributed-load" and "moment"; DAETUM's features are called "load"
 * and "moment", so the list matched nothing at all and the section was
 * offered to no feature whatsoever while looking entirely correct.
 *
 * Read once and cached, because it is a Set built by walking the model's kind
 * table and the answer cannot change while the page is loaded.
 */
export const MAGNITUDE_BEARING_TYPES = (() => {
    const model =
        enggAnnotationModel;

    if (!model?.annotatableTypes) {
        /*
         * No model, no feature has a box, so nothing is offered. An empty set
         * renders no sections and breaks nothing; a guessed list would render
         * switches for features that cannot have one.
         */
        return new Set();
    }

    return model.annotatableTypes();
})();

/*
 * A UNIT SELECTOR FOR A FEATURE'S OWN QUANTITY.
 *
 * One control, used by every feature whose magnitude carries a unit - a load,
 * a Point Force, a Moment. It is a SELECT rather than a text box, so the unit
 * can only ever be one of the units the application understands, and the value
 * shown beside it is read in that unit.
 *
 * CHANGING THE UNIT DOES NOT CHANGE THE QUANTITY. 1 kN and 1000 N are the same
 * force; the stored number is relabelled, not rescaled, which is the rule the
 * load already follows and the reason the same magnitude reads identically on
 * the sheet and in the panel.
 */
export function unitSelectMarkup({
    property,
    units,
    current,
    label,
}) {
    /*
     * THE SHARED CONTROL, WHERE IT IS AVAILABLE.
     *
     * Every unit selector in the application resolves to ONE builder -
     * `propertyPanel.unitSelect` - so a load's unit control and a force's are
     * the same control, at the same width, with the same dropdown and the same
     * keyboard behaviour. The fallback below is the same markup again, for the
     * harness contexts where the panel module is not loaded, so this function
     * never returns nothing.
     */
    const panels =
        enggPropertyPanel;

    if (panels && panels.unitSelect) {
        return panels.unitSelect({
            property,
            units,
            current,
            label,
        });
    }

    const options = units
        .map(
            unit =>
                `<option value="${unit}"${
                    unit === current ? " selected" : ""
                }>${unit}</option>`
        )
        .join("");

    return `<select class="drawing-property-unit-select" data-property="${property}" aria-label="${label}">${options}</select>`;
}

/*
 * The Arc Radius row for a rotational feature.
 *
 * PRESENTATION, and labelled as such.
 *
 * The field is deliberately kept out of the DIRECTION and MAGNITUDE
 * groups and given a unit of pixels rather than N·m, because it is the
 * one number on this feature that is not engineering. It says how big
 * the curved arrow is drawn; it does not say how hard the moment
 * turns. Showing it next to a magnitude with the same styling is what
 * invites a student to read "radius 25, so 500 N·m" as one statement,
 * and widening the arc to make a moment legible would then appear to
 * change its value.
 */
export function arcRadiusRow(
    geometry
) {
    const rotational =
        enggDrawingRotationalArrow;

    const current =
        rotational
            ? rotational.clampArcRadius(
                geometry.arcRadius ??
                    rotational.DEFAULT_ARC_RADIUS_PX
            )
            : Number(geometry.arcRadius) || 16;

    return `
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Arc Radius</span>
            <input type="number"
                step="1"
                min="${rotational ? rotational.MIN_ARC_RADIUS_PX : 8}"
                max="${rotational ? rotational.MAX_ARC_RADIUS_PX : 80}"
                data-arc-radius
                aria-label="Arc Radius"
                title="How large the curved arrow is drawn. This is presentation only and does not change the magnitude."
                value="${current}">
            <span class="drawing-property-unit">px</span>
            <span></span>
        </div>
    `;
}

/*
 * The Features panel for an ANALYSIS object.
 *
 * ONE panel for all five kinds, because they have the same shape: a
 * source relationship, some display switches, and a set of values
 * that are either derived or editable. Only the labels and which
 * values exist differ, and branching per type would have meant five
 * near-identical panels that drift apart.
 *
 * DERIVED VALUES ARE SHOWN, NOT EDITED
 * ------------------------------------
 * A resultant's magnitude and a components object's Fx and Fy are
 * CALCULATED from forces the student typed. Putting them in editable
 * boxes would invite the one thing that must not happen: typing a
 * magnitude that disagrees with the sources, leaving an arrow whose
 * label contradicts its own geometry. So they are rendered as read-only
 * text, and the control for changing them is the force itself - which
 * is where the number actually comes from.
 *
 * A broken source is stated plainly rather than shown as zero. Zero is
 * a claim, and an unresolved object has no claim to make.
 */

export function analysisPanelRows(
    object
) {
    const geometry = object.geometry || {};

    const engineering = object.engineering || {};

    const sources = enggAnalysisDependencies
        .sourceIdsOf(object)
        .map(
            id =>
                drawingState.objects.find(
                    candidate =>
                        candidate.id === id
                ) || null
        );

    const rows = [];

    /*
     * ========================================================
     * THE SAME PANEL VOCABULARY AS EVERY OTHER FEATURE
     * ========================================================
     *
     * These rows go through the shared property-panel module for the same
     * reason the Statics panels do: a field with a missing value is not a
     * field, so an analysis diagram cannot print "Magnitude NaN" or leave a
     * unit standing beside nothing. The heading is a marker that the caller's
     * finalise pass drops when the rows under it turn out to be empty.
     */
    const panels =
        enggPropertyPanel;

    const escape = value =>
        String(value ?? "").replace(
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

    const section = label =>
        `<!--section:${label}-->`;

    /*
     * A READ-ONLY FIELD, OMITTED WHEN IT HAS NO VALUE.
     *
     * `value` may be a number (joined with its unit) or a ready-made string
     * such as a body name or a range. Either way an absent value produces no
     * field rather than an empty one - which is what stops a diagram printing
     * "Magnitude NaN" or leaving a unit standing beside nothing.
     *
     * The shared module is used when it is present; when it is not (a bare
     * test harness that lifts this function out on its own), the same rules are
     * applied locally rather than the field silently vanishing.
     */
    const readOnly = (label, value, unit) => {
        if (panels && panels.readOnlyQuantity) {
            /*
             * The shared helpers join the number and its unit, so a value that
             * has already been formatted to a string is joined with its unit
             * here and passed as a finished string.
             */
            if (typeof value === "number") {
                return panels.readOnlyQuantity(label, value, unit || "");
            }

            if (value === undefined || value === null || String(value).trim() === "") {
                return "";
            }

            return panels.readOnly(
                label,
                unit ? `${value} ${unit}` : String(value),
            );
        }

        /*
         * LOCAL FALLBACK. Same two rules: no value, no field; number and unit
         * joined once.
         */
        if (value === undefined || value === null) {
            return "";
        }

        if (typeof value === "number" && !Number.isFinite(value)) {
            return "";
        }

        const shown = typeof value === "number" ? number(value) : String(value);

        if (shown.trim() === "") {
            return "";
        }

        return `
            <div class="drawing-property-grid drawing-property-grid-value">
                <span class="drawing-property-grid-label">${escape(label)}</span>
                <span class="drawing-property-derived">${escape(shown)}</span>
                <span class="drawing-property-unit">${escape(unit || "")}</span>
                <span></span>
            </div>
        `;
    };

    const toggle = (label, key, on) => {
        if (panels && panels.row) {
            return panels.row({
                label,
                control: `<input type="checkbox"
                      data-analysis-toggle="${escape(key)}"
                      aria-label="${escape(label)}"
                      ${on ? "checked" : ""}>`,
            });
        }

        return `
            <div class="drawing-property-grid drawing-property-grid-value">
                <span class="drawing-property-grid-label">${escape(label)}</span>
                <input type="checkbox"
                    data-analysis-toggle="${escape(key)}"
                    aria-label="${escape(label)}"
                    ${on ? "checked" : ""}>
                <span class="drawing-property-unit"></span>
                <span></span>
            </div>
        `;
    };

    const number = value => {
        if (panels && panels.number) {
            return panels.number(value);
        }

        const numeric = Number(value);

        if (!Number.isFinite(numeric)) {
            return "";
        }

        const rounded = Math.round(numeric * 100) / 100;

        return Object.is(rounded, -0) ? "0" : String(rounded);
    };

    /*
     * THE ORDINATE'S UNIT, FROM THE SHARED QUANTITY TABLES.
     *
     * A bending moment is a MOMENT and a shear or axial force is a FORCE, so
     * a Y Range typed against the wrong unit would be wrong by a factor of a
     * metre - and the base unit the model stores is what the range is typed
     * in, not a display choice. It is read from the shared table rather than
     * from a second copy of the diagram table, and it is the same convention
     * the axis label uses - the two cannot end up quoting different units for
     * the same diagram.
     */
    const ordinateUnit = () =>
        ({
            sfd: "N",
            bmd: "N\u00b7m",
            afd: "N",
        })[geometry.diagramType] || "";

    const heading = {
        "force-components": "FORCE COMPONENTS",
        resultant: "RESULTANT",
        "shear-force-diagram": "SHEAR FORCE DIAGRAM",
        "bending-moment-diagram": "BENDING MOMENT DIAGRAM",
        "axial-force-diagram": "AXIAL FORCE DIAGRAM"
    }[object.type] ||
        "ANALYSIS";

    rows.push(section(heading));

    /*
     * THE SOURCE, WHICH THE STUDENT MUST BE ABLE TO SEE.
     *
     * Not decoration: an analysis object that silently follows
     * something the student cannot name is impossible to reason about
     * when it updates, because there is nothing to look at and work out
     * why. The names are listed, and a source that has been deleted is
     * named as missing rather than dropped from the list.
     */
    rows.push(section("SOURCE"));

    if (!sources.length) {
        rows.push(
            readOnly(
                "Relative to",
                "Nothing selected"
            )
        );
    } else {
        sources.forEach((source, index) => {
            rows.push(
                readOnly(
                    sources.length > 1
                        ? "Source " + (index + 1)
                        : "Relative to",
                    source
                        ? source.name || source.type
                        : "deleted"
                )
            );
        });
    }

    if (engineering.unresolved) {
        rows.push(
            readOnly(
                "Status",
                "Source deleted - showing no values"
            )
        );
    } else if (
        object.type === "resultant" ||
        object.type === "force-components"
    ) {
        /*
         * THE CHILD SAYS IT IS DERIVED.
         *
         * A Resultant and a Force Components pair are not independent Statics
         * objects: every value and every part of their geometry is calculated
         * from the source force(s) listed above. Saying so on the panel is what
         * tells the student why the numbers are read-only and why the feature
         * does not drag - the control for changing them is the SOURCE force,
         * not this child.
         */
        rows.push(
            readOnly(
                "Status",
                "Derived from its source force"
            )
        );
    }

    if (object.type === "force-components") {
        /*
         * THE COMPONENTS ARE READ IN THE SOURCE FORCE'S OWN UNIT.
         *
         * A derived component is the same physical quantity as the force it
         * came from, so it is stated in that force's unit - converted from
         * the stored N through the shared table, exactly as the force's own
         * panel reads its magnitude. A raw N number under no caption invited
         * the reader to think the decomposition had changed the quantity's
         * scale.
         */
        /*
         * THE SOURCE FORCE, resolved through the dependency model rather
         * than a guessed geometry field, so the unit read off it is the one
         * the decomposition is actually about.
         */
        const sourceForce = sources.find(
            candidate => candidate?.type === "force"
        );

        const componentUnit = sourceForce
            ? enggLoadProfile.forceUnit(sourceForce.geometry)
            : "N";

        rows.push(section("COMPONENTS"));
        rows.push(
            readOnly(
                "Horizontal",
                number(
                    enggQuantities.convertValue(
                        geometry.forceX,
                        "force",
                        "N",
                        componentUnit
                    )
                ),
                componentUnit
            )
        );
        rows.push(
            readOnly(
                "Vertical",
                number(
                    enggQuantities.convertValue(
                        geometry.forceY,
                        "force",
                        "N",
                        componentUnit
                    )
                ),
                componentUnit
            )
        );

        rows.push(section("DISPLAY"));

        /*
         * OFF BY DEFAULT, and the panel has to say so.
         *
         * This reads `!== false`, which reports the original force as
         * ON - so the checkbox claimed a setting the drawing was not using,
         * and a student who unticked it saw no change, because unsetting
         * `false` left the field absent and the renderer read absent as on
         * too. Two places had the same wrong default and cancelled out to
         * "always on".
         *
         * A Force Components feature draws Fx and Fy. The decomposed vector
         * is a genuine reference for checking the work, so it is offered -
         * but drawing it by default put a second copy of the force on the
         * sheet, which is the thing the tool exists to avoid.
         */
        rows.push(
            toggle(
                "Show Original Force",
                "showOriginal",
                geometry.showOriginal === true
            )
        );
        rows.push(
            toggle(
                "Show X Component",
                "showX",
                geometry.showX !== false
            )
        );
        rows.push(
            toggle(
                "Show Y Component",
                "showY",
                geometry.showY !== false
            )
        );

        rows.push(section("VALUE LABELS"));
        rows.push(
            toggle(
                "Show Magnitudes",
                "showValues",
                geometry.showValues !== false
            )
        );
    }

    if (object.type === "resultant") {
        rows.push(section("RESULTANT"));
        rows.push(
            readOnly(
                "Magnitude",
                number(geometry.magnitude),
                "N"
            )
        );
        rows.push(
            readOnly(
                "Direction",
                number(geometry.angle),
                "°"
            )
        );

        rows.push(section("DISPLAY"));
        rows.push(
            toggle(
                "Show Resultant",
                "showResultant",
                geometry.showResultant !== false
            )
        );
        rows.push(
            toggle(
                "Show Construction",
                "showConstruction",
                geometry.showConstruction === true
            )
        );

        /*
         * WHETHER THE RESULTANT'S MAGNITUDE IS WRITTEN BESIDE IT.
         *
         * Force Components above already has its own "Show Magnitudes"
         * control, and does not get this section as well: two switches that
         * mean the same thing on one panel is the duplicate-control problem,
         * and a student who unticks one and watches nothing change has no way
         * to work out which is authoritative.
         *
         * The Resultant had no such control, so its value could be read but
         * never written on the sheet - which for a derived force is the whole
         * point of having it. This brings it into line with the features that
         * did have the switch.
         */
        rows.push(
            annotationSectionMarkup(
                object,
                MAGNITUDE_BEARING_TYPES
            )
        );
    }

    if (object.type === "analysis-diagram") {
        const span = geometry.sourceSpan;

        rows.push(section("REFERENCE"));

        rows.push(
            readOnly(
                "Reference",
                span
                    ? "Body Length"
                    : "No source"
            )
        );

        /*
         * ========================================================
         * PLOT: WHAT THE DIAGRAM IS, NOT WHAT IS ON IT
         * ========================================================
         *
         * A Plot holds EXPRESSIONS - relations the student has added to
         * the graph - and the equations among them are the part that takes
         * real thought. They are edited in the Plot Editor, which has
         * room for a card per expression and a live graph beside them;
         * this panel states the range the graph covers and how many
         * expressions are in it, and then hands over.
         *
         * The old presentation - From/To/f(x) for every segment, plus an
         * Add/Remove pair and a separate CHECKS block - made this panel
         * into a data inspector. A student with five expressions had to
         * read a wall of numbers to answer the one question they have,
         * and every one of those rows competed with the colour, line
         * width and position controls that also live here.
         *
         * THE COUNT IS THE WHOLE OF IT HERE. No equation is printed in
         * this panel, because a partial list is worse than none: it looks
         * like the diagram has been fully described when it has not.
         */
        if (geometry.mode === "plot") {
            const equations =
                enggDiagramEquations;

            const range = geometry.localRange;

            const expressions = equations
                ? equations.readPlot(geometry)
                : [];

            rows.push(section("PLOT"));

            rows.push(
                readOnly(
                    "Range",
                    span &&
                        range &&
                        Number.isFinite(Number(range.from)) &&
                        Number.isFinite(Number(range.to))
                        ? `${number(
                            enggDimensions.toEngineering(drawingState, range.from).value,
                        )} → ${number(
                            enggDimensions.toEngineering(drawingState, range.to).value,
                        )} ${enggDimensions.toEngineering(drawingState, range.to).unit}`
                        : "No source body"
                )
            );

            rows.push(
                readOnly(
                    "Expressions",
                    String(expressions.length)
                )
            );

            rows.push(`
                <div class="drawing-property-grid drawing-property-grid-value">
                    <span class="drawing-property-grid-label"></span>
                    <button type="button"
                        class="drawing-property-action"
                        data-plot-editor-open
                        ${equations ? "" : "disabled"}>
                        Open Analysis Editor
                    </button>
                    <span class="drawing-property-unit"></span>
                    <span></span>
                </div>
            `);
        }

        /*
         * ========================================================
         * SKETCH: THE SAME PANEL, THE OTHER MODE
         * ========================================================
         *
         * A Sketch is a list of drawn elements rather than a list of
         * equations, so it counts ELEMENTS and says so - reusing the word
         * "expressions" would leave the student to work out which they are
         * looking at.
         *
         * It offers the same one button for the same reason: the drawing is
         * done in the editor, and this panel describes the diagram rather than
         * being where it is made.
         */
        if (geometry.mode === "sketch") {
            const range = geometry.localRange;

            const elements = Array.isArray(
                geometry.sketchElements
            )
                ? geometry.sketchElements
                : [];

            rows.push(section("SKETCH"));

            rows.push(
                readOnly(
                    "Range",
                    span &&
                        range &&
                        Number.isFinite(Number(range.from)) &&
                        Number.isFinite(Number(range.to))
                        ? `${number(
                            enggDimensions.toEngineering(drawingState, range.from).value,
                        )} → ${number(
                            enggDimensions.toEngineering(drawingState, range.to).value,
                        )} ${enggDimensions.toEngineering(drawingState, range.to).unit}`
                        : "No source body"
                )
            );

            rows.push(
                readOnly(
                    "Elements",
                    String(elements.length)
                )
            );

            rows.push(`
                <div class="drawing-property-grid drawing-property-grid-value">
                    <span class="drawing-property-grid-label"></span>
                    <button type="button"
                        class="drawing-property-action"
                        data-plot-editor-open
                        ${
                            enggSketchEditor
                                ? ""
                                : "disabled"
                        }>
                        Open Analysis Editor
                    </button>
                    <span class="drawing-property-unit"></span>
                    <span></span>
                </div>
            `);
        }

        rows.push(section("DISPLAY"));
        rows.push(
            toggle(
                "Zero Axis",
                "showZeroAxis",
                geometry.showZeroAxis !== false
            )
        );

        /*
         * ========================================================
         * THE Y RANGE
         * ========================================================
         *
         * Blank means "fit to what I have drawn", which is the state a
         * student wants until they have something to fit. Leaving the
         * fields empty is therefore a real answer rather than an unset one,
         * and it is why the renderer falls back to the diagram's own peak
         * rather than treating a missing range as zero.
         *
         * Only the ordinate is offered. The x range is not a choice: it is
         * the length of the member the diagram describes, and a field for
         * it would let the two disagree - a graph whose axis says 0-500
         * while the body it belongs to is 522 long.
         */
        rows.push(section("Y RANGE"));

        rows.push(`
            <div class="drawing-property-grid">
                <span class="drawing-property-grid-label">
                    Minimum
                </span>
                <input type="number" step="any"
                    class="drawing-property-input"
                    data-geometry-field="yRange"
                    data-geometry-part="from"
                    value="${
                        Number.isFinite(
                            Number(geometry.yRange?.from)
                        )
                            ? number(geometry.yRange.from)
                            : ""
                    }"
                    placeholder="auto"/>
                <span class="drawing-property-unit">
                    ${ordinateUnit()}
                </span>
                <span></span>
            </div>
        `);

        rows.push(`
            <div class="drawing-property-grid">
                <span class="drawing-property-grid-label">
                    Maximum
                </span>
                <input type="number" step="any"
                    class="drawing-property-input"
                    data-geometry-field="yRange"
                    data-geometry-part="to"
                    value="${
                        Number.isFinite(
                            Number(geometry.yRange?.to)
                        )
                            ? number(geometry.yRange.to)
                            : ""
                    }"
                    placeholder="auto"/>
                <span class="drawing-property-unit">
                    ${ordinateUnit()}
                </span>
                <span></span>
            </div>
        `);
        rows.push(
            toggle(
                "Source Reference",
                "showReferencePositions",
                geometry.showReferencePositions !== false
            )
        );

        /*
         * SHOW EQUATIONS, AND ONLY FOR A PLOT.
         *
         * There is nothing to write beside a Sketch - the shape IS the
         * student's work - so offering the toggle there would be a control
         * that does nothing, which is worse than no control.
         *
         * Off by default: a diagram with its equations on it reads as a
         * finished answer.
         */
        if (geometry.mode === "plot") {
            rows.push(
                toggle(
                    "Show Equations",
                    "showEquations",
                    geometry.showEquations === true
                )
            );
        }

        /*
         * ========================================================
         * TICKS
         * ========================================================
         *
         * Off by default, and the spacing fields beside them do nothing
         * until it is on - which is stated in the fields themselves rather
         * than left to be discovered.
         *
         * A spacing that would produce an unreadable number of marks draws
         * none, rather than drawing some arbitrary subset. That is
         * deliberately visible: a student who typed 0.001 on a 5 m beam
         * should see that it did not take, and fix it, rather than be given
         * a scale they never asked for.
         *
         * The x spacing is in the member's own units and the y spacing in
         * the ordinate's, so a beam in mm and a diagram in kN each get a
         * number they can read.
         */
        rows.push(
            toggle(
                "Ticks",
                "showTicks",
                geometry.showTicks === true
            )
        );

        const tickFields = `
            <div class="drawing-property-grid">
                <span class="drawing-property-grid-label">
                    X Spacing
                </span>
                <input type="number" step="any" min="0"
                    class="drawing-property-input"
                    data-geometry-field="xTickSpacing"
                    value="${
                        Number.isFinite(
                            Number(geometry.xTickSpacing)
                        )
                            ? number(geometry.xTickSpacing)
                            : ""
                    }"
                    placeholder="${
                        geometry.localRange
                            ? number(
                                  (Number(
                                      geometry.localRange.to,
                                  ) -
                                      Number(
                                          geometry.localRange.from,
                                      )) /
                                      5,
                              )
                            : ""
                    }"/>
                <span class="drawing-property-unit">mm</span>
                <span></span>
            </div>

            <div class="drawing-property-grid">
                <span class="drawing-property-grid-label">
                    Y Spacing
                </span>
                <input type="number" step="any" min="0"
                    class="drawing-property-input"
                    data-geometry-field="yTickSpacing"
                    value="${
                        Number.isFinite(
                            Number(geometry.yTickSpacing)
                        )
                            ? number(geometry.yTickSpacing)
                            : ""
                    }"
                    placeholder="auto"/>
                <span class="drawing-property-unit">
                    ${ordinateUnit()}
                </span>
                <span></span>
            </div>
        `;

        rows.push(tickFields);
        rows.push(
            toggle(
                "Background",
                "backgroundVisible",
                geometry.backgroundVisible !== false
            )
        );
    }

    rows.push(section("POSITION"));
    rows.push(
        readOnly(
            "X",
            number(geometry.position?.x ?? geometry.start?.x),
            "mm"
        )
    );
        rows.push(
            readOnly(
                "Y",
                number(geometry.position?.y ?? geometry.start?.y),
                "mm"
            )
        );

        /*
         * THE HEADINGS ARE RESOLVED HERE, NOT LEFT AS MARKERS.
         *
         * This function returns a finished list, so a heading must stand or fall
         * with the rows under it before it leaves - otherwise a caller that simply
         * joins the list would show the marker as an invisible HTML comment and
         * lose the heading text. The rules are the same ones the caller's finalise
         * pass applies: a heading with no real field under it is dropped, and an
         * empty fragment is dropped.
         */
        const finalised = [];

        for (let index = 0; index < rows.length; index += 1) {
            const entry = rows[index];

            if (typeof entry !== "string" || entry.trim() === "") {
                continue;
            }

            const marker = /^<!--section:(.*?)-->$/.exec(entry);

            if (!marker) {
                finalised.push(entry);
                continue;
            }

            let hasField = false;

            for (let ahead = index + 1; ahead < rows.length; ahead += 1) {
                const next = rows[ahead];

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
                finalised.push(
                    `<div class="drawing-properties-section">${escape(marker[1])}</div>`,
                );
            }
        }

        return finalised;
    }

/*
 * THE FEATURES PANEL FOR A SUPPORT.
 *
 * A support has a RELATIONSHIP to a body and a SIDE, and those are the
 * only two things about its position a student edits. Everything else
 * about where it appears is derived, and putting a derived value in an
 * editable box is how a drawing ends up self-contradictory: a support
 * whose Y had been typed to move it clear of the beam would sit
 * somewhere the attachment said it could not.
 *
 * SO THERE IS NO Y FIELD HERE, AND NO ORIENTATION ANGLE.
 *
 * The distance clear of the body is the support renderer's business,
 * worked out from the body's own depth, and the angle it points is
 * worked out from the body's own normal. Neither is a number the
 * student can get wrong, so neither is offered. `Position X` below is
 * the one position that IS theirs: how far along the body they put it.
 *
 * Real X/Y are shown read-only, because a student checking a support
 * against a dimension needs to see where it actually is - but the
 * values are consequences, not settings.
 */
/*
 * THE SENSE A ROTATIONAL FEATURE TURNS, AS A WORD.
 *
 * One reader for the direction, used by the Features panel, the
 * annotation model and the Reverse control, so a moment cannot be
 * described one way and reversed as though it were another.
 *
 * A feature states its direction as "CCW" or "CW". Older files stored
 * a `clockwise` flag and it is still read - without that, every moment
 * in an existing drawing would have silently become anticlockwise the
 * moment it was opened, which is a change nobody asked for and nobody
 * can see.
 */
export function momentDirectionOf(
    geometry
) {
    if (geometry?.direction != null) {
        return String(geometry.direction) === "CW"
            ? "CW"
            : "CCW";
    }

    return geometry?.clockwise === true
        ? "CW"
        : "CCW";
}

export function supportPanelRows(
    object
) {
    const geometry = object.geometry || {};

    const rows = [];

    const section = label =>
        `<div class="drawing-properties-section">${label}</div>`;

    const number = value => {
        if (!Number.isFinite(Number(value))) {
            return "";
        }

        const rounded =
            Math.round(Number(value) * 100) /
            100;

        return Object.is(rounded, -0) ? "0" : String(rounded);
    };

    const parent = object.parentId
        ? drawingState.objects.find(
            candidate =>
                candidate.id === object.parentId
        ) || null
        : null;

    rows.push(
        section(
            staticsSupportSection(
                object.type
            )
        )
    );

    rows.push(section("POSITION"));

    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Relative to</span>
            <span class="drawing-property-readonly">${
                parent
                    ? parent.name || parent.type
                    : "Nothing"
            }</span>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `);

    /*
     * WHERE ALONG THE BODY, in the selected length unit, and the selector
     * beside it says which.
     *
     * Calling this simply "Position X" invited the reading that it is an
     * x coordinate in its own right, and the value a student would then
     * expect to type to move the support to a particular x on the
     * sheet. It is not: it is a distance along the body.
     *
     * WHAT IS STORED IS THE FRACTION, and what is SHOWN is the distance
     * that fraction currently represents. Those are different on purpose.
     * The distance is the number a student thinks in - "300mm along this
     * 600mm beam" - while the fraction is what survives the beam being
     * resized underneath it. Showing the distance and storing the
     * fraction is the translation made once, here, rather than by every
     * other part of the application guessing which one it is holding.
     *
     * THE DISTANCE IS READ IN THE FEATURE'S OWN UNIT, the same one the
     * rest of its panel would use - converted from the sheet's
     * millimetres through the shared table, and selectable beside the
     * number like every other length row.
     */
    const parentFrame = parent
        ? enggBodyFrames.frameOf(parent)
        : null;

    const attachmentFraction = parentFrame
        ? enggBodyFrames.attachmentFraction(
              parentFrame,
              geometry.attachment
          )
        : 0;

    const alongBodyWorld = parentFrame
        ? attachmentFraction * parentFrame.length
        : 0;

    const lengthUnit =
        enggQuantities.isUnitFor("length", object.lengthUnit)
            ? object.lengthUnit
            : "mm";

    const alongBody = enggQuantities.convertValue(
        mmOf(alongBodyWorld).value,
        "length",
        "mm",
        lengthUnit
    );

    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Position Along Body</span>
            <input type="number" step="1"
                data-support-distance
                aria-label="Position Along Body"
                value="${number(alongBody)}">
            <span class="drawing-property-unit">
                <select class="drawing-property-unit-select"
                    data-property="lengthUnit"
                    aria-label="Position unit"
                    title="Position unit">
                    ${enggQuantities
                        .unitsFor("length")
                        .map(
                            unit =>
                                `<option value="${unit}"${
                                    unit === lengthUnit ? " selected" : ""
                                }>${unit}</option>`
                        )
                        .join("")}
                </select>
            </span>
            <span></span>
        </div>
    `);

    /*
     * WHICH SIDE, and nothing else.
     *
     * A checkbox rather than a direction control or a negative
     * distance, because it is genuinely a two-way choice and because
     * the alternative - letting a student type a negative offset - is
     * how a support ends up on the wrong side of a beam with no way to
     * describe what it should have been.
     */
    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Flip</span>
            <input type="checkbox"
                data-support-flip
                aria-label="Flip to the other side of the body"
                ${geometry.flipped ? "checked" : ""}>
            <span class="drawing-property-unit"></span>
            <span></span>
        </div>
    `);

    /*
     * WHERE IT ACTUALLY IS, derived.
     *
     * Read-only on purpose. The two numbers are recomputed from the
     * attachment and the body every frame, so a box the student could
     * type into would be writing to a value that the next redraw
     * overwrites - and they would see their entry spring back.
     */
    const placement = parentFrame
        ? enggBodyFrames.supportPlacement(
            parent,
            enggBodyFrames.attachmentPoint(
                parentFrame,
                geometry.attachment
            ),
            geometry.flipped === true
        )
        : null;

    rows.push(section("REAL POSITION"));

    /*
     * THE DERIVED POSITION IS READ IN THE SAME UNIT the editable rows
     * above use, converted from the sheet's millimetres through the one
     * shared conversion - a derived row stating a different unit from the
     * fields around it is a second reading of one number.
     */
    const shownWorld = point =>
        enggQuantities.convertValue(
            mmOf(point).value,
            "length",
            "mm",
            lengthUnit
        );

    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">X</span>
            <span class="drawing-property-derived">${
                number(shownWorld(placement?.render?.x ?? geometry.position?.x))
            }</span>
            <span class="drawing-property-unit">${lengthUnit}</span>
            <span></span>
        </div>
    `);

    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value">
            <span class="drawing-property-grid-label">Y</span>
            <span class="drawing-property-derived">${
                number(shownWorld(placement?.render?.y ?? geometry.position?.y))
            }</span>
            <span class="drawing-property-unit">${lengthUnit}</span>
            <span></span>
        </div>
    `);

    return rows;
}

/*
 * The Features panel for a Distributed Load.
 *
 * A distributed load is ONE continuous load. Its panel therefore carries
 * ONE magnitude: the uniform intensity of the entire loaded region. The
 * Start and End fields locate that region; they are not two independent
 * load intensities, and the panel must never present them as such. The
 * renderer may draw many arrows across the region, but every arrow
 * represents the same single magnitude.
 *
 * Editing any of these writes to the same model the renderer
 * reads, so the change is visible at once and the load keeps its
 * identity throughout.
 */
export function distributedLoadPanelMarkup(
    object,
    helpers
) {
    const {
        scalar,
        section
    } = helpers;

    const geometry = object.geometry || {};

    /*
     * A NUMBER THAT IS NEVER THE STRING "NaN". A missing value produces an
     * empty string rather than a word that is not a measurement.
     */
    const number =
        value =>
            Number.isFinite(Number(value))
                ? Number(value).toFixed(2)
                : "";

    /*
     * THE ONE MAGNITUDE, AND ITS UNKNOWN STATE.
     *
     * The magnitude is a normal feature property of the load, not an
     * annotation setting, so it sits in the load's own panel with the `?`
     * Unknown control beside it â€” the same control every other
     * magnitude-bearing field uses.
     *
     * UNKNOWN IS BLANK, NOT ZERO. A load whose magnitude is marked unknown
     * has no authoritative intensity yet; an empty field states that
     * honestly, while a zero would assert a load that does not push at
     * all. The two are separate states.
     */
    const known = key =>
        object.unknownValues?.[key] !== true;

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

    const isMagnitudeUnknown = !known("magnitude");

    /*
     * The stored intensity lives on the geometry; the unknown flag lives on
     * the feature. One uniform value for the whole loaded region.
     */
    const magnitudeValue =
        isMagnitudeUnknown ? "" : geometry.intensity;

    const rows = [];

    rows.push(section("LOADED BODY"));
    rows.push(
        relativeCoordinateRows(
            object,
            "LOADED BODY",
            helpers
        )
    );
    /*
     * THE LOADED REGION AND NOTHING ELSE.
     *
     * The Start and End fields above locate the region the load acts over.
     * They do not carry intensities: there is one magnitude for the entire
     * region, shown below.
     */

    /*
     * ONE MAGNITUDE FOR THE ENTIRE LOADED REGION.
     *
     * This is a single uniform distributed load. Start + End + Magnitude +
     * Direction together define one continuous uniform load; the arrows the
     * renderer draws across the region are the visual representation of this
     * one value, not separate loads.
     *
     * The field routes through the standard data-property path with key
     * "magnitude", and the `?` control beside it marks the value unknown.
     * When unknown the field is blank â€” never zero.
     */
    /*
     * THE MAGNITUDE IS STATED IN THE LOAD'S OWN UNIT.
     *
     * The unit is a property of the load, not of the panel and not of the
     * drawing: the same stored value is written here as on the sheet, so
     * "5 kN/m" beside the member is "5 kN/m" in this field. The control
     * beside the number CHANGES THE UNIT WITHOUT CHANGING THE LOAD, because
     * kN/m and N/mm are the same quantity - see the loadUnit property.
     */
    const loadUnitValue = enggLoadProfile.loadUnit(geometry);

    /*
     * THE UNITS COME FROM THE SHARED TABLE, NOT FROM A LOCAL LIST.
     *
     * `unitsFor("distributedLoad")` is the ONE list of units a distributed
     * load may be stated in. The literal `["kN/m", "N/mm"]` this replaced
     * was a second list that could drift from the quantity's own units - so a
     * unit added to the table would not appear here, and a unit removed from
     * it would still be offered. Both lists are the same list now, and the
     * conversion that reads the stored number uses the same table.
     */
    const loadUnits =
        enggQuantities?.unitsFor?.("distributedLoad") || [
            "kN/m",
            "N/mm",
        ];

    const loadUnitOptions = unitSelectMarkup({
        property: "loadUnit",
        units: loadUnits,
        current: loadUnitValue,
        label: "Load unit",
    });

    rows.push(`
        <div class="drawing-property-grid drawing-property-grid-value${isMagnitudeUnknown ? " drawing-property-unknown" : ""}">
            <span class="drawing-property-grid-label">Magnitude</span>
            ${
                isMagnitudeUnknown
                    ? `<span class="drawing-property-readonly"></span>`
                    : `<input type="number" step="any"
                        data-property="magnitude"
                        aria-label="Magnitude"
                        value="${number(magnitudeValue)}">`
            }
            <span class="drawing-property-unit">
                ${loadUnitOptions}${knownBox("magnitude", "Magnitude")}</span>
            <span></span>
        </div>
    `);

    rows.push(section("FORCE"));
    rows.push(
        scalar(
            "Direction",
            "direction",
            enggLoadProfile.loadDirection(geometry),
            "°"
        )
    );
    rows.push(reverseDirectionMarkup());
    rows.push(
        scalar(
            "Interval",
            "interval",
            enggLoadProfile.loadInterval(geometry),
            "mm"
        )
    );

    return rows.join("");
}
