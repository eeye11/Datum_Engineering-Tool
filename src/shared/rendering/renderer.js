/* SVG renderer for the engineering drawing workspace. */
import enggErrorLog from "../../app/error-log.js";
import enggCanvasPalette from "./canvas-palette.js";
import { ensureSvg, setActiveTheme, setActiveZoom, SVG_NAMESPACE } from "./svg-primitives.js";
import { appendFeatureLabel } from "./annotation-render.js";
import { ANALYSIS_DIAGRAM_AXES, ANALYSIS_DIAGRAM_TINTS, ANALYSIS_FRAME, analysisFrameExtents, analysisPlotMarks, analysisSketchMarks, analysisValueAt, equationLabels } from "./analysis-render.js";
import { appendEntity } from "./entity-render.js";
import { renderCrosshair, renderEngineeringGrid, renderInferenceLine, renderSelectionBox, renderSelectionHandles, renderSelectionOutline, renderSnapIndicator } from "./overlay-render.js";
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
        canvas,
        {
            overlayOnly = false,
            liveObjectIds = null,
            textEntryObjectId = state?.textEntryObjectId || null
        } = {}
    ) {
        if (!canvas) {
            return;
        }
        state = { ...state, textEntryObjectId };

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

        /*
         * ========================================================
         * THE OVERLAY PASS DRAWS INTO THE LAYER IT WAS GIVEN
         * ========================================================
         *
         * The canvas now holds two stacked SVGs: the compiled picture below,
         * and the interaction overlay above. The overlay pass is handed the
         * overlay LAYER, which is already an `<svg>` - so it is used as the
         * drawing surface directly.
         *
         * `ensureSvg` would otherwise create a NESTED `svg.drawing-renderer`
         * INSIDE the overlay, because it looks for that class rather than for
         * the element it was given. That nested renderer is dead weight - it
         * draws nothing the overlay does not, and its name is the marker the
         * rest of the application uses to mean "a second, model-drawn picture"
         * is present. A canvas showing the compiled source must never contain
         * one, so when the target already IS an SVG it is drawn into as-is.
         */
        const svg =
            canvas.namespaceURI === SVG_NAMESPACE &&
            canvas.tagName &&
            canvas.tagName.toLowerCase() === "svg"
                ? canvas
                : ensureSvg(canvas);

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

        /*
         * THE COMMITTED DRAWING IS THE COMPILED SOURCE'S, so an overlay pass
         * omits the feature geometry and labels the picture already shows. What
         * it keeps is everything that is about INTERACTION: the grid, the live
         * preview, the inference line, the snap marker, the box and the handles.
         *
         * EXCEPT THE OBJECTS THE PICTURE DOES NOT SHOW YET. `liveObjectIds`
         * names the objects whose model differs from the compiled picture on
         * screen - one being moved, or just edited and still compiling - and the
         * overlay draws those, so each object is seen where it really is.
         *
         * AND THE OBJECT WHOSE TEXT IS BEING TYPED. A node-entry prompt is
         * anchored to the object it writes into, and the whole point of the
         * prompt is that the object stays visible while it is open - so that
         * object is drawn by the overlay for as long as the entry lasts, whether
         * or not the picture on screen already shows it. `textEntryObjectId` is
         * set and cleared by the editor; nothing is written to the model.
         */
        const textEntryId = textEntryObjectId || null;

        const live = new Set(liveObjectIds || []);

        if (textEntryId) {
            live.add(textEntryId);
        }

        const drawn = overlayOnly
            ? (live.size
                ? state.objects.filter((entity) => entity && live.has(entity.id))
                : [])
            : state.objects;

        if (drawn.length) {
            drawn.forEach(
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
        if (drawn.length) {
            drawn.forEach((entity) => {
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
        }

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

        /*
         * THE SELECTION IS AN OUTLINE OVER THE PICTURE. A selected feature is
         * not redrawn in a highlight colour - the picture belongs to the
         * source - so it is marked instead.
         */
        renderSelectionOutline(svg, state, bounds);

        renderSelectionHandles(svg, state, bounds);

        /*
         * AND THE CONSTRUCTION CROSSHAIR, while one is running.
         *
         * It is drawn by the editor rather than asked for from the operating
         * system, so it is the same size at every DPI and cannot appear over the
         * panel or the Source editor - see `renderCrosshair`.
         */
        renderCrosshair(svg, state, bounds);
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
