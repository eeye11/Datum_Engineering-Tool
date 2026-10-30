/*
 * ========================================================
 * FINISH AND CANCEL, AS CONTROLS RATHER THAN IDIOMS
 * ========================================================
 *
 * A progressive construction - a pipe run, a polyline, a truss, a load - is
 * finished by a DOUBLE-CLICK and given up with ESCAPE. Both are excellent
 * idioms with a keyboard and a mouse, and both are unreachable on a tablet:
 * a finger has no Escape key, no right button, and no way to say "double-click"
 * that is not indistinguishable from "click here, then here".
 *
 * So the SAME TWO actions are on screen beside the instruction, and they are
 * the SAME TWO FUNCTIONS the keyboard reaches:
 *
 *   Finish   finishActiveConstruction()   the Enter / double-click behaviour
 *   Cancel   cancelInteraction()          the Escape behaviour
 *
 * Neither is reimplemented, so a Finish pressed here and a Finish reached by
 * double-click cannot do different things - the difference is only how they
 * were asked for.
 *
 * WHEN THEY APPEAR.
 *
 * Only while something is genuinely in progress. That is deliberately the
 * existing predicate (`isConstructionInProgress`), not a new one: a tool that
 * is merely ARMED is not a construction, and showing Finish then would offer
 * the student a button that does nothing. It is re-evaluated on every redraw,
 * which is where every start and every finish is already announced - so the
 * pair appears and disappears with the construction itself and cannot go
 * stale.
 */
import { drawingState, editorState } from "../editor-state.js";
import { isConstructionInProgress } from "./handles.js";
import { cancelInteraction, finishActiveConstruction } from "./selection.js";
import { setConstructionActionsSync } from "../../../components/layout/toolbar/toolbar-render.js";
import { isDimensionTool } from "../annotate/dimension-tool.js";
import { isProcessPlotTool } from "../thermodynamics/process-path.js";
import { cancelCreationDrag } from "./creation-drag.js";

/*
 * A CONSTRUCTION MAY BE HELD SOMEWHERE OTHER THAN `phase`.
 *
 * The dimension tool records its progress in `dimensionStage`, and a plot
 * records its own points - neither of which `isConstructionInProgress` can
 * see. Asking each of them through the same functions the keyboard's Enter
 * asks keeps this predicate honest: anything Finish would DO is a reason to
 * show it.
 */
function constructionIsRunning() {
    if (editorState.creationDrag) {
        return true;
    }

    if (
        isDimensionTool(drawingState.activeTool) &&
        (drawingState.interaction?.dimensionStage === "selecting" ||
            drawingState.interaction?.dimensionStage === "armed")
    ) {
        return true;
    }

    if (isProcessPlotTool(drawingState.activeTool)) {
        return (drawingState.interaction?.points || []).length > 0;
    }

    return isConstructionInProgress();
}

/**
 * Show or hide the pair, from the CURRENT state.
 *
 * Called after every redraw, so it costs one class toggle when nothing changed
 * and cannot fall behind the construction it describes.
 */
export function syncConstructionActions() {
    const actions = globalThis.document?.getElementById?.("drawingConstructionActions");

    if (!actions) {
        return;
    }

    actions.hidden = !constructionIsRunning();
}

/*
 * Wire the two buttons. Called once, at start-up, alongside the canvas events.
 */
export function installConstructionActions() {
    const finish = globalThis.document?.getElementById?.("drawingConstructionFinish");
    const cancel = globalThis.document?.getElementById?.("drawingConstructionCancel");

    /*
     * THE BUTTONS ARE THEMSELVES A TOUCH TARGET, so the press is not allowed to
     * bubble out to the document and be read as "pressed outside the canvas,
     * cancel the tool". That listener exists (see canvas-events.js) and would
     * otherwise cancel the very construction the student just asked to finish.
     */
    const keepPress = (event) => event.stopPropagation();

    if (finish) {
        finish.addEventListener("pointerdown", keepPress);
        finish.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            finishActiveConstruction();
            syncConstructionActions();
        });
    }

    if (cancel) {
        cancel.addEventListener("pointerdown", keepPress);
        cancel.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            /*
             * DROP THE UNCOMMITTED PREVIEW FIRST, through the SAME cancel a
             * pointer cancellation and a second finger use - so a touch session
             * that was still armed cannot complete itself on the next release
             * after the button was pressed.
             */
            cancelCreationDrag();

            cancelInteraction();
            syncConstructionActions();
        });
    }

    /*
     * THE STATUS MESSAGE IS THE CONSTRUCTION'S CLOCK. Binding the pair to it
     * means every step of every construction re-evaluates the buttons, without
     * the renderer importing this module (or this one importing the renderer's
     * whole surface).
     */
    setConstructionActionsSync(syncConstructionActions);

    syncConstructionActions();
}
