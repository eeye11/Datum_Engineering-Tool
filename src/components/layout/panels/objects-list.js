/*
 * ============================================================
 * THE OBJECTS PANE
 * ============================================================
 *
 * The Objects tab is the drawing's inventory: one compact row per object on the
 * active sheet, whatever tool category made it. Each row is its TYPE'S ICON and
 * its NAME, and nothing else - this tab identifies and selects, it does not
 * edit. Every property of the selection belongs to Features.
 *
 * SELECTION IS THE APPLICATION'S, NOT THIS LIST'S.
 *
 * The list reads `drawingState.selection.selectedObjectIds` and writes through
 * `selectObject` / `selectObjects`, so it is the same selection the canvas
 * draws and Features describes. That is why a click on the sheet highlights its
 * row here, and a click here puts the handles on the sheet - there is one
 * selection, and two views of it.
 *
 * MULTI-SELECTION IS THE CANVAS'S GESTURE. Shift or Ctrl toggles a row in or out
 * of the selection, exactly as Shift-clicking on the canvas does, so a student
 * who has learned the gesture in one place has learned it in both.
 */

import { drawingState } from "../../../features/workspace/editor-state.js";
import enggDrawingState from "../../../shared/model/drawing-state.js";
import { displayNameOf, iconForObject, typeLabelOf } from "./feature-schema.js";

let host = null;
/*
 * THE LIST ELEMENT IS THE HOST'S CHILD, AND IT IS KEPT.
 *
 * The rows used to be written into the host itself, so a re-render REPLACED the
 * container the click and keydown listeners were attached to. The panel then
 * looked wired but answered nothing until the page was reloaded - the classic
 * "render into the thing you are listening on" fault. The listeners live on the
 * stable host, and only the list inside it is rebuilt.
 */
let list = null;

function element(id) {
    return globalThis.document.getElementById(id);
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/*
 * The row list's markup. Exported so a test can assert the rows without a DOM
 * event, and so the render below stays a one-liner.
 */
export function objectsListMarkup(
    objects = Array.isArray(drawingState.objects) ? drawingState.objects : [],
    selectedIds = drawingState.selection?.selectedObjectIds || []
) {
    if (!objects.length) {
        return `<p class="drawing-inspector-message drawing-objects-empty">No objects on this sheet yet.</p>`;
    }

    const selected = new Set(selectedIds);

    const rows = objects
        .map((object) => {
            const isSelected = selected.has(object.id);
            const name = displayNameOf(object);
            const type = typeLabelOf(object);

            return (
                `<li class="drawing-objects-item" role="option" aria-selected="${isSelected ? "true" : "false"}" ` +
                `data-object-id="${escapeHtml(object.id)}" data-object-type="${escapeHtml(object.type)}" ` +
                `tabindex="${isSelected ? "0" : "-1"}" ` +
                `title="${escapeHtml(object.label ? `${name} — ${type}` : type)}">` +
                `<span class="drawing-objects-icon" aria-hidden="true">${iconForObject(object)}</span>` +
                `<span class="drawing-objects-name">${escapeHtml(name)}</span>` +
                `</li>`
            );
        })
        .join("");

    return `<ul class="drawing-objects-list" role="listbox" aria-label="Objects" aria-multiselectable="true">${rows}</ul>`;
}

/*
 * The row list, created once inside the host so the host's listeners survive
 * every rebuild.
 */
function ensureList() {
    if (list && list.parentNode === host) {
        return list;
    }

    list = globalThis.document.createElement("div");
    list.className = "drawing-objects-body";
    host.replaceChildren(list);

    return list;
}

export function renderObjects() {
    host = host || element("drawingObjects");

    if (!host) {
        return;
    }

    const objects = Array.isArray(drawingState.objects) ? drawingState.objects : [];
    const selectedIds = drawingState.selection?.selectedObjectIds || [];

    const active = globalThis.document.activeElement;
    const focusedId = active?.dataset?.objectId || null;

    ensureList().innerHTML = objectsListMarkup(objects, selectedIds);

    /*
     * A REBUILD MUST NOT TAKE THE KEYBOARD AWAY.
     *
     * Selecting a row re-renders the list, and the row the student is standing
     * on has to still be the focused one afterwards or the next arrow key would
     * start from nowhere. The id is remembered across the rebuild and restored
     * only when focus was already in the list - clicking on the canvas must not
     * pull focus into the panel.
     */
    if (focusedId) {
        const row = [...ensureList().querySelectorAll("[data-object-id]")].find(
            (candidate) => candidate.dataset.objectId === focusedId
        );

        row?.focus?.();
    }

    host.dataset.objectCount = String(objects.length);
    host.dataset.selectedCount = String(selectedIds.length);
}

function selectRow(objectId, additive) {
    if (!objectId) {
        return;
    }

    if (!additive) {
        enggDrawingState.selectObject(drawingState, objectId);

        return;
    }

    /*
     * A MODIFIER-CLICK EXTENDS OR TRIMS - IT NEVER REPLACES. The existing
     * selection is copied, not read by reference, so trimming builds a new list
     * and the deliberate multi-selection of the other rows is never cleared by
     * the act of adding or removing one of them.
     */
    const selected = [...drawingState.selection.selectedObjectIds];

    enggDrawingState.selectObjects(
        drawingState,
        selected.includes(objectId)
            ? selected.filter((id) => id !== objectId)
            : [...selected, objectId]
    );
}

export function installObjectsPane() {
    host = host || element("drawingObjects");

    if (!host) {
        return;
    }

    host.addEventListener("click", (event) => {
        const row = event.target.closest?.("[data-object-id]");

        if (!row) {
            return;
        }

        selectRow(row.dataset.objectId, event.shiftKey || event.ctrlKey || event.metaKey);
    });

    /*
     * THE ARROW KEYS WALK THE INVENTORY, and Space or Enter selects the row they
     * land on - the keyboard's version of clicking down the list. Shift extends
     * the selection the way it does on the canvas.
     */
    host.addEventListener("keydown", (event) => {
        const row = event.target.closest?.("[data-object-id]");

        if (!row) {
            return;
        }

        const rows = [...ensureList().querySelectorAll("[data-object-id]")];

        if (!rows.length) {
            return;
        }

        const index = rows.indexOf(row);

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();

            const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];

            next?.focus();
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();

            rows[event.key === "Home" ? 0 : rows.length - 1]?.focus();
        } else if (event.key === " " || event.key === "Enter") {
            event.preventDefault();

            selectRow(row.dataset.objectId, event.shiftKey || event.ctrlKey || event.metaKey);
        }
    });

    /*
     * ONE SELECTION, TWO VIEWS. A change announced anywhere - the canvas, a
     * command, a tool - repaints the rows; Features listens to the same event
     * itself and is not driven from here.
     */
    globalThis.document.addEventListener("datum:selection-changed", renderObjects);

    globalThis.document.addEventListener("datum:drawing-changed", renderObjects);

    globalThis.document.addEventListener("datum:panel-tab-changed", (event) => {
        if (event?.detail?.tab === "objects") {
            renderObjects();
        }
    });

    renderObjects();
}

export default {
    renderObjects,
    installObjectsPane,
    objectsListMarkup
};
