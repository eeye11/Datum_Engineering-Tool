/*
 * ============================================================
 * THE PER-TOOL SETTINGS STORE
 * ============================================================
 *
 * The Features tab no longer configures the armed tool - it edits the SELECTED
 * object, and is empty when nothing is selected. The store below is not that
 * panel: it is the handful of defaults creation still reads.
 *
 * Every tool that has settings declares them in its own folder, as data
 * (<tool>/features.json, loaded by the registry's manifest loader). A tool with
 * no features.json genuinely has none. The store is on the shared editor state,
 * keyed by tool id (`editorState.toolSettings[toolId]`), and it is created
 * lazily from the declaration's own defaults - so it cannot disagree with the
 * file that declares the settings, and a tool never used costs nothing.
 *
 * THE STORE IS A DEFAULT, NEVER A LIVE LINK. Changing a setting must affect the
 * NEXT object the tool creates, never the ones already drawn - which is exactly
 * why it is separate from the object model. Nothing here writes to
 * `drawingState.objects`.
 *
 * WHO APPLIES THEM. A creation path that wants a tool's construction values or
 * its appearance defaults reads them through `toolSetting` / `toolAppearance`,
 * and `defaultFixedFor` answers the Fixed question for new objects. This module
 * owns the store only; with the object-editing panel owning the Features tab,
 * nothing renders these as a form any more.
 */

import { editorState } from "../../../features/workspace/editor-state.js";
import { toolImplementation } from "../../../tool-library/registry/tool-library-manifests.js";

/*
 * The settings for one tool, created on first use from the declaration's own
 * defaults. Exported so a future tool-settings editor can write through the same
 * store rather than growing a second one.
 */
export function settingsFor(toolId) {
    if (!editorState.toolSettings) {
        editorState.toolSettings = {};
    }

    if (!editorState.toolSettings[toolId]) {
        const features = toolImplementation(toolId)?.features;
        const settings = {};

        (features?.construction || []).forEach((entry) => {
            settings[entry.key] = entry.default;
        });

        (features?.appearance || []).forEach((entry) => {
            settings[entry.key] = entry.default;
        });

        editorState.toolSettings[toolId] = settings;
    }

    return editorState.toolSettings[toolId];
}

/*
 * One construction setting's current value, or the declaration's default when
 * the tool has never been configured. The fallback is what makes this safe for
 * a tool whose settings store was never opened: an absent entry means "as
 * declared", not "undefined".
 */
export function toolSetting(toolId, key) {
    const features = toolImplementation(toolId)?.features;
    const declared = (features?.construction || []).find((entry) => entry.key === key);

    const settings = editorState.toolSettings?.[toolId];

    if (settings && Object.prototype.hasOwnProperty.call(settings, key)) {
        return settings[key];
    }

    return declared ? declared.default : undefined;
}

/*
 * The appearance defaults for the objects a tool creates, as the object model's
 * style shape: only the keys a tool declares, with nothing invented. A style
 * the tool does not declare is left for the sheet's own style defaults, which
 * is where the application already keeps stroke and fill for features drawn
 * without a panel.
 */
export function toolAppearance(toolId) {
    const features = toolImplementation(toolId)?.features;
    const settings = editorState.toolSettings?.[toolId];
    const style = {};

    (features?.appearance || []).forEach((entry) => {
        const value = settings
            ? settings[entry.key]
            : entry.default;

        if (value !== undefined) {
            style[entry.key] = value;
        }
    });

    return style;
}

/*
 * Whether objects created with this tool start Fixed. A tool without a
 * features.json defaults to false - the honest answer rather than a guessed
 * one - and the setting is read from the same store, so the store and the
 * creation path cannot disagree.
 */
export function defaultFixedFor(toolId) {
    const features = toolImplementation(toolId)?.features;

    if (!features) {
        return false;
    }

    const settings = editorState.toolSettings?.[toolId];

    return settings
        ? Boolean(settings.defaultFixed)
        : Boolean(features.defaultFixed);
}

export default {
    toolSetting,
    toolAppearance,
    defaultFixedFor
};
