/*
 * ============================================================
 * COMMAND SEARCH
 * ============================================================
 *
 * One field, at the start of the quick-access toolbar, that finds a COMMAND by
 * name and runs it. It is command discovery, not document-text search: typing
 * "trim" finds the Trim tool, "print" finds File > Print, "dark" finds the
 * theme setting.
 *
 * WHY IT IS DRIVEN BY THE MENUS RATHER THAN A LIST OF ITS OWN
 * ----------------------------------------------------------
 * Every command the application offers is already declared in
 * `editor/menu-commands.js` - with its label, its menu, and the function that
 * runs it. A search that kept its own catalogue would be a second list of the
 * same commands, and the first one to change would leave the search silently
 * returning something that no longer exists.
 *
 * So the catalogue IS the menu tree. A command added to a menu is findable the
 * moment it is written, with no second edit - which is the property worth
 * having.
 *
 * EVERY RESULT RUNS SOMETHING REAL. A result is built from a menu item that
 * already has a `run`, so selecting it invokes the same function the menu
 * invokes. There are no decorative results, because a result that does nothing
 * teaches the student that the search is unreliable.
 */

import { MENUS } from "./menu-commands.js";

let openPanel = null;

let onDocumentPointerDown = null;

/*
 * THE CATALOGUE, rebuilt from the menus each time the field is used.
 *
 * Built on demand rather than cached, because a menu item's state moves - a
 * command that is disabled now may not be in a moment - and a stale catalogue
 * would let the search run something the menu would have greyed out. The menus
 * are cheap to build (a handful of objects), so there is nothing to gain by
 * caching and a correctness risk in doing it.
 */
function catalogue() {
    const entries = [];

    MENUS.forEach((menu) => {
        /* Each menu is a FUNCTION, for the reason recorded in menu-commands.js. */
        const definition = menu();

        definition.items.forEach((item) => {
            if (item.separator) {
                return;
            }

            /*
             * A searchable entry keeps the menu's own `run`, `label` and
             * `icon`, so a result behaves exactly as the menu item does.
             */
            if (typeof item.run === "function") {
                entries.push({
                    id: `${definition.id}:${item.id}`,
                    label: item.label,
                    menu: definition.label,
                    icon: item.icon,
                    run: item.run,
                    disabled: item.disabled === true,
                });
            }
        });
    });

    return entries;
}

/*
 * THE SETTINGS PAGES ARE COMMANDS TOO, AND THEY ARE SEARCHABLE BY NAME.
 *
 * A menu item only carries the words on its face - "Drawing Settings…" - so
 * searching for what is INSIDE that dialog found nothing. "Dark Mode" is the
 * case that matters: the theme lives at Drawing Settings > Appearance >
 * Application Theme, and a student looking for it types those words, not the
 * name of the dialog it happens to be inside.
 *
 * Each entry here names a term a student would actually type and the menu item
 * that opens it, so the search reaches the setting through the same command the
 * menu offers - it does not open the dialog by a second route.
 */
const SEARCH_ALIASES = [
    { terms: ["dark mode", "dark", "light mode", "theme", "appearance", "colour scheme", "color scheme"], target: "tools:drawing-settings" },
    { terms: ["units", "millimetres", "millimeters", "precision"], target: "tools:drawing-settings" },
    { terms: ["snapping", "snap sensitivity", "snap targets", "inference", "grid snap"], target: "tools:precision" },
    { terms: ["measure distance", "measurement", "measure", "measure angle", "protractor"], target: "tools:measure-distance" },
    { terms: ["inspect", "inspection", "properties", "selected feature", "info"], target: "tools:inspect" },
    { terms: ["shortcuts", "keyboard", "hotkeys", "keys"], target: "tools:shortcuts" },
    { terms: ["save", "save as", "export"], target: "file:save" },
    { terms: ["print", "printer", "output"], target: "file:print" },
    { terms: ["fit", "zoom to fit", "fit to screen"], target: "view:fit" },
    { terms: ["grid", "show grid", "hide grid"], target: "view:grid" },
    { terms: ["dimensions", "show dimensions", "hide dimensions"], target: "view:dimensions" },
    { terms: ["magnitudes", "vectors", "show magnitudes"], target: "view:magnitudes" },
    { terms: ["trim", "cut back"], target: "tools:trim" },
    { terms: ["extend", "lengthen"], target: "tools:extend" },
    { terms: ["select all", "everything"], target: "edit:select-all" },
];

/*
 * A searchable entry for a term, resolved to the command that opens it.
 *
 * The ENTRY is the command - its label, its icon and its `run`. What the alias
 * adds is the words that find it, so a result still reads "Drawing Settings…"
 * and still runs exactly what the menu runs.
 */
function aliasEntries(entries) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    const aliased = [];

    SEARCH_ALIASES.forEach((alias) => {
        const target = byId.get(alias.target);

        if (!target) {
            /*
             * The command an alias points at does not exist. Skipped rather
             * than invented: an alias that matched nothing would be a search
             * result that cannot run, which is the failure this whole module
             * avoids.
             */
            return;
        }

        aliased.push({
            ...target,
            /*
             * The words a student would type. Kept beside the entry rather
             * than merged into its label, so the RESULT still shows the
             * command's real name.
             */
            searchTerms: alias.terms,
        });
    });

    return aliased;
}

/*
 * Matching, and the order results come back in.
 *
 * A PREFIX BEATS A SUBSTRING: typing "sav" should offer Save before "Save As".
 * And a whole-word match beats a mid-word one, so "print" finds "Print" before
 * "Print Preview".
 *
 * AN ALIAS RANKS AFTER A REAL NAME. An alias is a way IN, not a second name: a
 * student who types "dark mode" should find the theme, and the result should
 * still read "Drawing Settings…” - so a match on the command's own label always
 * comes first, and a match on a term it answers to follows.
 */
function score(entry, query) {
    const target = query.toLowerCase();

    const direct = scoreText(entry.label.toLowerCase(), target);

    if (direct >= 0) {
        return direct;
    }

    if (Array.isArray(entry.searchTerms)) {
        const viaAlias = entry.searchTerms.some((term) =>
            term.toLowerCase().includes(target),
        );

        if (viaAlias) {
            return 5;
        }
    }

    /* The menu's own name, so "edit" finds everything under Edit. */
    if (entry.menu.toLowerCase().includes(target)) {
        return 6;
    }

    return -1;
}

/* How well one name answers a query, or -1 when it does not. */
function scoreText(label, target) {
    if (label === target) {
        return 0;
    }

    if (label.startsWith(target)) {
        return 1;
    }

    /* A word inside the label starting with the query. */
    if (label.split(/[\s\u2026/]+/).some((word) => word.startsWith(target))) {
        return 2;
    }

    if (label.includes(target)) {
        return 3;
    }

    return -1;
}

export function searchCommands(query, limit = 8) {
    const text = String(query ?? "").trim();

    if (!text) {
        return [];
    }

    return aliasEntries(catalogue())
        .map((entry) => ({ entry, rank: score(entry, text) }))
        .filter((result) => result.rank >= 0)
        .sort(
            (first, second) =>
                first.rank - second.rank ||
                first.entry.label.length - second.entry.label.length,
        )
        .slice(0, limit)
        /*
         * ONE ROW PER COMMAND. An alias and a label match can both point at the
         * same command, and two identical results would look like a bug.
         */
        .filter(
            (result, index, all) =>
                all.findIndex((other) => other.entry.id === result.entry.id) === index,
        )
        .map((result) => result.entry);
}

/* -------------------------------------------------- the field and list */

function closeResults() {
    if (openPanel) {
        openPanel.remove();
        openPanel = null;
    }

    if (onDocumentPointerDown) {
        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        onDocumentPointerDown = null;
    }
}

export function isSearchOpen() {
    return Boolean(openPanel);
}

export function closeSearch() {
    closeResults();

    const field = document.querySelector("[data-command-search]");

    if (field) {
        field.value = "";
    }
}

/*
 * Wire the search field.
 *
 * The field itself is in the toolbar markup; this attaches the behaviour. It is
 * called once at start-up with the input element.
 */
export function installCommandSearch(input) {
    if (!input) {
        return null;
    }

    input.addEventListener("input", () => {
        const results = searchCommands(input.value);

        renderResults(input, results);
    });

    input.addEventListener("focus", () => {
        if (input.value.trim()) {
            renderResults(input, searchCommands(input.value));
        }
    });

    /*
     * KEYBOARD: arrows move, Enter runs, Escape closes. The field is a search
     * box, so the visitor's hands are already on the keyboard and reaching for
     * the mouse to pick the third result would be a step backwards.
     */
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();

            closeSearch();

            return;
        }

        const items = [...(openPanel?.querySelectorAll("[data-search-result]") ?? [])];

        if (!items.length) {
            return;
        }

        const current = items.findIndex((item) =>
            item.classList.contains("datum-search-active"),
        );

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();

            const step = event.key === "ArrowDown" ? 1 : -1;

            const next =
                current < 0
                    ? step > 0
                        ? 0
                        : items.length - 1
                    : (current + step + items.length) % items.length;

            items.forEach((item, index) =>
                item.classList.toggle("datum-search-active", index === next),
            );

            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();

            const chosen = items[current < 0 ? 0 : current];

            if (chosen) {
                chosen.click();
            }
        }
    });

    return input;
}

function renderResults(input, results) {
    closeResults();

    if (!results.length) {
        return;
    }

    const panel = document.createElement("div");

    panel.className = "datum-search-results";
    panel.setAttribute("role", "listbox");

    results.forEach((entry, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "datum-search-result";
        button.dataset.searchResult = entry.id;
        button.setAttribute("role", "option");

        if (index === 0) {
            button.classList.add("datum-search-active");
        }

        /*
         * THE MENU LOCATION IS SHOWN, because the point of the search is often
         * to learn WHERE a command lives - the second time, the student goes
         * straight to the menu.
         */
        button.innerHTML = `
            <span class="datum-search-result-label">${entry.label}</span>
            <span class="datum-search-result-menu">${entry.menu}</span>
        `;

        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            closeSearch();

            /*
             * THE REAL COMMAND. It is the menu's own `run`, so this cannot do
             * anything the menu could not - including refusing quietly when the
             * command is disabled.
             */
            entry.run();
        });

        panel.appendChild(button);
    });

    /*
     * THE LIST IS POSITIONED UNDER THE FIELD, in the document rather than inside
     * the toolbar, so it can extend past the toolbar's own edge without the
     * toolbar clipping it.
     */
    document.body.appendChild(panel);

    const rect = input.getBoundingClientRect();

    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.top = `${Math.round(rect.bottom + 2)}px`;
    panel.style.minWidth = `${Math.round(Math.max(rect.width, 240))}px`;

    openPanel = panel;

    /* A click anywhere else closes the list. */
    onDocumentPointerDown = (event) => {
        if (
            !panel.contains(event.target) &&
            event.target !== input
        ) {
            closeResults();
        }
    };

    document.addEventListener("pointerdown", onDocumentPointerDown, true);
}

/*
 * The Ctrl+K binding, where one is wanted.
 *
 * It is installed here rather than in `keyboard-shortcuts.js` because it is
 * search's own key, and the handler there is already long. It refuses while a
 * field has focus, so Ctrl+K typed into a text box stays with that text box.
 */
export function installCommandSearchShortcut(input) {
    if (!input) {
        return;
    }

    document.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") {
            return;
        }

        const active = document.activeElement;

        const editing =
            active &&
            (["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) ||
                active.isContentEditable);

        if (editing && active !== input) {
            return;
        }

        event.preventDefault();

        input.focus();
        input.select();
    });
}

const enggCommandSearch = {
    closeSearch,
    installCommandSearch,
    installCommandSearchShortcut,
    isSearchOpen,
    searchCommands,
};

export default enggCommandSearch;
