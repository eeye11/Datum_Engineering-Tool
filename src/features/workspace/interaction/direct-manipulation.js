/*
 * ========================================================
 * WHO MAY DIRECTLY MANIPULATE AN EXISTING FEATURE
 * ========================================================
 *
 * A press on the canvas can mean two different things, and the ACTIVE TOOL is
 * what decides which:
 *
 *     Select active          interact with what is already drawn
 *     any creation tool      that tool's own workflow, and nothing else
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * --------------------------------------
 * While a tool other than Select is active, an existing feature must not be
 * moved, edited, or manipulated by clicking and dragging it. A press on an
 * existing line while the Line tool is armed draws a line; it does not drag the
 * line. A press on a force while a Distributed Load is being placed picks the
 * body the load acts on; it does not move the force. A dimension's handles are
 * inert while a Callout is being created.
 *
 * WHY IT IS ONE FUNCTION AND NOT A CONDITION AT EACH SITE
 * -------------------------------------------------------
 * There are several places a direct manipulation can begin - the handle drag,
 * the body drag, a magnitude label's own grab, a dimension's number - and each
 * of them could be gated on its own. It would be several separate statements of
 * one rule, and the one that was forgotten would be the one that quietly let a
 * feature be dragged mid-creation. So the question is asked ONCE here, and
 * every one of those sites asks it.
 *
 * WHAT IS DELIBERATELY NOT DISABLED
 * ---------------------------------
 * This is a rule about MANIPULATING EXISTING FEATURES. It is not a rule about
 * touching them:
 *
 *   - a creation tool may still SNAP to, reference and attach to existing
 *     geometry (that is its workflow, not a manipulation of them);
 *   - a Leader may still reference an existing feature, a Dimension may still
 *     measure one, a load may still attach to one;
 *   - the Modify tools (Move, Rotate, Trim ...) run their OWN session and never
 *     reach the direct-manipulation path this guards;
 *   - Pan and Zoom are navigation and are likewise outside it.
 *
 * The line is drawn at "does this gesture change an existing feature's stored
 * geometry", and only Select may cross it while a tool is armed.
 */
import { drawingState } from "../editor-state.js";

/*
 * The one tool that interacts with what is already drawn.
 *
 * Named rather than inlined so the answer to "which tool may drag things" is
 * stated once and read everywhere.
 */
export const MANIPULATION_TOOL = "select";

/*
 * May the pointer directly manipulate existing features right now?
 *
 * True only while Select is the active tool. Every other armed tool - a
 * geometry tool, a Statics placement, a dimension, an annotate kind - owns the
 * pointer for its own creation workflow instead.
 */
export function allowsDirectManipulation() {
  return drawingState.activeTool === MANIPULATION_TOOL;
}
