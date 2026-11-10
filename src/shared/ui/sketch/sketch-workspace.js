/*
 * ========================================================
 * THE SKETCH WORKSPACE - BEHAVIOUR
 * ========================================================
 *
 * The one editor every sketch tool opens. It owns the INTERACTION - pointer,
 * tools, selection, the sidebar - and delegates every piece of mathematics to
 * the shared modules:
 *
 *     sketch-points.js       what a point is, and how it resolves
 *     sketch-viewport.js     model <-> screen, equal scale
 *     sketch-grid.js         axes, ticks, grid, snapping
 *     sketch-correction.js   recognition and reconstruction
 *     sketch-document.js     the one geometry model
 *     sketch-history.js      undo and redo
 *     sketch-render.js       the one painter
 *     sketch-placement.js    the transform into the drawing
 *     sketch-source.js       the source, from the same model
 *
 * Nothing here re-implements any of that.
 *
 * THE LAYERS
 * ----------
 * The canvas is three SVG groups, in this order:
 *
 *     grid      axes, ticks, grid lines        (a VIEW, not geometry)
 *     geometry  the student's elements         (the drawing)
 *     aids      markers, handles, previews     (the EDITOR's, never exported)
 *
 * The separation is what makes "editing aids must not appear in the final
 * drawing" structural: placement reads the document, and the aids are not in
 * the document.
 *
 * THE SIDEBAR IS CONTEXTUAL
 * -------------------------
 * It shows what the selection needs and nothing else. With nothing selected it
 * is a short instruction and the geometry list; with a point selected it is that
 * point's coordinates; with a circle selected it is its centre and radius. The
 * view settings are always there, folded away, because they are not about the
 * selection.
 */

import {
  sketchWorkspaceMarkup,
  section,
  numberField,
  checkbox,
  selectField,
} from "./sketch-workspace-markup.js";
import {
  makePoint,
  resolvePoints,
  resolvePoint,
  nextPointName,
  numberText,
  withAbsolutePosition,
} from "../../sketch/sketch-points.js";
import {
  createViewport,
  toScreen as viewportToScreen,
  toModel as viewportToModel,
  boundsOfPoints,
  withOriginInView,
} from "../../sketch/sketch-viewport.js";
import {
  normaliseGrid,
  gridValues,
  gridIntervalFor,
  minorSpacing,
  formatTick,
  snapPoint as snapToGrid,
  gridRenderable,
} from "../../sketch/sketch-grid.js";
import {
  correctStroke,
  restoreOriginal,
} from "../../sketch/sketch-correction.js";
import {
  createSketchDocument,
  addGeometry,
  updateGeometry,
  removeGeometry,
  resetGeometryAppearance,
  setAppearanceForMany,
  setGeometryVisible,
  renameGeometry,
  addPoint,
  updatePoint,
  setPointCoordinateMode,
  movePoint,
  setPointLocked,
  setBounds,
  setGrid,
  makeGeometry,
} from "../../sketch/sketch-document.js";
import { createHistory, commit, undo, redo, canUndo, canRedo } from "../../sketch/sketch-history.js";
import { renderGeometry } from "../../sketch/sketch-render.js";
import {
  LINE_STYLES,
  THICKNESSES,
  normaliseAppearance,
  supportsFill,
} from "../../sketch/sketch-appearance.js";
import { adapterFor, pointOnGeometry } from "../../sketch/sketch-geometry-adapters.js";
import { generateSource } from "../../sketch/sketch-source.js";
import { parseSource, applyParsedSource } from "../../sketch/sketch-source-parser.js";
import { alignTransform, placementPackage } from "../../sketch/sketch-placement.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/* How close, in pixels, a click must be to grab a point or a curve. */
const GRAB_PX = 10;

/* The sidebar's width limits, in pixels. */
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 330;

let openWorkspace = null;

function createSvg(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      element.setAttribute(key, String(value));
    }
  });

  return element;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ========================================================
 * THE WORKSPACE
 * ======================================================== */

export function openSketchWorkspace(options = {}) {
  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  closeWorkspace();

  const dialog = document.createElement("div");

  dialog.className = "sketch-ws-overlay";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", options.title || "Sketch Editor");
  dialog.innerHTML = sketchWorkspaceMarkup(options);

  document.body.appendChild(dialog);

  const $ = (selector) => dialog.querySelector(selector);
  const $$ = (selector) => [...dialog.querySelectorAll(selector)];

  const svg = $("[data-sketch-svg]");
  const canvasCell = $("[data-sketch-canvas-cell]");
  const sidebar = $("[data-sketch-sidebar]");
  const divider = $("[data-sketch-divider]");

  /* ---- state ---- */
  let document_ = options.document || createSketchDocument(options.initial || {});
  let history = createHistory(document_);

  let tool = "draw";
  let selectedPointId = null;
  let selectedGeometryIds = [];
  let drag = null;
  let stroke = null;
  let sidebarWidth = SIDEBAR_DEFAULT;
  let sidebarCollapsed = false;
  let maximised = false;
  let autoCorrect = true;
  let correctionOptions = {
    preserveEndpoints: true,
    preserveCorners: true,
    showOriginal: true,
  };
  let lastCorrection = null;
  let placement = null;
  let snapIndicator = null;
  let closed = false;

  /* ---- the viewport ---- */
  function canvasSize() {
    const rect = canvasCell.getBoundingClientRect();

    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }

  function currentViewport() {
    const size = canvasSize();

    return createViewport({
      bounds: document_.bounds,
      width: size.width,
      height: size.height,
      equal: document_.grid.equalScale !== false,
      padding: 8,
    });
  }

  function toModel(pixel) {
    return viewportToModel(pixel, currentViewport());
  }

  /* ========================================================
   * MODEL CHANGES
   * ======================================================== */

  /*
   * EVERY MODEL CHANGE GOES THROUGH HERE.
   *
   * One place that commits to the history, refreshes the views and updates the
   * source - so a change made by a drag, a field or an undo cannot leave one of
   * them behind. That is the synchronisation rule, implemented once.
   */
  function apply(next, { record = true, refit = true } = {}) {
    if (!next || next === document_) {
      return;
    }

    document_ = next;

    /*
     * AUTOMATIC BOUNDS ARE RECALCULATED ON EVERY CHANGE.
     *
     * A point typed outside the current view, a stroke drawn past the edge, a
     * shape deleted - each changes what the sketch actually occupies, so the
     * view follows it. This is skipped only when the change IS a bounds change,
     * which would otherwise fight itself.
     */
    if (refit) {
      document_ = refitAutomaticBounds();
    }

    if (record) {
      history = commit(history, document_);
    }

    render();
  }

  function undoStep() {
    const result = undo(history);

    history = result.history;
    document_ = result.document;
    render();
  }

  function redoStep() {
    const result = redo(history);

    history = result.history;
    document_ = result.document;
    render();
  }

  /* ========================================================
   * RENDERING
   * ======================================================== */

  function render() {
    if (closed) {
      return;
    }

    renderCanvas();
    renderGeometryList();
    renderSelectionProperties();
    renderCorrection();
    renderAppearance();
    renderViewSettings();
    renderStatus();
    renderControls();
  }

  function renderCanvas() {
    const viewport = currentViewport();

    svg.textContent = "";
    svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);

    const gridLayer = createSvg("g", { class: "sketch-layer-grid" });
    const geometryLayer = createSvg("g", { class: "sketch-layer-geometry" });
    const aidLayer = createSvg("g", { class: "sketch-layer-aids" });

    drawGrid(gridLayer, viewport);

    geometryLayer.appendChild(
      renderGeometry(document_.geometry, {
        toScreen: (point) => viewportToScreen(point, viewport),
        modelScale: viewport.scale,
        themeInk: themeInk(),
      }),
    );

    drawAids(aidLayer, viewport);

    svg.append(gridLayer, geometryLayer, aidLayer);
  }

  function themeInk() {
    const value = getComputedStyle(dialog).getPropertyValue("--datum-ink").trim();

    return value || "#000000";
  }

  /* ---- the grid: a VIEW, drawn from the settings ---- */
  function drawGrid(layer, viewport) {
    const grid = normaliseGrid(document_.grid);
    const visible = viewport.visible;

    /*
     * THE DRAWN GRID AND THE SNAPPED GRID ARE THE SAME GRID.
     *
     * Both read their interval from `gridIntervalFor`, so a line the student
     * can see is a line they can snap to. Deriving them separately is how a
     * visible grid and an invisible snapping lattice drift apart.
     */
    const interval = gridIntervalFor(grid, visible);

    const renderable = gridRenderable({ ...grid, majorX: interval.x, majorY: interval.y }, viewport);

    const line = (from, to, className, dash) => {
      const a = viewportToScreen(from, viewport);
      const b = viewportToScreen(to, viewport);

      layer.appendChild(
        createSvg("line", {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          class: className,
          "stroke-dasharray": dash,
          "vector-effect": "non-scaling-stroke",
        }),
      );
    };

    if (grid.showMinorGrid && renderable.minor) {
      const minor = minorSpacing(grid);

      gridValues(visible.xMin, visible.xMax, minor.x).forEach((value) => {
        line({ x: value, y: visible.yMin }, { x: value, y: visible.yMax }, "sketch-grid-minor", "1 3");
      });

      gridValues(visible.yMin, visible.yMax, minor.y).forEach((value) => {
        line({ x: visible.xMin, y: value }, { x: visible.xMax, y: value }, "sketch-grid-minor", "1 3");
      });
    }

    if (grid.showMajorGrid && renderable.major) {
      gridValues(visible.xMin, visible.xMax, interval.x).forEach((value) => {
        line({ x: value, y: visible.yMin }, { x: value, y: visible.yMax }, "sketch-grid-major", null);
      });

      gridValues(visible.yMin, visible.yMax, interval.y).forEach((value) => {
        line({ x: visible.xMin, y: value }, { x: visible.xMax, y: value }, "sketch-grid-major", null);
      });
    }

    /* The axes, through zero, only when zero is in view. */
    if (grid.showXAxis && visible.yMin <= 0 && visible.yMax >= 0) {
      line({ x: visible.xMin, y: 0 }, { x: visible.xMax, y: 0 }, "sketch-axis-x", null);
    }

    if (grid.showYAxis && visible.xMin <= 0 && visible.xMax >= 0) {
      line({ x: 0, y: visible.yMin }, { x: 0, y: visible.yMax }, "sketch-axis-y", null);
    }

    if (grid.showTicks) {
      const length = grid.tickLengthPx;

      gridValues(visible.xMin, visible.xMax, interval.x).forEach((value) => {
        if (!grid.showXAxis) {
          return;
        }

        const at = viewportToScreen({ x: value, y: 0 }, viewport);

        layer.appendChild(
          createSvg("line", {
            x1: at.x,
            y1: at.y - length,
            x2: at.x,
            y2: at.y + length,
            class: "sketch-tick",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      });

      gridValues(visible.yMin, visible.yMax, interval.y).forEach((value) => {
        if (!grid.showYAxis) {
          return;
        }

        const at = viewportToScreen({ x: 0, y: value }, viewport);

        layer.appendChild(
          createSvg("line", {
            x1: at.x - length,
            y1: at.y,
            x2: at.x + length,
            y2: at.y,
            class: "sketch-tick",
            "vector-effect": "non-scaling-stroke",
          }),
        );
      });
    }

    /*
     * TICK LABELS ARE OFF BY DEFAULT, and are a separate setting from the grid:
     * a student may want the grid without a wall of numbers.
     */
    if (grid.showTickLabels) {
      gridValues(visible.xMin, visible.xMax, interval.x).forEach((value) => {
        if (value === 0 || !grid.showXAxis) {
          return;
        }

        const at = viewportToScreen({ x: value, y: 0 }, viewport);

        const label = createSvg("text", {
          x: at.x,
          y: at.y + 14,
          class: "sketch-tick-label",
          "text-anchor": "middle",
        });

        label.textContent = formatTick(value, grid);
        layer.appendChild(label);
      });

      gridValues(visible.yMin, visible.yMax, interval.y).forEach((value) => {
        if (value === 0 || !grid.showYAxis) {
          return;
        }

        const at = viewportToScreen({ x: 0, y: value }, viewport);

        const label = createSvg("text", {
          x: at.x - 8,
          y: at.y + 4,
          class: "sketch-tick-label",
          "text-anchor": "end",
        });

        label.textContent = formatTick(value, grid);
        layer.appendChild(label);
      });
    }
  }

  /* ---- the editing aids: markers, handles, previews ---- */
  function drawAids(layer, viewport) {
    const resolved = resolvePoints(document_.points);

    resolved.forEach((point) => {
      const at = viewportToScreen(point.absolute, viewport);
      const selected = point.id === selectedPointId;

      const group = createSvg("g", {
        class: `sketch-aid-point${selected ? " is-selected" : ""}${point.locked ? " is-locked" : ""}`,
        "data-sketch-aid-point": point.id,
        transform: `translate(${at.x} ${at.y})`,
      });

      group.appendChild(
        createSvg("circle", {
          r: selected ? 6 : 4.5,
          class: "sketch-aid-point-mark",
          "vector-effect": "non-scaling-stroke",
        }),
      );

      const label = createSvg("text", {
        x: 9,
        y: -8,
        class: "sketch-aid-point-label",
      });

      label.textContent = point.name || "";
      group.appendChild(label);

      layer.appendChild(group);
    });

    /*
     * THE SNAP INDICATOR.
     *
     * While the Add Point tool is armed, the place a click would land is shown
     * BEFORE the click: a small cross at the snapped coordinate, with a ring
     * that says which kind of place it is - a grid intersection, a midpoint, or
     * an existing point. Without it, snapping is invisible and a point that
     * jumps to a corner looks like a mistake.
     */
    if (snapIndicator) {
      const at = viewportToScreen(snapIndicator, viewport);

      const group = createSvg("g", {
        class: `sketch-aid-snap is-${snapIndicator.kind}`,
        transform: `translate(${at.x} ${at.y})`,
      });

      group.appendChild(
        createSvg("circle", {
          r: 7,
          class: "sketch-aid-snap-ring",
          "vector-effect": "non-scaling-stroke",
        }),
      );

      group.appendChild(
        createSvg("path", {
          d: "M -4 0 H 4 M 0 -4 V 4",
          class: "sketch-aid-snap-cross",
          "vector-effect": "non-scaling-stroke",
        }),
      );

      layer.appendChild(group);
    }

    /* The stroke in progress, as the student's ink. */
    if (stroke && stroke.points.length > 1) {
      const path = stroke.points
        .map((point, index) => {
          const at = viewportToScreen(point, viewport);

          return `${index ? "L" : "M"} ${at.x.toFixed(2)} ${at.y.toFixed(2)}`;
        })
        .join(" ");

      layer.appendChild(
        createSvg("path", {
          d: path,
          class: "sketch-aid-live-stroke",
          "vector-effect": "non-scaling-stroke",
        }),
      );
    }

    /* The placement preview, attached to the pointer. */
    if (placement) {
      const preview = placementPackage(document_, placement.transform, { include: {} });

      preview.geometry.forEach((element) => {
        const node = renderGeometry([element], {
          toScreen: (point) => viewportToScreen(point, viewport),
          modelScale: viewport.scale,
          themeInk: themeInk(),
        });

        node.setAttribute("class", "sketch-aid-placement-preview");
        layer.appendChild(node);
      });
    }
  }

  /* ========================================================
   * THE GEOMETRY SECTION
   * ======================================================== */

  function renderGeometryList() {
    const list = $("[data-sketch-geometry-list]");
    const points = $("[data-sketch-points]");
    const hint = $("[data-sketch-empty-hint]");

    if (!list) {
      return;
    }

    const hasContent = document_.geometry.length > 0 || document_.points.length > 0;

    if (hint) {
      hint.hidden = hasContent;
    }

    list.innerHTML = document_.geometry
      .map(
        (element) => `
        <div class="sketch-geometry-row${selectedGeometryIds.includes(element.id) ? " is-selected" : ""}"
            data-sketch-geometry-row="${element.id}" role="listitem">
          <button type="button" class="sketch-geometry-select" data-sketch-geometry-select="${element.id}">
            <span class="sketch-geometry-kind">${escapeHtml(element.kind)}</span>
            <span class="sketch-geometry-name">${escapeHtml(element.name || element.id)}</span>
          </button>
          <button type="button" class="sketch-geometry-eye" data-sketch-geometry-visible="${element.id}"
              title="${element.visible === false ? "Show" : "Hide"}"
              aria-label="${element.visible === false ? "Show" : "Hide"} ${escapeHtml(element.name || element.id)}">
            ${element.visible === false ? "&#9675;" : "&#9679;"}
          </button>
          <button type="button" class="sketch-geometry-delete" data-sketch-geometry-delete="${element.id}"
              title="Delete" aria-label="Delete ${escapeHtml(element.name || element.id)}">&times;</button>
        </div>`,
      )
      .join("");

    if (points) {
      points.innerHTML = resolvePoints(document_.points)
        .map(
          (point) => `
          <button type="button" class="sketch-point-row${point.id === selectedPointId ? " is-selected" : ""}"
              data-sketch-point-row="${point.id}" role="listitem">
            <span class="sketch-point-swatch" aria-hidden="true"></span>
            <span class="sketch-point-name">${escapeHtml(point.name || point.id)}</span>
            <span class="sketch-point-coords">${numberText(point.absolute.x)}, ${numberText(point.absolute.y)}</span>
            ${point.locked ? '<span class="sketch-point-lock" title="Locked">&#128274;</span>' : ""}
          </button>`,
        )
        .join("");
    }
  }

  /* ========================================================
   * THE CONTEXTUAL SELECTION PROPERTIES
   * ======================================================== */

  /*
   * WHAT THE SELECTION NEEDS, AND NOTHING ELSE.
   *
   * A point shows its coordinates; a circle shows its centre and radius; a line
   * shows its endpoints; a curve shows its representation and control points.
   * Showing every control for every selection is what made the old sidebar a
   * form to read rather than a panel to use.
   */
  function renderSelectionProperties() {
    const host = $("[data-sketch-selection-properties]");

    if (!host) {
      return;
    }

    const point = document_.points.find((entry) => entry.id === selectedPointId);

    if (point) {
      host.innerHTML = pointProperties(point);
      return;
    }

    const selected = document_.geometry.filter((element) =>
      selectedGeometryIds.includes(element.id),
    );

    if (!selected.length) {
      host.innerHTML = "";
      return;
    }

    if (selected.length > 1) {
      host.innerHTML = section({
        key: "multi",
        title: `${selected.length} elements selected`,
        body: `<p class="sketch-note">Appearance applies to all of them.</p>`,
      });

      return;
    }

    host.innerHTML = geometryProperties(selected[0]);
  }

  function pointProperties(point) {
    const resolved = resolvePoint(point, document_.points);

    const others = document_.points.filter((entry) => entry.id !== point.id);

    const referenceOptions = others
      .map(
        (entry) =>
          `<option value="${entry.id}"${entry.id === point.referenceId ? " selected" : ""}>${escapeHtml(entry.name || entry.id)}</option>`,
      )
      .join("");

    const mode = point.coordinateMode;

    const fields =
      mode === "absolute"
        ? `${numberField("x", "X", { value: numberText(point.x) })}
           ${numberField("y", "Y", { value: numberText(point.y) })}`
        : mode === "relative"
          ? `<label class="sketch-field">
               <span class="sketch-field-label">From</span>
               <select data-sketch-point-reference aria-label="Reference point">
                 <option value="">-</option>${referenceOptions}
               </select>
             </label>
             ${numberField("dx", "Δx", { value: numberText(point.delta?.dx ?? 0) })}
             ${numberField("dy", "Δy", { value: numberText(point.delta?.dy ?? 0) })}`
          : `<label class="sketch-field">
               <span class="sketch-field-label">From</span>
               <select data-sketch-point-reference aria-label="Reference point">
                 <option value="">-</option>${referenceOptions}
               </select>
             </label>
             ${numberField("distance", "Distance", { value: numberText(point.distance ?? 0) })}
             ${numberField("angleDeg", "Angle°", { value: numberText(point.angleDeg ?? 0) })}`;

    return section({
      key: "point",
      title: `Point ${escapeHtml(point.name || point.id)}`,
      body: `
        <label class="sketch-field">
          <span class="sketch-field-label">Name</span>
          <input type="text" data-sketch-point-name value="${escapeHtml(point.name || "")}"
              aria-label="Point name">
        </label>

        ${selectField(
          "coordinateMode",
          "Coordinates",
          [
            { value: "absolute", label: "Absolute" },
            { value: "relative", label: "Relative" },
            { value: "polar", label: "Polar" },
          ],
          { scope: "point-mode", value: mode },
        )}

        ${fields}

        <p class="sketch-note">Position: ${numberText(resolved.x)}, ${numberText(resolved.y)}</p>

        <div class="sketch-inline-actions">
          <label class="sketch-check">
            <input type="checkbox" data-sketch-point-locked${point.locked ? " checked" : ""}>
            <span>Lock position</span>
          </label>
          <button type="button" class="sketch-mini" data-sketch-point-delete>Delete point</button>
        </div>
      `,
    });
  }

  function geometryProperties(element) {
    const kind = element.kind;

    const rows = [];

    if (kind === "circle" && element.centre) {
      rows.push(
        numberField("centreX", "Centre X", { scope: "geometry", value: numberText(element.centre.x) }),
        numberField("centreY", "Centre Y", { scope: "geometry", value: numberText(element.centre.y) }),
        numberField("radius", "Radius", { scope: "geometry", value: numberText(element.radius) }),
      );
    } else if (kind === "ellipse" && element.centre) {
      rows.push(
        numberField("centreX", "Centre X", { scope: "geometry", value: numberText(element.centre.x) }),
        numberField("centreY", "Centre Y", { scope: "geometry", value: numberText(element.centre.y) }),
        numberField("radiusX", "Radius X", { scope: "geometry", value: numberText(element.radiusX) }),
        numberField("radiusY", "Radius Y", { scope: "geometry", value: numberText(element.radiusY) }),
      );
    } else if (kind === "arc" && element.centre) {
      rows.push(
        numberField("centreX", "Centre X", { scope: "geometry", value: numberText(element.centre.x) }),
        numberField("centreY", "Centre Y", { scope: "geometry", value: numberText(element.centre.y) }),
        numberField("radius", "Radius", { scope: "geometry", value: numberText(element.radius) }),
      );
    } else if (element.points?.length) {
      const first = element.points[0];
      const last = element.points[element.points.length - 1];

      rows.push(
        numberField("startX", "Start X", { scope: "geometry", value: numberText(first.x) }),
        numberField("startY", "Start Y", { scope: "geometry", value: numberText(first.y) }),
        numberField("endX", "End X", { scope: "geometry", value: numberText(last.x) }),
        numberField("endY", "End Y", { scope: "geometry", value: numberText(last.y) }),
      );
    }

    const representation =
      kind === "curve"
        ? `${element.points?.length || 0} control points, ${element.segments?.length || 0} Bézier segments`
        : kind === "polygon"
          ? `${element.points?.length || 0} sides`
          : kind === "composite"
            ? `segments: ${(element.correction?.parts || []).join(", ")}`
            : kind;

    return section({
      key: "element",
      title: escapeHtml(element.name || element.id),
      body: `
        <label class="sketch-field">
          <span class="sketch-field-label">Name</span>
          <input type="text" data-sketch-geometry-name="${element.id}"
              value="${escapeHtml(element.name || "")}" aria-label="Geometry name">
        </label>

        <p class="sketch-note">${escapeHtml(representation)}</p>

        ${rows.join("")}

        <div class="sketch-inline-actions">
          <button type="button" class="sketch-mini" data-sketch-geometry-delete="${element.id}">
            Delete
          </button>
        </div>
      `,
    });
  }

  /* ========================================================
   * THE CORRECTION SECTION
   * ======================================================== */

  function renderCorrection() {
    const context = $("[data-sketch-correction-context]");
    const report = $("[data-sketch-constraint-report]");

    if (context) {
      const selected = document_.geometry.find((element) =>
        selectedGeometryIds.includes(element.id),
      );

      const correction = selected?.correction || lastCorrection?.correction;

      context.innerHTML = correction
        ? `<p class="sketch-note">
             Detected: <strong>${escapeHtml(correction.kind)}</strong>${
               correction.parts?.length > 1
                 ? ` (${correction.parts.map(escapeHtml).join(" + ")})`
                 : ""
             }${correction.confidence ? ` · ${Math.round(correction.confidence * 100)}% fit` : ""}
           </p>`
        : `<p class="sketch-note">Draw a stroke to see what DAETUM recognises.</p>`;
    }

    if (report) {
      const conflict = lastCorrection?.conflict;

      report.innerHTML = conflict
        ? `<p class="sketch-conflict is-${conflict.severity}">${escapeHtml(conflict.message)}</p>`
        : "";
    }
  }

  /* ========================================================
   * THE APPEARANCE SECTION
   * ======================================================== */

  function renderAppearance() {
    const host = $("[data-sketch-appearance]");

    if (!host) {
      return;
    }

    const selected = document_.geometry.filter((element) =>
      selectedGeometryIds.includes(element.id),
    );

    if (!selected.length) {
      host.innerHTML = '<p class="sketch-note">Select geometry to change its appearance.</p>';
      return;
    }

    const appearance = normaliseAppearance(selected[0].appearance);
    const fillable = selected.some((element) => supportsFill(element));

    host.innerHTML = `
      <div class="sketch-field-grid">
        ${selectField(
          "lineStyle",
          "Line style",
          Object.entries(LINE_STYLES).map(([id, entry]) => ({ value: id, label: entry.label })),
          { scope: "appearance", value: appearance.lineStyle },
        )}
        ${selectField(
          "thickness",
          "Thickness",
          THICKNESSES.map((entry) => ({ value: entry.id, label: entry.label })),
          { scope: "appearance", value: appearance.thickness },
        )}
      </div>

      <label class="sketch-field">
        <span class="sketch-field-label">Outline</span>
        <input type="color" data-sketch-appearance="colour"
            value="${appearance.colour || "#000000"}" aria-label="Outline colour">
      </label>

      ${
        fillable
          ? `<div class="sketch-checks">
               ${checkbox("fillEnabled", "Fill", { scope: "appearance", checked: appearance.fillEnabled })}
             </div>
             <label class="sketch-field">
               <span class="sketch-field-label">Fill colour</span>
               <input type="color" data-sketch-appearance="fill"
                   value="${appearance.fill || "#999999"}" aria-label="Fill colour">
             </label>`
          : ""
      }

      <div class="sketch-inline-actions">
        <button type="button" class="sketch-mini" data-sketch-appearance-reset>
          Restore default appearance
        </button>
      </div>
    `;
  }

  /* ========================================================
   * THE VIEW SETTINGS
   * ======================================================== */

  function renderViewSettings() {
    const grid = normaliseGrid(document_.grid);

    const set = (key, value) => {
      const input = $(`[data-sketch-toggle="${key}"]`);

      if (input) {
        input.checked = Boolean(value);
      }
    };

    const setValue = (key, value) => {
      const input = $(`[data-sketch-field="${key}"]`);

      if (input && document.activeElement !== input) {
        input.value = value;
      }
    };

    const setSelect = (key, value) => {
      const input = $(`[data-sketch-select="${key}"]`);

      if (input) {
        input.value = value;
      }
    };

    set("showXAxis", grid.showXAxis);
    set("showYAxis", grid.showYAxis);
    set("showOrigin", grid.showOrigin);
    set("showMajorGrid", grid.showMajorGrid);
    set("showMinorGrid", grid.showMinorGrid);
    set("showTickLabels", grid.showTickLabels);
    set("showTicks", grid.showTicks);
    set("snapToGrid", grid.snapToGrid);
    set("snapToPoints", grid.snapToPoints);
    set("autoBounds", document_.boundsMode !== "manual");
    set("equalScale", grid.equalScale !== false);

    setValue("majorX", numberText(grid.majorX));
    setValue("majorY", numberText(grid.majorY));
    setValue("minorDivisions", String(grid.minorDivisions));
    setValue("labelPrecision", String(grid.labelPrecision));

    setSelect("tickDirection", grid.tickDirection);

    const bounds = document_.bounds;

    [
      ["xMin", bounds.xMin],
      ["xMax", bounds.xMax],
      ["yMin", bounds.yMin],
      ["yMax", bounds.yMax],
    ].forEach(([key, value]) => setValue(key, numberText(value)));
  }

  /* ========================================================
   * STATUS AND CONTROLS
   * ======================================================== */

  function renderStatus() {
    const status = $("[data-sketch-status]");
    const counts = $("[data-sketch-counts]");
    const zoom = $("[data-sketch-zoom]");

    const anchors = document_.points.length;

    if (status) {
      status.textContent = document_.geometry.length
        ? `${document_.geometry.length} element${document_.geometry.length === 1 ? "" : "s"}`
        : "Ready";
    }

    if (counts) {
      counts.textContent = `${anchors} point${anchors === 1 ? "" : "s"}`;
    }

    if (zoom) {
      const viewport = currentViewport();

      zoom.textContent = `${Math.round(viewport.scale * 100) / 100} px/unit`;
    }
  }

  function renderControls() {
    const undoButton = $("[data-sketch-undo]");
    const redoButton = $("[data-sketch-redo]");

    if (undoButton) {
      undoButton.disabled = !canUndo(history);
    }

    if (redoButton) {
      redoButton.disabled = !canRedo(history);
    }

    $$("[data-sketch-tool-select], [data-sketch-tool-draw], [data-sketch-tool-point], [data-sketch-tool-erase]").forEach(
      (button) => {
        const id = toolIdOf(button);

        if (!id) {
          return;
        }

        const active = id === tool;

        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      },
    );

    const auto = $("[data-sketch-auto-correct]");

    if (auto) {
      auto.checked = autoCorrect;
    }
  }

  function toolIdOf(button) {
    for (const attribute of button.attributes) {
      if (attribute.name.startsWith("data-sketch-tool-")) {
        return attribute.name.replace("data-sketch-tool-", "");
      }
    }

    return null;
  }

  /* ========================================================
   * POINTER
   * ======================================================== */

  function pointerModel(event) {
    const rect = svg.getBoundingClientRect();

    return toModel({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function nearestPoint(model) {
    const viewport = currentViewport();

    let best = null;

    resolvePoints(document_.points).forEach((point) => {
      const at = viewportToScreen(point.absolute, viewport);
      const here = viewportToScreen(model, viewport);

      const away = Math.hypot(at.x - here.x, at.y - here.y);

      if (away <= GRAB_PX && (!best || away < best.away)) {
        best = { point, away };
      }
    });

    return best?.point || null;
  }

  function nearestGeometry(model) {
    let best = null;

    document_.geometry.forEach((element) => {
      if (element.visible === false) {
        return;
      }

      const projected = adapterFor(element).project(model);

      if (!projected) {
        return;
      }

      if (!best || projected.distance < best.distance) {
        best = { element, ...projected };
      }
    });

    return best;
  }

  function snapped(model) {
    const grid = normaliseGrid(document_.grid);

    const hit = nearestGeometry(model);

    return snapToGrid(model, {
      grid,
      points: resolvePoints(document_.points),
      viewport: currentViewport(),
      geometryHit: hit && hit.distance * currentViewport().scale <= GRAB_PX ? hit : null,
    });
  }

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();
    svg.setPointerCapture?.(event.pointerId);

    const model = pointerModel(event);

    /* Placement mode: a click confirms the insertion. */
    if (placement) {
      confirmPlacement(model);
      return;
    }

    if (tool === "point") {
      const hit = nearestGeometry(model);

      /*
       * THE CLICK LANDS ON THE SNAPPED COORDINATE, NOT THE CURSOR.
       *
       * The indicator has been showing the student where the point would go, so
       * the point must go exactly there - the snapped value is the STORED
       * coordinate, not a display of one. When nothing is near enough to snap
       * to, the click lands where it was made.
       */
      const at = snapped(model);

      /*
       * A CLICK ON A CURVE PUTS THE POINT ON THE CURVE.
       *
       * The adapter projects the click onto its own mathematics, so the point
       * lands on the geometry rather than near it - and it works anywhere along
       * the curve, not only at its ends. Geometry wins over the grid, because
       * the student clicked the curve on purpose.
       */
      const point =
        hit && hit.distance * currentViewport().scale <= GRAB_PX
          ? pointOnGeometry(hit.element, model, {
              type: "anchor",
              name: nextPointName(document_.points),
            })
          : makePoint({
              type: "anchor",
              x: at.x,
              y: at.y,
              name: nextPointName(document_.points),
            });

      const result = addPoint(document_, {
        type: "anchor",
        x: point.x,
        y: point.y,
        name: point.name,
        geometryId: point.geometryId,
        parameter: point.parameter,
      });

      selectedPointId = result.point.id;
      selectedGeometryIds = [];
      apply(result.document);
      return;
    }

    if (tool === "select") {
      const point = nearestPoint(model);

      if (point) {
        selectedPointId = point.id;
        selectedGeometryIds = [];

        if (!point.locked) {
          drag = { kind: "point", id: point.id };
        }

        render();
        return;
      }

      const hit = nearestGeometry(model);

      if (hit && hit.distance * currentViewport().scale <= GRAB_PX) {
        selectedGeometryIds = event.shiftKey
          ? [...new Set([...selectedGeometryIds, hit.element.id])]
          : [hit.element.id];
        selectedPointId = null;
      } else {
        selectedGeometryIds = [];
        selectedPointId = null;
      }

      render();
      return;
    }

    if (tool === "erase") {
      const hit = nearestGeometry(model);

      if (hit && hit.distance * currentViewport().scale <= GRAB_PX) {
        apply(removeGeometry(document_, hit.element.id));
        selectedGeometryIds = selectedGeometryIds.filter((id) => id !== hit.element.id);
        render();
      }

      return;
    }

    /* Draw. */
    const start = snapped(model);

    stroke = { points: [{ x: start.x, y: start.y }] };
    drag = { kind: "stroke" };
    render();
  });

  svg.addEventListener("pointermove", (event) => {
    const model = pointerModel(event);

    /*
     * THE SNAP INDICATOR FOLLOWS THE CURSOR.
     *
     * It is shown only while the Add Point tool is armed, because that is the
     * only tool whose click lands on a snapped coordinate. It is recomputed on
     * every move, so it always names the candidate nearest the pointer - and it
     * disappears when the pointer is too far from any candidate, rather than
     * pretending a snap is available.
     */
    if (tool === "point" && !drag && !placement) {
      const at = snapped(model);

      snapIndicator = at.snapped ? { x: at.x, y: at.y, kind: at.kind } : null;
      renderCanvas();
    } else if (snapIndicator) {
      snapIndicator = null;
      renderCanvas();
    }

    if (placement) {
      placement = {
        ...placement,
        transform: alignTransform(placement.anchor, model, {
          rotation: placement.rotation,
          scale: placement.scale,
        }),
      };

      renderCanvas();
      return;
    }

    if (!drag) {
      return;
    }

    if (drag.kind === "point") {
      const point = document_.points.find((entry) => entry.id === drag.id);

      if (!point || point.locked) {
        return;
      }

      const at = snapped(model);

      apply(movePoint(document_, drag.id, at.x, at.y), { record: false });
      return;
    }

    if (drag.kind === "stroke" && stroke) {
      const at = snapped(model);
      const last = stroke.points[stroke.points.length - 1];

      if (Math.hypot(at.x - last.x, at.y - last.y) > 0.01) {
        stroke.points.push({ x: at.x, y: at.y });
        renderCanvas();
      }
    }
  });

  function endPointer(event) {
    if (svg.hasPointerCapture?.(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }

    if (drag?.kind === "point") {
      /* The drag is one history step, recorded when it ends. */
      history = commit(history, document_);
      drag = null;
      render();
      return;
    }

    if (drag?.kind === "stroke" && stroke) {
      finishStroke();
    }

    drag = null;
  }

  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  /*
   * FINISH A STROKE: reconstruct, then commit.
   *
   * The reconstruction runs through the SHARED solver, so the anchors the
   * student placed are honoured exactly and the stroke guides everything else -
   * the same behaviour every other sketch tool gets.
   */
  function finishStroke() {
    const points = stroke?.points || [];

    stroke = null;

    if (points.length < 2) {
      renderCanvas();
      return;
    }

    const corrected = autoCorrect
      ? correctStroke(points, {
          points: document_.points,
          ...correctionOptions,
        })
      : {
          points,
          segments: [],
          original: points,
          correction: { kind: "curve", confidence: 1, disabled: true },
          conflict: null,
        };

    lastCorrection = corrected;

    const kind = corrected.correction.kind;

    const element = makeGeometry({
      kind,
      name: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${document_.geometry.length + 1}`,
      points: corrected.points,
      segments: corrected.segments,
      centre: corrected.correction.centre || null,
      radius: corrected.correction.radius ?? null,
      radiusX: corrected.correction.radiusX ?? null,
      radiusY: corrected.correction.radiusY ?? null,
      rotation: corrected.correction.rotation || 0,
      closed: Boolean(corrected.correction.closed),
      original: corrected.original,
      correction: corrected.correction,
      appearance: document_.appearance,
    });

    selectedGeometryIds = [element.id];
    selectedPointId = null;

    apply(addGeometry(document_, element));
  }

  /* ========================================================
   * PLACEMENT
   * ======================================================== */

  /*
   * PLACE SKETCH IS AN EXPLICIT STEP.
   *
   * Nothing is inserted because the student finished drawing or changed a
   * setting. The button validates the sketch, enters placement mode, and the
   * next click on the canvas confirms - which is the only moment geometry
   * leaves the editor.
   */
  function beginPlacement() {
    if (!document_.geometry.length) {
      setStatus("Draw something before placing the sketch.");

      return;
    }

    const resolved = resolvePoints(document_.points);

    const anchor = resolved[0]?.absolute || { x: 0, y: 0 };

    placement = {
      anchor,
      rotation: 0,
      scale: 1,
      transform: alignTransform(anchor, anchor),
    };

    setStatus("Click on the canvas to place the sketch.");

    renderCanvas();
  }

  function confirmPlacement(model) {
    if (!placement) {
      return;
    }

    const transform = alignTransform(placement.anchor, model, {
      rotation: placement.rotation,
      scale: placement.scale,
    });

    const include = {
      axes: Boolean($('[data-sketch-toggle="outAxes"]')?.checked),
      majorGrid: Boolean($('[data-sketch-toggle="outMajorGrid"]')?.checked),
      minorGrid: Boolean($('[data-sketch-toggle="outMinorGrid"]')?.checked),
      ticks: Boolean($('[data-sketch-toggle="outTicks"]')?.checked),
      labels: Boolean($('[data-sketch-toggle="outLabels"]')?.checked),
      points: Boolean($('[data-sketch-toggle="outPoints"]')?.checked),
    };

    const placed = placementPackage(document_, transform, { include });

    placement = null;

    const result = {
      ...placed,
      document: document_,
      source: generateSource(document_, { include }),
      transform,
    };

    options.onPlace?.(result);
    options.onApply?.(result);

    closeWorkspace();
  }

  /* ========================================================
   * THE SIDEBAR
   * ======================================================== */

  function setSidebarWidth(width) {
    sidebarWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)));

    sidebar.style.width = `${sidebarWidth}px`;
  }

  function toggleCollapsed() {
    sidebarCollapsed = !sidebarCollapsed;

    sidebar.classList.toggle("is-collapsed", sidebarCollapsed);
    divider.hidden = sidebarCollapsed;

    const button = $("[data-sketch-collapse]");

    if (button) {
      button.setAttribute(
        "aria-label",
        sidebarCollapsed ? "Expand the properties panel" : "Collapse the properties panel",
      );
    }
  }

  function toggleMaximised() {
    maximised = !maximised;

    dialog.classList.toggle("is-maximised", maximised);

    const button = $("[data-sketch-maximise]");

    if (button) {
      button.setAttribute("aria-pressed", String(maximised));
    }

    renderCanvas();
  }

  /* The divider: drag to resize, arrow keys for the keyboard. */
  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    divider.setPointerCapture?.(event.pointerId);

    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    const move = (moveEvent) => {
      setSidebarWidth(startWidth - (moveEvent.clientX - startX));
      renderCanvas();
    };

    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
    };

    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });

  divider.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      setSidebarWidth(sidebarWidth + 16);
      renderCanvas();
    }

    if (event.key === "ArrowRight") {
      setSidebarWidth(sidebarWidth - 16);
      renderCanvas();
    }
  });

  /* ========================================================
   * EVENTS
   * ======================================================== */

  function setStatus(text) {
    const status = $("[data-sketch-status]");

    if (status) {
      status.textContent = text;
    }
  }

  function setTool(next) {
    if (!["select", "draw", "point", "erase"].includes(next)) {
      return;
    }

    tool = next;
    renderControls();
  }

  /*
   * THE SECTION HEADERS COLLAPSE THEIR OWN SECTION.
   *
   * Each header is a real button with `aria-expanded`, and the body it controls
   * is the next sibling. The state is read from `aria-expanded` rather than
   * from a class, so the markup's own attribute is the single source of truth.
   */
  $$("[data-sketch-section-toggle]").forEach((header) => {
    header.addEventListener("click", () => {
      const body = header.nextElementSibling;
      const open = header.getAttribute("aria-expanded") === "true";

      header.setAttribute("aria-expanded", String(!open));

      if (body) {
        body.hidden = open;
      }
    });
  });

  $$("[data-sketch-tool-select], [data-sketch-tool-draw], [data-sketch-tool-point], [data-sketch-tool-erase]").forEach(
    (button) => {
      const id = toolIdOf(button);

      if (!id) {
        return;
      }

      button.addEventListener("click", () => setTool(id));
    },
  );

  $("[data-sketch-undo]")?.addEventListener("click", undoStep);
  $("[data-sketch-redo]")?.addEventListener("click", redoStep);
  $("[data-sketch-fit]")?.addEventListener("click", fitToGeometry);
  $("[data-sketch-maximise]")?.addEventListener("click", toggleMaximised);
  $("[data-sketch-collapse]")?.addEventListener("click", toggleCollapsed);
  $("[data-sketch-place]")?.addEventListener("click", beginPlacement);

  $$("[data-sketch-cancel], [data-sketch-close]").forEach((button) => {
    button.addEventListener("click", () => {
      options.onCancel?.();
      closeWorkspace();
    });
  });

  $("[data-sketch-auto-correct]")?.addEventListener("change", (event) => {
    autoCorrect = event.target.checked;
    renderCorrection();
  });

  /* ---- geometry list ---- */
  $("[data-sketch-geometry-list]")?.addEventListener("click", (event) => {
    const select = event.target.closest?.("[data-sketch-geometry-select]");
    const eye = event.target.closest?.("[data-sketch-geometry-visible]");
    const remove = event.target.closest?.("[data-sketch-geometry-delete]");

    if (select) {
      const id = select.dataset.sketchGeometrySelect;

      selectedGeometryIds = event.shiftKey
        ? [...new Set([...selectedGeometryIds, id])]
        : [id];
      selectedPointId = null;
      render();
      return;
    }

    if (eye) {
      const id = eye.dataset.sketchGeometryVisible;
      const element = document_.geometry.find((entry) => entry.id === id);

      apply(setGeometryVisible(document_, id, element?.visible === false));
      return;
    }

    if (remove) {
      const id = remove.dataset.sketchGeometryDelete;

      apply(removeGeometry(document_, id));
      selectedGeometryIds = selectedGeometryIds.filter((entry) => entry !== id);
      render();
    }
  });

  /* ---- points ---- */
  $("[data-sketch-points]")?.addEventListener("click", (event) => {
    const row = event.target.closest?.("[data-sketch-point-row]");

    if (!row) {
      return;
    }

    selectedPointId = row.dataset.sketchPointRow;
    selectedGeometryIds = [];
    render();
  });

  /* ---- the contextual selection properties ---- */
  $("[data-sketch-selection-properties]")?.addEventListener("input", (event) => {
    const name = event.target.closest?.("[data-sketch-point-name]");

    if (name && selectedPointId) {
      apply(updatePoint(document_, selectedPointId, { name: name.value }));
      return;
    }

    const geometryName = event.target.closest?.("[data-sketch-geometry-name]");

    if (geometryName) {
      apply(renameGeometry(document_, geometryName.dataset.sketchGeometryName, geometryName.value));
      return;
    }
  });

  /*
   * A COORDINATE IS COMMITTED WHEN THE FIELD IS FINISHED.
   *
   * This is the `change` handler, not `input`: a half-typed number must not
   * reach the model. See the note inside it.
   */
  $("[data-sketch-selection-properties]")?.addEventListener("change", (event) => {
    const field = event.target.closest?.("[data-sketch-field]");

    if (!field || !selectedPointId) {
      return;
    }

    /*
     * A COORDINATE IS COMMITTED WHEN IT IS FINISHED, NOT ON EVERY KEYSTROKE.
     *
     * Typing "-3" passes through "-", which is not a number; typing "1.5"
     * passes through "1.". Committing those would rewrite the point with a
     * half-typed value and then fight the student's next keystroke. `change`
     * fires when the field is done - on blur or Enter - which is the moment the
     * value is real.
     *
     * There is NO range check here. A coordinate outside the current view is a
     * perfectly good coordinate: the view is what follows the geometry, not a
     * limit on where the geometry may be.
     */
    const text = String(field.value).trim();

    if (text === "" || text === "-" || text === "." || text === "-.") {
      return;
    }

    const key = field.dataset.sketchField;
    const value = Number(text);

    if (!Number.isFinite(value)) {
      return;
    }

    const point = document_.points.find((entry) => entry.id === selectedPointId);

    if (!point) {
      return;
    }

    if (key === "x" || key === "y") {
      const x = key === "x" ? value : point.x;
      const y = key === "y" ? value : point.y;

      apply(
        updatePoint(document_, selectedPointId, (entry) =>
          withAbsolutePosition(entry, x, y, document_.points),
        ),
      );
      return;
    }

    if (key === "dx" || key === "dy") {
      apply(
        updatePoint(document_, selectedPointId, {
          delta: { ...(point.delta || { dx: 0, dy: 0 }), [key]: value },
        }),
      );
      return;
    }

    if (key === "distance" || key === "angleDeg") {
      apply(updatePoint(document_, selectedPointId, { [key]: value }));
    }
  });

  $("[data-sketch-selection-properties]")?.addEventListener("change", (event) => {
    const mode = event.target.closest?.("[data-sketch-point-mode]");

    if (mode && selectedPointId) {
      const point = document_.points.find((entry) => entry.id === selectedPointId);

      const reference =
        mode.value === "absolute"
          ? null
          : document_.points.find((entry) => entry.id === point?.referenceId) ||
            document_.points.find((entry) => entry.id !== selectedPointId) ||
            null;

      apply(setPointCoordinateMode(document_, selectedPointId, mode.value, reference?.id || null));
      return;
    }

    const reference = event.target.closest?.("[data-sketch-point-reference]");

    if (reference && selectedPointId) {
      const point = document_.points.find((entry) => entry.id === selectedPointId);

      apply(
        setPointCoordinateMode(
          document_,
          selectedPointId,
          point?.coordinateMode || "relative",
          reference.value || null,
        ),
      );
      return;
    }

    const locked = event.target.closest?.("[data-sketch-point-locked]");

    if (locked && selectedPointId) {
      apply(setPointLocked(document_, selectedPointId, locked.checked));
      return;
    }

    const geometryField = event.target.closest?.("[data-sketch-geometry]");

    if (geometryField) {
      const id = selectedGeometryIds[0];
      const key = geometryField.dataset.sketchGeometry;
      const value = Number(geometryField.value);

      if (!id || !Number.isFinite(value)) {
        return;
      }

      apply(updateGeometry(document_, id, (element) => resizeElement(element, key, value)));
    }
  });

  $("[data-sketch-selection-properties]")?.addEventListener("click", (event) => {
    const removePoint = event.target.closest?.("[data-sketch-point-delete]");

    if (removePoint && selectedPointId) {
      apply(removePoint(document_, selectedPointId));
      selectedPointId = null;
      render();
      return;
    }

    const removeGeometry = event.target.closest?.("[data-sketch-geometry-delete]");

    if (removeGeometry) {
      const id = removeGeometry.dataset.sketchGeometryDelete;

      apply(removeGeometry(document_, id));
      selectedGeometryIds = selectedGeometryIds.filter((entry) => entry !== id);
      render();
    }
  });

  /* ---- appearance ---- */
  $("[data-sketch-appearance]")?.addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-sketch-appearance]");

    if (!input || !selectedGeometryIds.length) {
      return;
    }

    const key = input.dataset.sketchAppearance;

    if (key === "colour" || key === "fill") {
      apply(setAppearanceForMany(document_, selectedGeometryIds, { [key]: input.value }));
    }
  });

  $("[data-sketch-appearance]")?.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-sketch-select]");
    const check = event.target.closest?.("[data-sketch-toggle]");

    if (!selectedGeometryIds.length) {
      return;
    }

    if (select) {
      apply(
        setAppearanceForMany(document_, selectedGeometryIds, {
          [select.dataset.sketchSelect]: select.value,
        }),
      );
      return;
    }

    if (check) {
      apply(
        setAppearanceForMany(document_, selectedGeometryIds, {
          [check.dataset.sketchToggle]: check.checked,
        }),
      );
    }
  });

  $("[data-sketch-appearance]")?.addEventListener("click", (event) => {
    if (!event.target.closest?.("[data-sketch-appearance-reset]")) {
      return;
    }

    selectedGeometryIds.forEach((id) => {
      document_ = resetGeometryAppearance(document_, id);
    });

    apply(document_);
  });

  /* ---- correction ---- */
  $("[data-sketch-restore-original]")?.addEventListener("click", () => {
    const id = selectedGeometryIds[0];

    if (!id) {
      return;
    }

    apply(
      updateGeometry(document_, id, (element) => {
        const restored = restoreOriginal(element);

        return {
          ...element,
          points: restored.points,
          segments: restored.segments,
          correction: restored.correction,
        };
      }),
    );
  });

  $$("[data-sketch-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.sketchToggle;

      if (key in correctionOptions) {
        correctionOptions = { ...correctionOptions, [key]: input.checked };
        return;
      }

      if (key === "autoBounds") {
        /*
         * SWITCHING TO AUTOMATIC REFITS; SWITCHING TO FIXED KEEPS WHAT IS SHOWN.
         *
         * Turning auto-fit off must not jump the view to some default - the
         * student is saying "this range is mine now", so the range in force
         * becomes the fixed one. Neither direction is a geometry change, so
         * neither refits on top of itself.
         */
        apply(
          setBounds(document_, document_.bounds, input.checked ? "auto" : "manual"),
          { refit: input.checked },
        );
        return;
      }

      if (key === "equalScale") {
        apply(setGrid(document_, { equalScale: input.checked }));
        return;
      }

      if (key.startsWith("out")) {
        /* Output options are read at placement; they are not model changes. */
        return;
      }

      apply(setGrid(document_, { [key]: input.checked }));
    });
  });

  $$("[data-sketch-select]").forEach((input) => {
    input.addEventListener("change", () => {
      apply(setGrid(document_, { [input.dataset.sketchSelect]: input.value }));
    });
  });

  /*
   * A NUMBER FIELD COMMITS ON `change`, NOT ON EVERY KEYSTROKE.
   *
   * `change` fires when the field is finished - on blur, or on Enter - which is
   * exactly when a half-typed value becomes a value. Committing on `input`
   * would read "-" and "-3." as numbers mid-typing and rewrite the model with
   * them, which is how a negative or decimal entry got mangled.
   *
   * The value is read with `Number`, which accepts negatives and decimals, and
   * an EMPTY or unparseable field is ignored rather than treated as zero - a
   * cleared box is not a request to set the bound to 0.
   */
  $$("[data-sketch-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.sketchField;
      const text = String(input.value).trim();

      if (text === "" || text === "-" || text === "." || text === "-.") {
        return;
      }

      const value = Number(text);

      if (!Number.isFinite(value)) {
        return;
      }

      if (["xMin", "xMax", "yMin", "yMax"].includes(key)) {
        /* A typed bound IS the view, so it is not refitted over. */
        apply(setBounds(document_, { [key]: value }, "manual"), { refit: false });
        return;
      }

      if (["majorX", "majorY", "minorDivisions", "labelPrecision", "snapTolerancePx"].includes(key)) {
        apply(setGrid(document_, { [key]: value }));
      }
    });
  });

  $("[data-sketch-fit-bounds]")?.addEventListener("click", fitToGeometry);

  /* ---- keyboard ---- */
  dialog.addEventListener("keydown", (event) => {
    const inField = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName);

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redoStep() : undoStep();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();

      if (placement) {
        placement = null;
        setStatus("Placement cancelled.");
        renderCanvas();
        return;
      }

      if (inField) {
        event.target.blur();
        return;
      }

      options.onCancel?.();
      closeWorkspace();
      return;
    }

    if (inField) {
      return;
    }

    const shortcuts = { s: "select", d: "draw", a: "point", e: "erase" };

    if (shortcuts[event.key.toLowerCase()]) {
      setTool(shortcuts[event.key.toLowerCase()]);
    }
  });

  /* ========================================================
   * ACTIONS
   * ======================================================== */

  /*
   * THE EXTENT OF THE ACTUAL GEOMETRY.
   *
   * Every point the student defined, every vertex of every element, and the
   * extremes of a circle or an ellipse - which are NOT in its sampled points
   * when the sample happens to miss them. A circle's leftmost point is
   * `centre.x - radius`, and reading only the samples would leave the view a
   * fraction short of the shape it is showing.
   */
  function geometryExtent() {
    const points = [
      ...resolvePoints(document_.points).map((point) => point.absolute),
      ...document_.geometry.flatMap((element) => {
        const list = (element.points || []).map((point) => ({ x: point.x, y: point.y }));

        if (element.centre && element.radius) {
          list.push(
            { x: element.centre.x - element.radius, y: element.centre.y },
            { x: element.centre.x + element.radius, y: element.centre.y },
            { x: element.centre.x, y: element.centre.y - element.radius },
            { x: element.centre.x, y: element.centre.y + element.radius },
          );
        }

        if (element.centre && element.radiusX && element.radiusY) {
          list.push(
            { x: element.centre.x - element.radiusX, y: element.centre.y },
            { x: element.centre.x + element.radiusX, y: element.centre.y },
            { x: element.centre.x, y: element.centre.y - element.radiusY },
            { x: element.centre.x, y: element.centre.y + element.radiusY },
          );
        }

        return list;
      }),
    ];

    return points;
  }

  /*
   * AUTOMATIC BOUNDS FOLLOW THE GEOMETRY.
   *
   * With Automatic Bounds on, the visible range is the extent of what is
   * actually in the sketch - so a point typed outside the current view is
   * ACCEPTED and the view grows to include it, rather than the point being
   * refused because it fell outside a range that was never meant to be a limit.
   *
   * With Fixed Bounds on, nothing is recalculated: the student's four numbers
   * are the view, and geometry outside them is still stored and still editable.
   */
  function refitAutomaticBounds() {
    if (document_.boundsMode === "manual") {
      return document_;
    }

    const points = geometryExtent();

    if (!points.length) {
      return document_;
    }

    return setBounds(document_, withOriginInView(boundsOfPoints(points)), "auto");
  }

  function fitToGeometry() {
    const points = geometryExtent();

    if (!points.length) {
      return;
    }

    apply(setBounds(document_, withOriginInView(boundsOfPoints(points)), "auto"));
  }

  /* ========================================================
   * LIFECYCLE
   * ======================================================== */

  function close() {
    if (closed) {
      return;
    }

    closed = true;

    if (openWorkspace === api) {
      openWorkspace = null;
    }

    dialog.remove();
  }

  const api = {
    close,
    getDocument: () => document_,
    getSource: (include) => generateSource(document_, { include }),
    applySource: (text) => {
      const parsed = parseSource(text);
      const result = applyParsedSource(document_, parsed);

      if (result.applied) {
        apply(result.document);
      }

      return result;
    },
    setTool,
    undo: undoStep,
    redo: redoStep,
    fit: fitToGeometry,
    beginPlacement,
    isOpen: () => !closed,
  };

  openWorkspace = api;

  /*
   * THE API IS ALSO REACHABLE FROM THE ELEMENT.
   *
   * The page already exposes its model and sheets for tests and for the
   * browser's console; the workspace follows the same convention so a check can
   * read the source, apply an edit or place the sketch without driving the
   * pointer. It is the SAME object the module returns.
   */
  dialog.__sketchWorkspace = api;

  setSidebarWidth(SIDEBAR_DEFAULT);
  setTool("draw");

  /* The first paint waits for layout, so the canvas has a real box. */
  requestAnimationFrame(() => {
    render();
  });

  return api;
}

/*
 * RESIZE A SHAPE FROM ITS OWN PARAMETERS.
 *
 * A circle's radius, an ellipse's two radii, a line's endpoints - each is the
 * geometry's own number, so editing it changes the shape and nothing else. The
 * points are rebuilt from the parameters rather than nudged, so the result is
 * exactly the shape the numbers describe.
 */
function resizeElement(element, key, value) {
  const next = { ...element };

  if (key === "radius") {
    next.radius = Math.max(0.001, value);
    next.points = circlePoints(next.centre, next.radius);
    next.segments = [];
    return next;
  }

  if (key === "radiusX" || key === "radiusY") {
    next[key] = Math.max(0.001, value);
    next.points = ellipsePoints(next.centre, next.radiusX, next.radiusY);
    next.segments = [];
    return next;
  }

  if (key === "centreX" || key === "centreY") {
    const centre = {
      x: key === "centreX" ? value : next.centre.x,
      y: key === "centreY" ? value : next.centre.y,
    };

    next.centre = centre;

    if (next.kind === "circle") {
      next.points = circlePoints(centre, next.radius);
    } else if (next.kind === "ellipse") {
      next.points = ellipsePoints(centre, next.radiusX, next.radiusY);
    } else if (next.kind === "arc") {
      next.points = arcPoints(centre, next.radius, next.rotation || 0);
    }

    next.segments = [];
    return next;
  }

  if (key === "startX" || key === "startY" || key === "endX" || key === "endY") {
    const points = (next.points || []).map((point) => ({ ...point }));

    if (!points.length) {
      return next;
    }

    const index = key.startsWith("start") ? 0 : points.length - 1;
    const axis = key.endsWith("X") ? "x" : "y";

    points[index][axis] = value;

    next.points = points;
    next.segments = [];
    return next;
  }

  return next;
}

function circlePoints(centre, radius, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return {
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    };
  });
}

function ellipsePoints(centre, radiusX, radiusY, count = 64) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return {
      x: centre.x + radiusX * Math.cos(angle),
      y: centre.y + radiusY * Math.sin(angle),
    };
  });
}

function arcPoints(centre, radius, startAngle, count = 32) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = startAngle + (Math.PI * index) / count;

    return {
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    };
  });
}

export function closeWorkspace() {
  openWorkspace?.close();
  openWorkspace = null;
}

export function isWorkspaceOpen() {
  return Boolean(openWorkspace);
}

export default {
  openSketchWorkspace,
  closeWorkspace,
  isWorkspaceOpen,
};
