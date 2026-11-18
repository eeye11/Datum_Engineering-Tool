/* Temporary probe 4: arrowhead width relative to the drawing, across zooms. */
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url.split("?")[0]);
    const file = path.join(root, url === "/" ? "index.html" : url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404).end("not found");
        return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForTimeout(900);

const result = await page.evaluate(async () => {
    const { drawingState } = await import("/src/features/workspace/editor-state.js");
    const { renderCurrentDrawing } = await import("/src/components/layout/workspace/canvas-render.js");

    drawingState.objects.length = 0;
    drawingState.selection.selectedObjectIds = [];
    const style = { stroke: "#000000", lineWidth: 0.5 };

    drawingState.objects.push(
        { id: "d1", type: "dimension", geometry: { start: { x: -100, y: 0 }, end: { x: 0, y: 0 }, offset: 20, kind: "horizontal" }, style, engineering: { value: 100 }, visible: true },
        { id: "d2", type: "dimension", geometry: { start: { x: -100, y: 60 }, end: { x: 0, y: 60 }, offset: 20, kind: "horizontal" }, style, engineering: { value: 100 }, visible: true },
        { id: "f1", type: "force", geometry: { start: { x: 0, y: -40 }, end: { x: 60, y: -40 }, magnitude: 60, angle: 0 }, style: { ...style, arrowheadSize: 9 }, engineering: { magnitude: 60, angle: 0 }, visible: true }
    );

    const canvas = document.querySelector(".drawing-canvas");
    const report = {};

    for (const zoom of [0.5, 1, 2, 4]) {
        drawingState.camera.zoom = zoom;
        renderCurrentDrawing();
        const overlay = canvas.querySelector("svg.drawing-overlay");
        const width = (element) => Math.round(element.getBoundingClientRect().height * 100) / 100;
        const poly = overlay.querySelectorAll('[data-feature-id="d1"] polygon');
        const force = overlay.querySelector('[data-feature-id="f1"] polygon');
        report[zoom] = {
            dimensionHeads: [...poly].map(width),
            forceHead: force ? width(force) : null,
            shas: [...overlay.querySelectorAll('[data-feature-id="d1"] [stroke-dasharray]')].map(n => n.getAttribute("stroke-dasharray"))
        };
    }
    return report;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
