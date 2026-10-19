/*
 * ========================================================
 * THE PLOT EDITOR
 * ========================================================
 *
 * A Plot is a LIST OF EXPRESSIONS, and this is the one place they are
 * created, edited and deleted. The Features panel says what the diagram
 * IS - which body it belongs to, how many expressions it holds, where it
 * sits and how it looks - and this answers what it DRAWS.
 *
 * WHY THE MATHEMATICS IS NOT IN THE PROPERTIES PANEL
 * ---------------------------------------------------
 * An SFD for a three-load beam has four or five expressions. Showing them
 * all as From/To/equation rows in the same narrow panel that also carries
 * colour, line width and position turns a property panel into a data
 * inspector: the student has to read a wall of controls to answer the one
 * question they have - "is my diagram right?" - and every keystroke in
 * that list competes with the controls around it for attention.
 *
 * So the two are separate surfaces with separate jobs. The panel is for
 * the feature's identity and appearance; this is for the mathematics, and
 * it has room for the two things that actually make it usable:
 *
 *   - the EXPRESSION CARDS, one per relation, each with only the fields
 *     that relation has - so a vertical line is never asked for an "x
 *     range" it cannot have;
 *   - the LIVE GRAPH beside them, redrawn on every keystroke, so the
 *     curve is the feedback and the text is only the input.
 *
 * THE STUDENT IS ADDING EXPRESSIONS.
 * ------------------------------------
 * That is the whole idea in one sentence, and it is why nothing here is
 * called a segment. A piecewise function is one possible arrangement of
 * several expressions; "x = 5" is an expression and is not a function of
 * x at all. Calling both a segment invites the student to look for the
 * hidden rule about which segments are joined, and there is no such rule.
 *
 * The quantity symbol is GENERATED from the diagram type - V(x), M(x) or
 * N(x) - and prepended to the field as a label. The student types
 * "10 - 5x" into a box labelled `V(x) =`; they are never asked to choose
 * a letter and never have to type the symbol themselves.
 *
 * NOTHING IS VALIDATED GLOBALLY. Each expression's problem appears on its
 * own card, because "Segment 1 needs an equation" in a separate CHECKS
 * block is a list the student has to match up by hand against the thing
 * they are editing.
 */
import enggDiagramEquations from "../../../features/workspace/model/analysis/diagram-equations.js";
import enggDrawingRenderer from "../../rendering/renderer.js";

let openDialog = null;
let closeCurrent = null;

/*
 * ========================================================
 * READING THE STORED LIST AS SOMETHING TO EDIT
 * ========================================================
 *
 * An editor needs FLAT fields. The store nests a range as
 * `{xRange: {start, end}}`, which is right for the renderer and
 * awkward for a text input, and a vertical line uses a different field
 * name again. Converting between the two here means every control below
 * is a plain value and every relation's shape stays in one place.
 *
 * The id is carried through untouched. It is what a card, a delete
 * button and a saved file all use to mean the SAME expression, so the
 * visible "1" can be regenerated from the current ordering at any time
 * without anything having to be renamed.
 */
function toCard(expression) {
  if (expression.relationType === "verticalLine") {
    return {
      id: expression.id,
      relationType: "verticalLine",

      /* The words, not the enum value. */
      typeLabel: "Vertical Line",

      x: expression.x,
      yStart: expression.yRange.start,
      yEnd: expression.yRange.end,
    };
  }

  return {
    id: expression.id,
    relationType: "functionX",
    typeLabel: "Function",

    expression: expression.expression,
    xStart: expression.xRange.start,
    xEnd: expression.xRange.end,
  };
}

function fromCard(card) {
  if (card.relationType === "verticalLine") {
    return {
      id: card.id,
      relationType: "verticalLine",
      visible: true,
      x: Number(card.x),
      yRange: {
        start: Number(card.yStart),
        end: Number(card.yEnd),
      },
    };
  }

  return {
    id: card.id,
    relationType: "functionX",
    visible: true,
    expression: String(card.expression ?? "").trim(),
    xRange: {
      start: Number(card.xStart),
      end: Number(card.xEnd),
    },
  };
}

/*
 * A field that is not a number is a field the student is still typing
 * in, and it is stored as NaN rather than guessed at. A curve drawn
 * from a guessed 0 is a curve the student did not ask for.
 */
function numberField(text) {
  const value = Number(text);

  return Number.isFinite(value) ? value : NaN;
}

function numberText(value) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

/*
 * ========================================================
 * ONE EXPRESSION CARD
 * ========================================================
 *
 * The type is shown as a WORD and the fields follow from it, so a
 * vertical line asks for `x` and a `y` range and a function asks for an
 * equation and an `x` range. Showing a From/To pair to both would mean
 * two of the four fields are always irrelevant - and an irrelevant field
 * with a blank value reads as something the student forgot.
 *
 * The number is the card's POSITION, printed at render time. It is not
 * an identity and nothing refers to it.
 */
function cardHtml(card, index, quantity, problems) {
  const heading = `<div class="plot-editor-card-number">${index + 1}</div>`;

  const body =
    card.relationType === "verticalLine"
      ? `
            <div class="plot-editor-card-type">Vertical Line</div>

            <div class="plot-editor-row">
                <span class="plot-editor-label">x =</span>
                <input type="number" step="any" inputmode="decimal"
                    class="plot-editor-input plot-editor-input-short"
                    data-plot-field="x" data-plot-id="${escapeHtml(card.id)}"
                    value="${numberText(card.x)}">
            </div>

            <div class="plot-editor-row">
                <span class="plot-editor-label">y:</span>
                <input type="number" step="any" inputmode="decimal"
                    class="plot-editor-input"
                    data-plot-field="yStart" data-plot-id="${escapeHtml(card.id)}"
                    value="${numberText(card.yStart)}">
                <span class="plot-editor-arrow">&rarr;</span>
                <input type="number" step="any" inputmode="decimal"
                    class="plot-editor-input"
                    data-plot-field="yEnd" data-plot-id="${escapeHtml(card.id)}"
                    value="${numberText(card.yEnd)}">
            </div>
        `
      : `
            <div class="plot-editor-card-type">Function</div>

            <div class="plot-editor-row">
                <span class="plot-editor-label">${escapeHtml(quantity)} =</span>
                <input type="text"
                    class="plot-editor-input"
                    data-plot-field="expression" data-plot-id="${escapeHtml(card.id)}"
                    placeholder="10 - 5x"
                    value="${escapeHtml(card.expression)}">
            </div>

            <div class="plot-editor-row">
                <span class="plot-editor-label">x:</span>
                <input type="number" step="any" inputmode="decimal"
                    class="plot-editor-input"
                    data-plot-field="xStart" data-plot-id="${escapeHtml(card.id)}"
                    value="${numberText(card.xStart)}">
                <span class="plot-editor-arrow">&rarr;</span>
                <input type="number" step="any" inputmode="decimal"
                    class="plot-editor-input"
                    data-plot-field="xEnd" data-plot-id="${escapeHtml(card.id)}"
                    value="${numberText(card.xEnd)}">
            </div>
        `;

  /*
   * CONTEXTUAL, AND ONLY WHEN THERE IS ONE. An empty message leaves the
   * card exactly the size it should be; nothing is pre-announced.
   */
  const message =
    problems && problems.length
      ? `<div class="plot-editor-card-problem">${escapeHtml(problems[0])}</div>`
      : "";

  return `
        <div class="plot-editor-card" data-plot-card="${escapeHtml(card.id)}">
            ${heading}

            <div class="plot-editor-card-main">
                ${body}
                ${message}
            </div>

            <button type="button"
                class="plot-editor-delete"
                data-plot-delete="${escapeHtml(card.id)}"
                title="Delete this expression"
                aria-label="Delete expression ${index + 1}">
                &times;
            </button>
        </div>
    `;
}

/*
 * ========================================================
 * THE LIVE GRAPH
 * ========================================================
 *
 * Drawn THROUGH THE RENDERER'S OWN MAPPING, from a stand-in geometry
 * whose axis runs 0 to the body's length along x and whose zero line is
 * the middle of the box. That is what makes the graph in this dialog a
 * view of the diagram rather than a picture of one: the same constants,
 * the same samples, the same one-stroke-per-expression rule, so what the
 * student shapes here is what lands on the sheet.
 *
 * EVERY EDIT REDRAWS IT. There is no Refresh and no Plot button, because
 * a control that has to be pressed after every edit is a step the
 * student can forget - and the result of forgetting is a graph that
 * disagrees with the equation on the card beside it.
 */
function drawGraph(svg, cards, range) {
  const equations = enggDiagramEquations;
  const renderer = enggDrawingRenderer;

  const width = 560;
  const height = 260;

  if (!svg) {
    return;
  }

  if (!equations || !renderer || !range) {
    svg.innerHTML = "";

    return;
  }

  const entries = cards
    .map(fromCard)
    .filter(entry => {
      /* A half-typed range has no meaning yet, so it is not drawn. */
      if (entry.relationType === "verticalLine") {
        return (
          Number.isFinite(entry.x) &&
          Number.isFinite(entry.yRange.start) &&
          Number.isFinite(entry.yRange.end)
        );
      }

      return (
        Number.isFinite(entry.xRange.start) &&
        Number.isFinite(entry.xRange.end)
      );
    });

  const span = Number(range.to) - Number(range.from);

  if (!(span > 0) || !entries.length) {
    svg.innerHTML = `
            <text x="${width / 2}" y="${height / 2}"
                class="plot-editor-graph-empty"
                text-anchor="middle">Nothing plotted yet</text>
        `;

    return;
  }

  /*
   * The stand-in axis. A horizontal run from 0 to the span with the
   * zero line at y = 0 is exactly the shape the renderer works in, so
   * the marks it returns are already in the frame this dialog draws.
   */
  const frame = {
    start: { x: 0, y: 0 },
    end: { x: span, y: 0 },
    localRange: { from: Number(range.from), to: Number(range.to) },
  };

  const marks = renderer.analysisPlotMarks(frame, entries);

  /*
   * THE SCALE IS FIXED BY THE PEAK, AND DOES NOT MOVE AS THE STUDENT
   * TYPES.
   *
   * The largest value anywhere in the diagram always sits at the same
   * height on this graph, and the marker's own unit height is the one the
   * sheet uses, so the shape here is the shape drawn on the drawing. The
   * alternative - rescaling so the current peak always fills the box -
   * looks tidier and is worse than useless: the whole point of the graph
   * beside the cards is to let a student see whether the jump is as big
   * as they think it is, and a scale that follows the curve hides exactly
   * that.
   */
  const unitHeight = span * 0.16;

  const pad = 18;

  const plotWidth = width - pad * 2;
  const plotHeight = height - pad * 2 - 14;

  /*
   * A LITTLE HEADROOM ABOVE AND BELOW the peak, so the tallest stroke's
   * own width and its round cap are inside the box rather than clipped by
   * its edge - a diagram whose highest value touches the frame reads as a
   * value that has run off the page.
   */
  const halfHeight = (plotHeight / 2) * 0.92;

  const centre = pad + plotHeight / 2;

  const toScreen = (x, y) => ({
    x: pad + ((x - Number(range.from)) / span) * plotWidth,
    y: centre - (y / (unitHeight || 1)) * halfHeight,
  });

  const zeroY = toScreen(0, 0).y;

  const parts = [`
        <line class="plot-editor-graph-axis"
            x1="${pad}" y1="${zeroY}" x2="${width - pad}" y2="${zeroY}"/>
    `];

  marks.forEach(mark => {
    if (mark.kind === "verticalLine") {
      const top = toScreen(mark.from.x, mark.from.y);
      const bottom = toScreen(mark.to.x, mark.to.y);

      parts.push(`
            <line class="plot-editor-graph-curve"
                x1="${top.x}" y1="${top.y}"
                x2="${bottom.x}" y2="${bottom.y}"/>
        `);

      return;
    }

    const path = mark.points
      .map((point, index) => {
        const screen = toScreen(point.x, point.y);

        return `${index === 0 ? "M" : "L"}${screen.x.toFixed(2)},${screen.y.toFixed(2)}`;
      })
      .join(" ");

    parts.push(`
            <path class="plot-editor-graph-curve" d="${path}"/>
        `);
  });

  parts.push(`
        <text x="${pad}" y="${height - 5}" class="plot-editor-graph-label">
            ${escapeHtml(numberText(Number(range.from)))}
        </text>
        <text x="${width - pad}" y="${height - 5}"
            class="plot-editor-graph-label" text-anchor="end">
            ${escapeHtml(numberText(Number(range.to)))}
        </text>
    `);

  svg.innerHTML = parts.join("");
}

/*
 * ========================================================
 * OPENING
 * ========================================================
 *
 * The caller supplies the expressions and the body's range; the editor
 * holds a COPY of the list and edits that. Nothing on the feature
 * changes until Apply, so Cancel is genuinely Cancel, and the preview
 * callback lets the sheet show the work in progress without committing
 * it to the document or to the undo history.
 */
function open(options = {}) {
  close();

  const equations = enggDiagramEquations;

  const quantity = options.quantity || "f(x)";
  const range = options.range || null;

  const cards = equations
    ? equations.toExpressions(options.expressions || [], {
        xRange: range
          ? { start: Number(range.from), end: Number(range.to) }
          : null,
        verticalRange: { start: -10, end: 10 },
      }).map(toCard)
    : [];

  const dialog = document.createElement("div");

  dialog.className = "drawing-plot-editor";

  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute(
    "aria-label",
    options.title || "Plot Editor",
  );

  dialog.innerHTML = `
        <div class="plot-editor">
            <div class="plot-editor-header">
                <div class="plot-editor-title">
                    ${escapeHtml(options.title || "Plot")}
                </div>

                <button type="button" class="plot-editor-close"
                    data-plot-cancel aria-label="Close the plot editor">
                    &times;
                </button>
            </div>

            <div class="plot-editor-body">
                <div class="plot-editor-left">
                    <div class="plot-editor-section">EXPRESSIONS</div>

                    <div class="plot-editor-list" data-plot-list></div>

                    <button type="button" class="plot-editor-add"
                        data-plot-add>
                        + Add Expression
                    </button>

                    <div class="plot-editor-choose" data-plot-choose hidden>
                        <div class="plot-editor-choose-title">
                            Add Expression
                        </div>

                        <button type="button"
                            class="plot-editor-choose-option"
                            data-plot-kind="functionX">
                            Function of x
                        </button>

                        <button type="button"
                            class="plot-editor-choose-option"
                            data-plot-kind="verticalLine">
                            Vertical Line
                        </button>
                    </div>
                </div>

                <div class="plot-editor-right">
                    <div class="plot-editor-section">GRAPH</div>

                    <svg class="plot-editor-graph"
                        data-plot-graph
                        viewBox="0 0 560 260"
                        preserveAspectRatio="xMidYMid meet"></svg>
                </div>
            </div>

            <div class="plot-editor-actions">
                <button type="button" data-plot-cancel>Cancel</button>

                <button type="button" class="primary"
                    data-plot-apply>Apply</button>
            </div>
        </div>
    `;

  document.body.appendChild(dialog);

  const list = dialog.querySelector("[data-plot-list]");
  const svg = dialog.querySelector("[data-plot-graph]");
  const chooser = dialog.querySelector("[data-plot-choose]");

  /*
   * The problems are recomputed on every render, from the equations
   * module, and attached to the card that owns them. Nothing is
   * remembered between keystrokes, so a message can never outlive the
   * mistake it describes.
   */
  let problemsById = {};

  function render() {
    const check = equations
      ? equations.validateExpressions(
          cards.map(fromCard),
          range,
        )
      : { valid: true, problems: [] };

    problemsById = {};

    check.problems.forEach(problem => {
      if (!problem.id) {
        return;
      }

      problemsById[problem.id] =
        problemsById[problem.id] || [];

      problemsById[problem.id].push(problem.message);
    });

    list.innerHTML = cards
      .map((card, index) =>
        cardHtml(card, index, quantity, problemsById[card.id]),
      )
      .join("");

    drawGraph(svg, cards, range);

    options.onPreview?.(cards.map(fromCard));
  }

  /*
   * A FIELD IN, THE WHOLE LIST OUT. One handler for every input, so
   * there is no way for one field to be applied and another silently
   * not - which is the failure mode of a list of near-identical
   * per-control listeners.
   */
  list.addEventListener("input", event => {
    const input = event.target.closest("[data-plot-field]");

    if (!input) {
      return;
    }

    const card = cards.find(
      entry => entry.id === input.dataset.plotId,
    );

    if (!card) {
      return;
    }

    const field = input.dataset.plotField;

    card[field] =
      field === "expression" ? input.value : numberField(input.value);

    /*
     * The graph and the messages, and nothing else. The card's inputs
     * are NOT rebuilt here: that would put a fresh, empty input under
     * the student's cursor on every keystroke and make a long equation
     * untypeable.
     */
    drawGraph(svg, cards, range);

    const check = equations
      ? equations.validateExpressions(
          cards.map(fromCard),
          range,
        )
      : { valid: true, problems: [] };

    const entry = check.problems.find(
      problem => problem.id === card.id,
    );

    const holder = list.querySelector(
      `[data-plot-card="${card.id}"]`,
    );

    if (holder) {
      let problem = holder.querySelector(
        ".plot-editor-card-problem",
      );

      if (entry) {
        if (!problem) {
          problem = document.createElement("div");
          problem.className = "plot-editor-card-problem";
          holder
            .querySelector(".plot-editor-card-main")
            .appendChild(problem);
        }

        problem.textContent = entry.message;
      } else if (problem) {
        problem.remove();
      }
    }

    options.onPreview?.(cards.map(fromCard));
  });

  /*
   * A DELETE REMOVES ONE EXPRESSION.
   *
   * Not the diagram - the feature the student spent time placing stays
   * exactly where it is, because removing one equation from a diagram
   * is not the same act as removing the diagram.
   */
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-plot-delete]");

    if (!button) {
      return;
    }

    const index = cards.findIndex(
      entry => entry.id === button.dataset.plotDelete,
    );

    if (index >= 0) {
      cards.splice(index, 1);
    }

    render();
  });

  dialog.querySelector("[data-plot-add]").addEventListener("click", () => {
    chooser.hidden = false;
  });

  chooser.addEventListener("click", event => {
    const option = event.target.closest("[data-plot-kind]");

    if (!option) {
      return;
    }

    chooser.hidden = true;

    cards.push(
      toCard(
        equations.createExpression(option.dataset.plotKind, {
          defaultRange: range
            ? { start: Number(range.from), end: Number(range.to) }
            : undefined,
        }),
      ),
    );

    render();
  });

  const cancel = () => {
    close();

    options.onCancel?.();
  };

  dialog.querySelector("[data-plot-apply]").addEventListener(
    "click",
    () => {
      const expressions = cards.map(fromCard);

      close();

      options.onApply?.(expressions);
    },
  );

  dialog
    .querySelectorAll("[data-plot-cancel]")
    .forEach(button => button.addEventListener("click", cancel));

  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });

  openDialog = dialog;
  closeCurrent = cancel;

  render();

  dialog.querySelector(".plot-editor-close")?.focus();

  return dialog;
}

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  closeCurrent = null;
}

function isOpen() {
  return openDialog !== null;
}

function handleEscape() {
  if (!openDialog) {
    return false;
  }

  closeCurrent?.();

  return true;
}

const enggPlotEditor = {
  open,
  close,
  isOpen,
  handleEscape,
  toCard,
  fromCard,
};

export default enggPlotEditor;
