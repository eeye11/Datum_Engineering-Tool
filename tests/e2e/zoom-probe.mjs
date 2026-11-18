/*
 * Temporary probe: render the real application and measure on-screen
 * proportions at several zooms. Not part of the suite.
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
    let file = path.join(root, url === "/" ? "index.html" : url);

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
page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
page.on("console", (message) => {
    if (message.type() === "error") console.log("CONSOLE", message.text());
});

await page.goto(`http://localhost:${port}/index.html`);
await page.waitForTimeout(1200);

const result = await page.evaluate(async () => {
    const drawingState = (await import("/src/features/workspace/editor-state.js")).drawingState;
    const renderCurrentDrawing = (await import("/src/components/layout/workspace/canvas-render.js")).renderCurrentDrawing;

    drawingState.objects.length = 0;
    drawingState.selection.selectedObjectIds = [];

    const objects = [
        {
            id: "probe-circle", type: "circle",
            geometry: { center: { x: 0, y: 0 }, radius: 20 },
            style: { stroke: "#000000", lineWidth: 0.5 }
        },
        {
            id: "probe-rect", type: "rectangle",
            geometry: { position: { x: -40, y: 60 }, width: 80, height: 40 },
            style: { stroke: "#000000", lineWidth: 0.5 }
        },
        {
            id: "probe-line", type: "line",
            geometry: { start: { x: -60, y: -40 }, end: { x: 60, y: -40 } },
            style: { stroke: "#000000", lineWidth: 0.5 }
        },
        {
            id: "probe-force", type: "force",
            geometry: { start: { x: -60, y: 90 }, end: { x: 0, y: 90 }, magnitude: 40, angle: 0 },
            style: { stroke: "#000000", lineWidth: 0.5, arrowheadSize: 9 }
        },
        {
            id: "probe-arc", type: "arc",
            geometry: { center: { x: 70, y: 0 }, radius: 20, startAngle: 0, endAngle: 3.14159 },
            style: { stroke: "#000000", lineWidth: 0.5 }
        }
    ];

    drawingState.objects.push(...objects);
    drawingState.camera.zoom = 1;
    drawingState.camera.panX = 0;
    drawingState.camera.panY = 0;
    renderCurrentDrawing();

    const canvas = document.querySelector(".drawing-canvas");
    const overlay = canvas.querySelector("svg.drawing-overlay");

    const report = {};

    for (const zoom of [0.5, 1, 2, 4]) {
        drawingState.camera.zoom = zoom;
        renderCurrentDrawing();

        const circle = overlay.querySelector('[data-feature-id="probe-circle"] circle');
        const rect = overlay.querySelector('[data-feature-id="probe-rect"] rect');
        const line = overlay.querySelector('[data-feature-id="probe-line"] line');
        const force = overlay.querySelector('[data-feature-id="probe-force"]');
        const arrow = force && force.querySelector("polygon");
        const arc = overlay.querySelector('[data-feature-id="probe-arc"] path');
        const text = overlay.querySelector("text");
        const forceText = force && force.querySelector("text");
        const measure = (element) => {
            const box = element.getBoundingClientRect();
            return { width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 };
        };

        report[zoom] = {
            circle: measure(circle),
            circleStroke: circle.getAttribute("stroke-width"),
            rect: measure(rect),
            rectStroke: rect.getAttribute("stroke-width"),
            lineStroke: line.getAttribute("stroke-width"),
            arrow: arrow ? { points: arrow.getAttribute("points"), box: measure(arrow) } : null,
            arcD: arc ? arc.getAttribute("d") : null,
            text: text ? measure(text) : null,
            textSize: text ? text.getAttribute("font-size") : null,
            forceText: forceText ? { size: forceText.getAttribute("font-size"), box: measure(forceText), content: forceText.textContent } : null
        };
    }

    return report;
});

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: path.join(root, "tests", "e2e", "zoom-probe.png"), fullPage: false });

await browser.close();
server.close();
