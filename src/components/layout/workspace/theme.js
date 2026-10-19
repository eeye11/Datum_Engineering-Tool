/*
 * ============================================================
 * THE APPLICATION THEME
 * ============================================================
 *
 * One preference, three values, and one place that applies it:
 *
 *     "system"  follow the operating system
 *     "light"   the light palette, whatever the OS prefers
 *     "dark"    the dark palette, whatever the OS prefers
 *
 * THE ATTRIBUTE IS THE STATE, and the palette is CSS.
 *
 * Applying a theme writes `data-theme` on `<html>` and nothing else. Every
 * colour in the interface is a token (see `tokens.css`), so re-pointing the
 * tokens re-themes the whole application at once - menus, panels, dialogs,
 * inputs, hover and focus states alike. There is deliberately no per-component
 * colour assignment, because a component that chooses its own colour is a
 * component that can be forgotten.
 *
 * `system` REMOVES the attribute rather than setting it to a third value. With
 * no attribute, the `prefers-color-scheme` block in the stylesheet supplies the
 * dark palette, so the correct theme is in place BEFORE any script runs - there
 * is no flash of the wrong palette on load, and no listener is needed to react
 * to the OS changing.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 * -----------------------------------
 * The drawing. A feature's stroke, a force's colour, a dimension's text and the
 * canvas background all belong to the DOCUMENT - they are the student's work,
 * they are saved in the file, and they are exported and printed. Re-theming the
 * interface must never recolour them, so nothing here reaches the drawing state.
 * A dark interface over a light sheet is a normal, supported combination.
 *
 * WHERE IT IS STORED
 * ------------------
 * `localStorage`, beside the other interface preferences - NOT in the document.
 * A theme is how somebody likes to work, not a property of the drawing, so
 * opening a file someone else made must not change it, and two people opening
 * the same file keep their own.
 */

const STORAGE_KEY = "datum.theme";

export const THEME_VALUES = ["system", "light", "dark"];

/*
 * THE DEFAULT DRAWING LINE COLOUR, PER THEME.
 *
 * This is the colour a NEWLY drawn feature gets when the student has not chosen
 * one. It is NOT the interface accent (`--datum-green`): the accent marks which
 * tools are ACTIVE, and a line painted in it would claim the drawing was the
 * interface's colour. It is a dark teal-charcoal on the light sheet and an
 * ice-white on the dark one, so a default line is always clearly visible against
 * the paper it is drawn on.
 *
 * IT IS READ FROM THE RESOLVED THEME, not written into the document. Existing
 * features keep the stroke they were drawn with: changing the theme must never
 * recolour work the student made - that is the one rule this module exists to
 * keep (see the header). Only a NEW feature, created after the theme changed,
 * picks up the new value.
 */
export const DEFAULT_LINE_COLOUR = {
    light: "#193335",
    dark: "#E8F5F3"
};

/*
 * The default line colour for the theme that is actually in effect right now -
 * "system" is a preference, not a palette, so it is resolved first.
 */
export function defaultLineColour() {
    return DEFAULT_LINE_COLOUR[resolvedTheme()] || DEFAULT_LINE_COLOUR.light;
}

export const THEME_LABELS = {
    system: "System Default",
    light: "Light",
    dark: "Dark"
};

/*
 * The operating system's preference, or null where it cannot be known.
 *
 * A JSDOM document, or a browser old enough to lack `matchMedia`, answers null
 * rather than guessing - so "System Default" falls back to the light palette
 * instead of the application claiming to have detected something it cannot see.
 */
function systemPrefersDark() {
    if (
        typeof globalThis.matchMedia !== "function"
    ) {
        return null;
    }

    const query = globalThis.matchMedia(
        "(prefers-color-scheme: dark)"
    );

    return Boolean(query?.matches);
}

/*
 * The saved preference, or "system" when there is none or it is unrecognised.
 *
 * A stored value that is not one of the three is treated as absent rather than
 * trusted: a hand-edited or corrupted entry must not leave the application in a
 * theme state that cannot be described in the settings dialog.
 */
export function readThemePreference() {
  let stored = null;

  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) || null;
  } catch (error) {
    /*
     * Storage can be unavailable - a private window, a blocked origin. The
     * theme still works for this session; it simply will not be remembered,
     * which is the honest outcome rather than a crash. `stored` is already
     * null, so there is nothing to correct here.
     */
  }

  return THEME_VALUES.includes(stored) ? stored : "system";
}

/*
 * APPLY A THEME TO THE DOCUMENT.
 *
 * `system` clears the attribute so the stylesheet's media query decides; the
 * other two set it outright. The attribute is set on the ROOT element, so every
 * surface inherits, including dialogs appended to `<body>` rather than nested
 * inside the workspace.
 *
 * It does not save. Reading and writing are separate on purpose: applying is
 * what a preview needs, and saving is what a confirmed choice needs.
 */
export function applyTheme(preference) {
    const chosen = THEME_VALUES.includes(preference)
        ? preference
        : "system";

    const root =
        globalThis.document?.documentElement;

    if (!root) {
        return chosen;
    }

    if (chosen === "system") {
        root.removeAttribute("data-theme");
    } else {
        root.setAttribute("data-theme", chosen);
    }

    /*
     * AND NOTHING ELSE IS TOUCHED HERE.
     *
     * `applyTheme` writes the root attribute and stops. The favicon needs
     * updating too, but it is kept OUT of this function deliberately: this is the
     * one place that must stay incapable of reaching the drawing, and a rule that
     * says "this writes one attribute on the root element" is only enforceable
     * while it is true. So the callers that COMPLETE a theme change do it - see
     * `setThemePreference` and `installSavedTheme` below.
     */
    return chosen;
}

/*
 * Remember the preference and apply it, in that order.
 *
 * APPLY FIRST, THEN STORE, so a storage failure cannot stop the theme the user
 * asked for from taking effect in the session they are in.
 */
export function setThemePreference(preference) {
    const chosen = applyTheme(preference);

    /*
     * THE DRAWING FOLLOWS, ONCE THE ATTRIBUTE IS SET.
     *
     * The canvas is SVG whose strokes are resolved for the active theme as they
     * are painted, so it has to be REPAINTED for a theme change to reach it. Until
     * it is, the sheet keeps the previous theme's ink: black lines on a charcoal
     * canvas, which is exactly the "the drawing disappears in dark mode" report.
     *
     * Doing it here, beside the favicon, is what makes the sequence complete -
     * theme, tab, canvas - in one place, so a caller cannot switch one and forget
     * another.
     */
    repaintCanvasForTheme();

    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, chosen);
    } catch (error) {
        /* Remembered for this session only. */
    }

    return chosen;
}

/*
 * REPAINT THE DRAWING IN THE NEW THEME.
 *
 * A DYNAMIC import, for the same reason `tabs.js` uses one: the renderer is a
 * large module and importing it at the top of this file would make it load before
 * the rest of the editor, reversing the start-up order the application was built
 * with. It is reached only when a theme is actually chosen.
 *
 * IT CANNOT THROW OR DELAY ANYTHING. A repaint is presentation, so a failure - or
 * a drawing that is not on screen yet - must never stop a theme from being applied
 * or Stored. A theme change on the Written Solution tab, where there is no canvas
 * to repaint, simply does nothing.
 *
 * The import is a no-op after the first call: the module is already evaluated, so
 * only the redraw happens.
 */
function repaintCanvasForTheme() {
    import("./canvas-render.js")
        .then(({ renderCurrentDrawing }) => {
            renderCurrentDrawing();
        })
        .catch(() => {
            /* No canvas to repaint, or the renderer is not up yet. */
        });
}

/*
 * WHAT THE THEME ACTUALLY RESOLVES TO, for a control that wants to show it.
 *
 * "system" is a preference, not a palette - it resolves to light or dark
 * depending on the machine - so a caller that needs the effective appearance
 * (to pick an icon, say) asks this rather than reading the preference.
 */
export function resolvedTheme() {
    const preference = readThemePreference();

    if (preference !== "system") {
        return preference;
    }

    return systemPrefersDark() === true ? "dark" : "light";
}

/*
 * Apply the saved preference at start-up.
 *
 * Called once, before the workspace is drawn, so the first frame is already in
 * the right theme.
 */
export function installSavedTheme() {
    const chosen = applyTheme(readThemePreference());

    return chosen;
}

const enggTheme = {
    DEFAULT_LINE_COLOUR,
    THEME_LABELS,
    THEME_VALUES,
    applyTheme,
    defaultLineColour,
    installSavedTheme,
    readThemePreference,
    resolvedTheme,
    setThemePreference
};

export default enggTheme;
