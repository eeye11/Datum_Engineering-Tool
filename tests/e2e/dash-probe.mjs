/* Temporary probe 5: dash patterns and symbol pens across zooms. */
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
    drawingState.objects.push(
        { id: "dash", type: "line", geometry: { start: { x: -100, y: 0 }, end: { x: 100, y: 0 } }, style: { stroke: "#000000", lineWidth: 0.5, lineType: "dashed" }, visible: true },
        { id: "pin", type: "pin-support", geometry: { position: { x: 0, y: 40 }, start: { x: 0, y: 40 }, end: { x: 0, y: 20 } }, style: { stroke: "#000000", lineWidth: 0.5 }, visible: true }
    );

    const canvas = document.querySelector(".drawing-canvas");
    const report = {};
    for (const zoom of [0.5, 1, 2, 4]) {
        drawingState.camera.zoom = zoom;
        renderCurrentDrawing();
        const overlay = canvas.querySelector("svg.drawing-overlay");
        const dashLine = overlay.querySelector('[data-feature-id="dash"] line');
        const pin = overlay.querySelector('[data-feature-id="pin"]');
        const tri = pin?.querySelector("polygon");
        const triStroke = tri && tri.getAttribute("stroke-width");
        const dash = dashLine.getAttribute("stroke-dasharray");
        const painted = dashLine.getBoundingClientRect();
        report[zoom] = {
            dashArray: dash,
            dashWorld: dash && dash.split(" ").map(v => Math.round((Number(v) / zoom) * 100) / 100),
            linePaintedWidth: Math.round(painted.width * 10) / 10,
            lineStroke: dashLine.getAttribute("stroke-width"),
            pinStroke: triStroke,
            pinStrokeWorld: triStroke ? Math.round((Number(triStroke) / zoom) * 1000) / 1000 : null,
            pinHeight: tri ? Math.round(tri.getBoundingClientRect().height * 10) / 10 : null
        };
    }
    return report;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();