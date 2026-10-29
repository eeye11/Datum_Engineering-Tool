/*
 * ============================================================
 * COMMAND SEARCH
 * ============================================================
 *
 * One field, at the start of the quick-access toolbar, that finds ANYTHING in
 * DAETUM by the words a student would type: a tool, the section that holds it,
 * a command on the menu bar, a panel, a source tool. Typing "elbow" finds the
 * Elbow tool under Fluids; "fluids" finds the Fluids category; "zoom" finds the
 * zoom commands; "open source" finds the Source tab.
 *
 * WHAT IT SEARCHES, AND WHERE THAT LIST COMES FROM
 * ------------------------------------------------
 * The index in `command-index.js`: the toolset the toolbar renders, the menu
 * tree, the panel destinations and the source tab's own controls, derived from
 * the modules that already declare them. Nothing here keeps a catalogue - so a
 * tool added to a section is searchable the day it is declared, and one removed
 * stops being offered.
 *
 * EVERY RESULT RUNS SOMETHING REAL. A tool result navigates to its category,
 * opens its group and activates the tool through the same `activateTool` a
 * button uses. A section result navigates without arming anything. A command
 * runs the menu's own handler - with the menu's own disabled state respected.
 * There are no decorative results, because a result that does nothing teaches
 * the student that the search is unreliable.
 *
 * MATCHING IS FORGIVING ON PURPOSE. Case is ignored, punctuation is ignored,
 * plurals and a trailing "s" are folded, a few common misspellings are fixed,
 * multi-word queries may match in any order, and a small edit distance is
 * allowed on long words. But an EXACT name always outranks a name that merely
 * contains the query somewhere: "print" must offer Print, not Print Preview.
 */

import { DISCIPLINES, openCategory, openSection, searchIndex } from "./command-index.js";

let openPanel = null;

let onDocumentPointerDown = null;

/* The results the open list is showing, in order. */
let renderedResults = [];

/* The row the keyboard is on, within `renderedResults`. */
let activeIndex = 0;

const MAX_RESULTS = 14;

/*
 * WORDS PEOPLE MISPRONOUNCE OR MISSPELL. Kept small and deliberate: a wide
 * correction table starts "fixing" words that are already right. Each entry
 * maps a common misspelling of a word DAETUM uses onto that word.
 */
const CORRECTIONS = {
  colur: "colour",
  colr: "colour",
  coulour: "colour",
  color: "colour",
  referee: "reference",
  refrence: "reference",
  referance: "reference",
  dimention: "dimension",
  dimenson: "dimension",
  hyraulic: "hydraulic",
  hydralic: "hydraulic",
  themodynamics: "thermodynamics",
  thermodyamics: "thermodynamics",
  triange: "triangle",
  rectangel: "rectangle",
  flud: "fluids",
  fliud: "fluids",
  pressue: "pressure",
  presure: "pressure",
  nozzel: "nozzle",
  turbin: "turbine",
  compresor: "compressor",
  juncton: "junction",
  elbo: "elbow",
};

/* --------------------------------------------------------------- the scoring */

/*
 * A text returned to a comparable shape: lower case, no punctuation, single
 * spaces. "Pipe / Duct" becomes "pipe duct", "Note / Text" becomes "note text",
 * and "Ideal Vapor-Compression" becomes "ideal vapor compression".
 */
export function normalise(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* The words of a query, corrected. */
function queryWords(query) {
  return normalise(query)
    .split(" ")
    .filter(Boolean)
    .map((word) => CORRECTIONS[word] || word);
}

/*
 * Whether a query word answers a field word, and how: "exact", "prefix",
 * "singular", "plural" or "near" (a typo). Null when it does not.
 *
 * A PREFIX NEEDS THREE LETTERS. Two letters are not enough to mean anything:
 * "gr" would otherwise reach a Graph and a Grid alike, and a two-letter query
 * is exactly what a student types first.
 */
function wordMatches(query, word) {
  if (word === query) {
    return "exact";
  }

  if (word.startsWith(query) && query.length >= 3) {
    return "prefix";
  }

  /*
   * PLURALS AND A TRAILING "S" ARE THE SAME WORD. "pipes"/"pipe",
   * "loads"/"load" and "gears"/"gear" are one edit apart in meaning as well as
   * spelling, and a student types either.
   */
  if (query.endsWith("s") && word === query.slice(0, -1)) {
    return "singular";
  }

  if (word.endsWith("s") && query === word.slice(0, -1)) {
    return "plural";
  }

  /*
   * A TYPO IN A LONGER WORD. One edit is forgiven from four characters, two
   * from eight. Short words are not corrected: "arc" and "bar" are one edit
   * apart and mean different things.
   */
  if (query.length >= 4 && word.length >= 4) {
    const distance = editDistance(query, word);

    if (distance <= (Math.max(query.length, word.length) >= 8 ? 2 : 1)) {
      return "near";
    }
  }

  return null;
}

/* Levenshtein distance, capped so a hopeless comparison stays cheap. */
function editDistance(first, second) {
  if (Math.abs(first.length - second.length) > 3) {
    return 99;
  }

  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let i = 1; i <= first.length; i += 1) {
    let diagonal = previous[0];

    previous[0] = i;

    for (let j = 1; j <= second.length; j += 1) {
      const carried = previous[j];

      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (first[i - 1] === second[j - 1] ? 0 : 1),
      );

      diagonal = carried;
    }
  }

  return previous[second.length];
}

/*
 * How well one entry answers one query, or -1.
 *
 * THE ORDER OF THE TESTS IS THE RANKING. A whole-name match beats a name that
 * starts with the query, which beats a name with a word that starts with it,
 * which beats a name that merely contains it; the entry's location, its own
 * description and finally its aliases follow. Lower is better.
 */
function scoreEntry(entry, words, phrase) {
  const label = normalise(entry.label);

  const aliases = (entry.terms || []).map(normalise);

  /* The whole name against the whole query. */
  if (label === phrase) {
    return 0;
  }

  /*
   * The whole name against a single word, allowing a plural or a typo.
   *
   * A TYPO IS NOT FORGIVEN AGAINST THE WHOLE NAME. "print" is one edit from
   * "point" and two words that sound nothing alike; correcting at this level
   * put Point in front of Print. A typo is only considered against words of
   * five letters or more, and even then it ranks below every direct match.
   */
  if (words.length === 1) {
    const single = wordMatches(words[0], label);

    if (single === "singular" || single === "plural") {
      return 1;
    }

    if (single === "near" && Math.min(words[0].length, label.length) >= 5) {
      return 9;
    }
  }

  /*
   * A PREFIX OF THE WHOLE NAME. "zoomn" is not a prefix of anything, but
   * "zone" is a prefix of "zones"; a one-letter typo at the END of a long word
   * is forgiven here too, and nowhere else.
   */
  if (
    words.length === 1 &&
    words[0].length >= 5 &&
    label.length >= 5 &&
    (label.startsWith(words[0]) || editDistance(words[0], label.slice(0, words[0].length)) <= 1)
  ) {
    return 1;
  }

  if (label.startsWith(`${phrase} `)) {
    return 1;
  }

  const labelWords = label.split(" ");

  if (words.length > 1) {
    /*
     * A MULTIWORD QUERY NEEDS EVERY WORD SOMEWHERE. "flow arrow" must not match
     * a Flow Meter: every word of the query has to be accounted for by the
     * label or by the entry's own terms.
     */
    const haystackWords = [label, ...aliases].join(" ").split(" ");

    const matched = words.map((word) =>
      haystackWords
        .map((candidate) => wordMatches(word, candidate))
        .filter(Boolean),
    );

    if (matched.some((hits) => hits.length === 0)) {
      return -1;
    }

    const inLabel = words.every((word) =>
      labelWords.some((candidate) => wordMatches(word, candidate)),
    );

    return inLabel ? 2 : 4;
  }

  const query = words[0];

  if (labelWords.some((word) => word === query)) {
    return 2;
  }

  if (labelWords.some((word) => word.startsWith(query))) {
    return 3;
  }

  if (label.includes(query)) {
    return 4;
  }

  /* An alias: the words people type that are not on the button. */
  if (aliases.some((alias) => alias === query)) {
    return 5;
  }

  if (aliases.some((alias) => alias.split(" ").includes(query))) {
    return 6;
  }

  if (
    aliases.some((alias) =>
      alias.split(" ").some((word) => word.startsWith(query)),
    )
  ) {
    return 7;
  }

  if (
    aliases.some((alias) =>
      alias.split(" ").some((word) => wordMatches(query, word)),
    )
  ) {
    return 8;
  }

  if (aliases.some((alias) => alias.includes(query))) {
    return 9;
  }

  /*
   * The place it lives, so "fluids" finds everything under Fluids - but WEAKLY.
   * A tool in the Fluids section is not what "fluids" means; the section is.
   * It has to rank below every alias, which the location's number guarantees.
   */
  const location = normalise(`${entry.location || ""} ${entry.section || ""}`);

  if (location.split(" ").includes(query)) {
    return 10;
  }

  if (location.includes(query)) {
    return 11;
  }

  return -1;
}

/*
 * A TYPO IN A WORD OF A LONGER LABEL: "dimension" typed as "dimenion" should
 * still reach the Dimension tool. It is applied only to labels of two words or
 * fewer and only to words of five letters or more, and it never reaches a name
 * that a direct match found.
 */
function fuzzyLabelScore(entry, words) {
  if (words.length !== 1) {
    return -1;
  }

  const query = words[0];

  if (query.length < 5) {
    return -1;
  }

  const labelWords = normalise(entry.label).split(" ");

  if (labelWords.length > 3) {
    return -1;
  }

  return labelWords.some(
    (word) => word.length >= 5 && wordMatches(query, word) === "near",
  )
    ? 9
    : sectionTypos(query, entry.terms || [], entry.discipline || "");
}

/*
 * A TYPO IN A DISCIPLINE'S NAME still reaches it: "amalysis" or "statcis" is
 * a student misspelling a heading, and the heading is what they should land on.
 * A section is the only place a two-edit forgiveness is allowed, because its
 * name is short and long, and a section's tools carry that name so the section
 * itself is what is offered first.
 */
function sectionTypos(query, terms, discipline) {
  if (query.length < 5) {
    return -1;
  }

  void discipline;

  const hits = terms.some((term) => {
    const word = normalise(term);

    return (
      word.length >= 5 &&
      !word.includes(" ") &&
      editDistance(query, word) <= (word.length >= 8 ? 2 : 1)
    );
  });

  return hits ? 12 : -1;
}

/* ----------------------------------------------------------------- the search */

/*
 * Search the whole index.
 *
 * The result is the entry plus the rank it earned, ordered best first. Ties are
 * broken towards the shorter name (so "Save" comes before "Save As"), then
 * towards the entry type's own order - a tool before the section that holds it,
 * so a query naming both offers the thing to use first.
 */
export function searchCommands(query, limit = MAX_RESULTS) {
  const text = String(query ?? "").trim();

  if (!text) {
    return [];
  }

  const words = queryWords(text);

  if (!words.length) {
    return [];
  }

  const phrase = words.join(" ");

  const scored = searchIndex()
    .map((entry) => {
      const rank = scoreEntry(entry, words, phrase);

      return { entry, rank: rank >= 0 ? rank : fuzzyLabelScore(entry, words) };
    })
    .filter((result) => result.rank >= 0)
    .sort(
      (first, second) =>
        first.rank - second.rank ||
        TYPE_ORDER[first.entry.type] - TYPE_ORDER[second.entry.type] ||
        first.entry.label.length - second.entry.label.length ||
        first.entry.label.localeCompare(second.entry.label),
    );

  const seen = new Set();

  return scored
    /*
     * ONE ROW PER ENTRY. The index is unique already; this guards the case a
     * later source forgets to be.
     */
    .filter(({ entry }) => {
      if (seen.has(entry.id)) {
        return false;
      }

      seen.add(entry.id);

      return true;
    })
    .slice(0, limit)
    .map(({ entry, rank }) => ({ ...entry, rank }));
}

/*
 * TIES GO TO THE TOOL, THEN THE SETTING, THEN THE PLACE, THEN THE COMMAND.
 *
 * A student who types "pipe width" wants the width, not the tool that would
 * draw another pipe - but one who types "pipe" wants the tool, and both land
 * on a direct name match. The order settles those two cases the way each of
 * them is meant.
 */
const TYPE_ORDER = { tool: 0, feature: 1, section: 2, command: 3, panel: 4, view: 5 };

/* ---------------------------------------------------------- the panel and field */

function closeResults() {
  if (openPanel) {
    openPanel.remove();
    openPanel = null;
  }

  if (onDocumentPointerDown) {
    globalThis.document.removeEventListener(
      "pointerdown",
      onDocumentPointerDown,
      true,
    );
    onDocumentPointerDown = null;
  }

  renderedResults = [];
  activeIndex = 0;
}

export function isSearchOpen() {
  return Boolean(openPanel);
}

export function closeSearch() {
  closeResults();

  const field = globalThis.document.querySelector("[data-command-search]");

  if (field) {
    field.value = "";
    field.dataset.chosen = "false";
    field.removeAttribute("title");
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
  }
}

/*
 * Wire the search field.
 *
 * The field is in the toolbar markup; this attaches the behaviour. It is called
 * once at start-up with the input element.
 */
export function installCommandSearch(input) {
  if (!input) {
    return null;
  }

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  input.addEventListener("input", () => {
    renderResults(input, searchCommands(input.value));
  });

  input.addEventListener("focus", () => {
    /*
     * THE LAST CHOICE IS SELECTED, NOT SEARCHED FOR AGAIN. Its name is a record,
     * so focusing the field selects it and a keystroke replaces it; showing the
     * results for it would offer the thing the student has already picked.
     */
    if (input.dataset.chosen === "true") {
      input.select();
      return;
    }

    if (input.value.trim()) {
      renderResults(input, searchCommands(input.value));
    }
  });

  /*
   * KEYBOARD: arrows move, Enter runs, Escape closes. The field is a search
   * box, so the hands are already on the keyboard and reaching for the mouse to
   * pick the third result would be a step backwards.
   *
   * The arrow that runs off either end wraps, which is what makes a long list
   * one press from its own beginning.
   */
  input.addEventListener("keydown", (event) => {
    /* A keystroke on the last choice's name starts a new search with it. */
    if (
      input.dataset.chosen === "true" &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const selected = input.selectionEnd - input.selectionStart === input.value.length;

      if (selected || input.selectionStart === input.value.length) {
        input.value = "";
        input.dataset.chosen = "false";
        input.removeAttribute("title");
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      closeSearch();
      input.blur();

      return;
    }

    if (!renderedResults.length) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      const step = event.key === "ArrowDown" ? 1 : -1;

      setActive((activeIndex + step + renderedResults.length) % renderedResults.length);

      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();

      setActive(event.key === "Home" ? 0 : renderedResults.length - 1);

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const chosen = renderedResults[activeIndex];

      if (chosen) {
        activate(chosen, input);
      }
    }
  });

  return input;
}

/* Move the highlight, and keep it in view. */
function setActive(index) {
  activeIndex = index;

  const items = openPanel
    ? [...openPanel.querySelectorAll("[data-search-result]")]
    : [];

  items.forEach((item, position) => {
    const highlighted = position === index;

    item.classList.toggle("datum-search-active", highlighted);
    item.setAttribute("aria-selected", highlighted ? "true" : "false");

    if (highlighted && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  });

  const field = globalThis.document.querySelector("[data-command-search]");

  if (field && items[index]) {
    field.setAttribute("aria-activedescendant", items[index].id);
  }
}

/*
 * Run a result.
 *
 * A result that cannot run says why and leaves the list open, so the reason is
 * read where the student was looking rather than being lost to a status line
 * behind the panel. A result that CAN run closes the search first: the student
 * asked to be taken somewhere, and a list floating over the place they were
 * taken to would be in the way.
 */
async function activate(entry, input) {
  if (entry.disabled || typeof entry.run !== "function") {
    explain(entry);
    return;
  }

  /*
   * THE FIELD SHOWS WHAT WAS CHOSEN UNTIL IT IS NEXT USED. It is cleared as the
   * search closes - so it does not sit there as a filter - and then set to the
   * result's name, because the student has just made a choice and the field is
   * the last thing they were looking at. The name is a record of that choice,
   * not a query: it is selected, so typing replaces it.
   */
  closeSearch();

  input?.blur();

  if (input) {
    input.value = entry.label;
    input.dataset.chosen = "true";
    input.setAttribute("title", `Selected: ${entry.label}`);
  }

  await entry.run();
}

/* Say why a result cannot run, in the row itself. */
function explain(entry) {
  const rows = openPanel
    ? [...openPanel.querySelectorAll("[data-search-result]")]
    : [];

  const row = rows.find((candidate) => candidate.dataset.searchResult === entry.id);

  if (!row) {
    return;
  }

  row.classList.add("datum-search-result-blocked");

  const note = row.querySelector(".datum-search-result-reason");

  if (note) {
    note.textContent = `Needs: ${entry.reason}`;
    note.hidden = false;
  }
}

/* ------------------------------------------------------------- rendering */

/*
 * WHAT EACH RESULT IS, IN THE STUDENT'S WORDS.
 *
 * The words sit AFTER the name, inside the location line ("Fluids › Create ›
 * Flow Paths · Tool"), rather than in a tag in front of it. The name is what a
 * student scans for, so it goes first; the kind is the quiet qualifier that
 * tells a tool from the section that holds it.
 */
const TYPE_LABELS = {
  tool: "Tool",
  section: "Section",
  command: "Command",
  panel: "Panel",
  view: "View",
  /*
   * A feature is called by what it IS when it is a setting - "Setting" says
   * more than "Feature" about a row that opens a Width box - and by the plainer
   * word otherwise, because "Bottom Pipe" is a drawing, not a control.
   */
  feature: "On the sheet",
  setting: "Setting",
};

function renderResults(input, results) {
  closeResults();

  if (!results.length) {
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");

    if (input.value.trim()) {
      renderEmpty(input);
    }

    return;
  }

  renderedResults = results;
  activeIndex = 0;

  const panel = globalThis.document.createElement("div");

  panel.className = "datum-search-results";
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Search results");

  results.forEach((entry, index) => {
    panel.appendChild(resultRow(entry, index, input));
  });

  place(panel, input);

  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", "datum-search-result-0");
}

/*
 * THE LIST IS POSITIONED UNDER THE FIELD, in the document rather than inside
 * the toolbar, so it can extend past the toolbar's own edge without being
 * clipped by it. A click anywhere else closes it.
 */
function place(panel, input) {
  globalThis.document.body.appendChild(panel);

  const rect = typeof input.getBoundingClientRect === "function"
    ? input.getBoundingClientRect()
    : { left: 0, top: 0, bottom: 0, width: 0 };

  panel.style.left = `${Math.round(rect.left)}px`;
  panel.style.top = `${Math.round(rect.bottom + 2)}px`;
  panel.style.minWidth = `${Math.round(Math.max(rect.width, 340))}px`;

  openPanel = panel;

  onDocumentPointerDown = (event) => {
    if (!panel.contains(event.target) && event.target !== input) {
      closeResults();

      input.setAttribute("aria-expanded", "false");
    }
  };

  globalThis.document.addEventListener("pointerdown", onDocumentPointerDown, true);
}

/*
 * One result: its name, where it lives and what kind of thing it is, and why it
 * cannot run when it cannot. Compact by design - a list of tall cards is a list
 * nobody reads past the first two entries of.
 *
 * THE TEXT IS WRITTEN WITH textContent. A label is application data, and a
 * label is not a place to paste markup.
 */
function resultRow(entry, index, input) {
  const doc = globalThis.document;

  const button = doc.createElement("button");

  button.type = "button";
  button.className = "datum-search-result";
  button.id = `datum-search-result-${index}`;
  button.dataset.searchResult = entry.id;
  button.dataset.searchType = entry.type;
  button.setAttribute("role", "option");

  if (index === 0) {
    button.classList.add("datum-search-active");
  }

  button.setAttribute("aria-selected", index === 0 ? "true" : "false");

  if (entry.disabled) {
    button.classList.add("datum-search-result-unavailable");
  }

  const label = doc.createElement("span");

  label.className = "datum-search-result-label";
  label.textContent = entry.label;

  /*
   * Where it lives, what kind of thing it is, and its key - in that order.
   *
   * NOTHING IS SAID TWICE. A tool row's location already ends with its group
   * ("Fluids > Create > Flow Paths"), so the type follows it directly; a row
   * whose location IS its own name (a panel tab, a menu) has no extra place to
   * say.
   */
  const where = doc.createElement("span");

  where.className = "datum-search-result-location";

  const place = entry.label === entry.location ? null : entry.location;

  const typeLabel =
    entry.type === "feature" && entry.kind === "setting"
      ? TYPE_LABELS.setting
      : TYPE_LABELS[entry.type];

  const parts = [place, typeLabel, entry.shortcut].filter(Boolean);

  parts.forEach((part, position) => {
    if (position > 0) {
      const separator = doc.createElement("span");

      separator.className = "datum-search-result-separator";
      separator.textContent = "\u00b7";
      separator.setAttribute("aria-hidden", "true");

      where.appendChild(separator);
    }

    const piece = doc.createElement("span");

    piece.className = "datum-search-result-where";
    piece.textContent = part;

    if (position === 1) {
      /* The trailing type words are marked so a test can read them. */
      piece.dataset.type = entry.type;
    }

    where.appendChild(piece);
  });

  const reason = doc.createElement("span");

  reason.className = "datum-search-result-reason";
  reason.textContent = entry.disabled ? `Needs: ${entry.reason}` : "";
  reason.hidden = !entry.disabled;

  button.appendChild(label);
  button.appendChild(where);
  button.appendChild(reason);

  /*
   * ONE HANDLER FOR MOUSE, FINGER AND STYLUS. A click is what a fingertip and a
   * pen produce too. `pointerdown` is deliberately NOT used: on a touch screen
   * a finger's first contact would activate the row before the student had a
   * chance to scroll the list.
   */
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    activate(entry, input);
  });

  return button;
}

/*
 * NO RESULTS. Said plainly, with an example term - a student who typed a near
 * miss is one word away, and a bare "no results" leaves them guessing.
 */
function renderEmpty(input) {
  const doc = globalThis.document;

  const panel = doc.createElement("div");

  panel.className = "datum-search-results datum-search-empty";
  panel.setAttribute("role", "status");

  const heading = doc.createElement("span");

  heading.className = "datum-search-empty-heading";
  heading.textContent = `Nothing matches \u201c${input.value.trim()}\u201d`;

  const hint = doc.createElement("span");

  hint.className = "datum-search-empty-hint";
  hint.textContent =
    "Try a tool, section or command name: Pipe, Elbow, Reference Point, Fluids, Dimension, Zoom.";

  panel.appendChild(heading);
  panel.appendChild(hint);

  place(panel, input);
}

/* --------------------------------------------------------------- the shortcut */

/*
 * Ctrl+K, where one is wanted.
 *
 * It is installed here rather than in `keyboard-shortcuts.js` because it is
 * search's own key. It REFUSES while any other field has focus, so Ctrl+K typed
 * into a text box or the Source editor stays with that text box. When the field
 * already has focus it selects what is there, which is what every search box
 * does with its own key.
 */
export function installCommandSearchShortcut(input) {
  if (!input) {
    return;
  }

  globalThis.document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") {
      return;
    }

    const active = globalThis.document.activeElement;

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

export { DISCIPLINES, openCategory, openSection };

const enggCommandSearch = {
  closeSearch,
  installCommandSearch,
  installCommandSearchShortcut,
  isSearchOpen,
  normalise,
  searchCommands,
};

export default enggCommandSearch;
