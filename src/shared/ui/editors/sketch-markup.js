/*
 * ========================================================
 * THE GRAPH SKETCH EDITOR'S MARKUP
 * ========================================================
 *
 * The structure of the Graph - Sketch working space, as one string. It lives in
 * its own module so the editor's behaviour file is about behaviour: a layout of
 * this size inlined among the pointer handling is a layout nobody reads.
 *
 * THE SHAPE OF THE LAYOUT
 * -----------------------
 *
 *     HEADER     one compact row: title, instruction, close
 *     TOOLBAR    one compact row of icon tools: Draw, Point, Erase, moves,
 *                Undo, Redo, Fit, view selector, Inspector toggle
 *     BODY       the canvas, dominant, and a collapsible inspector beside it
 *     FOOTER     status, coordinate readout, hint, Cancel, Apply
 *
 * Why not the old arrangement: the old editor was a header, a toolbar of two
 * wide text buttons, a full-width canvas and a footer, with no settings and no
 * point control at all. The graph it drew was a FIXED 900x520 viewBox shrunk to
 * whatever was left, so a large window still produced a small graph and a lot of
 * empty box. Nothing here has a fixed drawing size: the canvas is an SVG that
 * fills its cell, and every coordinate comes from the canvas's real box.
 *
 * NO GEOMETRY-TYPE CONTROL. There is no Straight Line or Curved Line button
 * anywhere: the correction decides, and its decision is shown as a word so the
 * student can reject it - see "Correction" in the inspector.
 */

const ICONS = {
  draw: '<path d="M3 17l1.2-4.2L14.6 2.4a1.6 1.6 0 0 1 2.2 0l1.2 1.2a1.6 1.6 0 0 1 0 2.2L7.6 16.2 3 17z"/>',
  point:
    '<circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/>',
  erase:
    '<path d="M4.5 15.5l-2-2a1.2 1.2 0 0 1 0-1.7l7.6-7.6a1.2 1.2 0 0 1 1.7 0l3.4 3.4a1.2 1.2 0 0 1 0 1.7L9.5 15.5zM8 6.5l5.5 5.5M4.5 15.5H17"/>',
  undo: '<path d="M6.5 5.5L3 9l3.5 3.5"/><path d="M3 9h8.5a4.5 4.5 0 1 1 0 9H9"/>',
  redo: '<path d="M13.5 5.5L17 9l-3.5 3.5"/><path d="M17 9H8.5a4.5 4.5 0 1 0 0 9H11"/>',
  fit: '<path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 17H3v-3"/><path d="M6.5 10h7"/>',
  select:
    '<path d="M5 3l10 7-4.2 1.1L8.3 16z"/>',
  inspector:
    '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12 4v12"/>',
};

/* A toolbar icon button. */
function iconButton({
  action,
  icon,
  label,
  title,
  pressed = null,
}) {
  const pressedAttr =
    pressed === null ? "" : ` aria-pressed="${pressed ? "true" : "false"}"`;

  /*
   * THE ACTION IS THE ATTRIBUTE, so a caller finds a tool by the name it gave
   * it. A tool that also holds a state carries `aria-pressed` rather than a
   * second, parallel data attribute - one name per control.
   */
  return `<button type="button" class="sketch-tool" data-sketch-${action}${
    pressedAttr
  } title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
      <svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[icon] || ""}</svg>
      <span class="sketch-tool-text">${label}</span>
    </button>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* A number input in the inspector. */
function field(key, label, { step = "any", min = null, title = "" } = {}) {
  return `<label class="sketch-field" title="${escapeHtml(title || label)}">
        <span class="sketch-field-label">${escapeHtml(label)}</span>
        <input type="number" inputmode="decimal" step="${step}"${
          min === null ? "" : ` min="${min}"`
        } data-sketch-field="${key}" aria-label="${escapeHtml(label)}">
    </label>`;
}

function toggle(key, label, title = "") {
  return `<label class="sketch-toggle" title="${escapeHtml(title || label)}">
        <input type="checkbox" data-sketch-toggle-setting="${key}">
        <span>${escapeHtml(label)}</span>
    </label>`;
}

/* A score. `selected` is the entry: "file" | "corrected" | "overlay". */
function viewOption({ value, label, title, selected }) {
  return `<button type="button" class="sketch-view-option${
    selected ? " active" : ""
  }" data-sketch-view="${value}" aria-pressed="${
    selected ? "true" : "false"
  }" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
}

/*
 * Build the editor's markup.
 *
 * `title` and `instruction` are the editor's own; everything else is structure.
 * There is no viewBox here: the canvas is sized by its cell, and the editor
 * reads that cell on every draw.
 */
export function sketchEditorMarkup(options = {}) {
  const title = escapeHtml(options.title || "Sketch");
  const instruction = escapeHtml(options.instruction || "");
  const view = ["original", "corrected", "overlay"].includes(options.view)
    ? options.view
    : "corrected";

  return `
    <div class="sketch-app" data-sketch-app>
        <header class="sketch-app-header">
            <div class="sketch-app-heading">
                <span class="sketch-app-title">${title}</span>
                <span class="sketch-app-instruction" data-sketch-instruction>${instruction}</span>
            </div>

            <div class="sketch-app-actions">
                <button type="button" class="sketch-ghost" data-sketch-cancel>Cancel</button>
                <button type="button" class="sketch-primary" data-sketch-apply>Apply</button>
                <button type="button" class="sketch-close" data-sketch-cancel
                    aria-label="Close the sketch editor" title="Close">&times;</button>
            </div>
        </header>

        <div class="sketch-app-toolbar" role="toolbar" aria-label="Sketch tools">
            <div class="sketch-tool-group" role="group" aria-label="Drawing tools">
                ${iconButton({ action: "tool-draw", icon: "draw", label: "Draw", title: "Draw a line or a curve (D)" })}
                ${iconButton({ action: "tool-point", icon: "point", label: "Point", title: "Place a point at an exact coordinate (P)" })}
                ${iconButton({ action: "tool-erase", icon: "erase", label: "Erase", title: "Erase part of a stroke (E)" })}
                ${iconButton({ action: "tool-select", icon: "select", label: "Move", title: "Select and move your own points (S)" })}
            </div>

            <span class="sketch-tool-divider" aria-hidden="true"></span>

            <div class="sketch-tool-group" role="group" aria-label="History">
                ${iconButton({ action: "undo", icon: "undo", label: "Undo", title: "Undo the last change", pressed: false })}
                ${iconButton({ action: "redo", icon: "redo", label: "Redo", title: "Redo the last undone change", pressed: false })}
            </div>

            <span class="sketch-tool-divider" aria-hidden="true"></span>

            <div class="sketch-tool-group" role="group" aria-label="View">
                <div class="sketch-view" role="group" aria-label="Preview view">
                    ${viewOption({ value: "original", label: "Original", title: "What you drew, unchanged", selected: view === "original" })}
                    ${viewOption({ value: "corrected", label: "Corrected", title: "The standardized geometry Apply will commit", selected: view === "corrected" })}
                    ${viewOption({ value: "overlay", label: "Overlay", title: "The correction over your own strokes", selected: view === "overlay" })}
                </div>
            </div>

            <span class="sketch-tool-spacer"></span>

            ${iconButton({ action: "fit", icon: "fit", label: "Fit", title: "Fit the graph to the canvas" })}
            ${iconButton({ action: "inspector", icon: "inspector", label: "Inspector", title: "Show or hide the inspector", pressed: true })}
        </div>

        <div class="sketch-app-body" data-sketch-body>
            <div class="sketch-stage" data-sketch-stage>
                <div class="sketch-canvas" data-sketch-canvas>
                    <svg class="sketch-canvas-svg" data-sketch-svg
                        preserveAspectRatio="none"
                        role="application"
                        aria-label="Sketch drawing canvas"></svg>
                </div>
            </div>

            <aside class="sketch-inspector" data-sketch-inspector aria-label="Sketch inspector">
                <div class="sketch-inspector-scroll">
                    <section class="sketch-section">
                        <div class="sketch-section-head">
                            <span class="sketch-section-title">Points</span>
                            <span class="sketch-section-count" data-sketch-point-count>0</span>
                        </div>

                        <div class="sketch-points" data-sketch-points
                            role="list" aria-label="Your points"></div>

                        <div class="sketch-point-controls">
                            <button type="button" class="sketch-mini" data-sketch-point-add
                                title="Add a point">+ Add point</button>
                            <button type="button" class="sketch-mini" data-sketch-point-remove
                                title="Delete the selected point">Delete</button>
                            <button type="button" class="sketch-mini" data-sketch-point-up
                                title="Move the point earlier in the path">&#8593;</button>
                            <button type="button" class="sketch-mini" data-sketch-point-down
                                title="Move the point later in the path">&#8595;</button>
                        </div>

                        <div class="sketch-selected" data-sketch-selected>
                            <span class="sketch-selected-title">Selected point</span>
                            <div class="sketch-selected-fields">
                                <label class="sketch-field sketch-field-inline">
                                    <span class="sketch-field-label">x</span>
                                    <input type="number" inputmode="decimal" step="any"
                                        data-sketch-selected-field="x" aria-label="Selected point X">
                                </label>
                                <label class="sketch-field sketch-field-inline">
                                    <span class="sketch-field-label">y</span>
                                    <input type="number" inputmode="decimal" step="any"
                                        data-sketch-selected-field="y" aria-label="Selected point Y">
                                </label>
                            </div>
                        </div>
                    </section>

                    <section class="sketch-section">
                        <div class="sketch-section-head">
                            <span class="sketch-section-title">Correction</span>
                            <span class="sketch-section-count" data-sketch-correction-summary title="Strokes straightened / smoothed"></span>
                        </div>

                        <label class="sketch-field">
                            <span class="sketch-field-label">Smoothing</span>
                            <select data-sketch-strength aria-label="Correction strength">
                                <option value="off">Off - keep every sample</option>
                                <option value="light">Light</option>
                                <option value="medium" selected>Medium</option>
                                <option value="strong">Strong</option>
                            </select>
                        </label>

                        <div class="sketch-toggles">
                            ${toggle("straighten", "Straighten near-axes", "Snap nearly horizontal and vertical strokes to exactly so")}
                            ${toggle("showTrace", "Show my strokes", "Draw the original stroke behind the correction")}
                        </div>
                    </section>

                    <section class="sketch-section">
                        <div class="sketch-section-head">
                            <span class="sketch-section-title">Bounds</span>
                            <span class="sketch-bounds-mode" data-sketch-bounds-mode-label>Automatic</span>
                        </div>

                        <div class="sketch-bounds" role="group" aria-label="Coordinate bounds mode">
                            <button type="button" class="sketch-view-option active"
                                data-sketch-bounds-mode="auto" aria-pressed="true"
                                title="Calculate the range from your geometry">Automatic</button>
                            <button type="button" class="sketch-view-option"
                                data-sketch-bounds-mode="manual" aria-pressed="false"
                                title="Use the four numbers below as the coordinate space">Manual</button>
                        </div>

                        <div class="sketch-grid-fields">
                            ${field("xMin", "x min")}
                            ${field("xMax", "x max")}
                            ${field("yMin", "y min")}
                            ${field("yMax", "y max")}
                        </div>

                        <p class="sketch-bounds-note" data-sketch-bounds-note>
                            The whole canvas is the coordinate space.
                        </p>
                    </section>

                    <section class="sketch-section">
                        <div class="sketch-section-head">
                            <span class="sketch-section-title">Grid and axes</span>
                        </div>

                        <div class="sketch-grid-fields">
                            ${field("xTickSpacing", "x step", { step: "any", min: "0", title: "Grid and tick spacing on x" })}
                            ${field("yTickSpacing", "y step", { step: "any", min: "0", title: "Grid and tick spacing on y" })}
                        </div>

                        <div class="sketch-toggles">
                            ${toggle("showGrid", "Grid")}
                            ${toggle("showXAxis", "X axis")}
                            ${toggle("showYAxis", "Y axis")}
                            ${toggle("equalUnits", "Equal units", "One unit is the same length on both axes")}
                            ${toggle("snap", "Snap to grid", "Placed and dragged points land on the grid")}
                        </div>
                    </section>
                </div>
            </aside>
        </div>

        <footer class="sketch-app-footer">
            <span class="sketch-readout" data-sketch-coordinates>x -, y -</span>
            <span class="sketch-status" data-sketch-status></span>
            <span class="sketch-hint" data-sketch-hint></span>
        </footer>
    </div>
`;
}

export const SKETCH_EDITOR_VIEWS = Object.freeze([
  "original",
  "corrected",
  "overlay",
]);

export default {
  sketchEditorMarkup,
  SKETCH_EDITOR_VIEWS,
};
