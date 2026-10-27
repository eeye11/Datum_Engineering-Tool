/*
 * Completing geometry: polygons, points, and coordinate systems.
 */

import { trussJoints } from "../../../shared/geometry/feature-handles.js";
import enggQuantities from "../../../shared/units/quantities.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggAnalysisDependencies from "../model/analysis/analysis-dependencies.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import { defaultFixedFor, toolAppearance, toolSetting } from "../../../components/layout/panels/features-pane.js";
import { analysisSourceBody, diagramPrerequisiteMessage } from "../statics/analysis-tools.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { COORDINATE_SYSTEM_LENGTH, COORDINATE_SYSTEM_TYPE, staticsForceLineWidth } from "../constants.js";
import { arcThroughThreePoints, distance, rectangleGeometry, resolveCentrepointArc } from "./construction-geometry.js";
import { commitCreatedFeature } from "./creation-commit.js";
import { drawingState } from "../editor-state.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { objectAtPoint } from "../interaction/hit-testing.js";
import { applyStaticsValue, openLoadValuePopup, readStaticsValue } from "../../../shared/ui/editors/load-value-popup.js";
import { LOAD_BUILD_PHASES, beginDistributedLoadConstruction, continueDistributedLoadBuild, distributedLoadDirectionCursor, distributedLoadPointOnBody, distributedLoadRegionMidpoint, isVaryingLoadTool, startDistributedLoadBuild, takeDistributedLoadEnd, takeDistributedLoadStart, takeDistributedLoadVector } from "../statics/load-tool.js";
import { commitMomentPlacement } from "./preview.js";
import { beginStaticsAttachment, continueStaticsAttachment, staticsBodyAtPoint } from "../statics/statics-attachment.js";
import { createStaticsFeature } from "../statics/statics-creation.js";
import { createDynamicsFeature } from "./dynamics-creation.js";

/* The one Dynamics creation entry point, shared with the span gesture. */
export { createDynamicsFeature };
import { DYNAMICS_ANGLE_TOOLS, DYNAMICS_BOX_TOOLS, DYNAMICS_PLACEMENT_TOOLS, DYNAMICS_SPAN_TOOLS } from "../dynamics/dynamics-tools.js";
import { STATICS_CHILD_TOOLS, STATICS_PLACEMENT_TOOLS, STATICS_SPAN_TOOLS, isBodyAttachedTool, isFreeMomentTool, staticsAttachmentId, staticsInstruction, staticsSpanInstruction } from "../statics/statics-tools.js";
import { isArcTool, openPolygonSidesPrompt, referenceArcOptions } from "../../../components/layout/toolbar/tool-menus.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { TRUSS_STAGES, continueTrussConstruction } from "../statics/truss-tool.js";
import { attachableStaticsType } from "../../../shared/model/feature-types.js";
import { activateTool } from "../../../components/layout/toolbar/tool-activation.js";
import { isLegacyResetTool } from "../../../components/layout/toolbar/phase-reset.js";

/*
 * Build the polygon definition for the active
 * creation mode.
 *
 * Both modes resolve to the same stored model:
 * centre, radius, sides and rotation. Only the way
 * those are derived from the interaction differs,
 * so there is a single authoritative geometry.
 */
export function polygonFromCursor(
    interaction,
    point
) {
    if (
        interaction.polygonMode ===
        "sides"
    ) {
        return polygonFromTwoPoints(
            interaction,
            point
        );
    }

    return polygonFromCentre(
        interaction,
        point
    );
}

/*
 * By Centre: the first click is the centre, and the
 * cursor sets both the radius and the rotation.
 */
function polygonFromCentre(
    interaction,
    point
) {
    const center =
        interaction.points[0];

    if (!center) {
        return null;
    }

    const radius =
        distance(
            center,
            point
        );

    if (
        radius <=
        1e-9
    ) {
        return null;
    }

    return {
        center: {
            ...center
        },

        radius,

        sides:
            polygonSideCount(
                interaction
            ),

        rotation:
            Math.atan2(
                point.y - center.y,
                point.x - center.x
            )
    };
}

/*
 * By Sides: the two clicked points define the first
 * side of the polygon. The centre is the circumcentre
 * of the regular polygon whose first edge runs from
 * the first point to the second, and the rotation is
 * taken from that edge.
 */
function polygonFromTwoPoints(
    interaction,
    point
) {
    const first =
        interaction.points[0];

    if (!first) {
        return null;
    }

    const sideLength =
        distance(
            first,
            point
        );

    if (
        sideLength <=
        1e-9
    ) {
        return null;
    }

    const sides =
        polygonSideCount(
            interaction
        );

    const rotation =
        Math.atan2(
            point.y - first.y,
            point.x - first.x
        );

    /*
     * Circumradius of a regular polygon for a given
     * edge length: R = s / (2 sin(pi / n)).
     *
     * The centre sits at the apothem from the midpoint
     * of the edge, on the inward side.
     */
    const apothem =
        sideLength /
        (
            2 *
            Math.tan(
                Math.PI /
                    sides
            )
        );

    const radius =
        sideLength /
        (
            2 *
            Math.sin(
                Math.PI /
                    sides
            )
        );

    const midpoint = {
        x: (first.x + point.x) / 2,
        y: (first.y + point.y) / 2
    };

    const inward =
        rotation +
        Math.PI / 2;

    return {
        center: {
            x:
                midpoint.x +
                Math.cos(inward) *
                    apothem,

            y:
                midpoint.y +
                Math.sin(inward) *
                    apothem
        },

        radius,

        sides,

        /*
         * The stored rotation places vertex 0 at the
         * first clicked point, so the committed shape
         * starts exactly where the user clicked.
         */
        rotation:
            rotation -
            Math.PI / 2 -
            Math.PI /
                sides
    };
}

/*
 * The side count belongs to the tool, not to the
 * geometry, so the creation modes share one value.
 */
export function polygonSideCount(
    interaction
) {
    const sides =
        Math.round(
            Number(
                interaction.polygonSides
            )
        );

    return (
        Number.isFinite(sides) &&
        sides >= 3
            ? sides
            : 6
    );
}

/*
 * ============================================================
 * CLOSING A FREEFORM POLYGON
 * ============================================================
 *
 * A Freeform Polygon is closed by dragging back to its first vertex. The
 * question "is the pointer near enough to close?" is asked in DRAWING UNITS,
 * not in screen pixels, so the answer does not depend on the zoom - a vertex
 * the student can see they are over is a vertex they can close on at any
 * magnification. The same reasoning the object-snap tolerance uses is not
 * reused here because that tolerance is deliberately measured in screen space
 * for aiming; closing is a property of the geometry.
 *
 * The tolerance is a fraction of the polygon's own size rather than a fixed
 * distance, so a small polygon is not harder to close than a large one.
 */
const FREEFORM_CLOSING_FRACTION = 0.18;

export function closingFreeformPolygon(
    point,
    interaction = drawingState.interaction
) {
    const first =
        interaction?.points?.[0];

    if (!first || !point) {
        return false;
    }

    const span =
        interaction.points.reduce(
            (widest, vertex) => {
                const reach = Math.max(
                    Math.abs(vertex.x - first.x),
                    Math.abs(vertex.y - first.y)
                );

                return Math.max(widest, reach);
            },
            0
        );

    /*
     * With no extent yet - a single vertex placed - there is nothing to
     * close, and a fraction of zero would make every point "near". The
     * guard returns false so the first edge is never mistaken for a close.
     */
    if (span <= 1e-9) {
        return false;
    }

    const tolerance = span * FREEFORM_CLOSING_FRACTION;

    return distance(first, point) <= tolerance;
}

/*
 * Commit a Freeform Polygon from the vertices the student placed.
 *
 * The vertices are the ACTUAL resolved points - snapped through the same
 * pipeline every other construction uses - so the committed geometry, the
 * canvas, the source and the Objects list all describe the same shape.
 *
 * Fewer than three distinct vertices is refused: two points are a segment,
 * and a shape with two vertices would not be a polygon however it is drawn.
 * "Distinct" is a real test, not a count, because a student can place three
 * vertices on top of each other and would then have a zero-area shape.
 */
export function commitFreeformPolygon(
    interaction = drawingState.interaction
) {
    const points =
        (interaction?.points || [])
            .filter(Boolean)
            .map(vertex => ({
                x: Number(vertex.x),
                y: Number(vertex.y)
            }));

    const distinct = points.filter(
        (vertex, index) =>
            points.findIndex(
                other =>
                    Math.abs(other.x - vertex.x) < 1e-9 &&
                    Math.abs(other.y - vertex.y) < 1e-9
            ) === index
    );

    if (distinct.length < 3) {
        setToolMessage(
            "A polygon needs at least three distinct vertices"
        );

        renderCurrentDrawing();

        return null;
    }

    const object =
        enggDrawingState.geometryFactories[
            "freeform-polygon"
        ](
            points,
            {
                style: {
                    ...drawingState.styleDefaults,
                    ...toolAppearance("freeform-polygon")
                },

                engineering:
                    currentEngineeringMetadata()
            }
        );

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    commitCreatedFeature(
        object,
        previousObjects
    );

    setToolMessage("Ready");

    renderProperties();
    renderCurrentDrawing();

    return object;
}

export function currentEngineeringMetadata() {
    return {
        plane: "XY"
    };
}

/*
 * The point a truss's next point aligns against.
 *
 * While a member is being drawn that is the member's own start.
 * Between members there is no member in progress, and the point
 * that matters is the structure itself: a new member is almost
 * always dropped from a joint of the truss that is already there,
 * and it is that joint the next point should be compared
 * against.
 *
 * The NEAREST joint is used rather than the last one placed. A
 * student tracing round a panel ends each member at a different
 * corner, so the most recently placed joint is often on the
 * opposite side, and aligning to it would put horizontal and
 * vertical inference in the wrong place exactly when it is
 * wanted.
 */
export function trussInferenceAnchor(
    interaction
) {
    if (
        interaction.trussInProgress
    ) {
        return interaction.trussInProgress;
    }

    const members =
        interaction.trussMembers || [];

    if (!members.length) {
        return interaction.startPoint || null;
    }

    const joints = trussJoints(members);

    /*
     * The joint nearest the cursor, so the alignment reference
     * is whichever one the student is actually working from.
     * The point is the last thing written by the move handler,
     * so it is current.
     */
    const cursor =
        interaction.currentPoint ||
        interaction.rawPointerPoint;

    if (!cursor) {
        return members[
            members.length - 1
        ].end;
    }

    let nearest = null;
    let nearestDistance = Infinity;

    joints.forEach(joint => {
        const distance = Math.hypot(
            joint.x - cursor.x,
            joint.y - cursor.y
        );

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = joint;
        }
    });

    return nearest ||
        members[members.length - 1].end;
}

export function beginOrCompleteGeometry(
    resolution
) {
    /*
     * PHASE 1 RESET: the construction pipeline is inert. No click
     * can start or complete any legacy drawing operation.
     */
    if (isLegacyResetTool(drawingState.activeTool)) {
        return;
    }

    const interaction =
        drawingState.interaction;

    const point =
        resolution.effectiveConstructionPoint;

    if (!point) {
        return;
    }

    /*
     * STAGE ONE OF A DIAGRAM: NAME THE BODY.
     *
     * The diagram tools are armed with no source - the student is asked
     * for the body they belong to rather than required to have selected
     * one first. So the first click answers that question, and the second
     * places the diagram.
     *
     * This is the same two-stage shape as a support or a load: tool, then
     * body, then placement. What makes it worth handling here is that the
     * stage is decided by whether a source is ALREADY on the interaction,
     * so a student who had a beam selected before pressing SFD gets the
     * single-click version and is never asked twice.
     *
     * The body is found by the ordinary hit test and kept by its real
     * feature id. It is never the nearest line, an index or a name, so a
     * diagram cannot end up attached to the wrong member.
     */
    if (
        interaction.phase === "analysis-axis" &&
        !interaction.sourceId
    ) {
        /*
         * THE BODY COMES FROM THE SHARED SNAP, NOT FROM A HIT TEST ALONE.
         *
         * A member is a thin thing, and a hit test that has to land inside
         * a drawn outline is a poor way to ask "which beam is that?". The
         * snap candidates already publish every body's centreline as a
         * span, so the question is asked of them - the same candidates a
         * support, a load or a connection is attached through. That is
         * also what makes the diagram behave like the rest of Statics: the
         * student aims at the beam, the same way they always do, and the
         * same tolerance decides what counts as close enough.
         *
         * The candidate is resolved to the object it names and stored by
         * its real feature id, so nothing downstream depends on where the
         * pointer happened to be.
         */
        const snappedId =
            staticsAttachmentId(
                resolution.snapCandidate
            );

        /*
         * ONLY WHAT WAS ACTUALLY CLICKED.
         *
         * There used to be a second call here -
         * `analysisSourceBody(selectedStaticsFeatures())` - as a fallback when
         * the click resolved to nothing. That helper returns EVERY Statics
         * feature when the selection is empty, so a click on empty space
         * silently adopted whichever member happened to be on the sheet: the
         * diagram was then armed against a beam the student had not chosen, and
         * only the NEXT click committed it.
         *
         * That is what made Plot and Sketch feel like they needed repeated
         * clicks: the first click "did nothing" (it had quietly picked a body),
         * and the second appeared to be the one that worked. It is also the
         * behaviour the diagram rules forbid - a diagram must never attach to a
         * member nobody picked.
         *
         * So the body comes from the click alone. A click that names nothing
         * usable says so and leaves the tool waiting for one, which is the
         * honest outcome and keeps the student in control.
         */
        const body =
            analysisSourceBody(
                snappedId
                    ? [
                          drawingState.objects.find(
                              candidate =>
                                  candidate.id ===
                                  snappedId
                          )
                      ].filter(Boolean)
                    : [objectAtPoint(point)]
            );

        if (!body) {
            /*
             * THE CLICK NAMED SOMETHING THAT IS NOT A MEMBER - or nothing at
             * all. The wording comes from the ONE prerequisite helper, so the
             * message the tool shows on arming and the message it shows when a
             * click lands on the wrong thing cannot disagree.
             */
            setToolMessage(
                diagramPrerequisiteMessage(null, false)
            );

            renderCurrentDrawing();

            return;
        }

        const span =
            enggAnalysisDependencies.spanOf(body);

        if (!span) {
            setToolMessage(
                "The selected feature is not a beam. Select the Beam, Truss, Cable or " +
                    "Shaft this diagram belongs to"
            );

            return;
        }

        enggDrawingState.setInteraction(
            drawingState,
            {
                ...interaction,

                sourceId: body.id,

                /*
                 * The suggested starting height, measured from the body
                 * that was just chosen rather than from whatever happened
                 * to be selected.
                 */
                placementY:
                    span.start.y +
                    enggAnalysisDependencies
                        .DEFAULT_ANALYSIS_OFFSET
            }
        );

        setToolMessage(
            "Move the pointer up or down to position the diagram, then click to place it"
        );

        renderCurrentDrawing();

        return;
    }

    if (
        interaction.phase ===
        "idle"
    ) {
        /*
         * A Point is defined by a single click, so it is
         * created and committed immediately.
         */
        if (
            drawingState.activeTool ===
            "point"
        ) {
            createPointFeature(
                point
            );

            return;
        }

        /*
         * A Truss is built progressively rather than in two
         * clicks. The first click both starts the construction
         * and anchors the base, so the student does not lose a
         * click to a step that places nothing.
         */
        if (
            drawingState.activeTool ===
                "truss"
        ) {
            enggDrawingState.setInteraction(
                drawingState,
                {
                    phase: "truss-construct",
                    startPoint: point,
                    currentPoint: point,
                    trussStage: 0,
                    trussMembers: [],
                    trussOutline: [],
                    trussInProgress: point,

                    /*
                     * Published from the first click, so the very
                     * first member already snaps to the drawing
                     * it is being added to.
                     */
                    snapGeometry: [
                        {
                            start: point,
                            end: point
                        }
                    ],

                    snapQuarterSnap: true,
                    snapToolId: "truss"
                }
            );

            setToolMessage(
                TRUSS_STAGES[0].followUp
            );

            renderCurrentDrawing();
            return;
        }

        /*
         * A body-attached Statics tool works on a body, not
         * on free space. It first takes its target body, then
         * places itself along that body, so the feature it
         * creates always belongs to something.
         *
         * This runs before the single-click placement path,
         * because a support or a moment placed this way must
         * not be committed before its body is known.
         */
        if (
            isBodyAttachedTool(
                drawingState.activeTool
            ) &&
            !drawingState.interaction
                .staticsTarget
        ) {
            /*
             * Both distributed loads are body-attached, but they
             * bring their own construction with them: they have
             * to be told which body they load, then walk the
             * student through their own definition. So they are
             * routed to that rather than to the generic
             * attachment path.
             */
            if (
                drawingState.activeTool ===
                    "distributed-load" ||
                isVaryingLoadTool()
            ) {
                beginDistributedLoadConstruction(
                    resolution
                );

                return;
            }

            /*
             * A Moment is a free-standing action on a point, not
             * something that only means anything against a body:
             * an applied moment can be drawn anywhere, and in
             * statics that is the common case - moments are applied
             * at joints and at points in free space as often as
             * anywhere else.
             *
             * So a click in empty space places one there, rather
             * than refusing and asking for a body that may not
             * exist. A click ON a body still goes through the
             * attachment path, so the moment is parented to the
             * body it was drawn on and the Features panel can show
             * it relative to that body.
             */
            if (
                isFreeMomentTool() &&
                !staticsBodyAtPoint(point)
            ) {
                createStaticsFeature(
                    drawingState.activeTool,
                    point
                );

                return;
            }

            beginStaticsAttachment(
                resolution
            );

            return;
        }

        /*
         * Statics features are also placed with a single
         * click, so they commit immediately and open their
         * Features panel.
         */
        if (
            STATICS_PLACEMENT_TOOLS[
                drawingState.activeTool
            ]
        ) {
            createStaticsFeature(
                drawingState.activeTool,
                point,
                staticsAttachmentId(
                    resolution.snapCandidate
                )
            );

            return;
        }

        /*
         * A span tool anchors on the first click and sets
         * its extent on the second, so each one names its own
         * endpoint instead of borrowing the load wording.
         *
         * The anchor's snap decides the eventual parent, so
         * it is captured here while the snap candidate is
         * still in hand.
         */
        if (
            STATICS_SPAN_TOOLS[
                drawingState.activeTool
            ]
        ) {
            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,

                    phase:
                        "statics-span",

                    startPoint:
                        point,

                    currentPoint:
                        point,

                    parentId:
                        staticsAttachmentId(
                            resolution.snapCandidate
                        ),

                    points: [
                        point
                    ],
                    snapGeometry: []
                }
            );

            setToolMessage(
                staticsSpanInstruction(
                    drawingState.activeTool
                )
            );

            renderCurrentDrawing();
            return;
        }

        /*
         * ========================================================
         * A DYNAMICS TOOL TAKES ITS POINTS THE WAY IT DECLARED
         * ========================================================
         *
         * A placement tool (a Particle, a Reference Point) commits on the
         * FIRST click and goes on offering the next one, like a Statics
         * placement tool. Everything else - a span, a box or a centre-out
         * angle tool - anchors on this click and is committed by the next
         * one, through the `dynamics-*` phases handled further down.
         */
        if (DYNAMICS_PLACEMENT_TOOLS[drawingState.activeTool]) {
            createDynamicsFeature(
                drawingState.activeTool,
                point,
                point
            );

            renderCurrentDrawing();
            return;
        }

        if (
            DYNAMICS_SPAN_TOOLS[drawingState.activeTool] ||
            DYNAMICS_BOX_TOOLS[drawingState.activeTool]
        ) {
            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,

                    phase: "dynamics-span",

                    toolId: drawingState.activeTool,

                    startPoint: point,

                    currentPoint: point,

                    points: [
                        point
                    ]
                }
            );

            setToolMessage("Specify second point");

            renderCurrentDrawing();
            return;
        }

        if (DYNAMICS_ANGLE_TOOLS[drawingState.activeTool]) {
            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,

                    phase: "dynamics-angle",

                    toolId: drawingState.activeTool,

                    startPoint: point,

                    currentPoint: point,

                    points: [
                        point
                    ]
                }
            );

            setToolMessage("Specify the radius");

            renderCurrentDrawing();
            return;
        }

        if (
            drawingState.activeTool ===
            "polygon"
        ) {
            /*
             * By Centre starts with the centre; By Sides
             * starts with the first end of the first
             * edge. Both then take one more canvas point
             * before the side count is chosen.
             */
            const bySides =
                interaction.polygonMode ===
                "sides";

            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,

                    phase:
                        bySides
                            ? "polygon-first"
                            : "polygon-centre",

                    startPoint:
                        point,

                    currentPoint:
                        point,

                    /*
                     * THE SIDE COUNT COMES FROM THE TOOL'S FEATURES SETTING.
                     *
                     * `polygonSides` on the interaction is what the polygon
                     * maths reads, and the Features tab stores the student's
                     * choice under the tool's `sides` setting. Seeding one
                     * from the other here is what makes "six sides" in the
                     * panel produce a six-sided preview rather than the
                     * fallback.
                     */
                    polygonSides:
                        toolSetting("polygon", "sides"),

                    points: [
                        point
                    ]
                }
            );

            setToolMessage(
                bySides
                    ? "Specify second point"
                    : "Specify polygon radius"
            );

            renderCurrentDrawing();
            return;
        }

        if (
            isArcTool()
        ) {
            const threePoint =
                interaction.arcMode ===
                "three-point";

            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,

                    phase:
                        threePoint
                            ? "arc-first"
                            : "arc-centre",

                    startPoint:
                        point,

                    currentPoint:
                        point,

                    points: [
                        point
                    ]
                }
            );

            setToolMessage(
                threePoint
                    ? "Specify point on arc"
                    : "Specify arc start point"
            );
        } else {
            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,

                    phase:
                        "first-point",

                    startPoint:
                        point,

                    currentPoint:
                        point,

                    points: [
                        point
                    ]
                }
            );

            setToolMessage(
                ["polyline", "freeform-polygon"].includes(
                    drawingState.activeTool
                )
                    ? "Specify next point"

                    : drawingState.activeTool ===
                        "freeform-polygon"
                        ? "Drag to add vertices; return to the first vertex to close"

                    : drawingState.activeTool ===
                        "circle"
                        ? "Specify radius"

                    : (drawingState.activeTool === "rectangle" ||
                        drawingState.activeTool === "control-volume" ||
                        ["saturation-curve", "process-plot"].includes(drawingState.activeTool) ||
                        ["piston-cylinder", "piston-cylinder-stoppers"].includes(drawingState.activeTool))
                        ? "Specify opposite corner"

                    : drawingState.activeTool ===
                        "line"
                        ? "Specify line endpoint"

                    : drawingState.activeTool ===
                        "triangle"
                        ? "Specify second point"

                    : "Specify second point"
            );
        }

        renderCurrentDrawing();
        return;
    }

    if (
        ["polyline", "freeform-polygon"].includes(drawingState.activeTool)
    ) {
        if (
            drawingState.activeTool === "freeform-polygon" &&
            interaction.points.length >= 3 &&
            distance(point, interaction.points[0]) < 1e-9
        ) {
            commitFreeformPolygon(interaction);
            return;
        }

        interaction.points.push(
            point
        );
        interaction.snapGeometry =
            interaction.points.slice(1).map((end, index) => ({
                start: interaction.points[index],
                end
            }));

        interaction.startPoint =
            point;

        interaction.currentPoint =
            point;

        setToolMessage(
            drawingState.activeTool === "freeform-polygon"
                ? "Click next vertex or snap to the first point to close"
                : "Click next point or double-click to finish"
        );

        renderCurrentDrawing();
        return;
    }

    if (
        drawingState.activeTool ===
        "freeform-polygon"
    ) {
        /*
         * A FREEFORM POLYGON IS CLOSED BY DRAGGING BACK TO ITS FIRST VERTEX.
         *
         * The first vertex stays at points[0] throughout - it is not removed
         * and re-added, because the closing edge IS the segment back to it.
         * A gesture that ends near the first vertex closes the polygon; one
         * that does not adds another vertex and the student carries on.
         *
         * THREE DISTINCT VERTICES ARE REQUIRED. A polygon with two vertices
         * is a line segment, and committing one would put a "polygon" in the
         * Objects list that is not a polygon. So a close attempt on a
         * two-vertex shape is refused and the student is told why, rather
         * than a degenerate object being created.
         */
        if (
            interaction.points.length >= 3 &&
            closingFreeformPolygon(point)
        ) {
            interaction.currentPoint = point;

            commitFreeformPolygon(interaction);

            return;
        }

        interaction.points.push(point);

        interaction.startPoint = point;
        interaction.currentPoint = point;

        setToolMessage(
            interaction.points.length < 3
                ? "Drag to add vertices; return to the first vertex to close"
                : "Drag to add vertices, or back to the first vertex to close"
        );

        renderCurrentDrawing();
        return;
    }

    if (
        drawingState.activeTool ===
            "triangle" &&
        interaction.points.length < 2
    ) {
        /*
         * Triangle collects its three corner points
         * before creating a single feature. Once the
         * second point is down, the third click falls
         * through to the creation code below so the
         * whole triangle is built in one step.
         */
        interaction.points.push(
            point
        );

        interaction.currentPoint =
            point;

        interaction.startPoint =
            interaction.points[0];

        setToolMessage(
            interaction.points.length < 2
                ? "Specify second point"
                : "Specify third point"
        );

        renderCurrentDrawing();
        return;
    }

    if (
        drawingState.activeTool ===
        "triangle"
    ) {
        /*
         * Third point: complete the triangle from the
         * two stored points plus this one.
         */
        interaction.points.push(
            point
        );

        interaction.currentPoint =
            point;
    }

    if (
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
         * Second canvas point is placed, then the side
         * count is chosen before anything is created.
         * The polygon stays in preview until the count
         * is confirmed.
         */
        interaction.points.push(
            point
        );

        interaction.currentPoint =
            point;

        interaction.phase =
            "polygon-sides";

        openPolygonSidesPrompt(
            interaction
        );

        renderCurrentDrawing();
        return;
    }

    /*
     * A MOMENT BEING SIZED, ON A CLICK.
     *
     * This is where the commit belongs, and where it used to be missing.
     * It lived in the pointer-MOVE handler, which is worse than leaving
     * it out: a student moving the pointer along a beam to choose where
     * the moment goes would have the moment commit under the cursor
     * without a click, and by the time they clicked - the very thing the
     * status line told them to do - the phase had already been consumed
     * and the click did nothing.
     *
     * Enter masked it, because the Enter route is a separate path to the
     * same commit. So the tool appeared to work for anyone who noticed
     * Enter, and did nothing at all for everyone following the
     * instruction on screen.
     *
     * The application point is still the FIRST click's point, not this
     * one: the pointer has been sizing the arc, and a moment drawn around
     * wherever the pointer happened to be would be a different moment
     * from the one the student chose.
     *
     * Guarded on the PHASE as well as the tool, so it cannot fire twice
     * for one moment: the commit clears the interaction, and a second
     * click then finds no phase to match.
     */
    if (
        isBodyAttachedTool(
            drawingState.activeTool
        ) &&
        drawingState.interaction.phase ===
            "moment-radius"
    ) {
        commitMomentPlacement();

        return;
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
        drawingState.interaction.phase ===
            "statics-attach"
    ) {
        continueStaticsAttachment(
            resolution
        );

        return;
    } else if (
        drawingState.interaction.phase ===
            "truss-construct"
    ) {
        /*
         * A truss is built one member at a time using the
         * ordinary line interaction, so a click places the next
         * point of a member rather than creating a feature.
         */
        continueTrussConstruction(
            resolution
        );

        return;
    } else if (
        LOAD_BUILD_PHASES.has(
            drawingState.interaction.phase
        )
    ) {
        /*
         * ========================================================
         * ONE CLICK, ONE STEP
         * ========================================================
         *
         * This used to take a constant load's entire construction in a
         * single click: the magnitude came out of how far the pointer was
         * from the body and the direction out of which way it was pointing,
         * so the student chose neither - the tool decided both and showed
         * them afterwards.
         *
         * Now each click does exactly one thing, and the phase says which.
         * A click that is not yet the step the tool is waiting for changes
         * nothing, so a stray click cannot commit a load or skip a step.
         */
        const phase =
            drawingState.interaction.phase;

        if (
            phase ===
            "distributed-load-start"
        ) {
            takeDistributedLoadStart(
                point
            );

            return;
        }

        if (
            phase ===
            "distributed-load-end"
        ) {
            /*
             * THE SECOND CLICK IS AGAINST THE SAME BODY.
             *
             * A click on a different member is not the end of this load -
             * it is the start of a load on that member, and switching
             * silently would leave a load on the first body that the
             * student thought they had abandoned.
             */
            if (
                !distributedLoadPointOnBody(
                    point
                )
            ) {
                setToolMessage(
                    "Specify end point on the same body"
                );

                renderProperties();

                return;
            }

            takeDistributedLoadEnd(point);

            return;
        }

        if (
            phase ===
            "distributed-load-vector"
        ) {
            /*
             * ONE DRAG FIXES THE MAGNITUDE AND THE DIRECTION TOGETHER.
             *
             * Both are read from the same cursor vector about the MIDPOINT
             * of the loaded region - a FIXED origin, so that aiming cannot
             * move the load - and the vector's own angle is what the feature
             * stores. There is no typed magnitude and no angle field in this
             * step, because the vector IS both values.
             *
             * THE CURSOR IS THE ACTUAL POINTER, NOT THE SNAPPED POINT.
             *
             * `point` is the resolved construction point, so near an end of
             * the span it IS that end exactly. Handing it to the vector made
             * the direction jump to the midpoint-to-endpoint diagonal as the
             * cursor crossed the span, which is the rotation this fixes.
             * `distributedLoadDirectionCursor` gives the raw (or
             * H/V-constrained) pointer instead, and it is the same reading
             * the preview uses - so the committed load is the one shown.
             */
            takeDistributedLoadVector(
                distributedLoadRegionMidpoint(),
                point,
                distributedLoadDirectionCursor(
                    resolution
                )
            );

            return;
        }

        return;
    } else if (
        drawingState.interaction.phase ===
            "distributed-load-build"
    ) {
        /*
         * A varying distributed load takes one magnitude-defining point
         * per click and is finished with Enter, so the click never
         * commits anything on its own. Its phase is not one of the
         * uniform load's steps (LOAD_BUILD_PHASES), so it has its own
         * branch: folded into theirs, this call could never be reached.
         */
        continueDistributedLoadBuild(
            resolution
        );

        return;
    } else if (
        drawingState.interaction.phase ===
            "distributed-load-span"
    ) {
        /*
         * The load was started in empty space, so the two-click
         * Line-style span is completed first. The load's
         * construction proper only starts once the region it
         * loads is known.
         */
        const spanEnd = {
            x: point.x,
            y: point.y
        };

        const span = {
            start: interaction.points[0],
            end: spanEnd
        };

        if (isVaryingLoadTool()) {
            startDistributedLoadBuild(span);
        } else {
            /*
             * TRACED IN EMPTY SPACE. There is no body, so the two clicks
             * ARE the loaded region.
             *
             * THE TWO CLICKS ARE ALSO THE START AND THE END, so the
             * load moves straight on to its MAGNITUDE AND DIRECTION.
             *
             * It used to step into `distributed-load-start` here and ask
             * for the start and the end again, so a load traced in empty
             * space cost four point clicks and two of them discarded the
             * span the student had just drawn. On a body the ends must be
             * asked for, because the click only names the member; in empty
             * space the clicks ARE the ends, and there is nothing left to
             * ask for.
             *
             * `resolution` is spread in rather than replaced so the snap
             * and inference this click produced survive into the step that
             * reads the pointer for the vector.
             */
            enggDrawingState.setInteraction(
                drawingState,
                {
                    ...resolution,
                    phase: "distributed-load-vector",
                    loadSourceId: null,
                    loadStart: {
                        ...span.start,
                    },
                    loadEnd: {
                        ...span.end,
                    },

                    /*
                     * THE FIXED ORIGIN FOR THE DIRECTION, captured the
                     * moment the region is complete. Both ends are known
                     * here and neither moves again, so the vector that
                     * sets the direction always runs from this one point.
                     */
                    loadReferencePoint: {
                        x:
                            (span.start.x +
                                span.end.x) /
                            2,
                        y:
                            (span.start.y +
                                span.end.y) /
                            2
                    },

                    loadDirection: null,
                    loadMagnitude: 0
                }
            );

            setToolMessage(
                "Move to set magnitude and direction, then click"
            );

            renderProperties();
            renderCurrentDrawing();
        }

        return;
    } else if (
        (DYNAMICS_SPAN_TOOLS[drawingState.activeTool] ||
            DYNAMICS_BOX_TOOLS[drawingState.activeTool] ||
            DYNAMICS_ANGLE_TOOLS[drawingState.activeTool]) &&
        (interaction.phase === "dynamics-span" ||
            interaction.phase === "dynamics-angle")
    ) {
        /*
         * THE SECOND POINT COMMITS. The tool id the gesture armed with is
         * the one that creates - not necessarily the tool armed NOW - so a
         * student who switched tools mid-drag cannot commit a hybrid.
         */
        const gestureTool = interaction.toolId || drawingState.activeTool;

        const object = createDynamicsFeature(
            gestureTool,
            interaction.points[0],
            point
        );

        if (object) {
            enggDrawingState.clearInteraction(drawingState);
        }

        renderCurrentDrawing();
        return;
    } else if (
        STATICS_SPAN_TOOLS[
            drawingState.activeTool
        ] &&
        interaction.phase ===
            "statics-span"
    ) {
        /*
         * A Reference Line reuses the ordinary line
         * geometry, distinguished only by its statics
         * metadata, so it never becomes a second line
         * primitive.
         */
        const isReferenceLine =
            drawingState.activeTool ===
            "reference-line";

        /*
         * The feature type the active tool creates. It is
         * resolved before it is used, because the attachment
         * below depends on it.
         */
        const type =
            STATICS_CHILD_TOOLS[
                drawingState.activeTool
            ]?.type;

        const style = {
            style: {
                ...drawingState.styleDefaults,

                /*
                 * A Point Force is a symbol rather than an
                 * outline, so it starts heavier than the general
                 * line weight. The same choice is made in
                 * staticsAttachedStyle for the attached path, so
                 * a force dropped on a body and one drawn in free
                 * space are equally heavy.
                 */
                lineWidth:
                    staticsForceLineWidth(
                        drawingState.activeTool
                    ),

                /*
                 * A reference line is construction geometry, so
                 * it starts in the construction line type. It is
                 * a style the student can change afterwards like
                 * any other, and the geometry underneath is a
                 * plain line, so it keeps every Line control.
                 */
                lineType:
                    isReferenceLine
                        ? "construction"
                        : drawingState.styleDefaults.lineType
            },

            engineering: {
                plane: "XY",
                discipline: "statics",

                staticsType:
                    drawingState.activeTool
            },

            /*
             * A Reference Line is named for its statics role
             * rather than its underlying geometry, so it
             * reads as such in the Feature Tree.
             */
            name:
                isReferenceLine
                    ? "Reference Line"
                    : undefined,

            /*
             * The first click's snap is what establishes
             * attachment. If the application point snapped
             * onto an existing engineering body, the new
             * feature is recorded as that body's child, so
             * the Feature Tree shows Beam 1 > Point Force 1
             * instead of two unrelated rows. It reuses the
             * existing snap result; no separate attachment
             * system is involved.
             */
            parentId:
                attachableStaticsType(type) &&
                interaction.parentId
                    ? interaction.parentId
                    : undefined
        };

        const start = {
            ...interaction.points[0]
        };

        const end = {
            x: point.x,
            y: point.y
        };

        /*
         * Dispatch on the feature type, so each span tool
         * builds its own coherent feature with the right
         * arguments. Most take two points, but a distributed
         * load takes an intensity between them and a varying
         * load takes an intensity at each end.
         */
        let object = null;

        if (type === "load") {
            object =
                enggDrawingState.geometryFactories.load(
                    start,
                    end,
                    10,
                    style
                );
        } else if (type === "varying-load") {
            object =
                enggDrawingState.geometryFactories[
                    "varying-load"
                ](
                    start,
                    end,
                    0,
                    10,
                    style
                );
        } else if (
            typeof enggDrawingState.geometryFactories[
                type
            ] === "function"
        ) {
            object =
                enggDrawingState.geometryFactories[
                    type
                ](
                    start,
                    end,
                    style
                );
        }

        if (!object) {
            setToolMessage(
                "That tool could not be created"
            );

            return;
        }

        /*
         * THE INTERACTION IS RELEASED BEFORE THE SIZE IS ASKED FOR.
         *
         * The span is complete, so the tool has no more points to
         * take. The member is not added yet - it is committed by
         * `commitCreatedFeature` once its size is known, so the
         * creation and its dimension are one undoable action and a
         * cancelled dimension leaves nothing behind.
         */
        enggDrawingState.clearInteraction(
            drawingState
        );

        /*
         * THE DOCUMENT AS IT STANDS BEFORE THE SIZE IS APPLIED.
         *
         * Taken here, after the span is complete but before any value
         * has been written, so "before" means the document the student
         * was looking at when they answered the popup.
         *
         * Undo then returns to exactly that document in one step.
         */
        const previousObjects =
            enggDrawingState.snapshotDrawing(
                drawingState
            );

        /*
         * ========================================================
         * A POINT FORCE ASKS FOR ITS MAGNITUDE, IN A POPUP
         * ========================================================
         *
         * The drag already decided WHERE the force acts and WHICH WAY it
         * points, and the cursor distance is offered as the SUGGESTED
         * magnitude - so a student happy with the size they dragged presses
         * Enter, and one who wants a round number types it. Either way the
         * stored magnitude is a real physical value the student stated, not a
         * screen distance silently reinterpreted.
         *
         * The force is NOT created until the popup is confirmed, so a
         * cancelled popup leaves nothing behind - the same guarantee the
         * creation-size popup gives for a Beam.
         *
         * THE CURSOR-DRIVEN CREATION IS UNTOUCHED. The drag still defines the
         * application point, the direction and the initial drawn length; this
         * only asks what the number IS, and the number is the label - it never
         * resizes the arrow the drag drew.
         */
        if (
            drawingState.activeTool ===
            "point-force"
        ) {
            const geometry =
                object.geometry || {};

            const suggested =
                Number(geometry.magnitude) || 0;

            // Keep the completed arrow visible while its value is pending.
            // It enters the document only after confirmation, as one undo step.
            drawingState.interaction.phase = "point-force-value";
            drawingState.interaction.preview = object;
            renderCurrentDrawing();

            openLoadValuePopup({
                title: "Point Load",
                label: "Magnitude",
                value: suggested.toFixed(2),
                unit: enggLoadProfile.DEFAULT_FORCE_UNIT,

                /*
                 * A FORCE IS STATED IN kN OR N.
                 *
                 * The popup is shared with the load magnitudes, so its unit
                 * list is given here rather than assumed - a force offered
                 * kN/m would name the wrong quantity entirely. These are the
                 * force units, and the student picks which to read in.
                 */
                units: enggLoadProfile.FORCE_UNITS,

                onOpen: () => {
                    setToolMessage(
                        "Enter the force magnitude"
                    );
                },

                onConfirm: confirmed => {
                    /*
                     * WHAT THE TYPED ANSWER MEANS.
                     *
                     * `readStaticsValue` is the ONE reader: a number is a
                     * magnitude, an EMPTY box is Unknown, and anything else is
                     * the student's own symbol. This used to be
                     * `Math.max(0, Number(value) || 0)`, which turned `F₁` and
                     * an empty box alike into ZERO - a measurement the student
                     * never stated.
                     *
                     * The geometry is still built from a NUMBER, because a
                     * vector needs a length to draw; for a symbol or an
                     * unknown the vector keeps the size the drag chose and the
                     * STATEMENT lives on the feature, which is what the
                     * annotation and the panel then report.
                     */
                    const answer = readStaticsValue(
                        confirmed.text ?? "",
                        confirmed.unit
                    );

                    const magnitude =
                        answer.kind === "number"
                            ? /*
                               * THE TYPED NUMBER IS IN THE UNIT THE STUDENT
                               * CHOSE, and the stored magnitude is in the
                               * base unit N - so it is converted back before
                               * the vector is built, the mirror of the
                               * display conversion the panel does. Without
                               * it, typing 2 kN at creation stored 2 N and
                               * the arrow became a thousandth of the force
                               * the student asked for.
                               */
                              Math.max(
                                  0,
                                  enggQuantities.convertValue(
                                      answer.value,
                                      "force",
                                      answer.unit || "N",
                                      "N"
                                  )
                              )
                            : Math.max(
                                  0,
                                  Number(object.geometry.magnitude) || 0
                              );

                    /*
                     * THE CHOSEN UNIT IS RECORDED ON THE FORCE, so the
                     * annotation and the Features panel write the magnitude
                     * the way the student stated it.
                     */
                    if (answer.kind === "number") {
                        enggLoadProfile.setForceUnit(
                            object.geometry,
                            confirmed.unit
                        );
                    }

                    /*
                     * THE VECTOR IS REBUILT FROM THE NEW MAGNITUDE.
                     *
                     * `setForceVector` is the ONE place a force's stored
                     * magnitude, angle, components and end are written
                     * together, so the drawn arrow cannot be left describing a
                     * different force from the number just entered. The
                     * direction is the one the drag chose.
                     */
                    const vector =
                        enggLoadProfile.forceVector(
                            object.geometry
                        );

                    enggLoadProfile.setForceVector(
                        object.geometry,
                        magnitude,
                        vector.angle
                    );

                    /* The number, the Unknown mark or the symbol. */
                    applyStaticsValue(object, answer, {
                        valueKey: "magnitude"
                    });

                    enggDrawingState.clearInteraction(drawingState);
                    commitCreatedFeature(
                        object,
                        previousObjects
                    );

                    setToolMessage(
                        staticsInstruction(
                            drawingState.activeTool
                        )
                    );

                    renderProperties();
                    renderCurrentDrawing();
                },

                onCancel: () => {
                    enggDrawingState.clearInteraction(drawingState);
                    activateTool("select");
                    setToolMessage(
                        "Point load cancelled"
                    );

                    renderCurrentDrawing();
                }
            });

            return;
        }

        commitCreatedFeature(
            object,
            previousObjects
        );

        setToolMessage(
            staticsInstruction(
                drawingState.activeTool
            )
        );

        renderProperties();
        renderCurrentDrawing();

        return;
    }

    if (
        isArcTool() &&
        interaction.phase ===
            "arc-centre"
    ) {
        interaction.points.push(
            point
        );

        interaction.currentPoint =
            point;

        interaction.phase =
            "arc-sweep";

        interaction.preview =
            null;

        setToolMessage(
            "Specify arc endpoint"
        );

        renderCurrentDrawing();
        return;
    }

    if (
        isArcTool() &&
        interaction.phase ===
            "arc-first"
    ) {
        interaction.points.push(
            point
        );

        interaction.currentPoint =
            point;

        interaction.phase =
            "arc-second";

        interaction.preview =
            null;

        setToolMessage(
            "Specify third point"
        );

        renderCurrentDrawing();
        return;
    }

    const first =
        interaction.startPoint;

    let object = null;

    if (
        drawingState.activeTool ===
        "line"
    ) {
        object =
            enggDrawingState.geometryFactories.line(
                first,
                point,
                {
                    style: {
                        ...drawingState.styleDefaults
                    },

                    engineering:
                        currentEngineeringMetadata()
                }
            );
    } else if (
        drawingState.activeTool ===
        "coordinate-system-2d"
    ) {
        /*
         * ========================================================
         * THE COORDINATE SYSTEM IS DRAWN BY ONE GESTURE
         * ========================================================
         *
         * The press is the origin and the release is the positive X
         * direction. The Y axis is derived from the X axis - it is drawn
         * perpendicular to it - so the student gets square axes from a
         * single drag and never has to place a third point or type an
         * angle. The angle is taken from the two committed points, not
         * from the pointer's snapped position on its own, so grid snapping
         * cannot skew the axes out of square: whatever direction the
         * release lands in, Y is exactly 90 degrees from X.
         *
         * The arm length is the distance the student dragged. Both the
         * positive and negative arms use it, so the origin sits in the
         * middle of the cross the way a coordinate system is drawn on
         * paper. There are no ticks, units or scale factors here - this
         * places the AXES, nothing else.
         */
        const arm = Math.hypot(
            point.x - first.x,
            point.y - first.y
        );

        if (arm <= 1e-9) {
            setToolMessage(
                "Place the X axis away from the origin"
            );

            return;
        }

        object =
            enggDrawingState.geometryFactories.coordinateSystem2D(
                {
                    x: first.x,
                    y: first.y
                },
                {
                    rotation: Math.atan2(
                        point.y - first.y,
                        point.x - first.x
                    ),

                    xAxisLength: arm,
                    yAxisLength: arm,
                    xPositiveLength: arm,
                    xNegativeLength: arm,
                    yPositiveLength: arm,
                    yNegativeLength: arm,

                    name: "Coordinate System",

                    style: {
                        ...drawingState.styleDefaults
                    },

                    metadata: {
                        reference: true,
                        coordinateSystem: "2d"
                    },

                    engineering:
                        currentEngineeringMetadata()
                }
            );
    } else if (
        drawingState.activeTool ===
        "circle"
    ) {
        object =
            enggDrawingState.geometryFactories.circle(
                first,

                distance(
                    first,
                    point
                ),

                {
                    style: {
                        ...drawingState.styleDefaults
                    },

                    engineering:
                        currentEngineeringMetadata()
                }
            );
    } else if (
        drawingState.activeTool === "rectangle" ||
        drawingState.activeTool === "control-volume" ||
        ["saturation-curve", "process-plot"].includes(drawingState.activeTool) ||
        ["piston-cylinder", "piston-cylinder-stoppers"].includes(drawingState.activeTool)
    ) {
        /*
         * SHIFT SQUARES THE RECTANGLE - ON COMMIT, FROM THE SAME FLAG THE
         * PREVIEW USED. The preview writes `squareConstrained` on the
         * interaction for the frame it drew, so a student who held Shift and
         * released gets exactly the shape they were looking at. Every other
         * rectangle-like tool (a control volume, a piston, a saturation curve)
         * ignores the flag, because their size is not the student's to
         * constrain.
         */
        const square =
            drawingState.activeTool === "rectangle" &&
            interaction.squareConstrained === true;

        const rectangle =
            rectangleGeometry(
                first,
                point,
                { square }
            );

        const isControlVolume = drawingState.activeTool === "control-volume";
        const isDiagram = ["saturation-curve", "process-plot"].includes(drawingState.activeTool);
        const isPiston = ["piston-cylinder", "piston-cylinder-stoppers"].includes(drawingState.activeTool);
        if ((isControlVolume || isPiston || isDiagram) && (rectangle.width <= 1e-9 || rectangle.height <= 1e-9)) {
            setToolMessage("Specify opposite corner to enclose an area");
            return;
        }

        object =
            enggDrawingState.geometryFactories.rectangle(
                rectangle.position,
                rectangle.width,
                rectangle.height,
                rectangle.rotation,
                {
                    ...(isControlVolume ? {
                        name: "Control Volume",
                        metadata: { thermodynamicsKind: "control-volume" }
                    } : {}),
                    ...(isPiston ? {
                        name: "Piston Cylinder",
                        metadata: { thermodynamicsKind: "piston-cylinder" }
                    } : {}),
                    style: {
                        ...drawingState.styleDefaults,
                        ...(isControlVolume ? { stroke: "#ff0000", lineType: "dashed", fill: "none" } : {}),
                        ...(isPiston || isDiagram ? { lineType: "solid", fill: "none" } : {})
                    },

                    engineering:
                        currentEngineeringMetadata()
                }
            );
        if (isPiston && drawingState.activeTool === "piston-cylinder-stoppers") {
            object.geometry.hasStoppers = true;
            object.geometry.stopperFraction = 0.8;
        }
        if (isDiagram) {
            object.name = drawingState.activeTool === "process-plot" ? "Process Plot" : "Saturation Curve";
            object.metadata = { thermodynamicsKind: drawingState.activeTool };
        }
    } else if (
        ["polyline", "freeform-polygon"].includes(drawingState.activeTool)
    ) {
        if (drawingState.activeTool === "freeform-polygon") {
            commitFreeformPolygon(interaction);
            return;
        }

        object =
            enggDrawingState.geometryFactories.polyline(
                [
                    ...interaction.points
                ],

                {
                    style: {
                        ...drawingState.styleDefaults
                    },

                    engineering:
                        currentEngineeringMetadata()
                }
            );
        if (drawingState.activeTool === "freeform-polygon") {
            object.geometry.closed = true;
            object.name = `Freeform Polygon ${drawingState.objects.filter(
                candidate => candidate.type === "polyline" &&
                    candidate.geometry?.closed === true
            ).length + 1}`;
        }
    } else if (
        drawingState.activeTool ===
            "triangle" &&
        interaction.points.length >= 3
    ) {
        /*
         * One Triangle feature built from the three
         * placed points, closed back to the first.
         */
        object =
            enggDrawingState.geometryFactories.triangle(
                [
                    ...interaction.points
                ],

                {
                    style: {
                        ...drawingState.styleDefaults
                    },

                    engineering:
                        currentEngineeringMetadata()
                }
            );
    } else if (
        isArcTool() &&
        interaction.phase ===
            "arc-sweep" &&
        interaction.points.length >= 2
    ) {
        /*
         * Centrepoint arc: centre, start point and
         * endpoint are all placed, so the arc is
         * fully determined.
         *
         * This uses the same calculation as the
         * preview, with the same unwrapped cursor
         * angle, so the stored geometry matches what
         * the user just saw.
         */
        const arcGeometry =
            resolveCentrepointArc(
                interaction,
                point
            );

        if (arcGeometry) {
            object =
                enggDrawingState.geometryFactories.arc(
                    arcGeometry.center,

                    arcGeometry.radius,

                    arcGeometry.startAngle,

                    arcGeometry.endAngle,

                    referenceArcOptions()
                );

            if (
                object &&
                object.geometry
            ) {
                object.geometry.sweep =
                    arcGeometry.sweep;
            }
        } else {
            setToolMessage(
                "Start and endpoint must differ from the centre"
            );

            return;
        }
    } else if (
        isArcTool() &&
        interaction.phase ===
            "arc-second" &&
        interaction.points.length >= 2
    ) {
        /*
         * 3-point arc: the arc is the circumcircle
         * through the three placed points.
         */
        const arcGeometry =
            arcThroughThreePoints(
                interaction.points[0],
                interaction.points[1],
                point
            );

        if (arcGeometry) {
            object =
                enggDrawingState.geometryFactories.arc(
                    arcGeometry.center,

                    arcGeometry.radius,

                    arcGeometry.startAngle,

                    arcGeometry.endAngle,

                    referenceArcOptions()
                );

            if (
                object &&
                object.geometry
            ) {
                object.geometry.sweep =
                    arcGeometry.sweep;
            }
        } else {
            setToolMessage(
                "Points are collinear"
            );

            return;
        }
    }

    if (object) {
        /*
         * THE INTERACTION IS RELEASED BEFORE THE SIZE IS ASKED FOR.
         *
         * The geometry is complete, so the tool has no more points
         * to take - and leaving it mid-construction while a popup
         * is open would let a stray click add another point behind
         * the popup. The feature itself is not added yet: it is
         * committed by `commitCreatedFeature` once its size is
         * known, as one undoable action.
         */
        enggDrawingState.clearInteraction(
            drawingState
        );

        // A control volume is a boundary around a region, so commit its
        // drawn size without asking for a physical dimension or scale.
        if (["control-volume", "piston-cylinder", "saturation-curve", "process-plot"].includes(object.metadata?.thermodynamicsKind)) {
            commitCreatedFeature(object);
            if (["piston-cylinder", "saturation-curve", "process-plot"].includes(object.metadata.thermodynamicsKind)) {
                // The finished cylinder remains selected, with its handles
                // immediately available instead of starting another drawing.
                activateTool("select");
            }
            setToolMessage(object.metadata.thermodynamicsKind === "piston-cylinder"
                ? (object.geometry.hasStoppers
                    ? "Drag a stopper dot to adjust the stops, the centre dot to move the piston, or a corner to resize"
                    : "Drag the centre dot to adjust piston height, a corner to resize, or the cylinder to move")
                : object.metadata.thermodynamicsKind === "saturation-curve"
                    ? "Saturation curve created - drag the corner dots to resize"
                    : object.metadata.thermodynamicsKind === "process-plot"
                        ? "Process plot created - drag the corner dots to resize"
                        : "Control volume created");
            renderProperties();
            renderCurrentDrawing();
            return;
        }

        /*
         * The document as it stands BEFORE committing the new feature.
         *
         * Geometry creation is schematic (not to scale), so there is no
         * follow-up sizing prompt and no drawing-scale calibration step.
         * We still snapshot here so the commit is one undoable action.
         */
        const previousObjects =
            enggDrawingState.snapshotDrawing(
                drawingState
            );

        commitCreatedFeature(
            object,
            previousObjects
        );

        setToolMessage("Ready");

        renderProperties();
        renderCurrentDrawing();

        return;
    }

    enggDrawingState.clearInteraction(
        drawingState
    );

    setToolMessage(
        "Ready"
    );

    renderProperties();
    renderCurrentDrawing();
}

/*
 * Create a Point feature and select it, so its
 * Features panel opens straight away.
 */
function createPointFeature(
    point
) {
    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const object =
        enggDrawingState.geometryFactories.point(
            {
                x: point.x,
                y: point.y
            },
            {
                style: {
                    ...drawingState.styleDefaults
                },

                engineering:
                    currentEngineeringMetadata()
            }
        );

    enggDrawingState.addObject(
        drawingState,
        object
    );

    /*
     * THE TOOL'S APPEARANCE DEFAULTS, APPLIED AT CREATION.
     *
     * A tool's Features tab can set the colour, fill, thickness and line
     * type its NEXT objects get. They are merged into the object's style
     * here - once, at creation - rather than being stored anywhere against
     * the tool's existing objects, which is what makes them DEFAULTS and
     * not a live link: a polygon drawn before the sides default changed
     * keeps the sides it was drawn with, and one drawn after takes the
     * new ones.
     *
     * Only the keys the tool declares are applied, so a setting the tool
     * does not offer cannot arrive here by accident.
     */
    if (drawingState.activeTool) {
        const appearance = toolAppearance(drawingState.activeTool);

        if (object.style && Object.keys(appearance).length) {
            object.style = { ...object.style, ...appearance };
        }
    }

    /*
     * THE TOOL'S FIXED DEFAULT, APPLIED AT CREATION.
     *
     * A tool can declare that the objects it creates START fixed (the
     * Features tab's Fixed checkbox). This is the one place every committed
     * creation passes through, so the setting is honoured whatever tool or
     * construction path made the object, and it is applied as a plain field
     * before the first history entry - the object was never un-fixed, so
     * Undo has nothing to undo about it.
     *
     * Only geometry types take it: a Statics feature's movability is decided
     * by its attachment, and forcing "fixed" on it would fight the attachment
     * model. (The geometry types are the ones the source writer knows.)
     */
    if (
        drawingState.activeTool &&
        [
            "line", "point", "polyline", "triangle", "polygon",
            "freeform-polygon",
            "circle", "arc", "rectangle"
        ].includes(object.type) &&
        defaultFixedFor(drawingState.activeTool)
    ) {
        object.locked = true;
    }

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    enggDrawingState.clearInteraction(
        drawingState
    );

    enggDrawingState.selectObject(
        drawingState,
        object.id
    );

    if (STATICS_CHILD_TOOLS[drawingState.activeTool]) {
        activateTool("select");
    } else {
        setToolMessage("Specify point");
    }

    renderProperties();
    renderCurrentDrawing();
}

/*
 * The coordinate system is ONE feature.
 *
 * It has a single shared origin and four independently
 * adjustable axis extensions: +X, -X, +Y and -Y. All
 * four lengths live on this one object, so it stays a
 * single entry in the Feature Tree while each side can
 * still be extended on its own.
 */
export function add2DCoordinateSystem(
    origin
) {
    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const coordinateSystem =
        enggDrawingState.createGeometryObject(
            COORDINATE_SYSTEM_TYPE,
            {
                origin: {
                    x: origin.x,
                    y: origin.y
                },

                xPositiveLength:
                    COORDINATE_SYSTEM_LENGTH,

                xNegativeLength:
                    COORDINATE_SYSTEM_LENGTH,

                yPositiveLength:
                    COORDINATE_SYSTEM_LENGTH,

                yNegativeLength:
                    COORDINATE_SYSTEM_LENGTH,

                /*
                 * THE AXIS LABELS ARE STORED VALUES, NOT PLACEHOLDERS.
                 *
                 * "X" and "Y" are the DEFAULTS a new coordinate system is
                 * created with. They are written into the document here, so
                 * from this moment on the stored text is what is drawn - which
                 * is what lets the user clear a label and have it stay cleared,
                 * rather than the panel re-inventing the default every time.
                 *
                 * Their POSITIONS start unset: a label with no stored position
                 * is drawn at its automatic place beside the axis, and the
                 * moment the student drags one, the position they chose is
                 * stored and used from then on.
                 */
                xLabel: "X",
                yLabel: "Y",
                xLabelPosition: null,
                yLabelPosition: null
            },
            {
                name:
                    "Coordinate System",

                style: {
                    stroke: "#000000",
                    fill: "none",
                    lineWidth: 0.75,
                    lineType: "solid",
                    opacity: 1
                },

                metadata: {
                    reference: true,
                    coordinateSystem: "2d"
                },

                engineering: {
                    plane: "XY"
                }
            }
        );

    enggDrawingState.addObject(
        drawingState,
        coordinateSystem
    );

    enggDrawingState.commitDrawingChange(
        drawingState,
        previousObjects
    );

    enggDrawingState.clearSelection(
        drawingState
    );

    activateTool("select");

    renderProperties();
    renderCurrentDrawing();
}
