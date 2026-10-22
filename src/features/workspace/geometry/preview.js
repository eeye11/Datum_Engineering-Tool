/*
 * The live preview while a tool is in use.
 */

import enggBodyFrames from "../../../shared/geometry/body-frames.js";
import enggQuantities from "../../../shared/units/quantities.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingRotationalArrow from "../model/analysis/rotational-arrow.js";
import { analysisAxisForPlacement } from "../statics/analysis-tools.js";
import { isAnnotationTool } from "../annotate/annotation-tool.js";
import { annotateInstruction, isAnnotateTool, updateAnnotateAnchorPreview } from "../annotate/annotate-creation.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { isProcessPlotTool } from "../thermodynamics/process-path.js";
import { arcThroughThreePoints, distance, rectangleGeometry, resolveCentrepointArc } from "./construction-geometry.js";
import { dimensionSelectionInstruction } from "../annotate/dimension-placement.js";
import { isDimensionTool } from "../annotate/dimension-tool.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { polygonFromCursor, closingFreeformPolygon } from "./geometry-creation.js";
import { LOAD_BUILD_PHASES, constantLoadDraft, distributedLoadDirectionCursor, distributedLoadDraft, isLoadBuildPhase, isLoadSpanPhase, loadBuildInstruction } from "../statics/load-tool.js";
import { constructionFeedbackMessage, inferenceLabel, snapTypeLabel, updateInteractionFeedback } from "../interaction/pointer.js";
import { STATICS_CHILD_TOOLS, STATICS_SPAN_TOOLS, bodyPlacementLocations, isBodyAttachedTool, staticsBodyMessage, staticsSpanInstruction, staticsToolPointCount } from "../statics/statics-tools.js";
import { isArcTool } from "../../../components/layout/toolbar/tool-menus.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { trussSnapGeometry, trussStageMessage } from "../statics/truss-tool.js";
import { isSupportType } from "../../../shared/model/feature-types.js";
import { applyStaticsValue, openLoadValuePopup, readStaticsValue } from "../../../shared/ui/editors/load-value-popup.js";
import { ROUTE_PHASE, routeInstruction, routeSegmentPreview } from "../interaction/pipe-duct-tool.js";

/*
 * The colour every construction preview is drawn in.
 *
 * It is deliberately NOT a theme token: previews are transient guides that
 * exist only while a tool is mid-construction, so they are painted in a
 * fixed signal colour that reads as "this is not a feature yet" in either
 * theme. Keeping it in one named constant also means the renderer has a
 * single thing to key off when deciding how to treat a preview stroke.
 */
const PREVIEW_STROKE =
    "#1f5c38";

export function createPreview(
    type,
    geometry
) {
    return {
        id:
            `preview-${type}`,

        type,

        geometry,

        style: {
            stroke:
                PREVIEW_STROKE,
            fill: "none",
            lineWidth: 0.5,
            lineType: "dashed",
            opacity: 1
        }
    };
}

/*
 * ========================================================
 * REPORTING THE STATUS FROM ANY BRANCH
 * ========================================================
 *
 * `updatePreview` has several places where a tool has its own preview to
 * drive - an analysis axis, a moment's radius, an annotation's position, a
 * dimension's placement - and each of them returns early.
 *
 * Every one of those returns used to skip the status text. The snap and
 * inference half of that text is appended by a separate call, so on those
 * tools the LAST snap the cursor happened to make stayed printed for as long
 * as the tool was active - long after the cursor had left whatever it was
 * aligned with. It reads as a live report because it is one, only an old
 * one: the student drags somewhere unaligned and cannot tell whether the
 * snap still holds or the label is simply stale.
 *
 * One function, called from every branch, so a branch added later cannot
 * forget. It is deliberately thin: the wording rules live in
 * `constructionFeedbackMessage`, and this only decides THAT it is called.
 */
function reportConstructionStatus(
    resolution,
    fallback
) {
    setToolMessage(
        constructionFeedbackMessage(
            resolution,
            fallback
        )
    );
}

/*
 * THE SAME THING, BUT WITH THE RIGHT INSTRUCTION.
 *
 * `updateInteractionFeedback` already knows the current instruction for the
 * active tool and phase - an arc's four phases each have their own, and it
 * has always preferred the snap and inference text over them. This exists so
 * a branch that returns early can rebuild the status through THAT decision
 * rather than inventing a second one.
 *
 * An earlier version passed a literal to every branch, which would have
 * replaced "Specify arc start point" with whatever the branch happened to
 * say - the exact substitution that `constructionFeedbackMessage` was written
 * to prevent.
 */
function reportLiveConstructionStatus(
    resolution
) {
    updateInteractionFeedback(
        resolution
    );
}

export function updatePreview(
    resolution
) {
    const interaction =
        drawingState.interaction;

    /*
     * THE ANALYSIS AXIS PREVIEW FOLLOWS THE CURSOR.
     *
     * Handled before the phase test below, for the same reason the
     * dimension preview is: this placement is not drawing a span. The
     * axis is already determined by the source - its length, its
     * direction, where it starts - and the only thing still undecided
     * is how far above or below the drawing it sits. So there is no
     * first point and no second point; there is a height, and this is
     * where it follows the pointer.
     *
     * The preview geometry is DERIVED on every frame from the source
     * rather than nudged, which is what keeps the axis the same length
     * and the same direction as the source no matter where the cursor
     * goes. A preview that was dragged freely would let the student
     * place a diagram no longer the size of its beam, and find that
     * out only after the click.
     *
     * Written straight onto the interaction for the same reason the
     * dimension preview is: this is a per-frame pointer position and
     * not a change of state, so it must not become a history entry.
     */
    if (
        interaction.phase ===
            "analysis-axis"
    ) {
        const axis =
            analysisAxisForPlacement();

        if (axis) {
            interaction.analysisPlacement = {
                start: axis.start,
                end: axis.end,
                diagramType:
                    interaction.analysisKind
            };
        }

        /*
         * ========================================================
         * AND THE STATUS IS REWRITTEN HERE, NOT LEFT BEHIND
         * ========================================================
         *
         * This branch used to return without touching the status text. The
         * snap and inference half of that text is APPENDED by
         * `updateInteractionFeedback` a few lines away - so whatever the
         * cursor happened to be aligned with on the previous frame stayed
         * printed for as long as the placement lasted, long after the
         * cursor had moved off anything at all.
         *
         * It reads as a live report because it IS one, just an old one: the
         * student drags the axis somewhere unaligned, sees "Horizontal"
         * still beside their instruction, and cannot tell whether the snap
         * is still holding or the label is simply stale.
         *
         * So it is rebuilt from THIS frame's resolution - which the
         * analysis placement path populates through the ordinary snapping
         * pipeline, exactly as every other tool does. Nothing analysis-
         * specific about it: the same tolerance, the same candidates, the
         * same wording.
         */
        setToolMessage(
            constructionFeedbackMessage(
                resolution,
                "Place analysis axis"
            )
        );

        return;
    }

    if (
        interaction.phase ===
            "moment-radius"
    ) {
        const centre =
            interaction.startPoint;

        if (centre) {
            /*
             * THE RADIUS FOLLOWS THE CURSOR AS A DISTANCE.
             *
             * Measured in SCREEN pixels from the fixed application
             * point, so the arc the student is sizing is the size it
             * will actually appear at on the sheet. A world distance
             * would make the drawn size depend on the zoom, and the
             * radius chosen at one zoom would produce a different
             * looking symbol at the next.
             *
             * The centre is never touched: the application point is
             * fixed by the first click, and only the size of the
             * symbol around it is being chosen here.
             */
            const scale =
                enggDrawingState
                    .basePixelsPerUnit
                    ? enggDrawingState
                        .basePixelsPerUnit(drawingState) *
                        (Number(
                            drawingState.camera.zoom
                        ) || 1)
                    : 1;

            const reach =
                distance(
                    centre,
                    resolution.effectiveConstructionPoint
                ) * (scale || 1);

            /*
             * A floor, so a click that did not move the pointer still
             * leaves a visible symbol rather than a dot too small to
             * aim at.
             */
            interaction.radiusPx =
                enggDrawingRotationalArrow
                    .clampArcRadius(
                        Number.isFinite(reach) && reach > 0
                            ? reach
                            : enggDrawingRotationalArrow
                                .DEFAULT_ARC_RADIUS_PX
                    );
        }

        reportConstructionStatus(
            resolution,
            "Specify moment size"
        );

        return;
    }

    /*
     * THE DIMENSION PREVIEW FOLLOWS THE CURSOR
     *
     * Handled before the phase test below, because an armed dimension
     * has no construction phase - it is not drawing anything, it is
     * measuring something that already exists and only deciding where
     * to stand while it says so.
     *
     * Written directly to the interaction rather than through
     * setInteraction, because this is a per-frame pointer position
     * and not a change of state: it must not become a history entry,
     * and the renderer already redraws on every move.
     */
    if (
        isAnnotationTool(
            drawingState.activeTool
        ) &&
        interaction.annotationKind
    ) {
        const point =
            resolution.effectiveConstructionPoint;

        if (point) {
            interaction.annotationPlacement =
                {
                    x: point.x,
                    y: point.y
                };
        }

        reportConstructionStatus(
            resolution,
            "Specify note position"
        );

        return;
    }

    /*
     * AN ARMED ANNOTATE MARK, PREVIEWING TO THE CURSOR.
     *
     * A leader, a callout and an arrow hold their first end and follow the
     * cursor to their second. The preview is written to the INTERACTION
     * only - the document is untouched until the commit - and the renderer
     * draws it from `annotateStart`/`annotateEnd`, so there is one drawing
     * path for the preview and the feature.
     *
     * Handled before the construction phases below because an armed
     * annotation has no construction phase at all: it is a mark being
     * positioned, not geometry being built.
     */
    if (
        isAnnotateTool(
            drawingState.activeTool
        ) &&
        interaction.annotateStage === "anchor"
    ) {
        updateAnnotateAnchorPreview(resolution);

        reportConstructionStatus(
            resolution,
            annotateInstruction(
                drawingState.activeTool
            )
        );

        return;
    }

    /*
     * THE DIMENSION'S TWO LIVE STAGES.
     *
     * PLACEMENT: the references are settled and only the annotation's
     * position is undecided, so it follows the cursor.
     *
     * WAITING FOR THE SECOND REFERENCE: a first point has been chosen
     * and the tool is asking for its partner. There is nothing to place
     * yet, but the status still has to be rebuilt from THIS frame's
     * resolution so a stale snap label cannot linger after the cursor
     * leaves whatever it was aligned with.
     *
     * Both are written directly to the interaction rather than through
     * setInteraction, because a per-frame pointer position is not a
     * change of state and must not become a history entry.
     */
    if (
        isDimensionTool(
            drawingState.activeTool
        ) &&
        interaction.dimensionStage ===
            "placement" &&
        interaction.dimensionRefs?.length
    ) {
        const point =
            resolution.effectiveConstructionPoint;

        if (point) {
            interaction.dimensionPlacement =
                {
                    x: point.x,
                    y: point.y
                };
        }

        reportConstructionStatus(
            resolution,
            "Place the dimension"
        );

        return;
    }

    /*
     * ARMED: a complete single measurement is previewed and following the
     * cursor, but the tool is still accepting a second reference.
     *
     * This is the stage that lets one line's length appear at once AND a
     * second line still turn the pair into an angle. The placement position
     * tracks the pointer exactly as it does in `placement`, so the preview
     * looks identical; only what the NEXT CLICK means differs.
     */
    if (
        isDimensionTool(
            drawingState.activeTool
        ) &&
        interaction.dimensionStage ===
            "armed" &&
        interaction.dimensionRefs?.length
    ) {
        const point =
            resolution.effectiveConstructionPoint;

        if (point) {
            interaction.dimensionPlacement =
                {
                    x: point.x,
                    y: point.y
                };
        }

        reportConstructionStatus(
            resolution,
            "Click another reference for an angle, or click empty space to place"
        );

        return;
    }

    if (
        isDimensionTool(
            drawingState.activeTool
        ) &&
        interaction.dimensionStage === "selecting"
    ) {
        /*
         * While references are being chosen the pointer does not move
         * anything - it is only hovering to show what the next click
         * would pick. The instruction restates how many are held and
         * that Enter decides, so the way out of this stage is never in
         * doubt.
         */
        reportConstructionStatus(
            resolution,
            dimensionSelectionInstruction(
                interaction.dimensionPickedRefs || []
            )
        );

        return;
    }

    if (
        isDimensionTool(
            drawingState.activeTool
        ) &&
        !interaction.dimensionStage
    ) {
        reportConstructionStatus(
            resolution,
            "Specify dimension reference"
        );

        return;
    }

    if (
        interaction.phase ===
            "idle"
    ) {
        return;
    }

    /*
     * Most two-click tools need a start point before they have
     * anything to preview. A progressive construction is
     * different: a truss clears its start point between members
     * and still has a live preview, because what it previews is
     * the whole structure so far rather than one span. So the
     * requirement is a start point OR a construction of its own.
     */
    const progressive =
        interaction.phase ===
            "truss-construct" ||
        interaction.phase ===
            ROUTE_PHASE ||
        isLoadBuildPhase(interaction) ||
        isLoadSpanPhase(interaction);

    if (
        !progressive &&
        !interaction.startPoint &&
        !interaction.routeSegmentStart
    ) {
        /*
         * No start point yet, so this tool has nothing to preview - but the
         * status still has to be REBUILT, because whatever snap the cursor
         * was making a moment ago would otherwise stay printed through the
         * whole of the first half of the construction.
         */
        reportLiveConstructionStatus(
            resolution
        );

        return;
    }

    const point =
        resolution.effectiveConstructionPoint;

    interaction.currentPoint =
        point;

    if (
        drawingState.activeTool ===
            "line"
    ) {
        interaction.preview =
            createPreview(
                "line",
                {
                    start:
                        interaction.startPoint,

                    end:
                        point
                }
            );

        if (
            !resolution.inference &&
            !resolution.snapCandidate
        ) {
            setToolMessage(
                "Specify line endpoint"
            );
        } else {
            /*
             * An active inference or snap owns the
             * status line, so show its name instead of
             * letting a stale message linger.
             */
            const feedback =
                [
                    inferenceLabel(
                        resolution.inference
                    ),

                    snapTypeLabel(
                        resolution
                            .snapCandidate
                            ?.type
                    )
                ].filter(Boolean);

            if (feedback.length) {
                setToolMessage(
                    feedback.join(
                        " · "
                    )
                );
            }
        }
    } else if (
        drawingState.activeTool ===
        "coordinate-system-2d"
    ) {
        /*
         * THE AXIS PREVIEWS AS THE CROSS IT WILL BECOME.
         *
         * The press placed the origin; the pointer says which way the X arm
         * runs and how long it is. The Y arm is drawn square to it, from the
         * same two points the commit uses, so the preview and the placed axis
         * are the same cross - and the perpendicularity the student sees is
         * the perpendicularity the code will write. A drag too short to give
         * the axis a direction shows nothing rather than a degenerate cross.
         */
        const arm = Math.hypot(
            point.x - interaction.startPoint.x,
            point.y - interaction.startPoint.y
        );

        if (arm > 1e-9) {
            interaction.preview =
                createPreview(
                    "coordinate-system-2d",
                    {
                        origin: {
                            ...interaction.startPoint
                        },

                        rotation: Math.atan2(
                            point.y - interaction.startPoint.y,
                            point.x - interaction.startPoint.x
                        ),

                        xPositiveLength: arm,
                        xNegativeLength: arm,
                        yPositiveLength: arm,
                        yNegativeLength: arm
                    }
                );

            if (
                !resolution.inference &&
                !resolution.snapCandidate
            ) {
                setToolMessage(
                    "Release to place the X axis"
                );
            }
        } else {
            interaction.preview = null;
        }
    } else if (
        drawingState.activeTool ===
        "circle"
    ) {
        interaction.preview =
            createPreview(
                "circle",
                {
                    center:
                        interaction.startPoint,

                    radius:
                        distance(
                            interaction.startPoint,
                            point
                        )
                }
            );

        setToolMessage(
            "Specify radius"
        );
    } else if (
        drawingState.activeTool === "rectangle" ||
        ["control-volume", "tank"].includes(drawingState.activeTool) ||
        ["saturation-curve", "process-plot"].includes(drawingState.activeTool) ||
        ["piston-cylinder", "piston-cylinder-stoppers"].includes(drawingState.activeTool)
    ) {
        /*
         * SHIFT MAKES THE RECTANGLE A SQUARE.
         *
         * The modifier is recorded on the interaction for this frame, so the
         * committed shape uses the SAME constraint the preview showed - a
         * preview that squared up while the commit did not would hand back a
         * different rectangle from the one the student was looking at.
         *
         * The constraint is applied to the second corner, not the first: the
         * press decided where the shape begins, and Shift only says the two
         * extents are equal.
         */
        const square = Boolean(resolution.modifiers?.shift);

        interaction.squareConstrained = square;

        interaction.preview =
            createPreview(
                "rectangle",
                rectangleGeometry(
                    interaction.startPoint,
                    point,
                    { square }
                )
            );

        if (["tank", "saturation-curve", "process-plot"].includes(drawingState.activeTool)) {
            interaction.preview.metadata = { thermodynamicsKind: drawingState.activeTool };
        }

        setToolMessage(
            square
                ? "Specify opposite corner (square)"
                : "Specify opposite corner"
        );
    } else if (
        drawingState.activeTool === "polyline" ||
        isProcessPlotTool(drawingState.activeTool)
    ) {
        interaction.preview =
            createPreview(
                "polyline",
                {
                    points: [
                        ...interaction.points,
                        point,
                        ...(drawingState.activeTool === "freeform-polygon" &&
                        interaction.points.length >= 3 &&
                        resolution.snapCandidate?.type === "endpoint" &&
                        distance(
                            resolution.snapCandidate.point,
                            interaction.points[0]
                        ) < 1e-9
                            ? [interaction.points[0]]
                            : [])
                    ]
                }
            );

        if (drawingState.activeTool === "process-path") {
            interaction.preview.metadata = { thermodynamicsKind: "process-path", stateCount: interaction.points.length };
            interaction.preview.style.stroke = "#dc2626";
        }
        if (drawingState.activeTool === "constant-temp-pressure-lines") {
            interaction.preview.style.stroke = "#808080";
            interaction.preview.style.lineType = "dashed";
            interaction.preview.metadata = { thermodynamicsKind: "constant-temp-pressure-lines" };
        }

        setToolMessage(
            "Click next point or double-click to finish"
        );
    } else if (
        drawingState.activeTool === "freeform-polygon"
    ) {
        /*
         * A Freeform Polygon previews as the CLOSED shape it will become:
         * the vertices placed so far, the point under the cursor, and the
         * first vertex repeated so the closing edge is visible while the
         * student decides where to put the next one. It is drawn as a
         * polygon rather than a polyline so the preview reads as a region
         * rather than an open chain.
         */
        interaction.preview =
            createPreview(
                "polygon",
                {
                    points: [
                        ...interaction.points,
                        point
                    ]
                }
            );

        setToolMessage(
            closingFreeformPolygon(point)
                ? "Release to close the polygon"
                : "Click next vertex, or drag to the first vertex to close"
        );
    } else if (
        isArcTool() &&
        interaction.phase ===
            "arc-centre"
    ) {
        /*
         * Radius phase: show the circle the cursor
         * is describing around the fixed centre.
         */
        const radius =
            distance(
                interaction.points[0],
                point
            );

        if (
            radius >
            1e-9
        ) {
            interaction.preview =
                createPreview(
                    "circle",
                    {
                        center: {
                            ...interaction.points[0]
                        },

                        radius
                    }
                );
        } else {
            interaction.preview =
                null;
        }

        setToolMessage(
            "Specify arc start point"
        );
    } else if (
        isArcTool() &&
        interaction.phase ===
            "arc-sweep"
    ) {
        /*
         * Sweep phase: live arc from the start point
         * through the cursor.
         */
        const geometry =
            resolveCentrepointArc(
                interaction,
                point
            );

        interaction.preview =
            geometry
                ? createPreview(
                    "arc",
                    geometry
                )
                : null;

        setToolMessage(
            "Specify arc endpoint"
        );
    } else if (
        isArcTool() &&
        interaction.phase ===
            "arc-first"
    ) {
        interaction.preview =
            createPreview(
                "line",
                {
                    start:
                        interaction.points[0],

                    end:
                        point
                }
            );

        setToolMessage(
            "Specify point on arc"
        );
    } else if (
        isArcTool() &&
        interaction.phase ===
            "arc-second"
    ) {
        /*
         * Third point preview: the circumcircle arc
         * through the two placed points and the cursor.
         */
        const geometry =
            arcThroughThreePoints(
                interaction.points[0],
                interaction.points[1],
                point
            );

        interaction.preview =
            geometry
                ? createPreview(
                    "arc",
                    geometry
                )
                : null;

        /*
         * An active inference or snap owns the status line,
         * otherwise show the next instruction. Without this
         * the plain instruction would overwrite the
         * Horizontal / Vertical / snap label set by the
         * feedback pass, because the preview runs after it.
         */
        const feedback =
            [
                inferenceLabel(
                    resolution.inference
                ),

                snapTypeLabel(
                    resolution.snapCandidate?.type
                )
            ].filter(Boolean);

        setToolMessage(
            feedback.length
                ? feedback.join(" · ")
                : "Specify third point"
        );
    } else if (
        drawingState.activeTool ===
        "triangle"
    ) {
        /*
         * Live preview of all three sides, closed
         * back to the first point.
         */
        interaction.preview =
            createPreview(
                "triangle",
                {
                    points: [
                        ...interaction.points,
                        point
                    ],

                    closed: true
                }
            );

        /*
         * An active inference or snap owns the status
         * line, otherwise show the next instruction.
         */
        const feedback =
            [
                inferenceLabel(
                    resolution.inference
                ),

                snapTypeLabel(
                    resolution.snapCandidate?.type
                )
            ].filter(Boolean);

        setToolMessage(
            feedback.length
                ? feedback.join(" · ")
                : interaction.points.length < 2
                    ? "Specify second point"
                    : "Specify third point"
        );
    } else if (
        drawingState.activeTool ===
            "polygon" &&
        (
            interaction.phase ===
                "polygon-centre" ||
            interaction.phase ===
                "polygon-first"
        )
    ) {
        /*
         * Live polygon. By Centre sizes it from the
         * centre, By Sides builds it from the first
         * edge, but both feed the same preview.
         */
        const geometry =
            polygonFromCursor(
                interaction,
                point
            );

        interaction.preview =
            geometry
                ? createPreview(
                    "polygon",
                    geometry
                )
                : null;

        const feedback =
            [
                inferenceLabel(
                    resolution.inference
                ),

                snapTypeLabel(
                    resolution.snapCandidate?.type
                )
            ].filter(Boolean);

                const instruction =
                    interaction.phase ===
                    "polygon-first"
                    ? "Specify second point"
                    : "Specify polygon radius";

                setToolMessage(
                    feedback.length
                        ? feedback.join(" · ")
                        : instruction
                );
            } else if (
                drawingState.interaction.phase ===
                    "truss-construct"
            ) {
                /*
                 * Live preview of the member in progress. It is drawn
                 * from the same start point the committed member will
                 * use, so the preview and the result agree.
                 */
                interaction.preview =
                    createPreview(
                        "line",
                        {
                            start:
                                interaction.trussInProgress,
                            end: point
                        }
                    );

                /*
                 * The whole construction is handed to the snap
                 * system, so a member snaps to a joint or an
                 * intersection of the members already placed as
                 * readily as it snaps to the finished drawing.
                 */
                interaction.snapGeometry =
                    trussSnapGeometry(
                        {
                            ...interaction,
                            currentPoint: point
                        }
                    );

                interaction.snapQuarterSnap = true;
                interaction.snapToolId = "truss";

                setToolMessage(
                    trussStageMessage(
                        interaction
                    )
                );
            } else if (
                drawingState.interaction.phase ===
                    ROUTE_PHASE
            ) {
                /*
                 * THE SEGMENT BEING DRAGGED IS PREVIEWED AS THE PIPE / DUCT
                 * IT WILL BECOME - BOTH BOUNDARY LINES, at the fixed
                 * schematic spacing.
                 *
                 * This is the same geometric generation the committed feature
                 * uses (see fluids/pipe-duct.js -> `boundaryLines`), so the two
                 * boundary lines cannot jump when the button is released: the
                 * preview is
                 * not a drawing OF the feature, it IS the feature's geometry,
                 * painted in the preview stroke until it is committed.
                 *
                 * A `pipe-duct` preview is therefore not a plain `line`: a
                 * centreline preview would show the student one stroke and then
                 * hand them two, which is exactly the jump the acceptance
                 * criteria call out.
                 */
                const preview = routeSegmentPreview(
                    drawingState.interaction,
                    point
                );

                interaction.preview = preview
                    ? createPreview(
                          "pipe-duct",
                          preview
                      )
                    : null;

                /*
                 * THE RUN'S OWN ENDPOINTS ARE HANDED TO THE SNAP SYSTEM, so the
                 * end of the drag snaps to the start of the run, to a bend, or
                 * to a run already placed. It is the SEGMENT's centreline that
                 * snaps - not its two walls - because the walls are derived from
                 * it and would otherwise offer the student three places to aim
                 * at for one endpoint.
                 */
                interaction.snapGeometry =
                    preview
                        ? [
                              {
                                  start:
                                      preview.start,
                                  end: preview.end
                              }
                          ]
                        : [];

                interaction.snapToolId = "pipe-duct";

                setToolMessage(
                    routeInstruction(
                        drawingState.interaction
                    )
                );
            } else if (
                isLoadSpanPhase(
                    drawingState.interaction
                )
            ) {
                /*
                 * While the loaded span is being chosen by hand
                 * the load is previewed as the plain span it will
                 * become, using the same Line preview every other
                 * two-click tool uses.
                 */
                interaction.preview =
                    createPreview(
                        "line",
                        {
                            start:
                                interaction
                                    .points[0],
                            end: point
                        }
                    );

                setToolMessage(
                    constructionFeedbackMessage(
                        resolution,
                        "Specify the end of the loaded span"
                    )
                );
            } else if (
                LOAD_BUILD_PHASES.has(
                    drawingState.interaction
                        .phase
                )
            ) {
                /*
                 * ========================================================
                 * THE PREVIEW, AND WHAT IT SHOWS DEPENDS ON THE STEP
                 * ========================================================
                 *
                 * With only a body chosen there is nothing to preview, and
                 * the old code previewed a full-body load here - which is
                 * what made the region look decided before the student had
                 * decided it.
                 *
                 * Once BOTH ends are placed the region exists, and during the
                 * vector step the draft also carries the magnitude and the
                 * direction read from the pointer. So the field of arrows is
                 * drawn over exactly the region chosen, turning and growing
                 * with the cursor as it moves - and the arrows shown
                 * immediately before the click are the arrows committed.
                 *
                 * THE CURSOR IS PASSED IN. The vector step is defined by the
                 * pointer about the region's midpoint, so a draft built
                 * without one could only ever show the region and not the
                 * load - which is how the direction came to look fixed to
                 * the body.
                 */
                const constant =
                    constantLoadDraft(
                        drawingState.interaction,
                        point,

                        /*
                         * THE DIRECTION IS READ FROM THE ACTUAL POINTER.
                         *
                         * `point` is the resolved construction point, which
                         * is SNAPPED - near an end of the span it becomes
                         * that end exactly. Feeding it to the vector made the
                         * direction swing to the midpoint-to-endpoint diagonal
                         * as the cursor crossed the span. The direction is
                         * therefore measured to the raw (or H/V-constrained)
                         * cursor instead, and it is the same reading the
                         * commit uses, so the preview is the load that gets
                         * created.
                         */
                        distributedLoadDirectionCursor(
                            resolution
                        )
                    );

                /*
                 * ========================================================
                 * THE PREVIEW IS THE FINAL LOAD, BUILT BY THE SAME CODE
                 * ========================================================
                 *
                 * The field of arrows is not drawn by the preview and again
                 * by the feature. It is built here with the SAME factory the
                 * commit uses, from the same numbers, so what the student is
                 * shown is what they get. A preview assembled differently
                 * from the result is how a load ends up somewhere else once
                 * the click lands.
                 *
                 * It is dashed so it is obviously provisional, but its
                 * ARROWS are the real ones: the same span, the same
                 * intensity, the same direction, the same arrow count and the
                 * same spacing.
                 */
                const magnitude =
                    Math.max(0, Number(constant?.magnitude) || 0);

                interaction.preview =
                    constant && magnitude > 0
                        ? {
                            id: "preview-constant-load",
                            type: "load",

                            geometry: {
                                start: constant.start,
                                end: constant.end,

                                /*
                                 * THE DIRECTION THE VECTOR CHOSE, in degrees.
                                 * It is null until the pointer is off the
                                 * origin; the renderer then falls back to its
                                 * own default, so the region can be seen
                                 * before any direction means anything.
                                 */
                                direction:
                                    constant.direction ?? null,

                                /*
                                 * A constant load is the
                                 * degenerate profile: the same
                                 * magnitude at both ends of the
                                 * body. It is stored that way
                                 * rather than as a special
                                 * case, so the renderer, the
                                 * panel and Fit all read one
                                 * model.
                                 */
                                points: [
                                    {
                                        t: 0,
                                        magnitude
                                    },
                                    {
                                        t: 1,
                                        magnitude
                                    }
                                ]
                            },

                            style: {
                                stroke:
                                    drawingState
                                        .styleDefaults
                                        ?.stroke ||
                                    PREVIEW_STROKE,
                                fill: "none",
                                lineWidth: 0.5,
                                lineType:
                                    "dashed",
                                opacity: 1
                            }
                        }
                        : null;

                setToolMessage(
                    constructionFeedbackMessage(
                        resolution,
                        /*
                         * THE INSTRUCTION MATCHES THE STEP.
                         *
                         * This said "move to set the load magnitude and
                         * direction, then click" for all four steps - one
                         * sentence for two separate decisions, describing
                         * an interaction that did not exist. The student
                         * was told to do something no sequence of clicks
                         * could do.
                         *
                         * Each step now says what it is waiting for, and
                         * the snap and inference half is appended by the
                         * shared builder as usual - so a student being
                         * shown "Vertical" while choosing a direction sees
                         * both.
                         */
                        loadBuildInstruction(
                            drawingState.interaction
                                .phase
                        )
                    )
                );
            } else if (
                drawingState.interaction
                    .phase ===
                    "distributed-load-build"
            ) {
                /*
                 * The load previews as the very feature it is
                 * about to become: a continuous field of parallel
                 * arrows whose lengths follow the cursor. The
                 * preview is rebuilt from the interaction on
                 * every move, so it always shows the load as it
                 * would be committed, including the point the
                 * cursor is currently proposing.
                 */
                /*
                 * THE STATION COMES FROM THE RESOLVED POINT; THE DIRECTION
                 * COMES FROM THE RAW CURSOR.
                 *
                 * `resolution.effectiveConstructionPoint` is snapped, which
                 * is what a load's station wants - a point near the member
                 * should sit ON it. The DIRECTION must not be snapped: read
                 * from the snapped point it collapsed to the span endpoint
                 * whenever the cursor neared an end, which is the strange
                 * angle this fixes. `distributedLoadDirectionCursor` reads
                 * the raw (or H/V-constrained) pointer instead, and it is the
                 * same reading the commit uses - so the preview is the load
                 * that gets created.
                 */
                const draft =
                    distributedLoadDraft(
                        interaction,
                        point,
                        distributedLoadDirectionCursor(
                            resolution
                        )
                    );

                interaction.preview =
                    draft
                        ? {
                            id: "preview-distributed-load",
                            type: "load",

                            geometry: draft,

                            /*
                             * MARKED AS THE TOOL THAT IS BUILDING IT, so
                             * the preview carries the same magnitude
                             * annotations the committed load will: one per
                             * defining point. A preview that showed a
                             * different set of labels to the load it
                             * becomes would be a preview of a different
                             * feature.
                             */
                            engineering: {
                                plane: "XY",
                                discipline: "statics",
                                staticsType:
                                    drawingState.activeTool
                            },

                            style: {
                                stroke:
                                    drawingState
                                        .styleDefaults
                                        ?.stroke ||
                                    PREVIEW_STROKE,
                                fill: "none",
                                lineWidth: 0.5,
                                lineType:
                                    "dashed",
                                opacity: 1
                            }
                        }
                        : null;

                setToolMessage(
                    constructionFeedbackMessage(
                        resolution,
                        interaction
                            .distributedLoadHasProfile
                            ? "Click to add another point, Enter to finish"
                            : "Move to set the first force direction and magnitude, then click"
                    )
                );
            }

                /*
                 * A body-attached feature takes one or more points on
                 * its body and is created only once it has all of them,
                 * so nothing is committed on this click.
                 *
                 * Guarded by the tool as well as the phase: a truss under
                 * construction is a different operation that lives in the
                 * same interaction and must not be swallowed here.
                 */
                if (
                    isBodyAttachedTool(
                        drawingState.activeTool
                    ) &&
                    interaction.phase ===
                        "statics-attach"
                ) {
                /*
                 * Live preview for a body-attached feature.
                 *
                 * The valid locations along the target body are shown
                 * as markers and the body is outlined, so it is clear
                 * what the feature is being attached to and where it
                 * may go. Nothing here enters the feature collection.
                 */
                interaction.preview =
                    bodyAttachedPreview(
                        interaction,
                        resolution,
                        point
                    );

                const attachFeedback =
                    [
                        inferenceLabel(
                            resolution.inference
                        ),

                        snapTypeLabel(
                            resolution.snapCandidate?.type
                        )
                    ].filter(Boolean);

                setToolMessage(
                    attachFeedback.length
                        ? attachFeedback.join(" · ")
                        : staticsBodyMessage(
                              drawingState.activeTool,
                              (interaction.attachmentPoints
                                  ?.length ??
                                  0) + 1
                          )
                );
            } else if (
                STATICS_SPAN_TOOLS[
                    drawingState.activeTool
                ] &&
                interaction.phase ===
                    "statics-span"
            ) {
                /*
                 * Live span preview for the two-click Statics
                 * tools, drawn from the same defining parameters
                 * the committed feature will store, so a Point
                 * Force previews as an arrow and a load as its
                 * span rather than as a plain line.
                 */
                const start = {
                    ...interaction.points[0]
                };

                const end = {
                    x: point.x,
                    y: point.y
                };

                const type =
                    STATICS_CHILD_TOOLS[
                        drawingState.activeTool
                    ]?.type;

                interaction.preview =
                    staticsSpanPreview(
                        type,
                        start,
                        end
                    );

                /*
                 * An active inference or snap owns the status
                 * line, otherwise show the next instruction.
                 */
                const feedback =
                    [
                        inferenceLabel(
                            resolution.inference
                        ),

                        snapTypeLabel(
                            resolution.snapCandidate?.type
                        )
                    ].filter(Boolean);

                                setToolMessage(
                                    feedback.length
                                        ? feedback.join(" · ")
                                        : staticsSpanInstruction(
                                            drawingState.activeTool
                                        )
                                );
                    }
                }

                /*
                 * The preview object for a two-click Statics tool.
         *
         * It reuses the ordinary preview shape for the spans that
         * draw as a line, and a preview type of the feature's own
         * for those that draw as a symbol, so the preview and the
         * committed feature always look the same.
         */
        function staticsSpanPreview(
            type,
            start,
            end
        ) {
            const span = {
                start,
                end
            };

            if (type === "load") {
                return createPreview("load", {
                    ...span,
                    intensity: 10
                });
            }

            if (type === "varying-load") {
                return createPreview("varying-load", {
                    ...span,
                    startIntensity: 0,
                    endIntensity: 10
                });
            }

            if (
                type === "force" ||
                type === "pin-connection" ||
                type === "fixed-connection" ||
                type === "slider-connection"
            ) {
                return createPreview(type, span);
            }

                return createPreview(
                    "line",
                    span
                );
            }

            /*
             * Live preview for a body-attached feature.
             *
             * The valid locations along the target body are shown as small
             * markers, the body is outlined, and the feature to be is drawn
             * from the points placed so far plus the cursor. Nothing here
             * enters the feature collection: the preview is rebuilt on
             * every move and discarded on commit or on Esc.
             */
            function bodyAttachedPreview(
                interaction,
                resolution,
                point
            ) {
                /*
                 * THE MOMENT PREVIEW, DRAWN ABOUT ITS APPLICATION POINT.
                 *
                 * The first click fixed where the moment acts, and the
                 * cursor has been choosing how large the arc is drawn.
                 * So the arc goes round the FIXED point, never round
                 * the pointer - a moment is drawn around the place it
                 * is applied at, and a preview drawn around the cursor
                 * would show a symbol somewhere the moment will not
                 * be.
                 *
                 * Returned as a real Moment, so the preview and the
                 * committed feature are the same curve, the same
                 * tangent arrowhead and the same line weight. There is
                 * no second version of this symbol to keep in step.
                 */
                if (
                    interaction.phase ===
                        "moment-radius"
                ) {
                    const centre =
                        interaction.startPoint;

                    if (!centre) {
                        return null;
                    }

                    return {
                        id: "preview-moment",
                        type: "moment",
                        geometry: {
                            position: { ...centre },
                            magnitude:
                                interaction
                                    .magnitude ?? 50,
                            direction:
                                interaction
                                    .direction || "CCW",
                            arcRadius:
                                interaction.radiusPx
                        },
                        style: {
                            stroke:
                                PREVIEW_STROKE,
                            fill: "none",
                            lineWidth: 0.5,
                            lineType: "dashed",
                            opacity: 1
                        }
                    };
                }

                const body =
                    interaction.staticsTarget;

                const placed =
                    interaction.attachmentPoints || [];

                const type =
                    STATICS_CHILD_TOOLS[
                        drawingState.activeTool
                    ]?.type;

                /*
                 * A SUPPORT PREVIEWS WHERE IT WILL ACTUALLY BE.
                 *
                 * Every other body-attached feature previews at the
                 * point it is placed at, because that is where it goes.
                 * A support is the exception: it is ATTACHED to the
                 * centreline and DRAWN outside the body, so a preview
                 * drawn at the snapped point would sit in the middle of
                 * the beam and then jump clear of it on the click.
                 *
                 * That is not a cosmetic difference. The specification
                 * is explicit that the preview must show the placement
                 * the user is about to get, and a symbol that moves when
                 * it is committed is a preview of a DIFFERENT thing -
                 * so the student is placing something other than what
                 * they were shown, which is the whole fault a preview
                 * exists to prevent.
                 *
                 * So the preview carries the PARENT and the attachment
                 * distance, and the renderer derives the exterior
                 * position from them by exactly the same code that
                 * draws the committed feature. There is no second
                 * placement calculation to disagree, and the preview and
                 * the result are the same symbol at the same place.
                 */
                if (
                    body &&
                    isSupportType(type)
                ) {
                    const frame =
                        enggBodyFrames.frameOf(
                            body
                        );

                    if (frame) {
                        const distanceAlong =
                            enggBodyFrames.positionOn(
                                frame,
                                placed[0] ?? point
                            );

                        return {
                            id: "preview-statics-attach",
                            type,

                            /*
                             * The PARENT, so the renderer resolves the
                             * real exterior position rather than drawing
                             * the symbol on the centreline.
                             */
                            parentId: body.id,

                            geometry: {
                                /*
                                 * Where it will be drawn - a starting
                                 * value, recomputed by the renderer from
                                 * the attachment on the same frame it
                                 * would use for the real feature.
                                 */
                                position:
                                    enggBodyFrames
                                        .supportPlacement(
                                            body,
                                            placed[0] ?? point,
                                            false
                                        )?.render ||
                                    { ...(placed[0] ?? point) },

                                attachment: {
                                    distance: distanceAlong
                                },

                                flipped: false
                            },

                            targetBody: body,

                            style: {
                                stroke:
                                    PREVIEW_STROKE,
                                fill: "none",
                                lineWidth: 0.5,
                                lineType: "dashed",
                                opacity: 1
                            }
                        };
                    }
                }

                const required =
                    staticsToolPointCount(
                        drawingState.activeTool
                    );

                /*
                 * Once the first end is placed the preview spans from it to
                 * the cursor, which is what makes the whole loaded region
                 * visible while the second end is chosen.
                 */
                const spanPoints =
                    required > 1
                        ? [
                              placed[0] ?? point,
                              placed[1] ?? point
                          ]
                        : [placed[0] ?? point];

                return {
                    id: "preview-statics-attach",
                    type: staticsPreviewType(type),

                    geometry: staticsAttachmentGeometry(
                        type,
                        spanPoints
                    ),

                    /*
                     * The target body and the valid locations ride with the
                     * preview rather than being features of their own, so
                     * they can never be selected or listed.
                     */
                    targetBody: body,
                    locations: placed.length
                        ? []
                        : bodyPlacementLocations(
                              body,
                              6
                          ),

                    style: {
                        stroke:
                            PREVIEW_STROKE,
                        fill: "none",
                        lineWidth: 0.5,
                        lineType: "dashed",
                        opacity: 1
                    }
                };
            }

/*
 * The preview type for a Statics feature, so a load previews as
 * a load and a support previews as a support rather than as a
 * plain line.
 */
function staticsPreviewType(
    type
) {
    return (
        [
            "load",
            "varying-load",
            "moment",
            "pin-support",
            "roller-support",
            "fixed-support",
            "smooth-support",
            "pin-connection",
            "fixed-connection",
            "slider-connection"
        ].includes(type)
            ? type
            : "point"
    );
}

    /*
     * THE MOMENT, IN TWO CLICKS.
     *
     * The first click is the APPLICATION POINT and it is the whole of
     * what that click decides. The cursor then sets how big the curved
     * arrow is DRAWN while it is still a preview, and a second click
     * commits it.
     *
     * Why two clicks rather than one: the moment is a rotation, and
     * the only thing about it that is genuinely the student's to
     * choose is where it sits and how legible it is. A single click
     * commits both at a default size, and a moment on a small member
     * is then unreadable with no way to have chosen otherwise.
     *
     * Why the application point is FIXED once chosen: it is the point
     * the force acts, and it is the thing the whole symbol is
     * describing. Letting the cursor drag it would mean a moment
     * applied at a load quietly slid somewhere else while the radius
     * was being adjusted, which is precisely the "tidier looking"
     * relocation the specification forbids.
     *
     * The radius follows the cursor as a DISTANCE from that fixed
     * point, so moving the pointer out grows the arc and moving it
     * back in shrinks it - and the arc is drawn through the shared
     * rotational renderer, so the preview is the same curve the
     * committed moment will be.
     */
    export function beginMomentPlacement(
        point,
        parentId
    ) {
        enggDrawingState.setInteraction(
            drawingState,
            {
                phase: "moment-radius",

                /*
                 * The clicked point, and it never changes again for the
                 * rest of this construction.
                 */
                startPoint: { ...point },
                currentPoint: { ...point },

                parentId,

                /*
                 * The radius starts at the shared default so the first
                 * frame is a sensible size, and the cursor adjusts it
                 * from there.
                 */
                radiusPx:
                    enggDrawingRotationalArrow
                        .DEFAULT_ARC_RADIUS_PX,

                magnitude: 50,
                direction: "CCW"
            }
        );

        setToolMessage(
            "Move the pointer to size the arrow, then click to place the moment"
        );

        renderCurrentDrawing();
    }

    /*
     * COMMIT THE PLACED MOMENT.
     */
    export function commitMomentPlacement() {
        const interaction =
            drawingState.interaction;

        const position =
            interaction.startPoint;

        if (!position) {
            return false;
        }

        const previousObjects =
            enggDrawingState.snapshotDrawing(
                drawingState
            );

        const object =
            enggDrawingState.geometryFactories.moment(
                { x: position.x, y: position.y },

                /*
                 * A PLACEHOLDER SIZE, NOT A VALUE.
                 *
                 * The moment is created first so it EXISTS on the sheet - the
                 * arc, its position and its sense - and the popup then asks
                 * what its magnitude IS. It used to be given a hard-coded 50
                 * and never asked at all, so every moment a student placed
                 * silently claimed a magnitude they had not chosen.
                 *
                 * The hard-coded magnitude was also what the preview drew, so
                 * the arc is already the right shape; this only settles the
                 * number, and the popup is opened with it as the suggestion so
                 * a student who likes the size presses Enter.
                 */
                interaction.magnitude ?? 50,

                interaction.direction || "CCW",
                {
                    style:
                        drawingState
                            .styleDefaults,

                    parentId:
                        interaction.parentId,

                    name: "Applied Moment"
                }
            );

        /*
         * The radius the student chose, stored as a presentation
         * property. It is written from the interaction rather than
         * recomputed, so the committed moment is the size the preview
         * was showing at the moment of the click.
         */
        object.geometry.arcRadius =
            interaction.radiusPx;

        /*
         * THE STORED OBJECT, not the one passed in - `addObject` may keep a
         * renamed COPY of it, and the popup below writes to the feature.
         */
        const stored =
            enggDrawingState.addObject(
                drawingState,
                object
            );

        enggDrawingState.clearInteraction(
            drawingState
        );

        enggDrawingState.commitDrawingChange(
            drawingState,
            previousObjects
        );

        enggDrawingState.selectObject(
            drawingState,
            stored.id
        );

        renderProperties();
        renderCurrentDrawing();

        /*
         * ========================================================
         * NOW ASK WHAT ITS MAGNITUDE IS
         * ========================================================
         *
         * THE ORDER IS THE REQUIREMENT: place the moment, see it on the sheet,
         * and only then answer for it. Asking first would be asking about
         * something not yet drawn - the same mistake the creation-size popup
         * avoids by keeping the geometry on screen while the number is typed.
         *
         * It is the SAME popup a Point Force and a load magnitude use, with
         * the MOMENT units, so the student learns one value box rather than
         * one per quantity.
         */
        openMomentValuePrompt(stored, previousObjects);

        return true;
    }

    /*
     * Ask for a placed moment's magnitude, and apply whatever is answered.
     *
     * `readStaticsValue` decides what the answer MEANT - a number, an unknown,
     * or the student's own symbol - and `applyStaticsValue` writes it into the
     * three places the model already keeps those states. So `M`, `250` and an
     * empty box all work, and none of them is silently turned into zero.
     *
     * EXPORTED because a moment has TWO creation paths - the two-stage one on a
     * body, and the single-click one in free space - and both must ask the SAME
     * question through the SAME popup. A copy of this in the other path would
     * be a second place for `M` to mean a number.
     */
    export function openMomentValuePrompt(object, previousObjects) {
        openLoadValuePopup({
            title: "Applied Moment",
            label: "Magnitude",

            value: Number(object.geometry.magnitude) || "",

            unit: momentUnit(object),

            /*
             * A MOMENT IS STATED IN A MOMENT UNIT. The popup is shared with
             * forces and loads, whose units are N and kN/m, so the list is
             * given here rather than assumed - offering kN/m for a moment
             * would name the wrong quantity entirely.
             */
            units: MOMENT_UNITS,

            onOpen: () => {
                setToolMessage(
                    "Enter the moment magnitude - leave it empty for Unknown"
                );
            },

            onConfirm: (confirmed) => {
                const answer = readStaticsValue(
                    confirmed.text ?? "",
                    confirmed.unit
                );

                if (answer.kind === "number") {
                    /*
                     * THE STORED MAGNITUDE IS IN THE BASE UNIT, N·m. The
                     * unit control says how it is WRITTEN, and the panel
                     * converts base -> display for reading - so a number
                     * typed in kN·m is taken back to N·m before it is
                     * stored. Without this, typing 2.5 against a kN·m
                     * moment stored 2.5 N·m and the moment became a
                     * thousandth of what the student entered.
                     */
                    answer.value =
                        enggQuantities.convertValue(
                            answer.value,
                            "moment",
                            answer.unit || "N·m",
                            "N·m"
                        );
                }

                applyStaticsValue(object, answer, {
                    valueKey: "magnitude"
                });

                if (answer.kind === "number") {
                    setMomentUnit(object, answer.unit);

                    setToolMessage(
                        `Moment placed - ${answer.value} ${
                            answer.unit || ""
                        }`
                    );
                } else if (answer.kind === "symbol") {
                    setToolMessage(`Moment placed - ${answer.text}`);
                } else {
                    setToolMessage("Moment placed - magnitude Unknown");
                }

                enggDrawingState.commitDrawingChange(
                    drawingState,
                    previousObjects
                );

                renderProperties();
                renderCurrentDrawing();
            },

            /*
             * CANCEL KEEPS THE MOMENT. It is already placed and visible, so
             * cancelling the question must not take it away - the student is
             * abandoning the NUMBER, not the feature they just placed.
             */
            onCancel: () => {
                setToolMessage(
                    "Moment placed - magnitude not set, use the Features panel"
                );

                renderCurrentDrawing();
            }
        });
    }

    /*
     * The units a moment is stated in, FROM THE SHARED QUANTITY TABLE.
     *
     * A moment is a force times a length, so its units are the force-length
     * pairs a student actually writes. This used to be its own literal list,
     * which disagreed with the one on the load profile - the two code paths
     * offered different units for the same quantity. `unitsFor("moment")` is
     * the ONE list, so the popup and the Features panel offer the same
     * choices and a unit added to the table appears in both.
     */
    const MOMENT_UNITS =
        enggQuantities?.unitsFor?.("moment") ||
        ["N\u00b7m", "kN\u00b7m"];

    /* The unit a moment is currently stated in, or the default. */
    function momentUnit(object) {
        const stored = object?.geometry?.momentUnit;

        return MOMENT_UNITS.includes(stored) ? stored : MOMENT_UNITS[0];
    }

    /*
     * Record the unit a moment is stated in.
     *
     * THE UNIT DOES NOT CHANGE THE NUMBER. N·m and kN·m name the same physical
     * quantity at different scale, and the student typed the number they meant,
     * so the unit travels BESIDE the value exactly as a load's does - see the
     * note at the head of load-profile.js. This is a label, not a conversion.
     */
    function setMomentUnit(object, unit) {
        if (!object?.geometry || !unit) {
            return;
        }

        if (MOMENT_UNITS.includes(unit)) {
            object.geometry.momentUnit = unit;
        }
    }

    /*
     * The preview geometry for a body-attached feature.
 *
 * A span-shaped feature is previewed between its two ends. A
 * point-shaped feature previews at its application point.
 */
function staticsAttachmentGeometry(
    type,
    spanPoints
) {
    if (spanPoints.length > 1) {
        return {
            start: spanPoints[0],
            end: spanPoints[1],
            intensity: 10,
            startIntensity: 0,
            endIntensity: 10
        };
    }

    return {
        position: spanPoints[0]
    };
}
