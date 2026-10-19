/*
 * ============================================================
 * IMPORTED FROM ITS OWN MODULE, NOT THROUGH THE BARREL
 * ============================================================
 *
 * This used to read `from "../../../features/workspace/index.js"`, and that one
 * line created a cycle: the barrel installs the toolbar wiring, the wiring
 * imports this file, and this file imported the barrel back. The cycle did not
 * merely resolve badly - it threw a temporal-dead-zone `ReferenceError` while
 * the graph was still linking, which silently aborted the tail of the entry
 * module. Every `window.enggX` handle and `window.datum` went missing on a
 * normal page load, and because the throw happened before the global error
 * handlers were installed, nothing was reported anywhere.
 *
 * `renderEngineeringTools` is defined in `toolbar-render.js`, which is what the
 * barrel re-exports it from, so importing it directly is the same function with
 * the same behaviour and one fewer edge in the graph. The barrel keeps its
 * re-export for every other caller.
 */
import { renderEngineeringTools } from "./toolbar-render.js";
import { resetActiveToolForCategory } from "../../../features/workspace/interaction/selection.js";

const dom = globalThis.document;
const categoryButtons = dom?.querySelectorAll(".drawing-category") ?? [];

categoryButtons.forEach(categoryButton => {
	categoryButton.addEventListener("click", () => {
		(dom?.querySelectorAll(".drawing-category") ?? []).forEach(button => button.classList.remove("active"));
		categoryButton.classList.add("active");

		/*
		 * SWITCHING CATEGORY RESETS THE ACTIVE TOOL.
		 *
		 * The active tool must always belong to the category the student is
		 * looking at, so the previous category's tool is abandoned and Select is
		 * activated in the new one. The button above is marked active FIRST,
		 * because the reset re-renders the tool list for the category the DOM now
		 * says is current - and the tool list and the reset must agree about
		 * which category Select belongs to.
		 *
		 * Existing features are untouched: only the active tool and any unfinished
		 * operation are reset. A switch that had no tool running is therefore the
		 * same clean re-render it always was.
		 */
		resetActiveToolForCategory();

		renderEngineeringTools(categoryButton.dataset.category);
	});
});
