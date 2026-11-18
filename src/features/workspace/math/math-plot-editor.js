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

/*
 * THE SHARED COORDINATE MODEL.
 *
 * The editor's axes, tick and grid controls are the SAME settings the Sketch
 * Editor edits and the sheet paints from. Reading and writing them through the
 * adapter is what keeps the panel, the preview and the placed graph one thing.
 */
import {
  applyGridToGeometry,
  gridFromGeometry,
} from "../../../shared/sketch/sketch-grid-legacy.js";

let openDialog = null;
let closeCurrent = null;

/*
 * THE SIDEBAR'S WIDTH, in pixels: a comfortable column that never takes the
 * canvas's room. The brief's 320-360px, with a floor and ceiling so a drag can
 * neither hide the panel nor swallow the graph.
 */
const PLOT_SIDEBAR_MIN = 260;
const PLOT_SIDEBAR_DEFAULT = 340;
const PLOT_SIDEBAR_MAX = 420;

/* The preview's box when the canvas has not been laid out yet.
 * A measurement is used whenever one is available; this is only the answer for
 * a container that reports no size at all. */
const PREVIEW_FALLBACK_WIDTH = 720;
const PREVIEW_FALLBACK_HEIGHT = 480;

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
function drawPreview(svg, graph, box = null) {
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  /*
   * THE PREVIEW IS THE CANVAS'S OWN SIZE.
   *
   * The viewBox is set from the measured box, so one drawing unit is one pixel
   * and the graph fills the stage at any window size. Only when nothing has
   * been laid out yet - an editor constructed before its container is on screen
   * - does the fallback apply, and the observer redraws as soon as there is a
   * real size.
   */
  const width = box?.width > 0 ? box.width : PREVIEW_FALLBACK_WIDTH;
  const height = box?.height > 0 ? box.height : PREVIEW_FALLBACK_HEIGHT;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const saved = { ...graph.geometry };

  graph.geometry.position = { x: 0, y: 0 };
  graph.geometry.width = width;
  graph.geometry.height = height;

  /*
   * THE EDITOR HAS NO OUTSIDE, SO IT RESERVES NO MARGIN.
   *
   * A PLACED graph leaves an inset inside its box for the tick numbers that sit
   * outside the plot area. The editor's box IS the canvas - its numbers are
   * drawn inside it - so the inset is zero. Inheriting the placed graph's inset
   * shrank the plot area and pushed it off-centre, leaving a wide empty band on
   * one side of the preview.
   *
   * This is the graph's own property, not a rule about where it is drawn, which
   * is why it is set on the working copy and restored with the rest.
   */
  graph.geometry.graphInset = { left: 0, right: 0, top: 0, bottom: 0 };

  /*
   * DRAWING SPACE GROWS UPWARD; SVG GROWS DOWNWARD.
   *
   * `graphToDrawing` answers in the sheet's own coordinates, where y increases
   * upward - the same convention every other feature on the drawing uses. An
   * SVG's y increases downward, so the two must be flipped here, at the one
   * boundary where a drawing coordinate becomes a pixel.
   *
   * Without the flip the preview was drawn upside-down: -5 at the top of the
   * y axis and +5 at the bottom, so every curve opened the wrong way.
   */
  const toScreen = (point) => ({
    x: Number(point.x),
    y: height - Number(point.y),
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

    if (saved.graphInset === undefined) {
      delete graph.geometry.graphInset;
    } else {
      graph.geometry.graphInset = saved.graphInset;
    }
  }
}

/*
 * ============================================================
 * THE PROPERTIES ROWS
 * ============================================================
 *
 * One builder per kind of row, so the markup below reads as the sections it
 * describes rather than as repeated input tags. Each row carries the SAME
 * `data-graph-*` hook the old editor used, so every handler and every test
 * that drives a field by name keeps working unchanged.
 */
function numberField(key, label, step = 1) {
  return (
    `<label class="plot-editor-field">` +
    `<span>${escapeHtml(label)}</span>` +
    `<input type="number" step="${step}" data-graph-field="${escapeHtml(key)}" ` +
    `aria-label="${escapeHtml(label)}">` +
    `</label>`
  );
}

function textField(key, label) {
  return (
    `<label class="plot-editor-field">` +
    `<span>${escapeHtml(label)}</span>` +
    `<input type="text" data-graph-field="${escapeHtml(key)}" ` +
    `aria-label="${escapeHtml(label)}">` +
    `</label>`
  );
}

function toggleField(key, label) {
  return (
    `<label class="plot-editor-toggle">` +
    `<input type="checkbox" data-graph-toggle="${escapeHtml(key)}">` +
    `<span>${escapeHtml(label)}</span>` +
    `</label>`
  );
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

  dialog.className = "drawing-plot-editor drawing-graph-plot";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Plot Editor");

  /*
   * THE SAME SHELL AS THE SKETCH EDITOR.
   *
   * A compact header, one icon toolbar, the canvas taking every pixel the
   * chrome does not, a properties column that scrolls on its own, and a
   * footer. The class names are the sketch editor's, so the two popups share
   * one stylesheet and cannot drift apart in proportions.
   *
   * THE CANVAS IS SIZED BY ITS CELL. There is no fixed viewBox here: the SVG's
   * viewBox is set from its real box on every draw, which is what makes the
   * preview fill the stage instead of floating in it. The old fixed 720x480
   * preview was laid into a container that measured zero, so every element it
   * created - grid, axes, ticks - was present in the DOM and invisible.
   */
  dialog.innerHTML = `
        <div class="sketch-app" data-plot-app>
            <header class="sketch-app-header">
                <div class="sketch-app-heading">
                    <span class="sketch-app-title">Graph - Plot</span>
                    <span class="sketch-app-instruction">Set the axes, then add the functions drawn on them</span>
                </div>

                <div class="sketch-app-actions">
                    <button type="button" class="sketch-ghost" data-graph-cancel>Cancel</button>
                    <button type="button" class="sketch-primary" data-graph-apply>Apply</button>
                    <button type="button" class="sketch-close" data-graph-cancel
                        aria-label="Close the plot editor" title="Close">&times;</button>
                </div>
            </header>

            <div class="sketch-app-toolbar" role="toolbar" aria-label="Plot tools">
                <div class="sketch-tool-group" role="group" aria-label="Function tools">
                    <button type="button" class="sketch-mini" data-graph-add
                        aria-label="Add a function" title="Add a function">+ Add function</button>
                </div>

                <span class="sketch-tool-divider" aria-hidden="true"></span>

                <div class="sketch-tool-group" role="group" aria-label="View">
                    <button type="button" class="sketch-mini" data-graph-fit
                        aria-label="Fit to content" title="Fit the graph to the canvas">Fit</button>
                </div>

                <span class="sketch-tool-spacer"></span>

                <button type="button" class="sketch-mini" data-graph-maximise
                    aria-label="Maximise the preview" title="Maximise the preview"
                    aria-pressed="false">Maximise</button>
                <button type="button" class="sketch-mini" data-graph-collapse
                    aria-label="Collapse the properties panel"
                    title="Show or hide properties" aria-pressed="true">Properties</button>
            </div>

            <div class="sketch-app-body" data-graph-body>
                <div class="sketch-stage" data-plot-stage>
                    <div class="sketch-canvas" data-plot-canvas>
                        <svg class="sketch-canvas-svg" data-graph-preview
                            preserveAspectRatio="xMidYMid meet"
                            role="img" aria-label="Graph preview"></svg>
                    </div>
                </div>

                <div class="sketch-divider" data-graph-divider role="separator"
                    aria-orientation="vertical" aria-label="Resize the properties panel"
                    tabindex="0"></div>

                <aside class="sketch-inspector" data-graph-inspector aria-label="Plot properties">
                    <div class="sketch-inspector-scroll">

                        <section class="sketch-section">
                            <div class="sketch-section-head">
                                <span class="sketch-section-title">Definition</span>
                                <button type="button" class="sketch-mini" data-graph-add>+ Add</button>
                            </div>

                            <div class="plot-editor-list" data-graph-list></div>
                        </section>

                        <section class="sketch-section">
                            <div class="sketch-section-head">
                                <span class="sketch-section-title">Coordinates</span>
                            </div>

                            <div class="plot-editor-grid">
                                ${numberField("xMin", "X Minimum")}
                                ${numberField("xMax", "X Maximum")}
                                ${numberField("yMin", "Y Minimum")}
                                ${numberField("yMax", "Y Maximum")}
                            </div>

                            ${toggleField("equalUnits", "Equal X / Y scale")}

                            <button type="button" class="sketch-mini" data-graph-fit>Fit to content</button>
                        </section>

                        <section class="sketch-section">
                            <div class="sketch-section-head">
                                <span class="sketch-section-title">Axes &amp; Grid</span>
                            </div>

                            ${toggleField("showXAxis", "Show X axis")}
                            ${toggleField("showYAxis", "Show Y axis")}
                            ${toggleField("showTicks", "Show tick marks")}
                            ${toggleField("showTickLabels", "Show tick numbers")}
                            ${toggleField("showMajorGrid", "Major grid")}
                            ${toggleField("showMinorGrid", "Minor grid")}
                            ${toggleField("linkXYIntervals", "Link X / Y intervals")}

                            <div class="plot-editor-grid">
                                ${numberField("majorX", "X interval")}
                                ${numberField("majorY", "Y interval")}
                                ${numberField("minorDivisions", "Minor divisions")}
                            </div>

                            <div class="plot-editor-grid">
                                ${textField("xLabel", "X-axis label")}
                                ${textField("yLabel", "Y-axis label")}
                            </div>
                        </section>

                        <section class="sketch-section">
                            <div class="sketch-section-head">
                                <span class="sketch-section-title">Appearance</span>
                            </div>

                            <div class="plot-editor-list" data-graph-appearance></div>
                        </section>

                    </div>
                </aside>
            </div>

            <footer class="sketch-app-footer">
                <span class="sketch-status" data-graph-status></span>
                <span class="sketch-hint" data-graph-hint></span>
            </footer>
        </div>
    `;

  document.body.appendChild(dialog);

  const list = dialog.querySelector("[data-graph-list]");
  const preview = dialog.querySelector("[data-graph-preview]");
  const body = dialog.querySelector("[data-graph-body]");
  const sidebar = dialog.querySelector("[data-graph-inspector]");
  const divider = dialog.querySelector("[data-graph-divider]");
  const stage = dialog.querySelector("[data-plot-stage]");

  let sidebarWidth = PLOT_SIDEBAR_DEFAULT;
  let sidebarCollapsed = false;
  let maximised = false;

  /* The graph as it is drawn: the live preview box, or the working copy. */
  function renderPreview() {
    drawPreview(preview, working, canvasBox());
  }

  /* ============================================================
   * THE LAYOUT
   * ============================================================
   *
   * THE CANVAS IS MEASURED, NOT ASSUMED.
   *
   * The preview's viewBox is taken from its own box on every draw, so the
   * graph fills the stage at any window size. A fixed viewBox - which is what
   * this editor used to have - is only correct at one size, and when the
   * container measured zero the whole picture was laid out into nothing.
   */

  function canvasBox() {
    const rect = preview.getBoundingClientRect?.();

    const width = rect && rect.width > 0 ? rect.width : 0;
    const height = rect && rect.height > 0 ? rect.height : 0;

    if (!(width > 0) || !(height > 0)) {
      return null;
    }

    return { width, height };
  }

  function setSidebarWidth(width) {
    sidebarWidth = Math.max(
      PLOT_SIDEBAR_MIN,
      Math.min(PLOT_SIDEBAR_MAX, Math.round(width)),
    );

    sidebar.style.width = `${sidebarWidth}px`;
  }

  function toggleCollapsed() {
    sidebarCollapsed = !sidebarCollapsed;

    sidebar.classList.toggle("is-collapsed", sidebarCollapsed);

    if (divider) {
      divider.hidden = sidebarCollapsed;
    }
  }

  function toggleMaximised() {
    maximised = !maximised;

    dialog.classList.toggle("is-maximised", maximised);
    body.classList.toggle("is-preview-only", maximised);
    stage.classList.toggle("is-maximised", maximised);

    const button = dialog.querySelector("[data-graph-maximise]");

    button?.setAttribute("aria-pressed", String(maximised));
    button?.setAttribute(
      "aria-label",
      maximised ? "Restore the properties panel" : "Maximise the preview",
    );

    renderPreview();
  }

  /*
   * FIT TO CONTENT.
   *
   * The model already knows how to do this: `graphLimits` fits the Y range to
   * the functions when the student has not chosen one. So fitting is expressed
   * as "use the fitted limits", NOT as new arithmetic here - the editor must
   * not grow a second opinion about where a curve lies.
   *
   * It changes the VIEW and nothing else: expressions, domains and the
   * functions' own samples are untouched, which is the brief's requirement that
   * Fit must not modify the mathematical definitions.
   */
  function fitToContent() {
    const fitted = enggMathModel.graphLimits(working);

    working.geometry.xMin = fitted.xMin;
    working.geometry.xMax = fitted.xMax;
    working.geometry.yMin = fitted.yMin;
    working.geometry.yMax = fitted.yMax;

    /*
     * THE FITTED RANGE BECOMES THE STUDENT'S VIEW.
     * `yRangeExplicit` records that a Y range was chosen, so the model stops
     * re-fitting it on every draw - otherwise the next redraw would undo the
     * fit the student just asked for.
     */
    working.geometry.yRangeExplicit = true;

    fillFields();
    renderPreview();
  }

  /* The divider: drag to resize, arrow keys for the keyboard. */
  divider?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    divider.setPointerCapture?.(event.pointerId);

    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    const move = (moveEvent) => {
      setSidebarWidth(startWidth - (moveEvent.clientX - startX));
      renderPreview();
    };

    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
    };

    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });

  divider?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      setSidebarWidth(sidebarWidth + 16);
      renderPreview();
    }

    if (event.key === "ArrowRight") {
      setSidebarWidth(sidebarWidth - 16);
      renderPreview();
    }
  });

  /*
   * A RESIZE REDRAWS AT THE NEW SIZE.
   *
   * `ResizeObserver` is what makes a dragged window, a dragged divider and a
   * maximised preview all land the graph in the box it ACTUALLY has - without
   * it the preview kept the viewBox it was drawn with and letterboxed inside
   * its new cell.
   */
  if (typeof ResizeObserver === "function") {
    const sizeObserver = new ResizeObserver(() => renderPreview());

    sizeObserver.observe(preview);

    /* Released by `close`, which owns the dialog's lifetime. */
    dialog.__plotObserver = sizeObserver;
  }

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
    renderPreview();
  }

  /* ============================================================
   * THE COORDINATE FIELDS
   * ============================================================ */
  /*
   * THE PANEL READS THROUGH THE SHARED GRID MODEL.
   *
   * Every axes, tick and grid control is answered by `gridFromGeometry`, the
   * same conversion the preview and the placed graph paint from - so a toggle
   * can never show a state the drawing does not have. The legacy flat fields
   * stay on the geometry and are kept in step by `applyGridToGeometry`, which
   * is what keeps an older drawing readable.
   */
  function currentGrid() {
    return gridFromGeometry(working.geometry);
  }

  function fillFields() {
    const grid = currentGrid();

    dialog.querySelectorAll("[data-graph-field]").forEach((input) => {
      const key = input.dataset.graphField;

      const value = key in grid ? grid[key] : working.geometry[key];

      input.value = value === null || value === undefined ? "" : String(value);
    });

    dialog.querySelectorAll("[data-graph-toggle]").forEach((input) => {
      const key = input.dataset.graphToggle;
      const value = key in grid ? grid[key] : working.geometry[key];

      input.checked = value !== false;
    });
  }

  /*
   * ONE EDIT, WRITTEN THROUGH THE ADAPTER.
   *
   * A field or toggle changes the SHARED grid, and the adapter writes it back
   * in both forms. Doing it this way is what stops the panel, the preview and
   * the placed graph from drifting: there is one write, to one model.
   */
  function writeGridKey(key, value) {
    const grid = { ...currentGrid(), [key]: value };

    applyGridToGeometry(working.geometry, grid);
  }

  dialog.addEventListener("input", (event) => {
    const field = event.target.closest?.("[data-graph-field]");

    if (field) {
      const key = field.dataset.graphField;
      const raw = field.value;

      /* The two axis labels are TEXT, and live on the shared model as such. */
      if (key === "xLabel" || key === "yLabel") {
        writeGridKey(
          key === "xLabel" ? "xAxisLabel" : "yAxisLabel",
          raw,
        );
        renderPreview();
        return;
      }

      const value = Number(raw);

      if (!Number.isFinite(value)) {
        return;
      }

      /*
       * ONE KEY NAMESPACE FOR BOUNDS, ONE FOR THE COORDINATE SYSTEM.
       *
       * The four limits are the graph's own - they define the mapping - so
       * they stay on the geometry. Every axes, tick and grid setting belongs to
       * the shared model and is written through the adapter.
       */
      const gridKeys = [
        "majorX",
        "majorY",
        "minorDivisions",
        "majorOpacity",
        "minorOpacity",
        "tickLengthPx",
      ];

      if (gridKeys.includes(key)) {
        writeGridKey(key, value);
        renderPreview();
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

      renderPreview();
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
      renderPreview();
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

      renderPreview();
    }
  });

  dialog.addEventListener("change", (event) => {
    const toggle = event.target.closest?.("[data-graph-toggle]");

    if (toggle) {
      /*
       * A TOGGLE WRITES THE SHARED MODEL, not a flat legacy field - so hiding
       * the grid in the editor and hiding it on the sheet are the same edit.
       */
      writeGridKey(toggle.dataset.graphToggle, toggle.checked);
      renderPreview();
    }
  });

  dialog.addEventListener("click", (event) => {
    /* ---- the toolbar's own controls, which change no data ---- */
    if (event.target.closest?.("[data-graph-maximise]")) {
      toggleMaximised();
      return;
    }

    if (event.target.closest?.("[data-graph-collapse]")) {
      toggleCollapsed();
      renderPreview();
      return;
    }

    if (event.target.closest?.("[data-graph-fit]")) {
      fitToContent();
      return;
    }

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
    openDialog.__plotObserver?.disconnect?.();
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

