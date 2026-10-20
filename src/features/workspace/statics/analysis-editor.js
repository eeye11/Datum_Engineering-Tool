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
    if (!object || object.type !== 'analysis-diagram') {
        return false;
    }

    const equations =
        enggDiagramEquations;

    if (!equations) {
        return false;
    }

    const geometry = object.geometry || {};
    const mode = geometry.mode === 'plot'
        ? 'plot'
        : 'sketch';

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
    if (mode === 'sketch') {
        return openSketchEditorFor(object, geometry);
    }

    const editor =
        enggPlotEditor;

    if (!editor) {
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
        onApply: (elements) => {
            geometry.sketchElements = elements;

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
