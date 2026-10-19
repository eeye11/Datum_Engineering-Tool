/*
 * ============================================================
 * THE COLOUR PICKER
 * ============================================================
 *
 * ONE picker, used everywhere a colour is chosen: the top toolbar's drawing
 * colour, and every colour property in the Features tab, in every tool
 * category. It is deliberately a single component rather than a shared look -
 * two implementations that "match" drift apart the first time one of them is
 * touched, and the student then has two different ideas of what choosing a
 * colour does.
 *
 * WHAT IT IS. A swatch button opens a popup holding a hue-by-shade grid, a
 * custom colour input, an eyedropper and the colours used recently. The popup
 * is positioned against the swatch and pulled back inside the viewport, closes
 * on an outside click, and reports every choice through ONE callback.
 *
 * WHAT IT IS NOT. It does not know what a colour MEANS. The toolbar's swatch
 * writes a drawing default; a Features swatch writes a property of the selected
 * objects. Both hand this module a value to start from and receive the value
 * the student picked, and neither of them implements a picker of its own.
 *
 * THE VALUE IS ALWAYS `#rrggbb`, lower case. Every caller reads and writes that
 * one representation, which is what the object model stores and what the
 * renderer and the source writer both understand.
 */

const RECENT_LIMIT = 24;

const STORAGE_KEY = "enggDrawing.recentColours";

/*
 * The shared list of colours used recently. It is one list for the whole
 * application on purpose: a colour picked for a line in Features is exactly the
 * colour someone will want for a force a moment later, and two lists would mean
 * having to find it twice.
 */
let recentColours = [];
let loaded = false;

/*
 * The open popup, if any. One at a time: opening a second picker closes the
 * first, so two popups can never be on screen claiming to be the same control.
 *
 * THE STATE LIVES HERE, NOT ON THE ELEMENT. Storing the callback as a property
 * of the popup node looks tidier but silently fails - a DOM element does not keep
 * an arbitrary expando across the reference the click handler holds - and the
 * symptom is a picker whose swatches do nothing at all. Three module variables
 * are the honest place for it.
 */
let openPopup = null;
let popupAnchor = null;
let popupChoose = null;

export function normalizeColour(value) {
    const text = String(value ?? "")
        .trim()
        .toLowerCase();

    return /^#[0-9a-f]{6}$/.test(text) ? text : null;
}

/* ---------------------------------------------------------- recent colours */

function loadRecentColours() {
    if (loaded) {
        return;
    }

    loaded = true;

    try {
        const stored = globalThis.localStorage?.getItem(STORAGE_KEY);

        if (!stored) {
            return;
        }

        const parsed = JSON.parse(stored);

        if (Array.isArray(parsed)) {
            recentColours = parsed.map(normalizeColour).filter(Boolean).slice(0, RECENT_LIMIT);
        }
    } catch {
        /* Storage can be unavailable; the session list still works. */
    }
}

function saveRecentColours() {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(recentColours));
    } catch {
        /* As above: the list is a convenience, never a requirement. */
    }
}

export function rememberColour(value) {
    const colour = normalizeColour(value);

    if (!colour) {
        return;
    }

    loadRecentColours();

    recentColours = [colour, ...recentColours.filter((existing) => existing !== colour)].slice(
        0,
        RECENT_LIMIT
    );

    saveRecentColours();
}

export function recentColoursFor() {
    loadRecentColours();

    return [...recentColours];
}

/* ------------------------------------------------------------- the palette */

/*
 * Hue across the columns, lightness down the rows, so moving across changes the
 * colour family and moving down changes the shade. The last row of neutrals
 * runs white through grey to black.
 */
function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;

    if (hue < 60) {
        r = c;
        g = x;
    } else if (hue < 120) {
        r = x;
        g = c;
    } else if (hue < 180) {
        g = c;
        b = x;
    } else if (hue < 240) {
        g = x;
        b = c;
    } else if (hue < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }

    const toHex = (value) =>
        Math.round((value + m) * 255)
            .toString(16)
            .padStart(2, "0");

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function buildColourGrid() {
    const cells = [];

    const hues = 12;

    [92, 78, 64, 50, 38, 28].forEach((lightness) => {
        for (let column = 0; column < hues; column += 1) {
            cells.push(hslToHex((column * 360) / hues, 72, lightness));
        }
    });

    [100, 88, 76, 64, 52, 40, 28, 16, 0].forEach((lightness) =>
        cells.push(hslToHex(0, 0, lightness))
    );

    return cells;
}

/* ------------------------------------------------------------------ popup */

export function closeColourPopup() {
    if (openPopup) {
        openPopup.remove();
    }

    openPopup = null;
    popupAnchor = null;
    popupChoose = null;
}

function renderRecent(host) {
    host.innerHTML = "";

    const colours = recentColoursFor();

    if (!colours.length) {
        const empty = globalThis.document.createElement("div");

        empty.className = "drawing-colour-empty";
        empty.textContent = "No colours used yet";

        host.appendChild(empty);

        return;
    }

    colours.forEach((colour) => host.appendChild(colourCell(colour)));
}

function colourCell(colour) {
    const cell = globalThis.document.createElement("button");

    cell.type = "button";
    cell.className = "drawing-colour-cell";
    cell.style.background = colour;
    cell.title = colour;
    cell.setAttribute("aria-label", colour);

    /*
     * THE CHOICE IS TAKEN ON `pointerdown`.
     *
     * The popup is torn down by the pick itself, so a cell that waited for the
     * `click` would be waiting on an element its own UI had already removed -
     * and the press is the honest moment to act on a palette. `click` is kept as
     * the keyboard path (Enter and Space produce one without a pointer).
     *
     * `preventDefault` IS NOT CALLED: suppressing the default on pointerdown also
     * suppresses the compatibility mouse events that follow, including the click
     * itself, which made the palette work for a mouse and silently fail for a
     * synthetic click. The popup closes on its own, so there is nothing for the
     * default to do afterwards.
     */
    cell.addEventListener("pointerdown", () => pickColour(colour));

    cell.addEventListener("click", () => pickColour(colour));

    return cell;
}

/*
 * Apply one colour and close.
 *
 * `popupChoose` is read and then the popup is closed, so a pick can never be
 * applied twice - the second call finds nothing to do because there is no open
 * popup left.
 */
function pickColour(colour) {
    const choose = popupChoose;

    if (!choose) {
        return;
    }

    closeColourPopup();

    choose(colour);
}

/*
 * Open the picker against an element.
 *
 * `options`:
 *   value      the colour to start from (`#rrggbb`)
 *   onChoose   called with the chosen colour; called for a grid cell, a recent
 *              colour, the custom input and the eyedropper alike, so a caller
 *              has ONE path to handle
 *   onEyedropper   optional; when given, an eyedropper button is offered and
 *                  this is called when it is pressed
 *   eyedropperActive  optional; whether the eyedropper is currently armed
 *   anchor     the element to position against (defaults to the active element)
 */
export function openColourPicker(options = {}) {
    const anchor = options.anchor || globalThis.document.activeElement;

    if (!anchor) {
        return null;
    }

    /* A second press on the same swatch closes the picker it opened. */
    if (openPopup && popupAnchor === anchor) {
        closeColourPopup();

        return null;
    }

    closeColourPopup();

    const popup = globalThis.document.createElement("div");

    popup.className = "drawing-colour-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Choose colour");

    popup.innerHTML = `
        <div class="drawing-colour-section">COLOUR GRID</div>
        <div class="drawing-colour-grid" data-colour-grid></div>

        <div class="drawing-colour-section">CUSTOM COLOUR</div>
        <div class="drawing-colour-row">
            <input type="color" class="drawing-colour-custom"
                data-colour-custom aria-label="Custom colour">
            <button type="button" class="drawing-colour-action"
                data-colour-eyedropper>Pick from drawing</button>
        </div>

        <div class="drawing-colour-section">PREVIOUS COLOURS</div>
        <div class="drawing-colour-recent" data-colour-recent></div>
    `;

    globalThis.document.body.appendChild(popup);

    const current = normalizeColour(options.value) || "#000";

    popupAnchor = anchor;

    popupChoose = (colour) => {
        const chosen = normalizeColour(colour);

        if (!chosen) {
            return;
        }

        rememberColour(chosen);

        options.onChoose?.(chosen);
    };

    /*
     * THE EYEDROPPER IS OFFERED ONLY WHERE IT MEANS SOMETHING. On the toolbar
     * there is a drawing to sample from; a caller that has no canvas to pick
     * off simply does not pass the callback, and the button is not drawn.
     */
    const eyedropper = popup.querySelector("[data-colour-eyedropper]");

    if (typeof options.onEyedropper === "function") {
        eyedropper.classList.toggle("active", Boolean(options.eyedropperActive));

        eyedropper.addEventListener("click", () => {
            const armed = options.onEyedropper(!options.eyedropperActive);

            eyedropper.classList.toggle("active", Boolean(armed));
        });
    } else {
        eyedropper.remove();
    }

    popup.querySelector("[data-colour-grid]").append(
        ...buildColourGrid().map((colour) => colourCell(colour))
    );

    renderRecent(popup.querySelector("[data-colour-recent]"));

    const custom = popup.querySelector("[data-colour-custom]");

    custom.value = current;

    /*
     * `input` while the native picker is being dragged, so the object follows
     * the colour live; the popup is NOT closed, because the picker is still
     * open and closing under it would lose the interaction.
     */
    custom.addEventListener("input", () => popupChoose?.(custom.value));

    positionPopup(popup, anchor);

    openPopup = popup;

    globalThis.document.addEventListener("pointerdown", closeOnOutside, true);

    return popup;
}

function closeOnOutside(event) {
    if (!openPopup) {
        return;
    }

    /*
     * A PRESS INSIDE THE POPUP OR ON ITS OWN SWATCH IS NOT "OUTSIDE".
     *
     * The swatch is tested with `contains`, and the popup with `contains` too -
     * so the press that OPENS the picker (which lands on the swatch, and whose
     * capture phase runs before the swatch's own click handler) does not close
     * the picker it is about to open. Without the anchor check the popup opened
     * and was torn down in the same gesture, which is why a palette that looked
     * correct did nothing when a colour was chosen.
     */
    if (openPopup.contains(event.target) || popupAnchor?.contains?.(event.target)) {
        return;
    }

    closeColourPopup();
}

/*
 * THE POPUP IS PLACED AGAINST ITS SWATCH AND KEPT ON SCREEN.
 *
 * It hangs below the swatch and is aligned to its right edge, which is where a
 * picker attached to a control at the right of a panel belongs. If that would
 * run off the bottom it flips above, and if it would run off either side it is
 * pulled inside - so a picker opened near any edge of the window is still fully
 * usable, which is the only "adaptation" the shared component does.
 */
function positionPopup(popup, anchor) {
    const rect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    const gap = 6;
    const margin = 8;

    let left = rect.right - popupRect.width;
    let top = rect.bottom + gap;

    left = Math.min(Math.max(margin, left), globalThis.innerWidth - popupRect.width - margin);

    if (top + popupRect.height > globalThis.innerHeight - margin) {
        top = Math.max(margin, rect.top - popupRect.height - gap);
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

export default {
    normalizeColour,
    rememberColour,
    recentColoursFor,
    buildColourGrid,
    openColourPicker,
    closeColourPopup
};
