/*
 * ========================================================
 * WHAT KIND OF CLICK A TOOL EXPECTS
 * ========================================================
 *
 * A creation tool's click is not one thing. Two broad shapes exist, and the
 * difference decides what a single click on existing geometry MEANS:
 *
 *   POINT-STYLE
 *     The tool's input is a single point. A click anywhere - on empty space or
 *     on a feature - is the answer it was waiting for. It places its feature at
 *     the point and stays armed for the next one. A Point, a Particle, a
 *     Reference Point and a single-click placement support are all this shape,
 *     and none of them should be knocked out of the tool by a click.
 *
 *   PATH-STYLE
 *     The tool's feature needs a line, a path, a region or a sequence. A plain
 *     click is NOT enough to make one - the student must move the pointer and
 *     click again, or press and drag. So a bare click with such a tool armed is
 *     not "the first point of a shape", it is the student finishing with the
 *     tool: it EXITS to Select, selecting whatever was under the cursor.
 *
 * THE POINT OF NAMING BOTH, HERE, ONCE
 * ------------------------------------
 * The distinction used to live implicitly in the construction pipeline, and the
 * consequence was that a student who had just drawn a Line and then clicked on
 * empty space stayed trapped in the Line tool, having to find the Select button
 * to escape. So the classification is stated explicitly and read by the click
 * router, rather than inferred case by case from what each tool happens to do.
 *
 * WHY THE PATH SET IS NOT WRITTEN OUT HERE
 * ----------------------------------------
 * "Which tools can make their feature from ONE press-drag-release" is already
 * answered, precisely, by `isDragCreationTool` in the creation layer - it is the
 * same fact the drag pipeline itself keys on. A second hand-written list here
 * would be a second answer, free to disagree with the first, so the question is
 * asked of that one function rather than restated.
 */

import { isDragCreationTool } from "../../../features/workspace/interaction/creation-drag.js";
import {
    DYNAMICS_SPAN_TOOLS,
    DYNAMICS_ANGLE_TOOLS,
    DYNAMICS_BOX_TOOLS
} from "../../../features/workspace/dynamics/dynamics-tools.js";

/*
 * The tools whose interaction is a SINGLE POINT.
 *
 * Everything else that is a creation tool is path-style by default, so a new
 * tool gets the exit-to-Select behaviour unless it is deliberately listed here.
 * That direction of default is the safe one: a point tool wrongly treated as
 * path-style merely exits when the student clicks, while a path tool wrongly
 * treated as point-style would place a degenerate feature on a stray click.
 */
export const POINT_TOOLS = [
    /*
     * A Point Force's application point is one click when it is attached to a
     * body; placed in free space it drags a vector. Either way its FIRST input
     * is a point the student aims at, and it is not a path tool.
     */
    "point",
    "particle",
    "reference-point",

    /*
     * THE DYNAMICS PLACEMENT TOOLS PLACE ON ONE CLICK TOO.
     *
     * A Dynamics Particle and a Dynamics Reference Point are finished by a
     * single aimed click, exactly as their Statics and Geometry twins are.
     * Left out of this list, a bare click was read as "I am finished with
     * this tool" and dropped the student into Select before anything could
     * be placed - the tool armed, previewed its instruction and then ate its
     * own first click. Asked beside the twins they mirror, so the three stay
     * in step by construction.
     */
    "dynamics-particle",
    "dynamics-reference-point",

    /*
     * The supports place at a single location on the member they are propped
     * under - the body is chosen first, the location second, and the location
     * IS the whole answer.
     */
    "pin-support",
    "roller-support",
    "fixed-support",
    "smooth-support",

    /* A Moment is applied at one point and sized by the cursor afterwards. */
    "moment"
];

export function isPointTool(toolId) {
    return POINT_TOOLS.includes(
        toolId ?? null
    );
}

/*
 * The tools whose click is an EXPLICIT REQUIRED INPUT.
 *
 * Named rather than detected, because "is this tool waiting for something
 * specific?" is exactly the fact those tools know and no general rule can
 * infer. A dimension waits for references, a Resultant for a force, a label or
 * a leader for the feature it attaches to - in each case the tool's own state
 * machine decides what the click means, and pulling it into Select would break
 * the input workflow the student is halfway through.
 */
export const REQUIRED_INPUT_TOOLS = [
    /* The dimension tool collects references until Enter. */
    "dimension",
    "angle",

    /* The reference-based annotate kinds attach to a feature. */
    "label",
    "leader",
    "callout",
    "tolerance",
    "symbol",

    /* The analysis children are told which force(s) they read. */
    "resultant",
    "force-components",

    /* The legacy annotation tool attaches to what it labels. */
    "annotation"
];

export function hasRequiredInput(toolId) {
    return REQUIRED_INPUT_TOOLS.includes(
        toolId ?? null
    );
}

/*
 * The tools that a bare click should NOT exit - the union of the two "keep
 * interacting" families above, plus Select itself.
 */
export function clickKeepsTool(toolId) {
    return (
        toolId === "select" ||
        toolId === null ||
        toolId === undefined ||
        isPointTool(toolId) ||
        hasRequiredInput(toolId)
    );
}

/*
 * ========================================================
 * SHOULD A BARE CLICK EXIT THE ACTIVE TOOL?
 * ========================================================
 *
 * Yes for a tool whose WHOLE feature is one press-drag-release and which has no
 * step after it: a bare click cannot be that feature, so it means "I am
 * finished with this tool". No for everything else:
 *
 *   - a POINT tool places its feature on that click (its intended behaviour);
 *   - Select is already Select;
 *   - a Modify or View session owns its own clicks;
 *   - a tool with an EXPLICIT REQUIRED INPUT (a dimension collecting
 *     references, a Resultant waiting to be told which force, a label or a
 *     leader attachment) must keep receiving the click - its own state machine
 *     decides what the click means, and pulling it into Select would break the
 *     input workflow the student is halfway through;
 *   - a MULTI-STEP tool (a triangle, a polygon, an arc, a polyline, a truss,
 *     a distributed load) needs several clicks to make anything, so a click is
 *     a REAL STEP of its workflow and must not exit it.
 *
 * WHY `isDragCreationTool` IS NOT ENOUGH ON ITS OWN
 * -------------------------------------------------
 * That predicate answers "can a press-drag-release make this feature's FIRST
 * span" - which is true of a triangle and an arc as well as a line, because
 * their first edge comes from the drag. But a triangle is not finished after
 * that edge, so a bare click is not "done" for it. The one-gesture set is
 * therefore NARROWED here by the tools that have steps after the first, rather
 * than used directly.
 */

/*
 * The tools with steps AFTER their first gesture, so a bare click is a step of
 * their workflow rather than a request to stop.
 *
 * ========================================================
 * PIPE / DUCT IS ONE OF THEM, AND IT IS NOT A ONE-GESTURE TOOL
 * ========================================================
 *
 * A Pipe / Duct run IS drawn by one press-drag-release - but the TOOL is not
 * finished when that run is, which is the distinction this list is about. A
 * continuous path is drawn as a SEQUENCE of drags, and the student ends it
 * explicitly with a double-click or Enter (see pipe-duct-tool.js). So a bare
 * click means nothing for this tool: it is the trailing click of a gesture that
 * has already committed a run, or the first half of the double-click that
 * finishes the path.
 *
 * Without this entry `shouldExitToSelectOnClick` answered YES for
 * `pipe-duct` - it is a drag creation tool and appeared in neither this list
 * nor `clickKeepsTool` - so the FIRST click after arming the tool dropped the
 * student straight into Select. The drag then never reached the creation
 * pipeline: the press was read as a selection, and the tool appeared to "go to
 * select" the moment it was used. Naming it here keeps the tool armed for the
 * next leg, exactly as a polyline or a truss is kept.
 */
export const MULTI_STEP_TOOLS = [
    "triangle",
    "polygon",
    "arc",
    "reference-arc",
    "polyline",
    "truss",
    "distributed-load",
    "varying-distributed-load",
    "pipe-duct"
];

/*
 * THE DYNAMICS SPAN, BOX AND ANGLE TOOLS TAKE CLICK-MOVE-CLICK TOO.
 *
 * A spring, a vector, a pulley or a body anchors on its first point and is
 * finished by the second - so a bare click is a REAL STEP of the tool's
 * workflow, not a request to stop.
 *
 * READ LAZILY, NOT AT MODULE LOAD. The Dynamics tool tables live in a module
 * that reaches back into the toolbar's menu code, and this module is part of
 * that toolbar: importing the tables here closed a cycle that broke module
 * initialisation for the whole application. Asked of the tables at call time
 * instead, so a tool added to the Dynamics library is covered here without
 * another edit and the cycle stays open.
 */
let dynamicsMenuToolIds = null;

function dynamicsMultiStepIds() {
    if (!dynamicsMenuToolIds) {
        dynamicsMenuToolIds = [
            ...Object.keys(DYNAMICS_SPAN_TOOLS),
            ...Object.keys(DYNAMICS_ANGLE_TOOLS),
            ...Object.keys(DYNAMICS_BOX_TOOLS)
        ];
    }

    return dynamicsMenuToolIds;
}

export function isMultiStepTool(toolId) {
    return dynamicsMultiStepIds().includes(toolId ?? null) ||
    MULTI_STEP_TOOLS.includes(toolId ?? null);
}

/*
 * The GEOMETRY tools that take click-move-click as well as press-drag-release.
 *
 * A bare click with one of these armed is the shape's FIRST POINT, exactly as in
 * a CAD program - the second click completes it, and Esc or Select leaves the
 * tool. Kept to the Geometry category on purpose: the Statics, Annotate and
 * Thermodynamics path tools keep the exit-on-click rule until their owners
 * choose otherwise.
 */
export const CLICK_CLICK_TOOLS = [
    "callout",
    "line",
    "rectangle",
    "circle",

    /*
     * PIPE / DUCT KEEPS ITS CLICK TOO.
     *
     * A run is drawn by press-drag-release, so its TRAILING click has always to
     * reach the router as "nothing" - and the router's construction branch only
     * touches the geometry phase machine, which a run does not use. Treating a
     * bare click on a run as the end of the tool is what keeps a path alive: the
     * student's click after releasing a leg must neither place a run nor drop
     * them out of the tool mid-path.
     */
    "pipe-duct"
];

export function isClickClickTool(toolId) {
    return CLICK_CLICK_TOOLS.includes(
        toolId ?? null
    );
}

export function shouldExitToSelectOnClick(toolId) {
    if (clickKeepsTool(toolId)) {
        return false;
    }

    if (isMultiStepTool(toolId) || isClickClickTool(toolId)) {
        return false;
    }

    return isDragCreationTool(toolId) === true;
}

const enggToolClassification = {
    POINT_TOOLS,
    REQUIRED_INPUT_TOOLS,
    MULTI_STEP_TOOLS,
    CLICK_CLICK_TOOLS,
    clickKeepsTool,
    hasRequiredInput,
    isPointTool,
    isMultiStepTool,
    isClickClickTool,
    shouldExitToSelectOnClick
};

export default enggToolClassification;
