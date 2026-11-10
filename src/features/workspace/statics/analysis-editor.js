/*
 * ============================================================
 * THE ANALYSIS EDITORS
 * ============================================================
 *
 * This module used to render the Features panel's own interface: a component
 * tree grouped by discipline, with a "click a row twice to open its property
 * page" gesture, and a form for a load being built. The Features tab now edits
 * the SELECTION directly (`features-editor.js`), so all of that is gone - and
 * with it the two elements it used to create inside the panel
 * (`#drawingProperties`, `#drawingFeaturesBack`), which were what sat above the
 * Objects list and pushed it down the panel.
 *
 * BOTH MODES HAVE A DIALOG, and they are different dialogs because they are
 * different jobs:
 *
 *   Plot    a list of expressions, typed
 *   Sketch  a drawing workspace, drawn
 *
 * The Sketch Editor is the freehand one: the student draws with a mouse, a
 * finger or a stylus, and DAETUM works out whether each stroke is a straight
 * line or a curve and reconstructs it. There is no geometry-type control in it,
 * because the recogniser decides that - see `shared/ui/editors/sketch-editor.js`.
 *
 * WHAT APPLY PRODUCES. The editor's recognised strokes become ordinary DAETUM
 * features - a Line for a straight stroke, a Polyline for a curved one -
 * parented to the diagram. They are not a private point list on the diagram:
 * they are features, so they are selectable, editable, written to the source
 * and undone like anything else.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDiagramEquations from "../model/analysis/diagram-equations.js";
import enggPlotEditor from "../../../shared/ui/editors/plot-editor.js";
import enggAnalysisSketchBridge from "./analysis-sketch-bridge.js";
import enggPlacementSession from "../interaction/placement-session.js";
import enggGridPlacement from "../../../shared/placement/grid-placement.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import {
    ANALYSIS_SKETCH_MARKER,
    sketchStrokesOf
} from "./analysis-sketch.js";

import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";

/*
 * ========================================================
 * OPENING THE ANALYSIS EDITOR
 * ========================================================
 *
 * Sketch and Plot are two modes of ONE editor, and this is the single
 * place either is opened from. It is called from two places - the panel's
 * "Open Analysis Editor" button, and the placement commit - and both get
 * the same editor with the same content.
 *
 * The mode is the FEATURE's, not the button's. A student who placed a
 * Sketch and then opens the editor gets their sketch, not an empty Plot,
 * because the mode was stored on the diagram at creation and is read from
 * there every time.
 */
export function openAnalysisEditorFor(object) {
    if (!isAnalysedDiagram(object)) {
        return false;
    }

    const geometry = object.geometry || {};
    const mode = geometry.mode === 'plot' ? 'plot' : 'sketch';

    /*
     * Sketch and Plot are two modes of ONE editor, and this is the single
     * place either is opened from. It is called from two places - the panel's
     * "Open Analysis Editor" button, and the placement commit - and both get
     * the same editor with the same content.
     *
     * The mode is the FEATURE's, not the button's. A student who placed a
     * Sketch and then opens the editor gets their sketch, not an empty Plot,
     * because the mode was stored on the diagram at creation and is read from
     * there every time.
     *
     * WHICH MODE OPENS. Plot is entered as expressions, so it opens a dialog
     * with an expression list. Sketch is drawn by hand, so it opens the same
     * shaped dialog with the four sketching tools instead. There is one
     * dialog, two left-hand panels, and one Apply/Cancel.
     */
    return openAnalysisEditorMode(object, mode);
}

/*
 * EITHER MODE, BY NAME.
 *
 * Plot opens the expression editor; Sketch opens the drawing workspace. Both
 * are the same object's editor, so a student who placed a Sketch and then opens
 * the Plot Editor gets the plot of the same diagram.
 */
export function openAnalysisEditorMode(object, mode) {
    if (!object || !object.geometry) {
        return false;
    }

    if (mode === "plot") {
        return isAnalysedDiagram(object) ? openPlotEditorFor(object, object.geometry) : false;
    }

    return isAnalysedDiagram(object)
        ? openSketchEditorFor(object, object.geometry)
        : false;
}

function openPlotEditorFor(object, geometry) {
    const equations = enggDiagramEquations;
    const editor = enggPlotEditor;

    if (!equations || !editor) {
        return false;
    }

    const before =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    /*
     * THE QUANTITY IS CHOSEN, NOT TYPED. A student plotting a bending
     * moment diagram writes M(x), and the diagram already knows which of
     * the three it is - asking them to pick the letter would be asking
     * them to restate the choice they have already made, and would let
     * the two disagree.
     */
    editor.open({
        title: `${
            equations.titleFor(geometry.diagramType)
        } - Plot`,
        quantity:
            equations.quantityFor(
                geometry.diagramType
            ),
        range: geometry.localRange,
        expressions:
            equations.readPlot(geometry),
        onPreview: (expressions) => {
            geometry.expressions =
                expressions;
            renderCurrentDrawing();
        },
        onApply: (expressions) => {
            /*
             * THE LEGACY STORE IS CLEARED ONCE, HERE.
             *
             * An older file keeps its equations under `segments`, and the
             * reader takes that list when there are no expressions.
             * Leaving both behind would mean the old equations quietly
             * reappearing the next time a diagram is opened.
             */
            delete geometry.segments;

            geometry.expressions =
                expressions;

            enggDrawingState.commitDrawingChange(
                drawingState,
                before
            );
            renderCurrentDrawing();
            renderProperties();
        },
        onCancel: () => {
            renderCurrentDrawing();
            renderProperties();
        }
    });

    return true;
}

/*
 * ========================================================
 * OPENING A SKETCH
 * ========================================================
 *
 * The drawing workspace, loaded with the diagram's existing strokes so a
 * reopened sketch is edited rather than replaced.
 *
 * WHAT APPLY DOES. The editor hands back recognised strokes - each one already
 * classified as a line or a curve, with its clean points. They are committed as
 * ordinary features parented to the diagram:
 *
 *   straight  a LINE, through its two ends
 *   curved    a POLYLINE, through its smoothed points
 *
 * The diagram's previous strokes are replaced by the new set, because the
 * editor is the whole sketch: a stroke the student erased there must not
 * survive here. The replacement is ONE undoable change, so Undo puts the whole
 * previous sketch back.
 */
function openSketchEditorFor(object, geometry) {
    /*
     * THE UNIFIED WORKSPACE IS THE STATICS SKETCH EDITOR TOO.
     *
     * Every sketch tool opens the same editor, so the point system, the
     * correction and the source are the same in all of them. What is specific to
     * a diagram is the COMMIT, which the bridge supplies.
     */
    const before = enggDrawingState.snapshotDrawing(drawingState);

    const existing = sketchStrokesOf(object).map(stroke => ({
        id: stroke.id,
        type: stroke.type === "line" ? "line" : "curve",
        name: stroke.name,
        points: strokePointsOf(stroke),
        segments: stroke.geometry?.segments || [],
        style: stroke.style,
        appearance: stroke.style
            ? { colour: stroke.style.stroke, thickness: stroke.style.width }
            : undefined
    }));

    enggAnalysisSketchBridge.openDiagramSketch({
        title: `${enggDiagramEquations.titleFor(geometry.diagramType)} - Sketch`,
        strokes: existing,

        /*
         * APPLY HANDS THE STROKES TO THE PLACEMENT, IT DOES NOT COMMIT THEM.
         *
         * The sketch is finished, but its POSITION is still the student's to
         * choose - so the editor closes, the strokes follow the cursor, and the
         * click on the page is what commits them. A diagram's sketch has no
         * coordinate axes of its own, so it is placed by its bounding box with
         * ordinary grid snapping - no origin is invented for it.
         */
        /*
         * APPLY HANDS THE STROKES TO THE PLACEMENT, IT DOES NOT COMMIT THEM.
         *
         * The sketch is finished, but its POSITION is still the student's to
         * choose - so the workspace closes, the strokes follow the cursor, and
         * the click on the page is what commits them. A diagram's sketch has no
         * coordinate axes of its own, so it is placed by its bounding box with
         * ordinary grid snapping - no origin is invented for it.
         */
        onPlace: ({ elements }) => {
            enggPlacementSession.beginPlacement(
                {
                    strokes: elements.map(element => ({
                        points: element.points || []
                    })),
                    calibration: null
                },
                {
                    commit: placement => {
                        applySketchStrokes(object, elements, before, placement);
                    },
                    cancel: () => {
                        renderCurrentDrawing();
                        renderProperties();
                    }
                }
            );
        },

        onCancel: () => {
            renderCurrentDrawing();
            renderProperties();
        }
    });

    return true;
}

/* The points a committed stroke feature is made of. */
function strokePointsOf(stroke) {
    const geometry = stroke.geometry || {};

    if (Array.isArray(geometry.points)) {
        return geometry.points.map(point => ({ x: point.x, y: point.y }));
    }

    return [geometry.start, geometry.end]
        .filter(Boolean)
        .map(point => ({ x: point.x, y: point.y }));
}

/*
 * COMMIT THE SKETCH AS FEATURES.
 *
 * The old strokes are removed and the new ones added in ONE change, so the
 * student's Undo restores the sketch they had before they opened the editor -
 * not one stroke at a time.
 */
function applySketchStrokes(object, elements, before, placement = null) {
    sketchStrokesOf(object).forEach(stroke => {
        enggDrawingState.removeObject(drawingState, stroke.id);
    });

    elements.forEach(element => {
        /*
         * THE PLACEMENT IS APPLIED TO THE POINTS BEFORE THEY BECOME FEATURES,
         * so the committed strokes are where the student put them - and the
         * preview they saw is the geometry they get.
         */
        const points = placement
            ? enggGridPlacement.applyPlacementToPoints(element.points || [], placement)
            : element.points || [];

        if (points.length < 2) {
            return;
        }

        const feature =
            element.kind === "straight"
                ? {
                      type: "line",
                      name: "Line",
                      geometry: {
                          start: { ...points[0] },
                          end: { ...points[points.length - 1] }
                      }
                  }
                : {
                      type: "polyline",
                      name: "Polyline",
                      geometry: {
                          points: points.map(point => ({ ...point }))
                      }
                  };

        feature.parentId = object.id;
        feature.style = { ...(object.style || {}) };
        feature.engineering = {
            plane: "XY",
            discipline: "statics",
            analysisSketch: ANALYSIS_SKETCH_MARKER,
            sketchOf: object.id
        };

        enggDrawingState.addObject(drawingState, feature);
    });

    enggDrawingState.commitDrawingChange(drawingState, before);

    renderCurrentDrawing();
    renderProperties();
}

/*
 * ========================================================
 * THE EDITORS A FEATURE OFFERS, AND OPENING ONE BY ITS BUTTON
 * ========================================================
 *
 * A diagram offers BOTH editors, because both halves exist on the one model:
 * its hand-drawn strokes and its plotted curve. Each opens the dialog for its
 * own mode, on the same object.
 */
export const ANALYSIS_EDITOR_TYPES = Object.freeze([
    "analysis-diagram",
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram"
]);

/* The analysis tools whose Features tab carries a Plot Editor (they plot). */
export const PLOT_EDITOR_TOOL_TYPES = Object.freeze([
    "analysis-diagram",
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram"
]);

export function isAnalysedDiagram(object) {
    return Boolean(object && ANALYSIS_EDITOR_TYPES.includes(object.type));
}

export function analysisEditorsFor(object) {
    if (!object) {
        return [];
    }

    if (!PLOT_EDITOR_TOOL_TYPES.includes(object.type)) {
        return [];
    }

    return [
        { id: "sketch", label: "Drawing", button: "Sketch Editor" },
        { id: "plot", label: "Plot", button: "Plot Editor" }
    ];
}

/*
 * The editor a diagram OPENS on when nobody names one.
 *
 * Only a Plot has one. A Sketch is drawn on the sheet, so a sketch-mode diagram
 * answers null rather than naming a dialog that no longer exists.
 */
export function defaultAnalysisEditorFor(object) {
    if (!isAnalysedDiagram(object)) {
        return null;
    }

    return object.geometry && object.geometry.mode === "plot"
        ? { id: "plot", label: "Plot", button: "Plot Editor" }
        : { id: "sketch", label: "Drawing", button: "Sketch Editor" };
}

/*
 * OPEN IT BY ID AND MODE.
 *
 * The Features button names the MODE it was rendered for, so that is what opens.
 * A request for the Sketch mode is answered false: there is no sketch dialog,
 * and the strokes are edited by selecting them on the sheet.
 */
export function openAnalysisEditorForObject(objectId, mode = null) {
    const object = (drawingState.objects || []).find((candidate) => candidate.id === objectId);

    if (!object) {
        return false;
    }

    if (mode === "sketch" || mode === "plot") {
        if (!isAnalysedDiagram(object)) {
            return false;
        }

        return openAnalysisEditorMode(object, mode);
    }

    return openAnalysisEditorFor(object);
}

export default {
    ANALYSIS_EDITOR_TYPES,
    PLOT_EDITOR_TOOL_TYPES,
    analysisEditorsFor,
    defaultAnalysisEditorFor,
    isAnalysedDiagram,
    openAnalysisEditorFor,
    openAnalysisEditorMode,
    openAnalysisEditorForObject
};
