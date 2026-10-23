/*
 * ========================================================
 * CREATING A FEATURE BY PRESS, HOLD, DRAG AND RELEASE
 * ========================================================
 *
 * A construction tool used to take its points one CLICK at a time:
 *
 *     click first point
 *       -> move
 *       -> click second point
 *       -> committed
 *
 * That is two deliberate presses for one gesture. The student has
 * already said where the feature begins when they press the button, and
 * they have already said where it ends when they let go, so the second
 * press carries no information the release does not.
 *
 * So an applicable tool now takes its two cursor-defined points from
 * ONE press:
 *
 *     mousedown at the first point
 *       -> hold, drag: the preview follows the cursor continuously
 *       -> mouseup: the feature is committed at the released point
 *
 * ---------------------------------------------------------------------------
 * THIS WRAPS THE EXISTING PIPELINE; IT DOES NOT REIMPLEMENT IT
 * ---------------------------------------------------------------------------
 *
 * The whole point of this module is that it adds a LIFETIME and nothing
 * else. Everything that already worked - the snapping, the inference, the
 * live preview, the geometry each tool builds, the size popup, the single
 * undo entry - is reached through exactly the same entry point the click
 * used, `beginOrCompleteGeometry`:
 *
 *     pointerdown  ->  begin    (the phase that waited for a first click)
 *     pointermove  ->  (the existing mousemove already redraws the preview)
 *     pointerup    ->  complete (the phase that waited for a second click)
 *
 * So a Line is still built by the Line factory, a Circle by the Circle
 * factory, and a snapped point is still the resolver's own answer on the
 * frame of the release. No geometry, no data model and no snapping rule
 * is touched here.
 *
 * ---------------------------------------------------------------------------
 * WHICH TOOLS, AND WHY NOT ALL OF THEM
 * ---------------------------------------------------------------------------
 *
 * A tool takes part only when its feature is genuinely defined by the
 * first point and the point under the cursor. That is true of a Line, a
 * Rectangle, a Circle, a Triangle's second corner, the two-point half of
 * a Polygon and an Arc, a Point Force, and every Statics span - a Beam,
 * a Cable, a Shaft, a Connection, a Reference Line.
 *
 * It is NOT true of the tools that take a FLOW of points - a polyline,
 * a truss, a varying load - where each point is a separate decision and
 * a release has no single meaning. Those keep their click workflow.
 *
 * Nor is it true of the single-click placement tools - a support, a
 * moment, a point, a coordinate system - which have no second point to
 * take from a release at all.
 *
 * ---------------------------------------------------------------------------
 * THE TRAILING CLICK IS SWALLOWED
 * ---------------------------------------------------------------------------
 *
 * A pointer interaction in a browser also fires a `click` on release.
 * Left alone it would arrive at `handleCanvasClick` and be read as a
 * second point - starting a fresh construction at the released position,
 * which is the "click, move, click" behaviour this replaces, still
 * running underneath the drag. So a drag that began and ended on the
 * canvas marks the click as consumed, and the click handler honours that
 * mark exactly once.
 */
import { isAnnotationTool } from "../annotate/annotation-tool.js";
import { beginAnnotateDragAnchor, completeAnnotateAt, isGeometricAnnotateTool } from "../annotate/annotate-creation.js";
import { isDimensionTool } from "../annotate/dimension-tool.js";
import { drawingState, editorState } from "../editor-state.js";
import { beginOrCompleteGeometry } from "../geometry/geometry-creation.js";
import { activateTool, canvasPointFromEvent } from "../../../components/layout/toolbar/tool-activation.js";
import { renderCurrentDrawing } from "../../../components/layout/workspace/canvas-render.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { renderFeatures } from "../../../components/layout/panels/features-pane.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import enggPipeDuct from "../model/fluids/pipe-duct.js";
import { objectAtPoint, hitTestAnnotateTarget } from "./hit-testing.js";
import { isClickClickTool, isMultiStepTool } from "../../../components/layout/toolbar/tool-classification.js";
import {
    ROUTE_PHASE,
    commitRouteSegment,
    resolveRouteStart
} from "./pipe-duct-tool.js";
import { resolvePointerEvent } from "./pointer.js";
import { STATICS_PLACEMENT_TOOLS, STATICS_SPAN_TOOLS } from "../statics/statics-tools.js";
import {
    DYNAMICS_PLACEMENT_TOOLS,
    DYNAMICS_SPAN_TOOLS,
    DYNAMICS_ANGLE_TOOLS,
    DYNAMICS_BOX_TOOLS
} from "../dynamics/dynamics-tools.js";
import { isLegacyResetTool } from "../../../components/layout/toolbar/phase-reset.js";

/*
 * The Geometry tools whose feature is a start point and an end point.
 *
 * A Triangle and a Polygon take one more point after this one, so the
 * drag supplies their FIRST span and the tool's own remaining steps
 * carry the rest - the multi-point workflow is preserved, one gesture at
 * a time.
 *
 * THE REFERENCE ARC IS THE ARC TOOL BY ANOTHER NAME.
 *
 * It draws through the same phases - centre, sweep, or three points on the
 * curve - and every one of them is a point under the cursor. It was missing
 * here because it is a separate tool ID, so a student who dragged a
 * reference arc got no preview and no completion: the release had nothing to
 * finish, because this list said the tool was not a drag tool at all.
 *
 * The pair are listed ADJACENT, so the arc and its reference twin are read
 * together and can never drift apart.
 */
const DRAG_GEOMETRY_TOOLS = [
    "line",
    "rectangle",
    "control-volume",
    "tank",
    "turbine-compressor",
    "saturation-curve",
    "process-plot",
    "piston-cylinder",
    "piston-cylinder-stoppers",
    "circle",
    "triangle",
    "polygon",

    /*
     * The Freeform Polygon is NOT here, although it reads like a drag tool.
     * It is listed in PROGRESSIVE_TOOLS above, where the reason is written
     * out; keeping it here as well would leave two lists disagreeing about
     * the same tool, and the disagreement is exactly what broke it.
     */
    "arc",
    "reference-arc",

    /*
     * THE COORDINATE SYSTEM IS A DRAG, NOT A CLICK.
     *
     * Its press is the origin and its release is the positive X direction,
     * which is exactly the two points one gesture supplies. It used to be a
     * single-click placement with a fixed axis length, so the student could
     * put an origin down and had no way to say which way the axes ran.
     */
    "coordinate-system-2d"
];

/*
 * Tools that take a FLOW of points rather than one start and one end.
 *
 * Named explicitly, so "this tool is not a drag tool" is a statement
 * somebody made rather than something a future reader has to infer from
 * a list of exceptions.
 */
const PROGRESSIVE_TOOLS = [
    "polyline",
    "truss",

    /*
     * THE FREEFORM POLYGON IS A FLOW TOOL TOO.
     *
     * It reads as a drag tool - it is a shape, and the gesture that finishes
     * it is a drag back onto the first vertex - but every vertex is a
     * separate decision and the student may sit on a vertex for as long as
     * they like before choosing the next one. Treating the press as the start
     * of a drag session took the click workflow away from it: the press armed
     * a session whose release tried to finish a span, so vertices stopped
     * being placed and the polygon could not be built at all.
     *
     * The closing gesture is a press ON the first vertex, which the geometry
     * creation layer recognises as a close - see `freeform-polygon` in
     * geometry-creation.js. That decision needs the press, not a release.
     */
    "freeform-polygon"
];
/*
 * Tools whose input is a single point, but where holding and dragging should
 * place the feature at the RELEASED point.
 */
const SINGLE_POINT_DRAG_TOOLS = [
    "point"
];


/*
 * The distributed-load tools, whose SPAN is a start and an end like a Line's.
 *
 * Their construction continues past the span - a constant load is then sized
 * by one cursor vector, a varying load by a sequence of profile points - so
 * only the SPAN step is a drag. The rest keeps its own interaction, which is
 * why these tools are handled by name rather than by a blanket rule.
 */
const LOAD_SPAN_TOOLS = [
    "distributed-load",
    "varying-distributed-load"
];

/*
 * The phases a RELEASE completes.
 *
 * These are the phases that already hold an anchor and are waiting for the
 * point under the cursor - which is exactly what the release supplies. A
 * phase that is not here is not a span waiting for a point: a Polygon waiting
 * for its side count is waiting for a typed answer, and a load's VECTOR and
 * BUILD steps walk through their own construction.
 */
const DRAG_CONTINUE_PHASES = [
    "first-point",
    "statics-span",
    "polygon-centre",
    "polygon-first",

    /*
     * The arc's phases, one per point it is still waiting for.
     *
     * A centrepoint arc takes centre, start, end; a three-point arc takes
     * three points on the curve. Each of those steps is a point under the
     * cursor, so each is finished by a release - and every one of them is
     * listed, because a phase left off this list would strand the arc
     * half-built after the student let go of it.
     */
    "arc-centre",
    "arc-sweep",
    "arc-first",
    "arc-second",

    /*
     * A LOAD'S SPAN, once it holds its first end.
     *
     * `distributed-load-span` is a span traced in empty space, where the
     * press set the start; `distributed-load-end` is the same on a body, one
     * gesture later. In both, the release supplies the second end.
     */
    "distributed-load-span",
    "distributed-load-end",

    /*
     * A DYNAMICS SPAN OR ANGLE, once it holds its first point.
     *
     * A spring, a damper, a vector, a trajectory or a pulley anchors on the
     * press and takes its far end - or, for an angle tool, its radius - from
     * the release, exactly as a Line does. A phase left off this list would
     * strand the symbol half-built after the student let go, so both are
     * listed beside the phases they mirror.
     */
    "dynamics-span",
    "dynamics-angle"
];

/*
 * The phases a PRESS supplies a point to.
 *
 * A load dropped on a body first answers "which body?" (one gesture), then
 * waits in `distributed-load-start` for the loaded region's first end. There
 * is no anchor yet, so the press IS that end - the same role the first of the
 * old two clicks played - and the release supplies the second.
 */
const DRAG_PRESS_POINT_PHASES = [
    "distributed-load-start"
];

/*
 * Whether the active tool creates its feature by press-drag-release.
 *
 * Asked of the TOOL, and only of the tool. Whether the current press is
 * one of these tools' creations is then decided from the interaction
 * state, so a press that lands on an existing feature with such a tool
 * armed still belongs to the ordinary selection path.
 */
export function isDragCreationTool(
    toolId
) {
    /*
     * PHASE 1 RESET: no legacy tool is a drag-creation tool any
     * more. Press-drag-release creates nothing; presses fall
     * through to the ordinary selection path.
     */
    if (isLegacyResetTool(toolId)) {
        return false;
    }

    if (!toolId) {
        return false;
    }

    /*
     * A geometric ANNOTATE tool - a leader, a callout, an arrow - IS a
     * start and an end, so it takes both workflows just like a Line does.
     * Its press begins its anchor and its release commits it, through the
     * creation layer's own functions (see below), not through the geometry
     * construction pipeline - because an annotation is not geometry.
     */
    if (isGeometricAnnotateTool(toolId)) {
        return true;
    }

    /*
     * A dimension, an annotation and an analysis diagram are not
     * two-point shapes: they collect references or name a body. They go
     * through the construction pipeline for its SNAPPING, which is why
     * they are construction tools at all, but their completion is their
     * own affair and a drag would take it away from them.
     */
    if (
        isDimensionTool(toolId) ||
        isAnnotationTool(toolId) ||
        toolId === "analysis"
    ) {
        return false;
    }

    /*
     * PIPE / DUCT IS THE DRAG TOOL ABOVE ALL OTHERS.
     *
     * A run of pipework is defined ENTIRELY by where the student pressed and
     * where they let go, so it is the clearest case of a drag creation there
     * is. It is named here, ahead of the geometry pipeline, because it does not
     * use the generic phase machine at all - it has its own session below - but
     * the answer to "is this a drag tool" must still be yes.
     */
    if (toolId === "pipe-duct") {
        return true;
    }

    /*
     * The progressive tools keep their own click-driven construction.
     */
    if (PROGRESSIVE_TOOLS.includes(toolId)) {
        return false;
    }

    /*
     * BOTH DISTRIBUTED LOADS TAKE THEIR SPAN FROM A DRAG.
     *
     * The span is a start and an end, exactly as a Line's is, so it is one
     * gesture. Their later steps - the magnitude/direction vector, the profile
     * points - are their own and are left alone by this module.
     */
    if (LOAD_SPAN_TOOLS.includes(toolId)) {
        return true;
    }

    if (SINGLE_POINT_DRAG_TOOLS.includes(toolId)) {
        return true;
    }

    /*
     * A DYNAMICS TOOL CREATES THROUGH THE SAME GESTURE IT DECLARES.
     *
     * Every Dynamics tool is a press-drag-release creation - a placement tool
     * places on the press, a span takes its two terminals from the gesture, a
     * box or an angle tool takes its second point from the release. Without
     * this branch the press fell through to the selection path and no creation
     * session was armed, so every Dynamics tool armed, previewed nothing and
     * created nothing - the tool LOOKED dead even though its model, renderer
     * and writer were all in place. Asked of the tool tables rather than of a
     * second hand-written list, so a tool added to the library is covered here
     * without another edit.
     */
    if (
        DYNAMICS_PLACEMENT_TOOLS[toolId] ||
        DYNAMICS_SPAN_TOOLS[toolId] ||
        DYNAMICS_ANGLE_TOOLS[toolId] ||
        DYNAMICS_BOX_TOOLS[toolId]
    ) {
        return true;
    }

    /*
     * A single-click placement tool has no second point to take from a
     * release: a support, a particle or a reference point is placed where
     * the press landed. A Moment is NOT in this table (it is placed in
     * free space by a click), so it is excluded by name below.
     */
    if (
        STATICS_PLACEMENT_TOOLS[toolId] ||
        toolId === "moment"
    ) {
        return false;
    }

    /*
     * A Statics span - a Beam, a Cable, a Shaft, a Connection, a
     * Reference Line, a Point Force - IS a two-point creation, so it
     * takes part. Asked of the span table because that table is the
     * authoritative statement of which Statics tools span two points.
     */
    if (STATICS_SPAN_TOOLS[toolId]) {
        return true;
    }

    return DRAG_GEOMETRY_TOOLS.includes(toolId);
}

/*
 * Whether a press at this point would SELECT something rather than
 * begin a new feature.
 *
 * The same rule the click pipeline applies, asked the same way: with a
 * creation tool armed, a press on an existing feature selects it. It is
 * answered from the RAW pointer position, before any snapping has pulled
 * the cursor to a nearby feature that the student did not aim at.
 */
function pressSelectsExistingObject(
    event
) {
    const raw =
        canvasPointFromEvent(
            event,
            false
        );

    if (!raw) {
        return false;
    }

    return Boolean(
        objectAtPoint(raw)
    );
}

/*
 * Begin (or continue) a creation from a press.
 *
 * Returns true when the press belongs to the drag workflow, so the caller
 * leaves it alone and lets the pointerup commit the next point.
 *
 * THREE CASES, decided by the phase the press arrives in:
 *
 *   IDLE: the press STARTS the feature. The press is the first point, so
 *   the existing construction entry point is called here, exactly as the
 *   first click used to be.
 *
 *   A "CONTINUE" PHASE: the construction already holds its anchor - a
 *   Triangle's first corner, an Arc's centre, a load's span start - and is
 *   waiting for the point under the cursor. Nothing is called on the press:
 *   the release supplies that point, and the fixed anchor is left exactly
 *   where the earlier gesture put it.
 *
 *   A "PRESS TAKES A POINT" PHASE: the tool is waiting for the FIRST end of
 *   a span that only a body selection preceded (`distributed-load-start`).
 *   There is no anchor yet, so the press itself is that end - the entry point
 *   is called here, exactly as the first of the two clicks used to be.
 */
export function beginCreationDrag(
    event
) {
    if (
        editorState.creationDrag ||
        !isDragCreationTool(
            drawingState.activeTool
        )
    ) {
        return false;
    }

    const phase =
        drawingState.interaction.phase;

    const idle =
        phase === "idle";

    const continues =
        DRAG_CONTINUE_PHASES.includes(phase);

    const takesPoint =
        DRAG_PRESS_POINT_PHASES.includes(phase);

    /*
     * A GEOMETRIC ANNOTATE TOOL ARMS ITS ANCHOR AND LETS THE RELEASE COMMIT IT.
     *
     * A leader, a callout and an arrow are the annotation world's two-point
     * constructs. They do not use `phase` or the geometry construction
     * pipeline at all - they are marks, not geometry - so they are handled
     * HERE, ahead of the phase logic below, and the WORK is handed to the
     * creation layer so there is exactly one implementation of "place a
     * leader", shared with the click-move-click path.
     *
     * The press does not build anything yet for the same reason the geometry
     * tools do not: a plain click must fall through to the click handler,
     * which is the FIRST click of click-move-click. Only once the pointer has
     * travelled (see moveCreationDrag) is the anchor actually begun.
     */
    if (isGeometricAnnotateTool(drawingState.activeTool)) {
        /*
         * On a CONTINUE - the anchor is already held, so this press is the
         * second end and the release will commit it. Nothing to start here.
         */
        const annotateArmed =
            drawingState.interaction.annotateStage === "anchor";

        /*
         * A press on an existing feature is NOT refused here either - it is
         * NOTED, so a drag from existing geometry can still begin the leader
         * while a plain click still falls through to selection. This is the
         * same deferral the geometry tools use below, for the same reason: a
         * leader that attaches to a feature must be startable by pressing on
         * that feature.
         */
        const annotateOnExisting =
            !annotateArmed &&
            pressSelectsExistingObject(event);

        editorState.creationDrag = {
            pointerId: event.pointerId,
            annotateTool: drawingState.activeTool,
            annotateArmed,
            pressResolution: annotateArmed
                ? null
                : resolvePointerEvent(event),
                startScreen: {
                    x: event.clientX,
                    y: event.clientY
                },

                moved: false,

                /*
                 * WHERE THE PRESS LANDED, IN MODEL COORDINATES.
                 *
                 * A click that never travels asks ONE question on release: was there
                 * something under the pointer? That is answered against the raw model
                 * position the press had - not a snapped one, which could have pulled
                 * the answer onto a feature the student did not aim at. See
                 * finishCreationClick.
                 */
                pressPoint: annotateArmed
                    ? null
                    : resolvePointerEvent(event).rawPointerPoint,

                onExisting: annotateOnExisting
            };

        return true;
    }

    /*
     * ========================================================
     * PIPE / DUCT TAKES ITS WHOLE RUN FROM THE ONE GESTURE
     * ========================================================
     *
     * A run has its own tiny session rather than the geometry phase machine,
     * for one reason: the phase machine is built around a construction that
     * stays ALIVE across clicks, and a run does not - it begins at the press
     * and ends at the release, and each leg is committed the moment it is let
     * go. Holding it in `phase` would mean a half-drawn run existed between
     * gestures, which is exactly the "no ghost geometry" state the task
     * forbids.
     *
     * The press records the RESOLVED start point (already snapped) and the
     * previous run, if the press landed on its far endpoint. Nothing is
     * written to the document yet - only when the release commits it.
     */
    if (drawingState.activeTool === "pipe-duct") {
        if (event.button !== 0) {
            return false;
        }

        const resolution = resolvePointerEvent(event);

        const pressPoint =
            resolution.effectiveConstructionPoint ||
            resolution.rawPointerPoint;

        const { start, previous } = resolveRouteStart(pressPoint);

        editorState.creationDrag = {
            pointerId: event.pointerId,
            pipeDuct: true,
            start,
            previousRun: previous,
            startScreen: {
                x: event.clientX,
                y: event.clientY
            },
            moved: false,
            pressPoint: pressPoint
                ? {
                      x: pressPoint.x,
                      y: pressPoint.y
                  }
                : null,
            committedCount:
                Number(drawingState.interaction.routeCommittedCount) || 0
        };

        return true;
    }

    /*
     * A press that is neither the start of a feature nor the next point of
     * one belongs to whatever else is running - a load being built, a
     * truss, a dimension - and is left to that.
     */
    if (
        !idle &&
        !continues &&
        !takesPoint
    ) {
        return false;
    }
    if (SINGLE_POINT_DRAG_TOOLS.includes(drawingState.activeTool)) {
        const onExisting =
            idle && pressSelectsExistingObject(event);

        editorState.creationDrag = {
            pointerId: event.pointerId,
            startScreen: {
                x: event.clientX,
                y: event.clientY
            },
            moved: false,
            onExisting,
            pressPoint: (() => {
                const raw = resolvePointerEvent(event).rawPointerPoint;

                return raw
                    ? { x: raw.x, y: raw.y }
                    : null;
            })(),
            singlePointTool: drawingState.activeTool,
            pressResolution: null
        };

        return true;
    }

    /*
     * A DYNAMICS PLACEMENT TOOL PLACES ON THE CLICK, NOT ON A DRAG.
     *
     * A Particle or a Reference Point is finished by one click; the release
     * below supplies that click through `singlePointTool`, exactly as the
     * shared Point tool does. Named here rather than added to that list so
     * the Dynamics library keeps one source of its own tool kinds.
     */
    if (DYNAMICS_PLACEMENT_TOOLS[drawingState.activeTool]) {
        const onExisting =
            idle && pressSelectsExistingObject(event);

        editorState.creationDrag = {
            pointerId: event.pointerId,
            startScreen: {
                x: event.clientX,
                y: event.clientY
            },
            moved: false,
            onExisting,
            pressPoint: (() => {
                const raw = resolvePointerEvent(event).rawPointerPoint;

                return raw
                    ? { x: raw.x, y: raw.y }
                    : null;
            })(),
            singlePointTool: drawingState.activeTool,
            pressResolution: null
        };

        return true;
    }

    /*
     * ========================================================
     * A PRESS ON AN EXISTING FEATURE IS NOT DECIDED YET
     * ========================================================
     *
     * It used to be refused here, so that a press on a beam selected the beam
     * rather than starting something through it. That is right for a CLICK and
     * wrong for a DRAG: a student drawing a new Line that begins at a beam's
     * endpoint is pressing ON the beam, and refusing the press meant the drag
     * was never armed - the feature did not start from the mouse-down point,
     * and only appeared (based on the release) once the cursor had left the
     * geometry. Starting a run of members from a joint is exactly the case that
     * broke.
     *
     * So the press is ARMED either way and the decision is deferred to the
     * gesture, which is the only thing that can actually tell them apart:
     *
     *     press on existing, no travel -> a CLICK; the browser's own click
     *                                     selects the feature (see
     *                                     pressSelectsExistingObject below)
     *     press on existing, travel    -> a DRAG; the active tool owns it and
     *                                     starts at the mouse-down/snapped point
     *
     * `onExisting` records which case this is so the release can do the right
     * thing - commit a creation for a drag, or leave the click to selection.
     */
    const onExisting =
        idle && pressSelectsExistingObject(event);

    /*
     * ========================================================
     * THE PRESS IS ARMED, BUT THE CONSTRUCTION IS NOT STARTED
     * ========================================================
     *     * Starting the feature on the press LOOKED right and was the source of the
     * worst defect in this module. A browser fires a `click` on a plain press
     * and release, so the sequence for one click was:
     *
     *     pointerdown   beginOrCompleteGeometry  -> the first point
     *     pointerup     (no travel, left waiting)
     *     click         beginOrCompleteGeometry  -> the SAME point again
     *
     * and the second call completed the feature AT ITS OWN START POINT - a
     * zero-length line that opened its size popup before the student had moved.
     * Click-move-click was impossible: every first click created something.
     *
     * So the press no longer builds anything by itself. It ARMS this session,
     * keeping the resolved point the press would have used, and the
     * construction is started only when the pointer has actually travelled far
     * enough to be a DRAG (see moveCreationDrag). A press that never travels is
     * left completely alone, and the browser's own `click` starts the feature
     * through the ordinary click pipeline - which is exactly the first click of
     * click-move-click.
     *
     * A "CONTINUE" PHASE is different and unchanged: the construction already
     * holds its anchor, so the release supplies the next point. Nothing needs
     * deferring because nothing was started here in the first place.
     */
    const startsHere =
        idle || takesPoint;

    editorState.creationDrag = {
        pointerId: event.pointerId,

        /*
         * THE POINT THE PRESS WOULD START FROM, RESOLVED AGAINST THE MODEL.
         *
         * Held here rather than applied, so the construction is begun with the
         * geometry of the press itself - through the same resolver a click uses
         * - and never with a coordinate re-read from a later move, which could
         * have snapped to something else.
         */
        pressResolution: startsHere
            ? resolvePointerEvent(event)
            : null,

        /*
         * WHERE THE PRESS LANDED, IN SCREEN PIXELS.
         *
         * The gesture is classified on RELEASE, by how far the pointer
         * actually travelled - see finishCreationDrag. Screen pixels are the
         * right measure for that and only for that: whether a hand moved is a
         * fact about the pointer, while the feature being built is measured in
         * world coordinates and always has been.
         */
        startScreen: {
            x: event.clientX,
            y: event.clientY
        },

        moved: false,

        /*
         * THE RAW PRESS POSITION, for a click that never travels. See
         * finishCreationClick.
         */
        pressPoint: startsHere
            ? (resolvePointerEvent(event).rawPointerPoint || null)
            : null,

        /*
         * THE PRESS LANDED ON AN EXISTING FEATURE. It is not a decision, only
         * a note: the drag path uses it so a press that never travels is left
         * to the click pipeline (which selects that feature), while a press
         * that travels lets the tool start from the same point.
         */
        onExisting
    };

    return true;
}

/*
 * How far the pointer must travel before a press is a DRAG rather than a click.
 *
 * A few pixels: enough that hand tremor, a touch tap that slides slightly, or a
 * trackpad's small drift are all still CLICKS, and far less than the distance
 * anyone moves a cursor while deliberately drawing something. Getting this wrong
 * in the small direction turns a click into an accidental zero-length feature;
 * getting it wrong in the large direction makes a short drag need a second
 * click.
 */
export const DRAG_THRESHOLD_PX = 4;

/*
 * ========================================================
 * A BARE CLICK WITH A DRAG TOOL LEAVES THE TOOL
 * ========================================================
 *
 * The ONE rule every creation tool shares:
 *
 *     press, drag, release on empty canvas   -> create the feature
 *     press, release without travel          -> back to Select, create nothing
 *     press on an existing feature, no drag  -> back to Select, select it
 *
 * A drag tool's gesture is already classified on release (see
 * finishCreationDrag); what was missing was the second half. A bare click used
 * to fall through to `handleCanvasClick`, which for a two-point tool read it as
 * the FIRST POINT of click-move-click - so the tool stayed armed and a second
 * click (or no click at all) was needed to get out of it.
 *
 * The decision belongs here, beside the threshold and the session that knows
 * how far the pointer travelled, rather than in the click router: the tool, the
 * gesture and the thing under the pointer are all facts this module already
 * owns, and the router can stay a list of tool-specific rules.
 *
 * WHAT IS DELIBERATELY NOT INCLUDED
 * ---------------------------------
 *   - a press that TRAVELLED is a drag. It is never read as a click, however
 *     briefly the pointer pauses before the release.
 *   - a tool with an EXPLICIT REQUIRED INPUT (a dimension collecting
 *     references, a Label or a Leader attaching to a feature, a Resultant
 *     being told which force) is not a drag tool at all, so it never reaches
 *     here - see `isDragCreationTool`.
 *   - a construction that is PART-WAY through its own steps (a Triangle after
 *     its first corner, an Arc after its centre, a load after its span) is not
 *     abandoned: those steps are real decisions, and Escape is the established
 *     way to give them up.
 */
export function finishCreationClick(session) {
    /*
     * The caller has read the session out of `editorState` and cleared it.
     * Without one there was no press with a creation tool, so there is nothing
     * to reinterpret.
     */
    if (
        !session ||
        session.moved ||
        session.pipeDuct ||
        session.singlePointTool
    ) {
        return false;
    }

    /*
     * THE DECISION IS ONLY FOR A TOOL THAT DRAWS WITH A GESTURE. A tool that
     * places a point, or that is mid-way through several points, keeps the
     * click it was given.
     */
    if (
        !isDragCreationTool(
            drawingState.activeTool
        )
    ) {
        return false;
    }

    if (
        isClickClickTool(
            drawingState.activeTool
        )
    ) {
        return false;
    }

    if (
        isMultiStepTool(
            drawingState.activeTool
        ) &&
        drawingState.interaction.phase !==
            "idle"
    ) {
        return false;
    }

    /*
     * A CLICK, NOT A DRAG: the canvas goes back to Select. The point under the
     * pointer is chosen against the RAW position through the shared hit test, so
     * a click on a feature selects it and a click on nothing clears the
     * selection - exactly what the same click would do with Select active.
     */
    const hit =
        session.pressPoint
            ? objectAtPoint(
                  session.pressPoint
              )
            : null;

    activateTool("select");

    enggDrawingState.selectObject(
        drawingState,
        hit ? hit.id : null
    );

    renderProperties();
    renderFeatures();
    renderCurrentDrawing();

    return true;
}

/*
 * Track how far the pointer has travelled during a creation press - and, the
 * moment it has travelled far enough to be a DRAG, actually start the feature.
 *
 * THIS IS WHERE THE DEFERRED START HAPPENS. beginCreationDrag deliberately does
 * not build anything on the press; it arms this session and keeps the press's
 * own resolved point. The first movement past the threshold is what turns the
 * armed press into a running construction:
 *
 *     pointerdown            arm, no construction
 *     pointermove (>= 4px)   beginOrCompleteGeometry(press point)  -> first point
 *     pointerup              beginOrCompleteGeometry(release point)-> commit
 *
 * The construction is begun with the PRESS'S point, not this move's - the
 * member must start exactly where the student pressed, however far the cursor
 * has already travelled by the time the threshold is crossed.
 */
export function moveCreationDrag(event) {
    const session = editorState.creationDrag;

    if (!session) {
        return;
    }

    /*
     * ========================================================
     * PIPE / DUCT KEEPS ITS LIVE PREVIEW ON THE INTERACTION
     * ========================================================
     *
     * The shared preview reads the interaction (see preview.js), so the run
     * being dragged is published there every frame - the start, the resolved
     * cursor and the cross-section. The preview is then generated by the SAME
     * function the committed feature uses, so the two boundary lines cannot
     * move when the button is released.
     *
     * THE SNAP GEOMETRY IS PUBLISHED TOO. The moving end snaps to the start, to
     * a run already placed or to a corner - through exactly the candidates, the
     * tolerance and the indicators every other construction publishes. It is
     * the run's CENTRELINE that is published, never its two walls.
     *
     * ========================================================
     * AND IT RECORDS THAT THE GESTURE IS A DRAG, NOT A CLICK
     * ========================================================
     *
     * THIS IS THE ONE THING THIS BRANCH MUST NOT FORGET. The release decides
     * whether to commit a run or to do nothing from `session.moved`, and the
     * generic path below is the only place that set it - so a pipe-duct press
     * that travelled never became a drag. The release then took the "click"
     * branch: it CLEARED the interaction, which is what made the live preview
     * vanish, and returned before `commitRouteSegment` - so the run was never
     * created. The student saw a preview while dragging and nothing at all on
     * release, which is exactly the reported defect.
     *
     * So the SAME threshold the rest of this module uses classifies the
     * gesture here too: once the pointer has travelled far enough to be a
     * drag, the run is armed for commitment. A press that never travels stays
     * a click and still commits nothing - the honest outcome for a tool that
     * was not given a length.
     */
    if (session.pipeDuct) {
        if (!session.moved) {
            const dx = event.clientX - session.startScreen.x;
            const dy = event.clientY - session.startScreen.y;

            session.moved = Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
        }

        const resolution = resolvePointerEvent(event);

        const point =
            resolution.effectiveConstructionPoint ||
            resolution.rawPointerPoint ||
            session.start;

        const routeEngineering =
            drawingState.interaction.routeEngineering ||
            enggPipeDuct.defaultPipeEngineering();

        enggDrawingState.setInteraction(drawingState, {
            fluidsTool: "pipe-duct",
            phase: ROUTE_PHASE,
            startPoint: session.start,
            routeSegmentStart: session.start,
            routeEngineering,
            previousRun: session.previousRun,
            routeCommittedCount: session.committedCount || 0,
            snapGeometry: [
                {
                    start: session.start,
                    end: point
                }
            ],
            snapToolId: "pipe-duct"
        });

        session.currentPoint = point;

        return;
    }

    if (!session.moved) {
        const dx = event.clientX - session.startScreen.x;
        const dy = event.clientY - session.startScreen.y;

        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
            return;
        }

        session.moved = true;

        if (session.singlePointTool) {
            return;
        }

        /*
         * A GEOMETRIC ANNOTATE TOOL BEGINS ITS ANCHOR HERE.
         *
         * The press armed the session; the first real movement is what
         * commits to a drag, so the anchor is begun now - from the PRESS's
         * point, through the creation layer's own function, so a dragged
         * leader and a two-clicked leader share one implementation.
         */
        if (
            session.annotateTool &&
            !session.annotateArmed &&
            session.pressResolution
        ) {
            const resolution = session.pressResolution;

            const target = hitTestAnnotateTarget(
                resolution.effectiveConstructionPoint ||
                    resolution.rawPointerPoint
            );

            beginAnnotateDragAnchor(
                resolution.effectiveConstructionPoint ||
                    resolution.rawPointerPoint,
                target ? target.id : null
            );

            session.pressResolution = null;

            return;
        }

        /*
         * START THE FEATURE NOW. A press that is really a drag has been
         * recognised, so the deferred first point is applied through the same
         * construction entry point a click would use - and the live preview
         * follows from here on, exactly as it does for click-move-click.
         */
        if (session.pressResolution) {
            beginOrCompleteGeometry(
                session.pressResolution
            );

            session.pressResolution = null;

            /*
             * If nothing started - the tool routed itself elsewhere, or the
             * point could not be resolved - the release has nothing to finish,
             * so the session is dropped and the release is left to whatever else
             * is running.
             */
            if (
                !DRAG_CONTINUE_PHASES.includes(
                    drawingState.interaction.phase
                )
            ) {
                editorState.creationDrag = null;
            }
        }
    }
}

/*
 * Complete a creation on release.
 *
 * TWO GESTURES ARRIVE HERE, AND THEY ARE NOT THE SAME THING.
 *
 *   THE POINTER MOVED   the student pressed, dragged, and let go - one
 *                       gesture that says both ends, so the feature is
 *                       committed at the released point.
 *
 *   THE POINTER DID NOT  the student simply CLICKED. For a tool that draws
 *                       with a gesture that is not a creation at all: it
 *                       returns to Select, selecting whatever was under the
 *                       press - see finishCreationClick.
 *
 * WITHOUT THE DISTINCTION the two workflows cannot both exist. The press
 * started the feature and armed this session, so a plain click was completed on
 * release at its own start point - a zero-length line, committed, before the
 * student had even moved. Click-move-click was therefore impossible: every first
 * click created something.
 *
 * The final cursor position is the second point, resolved through the
 * same snapping pipeline a click would have used - so a snap to an
 * endpoint is committed exactly as it was previewed.
 *
 * Returns true when this release owned the gesture, so the trailing
 * click is swallowed rather than read as a new first point. A CLICK with a
 * tool that keeps its click workflow is NOT swallowed: it is that tool's own
 * next step, and the browser's click for it must reach the click router
 * untouched.
 */
export function finishCreationDrag(
    event
) {
    const session =
        editorState.creationDrag;

    if (!session) {
        return false;
    }

    /*
     * A CLICK WITH A DRAG TOOL LEAVES THE TOOL.
     *
     * Read BEFORE the session is dropped, because the decision is made from the
     * gesture the session recorded. The event's trailing click is CONSUMED - it
     * has been answered here, and must not also be read as a first point or as a
     * fresh selection - so true is returned and the caller sets the consumed
     * flag.
     */
    if (
        !session.moved &&
        finishCreationClick(session)
    ) {
        return true;
    }

    editorState.creationDrag = null;

    /*
     * A CLICK, NOT A DRAG.
     *
     * The construction is left exactly as the press left it - holding its
     * first point and waiting for the next one - and the trailing click is
     * NOT consumed, because that click IS the second point of the
     * click-move-click workflow.
     *
     * FOR A PIPE / DUCT THE CLICK IS SIMPLY NOTHING. A run is defined by a
     * drag, so a press-and-release that never travelled draws no run at all:
     * the interaction is dropped here and the browser's click falls through to
     * the ordinary selection path, which is the honest outcome for a tool that
     * was not given a length.
     */
    if (session.pipeDuct && !session.moved) {
        enggDrawingState.setInteraction(drawingState, {
            preview: null,
            phase: "idle"
        });
        renderCurrentDrawing();
    }

    if (!session.moved) {
        return false;
    }

    /*
     * ========================================================
     * PIPE / DUCT COMMITS ITS RUN AT THE RELEASE
     * ========================================================
     *
     * The release is the run's far end. The leg is committed as a real
     * Pipe / Duct feature, an Elbow is generated at the corner when this leg
     * continues a previous run through a supported 45 or 90, and the whole
     * thing is one undoable operation (see pipe-duct-tool.js).
     *
     * The tool STAYS ARMED and keeps the run's far endpoint as the next leg's
     * start, so dragging on from there carries the path - which is the
     * continuous drawing the task asks for, expressed as an operation sequence
     * rather than a container.
     */
    if (session.pipeDuct) {
        const resolution = resolvePointerEvent(event);

        const end =
            resolution.effectiveConstructionPoint ||
            resolution.rawPointerPoint ||
            session.currentPoint;

        const path = commitRouteSegment(
            session.start,
            end,
            {
                previousRun: session.previousRun,
                routeEngineering:
                    drawingState.interaction.routeEngineering,
                routeCommittedCount: session.committedCount || 0
            }
        );

        if (!path) {
            enggDrawingState.setInteraction(drawingState, {
                preview: null,
                phase: "idle",
                snapGeometry: []
            });
            renderCurrentDrawing();
        }

        return true;
    }

    /*
     * A GEOMETRIC ANNOTATE TOOL COMMITS AT THE RELEASE.
     *
     * The anchor was begun when the drag was recognised (moveCreationDrag);
     * the release supplies the second end and the creation layer commits the
     * mark - through the SAME function the second click reaches, so the two
     * workflows cannot produce different features.
     */
    if (session.annotateTool) {
        const resolution = resolvePointerEvent(event);
        const point =
            resolution.effectiveConstructionPoint ||
            resolution.rawPointerPoint;

        if (point) {
            completeAnnotateAt(point);
        }

        return true;
    }

    if (session.singlePointTool) {
        beginOrCompleteGeometry(
            resolvePointerEvent(event)
        );

        return true;
    }

    if (
        DRAG_CONTINUE_PHASES.includes(
            drawingState.interaction.phase
        )
    ) {
        beginOrCompleteGeometry(
            resolvePointerEvent(event)
        );
    }

    /*
     * The release ends the gesture whether or not the phase was still
     * completable - it may have been cancelled mid-drag - so the click is
     * consumed either way.
     */
    return true;
}
