/*
 * ========================================================
 * THE OPEN POPUP
 * ========================================================
 *
 * File -> Open is a DOCUMENT LAUNCHER, not the operating system's file panel.
 * The panel is an action inside this interface ("Import .enggdraw"), which is
 * the one thing it was always good at: choosing a file from the disk.
 *
 * Three sections, in the order a person usually wants them:
 *
 *     Templates   a starting document the user made from an .enggdraw
 *     Recent      a file that was open before, reopened directly
 *     Import      choose a .enggdraw from the laptop
 *
 * TEMPLATES START EMPTY. DAETUM ships no example drawings and no built-in
 * template cards; the library contains only what the user has added, and the
 * section says so plainly until there is something in it.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not read, parse, validate, render or store anything. It builds an
 * element and reports the user's choice. Adding a template, opening a recent and
 * importing a file all end up in the SAME document pipeline the rest of the
 * application uses, so the launcher cannot become a second way in.
 */
import enggRecentFiles from "../../../shared/file/recent-files.js";
import enggTemplates from "../../../shared/file/templates.js";
import enggUi from "../../../shared/ui/ui.js";

/*
 * "Today", "Yesterday", "3 days ago", or a date once it is older than a week.
 */
export function relativeDay(timestamp, now = Date.now()) {
  const then = Number(timestamp) || 0;

  if (!then) {
    return "";
  }

  const day = 24 * 60 * 60 * 1000;

  const days = Math.floor((now - then) / day);

  if (days <= 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  if (days < 7) {
    return `${days} days ago`;
  }

  const date = new Date(then);

  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "";
}

/* ---------------------------------------------------------- */
/* BUILDING THE PIECES                                         */
/* ---------------------------------------------------------- */

/*
 * WHERE THE POINTER WAS, for a menu that should open under the cursor.
 *
 * A keyboard-activated control has no pointer position, so this returns null
 * and the caller falls back to anchoring the menu to the button - which is
 * where a keyboard user expects it.
 */
function pointOf(event) {
  if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }

  return { x: event.clientX, y: event.clientY };
}

function element(tag, className, text) {  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function section(title) {
  const wrapper = element("section", "datum-open-section");

  wrapper.appendChild(element("h3", "datum-open-section-title", title));

  return wrapper;
}

/*
 * The small square a preview lives in.
 *
 * A preview is an SVG string produced from a stored DOCUMENT by the caller.
 * Nothing here renders it, so generating a preview can never touch the drawing.
 * When there is none the square is left EMPTY rather than filled with a
 * placeholder, because a generic icon is worse than no picture: it claims to
 * show the drawing and does not.
 */
function previewBox(preview, className) {
  const box = element("span", className || "datum-open-thumb");

  if (typeof preview === "string" && preview.trim()) {
    try {
      box.innerHTML = preview;
    } catch (error) {
      /* A preview that will not parse is simply not shown. */
    }
  }

  return box;
}

/*
 * A template card: its name, that it is a user template, and a small menu for
 * renaming or deleting it.
 */
function templateCard(template, handlers) {
  const card = element("div", "datum-open-template-card");

  const button = element("button", "datum-open-template");

  button.type = "button";
  button.dataset.template = template.id;

  button.appendChild(
    previewBox(template.preview, "datum-open-template-preview")
  );

  const text = element("span", "datum-open-template-text");

  text.appendChild(
    element("span", "datum-open-template-label", template.name)
  );

  text.appendChild(
    element("span", "datum-open-template-note", "User template")
  );

  button.appendChild(text);

  button.addEventListener("click", () => handlers.onUseTemplate(template.id));

  card.appendChild(button);

  const menu = element("button", "datum-open-template-menu", "\u22ee");

  menu.type = "button";
  menu.title = "Rename or delete this template";
  menu.setAttribute("aria-label", `Manage ${template.name}`);

  menu.addEventListener("click", (event) => {
    /*
     * THE THREE-DOT BUTTON IS ITS OWN INTERACTION.
     *
     * Its click must not reach the card underneath, which would OPEN the file or
     * USE the template - and it must not reach the launcher's backdrop, which
     * would dismiss the Open page. Stopping propagation here is what keeps the
     * menu a menu rather than a second way to activate the card.
     */
    event.stopPropagation();
    event.preventDefault();

    handlers.onManageTemplate(template.id, menu, event);
  });

  card.appendChild(menu);

  return card;
}

/*
 * ========================================================
 * SELECTING SEVERAL RECENT FILES
 * ========================================================
 *
 * A list of files accumulates: ten drawings from one afternoon, several of
 * which are no longer wanted. Removing them one at a time through a menu is
 * tedious, so the list supports selecting several and acting on them together.
 *
 * SELECTION IS A SEPARATE MODE, NOT A MODIFIER ON OPENING.
 *
 * A recent's normal click OPENS the file - that is what the row is for, and it
 * has to stay that way. So selection is entered deliberately (the Select
 * control), and ONLY while it is active does a row-click mean "select" rather
 * than "open". A click can never be both, which is what makes multi-selection
 * possible without making opening unpredictable.
 *
 * The set lives here, keyed by the recent's own key, and is cleared whenever
 * the list is rebuilt - so a removed file cannot stay selected, and a selection
 * can never outlive the rows it refers to.
 */
const recentSelection = new Set();

function selectedRecentKeys() {
  return [...recentSelection];
}

/*
 * The checkbox that appears on a row while selection is active.
 */
function selectionToggle(entry, handlers) {
  const label = element("label", "datum-open-select");

  const input = document.createElement("input");

  input.type = "checkbox";
  input.checked = recentSelection.has(entry.key);
  input.setAttribute("aria-label", `Select ${entry.fileName}`);

  input.addEventListener("click", (event) => {
    /*
     * The box is its own control, so its click must not also be read as a click
     * on the row - which would open or select the file a second time.
     */
    event.stopPropagation();
  });

  input.addEventListener("change", () => {
    if (input.checked) {
      recentSelection.add(entry.key);
    } else {
      recentSelection.delete(entry.key);
    }

    handlers.onSelectionChange();
  });

  label.appendChild(input);

  return label;
}

/*
 * The bar that appears once selection mode is on.
 *
 * Its actions are chosen from what is actually selected, so a control is never
 * offered that cannot do anything: Delete File is only there when at least one
 * selected file exists.
 */
function selectionBar(handlers) {
  const bar = element("div", "datum-open-selection-bar");

  const entries = enggRecentFiles.list();

  const chosen = entries.filter((entry) => recentSelection.has(entry.key));

  const count = element(
    "span",
    "datum-open-selection-count",
    `${chosen.length} selected`,
  );

  bar.appendChild(count);

  const actions = element("div", "datum-open-selection-actions");

  const button = (label, className, onSelect) => {
    const node = element("button", className, label);

    node.type = "button";
    node.addEventListener("click", onSelect);

    return node;
  };

  actions.appendChild(
    button("Select All", "datum-open-selection-action", () => {
      entries.forEach((entry) => recentSelection.add(entry.key));
      handlers.onSelectionChange();
    }),
  );

  actions.appendChild(
    button(
      "Remove",
      "datum-open-selection-action",
      () => handlers.onRemoveSelected(selectedRecentKeys()),
    ),
  );

  /*
   * DELETE IS OFFERED ONLY WHEN SOMETHING CAN BE DELETED. A selected file that
   * is missing cannot be deleted, so if every selected file is missing the
   * control is not shown at all - rather than shown and then failing.
   */
  if (chosen.some((entry) => !entry.missing)) {
    actions.appendChild(
      button(
        "Delete",
        "datum-open-selection-action datum-open-selection-action-danger",
        () => handlers.onDeleteSelected(selectedRecentKeys()),
      ),
    );
  }

  actions.appendChild(
    button("Clear Selection", "datum-open-selection-action", () => {
      recentSelection.clear();
      handlers.onSelectionChange();
    }),
  );

  actions.appendChild(
    button("Done", "datum-open-selection-action", () =>
      handlers.onExitSelection(),
    ),
  );

  bar.appendChild(actions);

  return bar;
}

/*
 * How the Recent section is presented: a grid of thumbnails, or a compact list.
 *
 * The preference is remembered, because it is a statement about how this person
 * recognises their own drawings rather than about one session. Grid is the
 * default: a drawing is recognised by what it looks like far more quickly than
 * by its file name, and the name is shown either way.
 */
const RECENT_VIEW_KEY = "datum:recent-view";

export function recentView() {
  try {
    return window.localStorage.getItem(RECENT_VIEW_KEY) === "list"
      ? "list"
      : "grid";
  } catch (error) {
    return "grid";
  }
}

function setRecentView(view) {
  try {
    window.localStorage.setItem(
      RECENT_VIEW_KEY,
      view === "list" ? "list" : "grid"
    );
  } catch (error) {
    /* A preference that cannot be stored is simply not remembered. */
  }
}

/*
 * The two view buttons.
 *
 * One is active at a time, and both are always visible so switching back is
 * never hidden behind the current choice.
 *
 * THE ICONS ARE INLINE SVG, NOT UNICODE GLYPHS.
 *
 * They were `\u25a6` and `\u2637` - a square and a TRIGRAM character. Those are
 * not present in every font, and when a font has no glyph the browser
 * substitutes one from a fallback that can be many times larger. The trigram in
 * particular came out as a huge symbol, which is what put a drawing-sized shape
 * on the page when the List view was chosen.
 *
 * A path is drawn at exactly the size asked for, in every browser, with no font
 * lookup to go wrong.
 */
function viewSwitcher(onChange) {
  const wrapper = element("div", "datum-open-view-switch");

  const current = recentView();

  const iconFor = (id) =>
    id === "grid"
      ? '<svg viewBox="0 0 16 16" aria-hidden="true">' +
        '<rect x="1.5" y="1.5" width="5.5" height="5.5"/>' +
        '<rect x="9" y="1.5" width="5.5" height="5.5"/>' +
        '<rect x="1.5" y="9" width="5.5" height="5.5"/>' +
        '<rect x="9" y="9" width="5.5" height="5.5"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true">' +
        '<rect x="1.5" y="2" width="3" height="3"/>' +
        '<rect x="1.5" y="6.5" width="3" height="3"/>' +
        '<rect x="1.5" y="11" width="3" height="3"/>' +
        '<rect x="6.5" y="3" width="8" height="1"/>' +
        '<rect x="6.5" y="7.5" width="8" height="1"/>' +
        '<rect x="6.5" y="12" width="8" height="1"/></svg>';

  [
    { id: "grid", title: "Thumbnail grid" },
    { id: "list", title: "Compact list" }
  ].forEach((option) => {
    const button = element("button", "datum-open-view-button");

    button.type = "button";
    button.title = option.title;
    button.dataset.view = option.id;
    button.setAttribute("aria-label", option.title);
    button.setAttribute("aria-pressed", String(current === option.id));

    /*
     * A LITERAL BUILT IN THIS FILE - no stored value, no user input - so there
     * is nothing here that could carry a script.
     */
    button.innerHTML = iconFor(option.id);

    if (current === option.id) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      setRecentView(option.id);
      onChange(option.id);
    });

    wrapper.appendChild(button);
  });

  return wrapper;
}

/*
 * One recent file row: a thumbnail, the drawing's name, its file name and when
 * it was last opened, and a small menu for the file.
 *
 * THE ROW AND ITS MENU ARE SEPARATE CONTROLS, SIDE BY SIDE.
 *
 * The three-dot used to be appended INSIDE the row's `<button>`, so it sat in
 * the button's own hit area - it looked like part of a long control, and a
 * click on it was also a click on the row. They are siblings in a wrapper
 * instead: the row opens the file, the menu button manages it, and neither is
 * inside the other.
 */
function recentRow(entry, handlers) {
  const wrapper = element(
    "div",
    "datum-open-recent-wrap" +
      (entry.missing ? " datum-open-recent-missing" : "") +
      (handlers.selecting ? " datum-open-recent-selecting" : "") +
      (recentSelection.has(entry.key) ? " datum-open-recent-selected" : "")
  );

  /*
   * A CHECKBOX, ONLY WHILE SELECTING.
   *
   * It appears when selection mode is entered and not before, so the ordinary
   * list stays uncluttered - and while it is there a click on the row SELECTS
   * rather than opens, which is what the checkbox beside it says.
   */
  if (handlers.selecting) {
    wrapper.appendChild(selectionToggle(entry, handlers));
  }

  const row = element("button", "datum-open-recent");

  row.type = "button";
  row.dataset.recentKey = entry.key;

  row.appendChild(previewBox(entry.preview, "datum-open-thumb"));

  const text = element("span", "datum-open-recent-text");

  text.appendChild(element("span", "datum-open-recent-name", entry.label));

  /*
   * NO SECOND LINE REPEATING THE FILENAME.
   *
   * The row used to print the name and then the file name under it, so
   * `triangle.enggdraw` appeared in full and the drawing was named twice - once
   * as `triangle` and once with the extension. A drawing is named by its BASE
   * name; the extension belongs to the file on disk and is not part of how the
   * application talks about it.
   *
   * The full file name is still available in the row's tooltip, where it is
   * useful rather than repetitive.
   */
  row.title = entry.fileName;

  text.appendChild(
    element(
      "span",
      "datum-open-recent-when",
      entry.missing ? "File not found" : relativeDay(entry.openedAt)
    )
  );

  row.appendChild(text);

  /*
   * EVERY RECENT ROW HAS A MENU, INCLUDING A MISSING FILE.
   *
   * A missing file must still be REMOVABLE, and that is a management action
   * rather than a recovery one - so the menu is offered whatever the file's
   * state. It is deliberately independent of whether the file can be opened.
   */
  const menu = element("button", "datum-open-recent-menu", "\u22ee");

  menu.type = "button";
  menu.title = "More actions";
  menu.setAttribute("aria-label", `Actions for ${entry.fileName}`);

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();

    handlers.onRecentMenu(entry, menu, event);
  });

  /*
   * ONE OR THE OTHER, NEVER BOTH.
   *
   * While selection mode is on, a click on the row SELECTS or DESELECTS it -
   * which is the only way several files can be gathered - and it does not open.
   * Off, the click opens the file, as it always has.
   */
  row.addEventListener("click", () => {
    if (handlers.selecting) {
      if (recentSelection.has(entry.key)) {
        recentSelection.delete(entry.key);
      } else {
        recentSelection.add(entry.key);
      }

      handlers.onSelectionChange();

      return;
    }

    handlers.onOpenRecent(entry);
  });

  /*
   * SIBLINGS, NOT NESTED. The row is the Open action; the menu button sits
   * beside it in the same wrapper, so each has its own hit area and neither
   * contains the other.
   */
  wrapper.appendChild(row);
  wrapper.appendChild(menu);

  return wrapper;
}

/*
 * The Templates section: the user's templates, then Add Template, and the
 * empty-state line ONLY while there is nothing in the library.
 */
function templatesSection(handlers) {
  const templates = enggTemplates.list();

  const wrapper = section("Templates");

  if (templates.length) {
    const grid = element("div", "datum-open-templates");

    templates.forEach((template) => {
      grid.appendChild(templateCard(template, handlers));
    });

    wrapper.appendChild(grid);
  } else {
    wrapper.appendChild(element("p", "datum-open-empty", "No templates yet."));
  }

  const add = element("button", "datum-open-add-template", "+ Add Template");

  add.type = "button";

  add.addEventListener("click", () => handlers.onAddTemplate());

  wrapper.appendChild(add);

  return wrapper;
}

function recentsSection(handlers) {
  const wrapper = section("Recent");

  const entries = enggRecentFiles.list();

  if (!entries.length) {
    wrapper.appendChild(
      element(
        "p",
        "datum-open-empty",
        "No recent drawings yet. Import a .enggdraw file to add one."
      )
    );

    return wrapper;
  }

  /*
   * The heading carries the view control, and - while selection mode is on -
   * the count and the bulk actions. Both belong to the Recent section rather
   * than to the whole popup.
   */
  const head = element("div", "datum-open-section-head");

  head.appendChild(wrapper.querySelector(".datum-open-section-title"));

  const headControls = element("div", "datum-open-section-controls");

  if (!handlers.selecting) {
    const select = element("button", "datum-open-select-toggle", "Select");

    select.type = "button";
    select.addEventListener("click", () => handlers.onEnterSelection());

    headControls.appendChild(select);
  }

  headControls.appendChild(viewSwitcher(() => handlers.onRedraw()));

  head.appendChild(headControls);

  wrapper.insertBefore(head, wrapper.firstChild);

  if (handlers.selecting) {
    wrapper.appendChild(selectionBar(handlers));
  }

  const view = recentView();

  const list = element(
    "div",
    view === "grid" ? "datum-open-recents-grid" : "datum-open-recents"
  );

  entries.forEach((entry) => {
    list.appendChild(recentRow(entry, handlers));
  });

  wrapper.appendChild(list);

  return wrapper;
}

function buildBody(handlers) {
  const body = element("div", "datum-open");

  body.appendChild(templatesSection(handlers));
  body.appendChild(recentsSection(handlers));

  return body;
}

/* ---------------------------------------------------------- */
/* THE POPUP                                                   */
/* ---------------------------------------------------------- */

/*
 * Show the Open launcher.
 *
 * Returns a promise resolving with one of
 *
 *     { action: "template", id }       a template was chosen
 *     { action: "recent", key, entry } a recent was chosen
 *     { action: "import" }             Import was chosen
 *     { action: "add-template" }       + Add Template was chosen
 *     { action: "cancel" }             the popup was dismissed
 *
 * THE POPUP ONLY REPORTS THE CHOICE. It closes first and then resolves, so
 * whatever the caller does next - a prompt, a file panel, a name dialog - has
 * nothing competing for the user's attention.
 */
function openOpenPopup() {
  return new Promise((resolve) => {
    let settled = false;

    const choose = (result) => {
      if (settled) {
        return;
      }

      settled = true;

      enggUi.closeDialog();

      resolve(result);
    };

    let currentBody = null;

    /*
     * Selection mode starts OFF on every open, and the selection starts empty.
     * A list of files is not the place to leave a mode switched on from last
     * time - a click that selects rather than opens would be a puzzle with no
     * visible cause.
     */
    let selectionActive = false;

    recentSelection.clear();

    /*
     * Rebuilt in place when a template is deleted, so the list stays correct
     * while the user keeps working in the popup.
     */
    function redraw() {
      /*
       * Any key that is no longer on the list is dropped from the selection, so
       * a removed file cannot stay selected - the selection and the rows it
       * refers to cannot drift apart.
       */
      const live = new Set(
        enggRecentFiles.list().map((entry) => entry.key)
      );

      [...recentSelection].forEach((key) => {
        if (!live.has(key)) {
          recentSelection.delete(key);
        }
      });

      const next = buildBody({
        selecting: selectionActive,
        onUseTemplate: (id) => choose({ action: "template", id }),
        onOpenRecent: (entry) =>
          choose({ action: "recent", key: entry.key, entry }),
        onForget: () => redraw(),
        onAddTemplate: () => choose({ action: "add-template" }),

        onEnterSelection: () => {
          selectionActive = true;
          recentSelection.clear();
          redraw();
        },

        onExitSelection: () => {
          selectionActive = false;
          recentSelection.clear();
          redraw();
        },

        onSelectionChange: () => redraw(),

        /*
         * REMOVING FROM RECENTS NEVER TOUCHES A FILE, and works for a file that
         * is missing - which is the whole point of being able to select several.
         */
        onRemoveSelected: (keys) => {
          keys.forEach((key) => enggRecentFiles.forget(key));
          recentSelection.clear();
          redraw();
        },

        /*
         * DELETING A FILE IS THE DESTRUCTIVE ONE, so it is handed to the caller
         * to confirm. The popup does not delete anything itself.
         */
        onDeleteSelected: (keys) =>
          choose({ action: "delete-recents", keys }),

        /*
         * Switching the Recent view redraws the body IN PLACE. The choice is
         * already stored, so the rebuilt section reads it back - which is what
         * keeps the buttons and the layout from being able to disagree.
         */
        onRedraw: () => redraw(),

        /*
         * A TEMPLATE'S MENU.
         *
         * An anchored context menu, NOT a dialog - a dialog would close the
         * launcher behind it, which is the bug this replaces. Deleting redraws
         * in place; renaming is handed to the caller, which owns the name
         * dialog and re-opens the launcher afterwards.
         */
        onManageTemplate: (id, anchor, event) => {
          enggUi.openContextMenu(
            anchor,
            [
              {
                id: "use",
                label: "Use Template",
                onSelect: () => choose({ action: "template", id })
              },
              {
                id: "rename",
                label: "Rename",
                onSelect: () => choose({ action: "rename-template", id })
              },
              {
                id: "delete",
                label: "Delete Template",
                danger: true,
                onSelect: () => {
                  enggTemplates.deleteTemplate(id);
                  redraw();
                }
              }
            ],
            pointOf(event)
          );
        },

        /*
         * A RECENT FILE'S MENU.
         *
         * Every action here is one the environment can actually perform. Remove
         * touches only DAETUM's record and always works; Delete is the
         * destructive one and goes through the caller, which confirms it; Reveal
         * is offered only where the browser has a way to do it.
         */
        onRecentMenu: (entry, anchor, event) => {
          const items = [];

          if (!entry.missing) {
            items.push({
              id: "open",
              label: "Open",
              onSelect: () => choose({ action: "recent", key: entry.key, entry })
            });
          }

          items.push({
            id: "remove",
            label: "Remove from Recents",
            onSelect: () => {
              enggRecentFiles.forget(entry.key);
              redraw();
            }
          });

          if (!entry.missing) {
            items.push({
              id: "delete",
              label: "Delete File",
              danger: true,
              onSelect: () =>
                choose({ action: "delete-recent", key: entry.key, entry })
            });
          }

          if (entry.hasHandle) {
            items.push({
              id: "reveal",
              label: "Reveal in Folder",
              onSelect: () =>
                choose({ action: "reveal-recent", key: entry.key, entry })
            });
          }

          enggUi.openContextMenu(anchor, items, pointOf(event));
        }
      });

      if (currentBody && currentBody.parentNode) {
        currentBody.replaceWith(next);
      }

      currentBody = next;

      return next;
    }

    currentBody = redraw();

    enggUi.openDialog({
      title: "Open",
      className: "engg-dialog-lg",
      body: currentBody,
      buttons: [
        { id: "import", label: "Import .enggdraw", primary: true },
        { id: "cancel", label: "Cancel", dismiss: true }
      ],
      onChoose: (id) =>
        choose({ action: id === "import" ? "import" : "cancel" })
    });
  });
}

const enggOpenPopup = {
  openOpenPopup,
  relativeDay
};

export default enggOpenPopup;
