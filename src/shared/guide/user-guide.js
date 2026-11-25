/*
 * ============================================================
 * THE USER GUIDE
 * ============================================================
 *
 * The interface behind Help → User Guide. It sits OVER the drawing, exactly as
 * the Settings and Help dialogs do, and it never touches the document: it
 * reads, it does not write. That is what makes "closing the guide returns to
 * the exact drawing you left" true by construction rather than by remembering
 * to save and restore.
 *
 * THE THREE SCREENS, AND HOW THEY LEAD BACK
 * -----------------------------------------
 *
 *   LIST      the eleven sections, searchable. Cancel closes the guide.
 *   SECTION   one section: its Tutorials and its Tool Reference, two tabs.
 *   TUTORIAL  the walkthrough, as an overlay drawn by `guide-tutorial.js`.
 *
 * The flow the requirement pins is:
 *
 *   drawing → Help → User Guide → section → tutorial → Done
 *           → LIST → Cancel → the same drawing
 *
 * so Done returns to the LIST (never straight to the canvas), Back returns one
 * screen at a time without closing anything, and Cancel - and only Cancel - is
 * what takes the guide away.
 *
 * WHAT THIS MODULE REUSES
 * -----------------------
 *   the dialog pattern      `shared/ui/help-dialog.js` - one backdrop element,
 *                           Escape to close, the backdrop itself is the scrim
 *   the icon set            `toolbar/icons.js`, so the guide's marks are the
 *                           menu's marks
 *   the tool registry       through `guide-tool-metadata.js`, so the Tool
 *                           Reference cannot list a tool the toolbar does not
 *                           have, or miss one it does
 *   the toolset buttons     `[data-category]` - a section opens its category
 *                           by CLICKING the real button, never by a copy of it
 */

import { menuIcon } from "../../components/layout/toolbar/icons.js";
import {
  SECTIONS,
  TUTORIALS,
  GUIDE_TARGETS,
  WORKSPACE_REFERENCE,
  TOOL_NOTES,
  sectionById,
  tutorialsFor,
} from "./guide-content.js";
import {
  toolsForCategory,
  openingInstructionOf,
  mathInstructionOf,
} from "./guide-tool-metadata.js";
import {
  beginSession as beginDeviceSession,
  endSession as endDeviceSession,
  deviceSelectHtml,
  onModeChange,
  currentMode,
  setMode,
} from "./guide-device.js";
import { instructionFor } from "./guide-wording.js";

/* The open guide, if any. One at a time - it is a modal. */
let openDialog = null;

/* Where the guide currently is, so Back knows what "back" means. */
let currentScreen = "list";

/* The guide's own open tutorial overlay, if one is running. */
let openTutorial = null;

/* A workspace restore still in flight, so Close can wait for it if it must. */
let leaving = null;

/* The mode subscription for the open guide, removed when it closes. */
let unsubscribeMode = null;

/* Which section is open, and which of its two tabs is showing. */
let currentSectionId = null;
let currentTab = "tutorials";

/* The search term, kept while the guide is open so Back restores it. */
let searchTerm = "";

/* The element the guide was opened from, to give focus back on close. */
let previousFocus = null;

/*
 * ============================================================
 * SMALL HELPERS
 * ============================================================
 */

/* Text that came from the registry or from an authored note is HTML-escaped. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* A section's icon, from the shared menu icon set. */
function sectionIcon(section) {
  return menuIcon(section.icon || "book-open", 18);
}

/*
 * ============================================================
 * THE SHELL
 * ============================================================
 *
 * One element, three regions inside it: a title bar with the Back and Cancel
 * controls, a scrolling body, and a footer that states where the student is.
 * The body's contents are replaced per screen; the shell is not rebuilt, so
 * focus and scroll position are never thrown away by a screen change.
 */
function shellHtml() {
  return `
    <div class="datum-guide-panel" role="document">
      <div class="datum-guide-title">
        <button
          type="button"
          class="datum-guide-back"
          data-guide-back
          hidden
          aria-label="Back"
        >
          <span aria-hidden="true">&larr;</span>
          <span class="datum-guide-back-label">Back</span>
        </button>

        <span class="datum-guide-title-text" data-guide-title>User Guide</span>

        <span class="datum-guide-title-spacer"></span>

        <button
          type="button"
          class="datum-guide-cancel"
          data-guide-cancel
          aria-label="Close the User Guide"
        >
          Cancel
        </button>
      </div>

      <div class="datum-guide-body" data-guide-body></div>

      <div class="datum-guide-footer">
        <span class="datum-guide-crumb" data-guide-crumb>All sections</span>
        <span class="datum-guide-hint">Esc closes the guide</span>
      </div>
    </div>
  `;
}

/*
 * ============================================================
 * SCREEN: THE SECTION LIST
 * ============================================================
 *
 * A search field, then a grid of section cards. The grid is `auto-fill` so it
 * becomes fewer columns on a narrow window rather than clipping; nothing about
 * the markup knows how many columns there are.
 */

/* A section's searchable text, so "dimension" finds Annotate. */
function sectionSearchText(section) {
  return [section.title, section.blurb, section.description]
    .join(" ")
    .toLowerCase();
}

function sectionCardHtml(section) {
  const tutorials = tutorialsFor(section.id).length;

  return `
    <button
      type="button"
      class="datum-guide-card"
      data-guide-section="${escapeHtml(section.id)}"
      aria-label="${escapeHtml(section.title)}"
    >
      <span class="datum-guide-card-icon" aria-hidden="true">${sectionIcon(section)}</span>
      <span class="datum-guide-card-text">
        <span class="datum-guide-card-title">${escapeHtml(section.title)}</span>
        <span class="datum-guide-card-blurb">${escapeHtml(section.blurb)}</span>
        <span class="datum-guide-card-meta">${tutorials ? `${tutorials} tutorial${tutorials === 1 ? "" : "s"}` : "Tool reference"}</span>
      </span>
    </button>
  `;
}

/*
 * THE DEVICE CONTROL, ON THE SELECTION PAGE.
 *
 * A change here is the student's own choice, so it is respected and detection
 * stops overriding it for the rest of the session. The tutorial header builds
 * the SAME control from the same module and wires it the same way, so the two
 * screens can never show different values.
 */
function bindDeviceControl(root) {
  const select = root?.querySelector("[data-device-select]");

  if (!select) {
    return;
  }

  select.value = currentMode();

  select.addEventListener("change", () => {
    setMode(select.value, { fromStudent: true });
  });
}

/*
 * KEEP THE VISIBLE CONTROL IN STEP WITH THE DETECTED MODE.
 *
 * When a student picks up a stylus mid-session the mode changes underneath the
 * dropdown, and a dropdown showing a stale value would be lying about what the
 * tutorials are going to say. So every device control on screen is re-pointed
 * whenever the mode changes - without dispatching a `change`, which would look
 * like a choice the student did not make.
 */
function syncDeviceControls(mode) {
  document.querySelectorAll("[data-device-select]").forEach((select) => {
    if (select.value !== mode) {
      select.value = mode;
    }
  });
}

function renderList(body) {
  currentScreen = "list";
  currentSectionId = null;

  body.innerHTML = `
    <div class="datum-guide-list-head">
      <h2 class="datum-guide-heading">User Guide</h2>
      <p class="datum-guide-subtitle">
        Step-by-step tutorials and a reference for every tool, drawn from the
        tools this application actually has.
      </p>

      <!--
        THE DEVICE SETTING SITS HERE - under the heading and its description,
        above the search and the sections.

        It is the ONE thing on this page that changes how the rest of the guide
        will talk to the student, so it is stated before they choose anything,
        and the tutorials it affects are the same tutorials either way.

        IT LIVES ON THE SELECTION PAGE ONLY. Once a student is inside a section
        the tutorial header carries the same control, in the same place a header
        would put it - one device setting visible at a time, never two that could
        disagree.
      -->
      <div class="datum-guide-settings" data-guide-settings>
        ${deviceSelectHtml({ id: "datumGuideDevice", className: "datum-device-row" })}
      </div>

      <label class="datum-guide-search" aria-label="Search the sections">
        <span class="datum-guide-search-icon" aria-hidden="true">${menuIcon("scan-search", 15)}</span>
        <input
          type="search"
          data-guide-search
          placeholder="Search sections&#8230;"
          autocomplete="off"
          spellcheck="false"
          value="${escapeHtml(searchTerm)}"
          aria-label="Search the sections"
        >
      </label>
    </div>

    <div class="datum-guide-grid" data-guide-grid role="list">
      ${SECTIONS.map(sectionCardHtml).join("")}
    </div>

    <p class="datum-guide-empty" data-guide-empty hidden>
      No section matches that search.
    </p>
  `;

  bindDeviceControl(body);

  const input = body.querySelector("[data-guide-search]");
  const grid = body.querySelector("[data-guide-grid]");
  const empty = body.querySelector("[data-guide-empty]");

  const applyFilter = () => {
    const term = input.value.trim().toLowerCase();

    searchTerm = input.value;

    let shown = 0;

    grid.querySelectorAll("[data-guide-section]").forEach((card) => {
      const section = sectionById(card.dataset.guideSection);

      const match = !term || sectionSearchText(section).includes(term);

      card.hidden = !match;

      if (match) {
        shown += 1;
      }
    });

    empty.hidden = shown > 0;
  };

  input.addEventListener("input", applyFilter);

  input.addEventListener("keydown", (event) => {
    /* Enter opens the first section still showing - the search is a filter. */
    if (event.key === "Enter") {
      event.preventDefault();

      grid.querySelector("[data-guide-section]:not([hidden])")?.click();
    }
  });

  applyFilter();
}

/*
 * ============================================================
 * SCREEN: ONE SECTION
 * ============================================================
 *
 * The section's name and description, two tabs, and the tab's contents.
 * The Tutorials tab lists the walkthroughs that exist and says plainly where a
 * section has none yet; the Tool Reference lists every tool the registry
 * offers with the authored notes attached to it.
 */

/*
 * A HELP CONSOLE IS NOT A TOOL - IT IS A SECOND DOOR ONTO THE SAME TOOL.
 *
 * Every discipline opens with a `select` entry, and the reference would say
 * the same thing eight times. It is listed once, in Workspace & Navigation, and
 * skipped in the sections whose first group is the shared selection.
 */
const SHARED_SELECT = {
  usage:
    "Click a feature to select it. Dragging on empty canvas selects everything the rectangle crosses.",
  tips: ["Escape from any tool returns to Select."],
};

function tutorialListHtml(section, mode = currentMode()) {
  const tutorials = tutorialsFor(section.id);

  if (!tutorials.length) {
    return `
      <div class="datum-guide-placeholder">
        <p class="datum-guide-placeholder-title">No tutorial for this section yet</p>
        <p>
          The guided walkthroughs for
          <strong>${escapeHtml(section.title)}</strong> are not written yet.
          The <button type="button" class="datum-guide-inline-link" data-guide-show-tab="reference">Tool Reference</button>
          lists every tool in this section with what it does and how it is used.
        </p>
      </div>
    `;
  }

  return `
    <p class="datum-guide-lead">
      Each tutorial walks through one workflow, one step at a time. A tutorial
      points at the real controls and never changes your drawing.
    </p>

    <ul class="datum-guide-list" role="list">
      ${tutorials
        .map(
          (tutorial) => `
        <li>
          <button
            type="button"
            class="datum-guide-row"
            data-guide-tutorial="${escapeHtml(tutorial.id)}"
          >
            <span class="datum-guide-row-main">
              <span class="datum-guide-row-title">${escapeHtml(tutorial.title)}</span>
              <span class="datum-guide-row-text">${escapeHtml(
                instructionFor(tutorial.summary || "", mode),
              )}</span>
            </span>
            <span class="datum-guide-row-meta">
              ${tutorial.steps.length} steps
              <span class="datum-guide-row-go" aria-hidden="true">&rarr;</span>
            </span>
          </button>
        </li>
      `,
        )
        .join("")}
    </ul>
  `;
}

/* One reference entry: the registry's facts, then the authored notes. */
function referenceEntryHtml(entry, note) {
  const shortcut = entry.shortcut
    ? `<span class="datum-guide-kbd">${escapeHtml(entry.shortcut)}</span>`
    : "";

  const group = entry.group
    ? `<span class="datum-guide-ref-group">${escapeHtml(entry.group)}</span>`
    : "";

  if (entry.parent) {
    return `
      <li class="datum-guide-ref">
        <details class="datum-guide-ref-details">
          <summary class="datum-guide-ref-summary">
            <span class="datum-guide-ref-name">${escapeHtml(entry.label)}</span>
            <span class="datum-guide-ref-tag">group</span>
          </summary>
          <div class="datum-guide-ref-body">
            ${group}
            ${renderNote(note, entry)}
            <p class="datum-guide-ref-usage">
              Pressing this opens the tools inside it in place; it does not arm
              a tool itself.
            </p>
            <ul class="datum-guide-ref-children" role="list">
              ${entry.children
                .map(
                  (child) => `
                <li>
                  <span class="datum-guide-ref-name">${escapeHtml(child.label)}</span>
                  <span class="datum-guide-ref-inline">${renderInlineNote(TOOL_NOTES[child.id])}</span>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
        </details>
      </li>
    `;
  }

  return `
    <li class="datum-guide-ref" data-guide-tool-id="${escapeHtml(entry.id || "")}">
      <details class="datum-guide-ref-details">
        <summary class="datum-guide-ref-summary">
          <span class="datum-guide-ref-name">${escapeHtml(entry.label)}</span>
          ${shortcut}
          ${group}
        </summary>
        <div class="datum-guide-ref-body">
          ${renderNote(note, entry)}
        </div>
      </details>
    </li>
  `;
}

/* The authored part of an entry, or the honest placeholder. */
function renderNote(note, entry) {
  if (!entry.id) {
    return `<p class="datum-guide-ref-todo">This entry is listed by the toolset but has not been documented yet.</p>`;
  }

  const parts = [];

  if (!note) {
    parts.push(
      `<p class="datum-guide-ref-todo">Not documented yet. This tool is listed in the toolbar; its behaviour has not been written up here, so nothing is claimed about it.</p>`,
    );

    return parts.join("");
  }

  if (note.notes) {
    parts.push(
      `<p class="datum-guide-ref-inline">${escapeHtml(note.notes)}</p>`,
    );
  }

  if (note.context) {
    parts.push(
      `<p class="datum-guide-ref-line"><span class="datum-guide-ref-label">Acts on</span> ${escapeHtml(note.context)}</p>`,
    );
  }

  if (note.usage) {
    parts.push(
      `<p class="datum-guide-ref-line"><span class="datum-guide-ref-label">Using it</span> ${escapeHtml(note.usage)}</p>`,
    );
  }

  if (note.properties) {
    parts.push(
      `<p class="datum-guide-ref-line"><span class="datum-guide-ref-label">Properties</span> ${escapeHtml(note.properties)}</p>`,
    );
  }

  if (note.handles) {
    parts.push(
      `<p class="datum-guide-ref-line"><span class="datum-guide-ref-label">Handles</span> ${escapeHtml(note.handles)}</p>`,
    );
  }

  if (note.tips && note.tips.length) {
    parts.push(
      `<ul class="datum-guide-ref-tips">${note.tips
        .map((tip) => `<li>${escapeHtml(tip)}</li>`)
        .join("")}</ul>`,
    );
  }

  return parts.length
    ? parts.join("")
    : `<p class="datum-guide-ref-todo">Listed and available; its use has not been written up here yet.</p>`;
}

function renderInlineNote(note) {
  if (!note || !note.usage) {
    return "";
  }

  return escapeHtml(note.usage);
}

/* The Workspace & Navigation reference: general commands, not drawing tools. */
function workspaceReferenceHtml() {
  return `
    <p class="datum-guide-lead">
      The commands that work everywhere: moving around the sheet, selecting and
      managing objects, and the menus themselves. These are not drawing tools, so
      they are not listed in a toolset.
    </p>

    <ul class="datum-guide-list datum-guide-list-reference" role="list">
      ${WORKSPACE_REFERENCE.map(
        (item) => `
        <li class="datum-guide-ref">
          <details class="datum-guide-ref-details">
            <summary class="datum-guide-ref-summary">
              <span class="datum-guide-ref-name">${escapeHtml(item.title)}</span>
              <span class="datum-guide-ref-group">${escapeHtml(item.where)}</span>
            </summary>
            <div class="datum-guide-ref-body">
              <p class="datum-guide-ref-line">${escapeHtml(item.purpose)}</p>
              <ul class="datum-guide-ref-tips">
                ${item.usage.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
              </ul>
            </div>
          </details>
        </li>
      `,
      ).join("")}
    </ul>
  `;
}

/*
 * THE DISCIPLINE REFERENCE, built from the registry.
 *
 * The list is awaited before this is called - `renderReference` is async and
 * the body is filled when it resolves. The opening instruction is fetched per
 * tool from the activation layer, which is the string the status bar would
 * show, so a documented first step and the application cannot disagree.
 */
async function referenceEntriesHtml(section) {
  if (!section.category) {
    return workspaceReferenceHtml();
  }

  const entries = await toolsForCategory(section.category);

  if (!entries.length) {
    return `
      <div class="datum-guide-placeholder">
        <p class="datum-guide-placeholder-title">Nothing to reference</p>
        <p>This toolset does not currently list any tools.</p>
      </div>
    `;
  }

  const withInstruction = await Promise.all(
    entries.map(async (entry) => {
      if (entry.parent || !entry.id) {
        return { entry, instruction: null };
      }

      const instruction =
        (await openingInstructionOf(entry.id)) ||
        (await mathInstructionOf(entry.id));

      return { entry, instruction };
    }),
  );

  return `
    <p class="datum-guide-lead">
      Every tool in this section, in the order the Tools panel shows them. The
      first line of each entry is the instruction the status bar gives when the
      tool is armed.
    </p>

    <ul class="datum-guide-list datum-guide-list-reference" role="list">
      ${withInstruction
        .map(({ entry, instruction }) => {
          const note = entry.id ? TOOL_NOTES[entry.id] : null;

          const merged =
            entry.id === "select"
              ? { ...SHARED_SELECT, ...(note || {}) }
              : note;

          const withInstructionNote =
            instruction && merged
              ? { ...merged, instruction }
              : instruction
                ? { context: undefined, usage: instruction }
                : merged;

          return referenceEntryHtml(entry, withInstructionNote);
        })
        .join("")}
    </ul>
  `;
}

function renderSection(body) {
  currentScreen = "section";

  const section = sectionById(currentSectionId);

  if (!section) {
    renderList(body);
    return;
  }

  body.innerHTML = `
    <div class="datum-guide-section-head">
      <h2 class="datum-guide-heading">
        <span class="datum-guide-heading-icon" aria-hidden="true">${sectionIcon(section)}</span>
        ${escapeHtml(section.title)}
      </h2>
      <p class="datum-guide-subtitle">${escapeHtml(section.description)}</p>

      <div class="datum-guide-tabs" role="tablist" aria-label="${escapeHtml(section.title)} contents">
        <button
          type="button"
          role="tab"
          class="datum-guide-tab"
          data-guide-tab="tutorials"
          aria-selected="${currentTab === "tutorials"}"
        >Tutorials</button>
        <button
          type="button"
          role="tab"
          class="datum-guide-tab"
          data-guide-tab="reference"
          aria-selected="${currentTab === "reference"}"
        >Tool Reference</button>
      </div>
    </div>

    <div class="datum-guide-tabpanel" role="tabpanel" data-guide-tabpanel>
      <p class="datum-guide-loading">Loading&#8230;</p>
    </div>
  `;

  const panel = body.querySelector("[data-guide-tabpanel]");

  const showTab = async (tab) => {
    currentTab = tab;

    body.querySelectorAll("[data-guide-tab]").forEach((button) => {
      button.setAttribute(
        "aria-selected",
        String(button.dataset.guideTab === tab),
      );
    });

    if (tab === "tutorials") {
      panel.innerHTML = tutorialListHtml(section);
    } else {
      panel.innerHTML = `<p class="datum-guide-loading">Loading&#8230;</p>`;
      panel.innerHTML = await referenceEntriesHtml(section);
    }
  };

  body.querySelectorAll("[data-guide-tab]").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.guideTab));
  });

  showTab(currentTab);
}

/*
 * ============================================================
 * NAVIGATION
 * ============================================================
 *
 * Back goes one screen at a time and NEVER closes the guide. Cancel (and
 * Escape) closes it and restores the drawing. A running tutorial captures
 * Escape first, so Escape mid-tutorial steps back OUT of the tutorial to the
 * section, not out of the guide entirely - which is the same "back" the Back
 * button offers.
 */

function syncChrome() {
  const back = openDialog?.querySelector("[data-guide-back]");
  const title = openDialog?.querySelector("[data-guide-title]");
  const crumb = openDialog?.querySelector("[data-guide-crumb]");

  if (!openDialog) {
    return;
  }

  const section = currentSectionId ? sectionById(currentSectionId) : null;

  if (back) {
    back.hidden = currentScreen === "list";
  }

  if (title) {
    title.textContent = section ? section.title : "User Guide";
  }

  if (crumb) {
    crumb.textContent = section
      ? `User Guide › ${section.title}`
      : "All sections";
  }
}

function goBack() {
  if (openTutorial) {
    openTutorial.stop({ silent: true });
    openTutorial = null;

    currentScreen = "section";
    syncChrome();

    return true;
  }

  if (currentScreen === "section") {
    renderList(openDialog.querySelector("[data-guide-body]"));
    syncChrome();

    return true;
  }

  return false;
}

function openSection(sectionId) {
  currentSectionId = sectionId;
  currentTab = "tutorials";

  renderSection(openDialog.querySelector("[data-guide-body]"));
  syncChrome();

  /* A section is entered from the list, so the list is what Back goes to. */
  openDialog.querySelector("[data-guide-body]").scrollTop = 0;
}

/*
 * ============================================================
 * OPENING AND CLOSING
 * ============================================================
 */

function isOpen() {
  return openDialog !== null;
}

function close() {
  /*
   * THE TUTORIAL WORKSPACE GOES BACK FIRST.
   *
   * A student who leaves from the middle of a tutorial leaves a scratch sheet
   * in the editor. Restoring the document is asynchronous (the sheet, the
   * controller and the renderer are imported on demand, and the first time the
   * swap happens they are being loaded for the first time), so the guide does
   * not try to do it synchronously on the way out - it starts the restore and
   * removes its own interface immediately, which is what the student sees.
   *
   * The restore cannot fail to find its capture: `leave()` holds the original
   * document in memory until it has put it back, so even a torn-down guide
   * still restores the drawing.
   */
  leaving = leaveTutorialWorkspace();

  leaving.then(() => {
    leaving = null;
  });

  /*
   * A tutorial closes NEXT, and it is told to stop rather than being deleted
   * from under itself: it owns document-level listeners and a cursor
   * animation, and dropping its element alone would leave both running.
   */
  if (openTutorial) {
    openTutorial.stop({ silent: true });
    openTutorial = null;
  }

  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  currentScreen = "list";
  currentSectionId = null;
  currentTab = "tutorials";
  searchTerm = "";

  unsubscribeMode?.();
  unsubscribeMode = null;

  endDeviceSession();

  document.removeEventListener("keydown", handleKeydown, true);

  /*
   * Focus goes back where it came from, so closing the guide leaves the
   * keyboard where the student was before opening it - usually the menu.
   */
  if (previousFocus && typeof previousFocus.focus === "function") {
    try {
      previousFocus.focus();
    } catch (error) {
      /* The element may have gone; nothing else to do. */
    }
  }

  previousFocus = null;
}

/*
 * START A TUTORIAL.
 *
 * The overlay module is imported on demand: a student who opens the guide and
 * never starts a walkthrough never loads it, and the guide itself stays small.
 *
 * A TUTORIAL RUNS IN THE TUTORIAL WORKSPACE.
 *
 * The steps ask the student to DRAW, and drawing is real work on the real
 * editor - so the editor is switched to a scratch sheet for the duration. That
 * is `guide-workspace.js`: it captures the document, the selection and the
 * camera, swaps in an empty sheet, and puts the student's drawing back
 * afterwards. The tutorial, its validation and its cursor all run against the
 * real controls either way, because the two sheets are the same editor.
 */
async function startTutorial(tutorialId) {
  const section = sectionById(currentSectionId);

  /*
   * THE TUTORIAL IS FOUND IN THE SECTION'S OWN TABLE.
   *
   * `tutorialsFor` is a convenience that filters out an empty tutorial; the id
   * being started was chosen from this same table, so the lookup here is the
   * table itself - which means a step id can never fail to resolve merely
   * because a section's list changed shape between drawing and clicking.
   */
  const tutorial = (TUTORIALS[currentSectionId] || []).find(
    (candidate) => candidate.id === tutorialId,
  );

  if (!section || !tutorial) {
    return;
  }

  /*
   * THE SWAP IS AWAITED BEFORE THE OVERLAY APPEARS, so the first step's target
   * is measured on the sheet the student will actually work on - not on their
   * own drawing a frame before it is replaced.
   */
  await enterTutorialWorkspace();

  /*
   * THE GUIDE MAY HAVE CLOSED WHILE THE WORKSPACE WAS BEING SWAPPED.
   *
   * Opening the scratch sheet is asynchronous (the sheet controller and the
   * renderer are imported on demand), and a student can press Cancel in that
   * window. Starting an overlay against a dialog that has gone would leave an
   * orphan over the restored drawing - so the two checks after an await are
   * deliberate, not defensive noise.
   */
  if (!openDialog) {
    return;
  }

  if (!openTutorial) {
    const { createTutorialOverlay } = await import("./guide-tutorial.js");

    openTutorial = createTutorialOverlay({
      guide: {
        list: GUIDE_TARGETS.list,
        tabs: GUIDE_TARGETS.tabs,
      },
      onFinish: () => {
        /*
         * DONE RETURNS TO THE GUIDE'S LIST, NOT TO THE DRAWING.
         *
         * The requirement's flow is tutorial → Done → the section selection
         * window, where Cancel is what finally puts the guide away. So Done
         * closes the overlay, puts the student's own drawing back, and goes
         * back to where they started.
         */
        openTutorial = null;

        leaveTutorialWorkspace();

        renderList(openDialog.querySelector("[data-guide-body]"));
        syncChrome();

        openDialog.querySelector("[data-guide-body]").scrollTop = 0;
      },
      onExit: () => {
        /*
         * Back out of the tutorial: the section it was started from, with the
         * student's own drawing restored underneath it. Backing out MID-TUTORIAL
         * discards the scratch sheet's contents - which is the point of a
         * scratch sheet - and loses nothing of the student's.
         */
        openTutorial = null;

        leaveTutorialWorkspace();

        renderSection(openDialog.querySelector("[data-guide-body]"));
        syncChrome();
      },
    });
  }

  openTutorial.start(tutorial, section);
}

/*
 * THE TUTORIAL WORKSPACE, ENTERED AND LEFT.
 *
 * Both are thin wrappers so the rest of this file never has to know that the
 * isolation lives in its own module - and so a failure to swap in the scratch
 * sheet degrades to "the tutorial runs on the drawing" rather than to "the
 * tutorial does not open".
 */
async function enterTutorialWorkspace() {
  try {
    const workspace = await import("./guide-workspace.js");

    await workspace.enter();
  } catch (error) {
    /*
     * A WORKSPACE THAT CANNOT BE SWAPPED IS NOT A REASON TO REFUSE TO TEACH.
     * The tutorial's steps still explain what to do; the student simply works
     * on their own sheet. Nothing is lost either way, because the alternative -
     * opening a tutorial that told the student to draw in a sheet that never
     * appeared - would be worse.
     */
  }
}

function leaveTutorialWorkspace() {
  return import("./guide-workspace.js")
    .then((workspace) => workspace.leave())
    .catch(() => false);
}

function handleKeydown(event) {
  if (!isOpen()) {
    return;
  }

  if (event.key !== "Escape") {
    return;
  }

  /*
   * ESCAPE IS THE BACK BUTTON, NOT THE CLOSE BUTTON.
   *
   * Closing the whole guide on one Escape would throw away the section the
   * student was reading. So a running tutorial consumes it (stepping back to
   * the section), a section consumes it (stepping back to the list), and only
   * the list itself lets it close the guide.
   */
  event.preventDefault();
  event.stopPropagation();

  if (!goBack()) {
    close();
  }
}

function open() {
  if (openDialog) {
    return openDialog;
  }

  previousFocus = document.activeElement;

  const dialog = document.createElement("div");

  dialog.className = "datum-guide-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "User Guide");

  dialog.innerHTML = shellHtml();

  document.body.appendChild(dialog);

  openDialog = dialog;

  /*
   * A NEW GUIDE SESSION STARTS HERE.
   *
   * The device preference belongs to the SESSION, not to the browser: the guide
   * works out how the student is inputting again each time it opens, from the
   * input they actually use. `beginDeviceSession` also starts watching for
   * mouse and touch so the detection is live rather than guessed once.
   */
  beginDeviceSession();

  unsubscribeMode = onModeChange((mode) => {
    syncDeviceControls(mode);

    /* Re-word the page the student is looking at, without rebuilding it. */
    if (currentScreen === "section" && currentTab === "tutorials") {
      const panel = dialog.querySelector("[data-guide-tabpanel]");

      if (panel && currentSectionId) {
        panel.innerHTML = tutorialListHtml(sectionById(currentSectionId), mode);
      }
    }
  });

  /*
   * THE MODE IS DETECTED FROM REAL INPUT, SO THE CONTROL FOLLOWS IT.
   *
   * A student who presses with a stylus while the guide is open has the
   * dropdown moved for them - unless they have chosen a mode themselves, in
   * which case `guide-device` stops listening and this never fires again for
   * the rest of the session.
   */
  syncDeviceControls(currentMode());

  renderList(dialog.querySelector("[data-guide-body]"));
  syncChrome();

  /*
   * ONE DELEGATED HANDLER FOR EVERY BUTTON IN THE GUIDE.
   *
   * The body is re-rendered per screen, so per-button listeners would have to
   * be re-attached each time - and one forgotten re-attachment is a button
   * that silently stops working on the second visit. A delegated handler
   * cannot miss a screen.
   */
  dialog.addEventListener("click", (event) => {
    /*
     * WHILE A TUTORIAL RUNS, THE GUIDE IGNORES ITS OWN BACKDROP.
     *
     * The guide is held behind the tutorial and cannot be seen or reached, but
     * a click near the edge of the window can still land on its backdrop - and
     * closing the whole guide because a student pressed slightly off a control
     * would end the tutorial and restore the drawing with no word. So the
     * backdrop is inert for the duration, and leaving is the tutorial's own
     * Cancel.
     */
    if (openTutorial) {
      return;
    }

    if (event.target === dialog) {
      /* The backdrop closes, exactly as the other dialogs do. */
      close();
      return;
    }

    const card = event.target.closest("[data-guide-section]");

    if (card) {
      openSection(card.dataset.guideSection);
      return;
    }

    const tutorialButton = event.target.closest("[data-guide-tutorial]");

    if (tutorialButton) {
      startTutorial(tutorialButton.dataset.guideTutorial);
      return;
    }

    if (event.target.closest("[data-guide-show-tab]")) {
      const tab = event.target.closest("[data-guide-show-tab]").dataset
        .guideShowTab;

      dialog.querySelector(`[data-guide-tab="${tab}"]`)?.click();
      return;
    }

    if (event.target.closest("[data-guide-back]")) {
      goBack();
      return;
    }

    if (event.target.closest("[data-guide-cancel]")) {
      close();
    }
  });

  document.addEventListener("keydown", handleKeydown, true);

  /*
   * The search field is the first thing worth focusing: it is how a student
   * who knows what they want gets there fastest.
   */
  dialog.querySelector("[data-guide-search]")?.focus();

  return dialog;
}

const enggUserGuide = {
  open,
  close,
  isOpen,
  /*
   * A CLOSE THAT WAITS. The plain `close()` restores the workspace in the
   * background, which is right for the interface; a caller that is about to
   * read the document - a test, a save - needs the restore to have finished.
   */
  closeAndWait() {
    close();

    return leaving || Promise.resolve(true);
  },
  /* Exposed for tests, so the flow can be driven without poking at the DOM. */
  screens: () => ({ currentScreen, currentSectionId, currentTab }),
  startTutorialById: (tutorialId) => startTutorial(tutorialId),
};

export default enggUserGuide;
