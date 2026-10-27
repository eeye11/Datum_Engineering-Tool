/*
 * Which tools construct geometry, and when a click selects an existing feature instead.
 */

import { isDimensionTool } from "../../../features/workspace/annotate/dimension-tool.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { objectAtPoint } from "../../../features/workspace/interaction/hit-testing.js";
import { isVaryingLoadTool } from "../../../features/workspace/statics/load-tool.js";
import { STATICS_BODY_ATTACHED_TOOLS, STATICS_PLACEMENT_TOOLS, STATICS_SPAN_TOOLS } from "../../../features/workspace/statics/statics-tools.js";
import {
    DYNAMICS_PLACEMENT_TOOLS,
    DYNAMICS_SPAN_TOOLS,
    DYNAMICS_ANGLE_TOOLS,
    DYNAMICS_BOX_TOOLS
} from "../../../features/workspace/dynamics/dynamics-tools.js";
import { canvasPointFromEvent } from "./tool-activation.js";

export function isConstructionTool(
    toolId
) {
    /*
     * Statics placement and span tools are listed here too,
     * so they run through the same construction pipeline
     * as geometry and pick up snapping and inference.
     */
    /*
             * A DIMENSION TOOL IS NOT IN THAT LIST, AND THAT WAS THE WHOLE REASON
             * IT COULD NOT BE POINT-REFERENCED.
             *
             * A dimension's references are POINTS: an endpoint, a midpoint, a
             * centre, a point on an entity. Choosing between them is precisely what
             * the shared snapping pipeline does, and it is what a student expects
             * to use - `endpoint to midpoint` is a different dimension from
             * `endpoint to endpoint`, and there is no way to ask for the first when
             * the clicks resolve to the second.
             *
             * Without this the resolver returned the bare pointer, so every click
             * arrived as a raw coordinate with nothing resolved, and `findDimensionTarget`
             * fell back to measuring the whole FEATURE under the cursor. Selecting a
             * midpoint measured the entire line.
             *
             * So the dimension tools go through the same snapping as everything
             * else: same candidates, same tolerance, same indicators, same status
             * wording. Nothing dimension-specific is involved - the measurement
             * layer reads anchors off these features already.
             */
            return (
                [
                "point",
                "line",
                "polyline",
                "freeform-polygon",
                "triangle",
                "polygon",
                "circle",
                "arc",
                "rectangle"
            ].includes(toolId) ||

            /*
             * A PIPE / DUCT ROUTE IS A CONSTRUCTION TOOL. It runs through the
             * same click pipeline as every other multi-point tool, so it picks
             * up the shared snapping and inference - which is what makes a
             * route's vertices snap to existing geometry rather than needing a
             * Fluids-specific snap of its own.
             */
            toolId === "pipe-duct" ||
            toolId === "nozzle-diffuser" ||
            toolId === "rankine-cycle" ||
            toolId === "reheat-rankine-cycle" ||
            toolId === "vapor-compression-cycle" ||
            toolId === "brayton-cycle" ||
            toolId === "diesel-cycle" ||
            isDimensionTool(toolId) ||
        Boolean(STATICS_PLACEMENT_TOOLS[toolId]) ||
        Boolean(STATICS_BODY_ATTACHED_TOOLS[toolId]) ||
        toolId === "truss" ||
        toolId === "distributed-load" ||
        isVaryingLoadTool(toolId) ||
        Boolean(STATICS_SPAN_TOOLS[toolId]) ||

        /*
         * EVERY DYNAMICS TOOL IS A CONSTRUCTION TOOL.
         *
         * The whole library takes its points through the shared click and
         * drag pipelines - a placement tool commits on one aimed click, a
         * span, a box and an angle tool anchor on the first point and finish
         * on the second - and all of them pick up snapping and inference
         * exactly as Statics does. Without this branch the click router never
         * handed a Dynamics tool its clicks, so the placement tools created
         * nothing and the others only worked when the gesture came through
         * the drag path. Asked of the tool tables rather than of a hand-
         * written list, so a tool added to the library is covered here
         * without another edit.
         */
        Boolean(DYNAMICS_PLACEMENT_TOOLS[toolId]) ||
        Boolean(DYNAMICS_SPAN_TOOLS[toolId]) ||
        Boolean(DYNAMICS_ANGLE_TOOLS[toolId]) ||
        Boolean(DYNAMICS_BOX_TOOLS[toolId])
    );
}

/*
 * Is this click a selection of something that already exists?
 *
 * The decision is made from the INTERACTION STATE and a hit test, not
 * from the active tool. That is the important structural point: there
 * is no list of tools that are allowed to select, so a tool added
 * later is universally selectable the day it is written rather than
 * the day someone remembers to add it to a list.
 *
 *   - A construction is RUNNING      -> no. The click is one of its
 *     own points and belongs to it.
 *   - Nothing under the pointer       -> no. The tool's own handling
 *     deals with empty space.
 *   - Otherwise, something is there   -> yes, and it is selected.
 *
 * WHY A RUNNING CONSTRUCTION ALWAYS WINS
 * -------------------------------------
 * A half-built Beam is waiting for its second point. A click anywhere
 * - including on a feature - is that second point, and taking it for a
 * selection would leave the construction stranded and start an
 * unrelated operation in the middle of it.
 *
 * This is the case that makes universal selection safe rather than
 * reckless, and it is decided by asking the interaction what state it
 * is in. Every multi-click construction in the application - a truss, a
 * distributed load, a statics attachment, a line, a rectangle, an arc
 * - is mid-flight exactly when `phase` is something other than "idle",
 * so one question covers all of them and none can be missed by being
 * absent from a list.
 *
 * The corollary is deliberate: once the construction is committed and
 * the tool is still active, a click on an existing feature selects it.
 * That is what stops a student who has just finished a Moment from
 * starting a second one when they meant to grab the first.
 */
export function shouldClickSelectExistingObject(
    event
) {
    const toolId =
        drawingState.activeTool;

    if (!toolId) {
        return false;
    }

    /*
     * No construction running.
     *
     * Note this is the ONLY exemption. It is deliberately not
     * "exempt the tools that take several clicks", because that list
     * would have to be maintained by hand and would inevitably fall
     * behind - and a tool wrongly exempted is a tool the student
     * cannot select anything with.
     */
    if (
        drawingState.interaction.phase !==
        "idle"
    ) {
        return false;
    }

    /*
     * The point the student actually clicked, not the snapped one.
     *
     * A snap may legitimately pull the cursor to a nearby feature the
     * student did not mean - that is what snapping is for - and
     * acting on the snapped point here would select a force when the
     * student clicked through it. The construction tools still receive
     * the snapped point, unchanged; this question is only about what
     * lies under the pointer.
     */
    const point =
        canvasPointFromEvent(
            event,
            false
        );

    if (!point) {
        return false;
    }

    /*
     * Is there an existing feature here at all?
     *
     * If there is not, the click belongs to the tool: it continues a
     * construction, places a dimension, arms an annotation. Returning
     * false hands it straight over.
     */
    return Boolean(
        objectAtPoint(point)
    );
}
