/*
 * Keyboard shortcuts.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPlotEditor from "../../../shared/ui/editors/plot-editor.js";
import enggSketchEditor from "../../../shared/ui/editors/sketch-editor.js";
import enggNoteEditor from "../../../shared/ui/editors/note-editor.js";
import { drawToolDefinitions } from "../../../components/layout/toolbar/tools.js";
import { cycleAnnotationKind } from "../annotate/annotation-tool.js";
import { nudgeSelection } from "./arrow-movement.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { copySelectionToClipboard, cutSelectionToClipboard, pasteFromClipboard } from "../commands/clipboard-commands.js";
import { deleteSelectedObjects } from "../commands/delete-command.js";
import { cycleDimensionChoice } from "../annotate/dimension-placement.js";
import { FILE_ACTIONS } from "../commands/document-commands.js";
import { drawingState, editorState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { cancelInteraction, deselectIfJustCreated, finishActiveConstruction } from "./selection.js";
import { activateTool, performRedo, performUndo } from "../../../components/layout/toolbar/tool-activation.js";
import { activeCategory, closeCoordinateSystemMenu } from "../../../components/layout/toolbar/tool-menus.js";
import { renderEngineeringTools, setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { cancelTrussConstruction } from "../statics/truss-tool.js";
import { fitDrawingToView } from "../../../components/layout/workspace/viewport.js";

/*
 * Wire this part of the editor to the page. Called once, at start-up,
 * by editor/index.js.
 */
export function installKeyboardShortcuts() {
    globalThis.document.addEventListener(
        "keydown",
        event => {
            const activeElement =
                globalThis.document.activeElement;

            const editable =
                [
                    "INPUT",
                    "TEXTAREA",
                    "SELECT"
                ].includes(
                    activeElement?.tagName
                ) ||
                activeElement?.isContentEditable;

            if (
                !editable &&
                event.ctrlKey &&
                event.key.toLowerCase() ===
                    "z"
            ) {
                event.preventDefault();

                if (
                    event.shiftKey
                ) {
                    performRedo();
                } else {
                    performUndo();
                }

                return;
            }

            if (
                !editable &&
                event.ctrlKey &&
                event.key.toLowerCase() ===
                    "y"
            ) {
                event.preventDefault();

                performRedo();

                return;
            }

            /*
             * Copy, paste and cut.
             *
             * They act on whatever is selected, through the same
             * selection the rest of the drawing uses, and they are
             * refused while a panel field has focus so typing a
             * value is never mistaken for a command.
             *
             * They are handled before the tool shortcuts, so a
             * construction in progress cannot swallow them, and a
             * half-finished shape is never cut in half by a stray
             * keypress.
             */
            if (
                !editable &&
                event.ctrlKey &&
                drawingState.interaction.phase ===
                    "idle"
            ) {
                const key =
                    event.key.toLowerCase();

                if (key === "c") {
                    event.preventDefault();

                    if (copySelectionToClipboard()) {
                        const count =
                            editorState.drawingClipboard
                                .features.length;

                        setToolMessage(
                            count === 1
                                ? "Copied 1 feature"
                                : `Copied ${count} features`
                        );
                    }

                    return;
                }

                if (key === "v") {
                    event.preventDefault();

                    pasteFromClipboard();

                    return;
                }

                if (key === "x") {
                    event.preventDefault();

                    cutSelectionToClipboard();

                    return;
                }
            }

            /*
             * File shortcuts.
             *
             * These are the conventional bindings, and they are handled
             * before the tool shortcuts for the same reason the clipboard
             * ones are: a construction in progress must never swallow a
             * file command, and Ctrl+S in the middle of drawing a beam
             * should save the drawing rather than do nothing.
             *
             * They are refused while a field has focus, for the same
             * reason: a user typing "s" into a name field must not
             * trigger a save.
             *
             * Print and Open are deliberately NOT bound to a bare
             * Ctrl+P / Ctrl+O here. Both are intercepted by the browser
             * itself before this handler ever sees them, and a shortcut
             * that sometimes works and sometimes opens the browser's own
             * dialog is worse than one the user reaches through the
             * menu. They are bound to combinations the browser does not
             * claim, and both are on the File menu.
             */
            if (!editable && event.ctrlKey) {
                const key =
                    event.key.toLowerCase();

                if (key === "s") {
                    event.preventDefault();

                    if (event.shiftKey) {
                        FILE_ACTIONS["save-as"]();
                    } else {
                        FILE_ACTIONS.save();
                    }

                    return;
                }

                if (key === "n") {
                    event.preventDefault();

                    FILE_ACTIONS.new();

                    return;
                }

                if (key === "p" && event.shiftKey) {
                    event.preventDefault();

                    FILE_ACTIONS.print();

                    return;
                }
            }

            /*
             * Ctrl+0 is the CAD convention for fitting the drawing,
             * and it is the one view shortcut worth having by muscle
             * memory: it is the key a user reaches for when a zoom
             * has lost the drawing.
             *
             * It is bound to the same function as the Fit button, so
             * it cannot behave differently from what is on screen.
             */
            if (
                !editable &&
                event.ctrlKey &&
                (
                    event.key === "0" ||
                        event.code === "Digit0" ||
                        event.code === "Numpad0"
                )
            ) {
                event.preventDefault();

                fitDrawingToView();

                return;
            }

            if (
                !editable &&
                event.ctrlKey &&
                event.key.toLowerCase() ===
                    "a"
            ) {            event.preventDefault();

                enggDrawingState.clearInteraction(
                    drawingState
                );

                drawingState.selection
                    .boxSelectionIds = [];

                drawingState.selection
                    .hoveredObjectId = null;

                enggDrawingState.setActiveTool(
                    drawingState,
                    "select"
                );

                enggDrawingState.selectObjects(
                    drawingState,
                    drawingState.objects.map(
                        object =>
                            object.id
                    )
                );

                setToolMessage(
                    "All components selected"
                );

                renderEngineeringTools(
                    activeCategory()
                );

                renderProperties();
                renderCurrentDrawing();

                return;
            }

            /*
             * D changes WHAT a dimension measures.
             *
             * Handled only while a dimension is armed, so it never
             * shadows D for anything else. Tab is accepted as well because
             * cycling a choice is what Tab means everywhere else in the
             * application, and a student should not have to discover a
             * second key.
             */
            if (
                (event.key === "d" ||
                    event.key === "D" ||
                    event.key === "Tab") &&
                (drawingState.interaction
                    .dimensionRefs?.length ||
                    drawingState.interaction
                        .annotationKind)
            ) {
                event.preventDefault();

                if (
                    drawingState.interaction
                        .annotationKind
                ) {
                    cycleAnnotationKind();
                } else {
                    cycleDimensionChoice();
                }

                return;
            }

            if (
                event.key ===
                "Escape"
            ) {
                event.preventDefault();

                closeCoordinateSystemMenu();

                /*
                 * A DIALOG GOES FIRST. The editors hold the keyboard while they
                 * are open - they preview the student's half-typed equations or
                 * their in-progress strokes onto the sheet - so Escape has to
                 * close them before anything on the canvas is considered, or
                 * they would sit there stranded with nothing to cancel behind
                 * them.
                 *
                 * THE CREATION DIMENSION POPUP IS ONE OF THESE. It is a dialog
                 * for exactly the same reason the others are: it is the last
                 * step of building a feature, it owns Enter and Escape while it
                 * is open, and nothing on the canvas may act behind its back.
                 *
                 * SKETCH BEFORE PLOT. Both may be open at once in principle,
                 * and the sketch editor consumes a first Escape to abandon an
                 * unfinished stroke - which is what the student almost always
                 * means when they press it mid-drawing. Offering the plot
                 * editor first would close the wrong dialog.
                 *
                 * Each returns true only if it actually consumed the key, so a
                 * dialog that is not open falls through rather than swallowing
                 * the Escape the canvas needs.
                 */
                if (
                    enggSketchEditor?.handleEscape?.()
                ) {
                    return;
                }

                /*
                 * THE NOTE EDITOR ESCAPES TOO. It is the same kind of
                 * dialog as the others - it owns Escape while it is
                 * open - so it is offered the key the same way, after
                 * the sketch editor and before the plot editor.
                 */
                if (
                    enggNoteEditor?.handleEscape?.()
                ) {
                    return;
                }

                if (
                    enggPlotEditor?.handleEscape?.()
                ) {
                    return;
                }

                /*
                 * A truss in progress is the one operation that is
                 * explicitly reversible mid-way: Esc throws the
                 * whole construction away, including the automatic
                 * cleanup, so the drawing the student made before
                 * pressing Enter is still what they get back.
                 */
                if (
                    drawingState.interaction
                        .phase ===
                        "truss-construct"
                ) {
                    cancelTrussConstruction();
                    return;
                }

                cancelInteraction();

                return;
            }

            /*
             * Typing wins over every shortcut.
             *
             * This is checked BEFORE anything that reacts to Enter,
             * because Enter is also the key that finishes a
             * construction and clears a selection. An annotation
             * being typed, a dimension's value being entered, a
             * sheet being renamed, a Features-panel field being
             * edited - in all of them Enter belongs to the text, and
             * a construction finishing itself mid-sentence is a
             * corruption rather than a convenience.
             *
             * THE CREATION DIMENSION FIELD IS SUCH A FIELD. Enter there
             * confirms the size and commits the feature, and the popup
             * is not a form input as far as this document is concerned
             * - `editable` is decided from the EVENT TARGET, and the
             * popup's input is not one of the elements that check
             * recognises. Without the test below, the very Enter that
             * confirmed "500 mm" carried on into "finish the
             * construction", which then ran a DESELECT on the feature
             * that had just been created, and the Features panel
             * reverted to the tree - so the value the student had
             * entered appeared to vanish the moment they confirmed it.
             *
             * The cost of this ordering is that Enter cannot finish
             * a construction while a field happens to have focus.
             * That is the right trade: the user is typing, and
             * clicking the canvas is how they hand focus back.
             */
            if (
                editable
            ) {
                return;
            }

            /*
             * Enter means "done" for anything being built.
             *
             * Previously only a truss and a distributed load
             * honoured it, so a student half-way through a polyline,
             * a polygon, a coordinate system or a distributed load
             * had no single key that said "commit this and stop".
             * Every other construction had to be finished by a
             * click on some particular spot, which meant knowing
             * where that spot was.
             *
             * So this is now one rule, not a list of rules: if a
             * construction is running and it can be completed, Enter
             * completes it and the drawing returns to its normal
             * resting state.
             *
             * The finishers are asked whether they can complete,
             * and one that cannot (a truss with too few members, a
             * polygon with no points yet) is simply left alone.
             * Refusing is better than committing something the
             * student did not mean, and better than silently
             * cancelling: nothing happens and the construction is
             * still there to carry on with.
             *
             * After that, Enter on a feature that was just created
             * and is still selected is a DESELECT. A feature stays
             * selected after it is drawn so the next click has
             * something to refer to, and that is a useful state -
             * but it means the drawing frequently opens with
             * something highlighted. Enter says "I can see it, I
             * accept it" without touching it. It never moves,
             * edits or recreates anything.
             */
            if (event.key === "Enter") {
                const finished = finishActiveConstruction();

                if (finished) {
                    event.preventDefault();
                    return;
                }

                if (deselectIfJustCreated()) {
                    event.preventDefault();
                    return;
                }
            }

            /*
             * ========================================================
             * THE ARROW KEYS MOVE THE SELECTION
             * ========================================================
             *
             * One step in the requested direction, through the shared
             * movement system - which decides what the step means for each
             * feature (free, attached, fixed, derived) rather than the key
             * deciding it here. See arrow-movement.js.
             *
             * IT IS CHECKED AFTER THE `editable` GUARD ABOVE, so an arrow key
             * while a Features field has focus moves the CARET - typing a
             * value must never nudge the drawing behind the field. And it is
             * refused while a construction is running, because the arrow then
             * belongs to that tool and not to the selection.
             */
            if (
                event.key === "ArrowUp" ||
                event.key === "ArrowDown" ||
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight"
            ) {
                const moving = {
                    ArrowUp: "up",
                    ArrowDown: "down",
                    ArrowLeft: "left",
                    ArrowRight: "right"
                }[event.key];

                if (
                    drawingState.selection.selectedObjectIds
                        .length &&
                    drawingState.interaction.phase === "idle"
                ) {
                    event.preventDefault();

                    nudgeSelection(moving);

                    return;
                }
            }

            /*
             * Delete and Backspace.
             */
            if (
                event.code ===
                    "Delete" ||
                event.key ===
                    "Delete" ||
                event.key ===
                    "Backspace"
            ) {
                /*
                 * Backspace deletes too, because it is the key a
                 * user reaches for by habit, and refusing it while
                 * Delete works makes the tool feel half-finished.
                 *
                 * It is only a shortcut when nothing is selected:
                 * Backspace is the field-editing key, so with a
                 * feature selected it deletes that, and with a value
                 * being typed it is already excluded above.
                 */
                if (
                    event.key ===
                        "Backspace" &&
                    !drawingState.selection
                        .selectedObjectIds.length
                ) {
                    return;
                }

                event.preventDefault();

                deleteSelectedObjects();

                return;
            }

            const shortcut =
                event.key.toUpperCase();

            const tool =
                drawToolDefinitions.find(
                    candidate =>
                        candidate.shortcut ===
                        shortcut
                );

            if (tool) {
                activateTool(
                    tool.id
                );
            }
        }
    );
}
