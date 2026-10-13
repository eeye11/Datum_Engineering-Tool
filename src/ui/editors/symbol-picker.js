/*
 * ============================================================
 * THE SYMBOL PICKER
 * ============================================================
 *
 * The Symbol tool's library: a SEARCHABLE, BROWSABLE list of the engineering
 * symbols DAETUM can draw. It is a picker, not the drawing - choosing here
 * changes WHAT will be placed, and the placement itself happens on the canvas
 * afterwards.
 *
 * WHY A PICKER AT ALL, when the panel already has a `<select>`.
 *
 * The panel's select is for CHANGING an existing symbol and is deliberately
 * small. The picker is for CHOOSING one to place, which is a different act: it
 * is browsed by category, searched by name, and previewed before it is committed
 * - so the student sees the glyph at a readable size before deciding, rather
 * than reading it off a cramped dropdown row.
 *
 * IT PREVIEWS BY CALLBACK, NOT BY ITSELF. `onPick` is handed the chosen symbol
 * and the picker closes; what happens next - arming the canvas, updating a
 * hovering ghost - is the tool's business, and this module knows nothing about
 * the drawing. That keeps one picker usable from the tool, the panel and a test.
 *
 * SEARCH MATCHES THE LATIN NAME. A student who cannot type `θ` searches for
 * "theta"; a student who knows the glyph sees it in the browse grid. Both find
 * the same symbol, and the entry's own label is what is matched.
 */
import enggAnnotate from "../../features/annotations/annotate-model.js";

let openDialog = null;

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }
}

function isOpen() {
  return openDialog !== null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
  );
}

/*
 * Every symbol, flat, with the group it came from - so search and browse read
 * the same list and a result can say which section it belongs to.
 */
function allSymbols() {
  const library = enggAnnotate?.SYMBOL_LIBRARY || [];

  return library.flatMap((group) =>
    group.symbols.map((symbol) => ({
      ...symbol,
      group: group.label,
      groupId: group.id
    }))
  );
}

function matches(symbol, query) {
  if (!query) {
    return true;
  }

  const haystack = `${symbol.label} ${symbol.id} ${symbol.group}`.toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function open(options = {}) {
  close();

  const dialog = document.createElement("div");

  dialog.className = "datum-symbol-picker";

  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Symbol library");

  dialog.innerHTML = `
        <div class="datum-symbol-picker-title">
            <span>Symbol Library</span>
            <button type="button" class="datum-help-close"
                data-symbol-close aria-label="Close">&times;</button>
        </div>

        <div class="datum-symbol-picker-search">
            <input type="search"
                class="drawing-property-input"
                data-symbol-search
                placeholder="Search symbols"
                aria-label="Search symbols"
                autocomplete="off">
        </div>

        <div class="datum-symbol-picker-body" data-symbol-body></div>
    `;

  document.body.appendChild(dialog);

  openDialog = dialog;

  const body = dialog.querySelector("[data-symbol-body]");
  const search = dialog.querySelector("[data-symbol-search]");

  const render = (query) => {
    const library = enggAnnotate?.SYMBOL_LIBRARY || [];

    const groups = library
      .map((group) => ({
        ...group,
        symbols: group.symbols.filter((symbol) =>
          matches(
            { ...symbol, group: group.label, groupId: group.id },
            query
          )
        )
      }))
      .filter((group) => group.symbols.length);

    if (!groups.length) {
      body.innerHTML = `<p class="datum-symbol-picker-empty">
            No symbols match "${escapeHtml(query)}"
        </p>`;

      return;
    }

    body.innerHTML = groups
      .map(
        (group) => `
        <h4 class="datum-symbol-picker-heading">${escapeHtml(group.label)}</h4>
        <div class="datum-symbol-picker-grid">
            ${group.symbols
              .map(
                (symbol) => `
                <button type="button"
                    class="datum-symbol-picker-item"
                    data-symbol-id="${escapeHtml(symbol.id)}"
                    title="${escapeHtml(symbol.label)}">
                    <span class="datum-symbol-picker-glyph">${escapeHtml(
                      symbol.text
                    )}</span>
                    <span class="datum-symbol-picker-label">${escapeHtml(
                      symbol.label
                    )}</span>
                </button>
            `
              )
              .join("")}
        </div>
    `
      )
      .join("");
  };

  render("");

  search?.addEventListener("input", () => {
    render(search.value.trim());
  });

  /*
   * CHOOSING A SYMBOL HANDS IT BACK AND CLOSES. The click is delegated to the
   * body so a re-render does not lose the listeners.
   */
  body.addEventListener("click", (event) => {
    const item = event.target.closest("[data-symbol-id]");

    if (!item) {
      return;
    }

    const symbolId = item.getAttribute("data-symbol-id");

    close();

    options.onPick?.(symbolId);
  });

  dialog
    .querySelector("[data-symbol-close]")
    ?.addEventListener("click", () => {
      close();
      options.onCancel?.();
    });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      close();
      options.onCancel?.();
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
      options.onCancel?.();
    }
  });

  search?.focus();

  return dialog;
}

const enggSymbolPicker = {
  allSymbols,
  close,
  isOpen,
  matches,
  open
};

export default enggSymbolPicker;
