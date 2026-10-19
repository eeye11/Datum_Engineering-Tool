/*
 * ============================================================
 * THE HELP DIALOGS
 * ============================================================
 *
 * Four short panels: the user guide, the drawing help, the feedback route, and
 * About. One dialog and one set of content, because they are the same kind of
 * thing - a block of text the student reads and closes.
 *
 * TWO HONESTY RULES, WHICH ARE THE REASON THIS IS WRITTEN OUT
 * ----------------------------------------------------------
 *
 * 1. THE CONTENT DESCRIBES WHAT THE APPLICATION DOES. Not what it ought to do,
 *    and not what a similar program does. Every statement here is checkable
 *    against the running application, because help that describes an imagined
 *    version of the software is worse than no help at all - it sends the
 *    student looking for a control that is not there.
 *
 * 2. THE FEEDBACK ROUTE DOES NOT PRETEND. There is no server behind this
 *    application to receive a report, so offering a form that appeared to submit
 *    would be a lie the student only discovers after typing into it. The panel
 *    says what it can actually do instead - copy a diagnostic summary they can
 *    paste into wherever they are reporting the problem.
 *
 * The version comes from the DOCUMENT, so it is whatever was built. A version
 * number is the first thing anybody quotes when reporting a problem, and an
 * invented one is actively harmful.
 */

let openDialog = null;

/*
 * The content of each panel.
 *
 * Kept as data rather than four functions, so the dialog's behaviour - open,
 * close, Escape, focus - is written once and the panels are just words.
 */
const PAGES = {
  guide: {
    title: "User Guide",
    body: `
            <h4>What DAETUM is</h4>
            <p>
                An engineering drawing and statics workspace for written
                solutions. There are two pages, chosen by the tabs at the top:
                <strong>Written Solution</strong> and
                <strong>Engineering Drawing</strong>.
            </p>

            <h4>The drawing workspace</h4>
            <p>
                The window is arranged in rows. The
                <strong>menu bar</strong> (File, Edit, Insert, View, Tools, Help)
                holds commands grouped by what they do. The
                <strong>tool bar</strong> below it holds the controls used most
                often, so they are one click away rather than two.
            </p>
            <p>
                On the left are the <strong>tools</strong> for the chosen
                category - Geometry, Annotate, Statics and others. On the right
                are the <strong>Features</strong> of whatever is selected.
            </p>

            <h4>Drawing</h4>
            <p>
                Choose a category, choose a tool, and work on the canvas. A tool
                that makes a line or a shape can be used either by
                <strong>pressing and dragging</strong> or by
                <strong>clicking twice</strong> - once for each end.
            </p>
            <p>
                Only the <strong>Select</strong> tool moves or edits work that is
                already drawn. While any other tool is active, clicking existing
                geometry does not disturb it.
            </p>

            <h4>Documents</h4>
            <p>
                <strong>File &rarr; Save</strong> writes the drawing as an
                <code>.enggdraw</code> file. A new document asks for a name the
                first time it is saved rather than overwriting anything.
            </p>
        `,
  },

  drawing: {
    title: "Drawing Help",
    body: `
            <h4>Snapping</h4>
            <p>
                While a tool is active the cursor snaps to useful points -
                endpoints, midpoints, centres and so on - and the bottom bar names
                what it has found. Snapping is controlled by the
                <strong>Snap</strong> control on the style strip, and detailed
                settings live under <strong>Tools &rarr; Precision &amp;
                Snapping</strong>.
            </p>

            <h4>Dimensions</h4>
            <p>
                A dimension measures the geometry it points at and keeps up with
                it: move the geometry and the number follows. Double-clicking a
                dimension opens the standard value box, never a scale question.
            </p>
            <p>
                The first physical length on a sheet establishes that sheet's
                <strong>scale</strong> - what a drawing unit is worth in real
                units. It is not changed by anything else.
            </p>

            <h4>Magnitudes and vector scale</h4>
            <p>
                Force and load arrows carry their values as
                <strong>magnitudes</strong>, shown or hidden by the
                <strong>Magnitudes</strong> control. <strong>Vector Scale</strong>
                changes only how large those arrows are <em>drawn</em>; it never
                changes a magnitude, a direction or any stored value.
            </p>

            <h4>Selection</h4>
            <p>
                The <strong>Select</strong> tool picks one feature; dragging on
                empty canvas draws a rectangle that picks everything it crosses.
                The selected feature's own properties appear on the right.
            </p>

            <h4>Grid</h4>
            <p>
                The grid is drawn on the canvas and toggled from
                <strong>View</strong> or the style strip. Showing the grid and
                snapping to it are separate settings - one does not turn the other
                on.
            </p>
        `,
  },

  feedback: {
    title: "Report a Problem / Feedback",
    body: `
            <h4>There is no reporting server behind this application</h4>
            <p>
                DAETUM runs entirely in this page. Nothing here sends data
                anywhere, so there is no form that could deliver a report - and a
                form that looked like it worked would be worse than none.
            </p>

            <h4>What you can do instead</h4>
            <p>
                Copy the summary below and paste it wherever you report the
                problem. It contains the version and the current document state,
                which is what somebody will ask for first.
            </p>

            <pre class="datum-help-summary" id="datumHelpSummary"></pre>

            <p>
                <button type="button" class="datum-help-copy" data-help-copy>
                    Copy summary
                </button>
            </p>
        `,
  },

  about: {
    title: "About DAETUM",
    body: `
            <h4>DAETUM</h4>
            <p>
                An engineering drawing and statics workspace: geometry, statics
                bodies, loads and supports, associative dimensions and analysis
                diagrams, for working through written engineering problems.
            </p>

            <h4>Version</h4>
            <p>
                <strong id="datumAboutVersion">&mdash;</strong>
            </p>

            <p class="datum-help-note">
                Version information is read from the application itself.
            </p>
        `,
  },
};

/*
 * The version string, read from the document rather than invented.
 *
 * `meta[name="version"]` is what the build writes; if it is absent the panel
 * says so instead of showing a number nobody can trace.
 */
function readVersion() {
  const meta = document.querySelector('meta[name="version"]');

  const fromMeta = meta?.getAttribute("content");

  if (fromMeta) {
    return fromMeta;
  }

  return "not recorded in this build";
}

/*
 * The diagnostic summary the feedback panel offers to copy.
 *
 * Only facts that exist and are cheap to read. Nothing here is guessed, and
 * nothing is a user's own drawing content - a drawing is theirs, not something
 * a bug report should carry by default.
 */
function buildSummary() {
  const lines = [
    `DAETUM ${readVersion()}`,
    `Page: ${location.pathname}`,
    `User agent: ${navigator.userAgent}`,
    `Screen: ${window.screen?.width ?? "?"}x${window.screen?.height ?? "?"}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
  ];

  /*
   * The document, if the editor has published one. Read defensively: this
   * dialog must open even when the workspace has not been started.
   */
  try {
    const state = window.enggDrawingState?.state;

    if (state) {
      lines.push(`Features on the active sheet: ${state.objects?.length ?? 0}`);
    }
  } catch (error) {
    /* Not available; the summary is still useful without it. */
  }

  return lines.join("\n");
}

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }
}

function isOpen() {
  return openDialog !== null;
}

function open(pageId) {
  const page = PAGES[pageId];

  if (!page) {
    return null;
  }

  close();

  const dialog = document.createElement("div");

  dialog.className = "datum-help-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", page.title);

  dialog.innerHTML = `
        <div class="datum-help-dialog-title">
            <span>${page.title}</span>
            <button type="button" class="datum-help-close" data-help-close aria-label="Close">&times;</button>
        </div>
        <div class="datum-help-dialog-body">${page.body}</div>
    `;

  document.body.appendChild(dialog);

  openDialog = dialog;

  /* The version and the summary are filled from the live application. */
  const versionSlot = dialog.querySelector("#datumAboutVersion");

  if (versionSlot) {
    versionSlot.textContent = readVersion();
  }

  const summarySlot = dialog.querySelector("#datumHelpSummary");

  if (summarySlot) {
    summarySlot.textContent = buildSummary();
  }

  const copyButton = dialog.querySelector("[data-help-copy]");

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const text = summarySlot?.textContent ?? "";

      try {
        await navigator.clipboard.writeText(text);

        copyButton.textContent = "Copied";
      } catch (error) {
        /*
         * A clipboard can be refused - an insecure origin, a denied
         * permission. The text is on screen and selectable, so the
         * student can still take it; saying so is better than a button
         * that appeared to work.
         */
        copyButton.textContent = "Select the text above and copy";
      }
    });
  }

  dialog.querySelector("[data-help-close]").addEventListener("click", close);

  /* Clicking the backdrop closes, like every other dialog here. */
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
    }
  });

  document.addEventListener("keydown", handleKeydown, true);

  dialog.querySelector("[data-help-close]")?.focus();

  return dialog;
}

function handleKeydown(event) {
  if (event.key === "Escape" && isOpen()) {
    event.preventDefault();
    event.stopPropagation();

    close();
  }
}

const enggHelpDialog = {
  close,
  isOpen,
  open,
};

export default enggHelpDialog;
