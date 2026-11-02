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
import { renderCurrentDrawing } from "../workspace/canvas-render.js";
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
 * ============================================================
 * THE VISIBILITY EYE
 * ============================================================
 *
 * One compact button at the far right of every row. It is drawn from the same
 * 20x20 / `currentColor` conventions as every other DAEMON icon, so it picks up
 * the row's colour and hover state rather than needing a palette of its own.
 *
 * VISIBLE -> an open eye; HIDDEN -> the eye with a stroke through it. Both are
 * inline SVG rather than a font glyph, so the button cannot shift the row's
 * height or fall back to a box on a machine without the icon font.
 */
const EYE_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
    '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '</svg>';

const EYE_OFF_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
    '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M4 4l12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '</svg>';

/*
 * THE HIDDEN MARK, for a surface that only has to SAY hidden - the Source tab's
 * gutter and the top of a hidden object's block. It is the list's own picture,
 * exported rather than redrawn, so "hidden" cannot come to look like two
 * different things in two panes of the same panel.
 */
export const EYE_OFF_MARK_ICON = EYE_OFF_ICON;

/* The eye button for one row, or "" when the list is only identifying rows. */
export function visibilityButtonMarkup(object) {
    const visible = object.visible !== false;
    const name = displayNameOf(object);
    const action = visible ? `Hide ${name}` : `Show ${name}`;

    return (
        `<button type="button" class="drawing-objects-visibility" ` +
        `data-visibility-for="${escapeHtml(object.id)}" ` +
        `data-visible="${visible ? "true" : "false"}" ` +
        `aria-pressed="${visible ? "true" : "false"}" ` +
        `aria-label="${escapeHtml(action)}" ` +
        `title="${escapeHtml(action)}">` +
        `${visible ? EYE_ICON : EYE_OFF_ICON}` +
        `</button>`
    );
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

    /*
     * ============================================================
     * ONE ROW PER OBJECT, AND CHILDREN UNDER THEIR PARENT
     * ============================================================
     *
     * A CHILD is an object whose `parentId` names another object on this sheet -
     * a Pipe Assembly's members, for instance. Children follow their parent's row
     * instead of appearing again in the top-level list, so the tree shows the
     * system as one group with its components inside it.
     *
     * THE ROW ITSELF IS UNCHANGED. A child keeps its own icon, name, selection, id
     * and eye; the only difference is indentation and the row it sits beneath. A
     * parent row is still just a row, so selecting it selects the assembly, and
     * selecting a child selects only that component.
     */
    const ids = new Set(objects.map((object) => object.id));

    const childrenOf = new Map();

    objects.forEach((object) => {
        if (!object.parentId || !ids.has(object.parentId) || object.parentId === object.id) {
            return;
        }

        const siblings = childrenOf.get(object.parentId) || [];

        siblings.push(object);
        childrenOf.set(object.parentId, siblings);
    });

    const isChild = (object) => Boolean(object.parentId) && ids.has(object.parentId) && object.parentId !== object.id;

    const rowMarkup = (object, depth = 0) => {
        const isSelected = selected.has(object.id);
        const isVisible = object.visible !== false;
        const name = displayNameOf(object);
        const type = typeLabelOf(object);
        const children = childrenOf.get(object.id) || [];

        const indented = depth > 0 ? ` drawing-objects-item-child` : "";

        return (
            `<li class="drawing-objects-item${indented}${isVisible ? "" : " drawing-objects-item-hidden"}" role="option" ` +
            `aria-selected="${isSelected ? "true" : "false"}" ` +
            `aria-level="${depth + 1}" ` +
            `data-object-id="${escapeHtml(object.id)}" data-object-type="${escapeHtml(object.type)}" ` +
            `data-object-depth="${depth}" ` +
            `tabindex="${isSelected ? "0" : "-1"}" ` +
            `title="${escapeHtml(object.label ? `${name} — ${type}` : type)}">` +
            `<span class="drawing-objects-icon" aria-hidden="true">${iconForObject(object)}</span>` +
            `<span class="drawing-objects-name">${escapeHtml(name)}</span>` +
            visibilityButtonMarkup(object) +
            (children.length
                ? `<ul class="drawing-objects-children" role="group" aria-label="${escapeHtml(name)} members">` +
                  children.map((child) => rowMarkup(child, depth + 1)).join("") +
                  `</ul>`
                : "") +
            `</li>`
        );
    };

    const rows = objects
        .filter((object) => !isChild(object))
        .map((object) => rowMarkup(object, 0))
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
        /*
         * THE EYE IS ITS OWN ACTION, NOT A ROW CLICK.
         *
         * The button sits inside the row, so without this the browser would
         * bubble the click to the row handler and SELECT the object as well as
         * hiding it - the student would hide a pipe and find it selected and
         * open in Features, which is not what they asked for. The handler stops
         * here and toggles only the one object's visibility.
         *
         * `stopPropagation` alone would still let a parent listener react, so
         * the row is checked for first and the event is consumed either way.
         */
        const eye = event.target.closest?.("[data-visibility-for]");

        if (eye) {
            event.preventDefault();
            event.stopPropagation();

            enggDrawingState.toggleObjectVisible(
                drawingState,
                eye.dataset.visibilityFor
            );

            /*
             * A CHANGE THAT WAS REFUSED STILL REPAINTS THE ROW, so the button
             * can never be left showing a state the model does not have.
             */
            renderObjects();
            renderCurrentDrawing();

            return;
        }

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
    objectsListMarkup,
    visibilityButtonMarkup
};
