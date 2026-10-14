/*
 * ============================================================
 * THE COMMANDS THE MENU NEEDS THAT ARE NOT ALREADY A FUNCTION
 * ============================================================
 *
 * Most menu items call a function that already existed - Save, Undo, Cut, Fit.
 * A few needed an operation that existed only INSIDE a click handler on the
 * toolbar: selecting everything, toggling a display setting, and stepping the
 * zoom from somewhere other than the canvas.
 *
 * Each one here is deliberately the SAME operation the toolbar performs, not a
 * second version of it:
 *
 *   selectAllObjects      the same call the Ctrl+A handler makes
 *   toggleDisplaySetting  the same field the toolbar toggle writes, then the
 *                         same synchronisation, so the two cannot disagree
 *   zoomByFactor          the viewport's own zoom, anchored on the canvas centre
 */

import enggDrawingState from "../../core/model/drawing-state.js";
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
import { drawingState } from "../editor-state.js";
import { renderEngineeringTools, setToolMessage } from "./toolbar-render.js";
import { activeCategory } from "./tool-menus.js";
import { activateTool } from "./tool-activation.js";
import { activateGlobalTool as activateGlobalToolImpl } from "../commands/modify-tools.js";
import { applyDrawOrder } from "../commands/draw-order.js";
import enggSettingsDialog from "../../ui/settings-dialog.js";
import { zoomAtCanvasPoint } from "../workspace/viewport.js";
import enggHelpDialog from "../../ui/help-dialog.js";
import { renderProperties } from "../panels/feature-panel.js";
import { syncWorkspaceSettingToggles } from "../workspace/sheet-controller.js";
import { applyTheme, readThemePreference, setThemePreference, resolvedTheme, THEME_VALUES } from "../workspace/theme.js";

/*
 * OPEN A TOOL CATEGORY, THEN ARM ONE OF ITS TOOLS.
 *
 * The Insert menu offers commands that are really Annotate tools - a Table and
 * a Text Box already exist there. Rather than duplicating the tool or building
 * a second creation path, the menu SELECTS the category and ARMS the tool, and
 * from that point the student is in exactly the state they would have reached by
 * clicking Annotate and then the tool.
 *
 * THE CATEGORY BUTTON IS CLICKED, not reimplemented. Switching category has to
 * cancel the previous tool, clear its preview and re-render the tool list in the
 * right order - all of which the button's own handler already does. Calling
 * `renderEngineeringTools` directly here would be a second, quieter version of
 * that sequence, and the two would drift.
 */
export function openCategoryAndArmTool(category, toolId) {
  const button = document.querySelector(
    `.drawing-category[data-category="${category}"]`,
  );

  if (button && !button.classList.contains("active")) {
    button.click();
  }

  /*
   * ARM THE TOOL. `activateTool` is the one entry point every tool button uses,
   * so the tool's instruction, its highlight and its interaction state are set
   * exactly as a toolbar click would set them.
   */
  activateTool(toolId);

  return true;
}

/*
 * TOGGLE A CANVAS SWITCH BY ITS TOOLBAR BUTTON.
 *
 * The grid and snapping are canvas switches: their state lives on
 * `state.grid.visible` and `state.snap.enabled`, and the button's own handler
 * owns the write - including the three fields snap keeps in step and the
 * reference-notification hook.
 *
 * So rather than reimplementing that here, the menu CLICKS THE BUTTON. It is
 * the same act the student would perform, through the same code, and it cannot
 * fall out of step with it - which a second copy of "turn the grid off" would
 * do the first time either changed.
 *
 * The button is not visibly focused by the click, and the menu has already
 * closed by the time this runs, so nothing is left highlighted.
 */
export function toggleWorkspaceSettingById(buttonId) {
  const button = document.getElementById(buttonId);

  if (!button) {
    return false;
  }

  button.click();

  return true;
}

/*
 * SELECT EVERYTHING THAT CAN BE SELECTED.
 *
 * The same two steps the Ctrl+A handler takes - clear any half-built operation
 * first, so a running construction is not left holding the pointer, then select
 * every feature on the ACTIVE sheet.
 *
 * "On the active sheet" is already guaranteed by the model: only one sheet is
 * ever loaded into the editor, so `drawingState.objects` cannot contain a
 * feature belonging to another one. There is nothing to filter out.
 */
export function selectAllObjects() {
    enggDrawingState.clearInteraction(drawingState);

    drawingState.selection.boxSelectionIds = [];
    drawingState.selection.hoveredObjectId = null;

    enggDrawingState.setActiveTool(drawingState, "select");

    enggDrawingState.selectObjects(
        drawingState,
        drawingState.objects.map((object) => object.id)
    );

    setToolMessage("All components selected");

    renderEngineeringTools(activeCategory());
    renderProperties();
    renderCurrentDrawing();

    return true;
}

/*
 * TOGGLE A DISPLAY SETTING - AND THE TOOLBAR TOGGLE WITH IT.
 *
 * THE ONE STATE. The setting lives on `drawingState.display`, and that is what
 * this writes. The toolbar button is not a second setting; it is a second VIEW
 * of this one, so after writing the field the toggles are re-synchronised and
 * the button updates without a refresh.
 *
 * It is the identical sequence the toolbar's own click handler performs, which
 * is why a menu item and the button cannot end up disagreeing about whether the
 * grid is showing. `buttonId` is accepted for compatibility with the call sites,
 * which pass the toolbar control's id; the synchroniser updates every toggle
 * from the state, so which id was named no longer decides anything.
 */
export function toggleDisplaySetting(key, buttonId) {
    void buttonId;

    const next = !(drawingState.display?.[key] !== false);

    drawingState.display = {
        ...(drawingState.display || {}),
        [key]: next
    };

    /*
     * Dimensions are ALSO held on their own flag in the editor state, because
     * the renderer reads that one. Both are written together so the two cannot
     * part company - the same pairing the toolbar toggle performs.
     */
    if (key === "showDimensions") {
        drawingState.dimensionsVisible = next;
    }

    syncWorkspaceSettingToggles();

    /*
     * AND THAT IS THE WHOLE OF THE TOOLBAR'S UPDATE.
     *
     * `syncWorkspaceSettingToggles` reads both display flags back from the
     * state and writes each toggle's class, `aria-pressed` and ON/OFF tooltip
     * through `setToggleLabel` - the one place a toggle's state is stated. This
     * function used to follow it with a second, manual write that hunted for a
     * trailing text node; an ICON-ONLY toggle has no text node, so the block did
     * nothing except leave the door open for a future `textContent` write to
     * delete the icon.
     */

    renderCurrentDrawing();

    return next;
}

/*
 * ZOOM ONE STEP, ANCHORED ON THE MIDDLE OF THE CANVAS.
 *
 * A wheel zooms about the cursor because the cursor is where the student is
 * looking. A menu has no cursor on the canvas, so the middle of the view is the
 * right anchor: the thing in the centre stays in the centre, which is what
 * "zoom in" means when the instruction came from a menu.
 *
 * The limits and the redraw belong to the viewport - this only chooses the
 * anchor, so a menu zoom and a wheel zoom cannot end up with different rules.
 */
export function zoomByFactor(factor) {
    const current = drawingState.camera.zoom;

    const next = current * factor;

    /* A synthetic event at the canvas centre: the anchor, and nothing more. */
    const bounds = drawingCanvasBounds();

    const centreEvent = {
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2
    };

    zoomAtCanvasPoint(next, centreEvent);

    return drawingState.camera.zoom;
}

/*
 * The canvas rect, or a zero rect in a harness that has no canvas element.
 * Guarded because this module is also loaded by tests that never lay out a page.
 */
function drawingCanvasBounds() {
    const canvas = document.querySelector(".drawing-canvas");

    if (!canvas || typeof canvas.getBoundingClientRect !== "function") {
        return { left: 0, top: 0, width: 0, height: 0 };
    }

    return canvas.getBoundingClientRect();
}

/*
 * ARM A MODIFY OR VIEW TOOL - Move, Rotate, Mirror, Trim, Extend, Pan, Zoom.
 *
 * These used to be buttons on the global tool bar; the bar is gone and the
 * commands live in the Tools menu. `activateGlobalTool` is the SAME function
 * those buttons called, so the tool that arms and the highlight that appears are
 * identical to what the button produced.
 *
 * `button` is null because there is no button to highlight - the menu is closed
 * by the time this runs, and the tool's own state is what shows it is armed.
 */
export function activateGlobalTool(toolId) {
  activateGlobalToolImpl(toolId, null);

  return true;
}

/*
 * DRAW ORDER - what is painted on top of what.
 *
 * Purely presentational: it changes the order features are drawn in and nothing
 * about selection, hit testing or geometry, so a feature sent to the back can
 * still be clicked. The command itself belongs to `draw-order.js` and is called
 * there, unchanged - the old tool bar's buttons called this same function.
 */
export function applyDrawOrderToSelection(direction) {
  return applyDrawOrder(direction);
}

/*
 * SHOW A SETTINGS PANEL.
 *
 * One dialog with several pages: Drawing Settings, Precision & Snapping,
 * Measurement & Inspection, and Keyboard Shortcuts. They are the same act -
 * open a panel, change something, close it - so they share one dialog and one
 * set of behaviours, and the pages are content rather than four dialogs.
 */
export function showSettings(pageId) {
  return enggSettingsDialog.open(pageId);
}

/*
 * SHOW A HELP PANEL.
 *
 * One dialog for all four entries - the guide, the drawing help, the feedback
 * route and About - because they are the same act: read a short block of text
 * and close it. The content lives in the dialog module; this is the command the
 * menu calls.
 */
export function showHelp(pageId) {
  return enggHelpDialog.open(pageId);
}

/*
 * The theme commands, re-exported so the settings dialog has one place to reach
 * them and the menu file does not have to import the theme module itself.
 *
 * The ACT of choosing a theme - applying it AND re-pointing the default drawing
 * line colour - lives in `theme-preference.js`, which the settings dialog calls
 * directly.
 */
export { applyTheme, readThemePreference, resolvedTheme, setThemePreference, THEME_VALUES };
