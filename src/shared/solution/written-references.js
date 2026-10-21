/*
 * Drawing References in the written solution.
 *
 * This exists to PROVE THE CHAIN, not to be a written-solution editor:
 *
 *     written text  ->  drawing reference  ->  sheet  ->  render
 *
 * The written solution is a placeholder today, so this is a minimal
 * version of the same idea it will eventually need: a figure can be
 * inserted into text by naming a sheet, and the figure is rendered
 * from that sheet's CURRENT contents every time the solution is
 * rendered.
 *
 * A reference is a FIGURE IN THE SOLUTION, not a link to one. The
 * source carries a command naming the sheet, and the rendered solution
 * carries the drawing itself, in the place that command appears. There
 * is nothing to click and nothing to open: the diagram is part of the
 * written solution, at the position the author put it, the same as a
 * figure in any technical write-up.
 *
 * Two things are deliberately NOT coupled to the reference system:
 *
 *   - The SOURCE OF THE SHEET ID. Here it comes from a dropdown,
 *     because there is no document model on this side yet. The stored
 *     token is the same either way, so when the real editor can
 *     INSERT a figure in the course of a sentence, or name one with
 *     LaTeX, nothing about how a reference works has to change - only
 *     where the sheetId is read from.
 *
 *   - THE RENDERING. Nothing here draws anything. It asks the drawing
 *     side for a rendered sheet by ID, exactly as the written editor
 *     will. That is why the figure updates when the drawing changes
 *     without anything being re-inserted: there is no image here to
 *     go stale.
 */
/*
 * ============================================================
 * IMPORTED FROM ITS OWN MODULE, NOT THROUGH THE BARREL
 * ============================================================
 *
 * This used to read `from "../../features/workspace/index.js"`, and that one
 * line closed a cycle: the barrel imports the automation hooks, which import
 * this file, which imported the barrel back. The cycle threw a
 * temporal-dead-zone `ReferenceError` - "Cannot access 'enggWrittenReferences'
 * before initialization" - while the graph was still linking, and a throw at
 * that point silently aborts the tail of the entry module. Every `window.enggX`
 * handle and `window.datum` went missing on a normal page load, and because the
 * throw happened before the global error handlers were installed, nothing was
 * reported anywhere.
 *
 * `enggDrawingSheets` is defined in `sheet-controller.js`, which is what the
 * barrel re-exports it from, so importing it directly is the same object with
 * the same behaviour and one fewer edge in the graph. The barrel keeps its
 * re-export for every other caller.
 */
import { enggDrawingSheets } from "../../components/layout/workspace/sheet-controller.js";
import enggDrawingReference from "../references/drawing-reference.js";
import { parseDrawingBlocks } from "./drawing-blocks.js";
import { selectedDrawingBlock } from "./drawing-blocks-editor.js";
import { readSheetLatex } from "../file/latex/latex-document.js";
import enggErrorLog from "../../app/error-log.js";

const document = globalThis.document;

/*
 * Embedded drawing blocks in the written solution.
 *
 * A drawing inserted into the solution is its COMPLETE TikZ source, written
 * into the document between comment markers. The renderer sends each
 * embedded drawing to the application's own TikZ service (POST
 * /api/render-tikz, the same endpoint the drawing workspace's code editor
 * uses) and places the returned SVG exactly where the block sits in the
 * text - the document itself is what is compiled, with nothing looked up,
 * substituted or fetched from elsewhere.
 *
 * The markers are comments, so the code the service receives is exactly the
 * code the document holds: what compiles is what was inserted.
 *
 * A SERVICE THAT IS NOT THERE does not take the solution down: the figure
 * says so in place - with the code still in the document - and the prose
 * either side still typesets. MathJax cannot draw TikZ, so the service is
 * how the picture appears; there is no second renderer and no fallback
 * that would pretend the drawing was shown.
 */

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 460;

/*
 * THE LATEST RENDER WINS.
 *
 * A preview goes stale on every pause in typing, and a drawing can be edited
 * while a render of it is still in flight. When two renders overlap, the older
 * one's result must not be written over the newer one's - so each render takes a
 * sequence number, and nothing is placed unless its number is still the newest
 * when its work finishes.
 */
let renderSequence = 0;

/*
 * A CLICK ON A RENDERED DRAWING SELECTS ITS REFERENCE, which is the same act as
 * clicking the reference in the source. The workspace owns the selection; this
 * module only reports the request. Registered rather than imported, so the
 * renderer stays usable on a page that has no written-solution workspace.
 */
let selectionHandler = null;

export function setDrawingSelectionHandler(handler) {
    selectionHandler = typeof handler === "function" ? handler : null;
}

async function renderTikzSvg(tikz) {
    const response = await fetch("/api/render-tikz", {
        body: JSON.stringify({ tikz }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
    });

    const payload = await response.json();

    if (!response.ok || !payload.success) {
        throw new Error(payload.error || `TikZ rendering failed (${response.status})`);
    }

    const holder = document.createElement("div");

    holder.innerHTML = payload.svg;

    const svg = holder.firstElementChild;

    return svg ? fitSvgToItsDrawing(svg) : null;
}

/*
 * ============================================================
 * A PICTURE IS PLACED BY ITS DRAWING, NOT BY ITS TELLING
 * ============================================================
 *
 * The service returns an SVG sized from the picture's declared box. That box can
 * be ZERO - a `tikzpicture` whose bounding box was reset to a single point, a
 * document compiled with `\pgfresetboundingbox`, a figure the compiler measured
 * as empty even though it contains strokes. The paths are all there; the
 * container is 0 x 0, so the page shows nothing at all.
 *
 * The student then sees a figure that is not there, next to a reference that
 * plainly is - which reads as "this drawing failed to render".
 *
 * So the element's own contents decide its box: `getBBox()` is the union of
 * everything actually drawn. Its numbers become the viewBox, a small margin is
 * added for stroke width and arrow heads, and a width is chosen so the figure
 * fits the written page.
 *
 * THIS ONLY EVER REPLACES A BOX THAT CANNOT SHOW ANYTHING. A picture that
 * already declares a real size is returned untouched, so the ordinary case
 * renders exactly as the service measured it.
 */
function fitSvgToItsDrawing(svg) {
    const box = svg.viewBox?.baseVal;
    const declared = {
        width: parseFloat(svg.getAttribute("width")) || 0,
        height: parseFloat(svg.getAttribute("height")) || 0,
        box: box && Number.isFinite(box.width) && Number.isFinite(box.height)
            ? { x: box.x, y: box.y, width: box.width, height: box.height }
            : null
    };

    const usable = (boxValue) => boxValue && boxValue.width > 0.5 && boxValue.height > 0.5;

    if ((declared.width > 0.5 && declared.height > 0.5) || usable(declared.box)) {
        return svg;
    }

    let bounds;

    try {
        bounds = svg.getBBox();
    } catch {
        bounds = null;
    }

    if (!bounds || !usable(bounds)) {
        /* Nothing measurable either: the box is collapsible for another reason. */
        return svg;
    }

    /* A little air, so a stroke's width and an arrow head are not clipped. */
    const margin = Math.max(4, Math.min(24, Math.max(bounds.width, bounds.height) * 0.04));

    const x = bounds.x - margin;
    const y = bounds.y - margin;
    const width = bounds.width + margin * 2;
    const height = bounds.height + margin * 2;

    svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    /*
     * The figure is sized by its CSS container; `max-width` and the preserved
     * aspect ratio keep it inside the page whatever the drawing's own shape is.
     */
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    return svg;
}

/*
 * The solution renderer, available once the page is attached. Until then
 * a render request is a no-op rather than an error.
 */
let renderAttached = () => {};

/*
 * MathJax arrives separately: its script loads asynchronously so the page
 * does not wait for it. Until it is ready the solution is shown as plain
 * text, and it is rendered again as soon as MathJax has started.
 */
function mathJax() {
  return typeof window.MathJax?.typesetPromise === "function"
    ? window.MathJax
    : null;
}

/*
 * Render the written solution: the Update Output button and the live
 * updates call this same function, so clicking the button and editing the
 * drawing produce identical results.
 */
export function render() {
  return renderAttached();
}

const enggWrittenReferences = { render };

export default enggWrittenReferences;

function attach() {
  const sheetSelect =
    document.getElementById(
      "referenceSheetSelect"
    );
  const captionInput =
    document.getElementById(
      "referenceCaption"
    );
  const insertButton =
    document.getElementById(
      "referenceInsert"
    );
  /*
   * THE PREVIEW AND THE EDITOR ARE THE WORKSPACE'S OWN ELEMENTS.
   *
   * The written solution was a three-column panel with its own `writingCode`
   * textarea and `writingOutput` div. It is now the solution workspace, whose
   * editor is `solutionEditor` and whose rendered page is `solutionPreview` -
   * so this renderer draws into the workspace's preview rather than into a
   * panel that no longer exists. Everything else about it is unchanged.
   */
  const output =
    document.getElementById("solutionPreview");
  const code =
    document.getElementById("solutionEditor");

  /*
   * THE DRAWING-REFERENCE CONTROLS ARE OPTIONAL.
   *
   * The old panel carried its own sheet picker and caption field. The workspace
   * inserts a figure from its own toolbar and takes the caption from the sheet,
   * so these may legitimately be absent - and the renderer must still work, since
   * rendering the written solution is its primary job and the reference picker
   * was only ever a way to INSERT one. The picker's wiring below is skipped when
   * it is not there.
   */
  if (!output || !code) {
    return;
  }

  if (!enggDrawingSheets) {
    return;
  }

  /*
   * The list of sheets is rebuilt from the document each time it is
   * refreshed, and valued by sheet ID rather than by position. That
   * is the same discipline the reference itself follows, so the
   * dropdown cannot silently insert a reference to whichever sheet
   * happens to be second after the user reorders the tabs.
   */
  function refreshSheetList() {
    if (!sheetSelect) {
      return;
    }

    const sheets = enggDrawingSheets.all();

    const previous = sheetSelect.value;

    sheetSelect.textContent = "";

    sheets.forEach((sheet) => {
      const option =
        document.createElement("option");

      option.value = sheet.id;
      option.textContent = sheet.name;

      sheetSelect.appendChild(option);
    });

    if (
      sheets.some(
        (sheet) => sheet.id === previous
      )
    ) {
      sheetSelect.value = previous;
    }

    if (
      !captionInput.value.trim() &&
      sheets.length
    ) {
      captionInput.value =
        sheetSelect.selectedOptions[0]?.textContent ||
        "";
    }
  }

  /*
   * Render the solution.
   *
   * The source is walked in ONE pass over the things that take space in the
   * output - embedded drawing blocks (their complete TikZ, sent to the TikZ
   * service and drawn where they sit) and, for documents that still carry
   * them, the older `[DRAWING_REFERENCE:id]` tokens (rendered live from
   * their sheet, unchanged). Everything else is typeset normally.
   *
   * The text is rendered ONE SEGMENT AT A TIME rather than as a whole and
   * patched afterwards. That ordering is what makes the position correct: a
   * figure inserted into an already-typeset document would have to be
   * matched against nodes MathJax has moved, and nothing would reliably
   * stay where it was put.
   */
  async function renderSolution() {
    const source = code.value;

    /*
     * EACH RENDER OWNS A NUMBER. The page is cleared and filled asynchronously,
     * so a render that started earlier but finished later would otherwise paint
     * an older document over a newer one - or, worse, over a newer drawing.
     */
    const sequence = (renderSequence += 1);

    mathJax()?.typesetClear([output]);

    /*
     * Where every figure is, in document order. Embedded blocks and legacy
     * references are sorted together by position, so a document mixing the
     * two still reads in the order it was written.
     */
    const blocks = parseDrawingBlocks(source)
        .map((block) => ({
            ...block,
            kind: "linked"
        }));

    const references = enggDrawingReference
        .parseReferences(source)
        .map((reference) => ({ ...reference, kind: "reference" }));

    const found = [...blocks, ...references].sort(
        (a, b) => a.index - b.index
    );

    output.textContent = "";

    if (!found.length) {
      /*
       * No figures: the whole thing is ordinary text and is typeset as one
       * piece, exactly as it was before figures existed. There is no
       * empty-state message here, because the output is a solution - a
       * solution with no figures in it is a perfectly good solution, not a
       * state that needs announcing.
       */
      output.textContent = mathOrPlain(source);

      await mathJax()?.typesetPromise([output]);

      return;
    }

    let cursor = 0;

    /* The selection is read once, so every figure in the pass is judged alike. */
    const selectedId = selectedDrawingBlock();

    const blocksInOrder = found.filter((item) => item.kind === "linked");

    for (const item of found) {
      /* A newer render has taken over; this one must not paint over it. */
      if (sequence !== renderSequence) {
        return;
      }

      appendText(
        output,
        source.slice(cursor, item.index)
      );

      /*
       * ONE FIGURE THAT CANNOT BE DRAWN DOES NOT TAKE THE SOLUTION DOWN.
       *
       * A figure can fail - a sheet can be missing, TikZ code can have a
       * typo, the service can be down. The figures are independent of one
       * another and of the prose, so a failure is contained to its own
       * figure: the rest of the solution still typesets, and the one that
       * failed says so in place rather than leaving a blank page or an
       * editor that stops responding.
       */
      try {
        if (item.kind === "linked") {
          await appendLinkedFigure(output, item, {
            number: blocksInOrder.indexOf(item) + 1,
            selected: item.blockId === selectedId,
            sequence
          });
        } else {
          appendReferenceFigure(output, item);
        }
      } catch (error) {
        enggErrorLog.reportError(
          item.kind === "linked" ? "render linked drawing" : "render drawing reference",
          error,
          item.kind === "linked" ? { drawingId: item.drawingId } : { sheetId: item.sheetId }
        );

        const failed = document.createElement("div");

        failed.className = "drawing-reference-empty";
        failed.textContent =
          "This figure could not be drawn. Its source is still in the document.";

        output.appendChild(failed);
      }

      cursor = item.index + item.length;
    }

    if (sequence !== renderSequence) {
      return;
    }

    appendText(
      output,
      source.slice(cursor)
    );

    /*
     * One typeset over the finished document rather than per segment: the
     * figures are real SVG, which MathJax leaves alone, and a single pass
     * is both faster and less likely to renumber anything.
     */
    await mathJax()?.typesetPromise([output]);
  }

  /*
   * ONE LINKED DRAWING, DRAWN FROM ITS OWN DOCUMENT.
   *
   * The block names a drawing; the drawing is asked for its CURRENT picture - the
   * sheet's own canonical source, rendered by the same TikZ service the drawing
   * workspace uses. Nothing is copied into the written solution, so there is
   * nothing here that can go stale, and editing the sheet is all it takes for the
   * next render to show the change.
   */
  async function appendLinkedFigure(target, block, { number, selected, sequence }) {
    const sheet = sheetByIdSafely(block.drawingId);

    const figure = document.createElement("figure");

    figure.className = "drawing-reference-figure linked-drawing-figure";
    figure.dataset.blockId = block.blockId;
    figure.dataset.drawingId = block.drawingId;
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute(
      "aria-label",
      `Drawing ${number}${sheet?.name ? `: ${sheet.name}` : ""}. Select to show its reference in the source.`
    );

    if (selected) {
      figure.classList.add("is-selected");
      figure.setAttribute("aria-current", "true");
    }

    /* A click on the drawing selects its reference - the relationship both ways. */
    figure.addEventListener("click", (event) => {
      event.preventDefault();

      if (typeof selectionHandler === "function") {
        selectionHandler(block);
      }
    });

    figure.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        if (typeof selectionHandler === "function") {
          selectionHandler(block);
        }
      }
    });

    if (!sheet) {
      const missing = document.createElement("p");

      missing.className = "drawing-reference-missing";
      missing.textContent = "The drawing this reference names is no longer in this document.";

      figure.appendChild(missing);
      target.appendChild(figure);

      return;
    }

    const latex = readSheetLatex(sheet);

    if (!latex.trim()) {
      /*
       * AN EMPTY DRAWING IS NOT A FAILED ONE. A drawing the student has only
       * just created has nothing on it yet; the block says so in place rather
       * than disappearing or pretending to show a picture.
       */
      const blank = document.createElement("div");

      blank.className = "drawing-reference-blank";
      blank.textContent = `Drawing ${number} \u2014 empty. Choose Edit Drawing to start drawing.`;

      figure.appendChild(blank);
      target.appendChild(figure);

      return;
    }

    /*
     * A PLACEHOLDER WHILE THE RENDER RUNS, so the page has its height and the
     * student sees that a drawing belongs here. It is replaced by the picture,
     * or by the failure - never left as if it were the picture.
     */
    const state = document.createElement("div");

    state.className = "drawing-reference-loading";
    state.textContent = `Drawing ${number} is rendering\u2026`;

    figure.appendChild(state);
    target.appendChild(figure);

    try {
      const svg = await renderTikzSvg(latex);

      /* A newer render has taken over, or this figure was removed. */
      if (sequence !== renderSequence || !figure.isConnected) {
        return;
      }

      const frame = document.createElement("div");

      frame.className = "drawing-reference-frame";
      frame.appendChild(svg);

      figure.replaceChildren(frame);

      if (sheet.name) {
        const caption = document.createElement("figcaption");

        caption.textContent = sheet.name;

        figure.appendChild(caption);
      }
    } catch (error) {
      enggErrorLog.reportError("render linked drawing", error, { drawingId: block.drawingId });

      if (!figure.isConnected) {
        return;
      }

      const failed = document.createElement("div");

      failed.className = "drawing-reference-missing";
      failed.textContent =
        `Drawing ${number}${sheet.name ? ` (${sheet.name})` : ""} could not be rendered. ` +
        "Its geometry and source are unchanged; reopen it with Edit Drawing.";

      figure.replaceChildren(failed);
    }
  }

  function sheetByIdSafely(sheetId) {
    try {
      return enggDrawingSheets.sheetById(sheetId);
    } catch (error) {
      return null;
    }
  }

  /*
   * Text with the delimiters the source omits.
   *
   * The source is LaTeX, and a bare `F = ma` is not something
   * MathJax renders on its own, so text with no delimiters at all is
   * wrapped. Text that already has some is left alone - a document
   * that mixes prose and maths relies on the author having put the
   * delimiters where they meant them.
   */
  function mathOrPlain(text) {
    const trimmed = text.trim();

    if (!trimmed) {
      return text;
    }

    return /\\\[|\\\(|\$\$|\\begin\{/.test(trimmed)
      ? trimmed
      : `\\[${trimmed}\\]`;
  }

  function appendText(target, text) {
    if (!text || !text.trim()) {
      /*
       * A blank stretch - the newlines either side of a reference -
       * is skipped rather than typeset. Typesetting empty or
       * whitespace-only text adds empty maths blocks to the document
       * and, worse, MathJax numbers them, so a solution with three
       * figures would show three spurious numbered gaps between
       * them.
       */
      return;
    }

    const span =
      document.createElement("span");

    span.textContent = mathOrPlain(text);

    target.appendChild(span);
  }

  /*
   * A referenced sheet, as part of the solution.
   *
   * Rendered from the sheet's CURRENT contents at the moment the
   * solution is rendered - not from an image exported when the
   * reference was inserted, and not from anything stored. Move the
   * load, change a force, edit an annotation, and the next render
   * shows it.
   *
   * The reference in the source is the sheet ID, so renaming or
   * reordering the sheet changes nothing here: this resolves by ID
   * and there is nothing in it that knows either.
   */
  function appendReferenceFigure(target, reference) {
    const figure =
      document.createElement("figure");

    figure.className =
      "drawing-reference-figure";

    const rendered =
      enggDrawingSheets.renderReference(
        reference.sheetId,
        {
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT
        }
      );

    if (!rendered || !rendered.ok) {
      /*
       * A reference that could not be rendered is reported as a
       * fault, and the fault names ITSELF.
       *
       * It used to be reported as "The sheet this figure refers to is
       * no longer in this document", which is a confident claim about
       * why. But the same result covers a sheet that IS present and
       * whose extent could not be measured, and telling the reader
       * their sheet has vanished when it has not is worse than saying
       * nothing - it sends them looking for a deletion that never
       * happened.
       *
       * So the message is chosen from the reason. A genuinely missing
       * sheet still says so, because that is useful and true. Anything
       * else says what actually went wrong, and names the sheet it
       * happened on so the problem can be found.
       *
       * The point of this branch is that it is now reachable ONLY for
       * real faults. The reference renderer no longer reports a sheet
       * as "empty" merely because measuring it failed, so this
       * placeholder can never be shown over a sheet that has content.
       */
      const missing = document.createElement("p");

      missing.className = "drawing-reference-missing";

      missing.textContent =
        rendered?.reason === "missing-sheet"
          ? "The sheet this figure refers to is no longer in this document."
          : `This figure could not be drawn (${rendered?.reason || "render failed"})` +
            (rendered?.sheet?.name
              ? ` for "${rendered.sheet.name}".`
              : ".");

      figure.appendChild(missing);

      target.appendChild(figure);

      return;
    }

    if (rendered.empty) {
      /*
       * A sheet with genuinely nothing on it.
       *
       * The wording is deliberately plain and is now only reachable
       * when the sheet REALLY is empty: the renderer checks the sheet's
       * own feature list before saying so, so a measurement failure can
       * no longer produce a figure asserting that a full sheet is blank.
       */
      const blank = document.createElement("p");

      blank.className = "drawing-reference-empty";

      blank.textContent = rendered.caption
        ? `${rendered.caption} \u2014 this sheet is empty`
        : "This sheet is empty";

      figure.appendChild(blank);

      target.appendChild(figure);

      return;
    }

    const frame =
      document.createElement("div");

    frame.className =
      "drawing-reference-frame";

    frame.appendChild(
      rendered.svg.cloneNode(true)
    );

    figure.appendChild(frame);

    if (rendered.caption) {
      const caption =
        document.createElement(
          "figcaption"
        );

      caption.textContent =
        rendered.caption;

      figure.appendChild(caption);
    }

    target.appendChild(figure);
  }

  /*
   * Re-render the solution and the sheet list.
   *
   * Registered against the whole document, and on the page becoming
   * visible, because a reference must not be able to show a drawing
   * that has changed.
   *
   * It is not enough to refresh when the editor commits a change:
   * the drawing can also be edited from the inspector, undone, or
   * restored from a recovered document - none of which are a
   * "commit" in the drawing sense, and all of which change what the
   * figure should show. Re-rendering whenever the solution is
   * looked at is what makes the guarantee hold rather than nearly
   * hold.
   */
  function refreshAll() {
    /*
     * A REFRESH CANNOT TAKE THE WORKSPACE DOWN.
     *
     * `refreshAll` runs on a timer-like trigger - every window focus and every
     * return to the tab - so a failure inside it would repeat forever and make
     * the workspace look frozen or taken over. Each half is contained, so a
     * broken figure list cannot stop the solution from rendering, and a broken
     * render cannot stop the sheet list from updating.
     */
    try {
      refreshSheetList();
    } catch (error) {
      enggErrorLog.reportError("refresh sheet list", error, {});
    }

    try {
      /*
       * `renderSolution` is async, so its rejection is caught HERE rather than
       * by the try - an un-awaited async call throws into nowhere, which is
       * exactly the silent failure this is here to prevent.
       */
      Promise.resolve(renderSolution()).catch((error) => {
        enggErrorLog.reportError("render written solution", error, {});
      });
    } catch (error) {
      enggErrorLog.reportError("render written solution", error, {});
    }
  }

  window.addEventListener(
    "focus",
    refreshAll
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        refreshAll();
      }
    }
  );

  /*
   * Insert a reference into the text.
   *
   * The token written is the ID. Not the name, and not the tab
   * position: those are the two things the user is most likely to
   * change next, and a reference that survived neither would be a
   * reference that quietly stopped meaning anything.
   */
  function insertReference() {
    const sheetId = sheetSelect.value;

    if (!sheetId) {
      return;
    }

    const reference =
      enggDrawingReference.createReference({
        sheetId,
        displayMode: "fit",
        caption:
          captionInput.value.trim() || null
      });

    const token =
      enggDrawingReference.serializeReference(
        reference
      );

    const start =
      code.selectionStart ??
      code.value.length;
    const end =
      code.selectionEnd ?? start;

    code.value =
      code.value.slice(0, start) +
      token +
      code.value.slice(end);

    code.focus();

    refreshAll();
  }

  /* The reference picker may be absent in the workspace; see the guard above. */
  if (insertButton && sheetSelect) {
    insertButton.addEventListener("click", insertReference);

    sheetSelect.addEventListener("change", () => {
      captionInput.value =
        sheetSelect.selectedOptions[0]?.textContent || "";
    });
  }

  /*
   * THE EDITOR'S INPUT IS NOT HANDLED HERE ANY MORE.
   *
   * The line below used to re-render the whole solution on EVERY keystroke.
   * The workspace now owns that: it updates the document's source, records an
   * unsaved change and schedules a DEBOUNCED compile, calling this renderer once
   * the typing pauses. Rendering here as well would both defeat the debounce -
   * running MathJax on every character - and render from a source this module
   * read a moment earlier. The workspace is the one place a change is noticed.
   *
   * The event that told the host a solution had changed now comes from the
   * workspace too, for the same reason: one notifier, not two.
   */

  /*
   * The drawing side tells us when something changed that a figure
   * would show. This is the live-update guarantee: a reference is
   * not a picture, so a drawing change is simply a reason to look
   * again rather than a reason to re-export.
   */
  enggDrawingSheets.setReferenceChangeHandler(
      refreshAll
  );

  renderAttached = renderSolution;

  if (!mathJax()) {
    document
      .getElementById("MathJax-script")
      ?.addEventListener("load", () => {
        Promise.resolve(window.MathJax?.startup?.promise).then(refreshAll);
      });
  }

  refreshAll();
}

if (document) {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      attach
    );
  } else {
    attach();
  }
}
