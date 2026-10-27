/*
 * What a click on the canvas does.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggNoteEditor from "../../../shared/ui/editors/note-editor.js";
import enggAnnotate from "../model/annotations/annotate-model.js";
import enggAnnotationModel from "../model/annotations/annotation-model.js";
import { handleAnnotateClick, isAnnotateTool, isEditableAnnotate } from "../annotate/annotate-creation.js";
import { commitAnalysisAxis, handleAnalysisInputClick } from "../statics/analysis-tools.js";
import { handleAnnotationClick, isAnnotationTool } from "../annotate/annotation-tool.js";
import { cameraSignal, renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { pickColourFromFeature } from "../../../components/layout/panels/colour-picker.js";
import { isConstructionTool, shouldClickSelectExistingObject } from "../../../components/layout/toolbar/construction-tools.js";
import { handleDimensionClick } from "../annotate/dimension-placement.js";
import { isDimensionTool, openDimensionValuePrompt } from "../annotate/dimension-tool.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderFeatures } from "../../../components/layout/panels/features-pane.js";
import { add2DCoordinateSystem, beginOrCompleteGeometry } from "../geometry/geometry-creation.js";
import { addProcessPoint, isProcessPlotTool } from "../thermodynamics/process-path.js";
import { objectAtPoint } from "./hit-testing.js";
import { handleModifyClick } from "../commands/modify-tools.js";
import { resolvePointerEvent } from "./pointer.js";
import { shouldExitToSelectOnClick } from "../../../components/layout/toolbar/tool-classification.js";
import { activateTool, canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { isLegacyResetTool } from "../../../components/layout/toolbar/phase-reset.js";

export function handleCanvasClick(
    event
) {
    /*
     * PHASE 1 RESET: with a placeholder tool armed, a click does
     * nothing. Every legacy tool handler - dimension, annotate,
     * annotation, construction, coordinate system, analysis and
     * thermodynamics - is unreachable from here.
     */
    if (isLegacyResetTool(drawingState.activeTool)) {
        event.preventDefault();
        return;
    }
    /*
     * The colour eyedropper is a one-shot mode: the next
     * click reads a feature's stored colour instead of
     * doing anything else with the click.
     */
    if (editorState.eyedropperActive) {
        event.preventDefault();

        pickColourFromFeature(
            event
        );

        return;
    }

    /*
     * A running Modify session owns the click. It is
     * checked before the selection-suppression flag so a
     * staged workflow is never swallowed by a leftover
     * selection drag.
     */
    if (
        editorState.modifySession &&
        handleModifyClick(
            resolvePointerEvent(
                event
            ),
            canvasPointFromEvent(
                event,
                false
            ),
            event.shiftKey
        )
    ) {
        editorState.selectionClickSuppressed =
            false;

        return;
    }

    if (
        editorState.selectionClickSuppressed
    ) {
        editorState.selectionClickSuppressed =
            false;

        return;
    }

    /*
     * THE CLICK AFTER A DRAG-TO-CREATE GESTURE.
     *
     * A held drag that created a feature also fires a `click` on release.
     * That click is part of the gesture that has already committed the
     * feature, not a new first point - so it is dropped here, once, and
     * the tool stays armed for the next feature. Without this the release
     * would be read twice and the student would find themselves starting
     * a second shape at the point they had just released.
     */
    if (
        editorState.creationDragConsumedClick
    ) {
        editorState.creationDragConsumedClick =
            false;

        return;
    }

    /*
     * Resolve the exact click position again.
     *
     * This is important because relying on the
     * previous mousemove resolution can cause a
     * click to use a stale unsnapped point.
     */
    const resolution =
        resolvePointerEvent(
            event
        );

    // Also cover clicks delivered without a pointerdown creation session.
    // Select the note before a click-to-create tool consumes its first point.
    if (drawingState.interaction.phase === "idle" && ["line", "rectangle", "circle"].includes(drawingState.activeTool) &&
        isEditableAnnotate(objectAtPoint(resolution.rawPointerPoint || canvasPointFromEvent(event, false)))) {
        activateTool("select");
        selectFromCanvasClick(event);
        return;
    }

    if (isProcessPlotTool(drawingState.activeTool)) {
        addProcessPoint(resolution.rawPointerPoint);
        return;
    }

    if (
        drawingState.activeTool ===
        "coordinate-system-2d"
    ) {
        add2DCoordinateSystem(
            resolution.effectiveConstructionPoint
        );

        return;
    }

    if (
        !drawingState.activeTool
    ) {
        return;
    }

    /*
     * A running Modify session owns the click, so its
     * staged workflow is not interrupted by ordinary
     * tool handling.
     */
    if (
        editorState.modifySession &&
        handleModifyClick(
            resolution,
            canvasPointFromEvent(
                event,
                false
            )
        )
    ) {
        return;
    }

    /*
     * THE ANALYSIS INPUT-SELECTION STATE, BEFORE EVERYTHING ELSE.
     *
     * Resultant and Force Components are CHILD analysis features: they read
     * explicit Force features and derive everything from those. While the tool
     * waits for its input, a click is asking one question - "is this a Force?" -
     * and the answer must not be influenced by universal selection, by the
     * construction pipeline, or by what happens to be under the cursor. A click
     * on a Resultant, on a beam, or on empty space adds nothing; only a Force
     * is an input.
     *
     * So it is routed FIRST, ahead of every other rule, from the interaction
     * phase rather than from a list of tool ids - the same way the analysis axis
     * placement owns its clicks.
     */
    if (
        drawingState.interaction.phase ===
            "analysis-input"
    ) {
        handleAnalysisInputClick(
            resolution,
            event
        );

        return;
    }

    /*
     * THE DIMENSION TOOLS, BEFORE THE CONSTRUCTION PIPELINE.
     *
     * A dimension tool IS a construction tool - it needs the same
     * snapping and inference as everything else, which is why it is
     * listed in `isConstructionTool`. But it does not share the
     * construction CLICK pipeline: it collects references until Enter
     * rather than taking points until a shape is complete.
     *
     * Sending it to `beginOrCompleteGeometry` therefore consumed every
     * click and built nothing. The dimension check is first so a click
     * reaches the tool's own handler, which is still fed by the same
     * snapping resolution computed above.
     */
    if (
        isDimensionTool(
            drawingState.activeTool
        )
    ) {
        handleDimensionClick(
            resolution,
            event
        );

        return;
    }

    /*
     * THE ANNOTATE TOOLS, BEFORE THE CONSTRUCTION PIPELINE.
     *
     * A note, a label, a leader, a callout, an arrow, a symbol, a
     * tolerance and a table are their own small state machines - a point
     * placement, or an anchor and an end - and they are NOT two-point
     * construction geometry. Sending them through
     * `beginOrCompleteGeometry` would consume the clicks and build nothing,
     * which is exactly the failure the dimension tools had. So they are
     * routed to their own handler, fed by the same snap resolution computed
     * above.
     */
    if (
        isAnnotateTool(
            drawingState.activeTool
        )
    ) {
        handleAnnotateClick(
            resolution
        );

        return;
    }

    /*
     * ========================================================
     * A BARE CLICK WITH A ONE-GESTURE TOOL LEAVES THE TOOL
     * ========================================================
     *
     * A Beam and an Arrow are made by ONE press-drag-release - their gesture
     * arrives through the drag path, which has already classified it on release
     * (see creation-drag.js `finishCreationClick`). What remains here is the
     * click that reaches this router WITHOUT a creation session behind it - an
     * edge case such as a release whose session was already dropped - and it is
     * answered the same way: back to Select, selecting whatever was under the
     * cursor.
     *
     * IT IS PLACED BEFORE the construction branch below, because that branch
     * would otherwise consume the click as a first point. It is placed AFTER the
     * dimension, annotate and animation handlers above, because a tool with an
     * EXPLICIT REQUIRED INPUT - a dimension collecting references, a label or a
     * leader attaching, a Resultant being told which force - must keep receiving
     * the click. The classification decides this; see tool-classification.js.
     *
     * A TOOL MID-WAY THROUGH ITS OWN STEPS IS NOT "FINISHED". A Triangle waiting
     * for its third corner, a Polygon for its side count, an Arc for its next
     * point, a load for its span - those clicks are real decisions, so they go
     * to the construction pipeline below exactly as before.
     */
    if (
        shouldExitToSelectOnClick(
            drawingState.activeTool
        ) &&
        drawingState.interaction.phase ===
            "idle"
    ) {
        exitToolToSelect(
            event
        );

        return;
    }

    if (
        isConstructionTool(
            drawingState.activeTool
        )
    ) {
        beginOrCompleteGeometry(
            resolution
        );

        return;
    }

    /*
     * The annotation tool. Checked after the dimension tools because it
     * behaves the same way - arm, then place - and differs only in what it is
     * labelling.

     */
    if (
        isAnnotationTool(
            drawingState.activeTool
        )
    ) {
        handleAnnotationClick(
            resolution,
            event
        );

        return;
    }

    /*
     * UNIVERSAL SELECTION.
     *
     * This is the one rule that makes Select mean the same thing
     * everywhere: clicking a feature that ALREADY EXISTS selects it,
     * whichever tool is currently active.
     *
     * Before this, selecting an existing object was only possible
     * with the Select tool active. A student with Beam selected who
     * clicked an existing Point Force did not select the force - the
     * Beam tool consumed the click and started a new beam through
     * it. Selecting therefore became a mode the student had to be
     * IN, and switching to it and back for every edit was pure
     * friction.
     *
     * WHERE IT SITS IN THE ORDER, AND WHY
     * -----------------------------------
     * Placement is the design; it is a priority order and not a set
     * of tool exceptions:
     *
     *   1. an active editing interaction  - Modify, handled above
     *   2. the tool's own meaning for a click on existing geometry -
     *      construction, dimensions, annotations
     *   3. a CONSTRUCTION that is mid-flight and needs this click as
     *      one of ITS points
     *   4. an existing object under the pointer
     *   5. the tool's own handling of empty space
     *
     * Step 2 is why this block sits BELOW the dimension and annotation
     * tools rather than above them, and getting that wrong is the
     * mistake this ordering exists to prevent.
     *
     * A dimension and an annotation are not placed on empty canvas.
     * They are MEASURED and LABELLED, and the whole point of them is
     * that they attach to something already on the sheet: clicking a
     * beam with the Dimension tool means "measure that beam", and
     * clicking a force with the Annotation tool means "write on that
     * force". Intercepting those clicks to select the beam instead
     * would quietly remove the tools' entire reason for being - the
     * student could not dimension anything without switching to Select
     * first, which is the very problem this change removes,
     * reintroduced one level down.
     *
     * Steps 3 and 4 are the universal part. A running construction is
     * exempt - a half-built Beam is waiting for its second point, and
     * taking the click for a selection would strand it - and the
     * exemption is asked of the interaction state rather than of a
     * list of tools, so no tool can be forgotten.
     *
     * Step 4 uses the same hit test Select uses, which already knows
     * about dimensions, annotations, analysis objects and every
     * statics symbol. So no tool needs to know how to be selectable
     * and no category needs its own rule: a tool that was never
     * thought about when this was written still gets it.
     */
    /*
     * THE ANALYSIS AXIS PLACEMENT, BEFORE ANY SELECTION.
     *
     * The comment below used to describe this branch as sitting ahead of
     * the construction tools and the selection test, and it was written
     * with the reasoning in full: a click on an existing feature during a
     * placement is a PLACEMENT click, not a selection, because the
     * student is being asked where the diagram goes and the only thing
     * that answers that is where the pointer is.
     *
     * The code said the opposite. The selection test ran first, so a click
     * on the beam was taken as a selection and returned before this branch
     * was ever reached - the diagram stayed unplaced and the tool stayed
     * armed, which is the one outcome that comment calls a half-finished
     * sheet.
     *
     * So the order is what the comment always claimed. A running analysis
     * placement owns the pointer, and that is decided by the interaction
     * phase rather than by what happens to be under it.
     */
    if (
        drawingState.interaction.phase ===
            "analysis-axis"
    ) {
        /*
         * WHICH STAGE THIS CLICK IS.
         *
         * The placement is two clicks: the first names the body the
         * diagram belongs to, the second puts it where the student wants
         * it. Whether THIS click is the second one is decided by whether a
         * source was already chosen when it arrived - read BEFORE the
         * first stage runs, because that stage sets the source and would
         * otherwise make both clicks look like the committing one.
         */
        const hadSource =
            Boolean(
                drawingState.interaction.sourceId
            );

        if (hadSource) {
            commitAnalysisAxis();

            return;
        }

        /*
         * No source yet, so this click NAMES the body. That is the first
         * stage of the placement and it is handled by the ordinary
         * construction entry point, which already owns the "click a body
         * to act on" rule every body-attached Statics tool uses.
         *
         * It is deliberately NOT called once a source exists. A
         * construction entry point is for BUILDING something, and with a
         * source already chosen this click commits a placement rather than
         * starting a new one - running both would leave a stray span armed
         * behind the diagram.
         */
        beginOrCompleteGeometry(
            resolvePointerEvent(event)
        );

        return;
    }

    if (
        shouldClickSelectExistingObject(
            event
        )
    ) {
        if (drawingState.activeTool !== "select") {
            activateTool("select");
        }
        selectFromCanvasClick(
            event
        );

        return;
    }

    if (
        drawingState.activeTool ===
        "select"
    ) {
        selectFromCanvasClick(
            event
        );
    }
}

/*
 * APPLY A SELECTION CLICK.
 *
 * Extracted from the Select tool's branch of handleCanvasClick so
 * that the same selection rules - Shift to extend, a second click to
 * open a dimension's editor, a click on nothing to clear - are
 * applied whether the click arrived with Select active or with
 * another tool active and the click being read as a selection.
 *
 * It is deliberately ONE function rather than two similar ones. The
 * behaviour that matters here is not subtle: Shift adds and removes,
 * clicking empty space deselects, clicking a selected dimension twice
 * opens its editor. Duplicating that list for a second entry point
 * would guarantee the two drifted, and a student who learned that
 * Shift works with Select would find it did nothing with Beam.
 *
 * Returns true when the click was consumed as a selection, so the
 * caller knows whether the tool that was active also got a turn.
 */
function selectFromCanvasClick(
    event
) {
    /*
     * Selection uses the actual pointer position, never a snapped
     * construction point. A student clicking the thing they can see
     * means that pixel, not the nearest vertex to it.
     */
    const rawPoint =
        canvasPointFromEvent(
            event,
            false
        );

    const object =
        objectAtPoint(
            rawPoint
        );

    /*
     * Shift extends the selection: clicking an
     * unselected feature adds it, clicking an already
     * selected feature removes it. Without Shift the
     * click replaces the selection as before.
     */
    if (event.shiftKey) {
        if (object) {
            const selected =
                drawingState.selection
                    .selectedObjectIds;

            enggDrawingState.selectObjects(
                drawingState,
                selected.includes(
                    object.id
                )
                    ? selected.filter(
                        id =>
                            id !==
                            object.id
                    )
                    : [
                        ...selected,
                        object.id
                    ]
            );
        }
    } else if (object) {
        /*
         * SELECTING IS ENOUGH TO EDIT.
         *
         * The Features tab describes whatever is selected the moment it is
         * selected - there is no "examine, then ask to edit" step. A dimension
         * is opened by the canvas's double-click gesture, which is the
         * application's "open this thing" action; a single click only selects.
         */
        enggDrawingState.selectObject(
            drawingState,
            object.id
        );
    } else {
        enggDrawingState.clearSelection(
            drawingState
        );
    }

    renderProperties();

    /*
     * A CLICKED SELECTION IS SHOWN. `selectObjects` only announces a change, so
     * re-selecting the one object that is already selected would leave the
     * editor open but would not repaint it - and a clear-to-nothing click must
     * empty it, which the announcement does. Calling the render unconditionally
     * makes both cases true: whatever is selected is what Features shows.
     */
    renderFeatures();
    renderCurrentDrawing();

    return true;
}

/*
 * OPEN THE DIMENSION EDITOR FOR A DIMENSION.
 *
 * Reads everything the dialog shows FROM THE DIMENSION, so the editor
 * is never a second source of truth about what a dimension says - it
 * is a view of the model, plus the two kinds of change the model
 * permits.
 *
 * WHAT CAN CHANGE
 *
 *   DISPLAY   precision and whether units are shown. Belongs to this
 *             one dimension and touches nothing else. Recorded on the
 *             dimension's own style, so it travels with the dimension
 *             when the file is saved.
 *
 * There is no calibration path: the retired world-length scale is gone,
 * and a dimension reads the drawing in drawing units. Nothing here can
 * invent a number. There is no code path from this
 * dialog to "set this dimension's value", because the model has no
 * such field to set and there must never be one.
 *
 * ASSOCIATION IS NEVER TOUCHED
 * ----------------------------
 * Nothing here writes `sourceRefs`, `dimensionType` or the geometry
 * they point at. A dimension that was measuring Line 004 before the
 * edit is measuring Line 004 after it, and will go on following it
 * when the line moves.
 */
export function openDimensionEditorFor(object) {
    /*
     * ========================================================
     * A DIMENSION'S EDITOR IS THE STANDARD VALUE POPUP
     * ========================================================
     *
     * This used to open a dimension-specific dialog whose first question was
     * the sheet's world scale. That scale is retired, and routing here also
     * fixes the other problem with the old dialog:
     *
     * THERE WERE TWO WAYS TO EDIT A DIMENSION. The canvas double-click
     * and the picked-row click both came to this function, and it is the one
     * place both reach - so putting the shared popup HERE means neither can
     * present a different box from the other, and a third caller added later
     * inherits the same behaviour.
     *
     * `openDimensionValuePrompt` is kept as its own function so this stays a
     * one-line delegate: a reader looking for "what opens when a dimension is
     * edited" finds the answer in the name, and does not have to know which
     * dialog implementation happens to back it.
     */
    return openDimensionValuePrompt(object);
}

/*
 * OPEN THE NOTE EDITOR FOR A WRITTEN ANNOTATION.
 *
 * A Note is the student's own words, so double-clicking it (or double-
 * clicking its entry in the Features tree) opens the note editor here,
 * the same "open this thing" gesture the dimension uses.
 *
 * A GENERATED annotation is refused one: its text is a reading of the
 * feature it describes and the next redraw would overwrite anything
 * typed, so there is deliberately no path from here to the editor for
 * one. The guard is the model's own `isGenerated`, so a new generated
 * kind is refused automatically rather than by remembering to list it.
 */
/*
 * ========================================================
 * THE TEXT ENTRY IS ANCHORED TO THE OBJECT, NOT TO THE SCREEN
 * ========================================================
 *
 * A written annotation's editor is the inline node-entry prompt, positioned at
 * the place its text will occupy. Two things make that correct and are done
 * here, once, for every route into the editor:
 *
 *   THE OBJECT STAYS VISIBLE. `editorState.textEntryObjectId` names it while
 *   the prompt is open, and the overlay draws that object even when the
 *   compiled picture already shows it - so the feature the student is
 *   labelling is on the sheet, undimmed, for the whole interaction.
 *
 *   THE PROMPT FOLLOWS THE CAMERA. `cameraSignal` asks `renderCurrentDrawing`
 *   to call back on every camera change, so a zoom or pan while typing moves
 *   the prompt with its node instead of leaving it behind.
 */
function beginTextEntry(object) {
    const previous = editorState.textEntryObjectId;

    editorState.textEntryObjectId = object?.id || null;

    if (previous !== editorState.textEntryObjectId) {
        renderCurrentDrawing();
    }
}

function endTextEntry() {
    if (editorState.textEntryObjectId === null) {
        return;
    }

    editorState.textEntryObjectId = null;

    renderCurrentDrawing();
}

/*
 * WHERE A TABLE CELL'S WORDS SIT.
 *
 * The table's own placement is the centre of its grid; a cell is right and
 * down from there by whole rows and columns. The renderer sizes a cell to 12px
 * text with tight padding, and this is the same rule, so the prompt appears
 * over the cell the double-click landed in rather than at the table's corner.
 *
 * IT IS A POSITION, NOT A GEOMETRY WRITE - nothing about the table changes.
 */
const TABLE_CELL_WIDTH_PX = 56;
const TABLE_CELL_HEIGHT_PX = 20;

function tableCellPoint(table, cellIndex) {
    const geometry = table?.geometry || {};
    const placement = geometry.position;
    const cells = geometry.cells;

    if (
        !placement ||
        !Number.isFinite(Number(placement.x)) ||
        !Number.isFinite(Number(placement.y)) ||
        !Array.isArray(cells)
    ) {
        return null;
    }

    const columns = Math.max(1, Number(geometry.columns) || 1);
    const rows = Math.max(1, Math.ceil(cells.length / columns));

    const scale =
        enggDrawingState.BASE_PIXELS_PER_UNIT *
        (drawingState.camera?.zoom || 1);

    const row = Math.floor(cellIndex / columns);
    const column = cellIndex % columns;

    const width = columns * TABLE_CELL_WIDTH_PX;
    const height = rows * TABLE_CELL_HEIGHT_PX;

    return {
        x:
            placement.x +
            ((column + 0.5) * TABLE_CELL_WIDTH_PX - width / 2) / scale,
        y:
            placement.y -
            ((row + 0.5) * TABLE_CELL_HEIGHT_PX - height / 2) / scale
    };
}

/*
 * OPEN THE NOTE EDITOR FOR A WRITTEN FEATURE.
 *
 * `atPoint` is the place on the sheet the student just clicked to put it, in
 * drawing units. A note placed by one click is written where that click landed
 * even before its text exists, so passing the point makes the prompt open
 * exactly there rather than at a default the model guessed. Omitting it - a
 * double-click on something already on the sheet - anchors to the feature's own
 * text position, which is what the student is looking at.
 */
export function openNoteEditorFor(object, atPoint = null) {
    /*
     * AN ANNOTATE FEATURE'S TEXT IS ALSO THE STUDENT'S OWN.
     *
     * A note, a label, a leader and a callout are written, so they open
     * this same editor - one write box for the whole application, so a note
     * is edited the same way however it was made. `isEditableAnnotate`
     * refuses a symbol, a tolerance and a table, whose content is not free
     * text and is edited through their own panel rows instead.
     */    if (object?.type === "annotate") {
        if (!isEditableAnnotate(object)) {
            return false;
        }

        beginTextEntry(object);

        enggNoteEditor?.open({
            text: object.text || "",

            /*
             * A NOTE IS MULTI-LINE; A LABEL AND A SHORT CALLOUT ARE NOT. The
             * editor decides its field and its commit key from this, and the
             * PLACEHOLDER is the contextual prompt the model gives for the
             * kind - shown only, never stored.
             */
            multiline: object.annotateKind === "note",

            placeholder:
                enggAnnotate?.placeholderOf?.(object) || "Enter text",

            title: `Edit ${enggAnnotate?.ANNOTATE_KINDS?.[object.annotateKind]?.label || "Annotation"}`,

            /* The node the prompt hangs on, and the words shown while typing. */
            object,
            point: atPoint,
            state: drawingState,
            cameraSignal,

            onApply: (text) => {
                endTextEntry();

                const previousObjects =
                    enggDrawingState.snapshotDrawing(drawingState);

                object.text = text;

                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previousObjects
                );

                setToolMessage("Annotation updated");

                renderProperties();
                renderCurrentDrawing();
            },

            onCancel: () => {
                endTextEntry();

                setToolMessage("Annotation edit cancelled");

                renderCurrentDrawing();
            }
        });

        return true;
    }

    if (
        object?.type !== "annotation" ||
        enggAnnotationModel.isGenerated(object.annotationKind)
    ) {
        return false;
    }

    beginTextEntry(object);

    enggNoteEditor?.open({
        text: object.text || "",

        object,
        point: atPoint,
        state: drawingState,
        cameraSignal,

        onApply: (text) => {
            endTextEntry();

            const previousObjects = enggDrawingState.snapshotDrawing(
                drawingState
            );

            object.text = text;

            enggDrawingState.commitDrawingChange(
                drawingState,
                previousObjects
            );

            setToolMessage("Note updated");

            renderProperties();
            renderCurrentDrawing();
        },

        onCancel: () => {
            endTextEntry();

            setToolMessage("Note edit cancelled");

            renderCurrentDrawing();
        }
    });

    return true;
}

/*
 * OPEN THE EDITOR FOR ONE TABLE CELL.
 *
 * A table is a grid of cells, and the cell a double-click landed in is the thing
 * the student wants to write - so this opens the SAME editor a note uses, seeded
 * with that cell's current text, and writes the result back to THAT cell. The
 * cell index comes from the model's own layout (`tableCellAt`), so the editor
 * and the drawn grid agree about which cell was hit.
 *
 * It is a single-line box: a cell holds a short value, not prose, so Enter
 * commits, which is what a spreadsheet does.
 */
export function openTableCellEditorFor(table, cellIndex) {
    if (
        !table ||
        table.type !== "annotate" ||
        table.annotateKind !== "table"
    ) {
        return false;
    }

    const geometry = table.geometry || {};

    if (!Array.isArray(geometry.cells)) {
        return false;
    }

    const current = geometry.cells[cellIndex] ?? "";

    beginTextEntry(table);

    enggNoteEditor?.open({
        text: current,
        multiline: false,
        placeholder: "Enter text",
        title: "Edit Cell",

        object: table,
        state: drawingState,
        cameraSignal,

        /*
         * A CELL'S WORDS SIT IN THE CELL, not at the table's placement - so the
         * prompt is anchored to the cell the double-click landed in.
         */
        point: tableCellPoint(table, cellIndex),

        onApply: (text) => {
            endTextEntry();

            const previousObjects = enggDrawingState.snapshotDrawing(drawingState);

            /*
             * ONLY THE ONE CELL IS WRITTEN, and the grid is left the size it is -
             * editing a cell changes a VALUE, never the table's shape, so the
             * rows, columns and every other cell are untouched.
             */
            table.geometry.cells[cellIndex] = String(text ?? "");

            enggDrawingState.commitDrawingChange(
                drawingState,
                previousObjects
            );

            setToolMessage("Cell updated");

            renderProperties();
            renderCurrentDrawing();
        },

        onCancel: () => {
            endTextEntry();

            setToolMessage("Cell edit cancelled");

            renderCurrentDrawing();
        }
    });

    return true;
}

/*
 * ========================================================
 * FINISHING WITH A TOOL: BACK TO SELECT IN ONE CLICK
 * ========================================================
 *
 * The automatic way out of a creation tool. A student who has just drawn a Line
 * and clicks empty space should not have to go and find the Select button: the
 * click means "done", so the tool is dropped and Select takes over.
 *
 * WHERE THE CLICK LANDS STILL MATTERS. Clicking empty space leaves nothing
 * selected; clicking an existing feature selects it - exactly as though the
 * student had switched to Select and clicked it. So the tool is deactivated
 * FIRST (through the ordinary activation path, so a half-built construction is
 * cancelled and its preview removed), and the selection then follows the same
 * click.
 */
function exitToolToSelect(event) {
    activateTool("select");

    selectFromCanvasClick(event);
}

export function syncSelectionInteraction() {
    if (
        !drawingState.interaction
    ) {
        return;
    }

    if (editorState.selectionDrag) {
        drawingState.interaction.selectionStart =
            editorState.selectionDrag.start;

        drawingState.interaction.selectionCurrent =
            editorState.selectionDrag.current;

        drawingState.interaction.selectionBox =
            editorState.selectionDrag.box;

        drawingState.interaction.selectionDragging =
            editorState.selectionDrag.moved;
    } else {
        drawingState.interaction.selectionStart =
            null;

        drawingState.interaction.selectionCurrent =
            null;

        drawingState.interaction.selectionBox =
            null;

        drawingState.interaction.selectionDragging =
            false;
    }
}
