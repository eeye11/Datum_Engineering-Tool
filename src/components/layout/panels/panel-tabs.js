/*
 * ============================================================
 * THE DRAWING PANEL'S THREE TABS
 * ============================================================
 *
 * Objects | Features | Source - three sibling tabs in the existing
 * right-side panel. The order is fixed and is not reordered by context.
 *
 * WHY THEY ARE SIBLINGS AND NOT THREE PANELS.
 *
 * They answer three different questions about ONE drawing:
 *
 *   Objects     what has been drawn on this sheet, and which of it is selected?
 *   Features    what can I change about the object or objects I have selected?
 *               Empty when nothing is selected - an armed tool's construction
 *               options belong to the toolbar, not here.
 *   Source      what LaTeX/TikZ generates this drawing?
 *
 * Because it is one drawing, there is one selection and one source. Three
 * separate panels would each keep their own copy of "what is selected" and
 * "what is the drawing", and they would disagree the first time an object was
 * selected while Source was open. So the tabs share the application's existing
 * selection state - `drawingState.selection.selectedObjectIds` - and this module
 * owns nothing but which tab is showing. Selecting an object opens Features
 * (see `drawing-panel.js`); changing a tab never changes what is selected.
 *
 * SWITCHING TABS MUST NOT CHANGE THE DRAWING.
 *
 * Opening Source must not clear the selection or discard a draft; opening
 * Objects must not stop the source editor from holding what was typed. The
 * active tab is therefore held on the editor state as a plain string, and
 * switching it does nothing except show a different pane. Everything the panes
 * display is read from the shared state when they are rendered, so nothing has
 * to be "carried across" a switch.
 */

import {
  drawingState,
  editorState,
} from "../../../features/workspace/editor-state.js";

export const PANEL_TABS = ["objects", "features", "source"];

export const DEFAULT_PANEL_TAB = "objects";

/*
 * The elements. Looked up lazily rather than at module load, so this module can
 * be imported by a test whose DOM is set up afterwards, and so a module that
 * imports it does not fail on a page without the panel.
 */
function tabButtons() {
  const dom = globalThis.document;
  return dom ? [...dom.querySelectorAll("[data-panel-tab]")] : [];
}

function tabPanes() {
  const dom = globalThis.document;
  return dom ? [...dom.querySelectorAll("[data-panel-pane]")] : [];
}

/*
 * ============================================================
 * THE ACTIVE TAB
 * ============================================================
 *
 * Held on the shared editor state so a module that needs to know which tab is
 * open - the selection sync, for example, which must not force Source closed -
 * can read it without importing this module and creating a cycle.
 */
export function activePanelTab() {
  const tab = editorState.drawingPanelTab;

  return PANEL_TABS.includes(tab) ? tab : DEFAULT_PANEL_TAB;
}

export function setActivePanelTab(tab, { focus = false } = {}) {
  if (!PANEL_TABS.includes(tab)) {
    return;
  }

  editorState.drawingPanelTab = tab;

  tabButtons().forEach((button) => {
    const isActive = button.dataset.panelTab === tab;

    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });

  tabPanes().forEach((pane) => {
    pane.hidden = pane.dataset.panelPane !== tab;
  });

  /*
   * A tab that has just become visible may need to size itself. The source
   * editor and the feature fields both read their own box, and a `hidden`
   * element has no box at all - the same problem the drawing canvas has when
   * its tab is hidden. So each tab's own module is told the tab is open and
   * can measure itself then, rather than being measured while hidden.
   *
   * The event is constructed from the document's own window: in a test DOM
   * (jsdom) the event constructors live on the window and are not on Node's
   * globalThis, so a bare `new CustomEvent` would throw there. When there is
   * no window to ask - a module imported by a test with no DOM - the
   * announcement is skipped, which is correct: there is nobody listening.
   */
  const dom = globalThis.document;
  const EventCtor = dom?.defaultView?.CustomEvent;

  if (typeof EventCtor === "function") {
    dom.dispatchEvent(new EventCtor("datum:panel-tab-changed", { detail: { tab } }));
  }

  if (focus) {
    const button = tabButtons().find((entry) => entry.dataset.panelTab === tab);

    button?.focus();
  }
}

/*
 * The application's existing "Features" entry point - the toolbar's Features
 * button and the "back to Features" link - opens the Features tab. It is kept
 * as a named export so the call sites that already exist keep working and read
 * as what they do.
 */
export function showFeaturesPanel() {
  setActivePanelTab("features");
}

export function showObjectsPanel() {
  setActivePanelTab("objects");
}

/*
 * Kept as an alias of showObjectsPanel so callers written against the previous
 * tab name keep resolving to the same tab rather than silently doing nothing.
 */
export function showPropertiesPanel() {
  setActivePanelTab("objects");
}

export function showSourcePanel() {
  setActivePanelTab("source");
}

/*
 * Keyboard navigation over the tab strip, as a tablist should have: the arrow
 * keys move between tabs. It is the strip's own behaviour, so it does not
 * depend on any pane being implemented.
 */
function handleTabKeydown(event) {
  const button = event.target.closest?.("[data-panel-tab]");

  if (!button) {
    return;
  }

  const index = PANEL_TABS.indexOf(button.dataset.panelTab);

  if (index < 0) {
    return;
  }

  let next = null;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    next = PANEL_TABS[(index + 1) % PANEL_TABS.length];
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    next = PANEL_TABS[(index - 1 + PANEL_TABS.length) % PANEL_TABS.length];
  } else if (event.key === "Home") {
    next = PANEL_TABS[0];
  } else if (event.key === "End") {
    next = PANEL_TABS[PANEL_TABS.length - 1];
  }

  if (next) {
    event.preventDefault();
    setActivePanelTab(next, { focus: true });
  }
}

/*
 * Wire the strip to the page. Called once at start-up. It does not render any
 * pane's contents - each pane's own module does that when the tab opens or the
 * shared state changes.
 */
export function installPanelTabs() {
  const buttons = tabButtons();

  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setActivePanelTab(button.dataset.panelTab);
    });

    button.addEventListener("keydown", handleTabKeydown);
  });

  /*
   * Start on Objects with the panes in the state the markup declares, so a
   * page that loads with the panel already open shows a coherent strip rather
   * than one whose classes and panes disagree.
   */
  setActivePanelTab(activePanelTab());
}

/*
 * A small helper the panes use to find out whether they are the visible one.
 * Reading the shared state rather than the DOM keeps the answer the same in a
 * test and in the browser.
 */
export function isPanelTabActive(tab) {
  return activePanelTab() === tab;
}

/*
 * The active tool id, read from the shared state. Exported here so a pane does
 * not have to know where the tool lives to know whether one is active.
 */
export function activeToolId() {
  return drawingState.activeTool || null;
}

export default {
  PANEL_TABS,
  DEFAULT_PANEL_TAB,
  activePanelTab,
  setActivePanelTab,
  showFeaturesPanel,
  showObjectsPanel,
  showPropertiesPanel,
  showSourcePanel,
  installPanelTabs,
  isPanelTabActive,
  activeToolId,
};
