/*
 * Resolving the pointer: snapping, inference, and the status feedback.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggDrawingSnap from "../../../shared/snapping/object-snap.js";
import enggLoadProfile from "../model/analysis/load-profile.js";
import enggDrawingRenderer from "../../../shared/rendering/renderer.js";
import { analysisAxisForPlacement } from "../statics/analysis-tools.js";
import { syncSelectionInteraction } from "./canvas-click.js";
import { renderCurrentDrawing, requestRender } from "../../../components/layout/workspace/canvas-render.js";
import { isConstructionTool } from "../../../components/layout/toolbar/construction-tools.js";
import { drawingCanvas, drawingCoordinates } from "../dom.js";
import { drawingSnap, drawingState, editorState } from "../editor-state.js";
import { trussInferenceAnchor } from "../geometry/geometry-creation.js";
import { isLoadBuildPhase, isLoadSpanPhase } from "../statics/load-tool.js";
import { updateModifyPreview } from "../commands/modify-tools.js";
import { updatePreview } from "../geometry/preview.js";
import { STATICS_SPAN_SNAP_TOOLS } from "../statics/statics-tools.js";
import { canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { isArcTool } from "../../../components/layout/toolbar/tool-menus.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { allowsDirectManipulation } from "./direct-manipulation.js";
import { handleAtPoint, isConstructionInProgress } from "./handles.js";
import { objectAtPoint, pickDerivedMagnitude } from "./hit-testing.js";
import { isDerivedFeature } from "../../../shared/model/feature-types.js";
import { selectionBounds, selectionMembers } from "../../../shared/selection/selection-transform.js";

function updateMoveCursor(event) {
    let movable = false;
    if (allowsDirectManipulation() && !event.shiftKey &&
        !editorState.modifySession && !isConstructionInProgress()) {
        const point = canvasPointFromEvent(event, false);
        const hit = handleAtPoint(point);
        const object = objectAtPoint(point);
        const target = hit?.object || object;
        movable = Boolean(target && !target.locked && !isDerivedFeature(target));
        if (pickDerivedMagnitude(point)) {
            movable = true;
        }

        const ids = drawingState.selection.selectedObjectIds;
        if (ids.length > 1) {
            const box = selectionBounds(drawingState.objects, ids, drawingState);
            if (box && point.x >= box.minX && point.x <= box.maxX &&
                point.y >= box.minY && point.y <= box.maxY) {
                movable = selectionMembers(drawingState.objects, ids)
                    .every(member => !member.locked && !isDerivedFeature(member));
            }
        }
    }
    if (allowsDirectManipulation() &&
        (editorState.manipulationDrag || editorState.selectionDrag?.derived ||
            editorState.selectionDrag?.axisLabel)) {
        movable = true;
    }
    drawingCanvas?.classList.toggle("drawing-can-move", movable);
}

/*
 * The positional reference of each SELECTED force, for horizontal alignment.
 *
 * A force feature acts at one point: a Point Force at its `position`, an
 * applied moment at its `position`, a distributed load at the midpoint of its
 * span. Those are the places a student means when they line a new load up
 * with an existing one, so they are the points offered to the shared H/V
 * inference.
 *
 * Offering them as ordinary inference references is what makes "snap
 * horizontally to another selected force" work through the EXISTING system:
 * the resolver aligns the cursor to the reference's row, and the direction
 * vector built from the load's own reference then comes out exactly 0 or 180
 * degrees rather than a degree or two off.
 *
 * Only SELECTED features are read, so this is the ordinary "align to what I
 * have chosen" gesture rather than a rule that reaches into the whole sheet.
 */
function selectedForceAnchorPoints() {
    const selection =
        drawingState.selection?.selectedObjectIds || [];

    if (!selection.length) {
        return [];
    }

    return selection
        .map(id =>
            drawingState.objects.find(object => object.id === id)
        )
        .filter(Boolean)
        .map(object => {
            const geometry = object.geometry;

            if (!geometry) {
                return null;
            }

            /*
             * A span-shaped load or force aligns on the midpoint of the
             * region it acts on; a point feature aligns on the point.
             */
            if (geometry.start && geometry.end) {
                return {
                    x: (geometry.start.x + geometry.end.x) / 2,
                    y: (geometry.start.y + geometry.end.y) / 2
                };
            }

            return geometry.position || null;
        })
        .filter(
            point =>
                point &&
                Number.isFinite(point.x) &&
                Number.isFinite(point.y)
        );
}

function resolvePointerPoint(
    rawPoint
) {
    // Control volumes outline a region with clearance from nearby equipment.
    // Keep both corners at the pointer, without snapping or held guides.
    if (drawingState.activeTool === "control-volume") {
        return {
            rawPointerPoint: { ...rawPoint },
            effectiveConstructionPoint: { ...rawPoint },
            snappedPoint: null, inferredPoint: null,
            snapCandidate: null, hoveredEntity: null,
            inference: null, guideline: null
        };
    }
    /*
     * THE ANALYSIS AXIS PLACEMENT IS NOT A CONSTRUCTION TOOL, BUT IT
     * STILL NEEDS THE POINTER.
     *
     * The diagram tools no longer place a span, so they are not
     * construction tools and would return the bare pointer below -
     * which would leave the preview unsnapped and the student aiming
     * by eye at a reference line the whole sheet is built to help them
     * hit.
     *
     * So the placement phase resolves the pointer through the ordinary
     * snapping pipeline, and this is the ONLY reason it is mentioned
     * here. There is no Analysis-specific snapping: the same shared
     * candidates, the same tolerance, the same indicators and the
     * same bottom-of-screen wording as every other tool. The axis the
     * student lands on can be a Reference Point or a horizontal guide
     * because those are things the sheet already offers to snap to.
     */
    if (
        drawingState.interaction.phase ===
            "analysis-axis"
    ) {
        return resolveAnalysisAxisPointer(
            rawPoint
        );
    }

    if (
        !isConstructionTool(
            drawingState.activeTool
        )
    ) {
        return {
            rawPointerPoint: {
                ...rawPoint
            },

            effectiveConstructionPoint: {
                ...rawPoint
            },

            snappedPoint: null,
            inferredPoint: null,
            snapCandidate: null,
            hoveredEntity: null,
            inference: null
        };
    }

    const bounds =
        drawingCanvas.getBoundingClientRect();

    const interaction =
        drawingState.interaction;

    /*
     * While the arc centre is being placed, the first arc
     * point is the inference anchor, so the centre can
     * align with it horizontally and vertically.
     */
    const arcCentrePhase =
        isArcTool() &&
        interaction.phase ===
            "arc-centre";

    /*
     * During the arc sweep phase, use the centre as
     * the inference anchor so horizontal and vertical
     * inference work while placing the endpoint.
     */
    const arcEndpointPhase =
        isArcTool() &&
        (
            interaction.phase ===
                "arc-sweep" ||
            interaction.phase ===
                "arc-second"
        );

    const isPolyline =
        drawingState.activeTool ===
            "polyline" ||
        drawingState.activeTool === "freeform-polygon";

    /*
     * The line tool needs its first point as the inference
     * anchor so horizontal and vertical inference works
     * while placing the second point.
     */
    const isLine =
        drawingState.activeTool ===
            "line" ||
        drawingState.activeTool ===
            "point-force" ||
        (
            drawingState.activeTool ===
                "truss" &&
            drawingState.interaction
                .phase ===
                "truss-construct"
        ) ||

        /*
         * The two-click Statics spans join the same shared inference.
         *
         * A Beam, a Cable and a Shaft are placed between two points
         * exactly as a Line is, and their previews already draw from
         * `interaction.points[0]` - the first click - to the resolved
         * point. What they were missing was only the ANCHOR: with no
         * `lineStart`, the shared resolver had nothing to align
         * against, so horizontal and vertical inference never ran and
         * the bottom of the canvas could not say what the snap was.
         *
         * Naming them here is the whole change. Every tolerance, every
         * snap target, the priority order, the indicator and the
         * instruction all come from the same `resolveConstructionPoint`
         * call the Line tool has always used - nothing is reimplemented,
         * and each tool keeps its own semantic feature and its own
         * construction behaviour.
         *
         * The snapshot the resolver takes of the snap geometry is
         * unchanged, so an in-progress member still appears as a snap
         * target for itself, as it did before.
         */
        STATICS_SPAN_SNAP_TOOLS.includes(
            drawingState.activeTool
        );

    let lineStart = null;

    /*
     * ========================================================
     * THE PIPE / DUCT LEG JOINS THE SAME SHARED INFERENCE
     * ========================================================
     *
     * A run is a span placed between two points, exactly as a Line is:
     * the press fixes the start, the pointer supplies the end. What it
     * was missing was only the ANCHOR. With no `lineStart`, the shared
     * resolver had nothing to align against, so horizontal and vertical
     * inference never ran for a pipe - the preview showed a visibly
     * diagonal run when the student meant level, and the committed run
     * carried the same off-axis end, because the release resolves its
     * end through this very same call.
     *
     * The anchor is the leg's own START, read from the interaction the
     * same way the preview reads it (`routeSegmentStart`, falling back
     * to `startPoint`), so the preview and the committed geometry are
     * inferred from the identical reference and cannot disagree.
     *
     * Naming it here is the whole change. Every tolerance, every snap
     * target, the priority order, the indicator and the instruction all
     * come from the same `resolveConstructionPoint` call the Line tool
     * has always used - nothing is reimplemented, and the pipe keeps its
     * own semantic feature and its own drag lifetime.
     *
     * It is offered BOTH as `lineStart` and as an inference reference,
     * because the anchor must align against itself when no other
     * geometry is near - the run being drawn is not yet a feature, so
     * the only reference that guarantees "level with where I started"
     * is the start point passed here. A snapped start - on a previous
     * run's endpoint or a corner - arrives already resolved, so aligning
     * to it keeps the connection the snap established.
     */
    const isRoute =
        drawingState.activeTool === "pipe-duct" ||
        drawingState.interaction.fluidsTool === "pipe-duct";

    if (isLine || isRoute) {
        /*
         * A truss anchors inference on the point its next member
         * starts from, exactly as a Line does on its own start
         * point, so horizontal and vertical alignment work while
         * a member is being drawn. A Point Force is a Line in
         * every respect that matters here, so it is treated as
         * one.
         */
        lineStart = isRoute
            ? interaction.routeSegmentStart ||
              interaction.startPoint ||
              null
            : drawingState.activeTool ===
                "truss"
              ? trussInferenceAnchor(
                    drawingState.interaction
                )
              : interaction.startPoint;
    } else if (isPolyline) {
        lineStart =
            interaction.points.length
                ? interaction.points[
                    interaction.points.length - 1
                ]
                : null;
    } else if (
        isLoadSpanPhase(interaction)
    ) {
        /*
         * A loaded span drawn by hand is a Line, so it anchors on
         * its own start point exactly as a Line does. Without this
         * the span could not be pulled square, which is the first
         * thing a student does when they trace a loaded region.
         */
        lineStart =
            (interaction.points &&
                interaction.points[0]) ||
            interaction.startPoint;
    } else if (
        isLoadBuildPhase(interaction)
    ) {
        /*
         * While a load is being defined, the ends of the span it
         * acts on are the meaningful references for alignment: a
         * force drawn square to the body, or to a joint at either
         * end of it, is what the student is aiming at. Both ends
         * are published so the cursor can align with either, and
         * the check happens on the live cursor, so the preview is
         * already square before the click.
         *
         * The distribution points already placed on this load are
         * published too. Defining a second point square to the
         * first is the same act as drawing a member square to a
         * truss joint, and it goes through the same global
         * inference rather than a rule of the load's own.
         */
        lineStart =
            interaction.distributedLoadStart ||
            interaction.loadStart ||
            null;
    } else if (
        drawingState.activeTool ===
            "triangle"
    ) {
        /*
         * While placing the second and third
         * corners, the previously placed corner is
         * the inference anchor, so the new point can
         * align with it horizontally and vertically.
         */
        lineStart =
            interaction.points.length
                ? interaction.points[
                    interaction.points.length - 1
                ]
                : null;
    } else if (
        arcCentrePhase
    ) {
        /*
         * The already placed first arc point anchors the
         * centre point, using the same inference pipeline
         * as every other tool.
         */
        lineStart =
            interaction.points.length
                ? interaction.points[0]
                : interaction.startPoint;
    } else if (
        arcEndpointPhase
    ) {
        lineStart =
            interaction.points.length
                ? interaction.points[0]
                : interaction.startPoint;
    }

    /*
     * The 3-point arc anchors on the second point,
     * because the third point is what closes the arc.
     */
    if (
        isArcTool() &&
        interaction.phase ===
            "arc-second" &&
        interaction.points.length > 1
    ) {
        lineStart =
            interaction.points[1];
    }

    /*
     * While placing the triangle's third corner, or the
     * 3-point arc's third point, both earlier points act
     * as H/V inference references, so the new point can
     * align with either of them.
     */
    const multiPointAnchor =
        (drawingState.activeTool === "triangle" ||
            (isArcTool() &&
                interaction.phase === "arc-second")) &&
        interaction.points.length >= 2;

    /*
     * The far end of a loaded span is a second alignment
     * reference while the load is being defined, so a force can
     * be pulled square to either end of the body it acts on
     * rather than only to the one it was anchored from.
     */
    const loadSpanEndAnchor =
        isLoadBuildPhase(interaction)
            ? interaction.distributedLoadEnd ||
              interaction.loadEnd ||
              null
            : null;

    /*
     * The distribution points already placed on the load being
     * built, as world positions along its span - their TAILS and their
     * TIPS.
     *
     * Defining a second point square to the first is the same act
     * as drawing a truss member square to a joint it meets, and it
     * is answered by the same global inference rather than by a
     * rule of the load's own: a point of a load is a place in the
     * drawing, so the next point can align with it exactly as it
     * aligns with a joint.
     *
     * The TAIL is where the force acts on the body, so aligning with it
     * puts the next point at the same station. The TIP is the head of the
     * force - the tail carried out along the load's direction by the
     * magnitude - so aligning with THAT puts the next point at the same
     * magnitude. Both are real, visible places in the drawing, and both
     * go through the same inference every other alignment uses.
     */
    const loadPointAnchors =
        isLoadBuildPhase(interaction)
            ? (() => {
                  const loadStart =
                      interaction.distributedLoadStart ||
                      interaction.loadStart;

                  const loadEnd =
                      interaction.distributedLoadEnd ||
                      interaction.loadEnd;

                  if (!loadStart || !loadEnd) {
                      return [];
                  }

                  /*
                   * The direction the force lines are drawn in: the one
                   * the student chose at an end of the span, or the
                   * span's own PERPENDICULAR when none has been chosen
                   * yet. That is the direction the varying load actually
                   * draws its arrows in, so a tip lines up with the arrow
                   * the student can see rather than with an arbitrary
                   * world axis.
                   */
                  const stored =
                      interaction.distributedLoadDirection;

                  const chosen =
                      stored !== null &&
                      stored !== undefined;

                  let degrees = null;

                  if (chosen) {
                      degrees = Number(stored);
                  } else {
                      const dx =
                          loadEnd.x - loadStart.x;

                      const dy =
                          loadEnd.y - loadStart.y;

                      if (
                          Math.hypot(dx, dy) >=
                          1e-9
                      ) {
                          degrees =
                              Math.atan2(
                                  dx,
                                  -dy
                              ) *
                              180 /
                              Math.PI;
                      }
                  }

                  const direction =
                      enggLoadProfile.unitVector(
                          Number.isFinite(degrees)
                              ? degrees
                              : enggLoadProfile
                                    .DEFAULT_LOAD_DIRECTION
                      );

                  return (interaction.distributedLoadPoints || [])
                      .flatMap((point) => {
                          const along =
                              enggLoadProfile.pointAlong(
                                  {
                                      start: loadStart,
                                      end: loadEnd
                                  },
                                  point.t
                              );

                          if (!along) {
                              return [];
                          }

                          const magnitude =
                              Math.max(
                                  0,
                                  Number(point.magnitude) || 0
                              );

                          if (magnitude <= 0) {
                              return [along];
                          }

                          return [
                              along,
                              {
                                  x:
                                      along.x +
                                      direction.x *
                                          magnitude,
                                  y:
                                      along.y +
                                      direction.y *
                                          magnitude
                              }
                          ];
                      });
              })()
            : [];

    /*
     * The fixed point the load's direction is measured from, offered to the
     * shared H/V inference so the direction can be squared to world vertical
     * or horizontal.
     *
     * It is the midpoint of the loaded region - the same reference
     * `distributedLoadRegionMidpoint` (constant load) and
     * `distributedLoadDirectionReference` (varying load) read the direction
     * from - and it exists only once the span is frozen. Before that there
     * is no region to measure a direction from, so there is nothing to
     * align to and the list is empty.
     *
     * A later enrichment of this list is where alignment to another
     * SELECTED force's reference would be offered; the mechanism is the
     * same one point of reference per alignment, so nothing here is
     * specific to the load.
     */
    const loadDirectionAnchors = (() => {
        if (!isLoadBuildPhase(interaction)) {
            return [];
        }

        const loadStart =
            interaction.distributedLoadStart || interaction.loadStart;

        const loadEnd =
            interaction.distributedLoadEnd || interaction.loadEnd;

        if (!loadStart || !loadEnd) {
            return [];
        }

        /* The stored reference when there is one, the midpoint otherwise. */
        const stored = interaction.loadReferencePoint;

        const reference =
            stored &&
            Number.isFinite(stored.x) &&
            Number.isFinite(stored.y)
                ? stored
                : {
                      x: (loadStart.x + loadEnd.x) / 2,
                      y: (loadStart.y + loadEnd.y) / 2
                  };

        return [reference, ...selectedForceAnchorPoints()];
    })();

    const inferenceReferences = [
        ...(multiPointAnchor
            ? [interaction.points[0], interaction.points[1]]
            : []),
        ...(loadSpanEndAnchor ? [loadSpanEndAnchor] : []),
        ...loadPointAnchors,

        /*
         * THE LOAD'S OWN DIRECTION REFERENCE.
         *
         * The direction vector runs FROM the fixed reference point of the
         * loaded region TO the cursor, so the cursor being directly above
         * (or level with) that reference is what makes the load exactly
         * vertical (or horizontal).
         *
         * Adding the reference here is what lets the EXISTING horizontal /
         * vertical inference reach the direction: the resolver already
         * aligns the cursor to any reference point it is given, so the
         * cursor is pulled to the reference's column or row and the vector
         * built from it comes out exactly ±90 or 0 degrees rather than
         * 88.9 or 1.4.
         *
         * It is added ONLY while the direction is being defined - the span
         * is already frozen by then, so this can never move Start, End or
         * the loaded region. The reference is the SAME value the direction
         * is measured from, so the alignment it offers is precisely the one
         * the direction needs, and no rule of the load's own is introduced:
         * it is one more point for the shared alignment, nothing more.
         */
        ...(loadDirectionAnchors)
    ];

    return drawingSnap.resolveConstructionPoint(
        {
            ...rawPoint
        },
        drawingState,
        bounds,
        {
            lineStart,

            inferenceReferences,

            /*
             * A LOAD ALIGNS TO ITS OWN GEOMETRY EVEN OVER THE BODY.
             *
             * A load's points go ON the member, and the member's own
             * geometry always answers the snap search first - so without
             * this, a point could never be put level with a span end or an
             * earlier force while the cursor was on the beam, which is
             * everywhere a load's point ever is. This asks the shared
             * resolver to consider the alignment guide alongside the snap,
             * so horizontal and vertical alignment work for the load tools
             * exactly as they do for every other tool.
             */
            preferInference:
                isLoadBuildPhase(interaction) ||
                isLoadSpanPhase(interaction),

            /*
             * Treat arc endpoint placement
             * like a line so horizontal and
             * vertical inference works.
             */
            tool:
                arcEndpointPhase
                    ? "line"
                    : drawingState.activeTool
        }
    );
}

/*
 * Resolve directly from the current pointer event.
 *
 * This is deliberately used for actual clicks as
 * well as mouse movement so the click can never
 * accidentally use a stale snap position from
 * a previous mousemove event.
 */
export function resolvePointerEvent(
    event
) {
    return resolvePointerPoint(
        canvasPointFromEvent(
            event,
            false
        )
    );
}

/*
 * THERMODYNAMICS SYMBOLS MOVE FREELY, with the grab offset preserved: a
 * control volume, a piston-cylinder moved as a body, the piston and its
 * stoppers sliding within the cylinder, and a process path's state labels.
 * Corner resizing still uses the normal snap and inference pipeline. Returns
 * the unsnapped resolution for those drags, and null for every other.
 */
function freeThermodynamicsMove(drag, rawPoint) {
    if (
        drag?.kind?.startsWith("process-label-") ||
        drag?.kind?.startsWith("process-bend-") ||
        drag?.object?.metadata?.thermodynamicsKind === "control-volume" ||
        (drag?.kind === "body" &&
            ["control-volume", "piston-cylinder"].includes(drag.object?.metadata?.thermodynamicsKind)) ||
        (["piston-height", "stopper-height"].includes(drag?.kind) &&
            drag.object?.metadata?.thermodynamicsKind === "piston-cylinder")
    ) {
        return {
            rawPointerPoint: { ...rawPoint },
            snappedPoint: { ...rawPoint },
            inferredPoint: { ...rawPoint },
            effectiveConstructionPoint: { ...rawPoint },
            snapCandidate: null,
            hoveredEntity: null,
            inference: null,
            guideline: null
        };
    }

    return null;
}

/*
 * ========================================================
 * THE POINTER WHILE AN EXISTING FEATURE IS BEING DRAGGED
 * ========================================================
 *
 * Direct manipulation is NOT a construction tool, so the ordinary
 * `resolvePointerPoint` above returns the bare pointer for it - no
 * object snap and no horizontal or vertical inference. That is what
 * made dragging a feature the one gesture in the application with no
 * snapping at all: a line could be drawn exactly level and could not be
 * MOVED exactly level, and the reported behaviour was that the guide
 * never appeared while a shape was dragged.
 *
 * The snap engine itself was never the problem - `resolveConstructionPoint`
 * already knows how to align a point against a reference and against the
 * sheet. What a drag was missing was only the two things a construction
 * supplies and a drag did not:
 *
 *   `lineStart`   the FIXED reference the movement is measured from. A
 *                 line's second point is squared to its first, and a
 *                 dragged feature is squared to where the drag began, so
 *                 the drag origin is passed as the same anchor. This is
 *                 what makes "approximately level" mean "level relative
 *                 to where I picked the feature up", which is the whole
 *                 point of the inference.
 *
 *   `preferInference`
 *                 asks the resolver to consider the alignment guide even
 *                 when a geometric snap candidate is available. A drag
 *                 usually starts ON geometry - the very feature being
 *                 moved - so without this the snap search would always
 *                 answer first and the alignment could never be taken.
 *
 * Everything else - the candidates, the tolerances, the priority order,
 * the indicator, the guideline hold - is the SAME machinery every tool
 * uses. Nothing is reimplemented here; this only feeds the drag's own
 * reference into the shared resolver so a drag behaves like every other
 * gesture.
 *
 * The reference is passed in by the caller (the drag), captured once when
 * the drag began. It is deliberately NOT re-read on every move: an anchor
 * that followed the cursor would make the inference measure the cursor
 * against itself, so the feature could never be pulled into line at all.
 */
export function resolveManipulationPoint(
    event,
    drag
) {
    const rawPoint =
        canvasPointFromEvent(
            event,
            false
        );

    const free = freeThermodynamicsMove(drag, rawPoint);

    if (free) {
        return free;
    }

    const bounds =
        drawingCanvas.getBoundingClientRect();

    /*
     * The anchor is the point the drag is measured FROM. For a whole-feature
     * move that is where the student picked it up; for an endpoint or a
     * handle it is the point being manipulated, so the movement is squared
     * to its own starting row or column. Both were captured at pointer down
     * and never move for the life of the drag.
     */
    const anchor =
        drag?.anchor &&
        Number.isFinite(drag.anchor.x) &&
        Number.isFinite(drag.anchor.y)
            ? { x: drag.anchor.x, y: drag.anchor.y }
            : null;

    return drawingSnap.resolveConstructionPoint(
        { ...rawPoint },
        drawingState,
        bounds,
        {
            /*
             * The drag's own reference, offered to the shared alignment
             * exactly as a Line offers its first point.
             */
            lineStart: anchor,

            /*
             * And offered a second time as an inference reference, so the
             * anchor participates in the horizontal/vertical candidate
             * search even when `lineStart` is consumed elsewhere.
             */
            inferenceReferences: anchor
                ? [anchor]
                : [],

            /*
             * A drag begins on the geometry it is moving, so the alignment
             * must be considered even while a snap candidate is found.
             */
            preferInference: true,

            /*
             * The active tool is Select, which no candidate filter knows
             * about, so every legitimate snap target stays available - the
             * same set a construction tool would see.
             */
            tool: drawingState.activeTool
        }
    );
}

/*
 * THE POINTER, RESOLVED FOR THE ANALYSIS AXIS PLACEMENT.
 *
 * Returns the same shape the construction pipeline returns, so
 * everything downstream - the snap marker, the inference line, the
 * status message - behaves exactly as it does for every other tool
 * without knowing anything about analysis.
 *
 * WHAT IT DOES WITH THE POINTER, AND WHY ONLY THAT
 * ----------------------------------------------
 * The student's cursor answers ONE question: how far above or below
 * their drawing should the diagram sit. So only the vertical
 * component of the resolved point is taken.
 *
 * The horizontal component is deliberately discarded. A student
 * sweeping the pointer across the sheet to find a height would
 * otherwise slide the axis sideways as they went, and a diagram that
 * drifts out from under its own beam is worse than one placed
 * slightly low - it breaks the alignment that makes A' sit under A
 * and the stations line up with the loads, which is the entire reason
 * the axis is derived from the source rather than drawn.
 */
function resolveAnalysisAxisPointer(
    rawPoint
) {
    const interaction =
        drawingState.interaction;

    /*
     * The shared snapping, asked exactly as any construction asks it.
     */
    const resolution =
        enggDrawingSnap.resolveConstructionPoint(
            rawPoint,
            drawingState,
            drawingCanvas.getBoundingClientRect()
        );

    const effective =
        resolution.effectiveConstructionPoint ||
        resolution.snappedPoint ||
        resolution.rawPointerPoint ||
        rawPoint;

    /*
     * The height the student has chosen.
     *
     * The SNAP point's y is used when there is one, so the axis can
     * be nudged exactly onto a horizontal guide or a Reference Point
     * - and only the height is taken, so a snap to something off to
     * one side cannot drag the axis with it.
     */
    if (Number.isFinite(effective.y)) {
        interaction.placementY = effective.y;
    }

    return {
        ...resolution,

        /*
         * The axis is derived from the source, not from the pointer,
         * so the construction point is the axis itself. That is what
         * the preview draws and what a snap against it would measure
         * against - and it is why snapping to the preview's own ends
         * works even though those ends are not the pointer.
         */
        effectiveConstructionPoint:
            analysisAxisForPlacement()
                ? {
                    start:
                        analysisAxisForPlacement()
                            .start,
                    end:
                        analysisAxisForPlacement()
                            .end
                }
                : effective
    };
}

/*
 * Short names for the snap and inference types.
 *
 * Deliberately terse, because these are APPENDED to a tool's instruction
 * rather than standing alone: "Horizontal" reads as a report tacked onto
 * the question the tool is asking, where "Horizontal snap" would be a
 * second, competing sentence.
 *
 * One table, read by every tool through `inferenceLabel`, so no two tools
 * can describe the same snap in different words.
 */
const SNAP_TYPE_LABELS = {
    endpoint: "Endpoint",
    midpoint: "Midpoint",
    quarter: "Quarter point",
    center: "Center",
    intersection: "Intersection",
    quadrant: "Quadrant",
    pointOnEntity: "Point on object",
    horizontal: "Horizontal",
    vertical: "Vertical",
    "horizontal-vertical": "Horizontal + Vertical",

    /*
     * A member's CENTRELINE, which is what a support attaches to.
     *
     * Named so the student can tell the two apart on screen. Without
     * it this would read "Point on object", which is true of every
     * surface on the drawing and says nothing about the fact that
     * this particular line is the one a support is placed against.
     */
    centreline: "Centreline",

    /*
     * A diagram's source station.
     *
     * Says what the snap CAUGHT, not merely that it caught something:
     * the whole value of snapping to a diagram marker is knowing that
     * it is the station a load or a support sits on rather than a
     * point that happened to be nearby.
     */
    "analysis-reference": "Source reference"
};

export function snapTypeLabel(
    type,
    candidate
) {
    if (!type) {
        return null;
    }

    const base =
        SNAP_TYPE_LABELS[type] ||
        (
            String(type)[0].toUpperCase() +
            String(type).slice(1)
        );

    /*
     * A NAMED SNAP SAYS WHICH ONE.
     *
     * A diagram publishes a station for every load and every support
     * on its source, and they are a few units apart on a dense beam.
     * "Source reference" tells the student they have caught one; "the
     * load" tells them which. The label is only ever what the
     * candidate already carries, so no message can name something the
     * snap did not actually reach.
     */
    if (
        type === "analysis-reference" &&
        candidate?.label
    ) {
        return base + " (" + candidate.label + ")";
    }

    return base;
}

export function inferenceLabel(
    inference
) {
    return snapTypeLabel(
        inference?.type || inference
    );
}

/*
 * ========================================================
 * THE STATUS TEXT FOR A LIVE CONSTRUCTION
 * ========================================================
 *
 * The tool's own instruction, with the current snap APPENDED - never
 * substituted for it.
 *
 * A snap that is working but not announced reads as a snap that is not
 * working: the geometry jumps into line and nothing says why. So every
 * construction that can be pulled square reports the alignment it has
 * taken, from the same resolution the preview was drawn from, and the
 * guide line the renderer shows and this message describe the same
 * condition.
 *
 * WHY IT IS APPENDED AND NOT REPLACED
 * ----------------------------------
 * This used to return the snap label ALONE. That is the wrong shape, and
 * it is wrong in a way that shows up on every tool at once: "Specify
 * second point" became "Horizontal", and the student was left with a
 * statement about geometry and no idea what the tool was asking them to
 * do. On a tool whose instruction was the only thing carrying the next
 * step - place a support along this beam, choose the pivot - losing it
 * made the tool unusable mid-construction.
 *
 * The snap label is a REPORT and the instruction is a QUESTION. The
 * student needs the answer to "what am I being asked to do?" first, and
 * the answer to "what just happened?" second - which is the order they
 * appear in, and the reason for the separator.
 *
 * The instruction always comes from `fallback`, so a tool whose
 * instruction changes as the construction progresses still shows the
 * current one rather than the one it had when the tool was armed.
 *
 * THE SNAP HALF IS WHAT MAKES THIS CHEAP TO GET RIGHT. Only the appended
 * part may be empty; the base may not. That is the whole invariant, and it
 * is why the snap label is filtered rather than the instruction.
 */
export function constructionFeedbackMessage(
    resolution,
    fallback
) {
    const feedback =
        [
            inferenceLabel(
                resolution.inference
            ),

            snapTypeLabel(
                resolution.snapCandidate?.type
            )
        ].filter(Boolean);

    /*
     * NO SNAP, NO SUFFIX - not a separator, not a bullet on its own. The
     * status is then exactly the tool's instruction, which is what it was
     * before any of this and what it must still be.
     */
    return (
        feedback.length
            ? `${fallback}  •  ${feedback.join(" · ")}`
            : fallback
    );
}

export function updateInteractionFeedback(
    resolution
) {
    const point =
        resolution.effectiveConstructionPoint;

    /*
     * ONLY A POINT CAN BE REPORTED AS A COORDINATE.
     *
     * Not every tool's construction point is a point. Placing an analysis
     * diagram sets it to the axis SEGMENT - { start, end } - because what
     * is being chosen is a line and what the preview draws is that line.
     * Reading point.x off a segment gives undefined, and Number(undefined)
     * gives NaN, so the readout showed "X: NaN Y: NaN mm" for the whole of
     * the diagram workflow.
     *
     * A segment has no single x and y, so there is nothing truthful to
     * print from one. The axis is placed at the student's chosen height, so
     * the middle of the axis is the point that actually corresponds to
     * what they are doing, and that is what gets reported.
     */
    const readable =
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
            ? point
            : point &&
                point.start &&
                point.end
              ? {
                    x: (point.start.x + point.end.x) / 2,
                    y: (point.start.y + point.end.y) / 2
                }
              : null;

    if (readable) {
        /*
         * THE ORDINATE, IN THE GRAPH'S OWN UNITS.
         *
         * The world coordinates are what the sheet is drawn in, but a
         * student sketching a shear diagram wants to know the VALUE they are
         * at - 10 kN, not the world y of a pixel - and how far along the
         * member they are. When a diagram is under the pointer, that is
         * added rather than replacing the coordinates, because the world
         * reading is still the one every other tool wants.
         *
         * Read only for the diagram that is actually under the pointer: a
         * value borrowed from a diagram somewhere else on the sheet would be
         * a confident number about the wrong graph.
         */
        const hoveredId =
            drawingState.selection.hoveredObjectId;

        const onDiagram =
            hoveredId
                ? drawingState.objects.find(
                      candidate =>
                          candidate.id === hoveredId &&
                          candidate.type ===
                              "analysis-diagram"
                  )
                : null;

        const inDiagram =
            onDiagram &&
            onDiagram.type === "analysis-diagram"
                ? enggDrawingRenderer
                      ?.analysisValueAt?.(
                          onDiagram.geometry,
                          readable
                      )
                : null;

        const quantity =
            {
                sfd: "V",
                bmd: "M",
                afd: "N",
            }[onDiagram?.geometry?.diagramType];

        const unit =
            {
                sfd: "kN",
                bmd: "kN\u00b7m",
                afd: "kN",
            }[onDiagram?.geometry?.diagramType];

        drawingCoordinates.textContent =
            `X: ${Number(readable.x).toFixed(1)} ` +
            `Y: ${Number(readable.y).toFixed(1)} mm` +
            (inDiagram && quantity && unit
                ? `    |    x = ${
                      Number(inDiagram.x).toFixed(
                          1
                      )
                  } mm    ${quantity} = ${
                      Number(inDiagram.y).toFixed(2)
                  } ${unit}`
                : "");
    }

    /*
     * Arc placement phases each have their own
     * instruction, with snap and inference taking
     * priority when they are active.
     */
    if (
        isArcTool()
    ) {
        const instruction = {
            "arc-centre":
                "Specify arc start point",

            "arc-sweep":
                "Specify arc endpoint",

            "arc-first":
                "Specify point on arc",

            "arc-second":
                "Specify third point"
        }[
            drawingState.interaction.phase
        ];

        if (instruction) {
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

            setToolMessage(
                feedback.length
                    ? feedback.join(
                        " · "
                    )
                    : instruction
            );

            return;
        }
    }

    const feedback = [
        inferenceLabel(
            resolution.inference
        ),

        snapTypeLabel(
            resolution.snapCandidate?.type,
            resolution.snapCandidate
        )
    ].filter(Boolean);

    if (
        feedback.length
    ) {
        setToolMessage(
            feedback.join(
                " · "
            )
        );

        return;
    }

    if (
        drawingState.interaction.phase !==
        "idle"
    ) {
        return;
    }

    if (
        drawingState.activeTool ===
        "coordinate-system-2d"
    ) {
        setToolMessage(
            "Specify origin"
        );

        return;
    }

    if (
        drawingState.activeTool ===
        "line"
    ) {
        setToolMessage(
            "Specify line start point"
        );

        return;
    }

    if (
        drawingState.activeTool ===
        "triangle"
    ) {
        setToolMessage(
            "Specify first point"
        );
    }
}

/*
 * Give a held guideline a deadline, and redraw when it lapses.
 *
 * The pointer staying still is the case the pointer-driven
 * clear cannot handle: leave a snap region without moving and
 * the last frame's guide would remain on the drawing
 * indefinitely. So the hold is given a timer that clears it and
 * redraws once, whether or not the pointer ever moves again.
 *
 * The timer is only armed when a guide is actually being held,
 * and is replaced rather than stacked on every pointer event,
 * so an idle cursor costs one pending timeout and nothing else.
 */
export function scheduleGuidelineExpiry(
    guideline
) {
    if (editorState.guidelineHoldTimer) {
        clearTimeout(editorState.guidelineHoldTimer);
        editorState.guidelineHoldTimer = null;
    }

    if (!guideline) {
        return;
    }

    const holdMs =
        enggDrawingSnap
            ?.GUIDELINE_HOLD_MS ??
        260;

    editorState.guidelineHoldTimer =
        setTimeout(
            () => {
                editorState.guidelineHoldTimer = null;

                /*
                 * Only clear if the guide on screen is still
                 * the one that was held. If the pointer moved
                 * and established a different snap in the
                 * meantime, that guide is current and must not
                 * be taken down by this timer.
                 */
                if (
                    !drawingState.interaction
                        ?.guideline
                ) {
                    return;
                }

                drawingState.interaction
                    .guideline = null;

                renderCurrentDrawing();
            },
            holdMs + 40
        );
}

export function updateDrawingCoordinates(
    event
) {
    updateMoveCursor(event);
    /*
     * Always calculate from the current
     * pointer event.
     */
    const resolution =
        resolvePointerEvent(
            event
        );

    /*
     * THE MODIFIER KEYS ARE PART OF THIS FRAME'S RESOLUTION.
     *
     * They are not a property of the POINT - the snap arithmetic is the same
     * whatever is held - but they are what a tool reads to constrain the SHAPE
     * it is building (Shift makes a Rectangle square). Carrying them on the
     * resolution means the preview and the commit read the same frame's state,
     * rather than the preview looking at the event and the commit having
     * nothing to look at.
     */
    resolution.modifiers = {
        shift: Boolean(event?.shiftKey),
        alt: Boolean(event?.altKey),
        ctrl: Boolean(event?.ctrlKey || event?.metaKey)
    };

    enggDrawingState.setInteraction(
        drawingState,
        resolution
    );

    scheduleGuidelineExpiry(
        resolution.guideline
    );

    syncSelectionInteraction();

    updateInteractionFeedback(
        resolution
    );

    /*
     * A running Modify session shows its own ghost
     * preview; otherwise the tool's construction preview
     * is used.
     */
    if (editorState.modifySession) {
        updateModifyPreview(
            resolution
        );

        setToolMessage(
            modifyInstruction(
                editorState.modifySession
            )
        );
    } else {
        updatePreview(
            resolution
        );
    }

    requestRender();
}

/*
 * Instruction text for the current Modify stage.
 */
export function modifyInstruction(
    session
) {
    if (
        session.kind === "mirror" &&
        session.stage === "base"
    ) {
        return "Select the features to mirror first";
    }

    return {
        move:
            session.stage === "base"
                ? "Specify base point"
                : "Specify destination",

        rotate:
            session.stage === "base"
                ? "Specify rotation pivot"
                : "Specify rotation angle",

        mirror:
            session.stage === "axis-end"
                ? "Specify second point"
                : "Select mirror line or point",

        trim:
            "Click the part of the line you want removed",

        extend:
            session.stage === "base"
                ? "Select the boundary to extend to"
                : "Select the geometry to extend"
    }[session.kind] || "Ready";
}
