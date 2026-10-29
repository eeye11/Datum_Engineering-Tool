/*
 * ============================================================
 * THE MENU BAR AND ITS DROPDOWNS
 * ============================================================
 *
 * One component, used by all six menus. A menu declares WHAT it contains - a
 * list of items and separators - and this module decides how a menu behaves:
 * how it opens, how it closes, how it is drawn, and how the keyboard drives it.
 *
 * WHY IT IS ONE COMPONENT AND NOT SIX MENUS
 * -----------------------------------------
 * Six menus written separately are six chances to disagree about the same
 * things - when a click closes the previous menu, whether Escape works, where
 * the shadow sits, how tall an item is. Every one of those is a detail nobody
 * chose; they are just where the copies drifted. So the behaviour lives here
 * once, and the six menus are DATA.
 *
 * THE FOUR RULES THAT MAKE A MENU FEEL RIGHT
 * ------------------------------------------
 *   1. clicking a label opens it;
 *   2. clicking ANOTHER label moves to that one without a second click - the
 *      pointer is already over the bar, so that is what it means;
 *   3. clicking outside, or Escape, closes it;
 *   4. running a command closes it.
 *
 * THE MENU MUST NOT MOVE THE PAGE. It is a positioned overlay inside the bar,
 * drawn above the canvas, so opening it cannot reflow the layout beneath it -
 * no toolbar scooting sideways, no canvas resizing as a menu appears. That is
 * why the panel is `position: absolute` under its own label and the bar itself
 * never changes size.
 *
 * WHAT A COMMAND IS
 * -----------------
 * An item is `{ id, label, run, disabled, shortcut, checked, group }`. `run` is
 * the command itself - a function somebody else owns. This module never knows
 * what "Save" does; it only calls it. That is the whole point: the menu is a
 * front door onto commands that already exist, not a second implementation of
 * them.
 */

import { setToolMessage } from "../toolbar/toolbar-render.js";
import { menuIcon } from "../toolbar/icons.js";

/*
 * THE OPEN MENU, if any.
 *
 * Module-level because only one menu can be open at a time - that is a property
 * of the BAR, not of an individual menu - and because the document-level
 * listeners that close it need to reach it without a reference being threaded
 * through every caller.
 */
let openMenu = null;

let closeOpenMenu = null;

/*
 * Build one dropdown panel from a menu definition.
 *
 * The items are rendered from the definition every time the menu opens, so a
 * command's disabled or checked state is read at the moment the student looks
 * at it rather than when the bar was built. A menu whose "Undo" was disabled at
 * start-up would stay greyed out forever.
 */
function buildDropdown(menu, onRun) {
  const panel = globalThis.document.createElement("div");

  panel.className = `datum-menu-panel datum-menu-panel-${menu.id}`;

  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", menu.label);

  menu.items.forEach((item) => {
    /*
     * A SEPARATOR, which is a group boundary rather than decoration. The
     * definition says WHERE the groups break, so this module never has to
     * guess which commands belong together.
     */
    if (item.separator) {
      const rule = globalThis.document.createElement("div");

      rule.className = "datum-menu-separator";
      rule.setAttribute("role", "separator");

      panel.appendChild(rule);

      return;
    }

    const disabled = item.disabled === true;

    /*
     * AN ITEM WITH CHILDREN IS A SUBMENU, not a command.
     *
     * `submenu` is an array built the same way a menu's own `items` is, so a
     * nested command has the same icon, label and disabled state as a top-level
     * one and there is no second item format to keep in step. The item itself
     * opens the panel rather than running a command - see the click handler.
     */
    const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;

    const button = globalThis.document.createElement("button");

    button.type = "button";
    button.className = "datum-menu-item";
    button.setAttribute("role", "menuitem");
    button.dataset.menuItem = item.id;

    if (hasSubmenu) {
        /*
         * `aria-haspopup` states the nesting to a screen reader, and the row
         * carries `datum-menu-item-submenu` so the style can reserve the column
         * the indicator sits in.
         */
        button.setAttribute("aria-haspopup", "true");
        button.classList.add("datum-menu-item-submenu");
    }

    if (disabled) {
        /*
         * `aria-disabled` rather than `disabled`, so the item still takes
         * focus and can explain itself - and so the keyboard can walk past
         * it in order rather than skipping it invisibly.
         */
        button.setAttribute("aria-disabled", "true");
    }

    if (item.checked === true) {
        button.classList.add("datum-menu-item-checked");
        button.setAttribute("aria-checked", "true");
    }

    /*
     * THREE COLUMNS: icon, label, shortcut.
     *
     * THE ICON COLUMN IS FIXED WIDTH and rendered even when an item has no
     * icon, so every label in the menu starts at the same x. A column that
     * collapsed for a missing icon would leave one command indented and the
     * rest out, which reads as a mistake rather than as a hierarchy.
     */
    const icon = `<span class="datum-menu-item-icon">${menuIcon(item.icon)}</span>`;

    /*
     * THE SHORTCUT IS SHOWN, NOT BOUND.
     *
     * The key handling lives in the keyboard module and already works; this
     * is a label saying so. Binding it here as well would give one command
     * two keypaths, which is how a shortcut ends up firing twice.
     */
    const accelerator = item.shortcut
        ? `<span class="datum-menu-item-shortcut">${item.shortcut}</span>`
        : "";

    /*
     * THE SUBMENU INDICATOR IS A CHEVRON IN ITS OWN COLUMN, so a nested command
     * reads as nested at a glance and the six TOP-LEVEL menu labels stay plain -
     * the indicator means "there is more under this row", which is true of
     * Download and false of File, Edit and the rest.
     */
    const indicator = hasSubmenu
        ? '<span class="datum-menu-item-chevron">' + menuIcon("chevron-right") + "</span>"
        : "";

    button.innerHTML =
        icon +
        `<span class="datum-menu-item-label">${item.label}</span>` +
        accelerator +
        indicator;

    if (hasSubmenu) {
        /*
         * OPEN ON HOVER, FOCUS OR CLICK, and keep it open while the pointer is
         * anywhere in the item-plus-panel area. The panel is a CHILD of the
         * row, so moving the pointer from the row into the panel never leaves
         * the area, and the panel cannot close under the hand that just opened
         * it.
         */
        const sub = buildDropdown(
            { id: `${item.id}-submenu`, label: item.label, items: item.submenu },
            (child) => {
                closeMenu();
                onRun(child);
            },
        );

        sub.classList.add("datum-menu-subpanel");

        button.appendChild(sub);

        const openSubmenu = () => {
            if (!disabled) {
                button.classList.add("datum-menu-item-submenu-open");
                placeSubmenu(button, sub);
            }
        };

        /* A scrolled menu takes its open flyout with the row it belongs to. */
        panel.addEventListener(
            "scroll",
            () => {
                if (button.classList.contains("datum-menu-item-submenu-open")) {
                    placeSubmenu(button, sub);
                }
            },
            { passive: true },
        );

        button.addEventListener("mouseenter", openSubmenu);
        button.addEventListener("focus", openSubmenu);

        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (disabled) {
                setToolMessage(
                    item.disabledReason || `${item.label} is not available`,
                );

                return;
            }

            /*
             * A CLICK TOGGLES IT, so a keyboard user who cannot hover still has
             * a way in; a pointer user gets the submenu from the hover alone.
             */
            if (button.classList.toggle("datum-menu-item-submenu-open")) {
                placeSubmenu(button, sub);
            }
        });

        panel.appendChild(button);

        return;
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (disabled) {
        setToolMessage(item.disabledReason || `${item.label} is not available`);

        return;
      }

      onRun(item);
    });

    panel.appendChild(button);
  });

  return panel;
}

/*
 * Close whatever is open, restoring the bar to its resting state.
 */
/*
 * A SUBMENU FLIES OUT BESIDE ITS ROW, as desktop menus do.
 *
 * It used to be positioned inside its parent panel - and that panel scrolls
 * vertically (`overflow-y: auto`), which makes it clip horizontally too, so a
 * flyout opening to the right was trapped inside the menu behind a sideways
 * scrollbar. It is now placed against the WINDOW (`position: fixed`), next to
 * its row: to the right when there is room, otherwise to the left, and moved up
 * rather than running off the bottom. It stays a DOM child of the row, so
 * hovering it still counts as hovering the row and it does not close under the
 * pointer.
 */
const FLYOUT_GAP_PX = 2;
const WINDOW_MARGIN_PX = 8;

/*
 * A TOP-LEVEL PANEL, PLACED AGAINST THE WINDOW BENEATH ITS LABEL.
 *
 * Used only while the rail scrolls (see `open`). The panel is made `fixed` so
 * the rail's clip cannot touch it, then squared up under its own label and
 * pushed back inside the window if it would overhang the edge. Placement is
 * repeated on scroll and on resize, so a panel that is open while the rail is
 * panned stays over the label it belongs to instead of floating away.
 */
function placePanelAgainstWindow(label, panel) {
  panel.classList.add("datum-menu-panel-fixed");

  const place = () => {
    const anchor = label.getBoundingClientRect();
    const width = panel.offsetWidth;
    const left = Math.min(
      Math.max(WINDOW_MARGIN_PX, anchor.left),
      Math.max(WINDOW_MARGIN_PX, window.innerWidth - WINDOW_MARGIN_PX - width),
    );

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(anchor.bottom)}px`;
  };

  place();

  /*
   * THE PANEL FOLLOWS ITS LABEL.
   *
   * `scroll` does not bubble, so the rail's own scrolling is caught in the
   * CAPTURE phase - every element it happens on, wherever that is in the page.
   * A window resize can move the label by itself, so it is listened for too.
   * Both are removed when the panel leaves the document, which is what closing
   * a menu does.
   */
  const onMove = () => place();

  window.addEventListener("scroll", onMove, { capture: true, passive: true });
  window.addEventListener("resize", onMove, { passive: true });

  const observer = new globalThis.MutationObserver(() => {
    if (!panel.isConnected) {
      window.removeEventListener("scroll", onMove, { capture: true });
      window.removeEventListener("resize", onMove);
      observer.disconnect();
    }
  });

  observer.observe(panel.parentNode ?? panel, { childList: true });
}

function placeSubmenu(row, sub) {
  const rect = row.getBoundingClientRect();
  const width = sub.offsetWidth;
  const height = sub.offsetHeight;
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;

  let left = rect.right + FLYOUT_GAP_PX;

  if (left + width > viewWidth - WINDOW_MARGIN_PX) {
    left = Math.max(WINDOW_MARGIN_PX, rect.left - FLYOUT_GAP_PX - width);
  }

  /* Its first item level with the row that opened it. */
  let top = rect.top - 6;

  if (top + height > viewHeight - WINDOW_MARGIN_PX) {
    top = Math.max(WINDOW_MARGIN_PX, viewHeight - WINDOW_MARGIN_PX - height);
  }

  sub.style.left = `${Math.round(left)}px`;
  sub.style.top = `${Math.round(top)}px`;
}

export function closeMenu() {
  if (closeOpenMenu) {
    closeOpenMenu();
  }
}

export function isMenuOpen() {
  return Boolean(openMenu);
}

/*
 * Build the whole bar into `host`.
 *
 * `menus` is the six DEFINITIONS, in order - each a FUNCTION returning
 * `{ id, label, items }`, not the object itself. That matters: a menu's items
 * change with the state (Undo greys out, a visibility item's label flips from
 * "Hide Grid" to "Show Grid"), so a bar built from frozen objects would show
 * whatever the application looked like at start-up for the rest of the session.
 *
 * Evaluating on OPEN means every label and every disabled state is read at the
 * moment the student looks at it. `editor/menu-commands.js` documents the same
 * rule from its side.
 *
 * The bar itself is built ONCE, so its layout is stable and opening a menu
 * cannot move anything on the page.
 */
export function installMenuBar(host, menus) {
  if (!host) {
    return null;
  }

  host.innerHTML = "";
  host.classList.add("datum-menubar");
  host.setAttribute("role", "menubar");

  const labels = [];

  menus.forEach((menuDefinition) => {
    /*
     * THE BAR'S OWN LABEL COMES FROM A FIRST EVALUATION, and only the label -
     * the id and the name of a menu do not change. The ITEMS are evaluated
     * again inside `open()` below, so their states are current.
     */
    const menu = typeof menuDefinition === "function"
      ? menuDefinition()
      : menuDefinition;

    const currentMenu = () =>
      typeof menuDefinition === "function" ? menuDefinition() : menuDefinition;

    const wrap = globalThis.document.createElement("div");

    wrap.className = "datum-menu";

    const label = globalThis.document.createElement("button");

    label.type = "button";
    label.className = "datum-menu-label";
    label.textContent = menu.label;
    label.dataset.menuId = menu.id;

    /*
     * NO DROPDOWN CARET.
     *
     * A caret is a promise that clicking opens something, and in a menu BAR
     * that is already understood - every label does it. The arrow is visual
     * noise that makes a compact bar wider without adding information, and
     * on a bar of six labels the noise is most of what you see.
     */
    label.setAttribute("aria-haspopup", "true");
    label.setAttribute("aria-expanded", "false");

    wrap.appendChild(label);

    /* The panel is a child of the label's own wrapper, so it sits under it. */
    const slot = globalThis.document.createElement("div");

    slot.className = "datum-menu-slot";
    wrap.appendChild(slot);

    let panel = null;

    /*
     * WHETHER THIS LABEL'S PANEL WAS OPENED BY THE POINTER RATHER THAN A PRESS.
     *
     * A menu bar that follows the pointer has to tell "the mouse arrived here"
     * apart from "the student pressed here", because the two mean different
     * things when they arrive together as one gesture. See the click handler.
     */
    let openedByHover = false;

    const close = () => {
      if (panel) {
        panel.remove();
        panel = null;
      }

      label.setAttribute("aria-expanded", "false");
      wrap.classList.remove("datum-menu-open");
    };

    const open = () => {
      if (panel) {
        return;
      }

      /*
       * THE ITEMS ARE READ NOW, not when the bar was built.
       *
       * "Undo" is greyed out until there is something to undo, and the grid's
       * item says "Hide Grid" or "Show Grid" depending on what the grid is
       * doing. A panel built at start-up would show the state the application
       * had on load for the rest of the session - the label would never change
       * however many times the grid was toggled.
       */
      panel = buildDropdown(currentMenu(), (item) => {
        /*
         * THE COMMAND FIRST, THEN THE CLOSE.
         *
         * A command may open a dialog or leave the tool in a new state,
         * and closing the menu afterwards means the menu is not still
         * on screen over whatever the command produced. Closing first
         * would work too, but this order means a command that reads the
         * open-menu state sees the truth.
         */
        closeMenu();

        item.run();
      });

      slot.appendChild(panel);

      /*
       * THE PANEL IS PLACED AGAINST THE WINDOW, ALWAYS.
       *
       * It cannot be left as an ordinary child of the bar. The bar lives inside
       * the top rail, the rail is a stacking context so it can sit above the
       * canvas, and a dropdown painted inside that context is therefore painted
       * BELOW the tools panel and the drawing space - no `z-index` on the panel
       * can change that, because it is only being compared with its siblings in
       * the rail.
       *
       * Placed `fixed` against the viewport it takes part in the root stacking
       * context, where it can be above everything, and it also escapes the
       * rail's horizontal clip when the window is narrow enough to need a
       * scroll. Both of the problems the dropdown had - being covered, and being
       * cut off - are the same problem: being a child of a clipped, stacked box.
       *
       * `placePanelAgainstWindow` keeps it under its own label as the rail
       * scrolls and the window resizes.
       */
      placePanelAgainstWindow(label, panel);

      label.setAttribute("aria-expanded", "true");
      wrap.classList.add("datum-menu-open");
    };

    /*
     * OPENING, AS A FUNCTION OF THE BAR RATHER THAN OF A CLICK.
     *
     * The pointer and the press BOTH open a menu, and they must not go through
     * the same toggle: a single physical click on a second label produces a
     * `pointerenter` (the mouse arriving) AND a `click` (the button going down),
     * and the old code had the hover handler synthesise the click. That meant
     * the real click arrived second, found the menu already open, and closed it
     * again - so clicking Edit while File was open closed both and left none,
     * which is the opposite of what the student asked for.
     *
     * So the open is written once, here, and:
     *
     *   - the POINTER calls it directly (no synthetic click at all)
     *   - the PRESS calls it only when the menu is not already open, so the
     *     press that follows a hover-open is the same gesture completing
     *     rather than a second instruction.
     */
    const openFrom = () => {
      closeMenu();

      openMenu = menu.id;
      closeOpenMenu = () => {
        openMenu = null;
        closeOpenMenu = null;
        close();
      };

      open();
    };

    /*
     * ONE CLICK OPENS, ANOTHER CLOSES - and clicking a DIFFERENT label moves
     * straight to it, because the pointer is already on the bar and that is
     * what it means.
     */
    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      /*
       * ALREADY OPEN - the pointer opened it a moment ago and this press is
       * that same gesture finishing, so it stays up. A press on an
       * ALREADY-OPEN menu that the pointer did NOT open is the student
       * closing it again.
       */
      if (openMenu === menu.id) {
        if (!openedByHover) {
          closeMenu();
        }

        openedByHover = false;

        return;
      }

      openedByHover = false;

      openFrom();
    });

    /*
     * HOVERING ANOTHER LABEL WHILE A MENU IS OPEN MOVES TO IT, which is the
     * behaviour every desktop menu bar has and the reason a student can
     * sweep across the bar rather than clicking each one.
     *
     * IT OPENS THE MENU ITSELF rather than clicking its own label. A synthetic
     * click would run the toggle handler above and be immediately undone by the
     * real click that follows it - see `openFrom`.
     */
    label.addEventListener("pointerenter", () => {
      if (openMenu && openMenu !== menu.id) {
        openedByHover = true;

        openFrom();
      }
    });

    labels.push({ menu, label, open, close });

    /*
     * THE MENU GOES INTO THE BAR.
     *
     * This is the line that was missing: the wrapper, the label and the panel
     * were all built correctly and then never attached, so the bar mounted,
     * reported success, and stayed empty.
     */
    host.appendChild(wrap);
  });

  /*
   * CLICKING ANYWHERE ELSE CLOSES.
   *
   * On the document rather than the canvas, because "outside" means outside
   * the menu - a click on a panel, a dialog or the toolbar is just as much a
   * decision to leave. The listener is added on the CAPTURE phase so it runs
   * before a command's own handler can reopen a menu.
   */
  globalThis.document.addEventListener("pointerdown", (event) => {
    if (!openMenu) {
      return;
    }

    if (event.target.closest?.(".datum-menu")) {
      return;
    }

    closeMenu();
  });

  globalThis.document.addEventListener("keydown", (event) => {
    if (!openMenu) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      closeMenu();
    }
  });

  /*
   * A menu must not survive the window losing focus - it would sit open over
   * a window the student has switched away from.
   */
  window.addEventListener("blur", () => closeMenu());

  return { closeMenu, labels };
}

const enggMenuBar = {
  closeMenu,
  installMenuBar,
  isMenuOpen,
};

export default enggMenuBar;
