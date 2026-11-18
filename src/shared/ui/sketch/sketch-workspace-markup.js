/*
 * ========================================================
 * THE SKETCH WORKSPACE - MARKUP
 * ========================================================
 *
 * The structure of every sketch tool's workspace, as one string, so each tool's
 * behaviour file is about behaviour.
 *
 * THREE REGIONS, ALWAYS
 * ---------------------
 *     HEADER     title, undo/redo, fit, maximise, close
 *     TOOLBAR    Select, Draw (+ its small secondary menu), Add Point, Erase,
 *                and Automatic Correction, which is ON by default
 *     BODY       the canvas (dominant) and the contextual properties sidebar
 *     FOOTER     counts and status, Cancel, Place Sketch
 *
 * DRAWING BEGINS IMMEDIATELY. There is no construction-method tab, no
 * Definition / Correction / Coordinates / Axes pages, and no Shape Guide
 * system: the student draws and DAETUM reconstructs. Straight Segment and
 * Polyline live in a small menu BEHIND the Draw button, so they are available
 * without becoming steps anybody has to take.
 *
 * ONE CONTEXTUAL SIDEBAR, NOT A FORM
 * ----------------------------------
 * The sidebar shows what the SELECTION needs and nothing else:
 *
 *     nothing selected   a short instruction, the geometry list, and one
 *                        compact Drawing Settings control
 *     a point selected   its coordinates, their mode, its relationship and
 *                        lock, and Delete
 *     a curve selected   what it actually is, its trend, correction and
 *                        appearance
 *     a circle/arc       centre, radius and angles
 *
 * The global view settings - coordinate bounds, axes, grid, snapping, output -
 * are folded inside Drawing Settings, in compact expandable groups, so they do
 * not sit on screen beside a colour picker for a curve.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ICONS = {
  select: '<path d="M5 3l10 7-4.2 1.1L8.3 16z"/>',
  draw: '<path d="M3 17l1.2-4.2L14.6 2.4a1.6 1.6 0 0 1 2.2 0l1.2 1.2a1.6 1.6 0 0 1 0 2.2L7.6 16.2 3 17z"/>',
  point:
    '<circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/>',
  erase:
    '<path d="M4.5 15.5l-2-2a1.2 1.2 0 0 1 0-1.7l7.6-7.6a1.2 1.2 0 0 1 1.7 0l3.4 3.4a1.2 1.2 0 0 1 0 1.7L9.5 15.5zM8 6.5l5.5 5.5M4.5 15.5H17"/>',
  undo: '<path d="M6.5 5.5L3 9l3.5 3.5"/><path d="M3 9h8.5a4.5 4.5 0 1 1 0 9H9"/>',
  redo: '<path d="M13.5 5.5L17 9l-3.5 3.5"/><path d="M17 9H8.5a4.5 4.5 0 1 0 0 9H11"/>',
  fit: '<path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 17H3v-3"/><path d="M6.5 10h7"/>',
  maximise: '<path d="M3 8V3h5M17 12v5h-5M3 12v5h5M12 3h5v5"/>',
  segment: '<path d="M3 16L17 4"/>',
  polyline: '<path d="M3 15l4-6 4 4 6-8"/>',
};

function iconButton({ action, icon, label, title, pressed = null, extra = "" }) {
  const pressedAttr =
    pressed === null ? "" : ` aria-pressed="${pressed ? "true" : "false"}"`;

  return `<button type="button" class="sketch-tool"
      data-sketch-${action}${pressedAttr}${extra}
      title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
      <svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[icon] || ""}</svg>
      <span class="sketch-tool-text">${escapeHtml(label)}</span>
    </button>`;
}

/* A collapsible block. `open` controls the initial state. */
export function section({ key, title, open = false, body, badge = "", hidden = false }) {
  return `<section class="sketch-section" data-sketch-section="${key}"${hidden ? " hidden" : ""}>
      <button type="button" class="sketch-section-head" data-sketch-section-toggle="${key}"
          aria-expanded="${open ? "true" : "false"}">
        <span class="sketch-section-caret" aria-hidden="true"></span>
        <span class="sketch-section-title">${escapeHtml(title)}</span>
        <span class="sketch-section-badge">${badge}</span>
      </button>
      <div class="sketch-section-body"${open ? "" : " hidden"}>${body}</div>
    </section>`;
}

/* A labelled numeric field. */
export function numberField(key, label, { step = "any", value = "", scope = "field", title = "" } = {}) {
  return `<label class="sketch-field" title="${escapeHtml(title || label)}">
      <span class="sketch-field-label">${escapeHtml(label)}</span>
      <input type="number" inputmode="decimal" step="${step}" value="${escapeHtml(value)}"
          data-sketch-${scope}="${key}" aria-label="${escapeHtml(label)}">
    </label>`;
}

/* A text field. */
export function textField(key, label, { value = "", scope = "text", placeholder = "" } = {}) {
  return `<label class="sketch-field">
      <span class="sketch-field-label">${escapeHtml(label)}</span>
      <input type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"
          data-sketch-${scope}="${key}" aria-label="${escapeHtml(label)}">
    </label>`;
}

/* A checkbox. */
export function checkbox(key, label, { scope = "toggle", checked = false, title = "" } = {}) {
  return `<label class="sketch-check" title="${escapeHtml(title || label)}">
      <input type="checkbox" data-sketch-${scope}="${key}"${checked ? " checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>`;
}

/* A select. */
export function selectField(key, label, options, { scope = "select", value = "", title = "" } = {}) {
  const body = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");

  return `<label class="sketch-field" title="${escapeHtml(title || label)}">
      <span class="sketch-field-label">${escapeHtml(label)}</span>
      <select data-sketch-${scope}="${key}" aria-label="${escapeHtml(label)}">${body}</select>
    </label>`;
}

/* ========================================================
 * THE DRAW MENU - Straight Segment and Polyline
 * ========================================================
 *
 * A SECONDARY MENU, NOT A CONFIGURATION STEP. Draw is the button; the two
 * exact-construction tools sit behind its caret for the student who wants a
 * straight segment or a joined polyline drawn exactly rather than recognised.
 * Nothing here is required to draw anything.
 */
function drawMenu() {
  return `
    <div class="sketch-draw-menu" data-sketch-draw-menu hidden>
      ${iconButton({
        action: "tool-freeshape",
        icon: "draw",
        label: "Freehand",
        title: "Draw freely - DAETUM recognises the shape (D)",
      })}
      ${iconButton({
        action: "tool-line",
        icon: "segment",
        label: "Straight segment",
        title: "Draw an exact straight segment: click a start, click an end",
      })}
      ${iconButton({
        action: "tool-polyline",
        icon: "polyline",
        label: "Polyline",
        title: "Draw an exact polyline: click each vertex, double-click to finish",
      })}
    </div>
  `;
}

/* ========================================================
 * THE CANVAS
 * ======================================================== */

function canvasRegion() {
  return `
    <div class="sketch-ws-canvas" data-sketch-canvas-cell>
      <svg class="sketch-ws-svg" data-sketch-svg preserveAspectRatio="none"
          role="application" aria-label="Sketch drawing canvas"></svg>

      <div class="sketch-ws-canvas-hint" data-sketch-canvas-hint>
        Draw anywhere. DAETUM reconstructs lines, circles, arcs and curves as you go.
      </div>
    </div>
  `;
}

/* ========================================================
 * THE CONTEXTUAL SIDEBAR
 * ========================================================
 *
 * The empty state: a short instruction, the geometry list, and the compact
 * Drawing Settings control. Every other state replaces this entirely - a view
 * of the selection, never a longer form beside it.
 */
function idleBody() {
  return `
    <div class="sketch-idle" data-sketch-idle>
      <p class="sketch-note" data-sketch-empty-hint>
        Nothing selected. Draw on the canvas, or select geometry or a point to
        edit it.
      </p>

      <div class="sketch-geometry-list" data-sketch-geometry-list
          role="list" aria-label="Geometry"></div>

      <div class="sketch-points" data-sketch-points role="list" aria-label="Points"></div>

      <div data-sketch-drawing-settings>
        ${section({
          key: "drawing-settings",
          title: "Drawing Settings",
          open: false,
          body: drawingSettingsBody(),
        })}
      </div>
    </div>

    <div class="sketch-selection" data-sketch-selection-properties hidden></div>
  `;
}

/* ========================================================
 * DRAWING SETTINGS - the global view options, folded away
 * ========================================================
 *
 * One control from the idle sidebar. Inside it, compact expandable groups:
 * bounds, axes and grid, snapping, and what the placed sketch includes. They
 * are NOT shown beside a selected curve, and they are not tabs.
 */
function drawingSettingsBody() {
  return `
    <details class="sketch-group" open>
      <summary>Coordinate bounds</summary>

      <div class="sketch-checks">
        ${checkbox("autoBounds", "Automatic bounds", {
          checked: true,
          title: "The view follows the geometry and the points you define",
        })}
        ${checkbox("equalScale", "Equal X / Y scale", {
          checked: true,
          title: "Keeps circles circular and angles true",
        })}
      </div>

      <div class="sketch-field-grid" data-sketch-bounds-fields>
        ${numberField("xMin", "X min")}
        ${numberField("xMax", "X max")}
        ${numberField("yMin", "Y min")}
        ${numberField("yMax", "Y max")}
      </div>

      <div class="sketch-inline-actions">
        <button type="button" class="sketch-mini" data-sketch-fit-bounds>Fit to content</button>
      </div>

      <p class="sketch-note">
        Geometry is stored in sketch coordinates. Resizing or zooming the view
        never changes a stored point.
      </p>
    </details>

    <details class="sketch-group">
      <summary>Axes &amp; grid</summary>

      <div class="sketch-checks">
        ${checkbox("showXAxis", "X axis", { checked: true })}
        ${checkbox("showYAxis", "Y axis", { checked: true })}
        ${checkbox("showAxisLabels", "Axis labels", { checked: true })}
        ${checkbox("showOrigin", "Origin", { checked: true })}
        ${checkbox("showMajorGrid", "Major grid", { checked: true })}
        ${checkbox("showMinorGrid", "Minor grid")}
        ${checkbox("showTicks", "Tick marks", { checked: true })}
        ${checkbox("showTickLabels", "Numeric tick labels")}
      </div>

      ${selectField(
        "tickDirection",
        "Tick direction",
        [
          { value: "outside", label: "Outside" },
          { value: "inside", label: "Inside" },
          { value: "both", label: "Both" },
        ],
        { value: "outside" },
      )}

      <div class="sketch-field-grid">
        ${textField("axisX", "X label", { scope: "axis-label", value: "x" })}
        ${textField("axisY", "Y label", { scope: "axis-label", value: "y" })}
        ${numberField("majorX", "Major X")}
        ${numberField("majorY", "Major Y")}
        ${numberField("minorDivisions", "Minor per major", { step: "1" })}
        ${numberField("labelPrecision", "Precision", { step: "1" })}
      </div>
    </details>

    <details class="sketch-group">
      <summary>Snapping</summary>

      <p class="sketch-note">
        Snapping works even when the grid is hidden: it is a place, not a line.
      </p>

      <div class="sketch-checks">
        ${checkbox("snapToGrid", "Grid intersections", { checked: true })}
        ${checkbox("snapToGridMidpoints", "Grid midpoints and cell centres", { checked: true })}
        ${checkbox("snapToPoints", "Existing points", { checked: true })}
        ${checkbox("snapToGeometry", "Existing geometry", { checked: true })}
      </div>

      ${numberField("snapTolerancePx", "Snap tolerance (px)", { step: "1" })}
    </details>

    <details class="sketch-group">
      <summary>Placed sketch output</summary>

      <p class="sketch-note">
        Points, handles and the working grid are not part of the drawing unless
        you include them.
      </p>

      <div class="sketch-checks">
        ${checkbox("outAxes", "Coordinate axes")}
        ${checkbox("outMajorGrid", "Major grid")}
        ${checkbox("outMinorGrid", "Minor grid")}
        ${checkbox("outTicks", "Tick marks")}
        ${checkbox("outLabels", "Numeric tick labels")}
        ${checkbox("outPoints", "Point markers and labels")}
      </div>
    </details>
  `;
}

/* ========================================================
 * THE WORKSPACE
 * ======================================================== */

export function sketchWorkspaceMarkup(options = {}) {
  const title = escapeHtml(options.title || "Graph - Sketch");

  return `
  <div class="sketch-ws" data-sketch-ws>
    <header class="sketch-ws-header">
      <div class="sketch-ws-heading">
        <span class="sketch-ws-title">${title}</span>
        <span class="sketch-ws-instruction" data-sketch-instruction>
          Draw freely - DAETUM reconstructs clean geometry. Add points for exact constraints.
        </span>
      </div>

      <div class="sketch-ws-header-actions">
        ${iconButton({ action: "undo", icon: "undo", label: "Undo", title: "Undo (Ctrl+Z)", pressed: false })}
        ${iconButton({ action: "redo", icon: "redo", label: "Redo", title: "Redo (Ctrl+Shift+Z)", pressed: false })}
        ${iconButton({ action: "fit", icon: "fit", label: "Fit to Content", title: "Fit the view to the content" })}
        ${iconButton({ action: "maximise", icon: "maximise", label: "Maximise Preview", title: "Maximise or restore the preview", pressed: false })}
        <button type="button" class="sketch-ws-close" data-sketch-cancel
            aria-label="Close the sketch editor" title="Close">&times;</button>
      </div>
    </header>

    <div class="sketch-ws-toolbar" role="toolbar" aria-label="Sketch tools">
      <div class="sketch-tool-group" role="group" aria-label="Drawing tools">
        ${iconButton({ action: "tool-select", icon: "select", label: "Select", title: "Select and move geometry and points (S)" })}

        <span class="sketch-tool-split">
          ${iconButton({ action: "tool-draw", icon: "draw", label: "Draw", title: "Draw freely - DAETUM recognises the shape (D)" })}
          <button type="button" class="sketch-tool-caret" data-sketch-draw-toggle
              aria-haspopup="true" aria-expanded="false"
              title="Straight segment and polyline" aria-label="More drawing tools">&#9662;</button>
        </span>

        ${iconButton({ action: "tool-point", icon: "point", label: "Add Point", title: "Add an exact point, or place one on geometry (A)" })}
        ${iconButton({ action: "tool-erase", icon: "erase", label: "Erase", title: "Erase geometry or points (E)" })}
      </div>

      ${drawMenu()}

      <span class="sketch-tool-spacer"></span>

      <label class="sketch-auto-toggle" title="Automatically recognise and reconstruct what you draw">
        <input type="checkbox" data-sketch-auto-correct checked>
        <span class="sketch-auto-dot" aria-hidden="true"></span>
        <span class="sketch-auto-text">Automatic Correction</span>
      </label>
    </div>

    <div class="sketch-ws-body" data-sketch-body>
      ${canvasRegion()}

      <div class="sketch-ws-divider" data-sketch-divider role="separator"
          aria-orientation="vertical" aria-label="Resize the properties panel"
          tabindex="0"></div>

      <aside class="sketch-ws-sidebar" data-sketch-sidebar aria-label="Sketch properties">
        <div class="sketch-ws-sidebar-head">
          <span class="sketch-ws-sidebar-title" data-sketch-sidebar-title>Sketch</span>
          <button type="button" class="sketch-ws-collapse" data-sketch-collapse
              title="Collapse the properties panel" aria-label="Collapse the properties panel">
            <span aria-hidden="true">&rsaquo;</span>
          </button>
        </div>

        <div class="sketch-ws-scroll" data-sketch-scroll>
          ${idleBody()}
        </div>
      </aside>
    </div>

    <footer class="sketch-ws-footer">
      <span class="sketch-ws-status" data-sketch-status>Ready</span>
      <span class="sketch-ws-counts" data-sketch-counts></span>
      <span class="sketch-ws-spacer"></span>
      <span class="sketch-ws-zoom" data-sketch-zoom-wrap>
        <button type="button" class="sketch-ws-zoom-button" data-sketch-zoom-out
            title="Zoom out" aria-label="Zoom out">&minus;</button>
        <button type="button" class="sketch-ws-zoom-value" data-sketch-zoom
            title="Fit to content" aria-label="Zoom level - click to fit"></button>
        <button type="button" class="sketch-ws-zoom-button" data-sketch-zoom-in
            title="Zoom in" aria-label="Zoom in">+</button>
      </span>
      <span class="sketch-ws-hint" data-sketch-hint></span>
      <button type="button" class="sketch-ws-button" data-sketch-close>Cancel</button>
      <button type="button" class="sketch-ws-button is-primary" data-sketch-place>
        Place Sketch
      </button>
    </footer>
  </div>
  `;
}

export default {
  sketchWorkspaceMarkup,
  section,
  numberField,
  textField,
  checkbox,
  selectField,
};
