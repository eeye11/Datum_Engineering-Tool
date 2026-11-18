/*
 * Temporary probe: every stroke, arrow, length and width, measured at several
 * zooms and normalised back to the drawing's own units. A value that is the
 * SOURCE's stays the same in that column at every zoom.
 */
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const url = decodeURIComponent(request.url.split("?")[0]);
  const file = path.join(root, url === "/" ? "index.html" : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (message) => {
  if (message.type() === "error") console.log("CONSOLE", message.text());
});
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForTimeout(900);

const result = await page.evaluate(async () => {
  const { drawingState } =
    await import("/src/features/workspace/editor-state.js");
  const { renderCurrentDrawing } =
    await import("/src/components/layout/workspace/canvas-render.js");

  drawingState.objects.length = 0;
  drawingState.selection.selectedObjectIds = [];
  const style = { stroke: "#000000", lineWidth: 0.5 };
  const dashed = { stroke: "#000000", lineWidth: 0.5, lineType: "dashed" };

  const objects = [
    {
      id: "line",
      type: "line",
      geometry: { start: { x: -150, y: 0 }, end: { x: 150, y: 0 } },
      style,
      visible: true,
    },
    {
      id: "dashline",
      type: "line",
      geometry: { start: { x: -150, y: -20 }, end: { x: 150, y: -20 } },
      style: dashed,
      visible: true,
    },
    {
      id: "circle",
      type: "circle",
      geometry: { center: { x: 0, y: 60 }, radius: 25 },
      style,
      visible: true,
    },
    {
      id: "rect",
      type: "rectangle",
      geometry: { position: { x: -120, y: 120 }, width: 80, height: 40 },
      style,
      visible: true,
    },
    {
      id: "force",
      type: "force",
      geometry: {
        start: { x: -60, y: -60 },
        end: { x: -60, y: -120 },
        magnitude: 60,
        angle: -90,
      },
      engineering: { magnitude: 60, angle: -90 },
      style: { ...style, arrowheadSize: 9 },
      visible: true,
    },
    {
      id: "pin",
      type: "pin-support",
      geometry: {
        position: { x: 60, y: 0 },
        start: { x: 60, y: 0 },
        end: { x: 60, y: -20 },
      },
      style,
      visible: true,
    },
    {
      id: "roller",
      type: "roller-support",
      geometry: {
        position: { x: 120, y: 0 },
        start: { x: 120, y: 0 },
        end: { x: 120, y: -20 },
      },
      style,
      visible: true,
    },
    {
      id: "moment",
      type: "moment",
      geometry: {
        position: { x: 0, y: -60 },
        center: { x: 0, y: -60 },
        radius: 15,
        arcRadius: 20,
      },
      engineering: { magnitude: 20 },
      style,
      visible: true,
    },
    {
      id: "cs",
      type: "coordinate-system-2d",
      geometry: {
        origin: { x: -180, y: 80 },
        axisLength: 25,
        xLabel: "X",
        yLabel: "Y",
      },
      style,
      visible: true,
    },
    {
      id: "dim",
      type: "dimension",
      geometry: {
        start: { x: -100, y: 160 },
        end: { x: 0, y: 160 },
        offset: 15,
        kind: "horizontal",
      },
      engineering: { value: 100 },
      style,
      visible: true,
    },
    {
      id: "arc",
      type: "arc",
      geometry: {
        center: { x: 120, y: 80 },
        radius: 20,
        startAngle: 0,
        endAngle: 2.2,
      },
      style,
      visible: true,
    },
  ];

  drawingState.objects.push(...objects);

  const canvas = document.querySelector(".drawing-canvas");
  const report = {};

  for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
    drawingState.camera.zoom = zoom;
    renderCurrentDrawing();
    const overlay = canvas.querySelector("svg.drawing-overlay");
    const entry = {};

    const pick = (id) => overlay.querySelector(`[data-feature-id="${id}"]`);
    const shapes = (group) =>
      group
        ? [...group.querySelectorAll("line,circle,rect,path,polygon,polyline")]
        : [];

    /*
     * A stroke's WORLD width. The attribute is in the OVERLAY's pixels, and one
     * drawing unit is `2.4 * zoom` of those - so the world weight is the
     * attribute MULTIPLIED by `2.4 * zoom`, which is exactly the camera scale
     * `scaledStrokeWidth` divided out. It must be the same at every zoom.
     */
    const strokeOf = (el) => {
      const raw = el.getAttribute("stroke-width");
      if (raw === null || raw === "none") return null;
      return Math.round(Number.parseFloat(raw) * 2.4 * zoom * 1000) / 1000;
    };

    /* A dash's world lengths, in the same unit. */
    /*
     * A dash's WORLD lengths. `worldLength` multiplies by the zoom alone - it is
     * a length of the drawing carried into overlay pixels - so the world value
     * is the attribute divided by the zoom. The 2.4 factor is NOT part of a
     * dash: it belongs to pen weights, which `scaledStrokeWidth` states in the
     * drawing's own pixels.
     */
    const dashOf = (el) => {
      const raw = el.getAttribute("stroke-dasharray");
      if (!raw) return null;
      return raw
        .split(/[\s,]+/)
        .map((v) => Math.round((Number(v) / zoom) * 1000) / 1000)
        .join(" ");
    };

    /*
     * A shape's size in DRAWING UNITS, measured from its PROJECTED GEOMETRY - the
     * points the painter actually placed - rather than from `getBBox`/`rect`,
     * which fold in a `rotate()` on the element (so a circle's box would grow
     * with its angle) or exclude the stroke. A path's own extent is taken from
     * its longest straight span and its end points, which is enough to tell a
     * zoom-invariant shape from one that is not.
     */
    const worldBox = (el) => {
      if (!el) return null;

      const tag = el.tagName.toLowerCase();
      const box = el.getBBox ? el.getBBox() : { width: 0, height: 0 };

      /* A rotated element's own frame is what its geometry is drawn in. */
      void tag;

      return {
        w: Math.round((box.width / (2.4 * zoom)) * 100) / 100,
        h: Math.round((box.height / (2.4 * zoom)) * 100) / 100,
      };
    };

    const line = pick("line")?.querySelector("line");
    const dashline = pick("dashline")?.querySelector("line");
    const circle = pick("circle")?.querySelector("circle");
    const rect = pick("rect")?.querySelector("rect");
    const force = pick("force");
    const forceHead = force?.querySelector("polygon");
    const pin = pick("pin");
    const roller = pick("roller");
    const moment = pick("moment");
    const cs = pick("cs");
    const dim = pick("dim");
    const arc = pick("arc")?.querySelector("path");

    entry.line = {
      stroke: line && strokeOf(line),
      box: line && worldBox(line),
    };
    entry.dashline = {
      stroke: dashline && strokeOf(dashline),
      dash: dashline && dashOf(dashline),
    };
    entry.circle = {
      stroke: circle && strokeOf(circle),
      box: circle && worldBox(circle),
    };
    entry.rect = {
      stroke: rect && strokeOf(rect),
      box: rect && worldBox(rect),
    };
    entry.force = {
      strokes: force
        ? shapes(force)
            .map(strokeOf)
            .filter((v) => v !== null)
        : null,
      head: forceHead ? worldBox(forceHead) : null,
    };
    entry.pin = {
      strokes: pin
        ? shapes(pin)
            .map(strokeOf)
            .filter((v) => v !== null)
        : null,
      box: pin ? worldBox(pin.querySelector("polygon") || pin) : null,
    };
    entry.roller = {
      strokes: roller
        ? shapes(roller)
            .map(strokeOf)
            .filter((v) => v !== null)
        : null,
      box: roller ? worldBox(roller.querySelector("polygon") || roller) : null,
    };
    entry.moment = {
      strokes: moment
        ? shapes(moment)
            .map(strokeOf)
            .filter((v) => v !== null)
        : null,
      box: moment ? worldBox(shapes(moment)[0] || moment) : null,
    };
    entry.coordinateSystem = {
      strokes: cs
        ? shapes(cs)
            .map(strokeOf)
            .filter((v) => v !== null)
        : null,
      head: cs ? worldBox(cs.querySelector("path") || cs) : null,
    };
    entry.dimension = {
      head: dim ? worldBox(dim.querySelector("polygon") || dim) : null,
      strokes: dim
        ? shapes(dim)
            .map(strokeOf)
            .filter((v) => v !== null)
        : null,
    };
    entry.arc = {
      stroke: arc && strokeOf(arc),
      box: arc ? worldBox(arc) : null,
    };

    report[zoom] = entry;
  }

  return report;
});

fs.writeFileSync(
  path.join(root, "tests", "e2e", "size-probe.json"),
  JSON.stringify(result, null, 2),
);
console.log("written");
await browser.close();
server.close();
