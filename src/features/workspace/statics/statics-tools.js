/*
 * Statics tool definitions: which tools attach to a body, how many points each takes, how each is placed, and their instructions.
 */

import enggFeatureGeometry from "../../../shared/geometry/feature-geometry.js";
import { drawingState, editorState } from "../editor-state.js";
import { activateTool, initialToolMessage } from "../../../components/layout/toolbar/tool-activation.js";
import { closeCoordinateSystemMenu, openToolSubmenu } from "../../../components/layout/toolbar/tool-menus.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import { legacyPlaceholderMessage } from "../../../components/layout/toolbar/phase-reset.js";
import { STATICS_BODY_TYPES, isConnectionType, isSupportType } from "../../../shared/model/feature-types.js";

export const STATICS_TOOL_MENUS = {
    body: [
        { id: "particle", label: "Particle" },
        { id: "rigid-body", label: "Rigid Body" },
        { id: "beam", label: "Beam" },
        { id: "truss", label: "Truss" },
        { id: "cable", label: "Cable" },
        { id: "shaft", label: "Shaft" }
    ],

    /*
     * NO MOMENTS SUBMENU. A Moment is a single tool, like Point Force:
     * the category id 'moment' IS the tool, and there is no Applied
     * Moment layer to pass through and no Couple variant to choose.
     */
    load: [
        { id: "distributed-load", label: "Distributed Load" },
        {
            id: "varying-distributed-load",
            label: "Varying Distributed Load"
        }
    ],

    support: [
        { id: "pin-support", label: "Pin Support" },
        { id: "roller-support", label: "Roller Support" },
        { id: "fixed-support", label: "Fixed Support" },
        { id: "smooth-support", label: "Smooth Support" }
    ],

    connection: [
        { id: "pin-connection", label: "Pin Connection" },
        { id: "fixed-connection", label: "Fixed Connection" },
        { id: "slider-connection", label: "Slider Connection" }
    ]
};

/*
 * Every Statics feature tool, with the label shown in the
 * status line and the authoritative feature type it creates.
 *
 * A Point Force is listed here as a direct tool rather than
 * behind a submenu, and the type it records is `force`, which
 * is the Point Force feature. Force Pair, Point Load and the
 * old generic Force/Moment/Support entries are gone: there is
 * exactly one tool and one feature type per real feature.
 */
export const STATICS_CHILD_TOOLS = {
    particle: { label: "Particle", type: "particle" },
    "rigid-body": { label: "Rigid Body", type: "rigid-body" },
    beam: { label: "Beam", type: "beam" },
    truss: { label: "Truss", type: "truss" },
    cable: { label: "Cable", type: "cable" },
    shaft: { label: "Shaft", type: "shaft" },

    "point-force": { label: "Point Force", type: "force" },

    /*
     * The three analysis templates.
     *
     * Each names its own feature type, so the tool the student
     * chose and the thing that appears are the same thing. The
     * type is also what the shared span commit dispatches on,
     * so without an entry here the template would be placed as
     * a span and then have nothing to build.
     */
    "shear-force-diagram": {
        label: "Shear Force (SFD)",
        type: "shear-force-diagram"
    },
    "bending-moment-diagram": {
        label: "Bending Moment (BMD)",
        type: "bending-moment-diagram"
    },
    "axial-force-diagram": {
        label: "Axial Force (AFD)",
        type: "axial-force-diagram"
    },

    "moment": { label: "Moment", type: "moment" },

    "distributed-load": { label: "Distributed Load", type: "load" },
    "varying-distributed-load": {
        label: "Varying Distributed Load",
        type: "varying-load"
    },

    "pin-support": { label: "Pin Support", type: "pin-support" },
    "roller-support": {
        label: "Roller Support",
        type: "roller-support"
    },
    "fixed-support": { label: "Fixed Support", type: "fixed-support" },
    "smooth-support": {
        label: "Smooth Support",
        type: "smooth-support"
    },

    "pin-connection": {
        label: "Pin Connection",
        type: "pin-connection"
    },
    "fixed-connection": {
        label: "Fixed Connection",
        type: "fixed-connection"
    },
    "slider-connection": {
        label: "Slider Connection",
        type: "slider-connection"
    },

    "reference-point": {
        label: "Reference Point",
        type: "point"
    },

    /*
     * A Reference Line is a LINE, not a statics primitive of
     * its own. It is a reference line rather than a drawn
     * object, so it is created as ordinary line geometry that
     * starts out in the construction style and is named for
     * its statics role.
     *
     * Registering it here is what routes it through the normal
     * line factory, so it behaves exactly like a Line while it
     * is being built and while it is being edited, and it gets
     * the Line Features panel for free rather than needing a
     * second implementation of the same fields.
     */
    "reference-line": {
        label: "Reference Line",
        type: "line"
    },

    /*
     * A Reference Arc is an ARC child for the same reason a
     * Reference Line is a LINE child.
     *
     * Registering it here is what routes it through the ordinary arc
     * factory, so it behaves exactly like an Arc while it is being
     * built and while it is being edited, and it gets the Arc
     * Features panel for free rather than needing a second
     * implementation of the same fields. The arc construction modes,
     * the snapping, the live preview and undo are all the shared
     * ones.
     *
     * What makes it a REFERENCE arc is applied at commit, from
     * isReferenceArcTool: construction line type, and a name that
     * says so.
     */
    "reference-arc": {
        label: "Reference Arc",
        type: "arc"
    }
};

/*
 * Open a Statics category submenu. Choosing an item records
 * the support/connection variant on the interaction so the
 * created feature keeps its specific type, then starts the
 * tool through the normal activation path.
 */
export function openStaticsMenu(
    button,
    categoryId
) {
    const items =
        STATICS_TOOL_MENUS[categoryId];

    if (!items) {
        return;
    }

    openToolSubmenu(
        button,
        items,
        childId => {
            activateTool(
                childId
            );

            /*
             * activateTool already sets the opening
             * instruction for the tool, which is "Select
             * body" for the tools that need a body. Setting a
             * second message here would overwrite it with the
             * old free-space wording.
             */
            setToolMessage(
                initialToolMessage(
                    childId
                )
            );
        }
    );
}

/*
 * OPEN SKETCH OR PLOT FOR ONE OF THE THREE DIAGRAMS.
 *
 * These are the only three tools in the Analysis section that do NOT know
 * everything they need when the button is pressed. A student picking a
 * diagram has two honest ways of going on - sketch the answer, or type the
 * equations and have it drawn - and neither is "let the program work it
 * out", so there is no automated mode to fall back to. So the first press
 * asks which, and the tool is armed from HERE rather than from the
 * toolbar click: arming on the press and then stopping would leave a tool
 * active, waiting on a choice the student has not been shown.
 *
 * The list is the ordinary submenu, so the positioning, the
 * click-outside dismissal and the keyboard handling are the ones every
 * other submenu already has.
 */
export function openAnalysisModeMenu(
    button,
    item
) {
    /*
     * PHASE 1 RESET: the Sketch/Plot mode menu for the diagram
     * tools is a placeholder. No mode is offered and no diagram
     * is armed.
     */
    setToolMessage(legacyPlaceholderMessage());
}

/*
 * The canonical name of every Statics feature, keyed by its
 * authoritative feature type.
 *
 * This is the one place a Statics feature is named, so the
 * toolbar, the Feature Tree and the Features panel all call
 * it the same thing: a `load` is a Distributed Load
 * everywhere, never "load" and never a Distributed Force.
 */
/*
 * Statics features that reuse an existing geometry type.
 *
 * Their canonical name is that of the geometry itself, so a
 * Reference Point is not allowed to rename a plain Point.
 */
const SHARED_STATICS_GEOMETRY = [
    "point",
    "line"
];

export const STATICS_FEATURE_LABELS = Object.fromEntries(
    Object.entries(
        STATICS_CHILD_TOOLS
    )
        /*
         * A Reference Point reuses the ordinary point
         * geometry, so its `point` type is shared with plain
         * Points. Only types unique to a Statics feature are
         * renamed here; shared geometry keeps its own name.
         */
        .filter(
            ([, definition]) =>
                !SHARED_STATICS_GEOMETRY.includes(
                    definition.type
                )
        )
        .map(([toolId, definition]) => [
            definition.type,
            definition.label
        ])
);

/*
 * The Statics tools that act on a body, so they begin by
 * asking for one rather than placing themselves in free
 * space.
 *
 * A tool is body-attached when the feature only has meaning
 * relative to something it acts on. A Reference Line or a
 * free Point Force is not, and those keep placing directly.
 */
export const STATICS_BODY_ATTACHED_TOOLS = [
    /*
     * Both distributed loads begin by choosing the body they
     * load, then build the distribution on it in their own
     * staged interaction, so neither is a plain two-point
     * span tool any more. They share the body selection and the
     * span fallback, and diverge afterwards: the plain load is a
     * single constant magnitude, the varying one is a profile.
     */
    "distributed-load",
    "varying-distributed-load",
    "moment",
    "pin-support",
    "roller-support",
    "fixed-support",
    "smooth-support",
    "pin-connection",
    "fixed-connection",
    "slider-connection"
];

/*
 * The Statics tools that can be placed as FREE MOMENTS, with no body
 * to act on.
 *
 * A moment is a free-standing action at a point rather than something
 * that only means something against a body: an applied moment is a
 * moment at a point, and is perfectly meaningful on a blank sheet.
 * Requiring a body first would mean a student could not place a moment
 * anywhere until they had drawn something to put it on - which is the
 * opposite of how moments are used in statics, where they are applied
 * at joints and in free space as often as anywhere else.
 *
 * A click in empty space therefore places one directly. A click ON a
 * body still goes through the attachment path, so the moment is parented
 * to the body it was drawn on and the Features panel can show it
 * relative to that body.
 */
const STATICS_FREE_MOMENT_TOOLS = [
    "moment"
];

export function isFreeMomentTool(toolId) {
    return STATICS_FREE_MOMENT_TOOLS.includes(
        toolId ??
        drawingState.activeTool
    );
}

/*
 * How many points a body-attached tool needs before it can be
 * confirmed.
 *
 * A support or a moment is defined by a single point on its
 * body. A load needs the two ends of the region it loads. A
 * connection needs an attachment on each of the two bodies it
 * joins.
 */
const STATICS_TOOL_POINT_COUNT = {
    "distributed-load": 2,
    "varying-distributed-load": 2,
    "moment": 1,
    "pin-support": 1,
    "roller-support": 1,
    "fixed-support": 1,
    "smooth-support": 1,
    "pin-connection": 2,
    "fixed-connection": 2,
    "slider-connection": 2
};

/*
 * Whether a Statics tool must be given a body before it can
 * place anything.
 */
export function isBodyAttachedTool(
    toolId
) {
    return STATICS_BODY_ATTACHED_TOOLS.includes(
        toolId
    );
}

/*
 * How many points a body-attached tool still needs.
 */
export function staticsToolPointCount(
    toolId
) {
    return (
        STATICS_TOOL_POINT_COUNT[toolId] ?? 1
    );
}

/*
 * The status a body-attached tool shows at each step.
 *
 * The wording is written for the person using it, and each
 * step says what the next action is rather than describing
 * internal state.
 */
export function staticsBodyMessage(
    toolId,
    step
) {
    const count =
        staticsToolPointCount(toolId);

    if (step === 0) {
        return toolId === "moment"
            ? "Click a body to apply to, or empty space for a free moment"
            : "Select body";
    }

    if (isConnectionType(
        STATICS_CHILD_TOOLS[toolId]?.type
    )) {
        if (step === 1) {
            return "Select second body";
        }

        return "Pick connection location";
    }

    if (
        toolId === "distributed-load" ||
        toolId === "varying-distributed-load"
    ) {
        if (step === 1) {
            return "Pick magnitude of end load";
        }

        return "Pick magnitude and location of second end load";
    }

    if (isSupportType(
        STATICS_CHILD_TOOLS[toolId]?.type
    )) {
        return step === 1
            ? "Pick attachment location"
            : "Specify support orientation";
    }

    if (count > 1) {
        return "Pick first location";
    }

    return "Pick application point";
}

/*
 * The id of the body a snapped point belongs to, or null
 * when the snap did not land on an eligible engineering
 * body. This reads the existing snap candidate; it never
 * searches for one of its own.
 */
export function staticsAttachmentId(
    snapCandidate
) {
    const objectId =
        snapCandidate?.objectId;

    if (!objectId) {
        return null;
    }

    const target =
        drawingState.objects.find(
            object =>
                object.id ===
                    objectId
        );

    if (
        !target ||
        !STATICS_BODY_TYPES.includes(
            target.type
        )
    ) {
        return null;
    }

    return target.id;
}

/*
 * The valid placement locations along a body.
 *
 * These are the points a load can start or end at, a moment
 * can be applied, or a support can attach. They are derived
 * from the body's own geometry, so they always sit on the
 * body as it is drawn right now.
 *
 * They are preview-only. They are never added to the feature
 * collection, so they cannot appear in the Feature Tree or be
 * selected on their own.
 */
export function bodyPlacementLocations(
    body,
    count
) {
    const g = body.geometry || {};

    const total =
        count || 6;

    if (total < 1) {
        return [];
    }

    /*
     * A span body is divided along its own axis, which is what
     * makes a loaded region read as part of the member.
     */
    if (g.start && g.end) {
        return Array.from(
            { length: total },
            (_, index) => ({
                x:
                    g.start.x +
                    ((g.end.x - g.start.x) *
                        index) /
                        (total - 1 || 1),

                y:
                    g.start.y +
                    ((g.end.y - g.start.y) *
                        index) /
                        (total - 1 || 1)
            })
        );
    }

    /*
     * A located body offers a ring of points around its
     * centre, so a load or a support can be placed on it
     * rather than only at one spot.
     */
    const centre =
        enggFeatureGeometry.centerOf(
            g,
            body.type
        );

    if (!centre) {
        return [];
    }

    const radius =
        body.type === "rigid-body"
            ? Math.max(
                  (g.width || 0) / 2,
                  (g.height || 0) / 2
              )
            : 10;

    return Array.from(
        { length: total },
        (_, index) => {
            const angle =
                (Math.PI * 2 * index) /
                total;

            return {
                x: centre.x + radius * Math.cos(angle),
                y: centre.y + radius * Math.sin(angle)
            };
        }
    );
}

/*
 * The opening instruction for each Statics child tool, so
 * the status line always says what to do next.
 */
export function staticsInstruction(
    toolId
) {
    return (
        {
            particle: "Specify particle location",
            "rigid-body": "Specify body location",
            beam: "Specify beam start point",
            truss: "Specify truss start point",
            cable: "Specify cable start point",
            shaft: "Specify shaft start point",

            "point-force": "Specify force start point",

            "distributed-load": "Specify loading start point",
            "varying-distributed-load": "Specify loading start point",

            "moment": "Specify moment location",

            "pin-support": "Specify support location",
            "roller-support": "Specify support location",
            "fixed-support": "Specify support location",
            "smooth-support": "Specify support location",

            "pin-connection": "Specify connection start point",
            "fixed-connection": "Specify connection start point",
            "slider-connection": "Specify connection start point",

            "reference-point": "Specify reference point location",
            "reference-line": "Specify first point"
        }[toolId] || "Specify location"
    );
}

/*
 * The second-click instruction for the span tools, so a
 * Point Force asks for its endpoint the same way a Line
 * does, rather than borrowing the load wording.
 */
export function staticsSpanInstruction(
    toolId
) {
    return (
        {
            "point-force": "Specify force endpoint",
            beam: "Specify beam endpoint",
            truss: "Specify truss endpoint",
            cable: "Specify cable endpoint",
            shaft: "Specify shaft endpoint",

            "distributed-load": "Specify loading end point",
            "varying-distributed-load": "Specify loading end point",

            "pin-connection": "Specify connection end point",
            "fixed-connection": "Specify connection end point",
            "slider-connection": "Specify connection end point",

            "reference-line": "Specify second point"
        }[toolId] || "Specify second point"
    );
}

/*
 * Section headings for the support and connection variants.
 *
 * Every variant is a real feature in its own right, so the
 * Features panel names the one the student placed instead of
 * collapsing them into a single generic Support or Connection
 * heading.
 */
export function staticsSupportSection(
    type
) {
    return {
        "pin-support": "PIN SUPPORT",
        "roller-support": "ROLLER SUPPORT",
        "fixed-support": "FIXED SUPPORT",
        "smooth-support": "SMOOTH SUPPORT"
    }[type] || "SUPPORT";
}

export function staticsConnectionSection(
    type
) {
    return {
        "pin-connection": "PIN CONNECTION",
        "fixed-connection": "FIXED CONNECTION",
        "slider-connection": "SLIDER CONNECTION"
    }[type] || "CONNECTION";
}

export function openCoordinateSystemMenu(button) {
    if (!button) {
        return;
    }

    if (
        editorState.coordinateSystemMenu &&
        editorState.coordinateSystemMenuAnchor ===
            button
    ) {
        closeCoordinateSystemMenu();
        return;
    }

    closeCoordinateSystemMenu();

    const menu =
        document.createElement("div");

    menu.className =
        "drawing-coordinate-submenu";

    menu.setAttribute(
        "role",
        "menu"
    );

    menu.innerHTML = `
        <button
            type="button"
            class="drawing-coordinate-submenu-item"
            role="menuitem"
            data-coordinate-mode="2d"
        >
            2D Coordinate System
        </button>

        <button
            type="button"
            class="drawing-coordinate-submenu-item"
            role="menuitem"
            data-coordinate-mode="3d"
        >
            3D Coordinate System
        </button>
    `;

    document.body.appendChild(menu);

    const buttonRect =
        button.getBoundingClientRect();

    const menuRect =
        menu.getBoundingClientRect();

    const gap = 4;
    const margin = 8;

    let left =
        buttonRect.right +
        gap;

    let top =
        buttonRect.top;

    if (
        left + menuRect.width >
        window.innerWidth - margin
    ) {
        left =
            Math.max(
                margin,
                buttonRect.left -
                    menuRect.width -
                    gap
            );
    }

    if (
        top + menuRect.height >
        window.innerHeight - margin
    ) {
        top =
            Math.max(
                margin,
                window.innerHeight -
                    menuRect.height -
                    margin
            );
    }

    menu.style.position =
        "fixed";

    menu.style.left =
        `${left}px`;

    menu.style.top =
        `${top}px`;

    menu.style.zIndex =
        "9999";

    menu.querySelectorAll(
        ".drawing-coordinate-submenu-item"
    ).forEach(
        option => {
            option.addEventListener(
                "click",
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const mode =
                        option.dataset
                            .coordinateMode;

                    closeCoordinateSystemMenu();

                    if (mode === "2d") {
                        /*
                         * PHASE 1 RESET: the 2D coordinate system is a
                         * placeholder; the submenu item reports that.
                         * The original arming implementation has been
                         * removed with the legacy tools.
                         */
                        setToolMessage(legacyPlaceholderMessage());
                    } else {
                        setToolMessage(
                            "3D Coordinate System is not available on the 2D drawing canvas"
                        );
                    }
                }
            );
        }
    );

    editorState.coordinateSystemMenu = menu;
    editorState.coordinateSystemMenuAnchor = button;

    button.setAttribute(
        "aria-expanded",
        "true"
    );
}

/*
 * Statics tools that are placed with a single click.
 *
 * Derived from STATICS_CHILD_TOOLS so a tool listed in a
 * submenu always has a creation path and can never be
 * silently unhandled.
 */
const STATICS_SINGLE_CLICK_TOOLS = [
    "particle",
    "rigid-body",
    "pin-support",
    "roller-support",
    "fixed-support",
    "smooth-support",
    "reference-point"
];

export const STATICS_PLACEMENT_TOOLS = {
    ...Object.fromEntries(
        STATICS_SINGLE_CLICK_TOOLS.map(id => [
            id,
            STATICS_CHILD_TOOLS[id] || {
                label: id,
                type: id
            }
        ])
    ),

    /*
     * AN APPLIED MOMENT PLACED IN FREE SPACE IS A SINGLE-CLICK CREATION.
     *
     * The tool reaches this table from the free-moment rule in
     * beginOrCompleteGeometry: a click in empty space places the moment
     * straight away rather than refusing and demanding a body to apply it
     * to.
     *
     * It was missing here, and the table was built from the single-click
     * list alone - so the lookup returned undefined and
     * createStaticsFeature returned on its first line without creating
     * anything. The Applied Moment tool therefore armed correctly, showed
     * its instruction, and did nothing at all on a click, with no error
     * anywhere: a moment could only ever be placed by picking its way
     * through the body-attached route.
     *
     * It is added here rather than to STATICS_SINGLE_CLICK_TOOLS because
     * that list describes tools that are FINISHED by one click. An
     * applied moment on a body is not: it is a two-stage construction
     * that fixes its application point and is then sized by the cursor.
     * Listing it as single-click would misdescribe the tool, and the
     * body-attached branch is still what runs first, so the two-stage
     * flow on a body is unaffected.
     */
    "moment": STATICS_CHILD_TOOLS["moment"]
};

/*
 * Tools that span two points, so they need a second click.
 */
export const STATICS_SPAN_TOOLS = {
    "point-force": "Point Force",
    beam: "Beam",
    cable: "Cable",
    shaft: "Shaft",

    "pin-connection": "Pin Connection",
    "fixed-connection": "Fixed Connection",
    "slider-connection": "Slider Connection",

    /*
     * The three analysis diagrams are DELIBERATELY NOT HERE.
     *
     * They used to be placed between two clicks like a Beam, which
     * asked the student to re-enter the span their diagram measures.
     * A diagram is a view of a body that is already drawn: its axis
     * length and direction come from that body, and asking for them
     * again meant the two could be made to disagree - drag an axis
     * narrower than its beam and every station on it silently stops
     * lining up with the load it came from.
     *
     * They are now placed by moving the pointer up and down and
     * clicking, which is one decision instead of four coordinates, and
     * the only decision that is actually the student's to make.
     */
    "reference-line": "Reference Line"
};

/*
 * The Statics spans whose SECOND point snaps to their first.
 *
 * Every span tool is placed between two clicks, so in principle all of
 * them could align to their first point. Beam, Cable and Shaft are
 * listed because they are the ones whose second point positions a body
 * whose alignment the student is really asking about, and they are the
 * tools this behaviour was added for.
 *
 * The connections and Reference Line are deliberately NOT here. They
 * place a symbol at a point rather than a body between two, and their
 * alignment is not something the student has been shown to expect.
 * They keep exactly the snapping they had. Adding them is a one-line
 * change here if that is ever wanted, and nothing else would move.
 */
export const STATICS_SPAN_SNAP_TOOLS = [
    "beam",
    "cable",
    "shaft"
];
