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
 * WHAT REMAINS IS NOT FEATURES CONTENT. Sketch and Plot are the two modes of the
 * analysis-diagram editor, opened from a feature's own property row and from the
 * placement commit. They are a dialog, not a panel, and they are still needed -
 * so they stay here, with the one import they depend on.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDiagramEquations from "../model/analysis/diagram-equations.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import enggPlotEditor from "../../../shared/ui/editors/plot-editor.js";
import enggSketchEditor from "../../../shared/ui/editors/sketch-editor.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";

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
 * The Features tab offers an editor per half of the diagram (Sketch Editor and
 * Plot Editor), so a plot can be opened on a diagram saved as a sketch and vice
 * versa. That is the SAME dialog, opened on the SAME model - only the half being
 * edited differs - so there is no second editing path to keep in step.
 */
export function openAnalysisEditorMode(object, mode) {
    if (!object || !object.geometry) {
        return false;
    }

    if (mode === "plot") {
        return isAnalysedDiagram(object) ? openPlotEditorFor(object, object.geometry) : false;
    }

    return openSketchEditorFor(object, object.geometry);
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
 * OPENING A SKETCH.
 *
 * The twin of the Plot branch above, and deliberately the same shape: the
 * same title, the same range, the same preview-then-apply contract, the same
 * legacy-cleanup. The only difference is that what is being edited is a list
 * of drawn elements rather than a list of equations.
 *
 * The sketch elements live on the feature's own geometry, and nowhere else.
 * They are not ordinary Lines on the sheet: a line drawn here belongs to the
 * diagram, moves with it, and is deleted with it. Storing them as document
 * features would make each one an independent thing the student could
 * select, move and delete on its own - and a sketch element that can be
 * dragged off its own diagram is not part of any diagram.
 */
function openSketchEditorFor(object, geometry) {
    const editor = enggSketchEditor;
    const equations = enggDiagramEquations;

    if (!editor || !equations) {
        return false;
    }

    const before =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    editor.open({
        title: `${
            equations.titleFor(geometry.diagramType)
        } - Sketch`,
        range: geometry.localRange,
        elements: geometry.sketchElements || [],

        /*
         * THE DIAGRAM'S OWN VERTICAL EXTENT.
         *
         * The sketch's y-scale is fixed when the editor opens, and this is the
         * value it is fixed against: the same extent the PLOTTED mode draws to,
         * so switching between drawing and plotting a diagram shows it at one
         * size, and a sketch that is empty still has a real y-axis.
         */
        yRange: Number(geometry.yRange) || Number(geometry.unitHeight) || 0,

        /*
         * THE ORDINATE'S UNIT, from the diagram's own axis definition - kN
         * for a shear or axial diagram, kN·m for a bending moment. The Y-value
         * popup states the number in it, so the student sees "250 kN" rather
         * than a bare 250.
         */
        yUnit:
            enggDrawingRenderer?.ANALYSIS_DIAGRAM_AXES?.[
                geometry.diagramType
            ]?.unit || "",

        /*
         * THE BODY'S ELEMENT STATIONS, for the graph's ticks.
         *
         * These are the same live references the diagram already derives from
         * its source body on every pass, so the sketch's ticks are the real
         * x-locations of the forces, supports, loads and connections on the
         * member - and they follow the body, rather than being a second list
         * the sketch would have to keep in step.
         */
        stations: geometry.referencePositions || [],
        onPreview: (elements) => {
            geometry.sketchElements = elements;

            /*
             * The flag the renderer reads to decide whether the plot-area
             * highlight is earned. It is derived from the elements rather
             * than set by them, so it cannot disagree with what is actually
             * there - and an empty sketch shows no highlight, which is the
             * point of the flag.
             */
            geometry.sketchContent =
                elements.length > 0;

            renderCurrentDrawing();
        },
        onApply: (elements, metrics) => {
            geometry.sketchElements = elements;

            /*
             * THE SCALE THE SKETCH WAS DRAWN AT IS STORED WITH IT.
             *
             * Graph-local y values mean nothing without the units-per-value
             * the stroke was drawn to. Storing it here is what makes the sheet
             * and the generated source place the curve at ONE height: both
             * read `geometry.unitHeight` first, and re-deriving it from the
             * strokes later (as a shortened curve would) is what used to make a
             * saved sketch silently change size.
             */
            if (metrics && Number(metrics.unitHeight) > 0) {
                geometry.unitHeight = Number(metrics.unitHeight);
            }

            geometry.sketchContent =
                elements.length > 0;

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
 * THE EDITORS A FEATURE OFFERS, AND OPENING ONE BY ITS BUTTON
 * ========================================================
 *
 * The Features pane renders one button per editor a diagram has. The TWO halves
 * of an SFD, BMD or AFD - its hand-drawn strokes and its plotted curve - are BOTH
 * shown, because both exist on the one model the analysis tools create. Opening
 * either goes through `openAnalysisEditorMode`, which opens the SAME dialog the
 * placement commit opens, on the SAME object, with the same callbacks.
 *
 * The object's stored `mode` decides only which one the PLACEMENT opens; it is
 * not a reason to hide the other from the panel.
 */
/*
 * Reference tools that produce an editable sketch of their own (a Resultant's
 * vector triangle, a Force Components' two resolved arrows) are Diagram tools
 * too: their strokes are ordinary drawing content and are edited by the same
 * Sketch Editor. They are listed here so the Features tab offers it, and their
 * sketch elements live on their own geometry, exactly as a diagram's do.
 */
export const ANALYSIS_EDITOR_TYPES = Object.freeze([
    "analysis-diagram",
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram"
]);

/* The analysis tools whose Features tab carries a Sketch Editor. */
export const SKETCH_EDITOR_TOOL_TYPES = Object.freeze([
    "analysis-diagram",
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram",
    "resultant",
    "force-components"
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

    const editors = [];

    if (SKETCH_EDITOR_TOOL_TYPES.includes(object.type)) {
        editors.push({ id: "sketch", label: "Drawing", button: "Sketch Editor" });
    }

    if (PLOT_EDITOR_TOOL_TYPES.includes(object.type)) {
        editors.push({ id: "plot", label: "Plot", button: "Plot Editor" });
    }

    return editors;
}

/* The editor a diagram OPENS on when nobody names one: its own stored mode. */
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
 * The Features button names the MODE it was rendered for, so that is what opens
 * - a student pressing "Plot Editor" on a sketched SFD gets its plot, and the
 * diagram's own stored mode is left alone (it is the placement's choice, not the
 * editor's). Without a mode the feature's stored mode decides.
 */
export function openAnalysisEditorForObject(objectId, mode = null) {
    const object = (drawingState.objects || []).find((candidate) => candidate.id === objectId);

    if (!object) {
        return false;
    }

    if (mode === "sketch" || mode === "plot") {
        if (!SKETCH_EDITOR_TOOL_TYPES.includes(object.type) && !isAnalysedDiagram(object)) {
            return false;
        }

        return openAnalysisEditorMode(object, mode);
    }

    return openAnalysisEditorFor(object);
}

export default {
    ANALYSIS_EDITOR_TYPES,
    SKETCH_EDITOR_TOOL_TYPES,
    PLOT_EDITOR_TOOL_TYPES,
    analysisEditorsFor,
    defaultAnalysisEditorFor,
    isAnalysedDiagram,
    openAnalysisEditorFor,
    openAnalysisEditorMode,
    openAnalysisEditorForObject
};
