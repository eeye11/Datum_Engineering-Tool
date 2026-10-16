/*
 * The sheet tab bar.
 *
 * The bar sits under the drawing area and is part of the workspace
 * rather than part of the drawing: it uses the same panel styling as
 * the rest of EnggDraw, but it never sits inside the canvas, never
 * scales with the zoom, and never appears in an export or a reference.
 * That separation is the point of it being its own row - a worksheet
 * tab in Excel belongs to the workbook, not to the cell you are
 * looking at, and the same is true here.
 *
 * It stays reachable at all times, including while a tool is active,
 * because switching sheets is not a drawing operation and must not
 * require putting the current tool down first.
 *
 * A tab can be:
 *   - clicked        to make that sheet active
 *   - clicked again  (or double-clicked) to rename it
 *   - dragged        to reorder it
 *   - right-clicked  for rename / duplicate / delete / move
 *
 * Every one of those acts on a sheet ID and never on a position, which
 * is what makes reordering safe for the references pointing at them.
 *
 * NOT PART OF THE DRAWING
 * -----------------------
 * Nothing in this file reads or writes a camera, a zoom or a pan. The
 * tabs are an application overlay: they are positioned in SCREEN
 * coordinates and are not part of the drawing's transform. Zooming the
 * canvas changes what is drawn and nothing about this bar, and nothing
 * done to this bar changes the zoom.
 */
import enggUi from "../../../shared/ui/ui.js";

let controller = null;
let bar = null;
let menu = null;
let menuAnchor = null;
let draggedId = null;

function attach(element, sheetController) {
  bar = element;
  controller = sheetController;

  if (!bar) {
    return;
  }

  /*
   * A drag on a tab must not turn into a text selection, and a
   * right-click must not open the browser's own menu - both are
   * handled here rather than on each tab, so a tab added later is
   * covered without being told.
   */
  bar.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  bar.addEventListener("dragover", (event) => {
    if (draggedId) {
      event.preventDefault();
    }
  });

  bar.addEventListener("drop", (event) => {
    event.preventDefault();

    const target =
      event.target.closest("[data-sheet-id]");

    if (draggedId && target) {
      controller.onReorder(
        draggedId,
        Number(target.dataset.sheetIndex)
      );
    }

    draggedId = null;
  });
}

function render() {
  if (!bar || !controller) {
    return;
  }

  closeMenu();

  const sheets = controller.getSheets();
  const activeId = controller.getActiveSheetId();
  const onlySheet = sheets.length <= 1;

  bar.textContent = "";

  sheets.forEach((sheet, index) => {
    const tab =
      document.createElement("button");

    tab.type = "button";
    tab.className = "drawing-sheet-tab";
    tab.draggable = true;
    tab.dataset.sheetId = sheet.id;
    tab.dataset.sheetIndex = String(index);
    tab.title = sheet.name;
    tab.setAttribute("aria-label", sheet.name);

    const name =
      document.createElement("span");

    name.className =
      "drawing-sheet-tab-name";

    /*
     * A long name is ellipsised rather than wrapped. A tab that
     * grew taller than the row would push the bar, and the bar is a
     * fixed strip - a sheet list that changes height as names
     * change would be unsettling in a way that has nothing to do
     * with the drawing.
     */
    name.textContent = sheet.name;

    tab.appendChild(name);

    if (sheet.id === activeId) {
      tab.classList.add("active");
      tab.setAttribute("aria-current", "page");
    }

    /*
     * The close control, inside the tab it belongs to.
     *
     * Always present in the DOM and simply not visible until the tab
     * is hovered, rather than added on hover. Adding and removing
     * it would rebuild the tab, and a rebuild between the pointer
     * going down and the click landing would lose the click - which
     * is exactly the moment this button is used.
     *
     * It is a SPAN rather than a nested button: a button inside a
     * button is not valid, and browsers do not reliably keep the
     * two activations apart even when they allow it - which is how
     * clicking delete would also switch sheets.
     */
    const close =
      document.createElement("span");

    close.className =
      "drawing-sheet-close";
    close.dataset.sheetId = sheet.id;
    close.textContent = "×";
    close.setAttribute("aria-hidden", "true");

    /*
     * The document always keeps one sheet, so the control on the
     * last one is inert rather than hidden. A control that vanishes
     * is a control the user cannot find, and cannot tell apart from
     * a bug.
     */
    if (onlySheet) {
      close.classList.add("is-disabled");
    }

    tab.appendChild(close);

    /*
     * Clicking the tab's NAME renames a sheet that is already
     * active.
     *
     * Only for the active sheet: clicking an inactive tab has to
     * switch to it, and silently renaming a sheet someone is
     * switching TO would be an astonishing thing to do. A second
     * click on the tab you are already on, and a double-click, both
     * mean the same deliberate thing - "let me rename this" - and
     * they open the same dialog.
     */
    name.addEventListener("click", (event) => {
      event.stopPropagation();

      if (sheet.id === activeId) {
        controller.onRename(sheet.id);
      } else {
        controller.onActivate(sheet.id);
      }
    });

    close.addEventListener("click", (event) => {
      /*
       * Every reason this must not become something else. Without
       * these the click bubbles to the tab and activates a
       * different sheet, starts a rename, or opens the context
       * menu - so the one control that is a single click would need
       * three clicks and a right-click to agree with.
       */
      event.stopPropagation();
      event.preventDefault();

      controller.onDelete(sheet.id);
    });

    tab.addEventListener("click", () => {
      if (draggedId) {
        return;
      }

      controller.onActivate(sheet.id);
    });

    tab.addEventListener("dblclick", () =>
      controller.onRename(sheet.id)
    );

    tab.addEventListener("dragstart", () => {
      draggedId = sheet.id;
      tab.classList.add("dragging");
    });

    tab.addEventListener("dragend", () => {
      draggedId = null;
      tab.classList.remove("dragging");
    });

    tab.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        controller.onActivate(sheet.id);

        openMenu(tab, sheet, index, sheets.length);
      }
    );

    bar.appendChild(tab);
  });

  const add =
    document.createElement("button");

  add.type = "button";
  add.className = "drawing-sheet-add";
  add.textContent = "+";
  add.title = "New sheet";
  add.setAttribute("aria-label", "New sheet");

  add.addEventListener(
    "click",
    () => controller.onCreate()
  );

  bar.appendChild(add);
}

/*
 * The tab menu.
 *
 * Rename, Duplicate, Delete, Move Left, Move Right.
 *
 * Placed by the shared UI module rather than by fixed offsets. The
 * sheet bar is at the bottom of the workspace and its tabs scroll
 * horizontally, so "below the tab" runs off the bottom and
 * "left-aligned to the tab" runs off the right - and both are the
 * normal case rather than an edge case. The module measures the
 * real space and opens inward, so the whole menu is on screen
 * whichever tab was right-clicked.
 */
function openMenu(anchor, sheet, index, total) {
  closeMenu();

  menuAnchor = anchor;

  menu =
    document.createElement("div");

  menu.className = "drawing-sheet-menu";

  addItem("Rename", () =>
      controller.onRename(sheet.id)
  );

  addItem("Duplicate", () =>
      controller.onDuplicate(sheet.id)
  );

  addItem("Delete", () =>
      controller.onDelete(sheet.id)
  );

  addItem("Move Left", () =>
      controller.onMove(sheet.id, -1)
  );

  addItem("Move Right", () =>
      controller.onMove(sheet.id, 1)
  );

  enggUi.anchorElement(
    menu,
    anchor.getBoundingClientRect(),
    { preferred: "below" }
  );

  /*
   * The last sheet stays, so there is always somewhere for the
   * deleted one's neighbour to go.
   */
  const items = menu.querySelectorAll("button");

  items[2].disabled = total <= 1;
  items[3].disabled = index <= 0;
  items[4].disabled = index >= total - 1;

  window.addEventListener(
    "mousedown",
    dismiss
  );
  window.addEventListener(
    "keydown",
    onKeyDown
  );
  window.addEventListener(
    "resize",
    reposition
  );
}

/*
 * Keep the menu on screen and attached to its tab.
 *
 * A menu placed when the window was wide enough and then left behind
 * a shrunk edge is a menu the user cannot use, and the resize that
 * caused it is not something they did on purpose. Re-placing from
 * the same anchor keeps it attached to its tab and on screen; if the
 * tab itself has gone - deleted, renamed away - the menu closes,
 * because there is no longer anything to belong to.
 */
function reposition() {
  if (!menu) {
    return;
  }

  if (
    !menuAnchor ||
    !menuAnchor.isConnected
  ) {
    closeMenu();

    return;
  }

  enggUi.anchorElement(
    menu,
    menuAnchor.getBoundingClientRect(),
    { preferred: "below" }
  );
}

function dismiss(event) {
  if (menu && menu.contains(event.target)) {
    return;
  }

  closeMenu();
}

function onKeyDown(event) {
  if (event.key === "Escape") {
    closeMenu();
  }
}

function addItem(label, action) {
  const item =
    document.createElement("button");

  item.type = "button";
  item.textContent = label;

  item.addEventListener("click", () => {
    closeMenu();
    action();
  });

  menu.appendChild(item);
}

function closeMenu() {
  window.removeEventListener(
    "mousedown",
    dismiss
  );
  window.removeEventListener(
    "keydown",
    onKeyDown
  );
  window.removeEventListener(
    "resize",
    reposition
  );

  menuAnchor = null;

  if (menu && menu.parentNode) {
    menu.parentNode.removeChild(menu);
  }

  menu = null;
}

const enggSheetTabs = {
  attach,
  render
};

export default enggSheetTabs;
