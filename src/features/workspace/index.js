/*
 * THE DRAWING EDITOR.
 *
 * This module starts the editor: it installs each part's page wiring, in
 * order, and then renders the first sheet.
 *
 * The parts live in folders by what they do - interaction/, toolbar/,
 * workspace/, panels/, commands/ - and the engineering tools by category:
 * geometry/, annotate/, statics/ (docs/ARCHITECTURE.md has the overview).
 * They are listed here in READING order:
 *
 *   dom.js                               The editor's DOM elements, looked up once.
 *   editor-state.js                      The editor's state: the document model, and the UI state shared between editor modules.
 *   workspace/sheet-controller.js        Sheets as the editor sees them: switching, creating, renaming, reordering, deleting, and the references other parts of the app hold to them.
 *   constants.js                         Constants and defaults shared across the editor.
 *   toolbar/tool-menus.js                The tool list and its submenus: polygon sides, arc modes.
 *   statics/statics-tools.js             Statics tool definitions: which tools attach to a body, how many points each takes, how each is placed, and their instructions.
 *   statics/analysis-tools.js            Analysis tools: resultant, force components, and the SFD/BMD/AFD diagram frames.
 *   toolbar/toolbar-render.js            Rendering the tool list for a toolbar category, and the status message.
 *   geometry/creation-sizing.js          Creation-time sizing: the popup that asks for a new feature's length, radius or size.
 *   toolbar/tool-activation.js           Activating a tool, undo/redo, and turning pointer events into drawing coordinates.
 *   annotate/annotation-tool.js          The annotation and note tools.
 *   annotate/dimension-tool.js           The Dimension tool: choosing and committing a measurement.
 *   annotate/dimension-inference.js      Working out what a dimension click refers to, and which measurement it implies.
 *   annotate/dimension-placement.js      Placing a dimension: reference selection and the placement click.
 *   toolbar/construction-tools.js        Which tools construct geometry, and when a click selects an existing feature instead.
 *   statics/truss-tool.js                Building a truss member by member.
 *   statics/load-tool.js                 Placing distributed loads: choosing the body, the span, the magnitude and the direction.
 *   statics/statics-creation.js          Creating a Statics feature from a completed placement.
 *   interaction/pointer.js               Resolving the pointer: snapping, inference, and the status feedback.
 *   geometry/construction-geometry.js    Geometry used while constructing: rectangles, circumcircles, angles and arcs.
 *   geometry/preview.js                  The live preview while a tool is in use.
 *   geometry/geometry-creation.js        Completing geometry: polygons, points, and coordinate systems.
 *   workspace/canvas-render.js           Drawing the editor's canvas.
 *   interaction/hit-testing.js           Hit-testing: which feature is under the pointer.
 *   interaction/box-selection.js         Box selection: which features a selection rectangle touches.
 *   panels/feature-tree.js               The Features panel's tree of components, and the analysis editors it opens.
 *   panels/feature-panel.js              Rendering the Features panel for the current selection.
 *   geometry/triangle-panel.js           The triangle's panel: sides and angles.
 *   panels/appearance-panel.js           The appearance section of a feature's panel.
 *   statics/truss-optimizer.js           Truss optimisation: evening out member triangles while keeping the structure.
 *   panels/relative-coordinates.js       Coordinates relative to a parent feature.
 *   statics/statics-panel.js             The Statics sections of a feature's panel: vectors, annotations, supports and loads.
 *   panels/feature-panel-markup.js       A feature's panel markup.
 *   panels/property-inputs.js            Numeric inputs and rigid-body shape edits.
 *   panels/property-binding.js           Wiring a feature panel's controls to the feature.
 *   geometry/triangle-editing.js         Solving a triangle from edited sides and angles.
 *   panels/property-update.js            Applying an edited property to a feature.
 *   panels/style-controls.js             The toolbar's thickness, colour and line-type controls.
 *   interaction/canvas-click.js          What a click on the canvas does.
 *   interaction/handles.js               Manipulation handles: which grips a feature has, and which one is under the pointer.
 *   interaction/drag.js                  Dragging a feature or one of its handles.
 *   statics/statics-attachment.js        Attaching Statics features to bodies, and keeping them attached as bodies move.
 *   interaction/selection.js             Selection, cancelling, and finishing a construction.
 *   commands/modify-tools.js             The Modify tools: Move, Rotate, Mirror, Trim and Extend.
 *   interaction/context-menu.js          The right-click menu on a feature.
 *   commands/clipboard-commands.js       Copy, cut, paste and duplicate.
 *   geometry/transforms.js               Geometric transforms: mirror, rotate, trim, extend, translate.
 *   workspace/viewport.js                The viewport: fit, zoom, and workspace settings.
 *   panels/colour-picker.js              The colour picker.
 *   commands/delete-command.js           Deleting the selection, with its dependants.
 *   workspace/workspace-controls.js      The workspace buttons: back, grid, snap, display toggles, undo/redo, and the Modify/View tools.
 *   commands/document-commands.js        New, Open, Save, Save As, Print and export, and crash recovery.
 *   toolbar/toolbar-wiring.js            Wiring the file, style and zoom controls.
 *   workspace/workspace-layout.js        The zoom box and the collapsible side panels.
 *   interaction/canvas-events.js         Pointer events on the canvas, and closing menus on outside clicks.
 *   interaction/keyboard-shortcuts.js    Keyboard shortcuts.
 *
 * Shared state lives in editor-state.js; DOM lookups in dom.js. Each part that
 * wires itself to the page exports an install function, called below.
 */

import { renderCurrentDrawing } from "../../components/layout/workspace/canvas-render.js";
import { offerRecoveryIfAvailable } from "./commands/document-commands.js";
import { renderProperties } from "../../components/layout/panels/feature-panel.js";
import { activeSheet, loadSheetIntoEditor, refreshSheetTabs, syncWorkspaceSettingToggles } from "../../components/layout/workspace/sheet-controller.js";
import { renderEngineeringTools } from "../../components/layout/toolbar/toolbar-render.js";

import { installSheetController } from "../../components/layout/workspace/sheet-controller.js";
import { installContextMenu } from "./interaction/context-menu.js";
import { installWorkspaceControls } from "../../components/layout/workspace/workspace-controls.js";
import { installDocumentCommands } from "./commands/document-commands.js";
import { refreshDocumentHeader } from "./commands/document-commands.js";
import { installDrawOrderControls } from "./commands/draw-order.js";
import { installToolbarWiring } from "../../components/layout/toolbar/toolbar-wiring.js";
import { installWorkspaceLayout } from "../../components/layout/workspace/workspace-layout.js";
import { installDrawingPanel } from "../../components/layout/panels/drawing-panel.js";
import { installCanvasEvents } from "./interaction/canvas-events.js";
import { installKeyboardShortcuts } from "./interaction/keyboard-shortcuts.js";
import { editableHandlesFor } from "./interaction/handles.js";
import { setHandleResolver } from "../../shared/rendering/overlay-render.js";

/*
 * TELL THE RENDERER WHICH HANDLES TO DRAW.
 *
 * The overlay renderer must not import the interaction layer - the interaction
 * layer reaches the renderer, so the import would be a cycle, and a cycle here
 * breaks start-up rather than failing politely. Instead the EDITOR supplies the
 * one resolver, which is the same function the hit test uses, so a handle that
 * is drawn and a handle that can be grabbed are the same handle.
 */
setHandleResolver(editableHandlesFor);

export { enggDrawingSheets } from "../../components/layout/workspace/sheet-controller.js";
export { enggDrawing } from "../../components/layout/workspace/sheet-controller.js";
export { renderEngineeringTools } from "../../components/layout/toolbar/toolbar-render.js";
export * as enggTransforms from "./geometry/transforms.js";

installSheetController();
installContextMenu();
installWorkspaceControls();
installDocumentCommands();
installDrawOrderControls();
installToolbarWiring();
installWorkspaceLayout();
installDrawingPanel();
installCanvasEvents();
installKeyboardShortcuts();

renderEngineeringTools(
    "GEOMETRY"
);

/*
 * The workspace starts on the document's first sheet.
 *
 * The collection is created empty at startup and the sheet bar is
 * rendered from it, so a document that is later opened or recovered
 * replaces this whole set of sheets rather than adding to it.
 */
loadSheetIntoEditor(activeSheet());

syncWorkspaceSettingToggles();

refreshSheetTabs();

renderCurrentDrawing();

renderProperties();

/*
 * Name the document in the header from the very first frame.
 *
 * Nothing has been saved yet, so this puts "Untitled" there rather than leaving
 * an empty slot that fills in only once the user does something.
 */
refreshDocumentHeader();

/*
 * Offer to recover unsaved work from a previous session, once the
 * workspace is up.
 *
 * This is done here, after the first render, for two reasons: the
 * prompt has something to recover INTO, so accepting it shows the
 * recovered drawing rather than a blank canvas that then changes;
 * and it is far enough from page load that the workspace has settled
 * before a dialog interrupts it.
 */
offerRecoveryIfAvailable();
