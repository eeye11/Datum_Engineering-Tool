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
 *     HEADER     title, undo/redo, maximise, close
 *     TOOLBAR    Select, Draw, Add Point, Erase, auto-correct
 *     BODY       the canvas (dominant) and the properties sidebar
 *     FOOTER     status, counts, zoom, Cancel, Place Sketch
 *
 * ONE SIDEBAR, FIVE SECTIONS - NOT FIVE TABS.
 *
 * The sidebar used to be four tabs, and a tab is a page: switching one replaced
 * everything, so a student who wanted to change a colour and then a bound had
 * to leave and come back. The sections are now EXPANDABLE BLOCKS in one
 * scrolling column, so the controls a student needs are all in the same place
 * and the ones they do not need are folded away.
 *
 * The sections are ordered by how often they are used: Geometry first (what is
 * in the sketch), then Correction, then the view settings, then Appearance.
 *
 * NO CONSTRUCTION METHOD. There is no Point-guided / Freehand / Point-by-point
 * / Coordinate-entry choice, because there is nothing to choose: the student
 * draws, and DAETUM reconstructs. A method selector asked them to describe how
 * they were about to work before they had done any of it.
 *
 * NO SHAPE GUIDE. The stroke is the guide.
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
};

function iconButton({ action, icon, label, title, pressed = null }) {
  const pressedAttr =
    pressed === null ? "" : ` aria-pressed="${pressed ? "true" : "false"}"`;

  return `<button type="button" class="sketch-tool"
      data-sketch-${action}${pressedAttr}
      title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
      <svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[icon] || ""}</svg>
      <span class="sketch-tool-text">${escapeHtml(label)}</span>
    </button>`;
}

/* A collapsible block. `open` controls the initial state. */
export function section({ key, title, open = true, body, badge = "", hidden = false }) {
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
 * SECTION 1 - GEOMETRY (contextual)
 * ======================================================== */

function geometryBody() {
  return `
    <p class="sketch-note" data-sketch-empty-hint>
      Draw on the canvas to begin. DAETUM recognises lines, curves, circles,
      arcs and closed shapes as you draw.
    </p>

    <div class="sketch-geometry-list" data-sketch-geometry-list
        role="list" aria-label="Geometry"></div>

    <div class="sketch-points" data-sketch-points role="list" aria-label="Points"></div>

    <div data-sketch-selection-properties></div>
  `;
}

/* ========================================================
 * SECTION 2 - CORRECTION
 * ======================================================== */

function correctionBody() {
  return `
    <div data-sketch-correction-context></div>

    <div class="sketch-checks">
      ${checkbox("preserveEndpoints", "Preserve endpoints", { checked: true })}
      ${checkbox("preserveCorners", "Preserve corners", { checked: true })}
      ${checkbox("showOriginal", "Show original stroke", { checked: true })}
    </div>

    <div class="sketch-inline-actions">
      <button type="button" class="sketch-mini" data-sketch-restore-original>
        Restore original stroke
      </button>
    </div>

    <div class="sketch-constraint-report" data-sketch-constraint-report></div>
  `;
}

/* ========================================================
 * SECTION 3 - COORDINATE VIEW
 * ======================================================== */

function coordinateViewBody() {
  return `
    <div class="sketch-checks">
      ${checkbox("autoBounds", "Automatic bounds", { checked: true })}
      ${checkbox("equalScale", "Equal X / Y scale", {
        checked: true,
        title: "Keeps circles circular and angles true",
      })}
    </div>

    <div class="sketch-field-grid">
      ${numberField("xMin", "X min")}
      ${numberField("xMax", "X max")}
      ${numberField("yMin", "Y min")}
      ${numberField("yMax", "Y max")}
    </div>

    <div class="sketch-inline-actions">
      <button type="button" class="sketch-mini" data-sketch-fit-bounds>Fit to content</button>
    </div>

    <p class="sketch-note">
      Geometry is stored in sketch coordinates; resizing the view never changes
      a stored point.
    </p>
  `;
}

/* ========================================================
 * SECTION 4 - AXES & GRID
 * ======================================================== */

function axesGridBody() {
  return `
    <div class="sketch-checks">
      ${checkbox("showXAxis", "X axis", { checked: true })}
      ${checkbox("showYAxis", "Y axis", { checked: true })}
      ${checkbox("showAxisLabels", "Axis labels", { checked: true })}
      ${checkbox("showOrigin", "Origin", { checked: true })}
      ${checkbox("showMajorGrid", "Major grid", { checked: true })}
      ${checkbox("showMinorGrid", "Minor grid")}
      ${checkbox("showTickLabels", "Numeric tick labels")}
      ${checkbox("snapToGrid", "Snap to grid", { checked: true })}
      ${checkbox("snapToGridMidpoints", "Snap to grid midpoints", {
        checked: true,
        title: "Halfway between grid lines, and the centre of a cell",
      })}
      ${checkbox("snapToPoints", "Snap to points", { checked: true })}
    </div>

    <details class="sketch-advanced">
      <summary>Axis labels and tick intervals</summary>

      <div class="sketch-field-grid">
        <label class="sketch-field">
          <span class="sketch-field-label">X label</span>
          <input type="text" data-sketch-axis-label="x" value="x" aria-label="X axis label" maxlength="6">
        </label>
        <label class="sketch-field">
          <span class="sketch-field-label">Y label</span>
          <input type="text" data-sketch-axis-label="y" value="y" aria-label="Y axis label" maxlength="6">
        </label>
      </div>

      <div class="sketch-field-grid">
        ${numberField("majorX", "Major X", { step: "any" })}
        ${numberField("majorY", "Major Y", { step: "any" })}
        ${numberField("minorDivisions", "Minor per major", { step: "1" })}
        ${numberField("labelPrecision", "Precision", { step: "1" })}
        ${numberField("snapTolerancePx", "Snap tolerance (px)", { step: "1" })}
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

      <div class="sketch-checks">
        ${checkbox("showTicks", "Show tick marks", { checked: true })}
      </div>
    </details>

    <details class="sketch-advanced">
      <summary>Include in placed sketch</summary>

      <p class="sketch-note">
        The working grid is not part of the drawing unless you include it.
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
 * SECTION 5 - APPEARANCE
 * ======================================================== */

function appearanceBody() {
  return `<div data-sketch-appearance></div>`;
}

/* ========================================================
 * THE WORKSPACE
 * ======================================================== */

export function sketchWorkspaceMarkup(options = {}) {
  const title = escapeHtml(options.title || "Sketch Editor");

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
        ${iconButton({ action: "fit", icon: "fit", label: "Fit", title: "Fit the view to the content" })}
        ${iconButton({ action: "maximise", icon: "maximise", label: "Maximise", title: "Maximise or minimize the preview", pressed: false })}
        <button type="button" class="sketch-ws-close" data-sketch-cancel
            aria-label="Close the sketch editor" title="Close">&times;</button>
      </div>
    </header>

    <div class="sketch-ws-toolbar" role="toolbar" aria-label="Sketch tools">
      <div class="sketch-tool-group" role="group" aria-label="Drawing tools">
        ${iconButton({ action: "tool-select", icon: "select", label: "Select", title: "Select and move geometry and points (S)" })}
        ${iconButton({ action: "tool-draw", icon: "draw", label: "Draw", title: "Draw freely - DAETUM recognises the shape (D)" })}
        ${iconButton({ action: "tool-point", icon: "point", label: "Add Point", title: "Add an exact point, or place one on geometry (A)" })}
        ${iconButton({ action: "tool-erase", icon: "erase", label: "Erase", title: "Erase the selected geometry (E)" })}
      </div>

      <span class="sketch-tool-spacer"></span>

      <label class="sketch-auto-toggle" title="Automatically recognise and reconstruct what you draw">
        <input type="checkbox" data-sketch-auto-correct checked>
        <span class="sketch-auto-dot" aria-hidden="true"></span>
        <span class="sketch-auto-text">Auto-correct</span>
      </label>
    </div>

    <div class="sketch-ws-body" data-sketch-body>
      <div class="sketch-ws-canvas" data-sketch-canvas-cell>
        <svg class="sketch-ws-svg" data-sketch-svg preserveAspectRatio="none"
            role="application" aria-label="Sketch drawing canvas"></svg>
      </div>

      <div class="sketch-ws-divider" data-sketch-divider role="separator"
          aria-orientation="vertical" aria-label="Resize the properties panel"
          tabindex="0"></div>

      <aside class="sketch-ws-sidebar" data-sketch-sidebar aria-label="Sketch properties">
        <div class="sketch-ws-sidebar-head">
          <span class="sketch-ws-sidebar-title">Properties</span>
          <button type="button" class="sketch-ws-collapse" data-sketch-collapse
              title="Collapse the properties panel" aria-label="Collapse the properties panel">
            <span aria-hidden="true">&rsaquo;</span>
          </button>
        </div>

        <div class="sketch-ws-scroll" data-sketch-scroll>
          ${section({ key: "geometry", title: "Geometry", body: geometryBody() })}
          ${section({ key: "correction", title: "Correction", open: false, body: correctionBody() })}
          ${section({ key: "coordinates", title: "Coordinate view", open: false, body: coordinateViewBody() })}
          ${section({ key: "axes", title: "Axes & Grid", open: false, body: axesGridBody() })}
          ${section({ key: "appearance", title: "Appearance", open: false, body: appearanceBody() })}
        </div>
      </aside>
    </div>

    <footer class="sketch-ws-footer">
      <span class="sketch-ws-status" data-sketch-status>Ready</span>
      <span class="sketch-ws-counts" data-sketch-counts></span>
      <span class="sketch-ws-zoom">
        <button type="button" class="sketch-ws-zoom-button" data-sketch-zoom-out
            title="Zoom out" aria-label="Zoom out">&minus;</button>
        <button type="button" class="sketch-ws-zoom-value" data-sketch-zoom
            title="Fit to content" aria-label="Zoom level - click to fit"></button>
        <button type="button" class="sketch-ws-zoom-button" data-sketch-zoom-in
            title="Zoom in" aria-label="Zoom in">+</button>
      </span>
      <span class="sketch-ws-spacer"></span>
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
  checkbox,
  selectField,
};
