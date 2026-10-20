/*
 * The tool list and its submenus: polygon sides, arc modes.
 */

import enggDrawingState from "../../../shared/model/drawing-state.js";
import { drawToolLabelById, toolIcons } from "./tools.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { drawingState, editorState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { currentEngineeringMetadata, polygonFromCursor, polygonSideCount } from "../../../features/workspace/geometry/geometry-creation.js";
import { createPreview } from "../../../features/workspace/geometry/preview.js";
import { STATICS_TOOL_MENUS } from "../../../features/workspace/statics/statics-tools.js";
import { setToolMessage } from "./toolbar-render.js";

export function activeCategory() {
    return (
        document.querySelector(
            ".drawing-category.active"
        )?.dataset.category ||
        "GEOMETRY"
    );
}

export function toolDefinitionForLabel(label) {
    const toolIdByLabel =
        Object.fromEntries(
            Object.entries(
                drawToolLabelById
            ).map(
                ([id, toolLabel]) =>
                    [toolLabel, id]
            )
        );

    return {
        id:
            toolIdByLabel[label] ||
            label
                .toLowerCase()
                .replace(
                    /[^a-z]+/g,
                    "-"
                ),
        label,
        ...(["Piston Cylinder", "Process Diagrams", "Heat Transfer", "Work"].includes(label) ? { submenu: true } : {})
    };
}

export function renderToolButton(tool) {
    /*
     * A submenu parent highlights when one of its own
     * children is the active tool, so the highlight always
     * shows which category the running tool belongs to.
     */
    const childActive =
        (tool.id === "work" && ["electric-work", "mechanical-work"].includes(drawingState.activeTool)) ||
        (tool.id === "heat-transfer" && ["heat-entering", "heat-leaving"].includes(drawingState.activeTool)) ||
        (tool.id === "process-diagrams" && ["saturation-curve", "process-plot", "process-path", "constant-temp-pressure-lines"].includes(drawingState.activeTool)) ||
        (tool.id === "piston-cylinder" && drawingState.activeTool === "piston-cylinder-stoppers") ||
        STATICS_TOOL_MENUS[tool.id]?.some(
            item =>
                item.id ===
                drawingState.activeTool
        ) ||
        false;

    const active =
        drawingState.activeTool ===
            tool.id ||
        childActive ||
        (
            tool.id ===
                "coordinate-system" &&
            drawingState.activeTool ===
                "coordinate-system-2d"
        );

    const shortcut =
        tool.shortcut
            ? ` (${tool.shortcut})`
            : "";

    /*
     * Tools that open a submenu advertise it, so the
     * affordance matches the existing coordinate-system
     * and polygon buttons.
     */
    const coordinateAttributes =
        tool.id ===
            "coordinate-system" ||
        tool.submenu
            ? ' aria-haspopup="menu" aria-expanded="false"'
            : "";

    const submenuCaret =
        tool.submenu
            ? ' <span class="drawing-tool-caret" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><path d="M2.5 4.25L6 7.75l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
            : "";

    return `
        <button
            class="drawing-tool${active ? " active" : ""}"
            type="button"
            data-tool-id="${tool.id}"
            title="${tool.label}${shortcut}"
            aria-label="${tool.label}${shortcut}"
            aria-pressed="${active}"
            ${coordinateAttributes}
        >
            <span class="drawing-tool-icon" aria-hidden="true">
                ${toolIcons[tool.iconLabel || tool.label] || ""}
            </span>

            <!--
                The label is its own element rather than a bare
                text node so that a name too long for the panel can
                WRAP instead of widening it.

                A panel wide enough to hold every name on one line
                would take a large share of a laptop screen away
                from the drawing, so the panels stay compact and
                the names give way instead - which costs a second
                line of text rather than a third of the canvas.

                The wrap is a hanging indent (see
                .drawing-tool-label), so a name's second line stays
                under its own first character instead of sliding
                back under the icon, where it would read as
                belonging to the row above.
            -->
            <span class="drawing-tool-label">${tool.label}${submenuCaret}</span>
        </button>
    `;
}

export function closeCoordinateSystemMenu() {
    if (editorState.coordinateSystemMenu) {
        editorState.coordinateSystemMenu.remove();
        editorState.coordinateSystemMenu = null;
    }

    if (editorState.coordinateSystemMenuAnchor) {
        editorState.coordinateSystemMenuAnchor.setAttribute(
            "aria-expanded",
            "false"
        );

        editorState.coordinateSystemMenuAnchor = null;
    }
}

/*
 * Small prompt for the polygon's side count.
 *
 * This belongs to the creation workflow, so it is a
 * transient popup rather than part of the Features
 * panel. Confirming it commits the polygon.
 */
export function openPolygonSidesPrompt(
    interaction
) {
    closePolygonSidesPrompt();

    const prompt =
        document.createElement("div");

    prompt.className =
        "drawing-polygon-prompt";

    prompt.setAttribute(
        "role",
        "dialog"
    );

    prompt.innerHTML = `
        <label class="drawing-polygon-prompt-label" for="polygonSidesInput">
            Number of Sides
        </label>
        <div class="drawing-polygon-prompt-row">
            <input id="polygonSidesInput" type="number"
                min="3" step="1" value="${polygonSideCount(interaction)}">
            <button type="button" data-polygon-confirm>OK</button>
        </div>
    `;

    document.body.appendChild(
        prompt
    );

    const input =
        prompt.querySelector(
            "#polygonSidesInput"
        );

    const confirm = () => {
        const sides =
            Math.round(
                Number(input.value)
            );

        /*
         * Reject anything that cannot form a polygon.
         */
        if (
            !Number.isFinite(sides) ||
            sides < 3
        ) {
            input.value =
                String(
                    polygonSideCount(
                        interaction
                    )
                );

            setToolMessage(
                "Number of sides must be 3 or more"
            );

            return;
        }

        interaction.polygonSides =
            sides;

        closePolygonSidesPrompt();

        commitPolygon(interaction);
    };

    prompt.querySelector(
        "[data-polygon-confirm]"
    ).addEventListener(
        "click",
        confirm
    );

    input.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirm();
            }
        }
    );

    /*
     * Live preview while the count changes.
     */
    input.addEventListener("input", () => {
        const sides =
            Math.round(
                Number(input.value)
            );

        if (
            Number.isFinite(sides) &&
            sides >= 3
        ) {
            interaction.polygonSides =
                sides;

            const geometry =
                polygonFromCursor(
                    interaction,
                    interaction.currentPoint
                );

            interaction.preview =
                geometry
                    ? createPreview(
                        "polygon",
                        geometry
                    )
                    : null;

            renderCurrentDrawing();
        }
    });

    setToolMessage(
        "Specify number of sides"
    );

    input.focus();
    input.select();

    editorState.polygonSidesPrompt =
        prompt;
}

export function closePolygonSidesPrompt() {
    if (editorState.polygonSidesPrompt) {
        editorState.polygonSidesPrompt.remove();
        editorState.polygonSidesPrompt = null;
    }
}

/*
 * Create the polygon from the confirmed definition and
 * select it, so its Features panel opens immediately.
 */
function commitPolygon(
    interaction
) {
    const geometry =
        polygonFromCursor(
            interaction,
            interaction.currentPoint
        );

    if (!geometry) {
        setToolMessage(
            "Specify polygon radius"
        );

        return;
    }

    const previousObjects =
        enggDrawingState.snapshotDrawing(
            drawingState
        );

    const object =
        enggDrawingState.geometryFactories.polygon(
            geometry.center,

            geometry.radius,

            geometry.sides,

            geometry.rotation,

            {
                style: {
                    ...drawingState.styleDefaults
                },

                /*
                 * Remember how the polygon was defined so
                 * the Features panel can show the matching
                 * parameters. The feature type stays
                 * "polygon" either way.
                 */
                metadata: {
                    definition:
                        interaction.polygonMode ===
                        "sides"
                            ? "By Sides"
                            : "By Centre"
                },

                engineering:
                    currentEngineeringMetadata()
            }
        );

    enggDrawingState.addObject(
        drawingState,
        object
    );

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

    setToolMessage(
        "Specify polygon centre"
    );

    renderProperties();
    renderCurrentDrawing();
}

export function openPolygonMenu(button) {
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

    const currentMode =
        drawingState.interaction.polygonMode ||
        "sides";

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
            class="drawing-coordinate-submenu-item${currentMode === "sides" ? " active" : ""}"
            role="menuitem"
            data-polygon-mode="sides"
        >
            By Sides
        </button>

        <button
            type="button"
            class="drawing-coordinate-submenu-item${currentMode === "centre" ? " active" : ""}"
            role="menuitem"
            data-polygon-mode="centre"
        >
            By Centre
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

    if (
        left +
            menuRect.width >
        window.innerWidth -
            margin
    ) {
        left =
            buttonRect.left -
            menuRect.width -
            gap;
    }

    let top =
        buttonRect.top;

    if (
        top +
            menuRect.height >
        window.innerHeight -
            margin
    ) {
        top =
            Math.max(
                margin,
                window.innerHeight -
                    menuRect.height -
                    margin
            );
    }

    menu.style.left =
        `${Math.max(margin, left)}px`;

    menu.style.top =
        `${top}px`;

    button.setAttribute(
        "aria-expanded",
        "true"
    );

    menu.querySelectorAll(
        "[data-polygon-mode]"
    ).forEach(
        item => {
            item.addEventListener(
                "click",
                () => {
                    closeCoordinateSystemMenu();

                    activatePolygonMode(
                        item.dataset.polygonMode
                    );
                }
            );
        }
    );

    editorState.coordinateSystemMenu =
        menu;

    editorState.coordinateSystemMenuAnchor =
        button;
}

export const ARC_CREATION_MODES = [
    { id: "centrepoint", label: "Centrepoint Arc" },
    { id: "three-point", label: "3-Point Arc" }
];

export function activateArcMode(toolId, mode) {
    armCreationMode(toolId, "arcMode", mode);
}

/*
 * CHOOSING A CONSTRUCTION METHOD ARMS THE TOOL IN THAT METHOD.
 *
 * The creation pipeline reads the method from the interaction
 * (`interaction.arcMode`, `interaction.polygonMode`), and arming a tool
 * clears the interaction first - so the method has to be written AFTER
 * the tool is armed or the reset would wipe it. `activateTool` lives in
 * `tool-activation.js`, which already imports this module; importing it
 * back statically would close a cycle, so it is pulled in lazily.
 *
 * The interaction object is written directly as well, so the method is
 * in place the instant the first press is handled rather than a
 * microtask later.
 */
function armCreationMode(toolId, key, mode) {
    enggDrawingState.setInteraction(
        drawingState,
        {
            [key]: mode
        }
    );

    import("./tool-activation.js").then(
        ({ activateTool }) => {
            activateTool(toolId);

            /*
             * Re-apply after arming: `clearInteraction` resets the
             * method, so the second write is what survives.
             */
            enggDrawingState.setInteraction(
                drawingState,
                {
                    [key]: mode
                }
            );

            renderCurrentDrawing();
        }
    );
}

/*
 * The Polygon menu offers By Centre and By Sides; picking one both
 * records the method and arms the Polygon tool, exactly as the Arc
 * modes do.
 */
function activatePolygonMode(mode) {
    armCreationMode("polygon", "polygonMode", mode);
}

export function openArcMenu(button) {
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

    menu.innerHTML = ARC_CREATION_MODES.map(mode => `
        <button
            type="button"
            class="drawing-coordinate-submenu-item"
            role="menuitem"
            data-arc-mode="${mode.id}"
        >
            ${mode.label}
        </button>
    `).join("");

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

    if (
        left +
            menuRect.width >
        window.innerWidth -
            margin
    ) {
        left =
            buttonRect.left -
            menuRect.width -
            gap;
    }

    let top =
        buttonRect.top;

    if (
        top +
            menuRect.height >
        window.innerHeight -
            margin
    ) {
        top =
            Math.max(
                margin,
                window.innerHeight -
                    menuRect.height -
                    margin
            );
    }

    menu.style.left =
        `${Math.max(margin, left)}px`;

    menu.style.top =
        `${top}px`;

    button.setAttribute(
        "aria-expanded",
        "true"
    );

    menu.querySelectorAll(
        "[data-arc-mode]"
    ).forEach(
        item => {
            item.addEventListener(
                "click",
                () => {
                    const mode =
                        item.dataset
                            .arcMode;

                    closeCoordinateSystemMenu();

                    /*
                     * The tool the MENU BELONGS TO, not a hard-coded
                     * "arc". This handler is shared by both Arc tools,
                     * so hard-coding the id here silently turned a
                     * Reference Arc into an ordinary Arc the moment
                     * the student picked a creation method - the
                     * submenu was the one thing telling them the two
                     * were different, and it would have thrown that
                     * difference away.
                     */
                    const tool = button?.getAttribute?.("data-tool-id");

                    activateArcMode(tool, mode);
                }
            );
        }
    );

    editorState.coordinateSystemMenu =
        menu;

    editorState.coordinateSystemMenuAnchor =
        button;
}

/*
 * Shared submenu component.
 *
 * Every tool that has options opens the same popup: the
 * same element, classes, positioning, keyboard and
 * click-outside behaviour. Callers only supply the items.
 *
 * Each item is { id, label }, and the chosen id is passed
 * to the onSelect callback.
 */
export function openToolSubmenu(
    button,
    items,
    onSelect
) {
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

    menu.innerHTML =
        items
            .map(
                item => `
                    <button
                        type="button"
                        class="drawing-coordinate-submenu-item"
                        role="menuitem"
                        data-submenu-id="${item.id}"
                    >
                        ${item.label}
                    </button>
                `
            )
            .join("");

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

                    const id =
                        option.dataset
                            .submenuId;

                    closeCoordinateSystemMenu();

                    onSelect(id);
                }
            );
        }
    );

    editorState.coordinateSystemMenu =
        menu;

    editorState.coordinateSystemMenuAnchor =
        button;
}

/*
 * The six Statics creation categories and their tools.
 * Each parent opens a submenu; the child is the tool that
 * actually starts a drawing operation.
 */
/*
 * ========================================================
 * THE ARC TOOLS
 * ========================================================
 *
 * Geometry → Arc and Statics → Reference Arc are ONE arc
 * implementation. Every place the code asked "is the active tool
 * 'arc'?" now asks this instead, so the two cannot drift apart:
 * the construction modes, the snapping, the preview, the commit,
 * editing, movement, the Features panel, the renderer and undo all
 * come from the same code for both.
 *
 * What differs is only what the finished feature IS. A Reference Arc
 * is construction geometry - drawn in the construction line type and
 * named for its statics role - where a Geometry Arc is final
 * geometry. That is decided once, at commit, by
 * isReferenceArcTool().
 */

/*
 * The tools whose construction is the arc's.
 *
 * The Reference Arc is registered as an ARC child, exactly as the
 * Reference Line is registered as a LINE child, so it arrives here
 * with the whole arc interaction already attached to it. Its own id
 * is never tested directly - asking "is this one of the arc tools?"
 * means a future arc variant would work without being listed.
 */
const ARC_TOOLS = new Set([
    "arc",
    "reference-arc"
]);

/*
 * THE OPTIONS FOR A COMMITTED ARC.
 *
 * Both arc modes - centre/start/end and three-point - commit through
 * here, so a Reference Arc is made the same way whichever way it was
 * drawn. A tool that honoured the reference state in one mode and not
 * the other would be a trap: the same tool producing a construction
 * arc one way and a final arc the other.
 *
 * For an ordinary Arc this is just the sheet's current style, which is
 * what it always was. For a Reference Arc it adds two things:
 *
 *   - the CONSTRUCTION line type, so it is drawn as reference
 *     geometry and reads as belonging to the construction rather than
 *     to the final drawing. It is a default, not a rule: the Features
 *     panel can change any line type afterwards, exactly as it can for
 *     a Reference Line.
 *   - a NAME that says what it is, so the Feature Tree shows
 *     "Reference Arc" rather than a row of anonymous arcs.
 *
 * The underlying geometry is untouched. It is a real arc, drawn by
 * the ordinary arc renderer, snapping and contributing snap targets
 * like any other - it simply says what it is for.
 */
export function referenceArcOptions() {
    const isReference =
        isReferenceArcTool();

    return {
        style: {
            ...drawingState.styleDefaults,

            lineType: isReference
                ? "construction"
                : drawingState.styleDefaults.lineType
        },

        engineering: {
            ...currentEngineeringMetadata(),

            /*
             * The statics role, so the feature stays identifiable as
             * a reference after it has been edited, moved and saved.
             */
            staticsType: isReference
                ? "reference-arc"
                : undefined
        },

        name: isReference
            ? "Reference Arc"
            : undefined
    };
}

export function isArcTool(toolId) {
    return ARC_TOOLS.has(
        toolId ?? drawingState.activeTool
    );
}

/*
 * Whether the active tool builds a REFERENCE arc rather than a
 * final one.
 *
 * Read at commit and at edit, because a feature's nature is fixed
 * when it is made and must survive being moved and changed
 * afterwards.
 */
function isReferenceArcTool(toolId) {
    return (
        toolId ?? drawingState.activeTool
    ) === "reference-arc";
}
