/*
 * Rendering the tool list for a toolbar category, and the status message.
 */

import { disciplineToolGroups, drawingToolGroups, engineeringTools } from "./tools.js";
import { ANALYSIS_DIAGRAM_MODES, ANALYSIS_DIAGRAM_MODE_LABELS, ANALYSIS_DIAGRAM_TOOLS, STATICS_ANALYSIS_TOOLS, runStaticsAnalysis } from "../../../features/workspace/statics/analysis-tools.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { drawingToolMessage, toolHeading, toolList } from "../../../features/workspace/dom.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { STATICS_TOOL_MENUS, activateAnalysisMode, activateCoordinateMode, openAnalysisModeMenu, openCoordinateSystemMenu, openStaticsMenu } from "../../../features/workspace/statics/statics-tools.js";
import { DYNAMICS_TOOL_MENUS, openDynamicsMenu } from "../../../features/workspace/dynamics/dynamics-tools.js";
import { activateTool } from "./tool-activation.js";
import { ARC_CREATION_MODES, activateArcMode, activeCategory, openArcMenu, openPolygonMenu, renderToolButton, toolDefinitionForLabel } from "./tool-menus.js";

// Keep inline sections open independently across toolbar redraws.
const expandedToolbarSections = {
    body: false,
    load: false,
    support: false,
    connection: false,
    "reference-arc": false,
    "piston-cylinder": false,
    "process-diagrams": false,
    "heat-transfer": false,
    work: false,

    /*
     * STATICS EXPANDS INLINE, NOT IN A FLYOUT. The Coordinate System's 2D / 3D
     * choice and each diagram's Sketch / Plot choice open beneath their button
     * like Bodies and Loads do. Only in Statics: the Coordinate System button is
     * shared with Geometry, which keeps its own menu.
     */
    "coordinate-system": false,
    "shear-force-diagram": false,
    "bending-moment-diagram": false,
    "axial-force-diagram": false
};

const STATICS_ONLY_INLINE = new Set([
    "coordinate-system",
    "shear-force-diagram",
    "bending-moment-diagram",
    "axial-force-diagram"
]);

function expandsInline(toolId) {
    return (
        Object.hasOwn(expandedToolbarSections, toolId) &&
        (!STATICS_ONLY_INLINE.has(toolId) || activeCategory() === "STATICS")
    );
}

/*
 * ONE OPTION, ONE HIGHLIGHT. Sketch and Plot are the same tool underneath, so
 * the button renderer - which highlights by tool - lit both of them at once.
 * An option's own state decides instead.
 */
function optionButton(markup, active) {
    return markup
        .replace(/class="drawing-tool( active)?"/, `class="drawing-tool${active ? " active" : ""}"`)
        .replace(/aria-pressed="(true|false)"/, `aria-pressed="${active}"`);
}

function renderToolbarTool(tool) {
    if (!expandsInline(tool.id)) {
        return renderToolButton(tool);
    }

    const expanded = expandedToolbarSections[tool.id];
    const sectionId = `statics-${tool.id}-tools`;
    const button = renderToolButton(tool)
        .replace(' aria-haspopup="menu"', '')
        .replace('aria-expanded="false"', `aria-expanded="${expanded}" aria-controls="${sectionId}"`);

    /*
     * A DIAGRAM'S SKETCH / PLOT CHOICE, as tool buttons beneath it - the same
     * mode the flyout used to ask for, chosen in place.
     */
    const children = ANALYSIS_DIAGRAM_TOOLS[tool.id]
        ? ANALYSIS_DIAGRAM_MODES.map(mode =>
            optionButton(
                renderToolButton({ id: tool.id, label: ANALYSIS_DIAGRAM_MODE_LABELS[mode] || mode })
                    .replace('data-tool-id=', `data-analysis-diagram-mode="${mode}" data-tool-id=`),
                drawingState.activeTool === tool.id && drawingState.interaction.analysisMode === mode
            )
        ).join("")
        : tool.id === "work"
        ? [
            { id: "electric-work", label: "Electric Work" },
            { id: "mechanical-work", label: "Mechanical Work" }
        ].map(renderToolButton).join("")
        : tool.id === "heat-transfer"
        ? [
            { id: "heat-entering", label: "Heat Entering" },
            { id: "heat-leaving", label: "Heat Leaving" }
        ].map(renderToolButton).join("")
        : tool.id === "process-diagrams"
        ? [
            { id: "process-plot", label: "Process Plot" },
            { id: "saturation-curve", label: "Saturation Curve" },
            { id: "process-path", label: "Process Path" },
            { id: "constant-temp-pressure-lines", label: "Const Temp/Pressure Lines" }
        ].map(renderToolButton).join("")
        : tool.id === "piston-cylinder"
        ? [
            { id: "piston-cylinder", label: "Without Stoppers", iconLabel: "Piston Cylinder" },
            { id: "piston-cylinder-stoppers", label: "With Stoppers", iconLabel: "Piston Cylinder With Stoppers" }
        ].map(option => renderToolButton(option).replace('data-tool-id=', 'data-piston-cylinder-option="true" data-tool-id=')).join("")
        : tool.id === "coordinate-system"
        ? [
            { mode: "2d", label: "2D Coordinate System" },
            { mode: "3d", label: "3D Coordinate System" }
        ].map(option => {
            const active = option.mode === "2d" && drawingState.activeTool === "coordinate-system-2d";
            return `<button type="button" class="drawing-tool${active ? " active" : ""}" aria-pressed="${active}" data-coordinate-mode="${option.mode}">${option.label}</button>`;
        }).join("")
        : tool.id === "reference-arc"
        ? ARC_CREATION_MODES.map(mode => {
            const active = drawingState.activeTool === "reference-arc" && drawingState.interaction.arcMode === mode.id;
            return `<button type="button" class="drawing-tool${active ? " active" : ""}" data-reference-arc-mode="${mode.id}">${mode.label}</button>`;
        }).join("")
        : STATICS_TOOL_MENUS[tool.id].map(renderToolButton).join("");

    return `${button}
        <div id="${sectionId}" class="drawing-inline-tools"${expanded ? "" : " hidden"}>
            ${children}
        </div>`;
}

export function renderEngineeringTools(
    category
) {
    const safeCategory =
        engineeringTools[category]
            ? category
            : "GEOMETRY";

    toolHeading.textContent =
        `${safeCategory} TOOLS`;

    if (
        safeCategory ===
            "GEOMETRY" ||
        disciplineToolGroups[safeCategory]
    ) {
        /*
         * GEOMETRY and STATICS are organised into labelled
         * sections; every other discipline stays a flat
         * list of tools.
         */
        const groups =
            safeCategory === "GEOMETRY"
                ? drawingToolGroups
                : disciplineToolGroups[safeCategory];

        toolList.innerHTML =
            groups
                .map(
                    group => `
                        <section
                            class="drawing-tool-group"
                            aria-labelledby="drawing-group-${group.id}"
                        >
                            <h3
                                class="drawing-tool-group-label"
                                id="drawing-group-${group.id}"
                            >
                                ${group.label}
                            </h3>

                            ${group.tools
                                .map(
                                    renderToolbarTool
                                )
                                .join("")}
                        </section>
                    `
                )
                .join("");
    } else {
        /*
         * Every discipline section leads with Select, so
         * each one can be left cleanly from the same
         * place. The remaining tools are unchanged.
         */
        const disciplineTools = [
            {
                id: "select",
                label: "Select",
                shortcut: "Esc"
            },

            ...engineeringTools[
                safeCategory
            ].map(
                label =>
                    toolDefinitionForLabel(
                        label
                    )
            )
        ];

        toolList.innerHTML =
            disciplineTools
                .map(
                    renderToolbarTool
                )
                .join("");
    }

    toolList
        .querySelectorAll(
            ".drawing-tool"
        )
        .forEach(
            button => {
                button.addEventListener(
                    "click",
                    event => {
                        const toolId =
                            button.dataset
                                .toolId;

                        if (button.dataset.analysisDiagramMode) {
                            event.preventDefault();
                            event.stopPropagation();
                            activateAnalysisMode(toolId, button.dataset.analysisDiagramMode);
                            return;
                        }

                        if (button.dataset.pistonCylinderOption) {
                            event.preventDefault();
                            event.stopPropagation();
                            activateTool(toolId);
                            return;
                        }

                        if (button.dataset.referenceArcMode) {
                            event.preventDefault();
                            activateArcMode("reference-arc", button.dataset.referenceArcMode);
                            return;
                        }

                        if (button.dataset.coordinateMode) {
                            event.preventDefault();
                            event.stopPropagation();
                            activateCoordinateMode(button.dataset.coordinateMode);
                            return;
                        }

                        if (expandsInline(toolId)) {
                            event.preventDefault();
                            event.stopPropagation();
                            const expanded = !expandedToolbarSections[toolId];
                            expandedToolbarSections[toolId] = expanded;
                            button.setAttribute("aria-expanded", String(expanded));
                            toolList.querySelector(`#statics-${toolId}-tools`).hidden = !expanded;
                            return;
                        }

                        if (
                            toolId ===
                            "coordinate-system"
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            openCoordinateSystemMenu(
                                button
                            );

                            return;
                        }

                        if (
                            toolId ===
                            "polygon"
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            openPolygonMenu(
                                button
                            );

                            return;
                        }

                        /*
                         * A Statics category opens its submenu
                         * and does not itself start a drawing
                         * operation; the child item does that.
                         */
                        if (
                            STATICS_TOOL_MENUS[
                                toolId
                            ]
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            openStaticsMenu(
                                button,
                                toolId
                            );

                            return;
                        }

                        /*
                         * A DYNAMICS FAMILY OPENS ITS SUBMENU, exactly as a
                         * Statics one does. Without this branch the family
                         * button fell through to `activateTool`, which armed
                         * nothing: the Bodies, Kinematics and Mechanical
                         * Elements entries looked like tools but opened no
                         * menu, so no Dynamics tool could be reached from the
                         * toolbar at all. The injected `onActivate` is the
                         * module's own decoupling - see `openDynamicsMenu`.
                         */
                        if (DYNAMICS_TOOL_MENUS[toolId]) {
                            event.preventDefault();
                            event.stopPropagation();

                            openDynamicsMenu(button, toolId, {
                                onActivate: childId => activateTool(childId)
                            });

                            return;
                        }

                        if (
                            STATICS_ANALYSIS_TOOLS.includes(
                                toolId
                            )
                        ) {
                            event.preventDefault();

                            /*
                             * THE THREE DIAGRAMS ASK A SECOND QUESTION.
                             *
                             * Resultant and Force Components are CHILD
                             * analysis features: they read explicit Force
                             * feature(s) and derive everything from those, so
                             * they ARM as a tool and enter an INPUT-SELECTION
                             * state - "Select force" / "Select force(s)" - in
                             * which the student clicks the force(s) they mean
                             * and commits with Enter. Nothing is read from a
                             * previous selection or inferred from the cursor.
                             *
                             * A diagram is a thing to be placed and takes the
                             * ordinary body-then-click placement, so it is
                             * armed too - but only once Sketch or Plot has
                             * been chosen, which is what openAnalysisModeMenu
                             * does.
                             */
                            const isTemplate =
                                Boolean(
                                    ANALYSIS_DIAGRAM_TOOLS[
                                        toolId
                                    ]
                                );

                            if (isTemplate) {
                                openAnalysisModeMenu(
                                    button,
                                    { id: toolId }
                                );

                                return;
                            }

                            /*
                             * THE TOOL ARMS ITSELF. `runStaticsAnalysis` calls
                             * `beginAnalysisInput`, which sets the active tool,
                             * clears the selection and enters the input state -
                             * so no `setActiveTool("select")` is imposed here,
                             * which would fight the very arming the tool needs.
                             */
                            runStaticsAnalysis(
                                toolId
                            );

                            renderEngineeringTools(
                                activeCategory()
                            );

                            renderProperties();
                            renderCurrentDrawing();
                            return;
                        }

                        /*
                         * THE ARC TOOLS SHARE ONE SUBMENU.
                         *
                         * Reference Arc is an Arc child: same
                         * geometry engine, same interaction, same
                         * panel. What differs is only that the result
                         * is construction geometry, so the CHOICE of
                         * creation method offered here must be the
                         * choice Arc offers - not Arc's menu with a
                         * reduced copy, and not Arc's menu only.
                         *
                         * Routing both through one function is what
                         * keeps them from drifting apart: a mode added
                         * to the Arc menu appears on the Reference Arc
                         * menu because there is only one list.
                         */
                        if (
                            toolId ===
                                "arc" ||
                            toolId ===
                                "reference-arc"
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            openArcMenu(
                                button
                            );

                            return;
                        }

                        activateTool(
                            toolId
                        );
                    }
                );
            }
        );
}

export function setToolMessage(
    message
) {
    drawingToolMessage.textContent =
        message;
}
