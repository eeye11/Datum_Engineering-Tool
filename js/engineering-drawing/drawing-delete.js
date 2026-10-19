/* Delete selected engineering drawing components. */
(function () {
    function isTextEditingElement(target) {
        if (!target || !(target instanceof HTMLElement)) {
            return false;
        }

        const tagName = target.tagName.toLowerCase();

        return (
            tagName === "input" ||
            tagName === "textarea" ||
            target.isContentEditable ||
            Boolean(target.closest("[contenteditable='true']"))
        );
    }

    function deleteSelectedObjects() {
        const app = window.enggDrawing;

        if (!app || !app.state) {
            return false;
        }

        const state = app.state;
        const selectedIds = [...(state.selection.selectedObjectIds || [])];

        // Nothing selected.
        if (!selectedIds.length) {
            return false;
        }

        // Don't delete objects while another operation is unfinished.
        if (
            state.interaction &&
            state.interaction.phase !== "idle"
        ) {
            return false;
        }

        const selectedSet = new Set(selectedIds);

        // Save the current drawing for Undo.
        const previousObjects =
            app.model.snapshotDrawing(state);

        const remainingObjects =
            state.objects.filter(
                object => !selectedSet.has(object.id)
            );

        // Nothing actually matched.
        if (
            remainingObjects.length ===
            state.objects.length
        ) {
            return false;
        }

        // Remove selected objects.
        state.objects = remainingObjects;

        // Clear selection state.
        state.selection.selectedObjectIds = [];
        state.selection.boxSelectionIds = [];
        state.selection.hoveredObjectId = null;

        // Clear temporary hover/snap references.
        if (state.interaction) {
            state.interaction.hoveredEntity = null;
            state.interaction.snapCandidate = null;
        }

        // Register ONE undo action for the whole deletion.
        app.model.commitDrawingChange(
            state,
            previousObjects
        );

        // Update Properties / Components panel.
        if (
            typeof window.renderProperties === "function"
        ) {
            window.renderProperties();
        }

        // Re-render drawing and update Undo/Redo.
        if (
            typeof window.renderCurrentDrawing === "function"
        ) {
            window.renderCurrentDrawing();
        }

        // Optional status message.
        if (
            typeof window.setToolMessage === "function"
        ) {
            const count = selectedIds.length;

            window.setToolMessage(
                `Deleted ${count} component${
                    count === 1 ? "" : "s"
                }`
            );
        }

        return true;
    }

    // Expose the function in case other controls want to use it.
    window.enggDrawingDelete = {
        deleteSelectedObjects
    };

    document.addEventListener("keydown", event => {
        // Only handle this when the Engineering Drawing
        // section is currently active.
        const drawingSection =
            document.getElementById("drawing");

        if (
            !drawingSection ||
            !drawingSection.classList.contains("active")
        ) {
            return;
        }

        // Never intercept Delete/Backspace while typing.
        if (isTextEditingElement(event.target)) {
            return;
        }

        // Delete key.
        if (event.key !== "Delete") {
            return;
        }

        // Delete selected drawing objects.
        if (deleteSelectedObjects()) {
            event.preventDefault();
            event.stopPropagation();
        }
    });
})();