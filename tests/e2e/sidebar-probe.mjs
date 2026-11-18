/*
 * Temporary probe: drag both sidebars, check the canvas takes the difference,
 * that each moves independently, and that the drawing's geometry is untouched.
 */
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (message) => {
    if (message.type() === "error") console.log("CONSOLE", message.text());
});
page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForTimeout(900);

/* Give the sheet something to draw, and record where it is. */
await page.evaluate(async () => {
    const { drawingState } = await import("/src/features/workspace/editor-state.js");
    const { renderCurrentDrawing } = await import("/src/components/layout/workspace/canvas-render.js");

    drawingState.objects.length = 0;
    drawingState.selection.selectedObjectIds = [];
    drawingState.objects.push({
        id: "probe-circle", type: "circle",
        geometry: { center: { x: 0, y: 0 }, radius: 30 },
        style: { stroke: "#000000", lineWidth: 0.5 },
        visible: true
    });

    window.__redraw = renderCurrentDrawing;
    renderCurrentDrawing();
});

const measure = () =>
    page.evaluate(() => {
        const canvas = document.querySelector(".drawing-canvas");
        const left = document.querySelector(".drawing-panel-rail-left").getBoundingClientRect();
        const right = document.querySelector(".drawing-panel-rail-right").getBoundingClientRect();
        const circle = document.querySelector('svg.drawing-overlay [data-feature-id="probe-circle"] circle');
        const box = circle.getBoundingClientRect();
        const { drawingState } = window.__state || {};

        return {
            canvas: Math.round(canvas.getBoundingClientRect().width * 10) / 10,
            leftRail: Math.round(left.width * 10) / 10,
            rightRail: Math.round(right.width * 10) / 10,
            circle: Math.round(box.width * 10) / 10,
            zoom: drawingState ? drawingState.camera.zoom : null,
            shapeTag: circle.tagName
        };
    });

const drag = async (handleId, deltaX) => {
    const handle = await page.$(`#${handleId}`);
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + 200;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
};

const before = await measure();

await drag("drawingToolPanelResizer", 80);
const afterLeft = await measure();

await drag("drawingFeaturesPanelResizer", -90);
const afterBoth = await measure();

/* And the limits: drag far past the maximum, then far past the minimum. */
await drag("drawingToolPanelResizer", 800);
const atMax = await measure();

await drag("drawingToolPanelResizer", -1200);
const atMin = await measure();

console.log(JSON.stringify({ before, afterLeft, afterBoth, atMax, atMin }, null, 2));

await browser.close();
server.close();
