/*
 * ============================================================
 * THE GRAPH PLOT EDITOR
 * ============================================================
 *
 * The dedicated working space for building a mathematical graph from
 * expressions. It is opened by Graph -> Plot, and by editing an existing
 * Plot-created Graph.
 *
 * THE LAYOUT IS THE WORKFLOW.
 *
 * A student building a graph does three things, in this order: look at the
 * coordinate system, say what is drawn on it, and adjust the axes until the
 * curves read well. So the editor is laid out that way:
 *
 *   HEADER     what this is, and how to leave it
 *   PREVIEW    the graph itself, dominant, drawn from the first moment
 *   FUNCTIONS  one card per curve - expression, domain, show/hide, remove
 *   SETTINGS   the coordinate system, grouped: Range, Ticks, Display, Labels
 *   FOOTER     Cancel and Apply
 *
 * The preview is the largest thing on screen because it is the answer to the
 * only question the student has - "is my graph right?" - and the controls are
 * arranged around it rather than above it.
 *
 * THE PREVIEW IS NEVER EMPTY.
 *
 * A graph with no functions is still a coordinate system: axes, grid, ticks and
 * labels. It is drawn from the moment the editor opens, so the student is
 * looking at a graph they are adding to rather than at a blank box they have to
 * fill before anything appears.
 *
 * THE PREVIEW IS THE REAL RENDERER.
 *
 * The graph is drawn by the same `drawMathGraph` the canvas uses, from the same
 * model functions - so what the student inspects is what they will get.
 *
 * NOTHING IS COMMITTED UNTIL APPLY.
 *
 * The editor works on a COPY of the graph. Apply hands the finished settings
 * and functions back to the caller, which commits them as one undoable change;
 * Cancel discards the copy and the graph on the sheet is untouched.
 */

import enggMathModel from "./math-model.js";
import { drawMathGraph } from "../../../shared/rendering/entities/draw-math.js";

let openDialog = null;
let closeCurrent = null;

/* The preview's drawing area, in viewBox units. */
const PREVIEW_WIDTH = 720;
const PREVIEW_HEIGHT = 480;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* A number, as a student reads it. */
function numberText(value) {
  const number = Number(value);

  return Number.isFinite(number) ? String(Number(number.toFixed(4))) : "0";
}

/* ============================================================
 * THE WORKING COPY
 * ============================================================
 *
 * The editor never touches the document. It holds a plain object shaped like a
 * graph, and the preview draws it through the ordinary renderer.
 */
function workingCopy(graph) {
  const geometry = graph?.geometry || {};

  return {
    id: graph?.id || "graph-preview",
    type: enggMathModel.MATH_PLOT_TYPE,
    name: graph?.name || "Graph",
    style: { ...(graph?.style || {}) },
    engineering: { ...(graph?.engineering || {}) },
    geometry: {
      position: { ...(geometry.position || { x: 0, y: 0 }) },
      width: Number(geometry.width) || 200,
      height: Number(geometry.height) || 200,
      xMin: Number.isFinite(Number(geometry.xMin)) ? Number(geometry.xMin) : -5,
      xMax: Number.isFinite(Number(geometry.xMax)) ? Number(geometry.xMax) : 5,
      yMin: Number.isFinite(Number(geometry.yMin)) ? Number(geometry.yMin) : -5,
      yMax: Number.isFinite(Number(geometry.yMax)) ? Number(geometry.yMax) : 5,
      yRangeExplicit: geometry.yRangeExplicit === true,
      xTickSpacing: geometry.xTickSpacing ?? null,
      yTickSpacing: geometry.yTickSpacing ?? null,
      showXAxis: geometry.showXAxis !== false,
      showYAxis: geometry.showYAxis !== false,
      showGrid: geometry.showGrid !== false,
      showMinorGrid: geometry.showMinorGrid === true,
      showTickLabels: geometry.showTickLabels !== false,
      xLabel: typeof geometry.xLabel === "string" ? geometry.xLabel : "x",
      yLabel: typeof geometry.yLabel === "string" ? geometry.yLabel : "y",
      equalUnits: geometry.equalUnits !== false,
      mode: "plot",
      functions: enggMathModel
        .plotFunctions(graph)
        .map((component) => ({ ...component })),
    },
  };
}

/* ============================================================
 * THE PREVIEW
 * ============================================================
 *
 * The graph is drawn into a fixed viewBox, so the preview is the same size
 * whatever the graph's own box is on the sheet. The working copy is given a
 * preview-sized box for the duration of the draw and restored afterwards, so
 * the student's real dimensions are never changed by looking at it.
 */
function drawPreview(svg, graph) {
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  const saved = { ...graph.geometry };

  graph.geometry.position = { x: 0, y: 0 };
  graph.geometry.width = PREVIEW_WIDTH;
  graph.geometry.height = PREVIEW_HEIGHT;

  const toScreen = (point) => ({
    x: Number(point.x),
    y: Number(point.y),
  });

  /*
   * THE PAINTER DRAWS INTO A GROUP AND APPENDS THAT GROUP TO ITS PARENT. In the
   * editor the group and the parent would be the same element, so the painter
   * is given a group of its own - otherwise it would try to append the SVG into
   * itself, which is not a valid tree.
   */
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");

  try {
    drawMathGraph({
      svg: group,
      parentSvg: svg,
      entity: graph,
      style: graph.style,
      toScreen,
    });
  } finally {
    graph.geometry.position = saved.position;
    graph.geometry.width = saved.width;
    graph.geometry.height = saved.height;
  }
}

/* ============================================================
 * THE EDITOR
 * ============================================================ */

export function openPlotEditor(graph, options = {}) {
  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  close();

  const working = workingCopy(graph);

  const dialog = document.createElement("div");

  dialog.className = "drawing-plot-editor";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Plot Editor");

  dialog.innerHTML = `
        <div class="plot-editor">
            <div class="plot-editor-header">
                <div class="plot-editor-heading">
                    <div class="plot-editor-title">Graph - Plot</div>
                    <div class="plot-editor-description">
                        Build a mathematical graph - set the axes, then add the functions drawn on them
                    </div>
                </div>

                <button type="button" class="plot-editor-close"
                    data-graph-cancel aria-label="Close the plot editor">&times;</button>
            </div>

            <div class="plot-editor-body">
                <div class="plot-editor-stage">
                    <svg class="plot-editor-graph" data-graph-preview
                        viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}"
                        preserveAspectRatio="xMidYMid meet"
                        role="img" aria-label="Graph preview"></svg>
                </div>

                <div class="plot-editor-side">
                    <section class="plot-editor-panel" data-graph-functions>
                        <div class="plot-editor-panel-heading">
                            <span>Functions</span>
                            <button type="button" class="plot-editor-add" data-graph-add>
                                + Add Function
                            </button>
                        </div>

                        <div class="plot-editor-list" data-graph-list></div>
                    </section>

                    <section class="plot-editor-panel" data-graph-settings>
                        <div class="plot-editor-panel-heading">
                            <span>Graph Settings</span>
                        </div>

                        <div class="plot-editor-group">
                            <div class="plot-editor-group-title">Range</div>

                            <div class="plot-editor-grid">
                                <label class="plot-editor-field">
                                    <span>X Minimum</span>
                                    <input type="number" step="1" data-graph-field="xMin"
                                        aria-label="X minimum">
                                </label>

                                <label class="plot-editor-field">
                                    <span>X Maximum</span>
                                    <input type="number" step="1" data-graph-field="xMax"
                                        aria-label="X maximum">
                                </label>

                                <label class="plot-editor-field">
                                    <span>Y Minimum</span>
                                    <input type="number" step="1" data-graph-field="yMin"
                                        aria-label="Y minimum">
                                </label>

                                <label class="plot-editor-field">
                                    <span>Y Maximum</span>
                                    <input type="number" step="1" data-graph-field="yMax"
                                        aria-label="Y maximum">
                                </label>
                            </div>
                        </div>

                        <div class="plot-editor-group">
                            <div class="plot-editor-group-title">Ticks</div>

                            <div class="plot-editor-grid">
                                <label class="plot-editor-field">
                                    <span>X Tick Spacing</span>
                                    <input type="number" step="0.5" min="0"
                                        data-graph-field="xTickSpacing"
                                        aria-label="X tick spacing">
                                </label>

                                <label class="plot-editor-field">
                                    <span>Y Tick Spacing</span>
                                    <input type="number" step="0.5" min="0"
                                        data-graph-field="yTickSpacing"
                                        aria-label="Y tick spacing">
                                </label>
                            </div>
                        </div>

                        <div class="plot-editor-group">
                            <div class="plot-editor-group-title">Display</div>

                            <div class="plot-editor-toggles">
                                <label class="plot-editor-toggle">
                                    <input type="checkbox" data-graph-toggle="equalUnits">
                                    <span>Equal Unit Scaling</span>
                                </label>

                                <label class="plot-editor-toggle">
                                    <input type="checkbox" data-graph-toggle="showXAxis">
                                    <span>Show X Axis</span>
                                </label>

                                <label class="plot-editor-toggle">
                                    <input type="checkbox" data-graph-toggle="showYAxis">
                                    <span>Show Y Axis</span>
                                </label>

                                <label class="plot-editor-toggle">
                                    <input type="checkbox" data-graph-toggle="showGrid">
                                    <span>Show Grid</span>
                                </label>

                                <label class="plot-editor-toggle">
                                    <input type="checkbox" data-graph-toggle="showMinorGrid">
                                    <span>Minor Grid</span>
                                </label>

                                <label class="plot-editor-toggle">
                                    <input type="checkbox" data-graph-toggle="showTickLabels">
                                    <span>Show Tick Labels</span>
                                </label>
                            </div>
                        </div>

                        <div class="plot-editor-group">
                            <div class="plot-editor-group-title">Labels</div>

                            <div class="plot-editor-grid">
                                <label class="plot-editor-field">
                                    <span>X-axis Label</span>
                                    <input type="text" data-graph-field="xLabel"
                                        aria-label="X axis label">
                                </label>

                                <label class="plot-editor-field">
                                    <span>Y-axis Label</span>
                                    <input type="text" data-graph-field="yLabel"
                                        aria-label="Y axis label">
                                </label>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            <div class="plot-editor-actions">
                <button type="button" data-graph-cancel>Cancel</button>
                <button type="button" class="primary" data-graph-apply>Apply</button>
            </div>
        </div>
    `;

  document.body.appendChild(dialog);

  const list = dialog.querySelector("[data-graph-list]");
  const preview = dialog.querySelector("[data-graph-preview]");

  /* ============================================================
   * THE FUNCTION CARDS
   * ============================================================ */

  function renderList() {
    const functions = working.geometry.functions;

    if (!functions.length) {
      list.innerHTML =
        `<div class="plot-editor-empty">` +
        `No functions yet - the axes are drawn, add a function to plot a curve` +
        `</div>`;

      return;
    }

    list.innerHTML = functions
      .map((component, index) => {
        const plotted = component.mode === "plot";

        const expression = plotted
          ? `<input type="text" class="plot-editor-input" ` +
            `data-graph-expression="${escapeHtml(component.id)}" ` +
            `aria-label="Function ${index + 1} expression" ` +
            `value="${escapeHtml(component.expression)}" placeholder="x^2">`
          : `<span class="plot-editor-readonly">Sketched curve</span>`;

        const domain = plotted
          ? `<div class="plot-editor-domain">` +
            `<span class="plot-editor-domain-label">Domain</span>` +
            `<input type="number" step="0.5" class="plot-editor-input plot-editor-input-short" ` +
            `data-graph-domain="min" data-graph-function-id="${escapeHtml(component.id)}" ` +
            `aria-label="Function ${index + 1} domain minimum" ` +
            `value="${numberText(component.domain?.min)}">` +
            `<span class="plot-editor-arrow">to</span>` +
            `<input type="number" step="0.5" class="plot-editor-input plot-editor-input-short" ` +
            `data-graph-domain="max" data-graph-function-id="${escapeHtml(component.id)}" ` +
            `aria-label="Function ${index + 1} domain maximum" ` +
            `value="${numberText(component.domain?.max)}">` +
            `</div>`
          : "";

        return (
          `<div class="plot-editor-card" data-graph-function="${escapeHtml(component.id)}">` +
          `<div class="plot-editor-card-head">` +
          `<span class="plot-editor-card-number">${index + 1}</span>` +
          `<span class="plot-editor-card-swatch" aria-hidden="true"></span>` +
          `<span class="plot-editor-card-label">y =</span>` +
          `<button type="button" class="plot-editor-visible" ` +
          `data-graph-visible="${escapeHtml(component.id)}" ` +
          `aria-pressed="${component.visible !== false}" ` +
          `aria-label="${component.visible !== false ? "Hide" : "Show"} function ${index + 1}">` +
          `${component.visible !== false ? "Shown" : "Hidden"}</button>` +
          `<button type="button" class="plot-editor-delete" ` +
          `data-graph-remove="${escapeHtml(component.id)}" ` +
          `aria-label="Remove function ${index + 1}">&times;</button>` +
          `</div>` +
          `<div class="plot-editor-card-body">` +
          expression +
          domain +
          `<div class="plot-editor-card-problem" data-graph-problem="${escapeHtml(component.id)}" hidden></div>` +
          `</div>` +
          `</div>`
        );
      })
      .join("");
  }

  /* ============================================================
   * THE PROBLEMS
   * ============================================================
   *
   * An expression the evaluator cannot read is reported ON ITS OWN CARD, and
   * the graph keeps drawing every other curve. Nothing is silently replaced
   * with zero: a curve that cannot be evaluated is simply not drawn, and the
   * student is told which one and why.
   */
  function renderProblems() {
    working.geometry.functions.forEach((component) => {
      const node = list.querySelector(`[data-graph-problem="${component.id}"]`);

      if (!node) {
        return;
      }

      if (component.mode !== "plot") {
        node.hidden = true;
        return;
      }

      const text = String(component.expression ?? "").trim();

      if (!text) {
        node.textContent = "Enter an expression";
        node.hidden = false;
        return;
      }

      if (!enggMathModel.curveExpressionValid(text)) {
        node.textContent = "This expression cannot be plotted";
        node.hidden = false;
        return;
      }

      node.hidden = true;
    });
  }

  function refresh() {
    renderList();
    renderProblems();
    drawPreview(preview, working);
  }

  /* ============================================================
   * THE COORDINATE FIELDS
   * ============================================================ */
  function fillFields() {
    dialog.querySelectorAll("[data-graph-field]").forEach((input) => {
      const key = input.dataset.graphField;
      const value = working.geometry[key];

      input.value = value === null || value === undefined ? "" : String(value);
    });

    dialog.querySelectorAll("[data-graph-toggle]").forEach((input) => {
      input.checked = working.geometry[input.dataset.graphToggle] !== false;
    });
  }

  dialog.addEventListener("input", (event) => {
    const field = event.target.closest?.("[data-graph-field]");

    if (field) {
      const key = field.dataset.graphField;
      const raw = field.value;

      if (key === "xLabel" || key === "yLabel") {
        working.geometry[key] = raw;
        drawPreview(preview, working);
        return;
      }

      const value = Number(raw);

      if (!Number.isFinite(value)) {
        return;
      }

      working.geometry[key] = value;

      /*
       * A TYPED Y LIMIT IS THE STUDENT'S OWN RANGE. Until one is typed the Y
       * range is fitted to the functions, which is what makes `x^2` visible
       * rather than drawn above the plot area.
       */
      if (key === "yMin" || key === "yMax") {
        working.geometry.yRangeExplicit = true;
      }

      drawPreview(preview, working);
      return;
    }

    const expression = event.target.closest?.("[data-graph-expression]");

    if (expression) {
      const id = expression.dataset.graphExpression;

      working.geometry.functions = working.geometry.functions.map(
        (component) =>
          component.id === id
            ? { ...component, expression: expression.value }
            : component,
      );

      renderProblems();
      drawPreview(preview, working);
      return;
    }

    const domain = event.target.closest?.("[data-graph-domain]");

    if (domain) {
      const id = domain.dataset.graphFunctionId;
      const key = domain.dataset.graphDomain;
      const value = Number(domain.value);

      if (!Number.isFinite(value)) {
        return;
      }

      working.geometry.functions = working.geometry.functions.map(
        (component) => {
          if (component.id !== id) {
            return component;
          }

          const next = { ...(component.domain || {}), [key]: value };

          /* A domain that is not a range is refused, not stored. */
          return next.max > next.min
            ? { ...component, domain: next }
            : component;
        },
      );

      drawPreview(preview, working);
    }
  });

  dialog.addEventListener("change", (event) => {
    const toggle = event.target.closest?.("[data-graph-toggle]");

    if (toggle) {
      working.geometry[toggle.dataset.graphToggle] = toggle.checked;
      drawPreview(preview, working);
    }
  });

  dialog.addEventListener("click", (event) => {
    const add = event.target.closest?.("[data-graph-add]");

    if (add) {
      const limits = enggMathModel.graphLimits(working);

      working.geometry.functions = [
        ...working.geometry.functions,
        enggMathModel.createPlotFunction({
          expression: "x",
          domain: { min: limits.xMin, max: limits.xMax },
        }),
      ];

      refresh();

      const inputs = list.querySelectorAll("[data-graph-expression]");

      inputs[inputs.length - 1]?.focus();

      return;
    }

    const remove = event.target.closest?.("[data-graph-remove]");

    if (remove) {
      const id = remove.dataset.graphRemove;

      working.geometry.functions = working.geometry.functions.filter(
        (component) => component.id !== id,
      );

      refresh();
      return;
    }

    const visible = event.target.closest?.("[data-graph-visible]");

    if (visible) {
      const id = visible.dataset.graphVisible;

      working.geometry.functions = working.geometry.functions.map(
        (component) =>
          component.id === id
            ? { ...component, visible: component.visible === false }
            : component,
      );

      refresh();
    }
  });

  /* ============================================================
   * APPLY AND CANCEL
   * ============================================================ */
  const cancel = () => {
    close();
    options.onCancel?.();
  };

  dialog.querySelector("[data-graph-apply]").addEventListener("click", () => {
    const result = {
      geometry: { ...working.geometry },
      style: { ...working.style },
    };

    close();

    options.onApply?.(result);
  });

  dialog.querySelectorAll("[data-graph-cancel]").forEach((button) => {
    button.addEventListener("click", cancel);
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });

  openDialog = dialog;
  closeCurrent = cancel;

  fillFields();
  refresh();

  dialog.querySelector("[data-graph-field]")?.focus();

  return dialog;
}

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  closeCurrent = null;
}

export function isPlotEditorOpen() {
  return openDialog !== null;
}

export function closePlotEditor() {
  if (!openDialog) {
    return false;
  }

  closeCurrent?.();

  return true;
}

const enggMathPlotEditor = {
  openPlotEditor,
  isPlotEditorOpen,
  closePlotEditor,
};

export default enggMathPlotEditor;
