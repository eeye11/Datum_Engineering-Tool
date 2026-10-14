/*
 * ============================================================
 * THE SETTINGS DIALOG
 * ============================================================
 *
 * One dialog, several pages: Drawing Settings, Precision & Snapping,
 * Measurement & Inspection, and Keyboard Shortcuts.
 *
 * WHY ONE DIALOG AND NOT FOUR
 * ---------------------------
 * They are the same act - open a panel, change or read something, close it - so
 * they share the behaviour (Escape, the backdrop, focus, the title bar) and the
 * pages are CONTENT. Four dialogs would be four copies of that behaviour, which
 * is four chances for one of them to forget Escape.
 *
 * WHAT EACH PAGE DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------------
 * A settings page is only worth having if its controls change something real.
 * Every control here writes the SAME state the equivalent toolbar control writes
 * - the theme writes the theme preference, the display switches write
 * `state.display`, the measurement tools arm the existing tools - so a setting
 * cannot end up disagreeing with the control that shares it.
 *
 * The pages that are REFERENCE rather than settings - inspect, shortcuts, and
 * the measurement readouts - are read-only and say so.
 */

import enggTheme from "../editor/workspace/theme.js";
import { applyThemePreference } from "../editor/workspace/theme-preference.js";
import { drawingState } from "../editor/editor-state.js";
import enggDrawingState from "../core/model/drawing-state.js";
import enggScale from "../core/scale/dimensions.js";
import { setToggleLabel } from "../editor/workspace/sheet-controller.js";

let openDialog = null;

/*
 * A ROW: a label, a control, and enough room for both.
 *
 * Built here rather than imported from the Features-panel vocabulary because a
 * dialog row and a panel row are different widths and different contexts - but
 * the SHAPE is the same, so the two read as the same application.
 */
const row = (label, control, hint = "") => `
    <div class="datum-settings-row">
        <label class="datum-settings-label">${label}</label>
        <div class="datum-settings-control">${control}</div>
        ${hint ? `<p class="datum-settings-hint">${hint}</p>` : ""}
    </div>
`;

/*
 * THE KEYBOARD SHORTCUTS THAT ARE ACTUALLY BOUND.
 *
 * Read from `keyboard-shortcuts.js` by hand and listed here only where the
 * handler genuinely exists. A shortcuts panel that lists a key nobody
 * implemented is worse than one that lists nothing: the student tries it, it
 * does nothing, and they conclude the application is broken rather than the
 * list.
 */
const SHORTCUTS = [
    ["File", [
        ["New", "Ctrl+N"],
        ["Open", "\u2014 (File \u2192 Open)"],
        ["Save", "Ctrl+S"],
        ["Save As", "Ctrl+Shift+S"],
        ["Print", "Ctrl+Shift+P"],
    ]],
    ["Edit", [
        ["Undo", "Ctrl+Z"],
        ["Redo", "Ctrl+Y  /  Ctrl+Shift+Z"],
        ["Copy", "Ctrl+C"],
        ["Cut", "Ctrl+X"],
        ["Paste", "Ctrl+V"],
        ["Select All", "Ctrl+A"],
        ["Delete", "Delete  /  Backspace"],
    ]],
    ["View", [
        ["Fit to screen", "Ctrl+0"],
        ["Zoom in / out", "Mouse wheel"],
        ["Pan", "Middle-drag"],
    ]],
    ["Tools", [
        ["Cancel / return to Select", "Escape"],
        ["Finish a construction", "Enter"],
        ["Move the selection", "Arrow keys"],
    ]],
];

function escapeHtml(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character],
    );
}

/* ---------------------------------------------------------- pages */

/*
 * DRAWING SETTINGS.
 *
 * Units, default appearance, display preferences and the application theme.
 */
function drawingPage() {
    const scale = enggScale.readScale(drawingState);

    const display = drawingState.display || {};

    const themeNow = enggTheme.readThemePreference();

    const themeChoice = enggTheme.THEME_VALUES.map(
        (value) => `
            <label class="datum-settings-choice">
                <input type="radio" name="datum-theme" value="${value}"
                    ${themeNow === value ? "checked" : ""}>
                ${enggTheme.THEME_LABELS[value]}
            </label>
        `,
    ).join("");

    return `
        <h4>Units</h4>
        ${row(
            "Length unit",
            `<span class="datum-settings-value">${
                scale ? escapeHtml(scale.unit) : "mm (not yet calibrated)"
            }</span>`,
            "A sheet's unit is established by its first measured length, so it is shown rather than chosen here. Changing it would silently rescale the drawing.",
        )}
        ${row(
            "Angle unit",
            `<span class="datum-settings-value">degrees</span>`,
            "Angles are stated in degrees throughout.",
        )}

        <h4>Default appearance</h4>
        ${row(
            "Line thickness",
            `<select data-settings-default="thickness">
                <option value="0.25">0.25 mm</option>
                <option value="0.5" selected>0.50 mm</option>
                <option value="0.75">0.75 mm</option>
                <option value="1">1.00 mm</option>
            </select>`,
            "Applies to geometry drawn from now on. Existing features keep the weight they were drawn at.",
        )}
        ${row(
            "Line type",
            `<select data-settings-default="lineType">
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="center">Center</option>
                <option value="construction">Construction</option>
            </select>`,
        )}

        <h4>Display preferences</h4>
        ${row(
            "Dimensions visible",
            `<input type="checkbox" data-settings-display="showDimensions" ${
                display.showDimensions !== false ? "checked" : ""
            }>`,
            "The same setting as the Dimensions control on the style strip.",
        )}
        ${row(
            "Magnitudes visible",
            `<input type="checkbox" data-settings-display="showMagnitudes" ${
                display.showMagnitudes !== false ? "checked" : ""
            }>`,
            "The same setting as the Magnitudes control on the style strip.",
        )}
        ${row(
            "Vector scale",
            `<span class="datum-settings-value">${
                drawingState.statics?.vectorScale ?? 1
            }&times;</span>`,
            "Changed from the Vector Scale control on the style strip, where its current value is always visible.",
        )}

        <h4>Application theme</h4>
        ${row(
            "Theme",
            `<div class="datum-settings-choices">${themeChoice}</div>`,
            "Changes the interface only. It never recolours the drawing itself, and a dark interface over a light sheet is a normal combination.",
        )}

        <h4>Document</h4>
        ${row(
            "Restore default settings",
            `<button type="button" class="datum-settings-button" data-settings-reset>Restore defaults</button>`,
            "Restores the interface preferences above to their defaults. It does not change anything already drawn.",
        )}
    `;
}

/*
 * PRECISION AND SNAPPING.
 *
 * Read-only where the underlying setting does not yet exist, and HONEST about
 * it - a slider that adjusts nothing would be the fault this page is written to
 * avoid.
 */
function snappingPage() {
    const snap = drawingState.snap || {};

    return `
        <h4>Snapping</h4>
        ${row(
            "Snapping",
            `<span class="datum-settings-value">${snap.enabled === false ? "Off" : "On"}</span>`,
            "Toggled by the Snap control on the style strip, and by nothing else.",
        )}
        ${row(
            "Grid snapping",
            `<span class="datum-settings-value">${
                drawingState.grid?.snapToGrid === false ? "Off" : "On"
            }</span>`,
            "Snapping to the grid is independent of whether the grid is shown: a hidden grid can still be snapped to.",
        )}
        ${row(
            "Snap sensitivity",
            `<span class="datum-settings-value">${snap.spacing ?? 1} unit spacing</span>`,
            "The grid spacing a drawn point is snapped to.",
        )}

        <h4>Snap targets</h4>
        <p class="datum-settings-note">
            The snapping engine resolves endpoints, midpoints, centres,
            intersections and points along an entity. The bottom bar names
            whichever it has found under the cursor.
        </p>

        <h4>Geometric inference</h4>
        <p class="datum-settings-note">
            While a construction is running, the cursor infers a horizontal or
            vertical alignment from the points already placed, and the status bar
            says which. Inference is a guide, not a lock - the cursor stays where
            it is put.
        </p>
    `;
}

/*
 * MEASUREMENT AND INSPECTION.
 *
 * Measure Distance and Measure Angle explain how to measure with what the
 * application already has. They do not arm an unfinished tool.
 */
function measurementPage() {
    const selected = (drawingState.selection?.selectedObjectIds || [])
        .map((id) => drawingState.objects.find((object) => object.id === id))
        .filter(Boolean);

    const feature = selected[0];

    const scale = enggScale.readScale(drawingState);

    const detail = feature
        ? `
            ${row("Type", `<span class="datum-settings-value">${escapeHtml(feature.type)}</span>`)}
            ${row("Name", `<span class="datum-settings-value">${escapeHtml(feature.name || "(unnamed)")}</span>`)}
            ${
                feature.parentId
                    ? row(
                          "Attached to",
                          `<span class="datum-settings-value">${escapeHtml(
                              drawingState.objects.find((o) => o.id === feature.parentId)?.name ||
                                  "a feature that no longer exists",
                          )}</span>`,
                      )
                    : ""
            }
            ${row(
                "Style",
                `<span class="datum-settings-value">${escapeHtml(
                    `${feature.style?.lineType || "solid"}, ${feature.style?.lineWidth ?? 0.5} mm`,
                )}</span>`,
            )}
            ${
                feature.geometry?.start && feature.geometry?.end
                    ? row(
                          "Length",
                          `<span class="datum-settings-value">${escapeHtml(
                              `${enggDrawingState.formatEngineeringLength?.(
                                  drawingState,
                                  feature.geometry,
                              ) ?? ""}`,
                          )}</span>`,
                      )
                    : ""
            }
        `
        : `<p class="datum-settings-note">Nothing is selected.</p>`;

    return `
        <h4>Measurement</h4>
        ${row(
            "Measure a distance",
            `<span class="datum-settings-value">Smart Dimension</span>`,
            "Arm Smart Dimension and click the two points or the line to measure. The reading follows the geometry, so it stays right when the drawing changes.",
        )}
        ${row(
            "Measure an angle",
            `<span class="datum-settings-value">Smart Dimension, two lines</span>`,
            "Arm Smart Dimension and click two non-parallel lines; the angular dimension follows the cursor so the sector can be chosen.",
        )}
        ${row(
            "Current unit",
            `<span class="datum-settings-value">${escapeHtml(
                scale ? scale.unit : "mm (uncalibrated)",
            )}</span>`,
            "Readings use this sheet's unit and its World Scale.",
        )}

        <h4>Inspect selected feature</h4>
        ${detail}
        <p class="datum-settings-note">
            Inspection is read-only. Nothing here changes the drawing.
        </p>
    `;
}

function shortcutsPage() {
    const groups = SHORTCUTS.map(
        ([group, entries]) => `
            <h4>${escapeHtml(group)}</h4>
            <dl class="datum-shortcut-list">
                ${entries
                    .map(
                        ([name, keys]) => `
                            <div class="datum-shortcut-row">
                                <dt>${escapeHtml(name)}</dt>
                                <dd>${escapeHtml(keys)}</dd>
                            </div>
                        `,
                    )
                    .join("")}
            </dl>
        `,
    ).join("");

    return `
        <p class="datum-settings-note">
            Only shortcuts the application actually implements are listed.
        </p>
        ${groups}
    `;
}

const PAGES = {
    drawing: { title: "Drawing Settings", body: drawingPage },
    snapping: { title: "Precision & Snapping", body: snappingPage },
    "measure-distance": {
        title: "Measurement & Inspection",
        body: measurementPage,
    },
    "measure-angle": {
        title: "Measurement & Inspection",
        body: measurementPage,
    },
    inspect: { title: "Measurement & Inspection", body: measurementPage },
    shortcuts: { title: "Keyboard Shortcuts", body: shortcutsPage },
};

/* ------------------------------------------------------- behaviour */

function close() {
    if (openDialog) {
        openDialog.remove();
        openDialog = null;
    }
}

function isOpen() {
    return openDialog !== null;
}

/*
 * Wire the controls on the drawing page.
 *
 * EACH ONE WRITES THE SHARED STATE, not a setting of its own: the display
 * switches write `state.display`, which is what the style strip reads, so the
 * dialog and the toolbar cannot disagree.
 */
function wire(pageId, dialog) {
    if (pageId !== "drawing") {
        return;
    }

    dialog.querySelectorAll("[data-settings-display]").forEach((box) => {
        box.addEventListener("change", () => {
            const key = box.dataset.settingsDisplay;

            drawingState.display = {
                ...(drawingState.display || {}),
                [key]: box.checked,
            };

            if (key === "showDimensions") {
                drawingState.dimensionsVisible = box.checked;
            }

            /*
             * THE STYLE STRIP'S OWN TOGGLE IS UPDATED TO MATCH, through the ONE
             * function that states a toggle's state.
             *
             * It used to write `button.textContent`, which REPLACES EVERY CHILD - so
             * changing a display setting from this dialog DELETED the toolbar
             * toggle's icon and left the words in its place. The label lives in the
             * tooltip now, and `setToggleLabel` writes the class, `aria-pressed` and
             * that tooltip together, so the dialog and the button cannot disagree.
             */
            const ids = {
              showDimensions: "drawingDimensionsToggle",
              showMagnitudes: "drawingMagnitudesToggle",
            };

            const button = document.getElementById(ids[key]);

            if (button) {
              setToggleLabel(
                button,
                button.dataset.toggleName || key,
                box.checked,
              );
            }

            window.dispatchEvent(new CustomEvent("datum:display-changed"));
        });
    });

    dialog.querySelectorAll("[name='datum-theme']").forEach((radio) => {
        radio.addEventListener("change", () => {
            /*
             * THROUGH THE SHARED COMMAND, not the theme module directly: it applies
             * the theme AND re-points the default drawing line colour, so the two
             * cannot disagree. See theme-preference.js.
             */
            applyThemePreference(radio.value);
        });
    });

    dialog
        .querySelector("[data-settings-reset]")
        ?.addEventListener("click", () => {
            /*
             * Restoring defaults touches PREFERENCES, never the drawing. The
             * theme goes back to following the system, which is the state a
             * fresh installation is in.
             */
            applyThemePreference("system");

            open("drawing");
        });
}

function open(pageId) {
    const page = PAGES[pageId];

    if (!page) {
        return null;
    }

    close();

    const dialog = document.createElement("div");

    dialog.className = "datum-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", page.title);

    dialog.innerHTML = `
        <div class="datum-settings-title">
            <span>${escapeHtml(page.title)}</span>
            <button type="button" class="datum-settings-close" data-settings-close aria-label="Close">&times;</button>
        </div>
        <div class="datum-settings-body">${page.body()}</div>
    `;

    document.body.appendChild(dialog);

    openDialog = dialog;

    dialog
        .querySelector("[data-settings-close]")
        .addEventListener("click", close);

    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            close();
        }
    });

    document.addEventListener("keydown", handleKeydown, true);

    wire(pageId, dialog);

    return dialog;
}

function handleKeydown(event) {
    if (event.key === "Escape" && isOpen()) {
        event.preventDefault();
        event.stopPropagation();

        close();
    }
}

const enggSettingsDialog = {
    close,
    isOpen,
    open,
};

export default enggSettingsDialog;
