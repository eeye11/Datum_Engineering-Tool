/* Temporary: the force arrowhead's world size, and why it is not constant. */
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForTimeout(900);

const result = await page.evaluate(async () => {
    const { drawingState } = await import("/src/features/workspace/editor-state.js");
    const { renderCurrentDrawing } = await import("/src/components/layout/workspace/canvas-render.js");

    drawingState.objects.length = 0;
    drawingState.selection.selectedObjectIds = [];
    drawingState.objects.push({
        id: "f", type: "force",
        geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: -60 }, magnitude: 60, angle: -90 },
        engineering: { magnitude: 60, angle: -90 },
        style: { stroke: "#000000", lineWidth: 0.5, arrowheadSize: 9 },
        visible: true
    });

    const canvas = document.querySelector(".drawing-canvas");
    const out = {};

    for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
        drawingState.camera.zoom = zoom;
        renderCurrentDrawing();
        const overlay = canvas.querySelector("svg.drawing-overlay");
        const head = overlay.querySelector('[data-feature-id="f"] polygon');
        const box = head.getBBox();
        const points = (head.getAttribute("points") || "").split(/\s+/).map((pair) => pair.split(",").map(Number));
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const lengths = points.map((p, i) => {
            const next = points[(i + 1) % points.length];
            return Math.hypot(next[0] - p[0], next[1] - p[1]);
        });

        out[zoom] = {
            points,
            spanX: Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100,
            spanY: Math.round((Math.max(...ys) - Math.min(...ys)) * 100) / 100,
            worldSpanX: Math.round(((Math.max(...xs) - Math.min(...xs)) / zoom) * 100) / 100,
            worldSpanY: Math.round(((Math.max(...ys) - Math.min(...ys)) / zoom) * 100) / 100,
            sideLengths: lengths.map((v) => Math.round((v / zoom) * 100) / 100),
            bbox: { w: Math.round(box.width * 100) / 100, h: Math.round(box.height * 100) / 100 }
        };
    }

    return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
