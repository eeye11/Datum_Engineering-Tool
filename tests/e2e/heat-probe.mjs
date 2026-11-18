/* Temporary probe 6: heat / fluids / thermodynamics marks across zooms. */
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

    const objects = [
        { id: "wall", type: "wall-slab", geometry: { start: { x: -60, y: 0 }, end: { x: 60, y: 0 }, thickness: 12 }, style, visible: true },
        { id: "node", type: "thermal-circuit-node", geometry: { center: { x: 0, y: 60 } }, style, visible: true },
        { id: "arrow", type: "thermal-arrow", geometry: { start: { x: -40, y: -40 }, end: { x: 40, y: -40 } }, style, visible: true },
        { id: "pipe", type: "pipe-duct", geometry: { start: { x: -60, y: 120 }, end: { x: 60, y: 120 }, width: 14 }, style, visible: true },
        { id: "level", type: "fluid-level", geometry: { position: { x: -80, y: 120 }, width: 40, height: 30 }, style, visible: true },
        { id: "tank", type: "tank", geometry: { position: { x: 80, y: 160 }, width: 50, height: 40 }, style, visible: true }
    ];

    drawingState.objects.push(...objects);

    const canvas = document.querySelector(".drawing-canvas");
    const report = {};
    for (const zoom of [0.5, 1, 2, 4]) {
        drawingState.camera.zoom = zoom;
        renderCurrentDrawing();
        const overlay = canvas.querySelector("svg.drawing-overlay");
        const entry = {};
        objects.forEach((object) => {
            const group = overlay.querySelector(`[data-feature-id="${object.id}"]`);
            if (!group) {
                entry[object.id] = "MISSING";
                return;
            }
            const shape = group.querySelector("circle,rect,path,polyline,line,polygon");
            if (!shape) {
                entry[object.id] = "NO SHAPE";
                return;
            }
            const box = shape.getBoundingClientRect();
            entry[object.id] = {
                tag: shape.tagName,
                w: Math.round((box.width / zoom) * 100) / 100,
                h: Math.round((box.height / zoom) * 100) / 100,
                stroke: shape.getAttribute("stroke-width")
            };
        });
        report[zoom] = entry;
    }
    return report;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();