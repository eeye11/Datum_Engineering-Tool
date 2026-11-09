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
 * WHY THERE IS NO "DRAG TOOL" LIST HERE ANY MORE
 * ----------------------------------------------
 * The drag pipeline owns which tools can be made by press-drag-release, and it
 * said so here once. The exit rule no longer needs to ask that question: a bare
 * click ends every tool except the ones that MAKE something from the click
 * (point tools, note/table) or that are building from clicks (click-click and
 * multi-step). Which gesture a constructor also accepts is not what decides
 * whether an idle click on empty canvas dismisses it.
 */

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
    "gain",
    "sum",

    /*
     * A MATH POINT AND A MATH EQUATION ARE PLACED BY THE CLICK ITSELF, so the
     * click that makes them must never be read as "I am finished with this
     * tool". The other Math tools are drag or multi-step tools and are listed
     * where they belong.
     */
    "math-point",
    "math-equation",

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

    /*
     * A NOTE AND A TABLE ARE PLACED BY THE CLICK ITSELF.
     *
     * They were reaching neither this list nor the point tools, so the bare
     * click that makes them was read as "I am finished with this tool" - the
     * note tool armed, took its click as a dismissal, and nothing was placed.
     */
    "note",
    "table",

    /* The analysis children are told which force(s) they read. */
    "resultant",
    "force-components",

    /*
     * THE THREE DIAGRAMS ARE TOLD WHICH MEMBER THEY BELONG TO.
     *
     * A diagram's first click names its body and its second places it, so
     * every click while the tool is armed is an input - including one on empty
     * canvas, which is where the student is positioning the frame. Without
     * this, a click on empty space was read as "I am finished with this tool"
     * and dropped the student into Select halfway through a placement.
     */
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram",

    /*
     * THE MATH TOOLS THAT TAKE THEIR INPUT FROM CLICKS.
     *
     * A Function Curve in Plot mode names its graph, a Tangent / Normal names
     * its curve and contact point, and a Slope Triangle names its parent and
     * then two positions along it. Every one of those clicks is a REAL STEP of
     * the tool's workflow, so a click on empty canvas must not be read as a
     * dismissal halfway through.
     */
    "math-curve",
    "math-tangent",
    "math-slope-triangle",

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
    "signal-line",
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

/*
 * ========================================================
 * THE TOOL TABLES THE TOOLBAR DOES NOT OWN
 * ========================================================
 *
 * `MULTI_STEP_TOOLS` above is the toolbar's own list. A Truss and a Pipe / Duct
 * are Statics and Fluids tools whose tables live elsewhere, and they were
 * missing from it - so a bare click on an armed Truss answered "this is not a
 * multi-step tool", the router read the click as a dismissal, and the Truss
 * could not be started with a click at all.
 *
 * `isConstructionTool` already asks these tables, which is what kept the
 * click PIPELINE right; only the classification had drifted. Asked here as
 * well, so the two agree by construction and a tool added to either table is
 * covered without another edit.
 *
 * READ LAZILY. These modules reach back into the toolbar, so importing their
 * tables at load time closes a cycle - see the note above `dynamicsMenuToolIds`.
 */
let constructionMultiStepIds = null;

function constructionMultiStepToolIds() {
    if (!constructionMultiStepIds) {
        constructionMultiStepIds = new Set([
            "truss",
            "pipe-duct"
        ]);
    }

    return constructionMultiStepIds;
}

export function isMultiStepTool(toolId) {
    return dynamicsMultiStepIds().includes(toolId ?? null) ||
        constructionMultiStepToolIds().has(toolId ?? null) ||
        MULTI_STEP_TOOLS.includes(toolId ?? null);
}

/*
 * The tools that take click-move-click as well as press-drag-release.
 *
 * A bare click with one of these armed is the shape's FIRST POINT, exactly as in
 * a CAD program - the second click completes it, and Esc or Select leaves the
 * tool. The Annotate and Thermodynamics path tools keep the exit-on-click rule
 * until their owners choose otherwise.
 */
export const CLICK_CLICK_TOOLS = [
    "callout",
    "line",
    "rectangle",
    "circle",

    /*
     * THE MULTI-POINT GEOMETRY TOOLS START ON A CLICK TOO.
     *
     * A Triangle, an Arc and a Polygon already kept every click AFTER their
     * first point (they are multi-step tools), but their very first bare
     * click reached `finishCreationClick` with the phase still idle and was
     * read as "leave the tool". So they could be dragged but never clicked.
     * Listing them here makes the first click their first point, exactly as
     * for a Line - and a drag still works as before.
     *
     * The Coordinate System is the same two points (origin, then X
     * direction), so a click places its origin and a second click its axis.
     */
    "triangle",
    "arc",
    "polygon",

    /*
     * THE FREEFORM POLYGON STARTS ON A CLICK TOO.
     *
     * Its first vertex is a click, exactly as a Triangle's first corner and a
     * Polyline's first point are. It is a PROGRESSIVE tool - it takes a flow
     * of points rather than one drag - but the click router asks this question
     * before it reaches the construction, so without this entry the first
     * click of a new polygon would be read as "I am finished with this tool"
     * and drop the student into Select.
     */
    "freeform-polygon",

    /*
     * THE STATICS TWO-POINT TOOLS.
     *
     * Every Statics tool whose feature (or whose first step) is a start and an
     * end takes the click workflow as well as the drag: the bodies drawn as a
     * span, the Point Force, the connections, a load's span, the reference
     * line and arc, and the coordinate system's origin and X direction. The
     * single-click placements (particle, supports, moment, reference point)
     * and the flow tools (truss) already take clicks and are not listed.
     */
    "beam",
    "cable",
    "shaft",
    "point-force",
    "pin-connection",
    "fixed-connection",
    "slider-connection",
    "distributed-load",
    "varying-distributed-load",
    "reference-line",
    "reference-arc",
    "coordinate-system-2d",

    /*
     * THE MATH TOOLS THAT TAKE CLICK-MOVE-CLICK AS WELL AS A DRAG. A Vector and
     * a Coordinate Graph are drawn by a drag, and a bare click with either
     * armed is the first point of that gesture - not a request to stop.
     */
    "math-vector",
    "math-plot",

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

/*
 * ========================================================
 * SHOULD A BARE CLICK ON EMPTY CANVAS END THIS TOOL?
 * ========================================================
 *
 * The rule, stated once for the whole application:
 *
 *   CLICK-TO-CREATE  the click MAKES the object, so it never ends the tool.
 *   ANYTHING ELSE    a click that is not an input ends the tool.
 *
 * "An input" means a real step of the tool's own workflow, and the two families
 * that own such steps are the MULTI-STEP tools (a triangle's next corner, a
 * load's span) and the REQUIRED-INPUT tools (a dimension collecting references,
 * a resultant naming its force). Their clicks are consumed by their own state
 * machines before this question is ever asked of empty canvas, so this function
 * answers only what a click that reached the canvas WITH NOTHING PENDING means.
 *
 * IT USED TO ASK "is this a drag tool?" AND THAT WAS NARROWER THAN THE RULE.
 * A tool that is neither a point tool, a multi-step tool, a click-click tool nor
 * a drag tool answered `false` - which meant it kept the click forever and the
 * student was trapped in it. That is now an EXIT: every tool that does not make
 * its object from the click itself leaves on one.
 */
export function shouldExitToSelectOnClick(toolId) {
    /* Click-to-create keeps creating; Select is already Select. */
    if (clickKeepsTool(toolId)) {
        return false;
    }

    /*
     * A CONSTRUCTOR'S CLICK IS ITS FIRST INPUT, NOT AN EXIT.
     *
     * A Line, a Beam, a Triangle or a Pipe run is drawn click-move-click as
     * well as by drag, and a multi-step tool's click is the next corner. Ending
     * the tool on those would take away half the workflow - so they keep the
     * click here, and the router decides from the INTERACTION whether the click
     * is a step (a construction in progress) or a dismissal (nothing started on
     * empty canvas).
     */
    if (isClickClickTool(toolId) || isMultiStepTool(toolId)) {
        return false;
    }

    /*
     * EVERYTHING ELSE LEAVES ON A BARE CLICK.
     *
     * This is the half that used to be too narrow: it answered "is this a drag
     * tool?", so a tool in no list at all kept the click forever and trapped
     * the student. Any tool that is not click-to-create and not a constructor
     * has nothing to do with a bare click on empty canvas, so it hands the
     * canvas back to Select.
     */
    return true;
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
