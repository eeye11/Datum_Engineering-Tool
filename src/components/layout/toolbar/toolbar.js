import { renderEngineeringTools } from "../../../features/workspace/index.js";
import { resetActiveToolForCategory } from "../../../features/workspace/interaction/selection.js";

document.querySelectorAll(".drawing-category").forEach(categoryButton => {
	categoryButton.addEventListener("click", () => {
		document.querySelectorAll(".drawing-category").forEach(button => button.classList.remove("active"));
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
