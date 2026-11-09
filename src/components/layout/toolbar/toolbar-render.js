/*
 * Rendering the tool list for a toolbar category, and the status message.
 */

import { disciplineToolGroups, drawingToolGroups, engineeringTools } from "./tools.js";
import { ANALYSIS_DIAGRAM_TOOLS, STATICS_ANALYSIS_TOOLS, runStaticsAnalysis } from "../../../features/workspace/statics/analysis-tools.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { drawingToolMessage, toolHeading, toolList } from "../../../features/workspace/dom.js";
import { drawingState } from "../../../features/workspace/editor-state.js";
import { renderProperties } from "../panels/feature-panel.js";
import { STATICS_TOOL_MENUS, openAnalysisModeMenu, openStaticsMenu } from "../../../features/workspace/statics/statics-tools.js";
import { DYNAMICS_TOOL_MENUS } from "../../../features/workspace/dynamics/dynamics-tools.js";
import { activateTool } from "./tool-activation.js";
import { FLUIDS_TOOL_MENUS } from "../../../features/workspace/model/fluids/fluids-tools.js";
import { ARC_CREATION_MODES, POLYGON_CREATION_MODES, activateArcMode, activatePolygonMode, activeCategory, openArcMenu, openPolygonMenu, openToolSubmenu, renderToolButton, toolDefinitionForLabel } from "./tool-menus.js";
import { MATH_REFERENCE_TOOLS as MATH_REFERENCE_TOOL_IDS, MATH_TOOL_GROUPS, MATH_MODE_LABELS, MATH_MODES, activeMathMode, armMathTool, mathToolHasModes } from "../../../features/workspace/math/math-tools.js";

// Keep inline sections open independently across toolbar redraws.
const expandedToolbarSections = {
    body: false,
    load: false,
    support: false,
    connection: false,
    "dynamics-bodies": false,
    "dynamics-kinematics": false,
    "dynamics-mechanical": false,

    /*
     * THE DIAGRAMS ARE NOT INLINE SECTIONS.
     *
     * `shear-force-diagram` used to be listed here, which made its Sketch and
     * Plot buttons expand UNDER it inside the sidebar. They are a popup now, so
     * the key is gone - a key here would wrap the button in an inline
     * subsection that nothing ever fills.
     */
    "reference-arc": false,
    arc: false,
    polygon: false,
    "coordinate-system": false,
    "piston-cylinder": false,
    "process-diagrams": false,
    "heat-transfer": false,
    work: false,

    /*
     * THE FLUIDS GROUPS expand IN PLACE, exactly as Bodies or Loads does -
     * the tools open under the heading, inside the sidebar, with no popup. They
     * are listed here in the same table as the Statics sections because that
     * table IS the inline mechanism: a key here is what makes
     * `renderToolbarTool` wrap the button with a `.drawing-inline-tools`
     * subsection and what makes the click handler toggle it.
     */
    "fluids-flow-paths": false,
    "fluids-flow-indicators": false,
    "steady-state-devices": false,
    "thermodynamic-cycles": false
};

function renderToolGroup(group) {
    /*
     * A SECTION IS A HEADING OVER ITS TOOLS.
     *
     * Selection, Create, Analysis and Reference are all the same shape - the
     * heading, then the tools - which is what lets Fluids read like Statics. A
     * group entry (Flow Paths, Flow Indicators) is drawn by the same button
     * renderer as everything else and expands inline underneath itself; it is
     * listed in its proper place among the direct tools, so the order the
     * registry declares is the order the student sees.
     */
    const body = group.tools.map(renderToolbarTool).join("");

    return `
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

            ${body}
        </section>
    `;
}

/*
 * OPEN SKETCH OR PLOT FOR A MATH TOOL.
 *
 * Sketch and Plot are two approaches to ONE tool, so the first press asks which
 * and the tool is armed from HERE rather than from the toolbar click: arming on
 * the press and then stopping would leave a tool active, waiting on a choice
 * the student has not been shown.
 *
 * The list is the ordinary submenu, so the positioning, the click-outside
 * dismissal and the keyboard handling are the ones every other submenu already
 * has - and the armed mode is marked, so a student reopening it can see which
 * one is running.
 */
function openMathModeMenu(button, toolId) {
    const active = drawingState.activeTool === toolId ? activeMathMode() : null;

    openToolSubmenu(
        button,
        MATH_MODES.map(mode => ({
            id: mode,
            label: MATH_MODE_LABELS[mode] || mode,
            state: active === mode ? "Active" : null
        })),
        mode => {
            armMathTool(toolId, mode);
        }
    );
}

function renderToolbarTool(tool) {
    /*
     * A MATH TOOL WITH MODES IS ONE BUTTON THAT OPENS A POPUP.
     *
     * Sketch and Plot are two approaches to ONE tool, so the tool's button is
     * the tool and the two modes are offered in a POPUP beside it - exactly the
     * presentation the Statics diagrams use, and the same submenu machinery
     * (positioning, click-outside dismissal, keyboard handling).
     *
     * A POPUP, NOT AN INLINE LIST. The two are different things in this
     * toolbar: an inline list expands IN PLACE under its button and stays open
     * (the Arc and Polygon method lists, the Statics feature groups), while a
     * popup opens beside the button, is dismissed by a press anywhere else, and
     * is the shape a tool uses when its children are a CHOICE rather than a
     * set of commands. Sketch and Plot are a choice, so they are a popup.
     *
     * The armed mode is the one that stays lit, read from the interaction, so
     * the button and the running tool cannot disagree.
     */
    if (mathToolHasModes(tool.id)) {
        return renderToolButton({
            ...tool,
            submenu: true,
            childToolIds: MATH_MODES.map((mode) => `${tool.id}:${mode}`)
        });
    }

    /*
     * THE MATH SECTION'S REFERENCE TOOLS ARE LISTED DIRECTLY.
     *
     * Coordinate System, Reference Point and Reference Line are ordinary
     * commands under the Reference heading - not expandable groups. The
     * Coordinate System's 2D/3D choice is a Statics submenu, and offering it
     * here would put a second level under a heading the specification says has
     * none. The tool arms the 2D system directly, which is the only one the 2D
     * canvas can draw.
     */
    if (MATH_REFERENCE_TOOL_IDS.includes(tool.id)) {
        return renderToolButton(tool);
    }

    if (!Object.hasOwn(expandedToolbarSections, tool.id) && !tool.collapsible) {
        return renderToolButton(tool);
    }

    const expanded = expandedToolbarSections[tool.id];
    const sectionId = tool.id.startsWith("dynamics-")
        ? `${tool.id}-tools`
        : `statics-${tool.id}-tools`;
    /*
     * THE HEADER BUTTON DESCRIBES THE SUBSECTION IT OPENS.
     *
     * It is not a menu, so `aria-haspopup` goes; and it gets `aria-expanded`
     * and `aria-controls` from the state the section is actually drawn in, so
     * the button and the section beneath it agree on the FIRST frame and on
     * every redraw.
     */
    const button = renderToolButton({
        ...tool,
        submenu: true,
        inlineSection: { id: sectionId, expanded },
        childToolIds: DYNAMICS_TOOL_MENUS[tool.id]?.map(({ id }) => id)
    }).replace(' aria-haspopup="menu"', '');

    const children = DYNAMICS_TOOL_MENUS[tool.id]
        ? DYNAMICS_TOOL_MENUS[tool.id].map(item => renderToolButton({
              id: item.tool || item.id,
              label: item.label,
              state: item.state
          })).join("")
        : FLUIDS_TOOL_MENUS[tool.id]
        ? FLUIDS_TOOL_MENUS[tool.id].map(renderToolButton).join("")
        : tool.id === "coordinate-system"
        ? [
            { id: "coordinate-system-2d", label: "2D Coordinate System", iconLabel: "Coordinate System" },
            { id: "coordinate-system-3d", label: "3D Coordinate System", iconLabel: "Coordinate System" }
        ].map(renderToolButton).join("")
        : tool.id === "thermodynamic-cycles"
        ? [
            { id: "rankine-cycle", label: "Rankine Cycle" },
            { id: "reheat-rankine-cycle", label: "Ideal Reheat Rankine Cycle" },
            { id: "brayton-cycle", label: "Brayton Cycle" },
            { id: "otto-cycle", label: "Otto Cycle" },
            { id: "diesel-cycle", label: "Diesel Cycle" },
            { id: "carnot-cycle", label: "Carnot Cycle" },
            { id: "vapor-compression-cycle", label: "Ideal Vapor-Compression Refrigeration Cycle" }
        ].map(cycle => renderToolButton({ ...cycle, disabled: !["rankine-cycle", "reheat-rankine-cycle", "vapor-compression-cycle", "brayton-cycle", "diesel-cycle", "otto-cycle", "carnot-cycle"].includes(cycle.id) }).replace(/<span class="drawing-tool-icon"[^>]*>[\s\S]*?<\/span>/, "")).join("")
        : tool.id === "steady-state-devices"
        ? [
            { id: "turbine-compressor", label: "Turbine / Compressor" },
            { id: "pipe-duct", label: "Pipe / Duct", iconLabel: "Pipe / Duct" },
            { id: "nozzle-diffuser", label: "Nozzle / Diffuser" }
        ].map(renderToolButton).join("")
        : tool.id === "work"
        ? [
            { id: "work-arrow", label: "Work Arrow", iconLabel: "Work" },
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
        : tool.id === "arc"
        ? ARC_CREATION_MODES.map(mode => {
            const active = drawingState.activeTool === "arc" && drawingState.interaction.arcMode === mode.id;
            return `<button type="button" class="drawing-tool${active ? " active" : ""}" data-arc-mode="${mode.id}">${mode.label}</button>`;
        }).join("")
        : tool.id === "polygon"
        ? POLYGON_CREATION_MODES.map(mode => {
            const active = drawingState.activeTool === "polygon" && (drawingState.interaction.polygonMode || "sides") === mode.id;
            return `<button type="button" class="drawing-tool${active ? " active" : ""}" data-polygon-mode="${mode.id}">${mode.label}</button>`;
        }).join("")
        : tool.id === "reference-arc"
        ? ARC_CREATION_MODES.map(mode => {
            const active = drawingState.activeTool === "reference-arc" && drawingState.interaction.arcMode === mode.id;
            return `<button type="button" class="drawing-tool${active ? " active" : ""}" data-reference-arc-mode="${mode.id}">${mode.label}</button>`;
        }).join("")
        : (STATICS_TOOL_MENUS[tool.id] || FLUIDS_TOOL_MENUS[tool.id] || []).map(renderToolButton).join("");

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
        safeCategory === "MATH / ANALYSIS" ||
        disciplineToolGroups[safeCategory]
    ) {
        /*
         * GEOMETRY, STATICS and MATH / ANALYSIS are organised into labelled
         * sections; every other discipline stays a flat list of tools.
         *
         * MATH / ANALYSIS IS THE SAME SHAPE AS STATICS: Select, then the
         * category headings with their tools listed directly underneath. It
         * is a table of its own (`MATH_TOOL_GROUPS`) rather than a branch in
         * this file, so the section's organisation is stated where its tools
         * are.
         */
        const groups =
            safeCategory === "GEOMETRY"
                ? drawingToolGroups
                : safeCategory === "MATH / ANALYSIS"
                  ? MATH_TOOL_GROUPS
                  : disciplineToolGroups[safeCategory];

        toolList.innerHTML =
            groups
                .map(renderToolGroup)
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

                        /*
                         * A MATH TOOL WITH MODES OPENS ITS SKETCH / PLOT POPUP.
                         *
                         * The tool is not armed by this press: arming it and
                         * then stopping would leave a tool running that is
                         * waiting on a choice the student has not been shown.
                         * The popup arms it, through the Math section's own
                         * arming function, so the toolbar and the tool cannot
                         * disagree about which mode is running.
                         */
                        if (mathToolHasModes(toolId)) {
                            event.preventDefault();
                            event.stopPropagation();

                            openMathModeMenu(button, toolId);
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

                        /*
                         * A Geometry Arc or Polygon method, from its inline
                         * list. The method is written after the tool is armed
                         * (see armCreationMode), so the list is redrawn once it
                         * is - otherwise the highlight shows the previous method.
                         */
                        if (button.dataset.arcMode) {
                            event.preventDefault();
                            activateArcMode("arc", button.dataset.arcMode)
                                .then(() => renderEngineeringTools(activeCategory()));
                            return;
                        }

                        if (button.dataset.polygonMode) {
                            event.preventDefault();
                            activatePolygonMode(button.dataset.polygonMode)
                                .then(() => renderEngineeringTools(activeCategory()));
                            return;
                        }

                        /*
                         * A MATH REFERENCE TOOL IS A COMMAND, NOT A GROUP.
                         *
                         * It is listed directly under the Reference heading,
                         * so a press arms it - it must not be read as a press
                         * on an expandable section, which is what the table
                         * below would otherwise do for the Coordinate System.
                         */
                        if (MATH_REFERENCE_TOOL_IDS.includes(toolId)) {
                            event.preventDefault();
                            event.stopPropagation();

                            activateTool(toolId);
                            return;
                        }

                        if (Object.hasOwn(expandedToolbarSections, toolId)) {
                            event.preventDefault();
                            event.stopPropagation();
                            const expanded = !expandedToolbarSections[toolId];
                            expandedToolbarSections[toolId] = expanded;
                            button.setAttribute("aria-expanded", String(expanded));
                            const sectionId = toolId.startsWith("dynamics-")
                                ? `${toolId}-tools`
                                : `statics-${toolId}-tools`;
                            toolList.querySelector(`#${sectionId}`).hidden = !expanded;
                            return;
                        }

                        if (
                            toolId ===
                            "coordinate-system-3d"
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            setToolMessage("3D Coordinate System is not available on the 2D drawing canvas");

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
