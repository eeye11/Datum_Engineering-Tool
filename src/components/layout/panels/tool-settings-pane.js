/*
 * ============================================================
 * THE FEATURES TAB WHEN NOTHING IS SELECTED
 * ============================================================
 *
 * Features answers two questions, and which one it answers is decided by the
 * selection, not by a tab of its own:
 *
 *   something selected   that object's own editable properties.
 *   nothing selected     the ACTIVE TOOL's construction settings and defaults.
 *
 * This module is the second half. It renders the tool's declared settings -
 * from the tool library's `features.json`, through the ONE store in
 * `tool-settings-store.js` - and nothing else.
 *
 * THE STORE IS A DEFAULT, NEVER A LIVE LINK. Writing here changes what the
 * NEXT object from this tool will be. It never touches an object already on
 * the sheet, which is why changing a default cannot silently alter the drawing.
 *
 * NO SECOND STORE. The same `settingsFor` / `toolSetting` / `toolAppearance`
 * functions the creation path reads are the ones written here, so the panel,
 * the preview and the committed feature cannot disagree about a default. The
 * store also raises `datum:tool-setting-changed`, which is what the preview
 * listens to.
 *
 * A TOOL WITH NO DECLARATION HAS NOTHING TO CONFIGURE. The Select tool, Pan and
 * the rest of the non-creating tools have no `features.json`, and this renders
 * nothing for them rather than inventing a form.
 */

import { drawingState } from "../../../features/workspace/editor-state.js";
import { toolImplementation } from "../../../tool-library/registry/tool-library-manifests.js";
import { settingsFor } from "./tool-settings-store.js";
import { openColourPicker } from "../../../shared/ui/colour-picker.js";

/*
 * The tool id a SETTINGS declaration belongs to. The toolbar arms the
 * Coordinate System tool as `coordinate-system-2d` and the Point tool as
 * `point`; the registry names them `geometry.construction.coordinate-system`
 * and `geometry.create.point`. This is the one bridge between the two
 * vocabularies, and it is stated once rather than inside each renderer.
 */
const LAYOUT_TO_LIBRARY = {
    "coordinate-system-2d": "geometry.construction.coordinate-system",
    point: "geometry.create.point",
    line: "geometry.create.line",
    triangle: "geometry.create.triangle",
    rectangle: "geometry.create.rectangle",
    circle: "geometry.create.circle",
    arc: "geometry.create.arc",
    polygon: "geometry.create.polygon",
    "freeform-polygon": "geometry.create.freeform-polygon"
};

export function libraryToolIdFor(toolId) {
    return LAYOUT_TO_LIBRARY[toolId] || null;
}

export function toolSettingsDeclaration(toolId) {
    const libraryId = libraryToolIdFor(toolId);

    return libraryId ? toolImplementation(libraryId)?.features || null : null;
}

/*
 * The settings this tool offers, as one flat list in declaration order:
 * construction first, then appearance, then the Fixed default. It is the order
 * the specification gives the rows, and the same order every tool reads in.
 */
export function settingEntries(toolId) {
    const features = toolSettingsDeclaration(toolId);

    if (!features) {
        return [];
    }

    const entries = [];

    (features.construction || []).forEach((entry) => {
        entries.push({ ...entry, scope: "construction" });
    });

    (features.appearance || []).forEach((entry) => {
        entries.push({ ...entry, scope: "appearance" });
    });

    if (features.defaultFixed !== undefined) {
        entries.push({
            key: "defaultFixed",
            label: "Fixed",
            kind: "toggle",
            default: Boolean(features.defaultFixed),
            scope: "object"
        });
    }

    return entries;
}

/* ============================================================
 * MARKUP
 * ============================================================ */

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function row(label, control) {
    return (
        `<div class="dfp-row">` +
        `<span class="dfp-row-label">${escapeHtml(label)}</span>` +
        `<span class="dfp-row-control">${control}</span>` +
        `</div>`
    );
}

function segmented(entry, value) {
    const options = entry.options || [];

    const segments = options
        .map(
            (option) =>
                `<button type="button" class="dfp-seg" role="radio" data-tool-setting-segment="${escapeHtml(entry.key)}" ` +
                `data-value="${escapeHtml(option.value)}" aria-label="${escapeHtml(option.label)}" ` +
                `aria-checked="${option.value === value ? "true" : "false"}" ` +
                `tabindex="${option.value === value ? "0" : "-1"}">${escapeHtml(option.label)}</button>`
        )
        .join("");

    return `<span class="dfp-segmented" role="radiogroup" aria-label="${escapeHtml(entry.label)}">${segments}</span>`;
}

function select(entry, value) {
    const options = (entry.options || [])
        .map(
            (option) =>
                `<option value="${escapeHtml(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`
        )
        .join("");

    return `<select class="dfp-select" data-tool-setting="${escapeHtml(entry.key)}" aria-label="${escapeHtml(entry.label)}">${options}</select>`;
}

function numberInput(entry, value) {
    const bounds = [
        Number.isFinite(entry.min) ? `min="${entry.min}"` : "",
        Number.isFinite(entry.max) ? `max="${entry.max}"` : "",
        `step="${entry.integer ? 1 : entry.step ?? 1}"`
    ]
        .filter(Boolean)
        .join(" ");

    return (
        `<input type="number" class="dfp-number" data-tool-setting="${escapeHtml(entry.key)}" ` +
        `aria-label="${escapeHtml(entry.label)}" ${bounds} value="${escapeHtml(value)}">`
    );
}

function colour(entry, value) {
    const text = String(value || "").toUpperCase();

    return (
        `<button type="button" class="dfp-colour" data-tool-setting-colour="${escapeHtml(entry.key)}" ` +
        `data-value="${escapeHtml(value)}" title="${escapeHtml(entry.label)}" ` +
        `aria-label="${escapeHtml(entry.label)}: ${escapeHtml(text)}">` +
        `<span class="dfp-colour-chip" aria-hidden="true"></span>` +
        `<span class="dfp-colour-text">${escapeHtml(text)}</span>` +
        `</button>`
    );
}

function toggle(entry, value) {
    return (
        `<label class="dfp-toggle">` +
        `<input type="checkbox" class="dfp-checkbox" data-tool-setting="${escapeHtml(entry.key)}" ` +
        `aria-label="${escapeHtml(entry.label)}"${value ? " checked" : ""}>` +
        `</label>`
    );
}

function textInput(entry, value) {
    return (
        `<input type="text" class="dfp-text" data-tool-setting="${escapeHtml(entry.key)}" ` +
        `aria-label="${escapeHtml(entry.label)}" value="${escapeHtml(value)}" autocomplete="off" spellcheck="false">`
    );
}

function controlFor(entry, value) {
    if (entry.kind === "segmented" && (entry.options || []).length) {
        return segmented(entry, value);
    }

    if (entry.kind === "choice") {
        return select(entry, value);
    }

    if (entry.kind === "colour") {
        return colour(entry, value);
    }

    if (entry.kind === "toggle") {
        return toggle(entry, value);
    }

    if (entry.kind === "number") {
        return numberInput(entry, value);
    }

    if (entry.kind === "text") {
        return textInput(entry, value);
    }

    return "";
}

/*
 * The headings the specification groups the rows under. A heading is emitted
 * only when it has a row, so an empty section is never drawn.
 */
const SECTIONS = [
    { id: "construction", heading: "Construction" },
    { id: "marker", heading: "Marker" },
    { id: "line", heading: "Line" },
    { id: "fill", heading: "Fill" },
    { id: "axes", heading: "Axes" },
    { id: "labels", heading: "Labels" },
    { id: "appearance", heading: "Appearance" },
    { id: "object", heading: "Object" }
];

/*
 * Which section a declaration entry belongs to. The declaration names the
 * SCOPE; the section is the row's family, which the specification fixes - a
 * marker's Style belongs under Marker, not under Appearance.
 */
function sectionFor(entry) {
    if (entry.scope === "construction") {
        return "construction";
    }

    if (entry.scope === "object") {
        return "object";
    }

    if (entry.key === "markerStyle" || entry.key === "markerSize") {
        return "marker";
    }

    if (entry.key === "lineType") {
        return "line";
    }

    if (entry.key === "fillMode" || entry.key === "fill") {
        return "fill";
    }

    if (entry.key === "showXAxis" || entry.key === "showYAxis") {
        return "axes";
    }

    if (entry.key === "showLabels" || /Label$/.test(entry.key)) {
        return "labels";
    }

    return "appearance";
}

/*
 * A FOLLOW-ON ROW IS SHOWN WITH ITS MODE. A Fill colour means nothing while
 * the mode is None, so the declaration's `shownWhen` is honoured here - the
 * same rule the object pane applies - rather than the colour being offered for
 * a fill that will not be drawn.
 */
function isShown(entry, settings) {
    const condition = entry.shownWhen;

    if (!condition) {
        return true;
    }

    return Object.entries(condition).every(([key, values]) =>
        (values || []).includes(settings[key])
    );
}

export function toolSettingsMarkup(toolId, settings) {
    const entries = settingEntries(toolId);

    if (!entries.length) {
        return "";
    }

    const label = toolImplementation(libraryToolIdFor(toolId))?.label || toolId;

    const header =
        `<div class="dfp-header">` +
        `<span class="dfp-header-icon dfp-header-icon-count" aria-hidden="true">\u25C6</span>` +
        `<span class="dfp-header-text">` +
        `<span class="dfp-header-type">New ${escapeHtml(label)}</span>` +
        `<span class="dfp-header-name">Tool defaults</span>` +
        `</span>` +
        `</div>`;

    const sections = [];

    SECTIONS.forEach((section) => {
        const rows = entries
            .filter((entry) => sectionFor(entry) === section.id && isShown(entry, settings))
            .map((entry) => row(entry.label, controlFor(entry, settings[entry.key])))
            .join("");

        if (rows) {
            sections.push(
                `<div class="dfp-section" data-tool-settings-group="${section.id}">` +
                `<div class="dfp-section-heading">${escapeHtml(section.heading)}</div>` +
                rows +
                `</div>`
            );
        }
    });

    return header + sections.join("");
}

/* ============================================================
 * WIRING
 * ============================================================ */

function announceChange(toolId, key, value) {
    const EventCtor = globalThis.document?.defaultView?.CustomEvent;

    if (typeof EventCtor === "function") {
        globalThis.document.dispatchEvent(
            new EventCtor("datum:tool-setting-changed", {
                detail: { toolId, key, value }
            })
        );
    }
}

function writeSetting(toolId, key, value) {
    if (!toolId) {
        return false;
    }

    const settings = settingsFor(toolId);

    if (settings[key] === value) {
        return false;
    }

    settings[key] = value;

    announceChange(toolId, key, value);

    return true;
}

/*
 * The pane is wired to the host once, at start-up. The handlers read the
 * ACTIVE TOOL at the moment of the change, so a render that happens between a
 * tool switch and a click can never write to the previous tool's store.
 */
export function installToolSettingsPane(host, onChange) {
    if (!host) {
        return;
    }

    const activeTool = () => drawingState.activeTool;

    host.addEventListener("click", (event) => {
        const swatch = event.target.closest?.("[data-tool-setting-colour]");

        if (swatch) {
            const toolId = activeTool();
            const key = swatch.dataset.toolSettingColour;

            openColourPicker({
                anchor: swatch,
                value: swatch.dataset.value,
                onChoose: (colour) => {
                    if (writeSetting(toolId, key, colour) && typeof onChange === "function") {
                        onChange();
                    }
                }
            });

            return;
        }

        const segment = event.target.closest?.("[data-tool-setting-segment]");

        if (segment) {
            const toolId = activeTool();
            const key = segment.dataset.toolSettingSegment;
            const value = segment.dataset.value;

            /* A construction method ALSO arms the construction, so the next
             * drag follows the method the student just chose. */
            if (key === "method") {
                applyMethod(toolId, value);
            }

            if (writeSetting(toolId, key, value) && typeof onChange === "function") {
                onChange();
            }
        }
    });

    host.addEventListener("change", (event) => {
        const control = event.target;
        const key = control?.dataset?.toolSetting;

        if (!key) {
            return;
        }

        const toolId = activeTool();

        let value = control.value;

        if (control.type === "checkbox") {
            value = control.checked;
        } else if (control.type === "number") {
            if (control.value === "") {
                return;
            }

            value = Number(control.value);
        }

        if (writeSetting(toolId, key, value) && typeof onChange === "function") {
            onChange();
        }
    });
}

/*
 * THE CONSTRUCTION METHOD IS TWO DIFFERENT SETTINGS.
 *
 * An Arc's method decides its PHASES and a Polygon's decides its first point,
 * and both already live on the interaction while a construction runs. The
 * tool's own `features.json` names the setting `method`; the geometry reads
 * `arcMode` / `polygonMode`. Converting here means a method chosen in the panel
 * changes what the next gesture does, without the interaction growing a second
 * copy of the setting.
 */
function applyMethod(toolId, value) {
    const interaction = drawingState.interaction;

    if (!interaction) {
        return;
    }

    if (toolId === "arc" || toolId === "reference-arc") {
        interaction.arcMode = value === "three-point" ? "three-point" : "centrepoint";
    }

    if (toolId === "polygon") {
        interaction.polygonMode = value === "sides" ? "sides" : "centre";
    }
}

export default {
    libraryToolIdFor,
    toolSettingsDeclaration,
    settingEntries,
    toolSettingsMarkup,
    installToolSettingsPane
};
