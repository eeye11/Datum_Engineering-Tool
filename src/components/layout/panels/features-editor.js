/*
 * ============================================================
 * THE FEATURES PANE - THE SELECTION'S OWN PROPERTIES
 * ============================================================
 *
 * Features answers one question: what can I change about what I have selected?
 * It is the universal editing panel, not a Geometry panel - the sections it
 * shows come from `feature-schema.js`, which describes every tool category, and
 * it renders whatever applies to the current selection and nothing else.
 *
 * THE THREE STATES, and there are only three:
 *
 *   nothing selected   the pane is EMPTY. No tool defaults, no instructions, no
 *                      disabled fields. Activating a tool does not select
 *                      anything, and an armed tool's settings are not an
 *                      object's properties.
 *
 *   one selected       that object's applicable properties, holding its actual
 *                      values.
 *
 *   several selected   the union of the properties that apply to at least one
 *                      of them. Each field is edited only on the selected
 *                      objects it applies to, and shows a MIXED state when
 *                      those objects disagree.
 *
 * HOW MIXED VALUES STAY SAFE.
 *
 * A mixed field is rendered WITHOUT a value of its own - an empty select, an
 * empty text box, a blank number, an indeterminate checkbox, a hatched colour
 * swatch. Nothing is written until the student deliberately sets the field, so
 * an untouched control cannot "confirm" one object's value as the others' and
 * cannot clear anything. Changing one field never touches another.
 *
 * THE PANE IS BUILT FROM FIELDS, NOT FROM ROWS. A row is a renderer for a field
 * kind; the field table decides what exists. That is why adding a category does
 * not add a form here.
 */

import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import {
    displayNameOf,
    fieldLabel,
    groupsFor,
    iconForObject,
    readField,
    setElbowRunLookup,
    setElbowRadiusApply,
    setFeatureObjectLookup,
    setFluidReconciler,
    reconcileFluidGeometry,
    supportsTransform,
    typeLabelOf,
    writeField
} from "./feature-schema.js";
import { reconcileFluidConnections } from "../../../features/workspace/interaction/pipe-duct-tool.js";
import { applyElbowRadius } from "../../../features/workspace/interaction/elbow-radius.js";

/*
 * THE ELBOW PANEL EDITS FIND THEIR PIPES THROUGH THE LIVE DOCUMENT.
 *
 * `feature-schema.js` declares fields and must not import the drawing state, so
 * the run lookup is injected ONE TIME here - the pane is the module that actually
 * edits fields, and it needs no cycle of its own to do it.
 */
setElbowRunLookup(
    (id) => (drawingState.objects || []).find((object) => object.id === id) || null
);

/*
 * AND THE SAME DOCUMENT ANSWERS A FLOW ARROW FOR ITS HOST.
 *
 * The Attached Pipe row states the NAME of the run an arrow lives on, and a
 * name is not an identity - the student may rename the pipe after placing the
 * arrow - so the row asks the live document rather than carrying a copy of the
 * name it was placed with.
 */
setFeatureObjectLookup(
    (id) => (drawingState.objects || []).find((object) => object.id === id) || null
);

/*
 * AND THE ONE OPERATION THAT APPLIES AN ABSOLUTE BEND RADIUS.
 *
 * The Features tab's Bend Radius field goes through the SAME function the
 * canvas radius handle calls, so the two cannot produce different geometry
 * for the same radius.
 */
setElbowRadiusApply((elbow, radius) =>
    applyElbowRadius(elbow, radius, { objects: drawingState.objects })
);

/*
 * AND THE RULE THAT SETTLES A PIPE'S JOINTS AFTER ANY FIELD EDIT.
 *
 * Typing a Pipe Width, moving a run, or changing a bend is an edit like any
 * other: the fittings involved are brought up to date by the SAME reconciler a
 * drag uses, so a typed change and a dragged one cannot leave the drawing in
 * different states.
 */
setFluidReconciler((run, other) => reconcileFluidConnections(run, other || drawingState.objects));
import { PIPE_WIDTH_STEP, TRANSFORM_STEP, applyTransform } from "./transform-session.js";
import { settingsFor } from "./tool-settings-store.js";
import { installToolSettingsPane, toolSettingsMarkup } from "./tool-settings-pane.js";
import { openColourPicker } from "../../../shared/ui/colour-picker.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { analysisEditorsFor, openAnalysisEditorForObject } from "../../../features/workspace/statics/analysis-editor.js";
import enggPressureProfile from "../../../features/workspace/model/fluids/pressure-profile.js";

let host = null;

function element(id) {
    return globalThis.document.getElementById(id);
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/* ============================================================
 * THE SELECTION
 * ============================================================ */

/*
 * The selected objects, in document order. A stale id - an object deleted while
 * its row was still selected - simply drops out, so the pane describes what is
 * really on the sheet.
 */
export function selectedObjects() {
    const ids = new Set(drawingState.selection?.selectedObjectIds || []);

    if (!ids.size || !Array.isArray(drawingState.objects)) {
        return [];
    }

    return drawingState.objects.filter((object) => ids.has(object.id));
}

/* ============================================================
 * MIXED VALUES
 * ============================================================ */

/*
 * The objects that support one field, and whether they agree about it.
 *
 * `value` is the shared value when they do, and `undefined` when they do not -
 * so a caller that forgets to check `mixed` gets "no value" rather than one
 * object's. That is the safe failure: the field renders empty instead of
 * showing something that is only true of one of them.
 */
function fieldState(objects, key) {
    const compatible = objects.filter((object) => readField(object, key) !== undefined);

    if (!compatible.length) {
        return null;
    }

    const values = compatible.map((object) => readField(object, key));
    const first = JSON.stringify(values[0]);
    const mixed = values.some((value) => JSON.stringify(value) !== first);

    return {
        compatible,
        mixed,
        value: mixed ? undefined : values[0]
    };
}

/* ============================================================
 * ROW MARKUP
 * ============================================================ */

function rowMarkup(label, control, { mixed = false } = {}) {
    return (
        `<div class="dfp-row">` +
        `<span class="dfp-row-label">${escapeHtml(label)}</span>` +
        `<span class="dfp-row-control${mixed ? " is-mixed" : ""}">${control}</span>` +
        `</div>`
    );
}

function choicesMarkup(key, label, options, state) {
    /*
     * A MIXED SELECT HAS NO SELECTED OPTION. It carries an empty first option,
     * so the closed control reads as "not all the same" rather than as whichever
     * option happened to be first in the list.
     */
    const optionsMarkup = options
        .map(
            (option) =>
                `<option value="${escapeHtml(option.value)}"${
                    !state.mixed && option.value === state.value ? " selected" : ""
                }>${escapeHtml(option.label)}</option>`
        )
        .join("");

    return (
        `<select class="dfp-select" data-feature-field="${escapeHtml(key)}" aria-label="${escapeHtml(label)}"` +
        (state.mixed ? ' data-mixed="true"' : "") +
        `>` +
        (state.mixed ? `<option value="" selected disabled>\u2014 Mixed \u2014</option>` : "") +
        optionsMarkup +
        `</select>`
    );
}

/*
 * A SEGMENTED CONTROL for a handful of short choices. The buttons are what the
 * pointer uses; the group's `radiogroup` role and `aria-checked` are what a
 * screen reader reads. Mixed means NO segment is pressed - the same statement
 * the empty option makes above.
 */
function segmentedMarkup(key, label, options, state) {
    const segments = options
        .map(
            (option) =>
                `<button type="button" class="dfp-seg" role="radio" data-feature-choice="${escapeHtml(key)}" ` +
                `data-value="${escapeHtml(option.value)}" aria-label="${escapeHtml(option.label)}" ` +
                `aria-checked="${!state.mixed && option.value === state.value ? "true" : "false"}" ` +
                `tabindex="${!state.mixed && option.value === state.value ? "0" : "-1"}">` +
                `${escapeHtml(option.label)}</button>`
        )
        .join("");

    return (
        `<span class="dfp-segmented" role="radiogroup" aria-label="${escapeHtml(label)}"` +
        (state.mixed ? ' data-mixed="true"' : "") +
        `>${segments}</span>`
    );
}

/*
 * ============================================================
 * A COLOUR PROPERTY
 * ============================================================
 *
 * THE SWATCH IS THE TOOLBAR'S SWATCH. It is a button that opens THE shared
 * picker (`shared/ui/colour-picker.js`) - the same popup, the same hue-by-shade
 * grid, the same custom input, the same recent colours the top toolbar's drawing
 * colour uses. There is one picker in the application, so a student who has
 * chosen a colour once has chosen it everywhere.
 *
 * THE NATIVE INPUT IS NOT USED HERE, and that is the point of the change: the
 * browser's own colour dialog is a different picker with different colours in
 * it, so a swatch that opened one gave the student two unrelated ways to choose a
 * colour in the same application.
 *
 * A MIXED SELECTION SHOWS A MIXED SWATCH. It cannot show any one object's
 * colour - that would claim the colour described them all - and it cannot be
 * blank, which would read as "no colour". The picker still opens from it, so
 * choosing here is how the selection is brought back to one colour.
 */
function colourMarkup(key, label, state) {
    const shown = state.mixed ? "#808080" : state.value;
    const text = state.mixed ? "Mixed" : String(state.value).toUpperCase();

    return (
        `<button type="button" class="dfp-colour${state.mixed ? " is-mixed" : ""}" ` +
        `data-feature-colour="${escapeHtml(key)}" data-value="${escapeHtml(shown)}" ` +
        `title="${escapeHtml(label)}" ` +
        `aria-label="${escapeHtml(label)}${state.mixed ? " (mixed)" : `: ${escapeHtml(text)}`}"` +
        (state.mixed ? ' data-mixed="true"' : "") +
        `>` +
        `<span class="dfp-colour-chip" aria-hidden="true"></span>` +
        `<span class="dfp-colour-text">${escapeHtml(text)}</span>` +
        `</button>`
    );
}

function toggleMarkup(key, label, state) {
    /*
     * MIXED IS INDETERMINATE, not "off". `indeterminate` is the platform's own
     * third state and is what a mixed checkbox is for; it is set from script
     * because HTML cannot declare it, so the row is marked here and set after
     * the pane is built.
     */
    return (
        `<label class="dfp-toggle">` +
        `<input type="checkbox" class="dfp-checkbox" data-feature-field="${escapeHtml(key)}" aria-label="${escapeHtml(label)}"` +
        (!state.mixed && state.value ? " checked" : "") +
        (state.mixed ? ' data-mixed="true"' : "") +
        `>` +
        `</label>`
    );
}

function numberMarkup(key, definition, label, state) {
    const bounds = [
        Number.isFinite(definition.min) ? `min="${definition.min}"` : "",
        Number.isFinite(definition.max) ? `max="${definition.max}"` : "",
        `step="${definition.integer ? 1 : definition.step ?? 1}"`
    ]
        .filter(Boolean)
        .join(" ");

    /*
     * AN EMPTY FIELD IS A MIXED FIELD. It is not a zero: `writeField` refuses a
     * non-numeric value, so leaving it alone leaves every object's own count in
     * place, and typing a number sets them all.
     */
    const value = state.mixed ? "" : String(state.value ?? "");

    return (
        `<input type="number" class="dfp-number" data-feature-field="${escapeHtml(key)}" ` +
        `aria-label="${escapeHtml(label)}" ${bounds} ` +
        `value="${escapeHtml(value)}"` +
        (state.mixed ? ' data-mixed="true" placeholder="Mixed"' : "") +
        `>` +
        (definition.unit ? `<span class="dfp-unit">${escapeHtml(definition.unit)}</span>` : "")
    );
}

function textMarkup(key, label, state, definition = {}) {
    /*
     * A READ-ONLY TEXT ROW STATES A FACT, IT DOES NOT OFFER A CONTROL.
     *
     * The Flow Arrow's Attached Pipe is the host it lives on. It is chosen by
     * pressing on a pipe, so there is nothing to type here - a typed name would
     * have to be resolved back to some pipe, and the wrong guess would silently
     * move the arrow. So the field is rendered as the value it is, marked
     * readOnly, with no edit path that could disagree with the drawing.
     */
    const readOnly = definition.readOnly === true;

    return (
        `<input type="text" class="dfp-text${readOnly ? " is-readonly" : ""}" data-feature-field="${escapeHtml(key)}" ` +
        `aria-label="${escapeHtml(label)}" ` +
        `value="${escapeHtml(state.mixed ? "" : state.value ?? "")}"` +
        (readOnly ? ` readonly aria-readonly="true" tabindex="-1"` : "") +
        (state.mixed ? ' data-mixed="true" placeholder="Mixed"' : definition.placeholder ? ` placeholder="${escapeHtml(definition.placeholder)}"` : "") +
        ` autocomplete="off" spellcheck="false">`
    );
}

function fieldMarkup(key, definition, objects) {
    const state = fieldState(objects, key);

    if (!state) {
        return "";
    }

    const label = fieldLabel(definition, key);
    const options = { mixed: state.mixed };

    if (definition.kind === "toggle") {
        return rowMarkup(label, toggleMarkup(key, label, state), options);
    }

    if (definition.kind === "colour") {
        return rowMarkup(label, colourMarkup(key, label, state), options);
    }

    if (definition.kind === "segmented") {
        return rowMarkup(label, segmentedMarkup(key, label, definition.options || [], state), options);
    }

    if (definition.kind === "choice") {
        /*
         * THE OPTIONS MAY DEPEND ON THE OBJECT. Most choices are a fixed list;
         * a Flow Profile's unit rows are the units of the QUANTITY that profile
         * plots, so the definition supplies a function of the object and the
         * same field can offer m³/s on one profile and kg/s on another.
         */
        const list = typeof definition.options === "function"
            ? definition.options(objects[0])
            : definition.options || [];

        return rowMarkup(label, choicesMarkup(key, label, list, state), options);
    }

    if (definition.kind === "number") {
        return rowMarkup(label, numberMarkup(key, definition, label, state), options);
    }

    if (definition.kind === "text") {
        return rowMarkup(label, textMarkup(key, label, state, definition), options);
    }

    return "";
}

/* ============================================================
 * TRANSFORM ROWS
 * ============================================================
 *
 * Three rows, one shape each: a label, a numeric box, and a pair of nudge
 * buttons. The box holds the RELATIVE amount applied since the section was
 * opened - not the object's position - so it starts at zero, every click and
 * every typed value is applied to the drawing immediately, and leaving the
 * section clears it.
 */

function transformRowMarkup(axis, label) {
    /*
     * PIPE WIDTH HAS ITS OWN INCREMENT. It is a distance between two walls, not
     * a coordinate nudge, so one click moves it by a whole pipe width rather
     * than by a tenth of a unit. The box still starts at zero, and a typed
     * value is still applied exactly as given.
     */
    const step = axis === "width" ? PIPE_WIDTH_STEP : TRANSFORM_STEP;

    return (
        `<div class="dfp-row dfp-transform-row">` +
        `<span class="dfp-row-label">${escapeHtml(label)}</span>` +
        `<span class="dfp-row-control">` +
        `<input type="number" class="dfp-number dfp-transform-input" data-transform-input="${axis}" ` +
        `aria-label="${escapeHtml(label)}" step="${step}" value="${transformOffsetFor(axis)}">` +
        `<span class="dfp-steppers">` +
        `<button type="button" class="dfp-step" data-transform-step="${axis}" data-direction="1" aria-label="Increase ${escapeHtml(label)} by ${step}">` +
        stepIcon("up") +
        `</button>` +
        `<button type="button" class="dfp-step" data-transform-step="${axis}" data-direction="-1" aria-label="Decrease ${escapeHtml(label)} by ${step}">` +
        stepIcon("down") +
        `</button>` +
        `</span>` +
        `</div>`
    );
}

/*
 * ============================================================
 * THE PRESSURE PROFILE'S DATA TABLE
 * ============================================================
 *
 * The graph's numbers are the STUDENT'S, so they are edited as a table of rows:
 * a station and a pressure per row, an Add Point button and a Remove button on
 * every row. Each edit writes the same `engineering.points` the renderer plots
 * from and the source writer emits - so the table, the plotted points and the
 * TikZ are one fact, not three copies.
 *
 * The table is built here rather than as a schema field because it is a LIST, and
 * a list has no single value a generic row could show. Everything else about the
 * profile stays in the schema like every other property.
 */
function profileDataMarkup(object) {
    const rows = Array.isArray(object?.engineering?.points) ? object.engineering.points : [];

    const axes = enggPressureProfile.axesOf(object);

    const body = rows
        .map(
            (row, index) =>
                `<div class="dfp-row dfp-data-row" data-profile-row="${index}">` +
                `<input type="number" class="dfp-number" data-profile-cell="position" data-profile-index="${index}" ` +
                `aria-label="Point ${index + 1} station" value="${Number(row.position)}">` +
                `<input type="number" class="dfp-number" data-profile-cell="pressure" data-profile-index="${index}" ` +
                `aria-label="Point ${index + 1} pressure" value="${Number(row.pressure)}">` +
                `<button type="button" class="dfp-button" data-profile-remove="${index}" ` +
                `aria-label="Remove point ${index + 1}">Remove</button>` +
                `</div>`
        )
        .join("");

    /*
     * THE UNITS ARE STATED ONCE, in the column headings - from the same Axes
     * fields the student can edit - so a number in the table is never bare.
     */
    const heading =
        `<div class="dfp-row dfp-data-heading">` +
        `<span class="dfp-row-label">${escapeHtml(axes.xTitle)} (${escapeHtml(axes.xUnit)})</span>` +
        `<span class="dfp-row-label">${escapeHtml(axes.yTitle)} (${escapeHtml(axes.yUnit)})</span>` +
        `</div>`;

    return (
        `<div class="dfp-section" data-feature-group="profile-data">` +
        `<div class="dfp-section-heading">Data</div>` +
        heading +
        body +
        `<div class="dfp-row">` +
        `<span class="dfp-row-label">${rows.length} point${rows.length === 1 ? "" : "s"}</span>` +
        `<button type="button" class="dfp-button" data-profile-add="true">Add Point</button>` +
        `</div>` +
        `</div>`
    );
}

function stepIcon(direction) {    const path = direction === "up" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4";

    return (
        `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">` +
        `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
        `</svg>`
    );
}

/* ============================================================
 * THE PANE
 * ============================================================ */

function headerMarkup(objects) {
    if (objects.length > 1) {
        return (
            `<div class="dfp-header">` +
            `<span class="dfp-header-icon dfp-header-icon-count" aria-hidden="true">${objects.length}</span>` +
            `<span class="dfp-header-text">` +
            `<span class="dfp-header-type">Selection</span>` +
            `<span class="dfp-header-name">${objects.length} objects</span>` +
            `</span>` +
            `</div>`
        );
    }

    const object = objects[0];
    const name = displayNameOf(object);
    const type = typeLabelOf(object);

    return (
        `<div class="dfp-header">` +
        `<span class="dfp-header-icon">${iconForObject(object)}</span>` +
        `<span class="dfp-header-text">` +
        `<span class="dfp-header-type">${escapeHtml(type)}</span>` +
        `<span class="dfp-header-name">${escapeHtml(name)}</span>` +
        `</span>` +
        `</div>`
    );
}

/*
 * The pane's markup for the current selection, or "" when there is nothing
 * selected. Exported so a test can assert the content without a DOM event.
 *
 * SECTIONS ARE THE UNION ACROSS THE SELECTION, in the schema's own order. A
 * field is included when ANY selected object supports it, and a heading appears
 * only when at least one of its rows does - so no empty section is ever drawn,
 * and a Geometry field cannot appear for a selection of forces.
 */
export function featuresMarkupForSelection(objects = selectedObjects()) {
    if (!objects.length) {
        return "";
    }

    const order = [];
    const sections = new Map();

    objects.forEach((object) => {
        groupsFor(object).forEach((group) => {
            if (group.transform) {
                return;
            }

            if (!sections.has(group.id)) {
                sections.set(group.id, {
                    group,
                    fields: new Map()
                });

                order.push(group.id);
            }

            const entry = sections.get(group.id);

            group.fields.forEach((field) => {
                if (!entry.fields.has(field.key)) {
                    entry.fields.set(field.key, field.definition);
                }
            });
        });
    });

    const markup = [];

    order.forEach((id) => {
        const { group, fields } = sections.get(id);
        const rows = [...fields.entries()]
            .map(([key, definition]) => fieldMarkup(key, definition, objects))
            .join("");

        if (!rows) {
            return;
        }

        markup.push(
            group.plainHeading
                ? `<div class="dfp-section dfp-section-bare" data-feature-group="${escapeHtml(id)}">${rows}</div>`
                : `<div class="dfp-section" data-feature-group="${escapeHtml(id)}">` +
                      `<div class="dfp-section-heading">${escapeHtml(group.heading)}</div>` +
                      rows +
                      `</div>`
        );
    });

    /*
     * TRANSFORM IS OFFERED WHEN SOMETHING CAN MOVE. A selection of only fixed
     * objects keeps its Transform rows - so the student can see why nothing
     * moves, and the arrows say so by doing nothing - but a selection of objects
     * the model cannot move at all does not get a Transform section that could
     * never act.
     */
    if (objects.some((object) => supportsTransform(object))) {
        const hasElbow = objects.some((object) => object.type === "elbow");

        markup.push(
            `<div class="dfp-section" data-feature-group="transform">` +
                `<div class="dfp-section-heading">Transform</div>` +
                transformRowMarkup("x", "X Shift") +
                transformRowMarkup("y", "Y Shift") +
                /*
                 * ROTATE IS NOT AN ELBOW'S CONTROL. The specification defines
                 * exactly four Transform parameters for it, and a fitting's
                 * orientation is decided by the pipes it joins, so the rotation
                 * row is omitted for an elbow-only selection.
                 */
                (objects.every((object) => object.type === "elbow" || (object.type === "reducer-expander" && (object.engineering?.startPipeId || object.engineering?.endPipeId)))
                    ? ""
                    : transformRowMarkup("rotate", "Rotate")) +
                /*
                 * PIPE WIDTH IS A RELATIVE ADJUSTMENT, like the three above - so
                 * it is a Transform row, not a measured field. It appears only
                 * when a run is selected, and `applyTransform` refuses the axis
                 * for anything else, so a stale click cannot alter a line.
                 */
                (objects.some((object) => object.type === "pipe-duct")
                    ? transformRowMarkup("width", "Pipe Width")
                    : "") +
                /*
                 * THE ELBOW'S OWN PARAMETER: BEND RADIUS.
                 *
                 * It is a relative adjustment and uses the same row shape as
                 * X Shift. There is NO Bend Angle row: the angle is the direction
                 * change the fitting's pipes make, so it is derived on every
                 * settle rather than typed.
                 */
                (hasElbow
                    ? transformRowMarkup("bendRadius", "Bend Radius")
                    : "") +
                `</div>`
        );
    }

    /*
     * THE ANALYSIS EDITORS, IN THE FEATURES TAB.
     *
     * An SFD, BMD or AFD is not only a set of properties: it is a diagram, and
     * the two ways of producing one - drawing it by hand or typing its equation
     * - are the EXISTING Sketch Editor and Plot Editor (`shared/ui/editors/`).
     * They were reachable only from the placement commit, so a diagram saved,
     * reopened or deselected could not be edited again without re-creating it.
     *
     * The buttons live here rather than on a toolbar because this tab already
     * answers "what can I change about what I have selected?" - and they are
     * shown only for a diagram, because the editors edit a diagram's own sketch
     * or plot and nothing else's. Each one opens the SAME editor the commit
     * opens, with the same callbacks, so there is no second editing path to
     * keep in step.
     */
    const editors = analysisEditorsMarkup(objects);

    if (editors) {
        markup.push(editors);
    }

    /*
     * THE PRESSURE PROFILE'S DATA TABLE, after its properties.
     *
     * A single selected profile is the only case: a table belongs to ONE graph,
     * and a row that silently picked the first of three would edit something the
     * student did not choose.
     */
    if (objects.length === 1 && enggPressureProfile.isPressureProfileType(objects[0].type)) {
        /* Put the table between the Object section and Axes, as the requirement
         * orders them: Object, Data, Axes, Appearance, Transform. */
        const at = markup.findIndex((section) => section.includes('data-feature-group="profile-axes"'));

        const data = profileDataMarkup(objects[0]);

        if (at >= 0) {
            markup.splice(at, 0, data);
        } else {
            markup.push(data);
        }
    }

    return headerMarkup(objects) + markup.join("");
}

/*
 * The Sketch Editor and Plot Editor rows for a single selected diagram.
 *
 * A multi-selection has no single sketch to open, so no editors are offered for
 * one - an editor that silently picked the first object of three would edit
 * something the student did not choose.
 */
function analysisEditorsMarkup(objects) {
    if (objects.length !== 1) {
        return "";
    }

    const object = objects[0];
    const editors = analysisEditorsFor(object);

    if (!editors.length) {
        return "";
    }

    const rows = editors
        .map(
            (editor) =>
                `<div class="dfp-row" data-analysis-editor-row="${escapeHtml(editor.id)}">` +
                `<span class="dfp-row-label">${escapeHtml(editor.label)}</span>` +
                `<span class="dfp-row-control">` +
                `<button type="button" class="dfp-button" ` +
                `data-analysis-editor="${escapeHtml(editor.id)}" ` +
                `data-object-id="${escapeHtml(object.id)}">` +
                `${escapeHtml(editor.button)}</button>` +
                `</span>` +
                `</div>`
        )
        .join("");

    return (
        `<div class="dfp-section" data-feature-group="analysis-editors">` +
        `<div class="dfp-section-heading">Diagram Editors</div>` +
        rows +
        `</div>`
    );
}

/*
 * THE FEATURES TAB HAS TWO CONTEXTS, AND ONE RENDER DECIDES BETWEEN THEM.
 *
 *   something selected   the selection's own properties.
 *   nothing selected     the ACTIVE TOOL's construction settings.
 *
 * Both are rendered here, so there is one place that knows what Features is
 * showing and no second panel can disagree with it. The tool's settings come
 * from the tool's own declaration through the shared store, so they remain
 * DEFAULTS: changing one affects what the tool creates NEXT and never an
 * object already on the sheet.
 *
 * A tool that is not one of the Geometry tools - Select, Pan, the annotate and
 * statics tools - declares no settings, and the pane is empty for it. That is
 * the honest answer: there is nothing there to configure.
 */
export function renderFeatures() {
    host = host || element("drawingFeatures") || element("drawingPanelFeatures");

    if (!host) {
        return;
    }

    const objects = selectedObjects();

    host.dataset.selectionCount = String(objects.length);
    host.hidden = false;

    if (objects.length) {
        host.dataset.featuresContext = "selection";
        host.innerHTML = featuresMarkupForSelection(objects);
        applyIndeterminate(host);

        return;
    }

    const toolId = drawingState.activeTool;
    const settings = toolId ? settingsFor(toolId) : null;
    const markup = settings ? toolSettingsMarkup(toolId, settings) : "";

    host.dataset.featuresContext = markup ? "tool" : "none";
    host.innerHTML = markup;
    applyIndeterminate(host);
}

/*
 * A NEW SELECTION IS A NEW ADJUSTMENT.
 *
 * The transform offsets belong to the objects they were applied to, so choosing
 * something else - or choosing nothing - starts them at zero again. Without this
 * the box would carry one object's total onto the next, which is a number that
 * describes nothing on the sheet.
 */
export function resetTransformForSelection() {
    transformOffsets = { x: 0, y: 0, rotate: 0, width: 0 };
    transformOffsetsFor = transformSelectionKey();
}

/*
 * The platform's third checkbox state cannot be written in markup, so it is set
 * on the element itself after the pane is built - as is each swatch's colour,
 * which has to be painted from its own `data-value`.
 */
function applyIndeterminate(root) {
    if (!root) {
        return;
    }

    [...root.querySelectorAll('input[type="checkbox"][data-mixed="true"]')].forEach((input) => {
        input.indeterminate = true;
    });

    [...root.querySelectorAll("[data-feature-colour]")].forEach((swatch) => {
        swatch.style.setProperty("--dfp-colour", swatch.dataset.value || "#808080");
    });
}

/* ============================================================
 * WRITING AN EDIT BACK TO THE MODEL
 * ============================================================ */

/*
 * ONE EDIT TO A PRESSURE PROFILE'S DATA.
 *
 * Snapshotted, applied and committed once - so a row added, a cell changed or a
 * point removed is one entry in History, and Undo puts the table, the plotted
 * line and the source back together. The canvas is redrawn and the pane rebuilt
 * from the model afterwards, so no control keeps a value the model refused.
 */
function commitProfileData(apply) {
    const object = selectedObjects().find((candidate) => enggPressureProfile.isPressureProfileType(candidate.type));

    if (!object || object.locked === true) {
        return false;
    }

    const previous = enggDrawingState.snapshotDrawing(drawingState);

    if (!apply(object)) {
        return false;
    }

    enggDrawingState.commitDrawingChange(drawingState, previous);

    renderCurrentDrawing();
    refreshFeatures();

    return true;
}

/*
 * Apply one field to every selected object it applies to. The selection is read
 * fresh here, so an edit always lands on what is selected now.
 */
function commitField(key, value) {
    const objects = selectedObjects();
    const applicable = objects.filter((object) => readField(object, key) !== undefined);

    if (!applicable.length) {
        return false;
    }

    const previous = enggDrawingState.snapshotDrawing(drawingState);

    let changed = 0;

    applicable.forEach((object) => {
        if (writeField(object, key, value)) {
            changed += 1;
        }
    });

    if (!changed) {
        return false;
    }

    /*
     * THE SELECTION'S PIPEWORK IS SETTLED BEFORE THE CHANGE IS COMMITTED, so the
     * undo entry holds the whole edit - the value typed AND the connections it
     * moved - as one step.
     */
    reconcileFluidGeometry(applicable);

    enggDrawingState.commitDrawingChange(drawingState, previous);
    renderCurrentDrawing();

    return true;
}

/*
 * Re-render and put focus back on the field the student was using. A change can
 * make another row appear or disappear - Solid adds a fill colour, Custom adds a
 * width box - so the pane genuinely has to be rebuilt; the focus restoration is
 * what keeps that from feeling like the control was taken away.
 */
function refreshFeatures() {
    const active = globalThis.document.activeElement;
    const key = active?.dataset?.featureField;
    const isTransform = Boolean(active?.dataset?.transformInput);
    const choice = active?.dataset?.featureChoice;

    renderFeatures();

    if (!host) {
        return;
    }

    if (key) {
        host.querySelector(`[data-feature-field="${key}"]`)?.focus?.();
    }

    if (choice) {
        host.querySelector(`[data-feature-choice="${choice}"][aria-checked="true"]`)?.focus?.();
    }

    if (isTransform) {
        host.querySelector("[data-transform-input]")?.focus?.();
    }
}

/*
 * OPEN THE SHARED PICKER FROM A FEATURE'S COLOUR SWATCH.
 *
 * The swatch carries the colour to start from - the object's own, or the neutral
 * grey a mixed selection shows - and the picker reports the choice back through
 * `commitField`, which writes it to every selected object the field applies to.
 *
 * NO EYEDROPPER HERE. It samples a feature's stroke from the canvas, which is the
 * toolbar's drawing colour; a Features field is already describing the selection,
 * so offering it would be a second, confusing way to set the same value.
 *
 * A MIXED SELECTION IS NOT CHANGED BY OPENING THE PICKER. Nothing is written
 * until a colour is actually chosen, so a mixed field stays mixed - which is the
 * whole guarantee the mixed state exists to give.
 */
function openFeatureColourPicker(swatch) {
    const key = swatch.dataset.featureColour;

    if (!key) {
        return;
    }

    openColourPicker({
        anchor: swatch,
        value: swatch.dataset.value,
        onChoose: (colour) => {
            if (commitField(key, colour)) {
                refreshFeatures();
            }
        }
    });
}

function applySegmentedChoice(button) {
    const key = button?.dataset?.featureChoice;

    if (!key) {
        return;
    }

    /*
     * A SEGMENT IS A VALUE, AND THE SCHEMA WRITES IT - including the one choice
     * that is a MODE rather than a width (Custom thickness), which the schema
     * records on the object itself. The pane only has to repaint, because the
     * choice may reveal or hide a follow-on row.
     */
    if (commitField(key, button.dataset.value)) {
        refreshFeatures();
    }
}

/* ============================================================
 * TRANSFORM CONTROLS
 * ============================================================
 *
 * THE RUNNING TOTAL LIVES HERE, NOT IN THE INPUT.
 *
 * The offsets are a temporary adjustment, and the box shows what the arrows have
 * done since the section was opened. A transform redraws the canvas, and a redraw
 * re-renders this pane - so an offset held only in the input element would be
 * wiped back to zero by the very action that recorded it, and the student would
 * see the number reset while the object kept moving.
 *
 * So the three values are held against the selection they were applied to, and
 * cleared the moment that selection changes. Leaving the section and coming back
 * therefore finds them at zero again, which is the behaviour the specification
 * asks for - and it is expressed here, once, rather than by any one control
 * trying to remember.
 */
let transformOffsets = { x: 0, y: 0, rotate: 0, width: 0 };
let transformOffsetsFor = "";

function transformSelectionKey() {
    return (drawingState.selection?.selectedObjectIds || []).join("|");
}

function resetTransformOffsets() {
    transformOffsets = { x: 0, y: 0, rotate: 0, width: 0 };
    transformOffsetsFor = transformSelectionKey();
}

function transformOffsetFor(axis) {
    /*
     * The key is adopted on first use rather than forced, so READING an offset
     * never clears the others. A reset belongs to a new selection, not to a
     * render - and a render happens on every redraw.
     */
    if (!transformOffsetsFor) {
        transformOffsetsFor = transformSelectionKey();
    }

    if (transformOffsetsFor !== transformSelectionKey()) {
        resetTransformOffsets();
    }

    return transformOffsets[axis] || 0;
}

/*
 * One arrow click: apply exactly one step, then show the running total in the
 * box WITHOUT applying it again. The drawing is already where the number says it
 * is; the box is a record of what the arrows have done since the section opened.
 */
function stepTransformValue(button) {
    const axis = button?.dataset?.transformStep;
    const direction = Number(button?.dataset?.direction) || 0;
    const step = axis === "width" ? PIPE_WIDTH_STEP : TRANSFORM_STEP;

    if (!axis || !direction) {
        return;
    }

    /*
     * THE OFFSET IS RECORDED BEFORE THE MOVE, NOT AFTER.
     *
     * `applyTransform` redraws the canvas, and the redraw re-renders this pane -
     * so by the time it returns, the pane has already been rebuilt from whatever
     * the recorded offset was a moment ago. Recording first means the rebuild
     * reads the new total and the box shows what the arrows have really done.
     */
    transformOffsets[axis] =
        Math.round((transformOffsetFor(axis) + direction * step) * 1e9) / 1e9;

    if (!applyTransform(axis, direction * step)) {
        /* The move was refused, so the total did not move either. */
        transformOffsets[axis] = Math.round((transformOffsets[axis] - direction * step) * 1e9) / 1e9;

        return;
    }

    const input = host?.querySelector(`[data-transform-input="${axis}"]`);

    if (input) {
        input.value = String(transformOffsets[axis]);
    }
}

/*
 * A typed value is a relative amount, applied once. The field is then cleared:
 * it has been consumed, and leaving the number there would suggest the object is
 * being held at that offset.
 */
function commitTransformInput(input) {
    const axis = input?.dataset?.transformInput;

    if (!axis) {
        return;
    }

    const amount = Number(input.value);

    if (!Number.isFinite(amount) || amount === 0) {
        input.value = "0";

        return;
    }

    /*
     * A TYPED VALUE IS CONSUMED, NOT ACCUMULATED, AND THE BOX IS CLEARED.
     *
     * The arrows leave a running total behind because a student nudging an object
     * wants to see how far they have nudged it. A typed amount is a different
     * thing: it is applied once, and leaving it on screen would suggest the object
     * is being HELD at that offset.
     */
    transformOffsets[axis] =
        Math.round((transformOffsetFor(axis) + amount) * 1e9) / 1e9;

    if (!applyTransform(axis, amount)) {
        transformOffsets[axis] = Math.round((transformOffsets[axis] - amount) * 1e9) / 1e9;
        input.value = "0";

        return;
    }

    input.value = "0";

    /*
     * THE THREE TRANSFORM ROWS ARE ONE CONTROL, so the other two are cleared with
     * it - a box showing an X total beside a typed Y would describe two moments
     * at once.
     */
    resetTransformForSelection();

    host?.querySelectorAll("[data-transform-input]").forEach((field) => {
        field.value = "0";
    });
}

/* ============================================================
 * INSTALL
 * ============================================================ */

/*
 * The pane is wired once, at start-up. Changes are handled on the pane itself, so
 * they work however the markup is re-rendered, and the three announcements -
 * selection, drawing, tab - tell it when the content it describes has changed.
 */
export function installFeaturesPane() {
    host = host || element("drawingFeatures") || element("drawingPanelFeatures");

    if (!host) {
        return;
    }

    host.addEventListener("click", (event) => {
        const editorButton = event.target.closest?.("[data-analysis-editor]");

        if (editorButton) {
            openAnalysisEditorForObject(editorButton.dataset.objectId, editorButton.dataset.analysisEditor);

            return;
        }

        const swatch = event.target.closest?.("[data-feature-colour]");

        if (swatch) {
            openFeatureColourPicker(swatch);

            return;
        }

        const choice = event.target.closest?.("[data-feature-choice]");

        if (choice) {
            applySegmentedChoice(choice);

            return;
        }

        const step = event.target.closest?.("[data-transform-step]");

        if (step) {
            stepTransformValue(step);

            return;
        }

        /*
         * THE PRESSURE PROFILE'S DATA ROWS.
         *
         * Add and Remove are ONE edit each - snapshotted, applied and committed
         * once - so Undo steps a point at a time and the table, the graph and the
         * source all change together.
         */
        const addPoint = event.target.closest?.("[data-profile-add]");

        if (addPoint) {
            commitProfileData((profile) => enggPressureProfile.addPoint(profile));

            return;
        }

        const removePoint = event.target.closest?.("[data-profile-remove]");

        if (removePoint) {
            const index = Number(removePoint.dataset.profileRemove);

            commitProfileData((profile) => enggPressureProfile.removePoint(profile, index));
        }
    });

    /*
     * A TYPED CELL IS COMMITTED ON CHANGE, like every other field in the pane -
     * and the graph redraws with the new number at once, because both read the
     * same `engineering.points`.
     */
    host.addEventListener("change", (event) => {
        const cell = event.target.closest?.("[data-profile-cell]");

        if (cell) {
            const index = Number(cell.dataset.profileIndex);
            const key = cell.dataset.profileCell;
            const value = Number(cell.value);

            if (Number.isFinite(value)) {
                commitProfileData((profile) =>
                    enggPressureProfile.setPoint(profile, index, { [key]: value })
                );
            } else {
                refreshFeatures();
            }
        }
    });

    host.addEventListener("change", (event) => {
        const target = event.target;

        if (target.matches?.("[data-transform-input]") || target.matches?.("[data-transform-value]")) {
            commitTransformInput(target);

            return;
        }

        if (!target.matches?.("[data-feature-field]")) {
            return;
        }

        const key = target.dataset.featureField;

        /*
         * CUSTOM THICKNESS FROM THE DROPDOWN is the same mode choice as the
         * segmented one. It is handled before the generic write because its
         * value must be committed AS the word "custom" - the schema needs it to
         * know a mode is being asked for, not a width.
         */
        if (key === "lineWidth" && target.value === "custom") {
            commitField(key, "custom");
            refreshFeatures();

            return;
        }

        let value;

        if (target.type === "checkbox") {
            value = target.checked;
        } else if (target.type === "number") {
            /*
             * AN EMPTIED NUMBER FIELD IS NOT A ZERO. It is the field being
             * cleared, or the mixed placeholder being displayed, and either way
             * there is no new value to apply.
             */
            if (target.value === "") {
                return;
            }

            value = Number(target.value);
        } else {
            value = target.value;
        }

        /*
         * A REFUSED EDIT IS PUT BACK TO WHAT THE OBJECTS ACTUALLY SAY. The
         * control would otherwise show a value the model never accepted, and the
         * panel would be lying about the drawing.
         */
        if (!commitField(key, value)) {
            refreshFeatures();

            return;
        }

        /*
         * A CHANGE CAN MAKE ANOTHER ROW APPEAR OR DISAPPEAR - Solid adds a fill
         * colour, Custom adds a width box - so the pane is rebuilt, with focus
         * put back on the field the student was using.
         *
         * COLOURS ARE NOT HANDLED HERE. A colour is chosen in the shared picker
         * and committed through its own callback, which is the one path a colour
         * ever takes - so there is no second route for it to disagree with.
         */
        refreshFeatures();
    });

    /*
     * A TRANSFORM VALUE IS ALSO COMMITTED ON ENTER. `change` fires on blur, and a
     * student who types an amount and presses Enter expects it to apply there
     * and then, not when they click elsewhere.
     */
    host.addEventListener("keydown", (event) => {
        const input = event.target;

        if (event.key === "Enter" && input.matches?.("[data-transform-input]")) {
            event.preventDefault();
            commitTransformInput(input);
        }
    });

    /*
     * LEAVING THE SECTION RESETS THE BOX, AND ONLY THE BOX. The offsets are a
     * temporary adjustment, so returning to Transform finds them at zero again -
     * but the transformations themselves are already in the drawing and in the
     * history, so nothing is undone and no previously entered value returns.
     *
     * THE RECORDED TOTAL IS CLEARED WITH IT. The input is only the face of the
     * number: leaving the offsets behind while the box showed zero would mean the
     * next arrow appeared to start from zero and actually continued from the old
     * total, which is the one thing a running adjustment must never do.
     *
     * IT FIRES WHENEVER FOCUS LEAVES THE SECTION, including when the host itself
     * is the element losing focus - a focusout from the transform row that does
     * not land anywhere else in the pane is the student moving on, which is the
     * moment the offsets are meant to be forgotten.
     */
    host.addEventListener("focusout", (event) => {
        const leftThePane = !event.relatedTarget || !host.contains(event.relatedTarget);
        const fromTransform = event.target.closest?.("[data-transform-input]") || event.target === host;

        if (!leftThePane || !fromTransform) {
            return;
        }

        resetTransformForSelection();

        host.querySelectorAll("[data-transform-input]").forEach((input) => {
            input.value = "0";
        });
    });

    /*
     * THE TOOL-SETTINGS ROWS ARE WIRED ON THE SAME HOST. They are drawn by the
     * same render into the same element, so their controls are found here by
     * their own `data-tool-setting*` hooks and write through the ONE store.
     */
    installToolSettingsPane(host, () => {
        renderFeatures();
        renderCurrentDrawing();
    });

    globalThis.document.addEventListener("datum:selection-changed", () => {
        editorState.selectedPlantNode = null;
        resetTransformForSelection();
        renderFeatures();
    });
    globalThis.document.addEventListener("datum:drawing-changed", renderFeatures);

    /*
     * A DEFAULT CHANGED. The pane is showing the active tool's settings when
     * nothing is selected, and a change can reveal a follow-on row (a Fill
     * colour for Solid), so it is rebuilt. Nothing is written to an object.
     */
    globalThis.document.addEventListener("datum:tool-setting-changed", () => {
        if (!selectedObjects().length) {
            renderFeatures();
        }
    });
    globalThis.document.addEventListener("datum:panel-tab-changed", (event) => {
        if (event?.detail?.tab === "features") {
            renderFeatures();
        }
    });

    renderFeatures();
}

export default {
    renderFeatures,
    installFeaturesPane,
    featuresMarkupForSelection,
    selectedObjects,
    resetTransformForSelection
};
