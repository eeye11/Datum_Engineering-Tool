/* eslint-disable no-console */
/*
 * ========================================================
 * ZOOM POLICY ACROSS THE WHOLE DRAWING
 * ========================================================
 *
 * Three behaviours must hold at EVERY zoom, for every tool, because they are
 * the three a student judges the drawing by:
 *
 *   1. GEOMETRY SCALES WITH THE VIEW and its stored coordinates never change.
 *      A span drawn at 100% must be exactly twice as wide at 200%.
 *   2. TEXT STAYS ITS STATED SCREEN SIZE. A 16 px label is 16 px at 25% and at
 *      400%; its ANCHOR still follows the drawing.
 *   3. STROKES KEEP THEIR STATED WEIGHT. A pen chosen in Features does not
 *      thicken with the camera.
 *
 * Plus two invariants that protect the document:
 *
 *   4. Zoom and pan NEVER write to the source or to object geometry.
 *   5. Repeated zooming in and out returns to exactly the same rendering.
 *
 * These are asserted against the REAL renderer's SVG output, so a change to a
 * shared primitive - text, stroke, arrow marker - fails here rather than in a
 * screenshot somewhere.
 */
const path = require("path");
const { bootApp } = require("./helpers/boot-app.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const url = (p) =>
  new URL("file://" + path.join(__dirname, "..", "src", p).replace(/\\/g, "/"))
    .href;

process.on("uncaughtException", (error) => {
  fail++;
  console.log(
    `  FAIL (uncaught) ${error && error.stack ? error.stack : error}`,
  );
  process.exitCode = 1;
});

(async () => {
  bootApp();
  await new Promise((resolve) => setTimeout(resolve, 80));

  const model = (await import(url("shared/model/drawing-state.js"))).default;
  const { drawingState } = await import(
    url("features/workspace/editor-state.js")
  );
  const renderer = (await import(url("shared/rendering/renderer.js"))).default;
  const sync = await import(
    url("shared/rendering/latex/source-synchronization.js")
  );
  const writers = await import(
    url("shared/rendering/latex/source-writers/index.js")
  );
  const managerMod = await import(
    url("shared/rendering/latex/drawing-source-manager.js")
  );
  const viewport = await import(url("components/layout/workspace/viewport.js"));

  writers.installSourceWriters(sync);

  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 900 });
  Object.defineProperty(host, "clientHeight", { value: 600 });
  host.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });

  const style = () => ({ ...drawingState.styleDefaults });

  const drawAt = (zoom) => {
    drawingState.camera.zoom = zoom;
    host.innerHTML = "";
    renderer.renderDrawing(drawingState, host, { static: true });
    return host.querySelector("svg") || host;
  };

  /* ---------- a small mixed diagram: shape, vector, text ---------------- */

  drawingState.objects = [];
  model.addObject(
    drawingState,
    model.geometryFactories.line(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { style: style() },
    ),
  );
  model.addObject(
    drawingState,
    model.geometryFactories.force(
      { x: 0, y: 60 },
      { x: 80, y: 60 },
      { style: style() },
    ),
  );
  model.addObject(drawingState, {
    type: "annotate",
    name: "Note",
    annotateKind: "note",
    geometry: { position: { x: 40, y: 110 } },
    style: { ...style(), fontSize: 16 },
    /* The annotate model reads a note's words from `text`. */
    text: "Label text",
  });

  const lineSpan = (svg) => {
    const line = [...svg.querySelectorAll("line")].find(
      (node) =>
        Math.abs(
          Number(node.getAttribute("y1")) - Number(node.getAttribute("y2")),
        ) < 1e-6,
    );

    return line
      ? Math.abs(
          Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
        )
      : null;
  };

  const screenTextSizes = (svg) =>
    [...svg.querySelectorAll("text")]
      .map((node) => {
        const size = Number(node.getAttribute("font-size")) || 0;
        const match = /scale\(\s*([\d.]+)/.exec(
          node.getAttribute("transform") || "",
        );
        return Math.round(size * (match ? Number(match[1]) : 1) * 100) / 100;
      })
      .filter((size) => size > 0);

  console.log(
    "\n  geometry scales with the view, its stored data does not move\n",
  );

  const storedBefore = JSON.stringify(
    drawingState.objects.map((object) => object.geometry),
  );

  const base = lineSpan(drawAt(1));

  [0.25, 0.5, 2, 4].forEach((zoom) => {
    const span = lineSpan(drawAt(zoom));

    check(
      `the drawn span is ${zoom}x at ${zoom * 100}%`,
      span !== null && Math.abs(span / base - zoom) < 0.02,
      `span ${span}, base ${base}`,
    );
  });

  check(
    "the stored geometry is untouched by any zoom",
    JSON.stringify(drawingState.objects.map((object) => object.geometry)) ===
      storedBefore,
  );

  console.log(
    "\n  text keeps its screen size, its anchor follows the drawing\n",
  );

  const sizeSets = [0.25, 0.5, 1, 2, 4].map((zoom) =>
    [...new Set(screenTextSizes(drawAt(zoom)))].sort((a, b) => a - b).join(","),
  );

  check(
    "every text node is the same on-screen size at every zoom",
    new Set(sizeSets).size === 1,
    sizeSets.join(" | "),
  );

  const anchorAt = (zoom) => {
    const svg = drawAt(zoom);
    const note = [...svg.querySelectorAll("text")].find((node) =>
      String(node.textContent).includes("Label text"),
    );

    return note ? Number(note.getAttribute("x")) : null;
  };

  const anchor100 = anchorAt(1);
  const anchor200 = anchorAt(2);

  check(
    "the text's anchor is a drawing position, so it moves with the geometry",
    anchor100 !== null &&
      anchor200 !== null &&
      Math.abs(anchor200 - 450 - (anchor100 - 450) * 2) < 1.5,
    `${anchor100} -> ${anchor200}`,
  );

  console.log("\n  a stroke keeps its stated weight\n");

  const strokeRows = [0.5, 1, 2].flatMap((weight) => {
    drawingState.objects = [];
    model.addObject(
      drawingState,
      model.geometryFactories.line(
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        {
          style: { ...style(), lineWidth: weight },
        },
      ),
    );

    return [0.25, 1, 4].map((zoom) => {
      const svg = drawAt(zoom);
      const line = svg.querySelector("line");
      const width = line ? Number(line.getAttribute("stroke-width")) : null;

      return { weight, zoom, screenWidth: width * zoom };
    });
  });

  strokeRows.forEach((row) => {
    const expected = Math.max(0.5, row.weight * 2.4);

    check(
      `weight ${row.weight} at ${row.zoom}x paints ${expected.toFixed(2)} px`,
      Math.abs(row.screenWidth - expected) < 0.35,
      `painted ${row.screenWidth}`,
    );
  });

  console.log("\n  zoom and pan never write to the document\n");

  drawingState.objects = [];
  model.addObject(
    drawingState,
    model.geometryFactories.circle({ x: 120, y: 40 }, 25, { style: style() }),
  );

  const manager = managerMod.activeSourceManager();
  sync.reconcileSourceWithObjects(manager, drawingState.objects, {
    state: drawingState,
  });

  const sourceBefore = manager.getSource();
  const geometryBefore = JSON.stringify(
    drawingState.objects.map((object) => object.geometry),
  );

  [400, 25, 200, 100, 50].forEach((percent) =>
    viewport.updateDrawingZoom(percent),
  );
  viewport.panByScreenDelta(300, -120);
  viewport.panByScreenDelta(-90, 55);
  viewport.panByScreenDelta(1400, -800);

  check(
    "the source is identical after a burst of zoom and pan",
    manager.getSource() === sourceBefore,
  );
  check(
    "the object geometry is identical after a burst of zoom and pan",
    JSON.stringify(drawingState.objects.map((object) => object.geometry)) ===
      geometryBefore,
  );

  console.log("\n  repeated zooming has no cumulative drift\n");

  const snapshot = (zoom) => {
    const svg = drawAt(zoom);
    return svg.innerHTML;
  };

  const pristine = snapshot(1);

  [4, 0.25, 2, 0.5, 4, 1].forEach((zoom) => snapshot(zoom));

  check(
    "returning to 100% renders exactly as the first visit did",
    snapshot(1) === pristine,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);

  if (fail) {
    process.exitCode = 1;
  }
})();
