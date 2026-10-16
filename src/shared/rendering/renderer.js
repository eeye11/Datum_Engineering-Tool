/* SVG renderer for the engineering drawing workspace. */
import enggErrorLog from "../../app/error-log.js";
import enggCanvasPalette from "./canvas-palette.js";
import { ensureSvg, setActiveTheme, setActiveZoom } from "./svg-primitives.js";
import { appendFeatureLabel } from "./annotation-render.js";
import { ANALYSIS_DIAGRAM_AXES, ANALYSIS_DIAGRAM_TINTS, ANALYSIS_FRAME, analysisFrameExtents, analysisPlotMarks, analysisSketchMarks, analysisValueAt, equationLabels } from "./analysis-render.js";
import { appendEntity } from "./entity-render.js";
import { renderEngineeringGrid, renderInferenceLine, renderSelectionBox, renderSelectionHandles, renderSnapIndicator } from "./overlay-render.js";
import { renderPreview } from "./preview-render.js";


    /*
     * ========================================================
     * MAIN RENDERER
     * ========================================================
     */

    /*
     * Report features that could not be drawn.
     *
     * Collected for the whole pass and reported once, so a drawing with a dozen
     * broken features does not fill the console with a dozen identical stacks.
     *
     * The failures are LOGGED, never swallowed and never turned into a change
     * to the document: an error in one feature's renderer is a bug to be fixed,
     * and the evidence for it is the error and the feature's type and id.
     * Nothing here removes a feature, so a rendering problem can never become
     * data loss.
     */
    let lastRenderFailureSignature = null;

    function reportRenderFailures(failures) {
        const signature = failures
            .map(failure => `${failure.type}:${failure.error && failure.error.message}`)
            .join("|");

        /*
         * Reported when it CHANGES, rather than on every frame. A render runs
         * on every pointermove during a drag, and the same broken feature would
         * otherwise log continuously.
         */
        if (signature === lastRenderFailureSignature) {
            return;
        }

        lastRenderFailureSignature = signature;

        failures.forEach(failure => {
            enggErrorLog.reportError(
                "render feature",
                failure.error,
                { featureId: failure.id, featureType: failure.type }
            );
        });
    }

    function renderDrawing(
        state,
        canvas
    ) {
        if (!canvas) {
            return;
        }

        /*
         * THE ZOOM THIS FRAME IS DRAWN AT, recorded once so every font scale
         * in the whole pass agrees - see the note on `activeZoom`.
         */
        setActiveZoom(Number(state?.camera?.zoom) || 1);

        /*
         * AND THE THEME THIS FRAME IS PAINTED IN.
         *
         * Read from the document element, which is where `theme.js` records the
         * active theme - so the canvas resolves the SAME theme the interface is
         * showing, rather than keeping a second copy that could disagree. It is
         * captured per render rather than per feature, so every stroke in one
         * frame is resolved against one theme and a mid-render switch cannot
         * produce a sheet that is half light and half dark.
         *
         * This is also what makes the theme change take effect on the canvas: a
         * redraw re-reads the attribute, so the new theme is picked up without
         * anything having to notify the renderer.
         */
        setActiveTheme(enggCanvasPalette.activeCanvasTheme());

        const svg =
            ensureSvg(canvas);

        while (
            svg.firstChild
        ) {
            svg.removeChild(
                svg.firstChild
            );
        }

        const bounds =
            canvas.getBoundingClientRect();

        renderEngineeringGrid(svg, state, bounds);

        /*
         * Committed geometry
         *
         * EVERY FEATURE IS DRAWN IN ITS OWN TRY, AND A FAILURE IN ONE DOES
         * NOT STOP THE OTHERS.
         *
         * A drawing is a set of independent features, but the renderer draws
         * them in one pass - so an exception anywhere used to abandon the whole
         * repaint and leave a blank or half-drawn canvas, which is the moment a
         * student most fears their work is gone. The feature that failed is
         * almost never the only thing on the sheet.
         *
         * Containing it here keeps the guarantee the rest of the application
         * depends on: the MODEL stays authoritative. The feature that could not
         * be drawn is still in `state.objects`, still selectable, still
         * saveable - only its picture is missing. It is reported once per
         * render so the failure is visible rather than silent, and never
         * deleted.
         */
        const renderFailures = [];

        state.objects.forEach(
            entity => {
                try {
                    appendEntity(
                        svg,
                        entity,
                        state,
                        bounds
                    );
                } catch (error) {
                    renderFailures.push({
                        id: entity && entity.id,
                        type: entity && entity.type,
                        error
                    });
                }
            }
        );

        if (renderFailures.length) {
            reportRenderFailures(renderFailures);
        }

        /*
         * ========================================================
         * THE FEATURE'S OWN LABEL
         * ========================================================
         *
         * A second pass, over the SAME objects, drawing the label a student gave
         * a feature in the Features panel. It is deliberately not drawn inside
         * `appendEntity`: a label sits ON TOP of everything (so a line's label is
         * not clipped by the line), and keeping it in its own pass is what makes
         * "every feature's label" one behaviour rather than a branch per type -
         * which is exactly the branch that was missing for Line and Point.
         */
        state.objects.forEach((entity) => {
            try {
                appendFeatureLabel(svg, entity, state, bounds);
            } catch (error) {
                renderFailures.push({
                    id: entity && entity.id,
                    type: entity && entity.type,
                    error
                });
            }
        });

        /*
         * Live construction preview
         *
         * Must be rendered before snap feedback so that
         * the snap marker remains visually on top.
         */
        const activePreview = state.interaction.preview;
        for (const preview of state.interaction.previewObjects || []) {
            state.interaction.preview = preview;
            renderPreview(svg, state, bounds);
        }
        state.interaction.preview = activePreview;
        renderPreview(svg, state, bounds);

        renderInferenceLine(
            svg,
            state,
            bounds
        );

        /*
         * Snap marker
         */
        renderSnapIndicator(
            svg,
            state,
            bounds
        );

        /*
         * Selection rectangle
         */
        renderSelectionBox(
            svg,
            state,
            bounds
        );

        renderSelectionHandles(svg, state, bounds);
    }

    const enggDrawingRenderer = {
        renderDrawing,

        /*
         * THE ANALYSIS FRAME'S PUBLIC PARTS.
         *
         * Exposed so the Plot Editor draws its graph through the same
         * constants the canvas does. The editor is a second view of the
         * feature, not a second implementation of it, and the two drifting
         * apart - a different axis length here, a different scale there -
         * would mean the graph the student edited against is not the graph
         * they get.
         */
        ANALYSIS_FRAME,
        ANALYSIS_DIAGRAM_TINTS,
        ANALYSIS_DIAGRAM_AXES,
        analysisFrameExtents,
        analysisPlotMarks,
        analysisValueAt,
        analysisSketchMarks,
        equationLabels
    };

export default enggDrawingRenderer;
