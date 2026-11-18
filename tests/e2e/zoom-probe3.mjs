/* Temporary probe 3: fonts throughout a complex sheet. */
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
page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
page.on("console", (message) => {
    if (message.type() === "error") console.log("CONSOLE", message.text());
});

await page.goto(`http://localhost:${port}/index.html`);
await page.waitForTimeout(1000);

const result = await page.evaluate(async () => {
    const { drawingState } = await import("/src/features/workspace/editor-state.js");
    const { renderCurrentDrawing } = await import("/src/components/layout/workspace/canvas-render.js");

    drawingState.objects.length = 0;
    drawingState.selection.selectedObjectIds = [];
    const objects = drawingState.objects;

    const push = (object) => objects.push({ id: `probe-${objects.length}`, visible: true, ...object });
    const style = { stroke: "#000000", lineWidth: 0.5 };

    push({ type: "line", geometry: { start: { x: -150, y: 0 }, end: { x: 150, y: 0 } }, style });
    push({ type: "beam", geometry: { start: { x: -150, y: 0 }, end: { x: 150, y: 0 } }, style });
    push({ type: "pin-support", geometry: { position: { x: -100, y: 0 }, start: { x: -100, y: 0 }, end: { x: -100, y: -20 } }, style });
    push({ type: "roller-support", geometry: { position: { x: 100, y: 0 }, start: { x: 100, y: 0 }, end: { x: 100, y: -20 } }, style });
    push({ type: "moment", geometry: { position: { x: 20, y: 40 }, center: { x: 20, y: 40 }, radius: 12 }, style, engineering: { magnitude: 25 } });
    push({ type: "force", geometry: { start: { x: -60, y: 0 }, end: { x: -60, y: 40 }, magnitude: 30, angle: 90 }, style, engineering: { magnitude: 30, angle: 90 } });
    push({ type: "load", geometry: { start: { x: -140, y: -40 }, end: { x: 40, y: -40 }, direction: -Math.PI / 2 }, style, engineering: { intensity: 20 } });
    push({ type: "dimension", geometry: { start: { x: -60, y: 0 }, end: { x: 20, y: 0 }, offset: 25 }, style, engineering: {} });
    push({ type: "coordinate-system-2d", geometry: { origin: { x: -170, y: -80 }, axisLength: 30, xLabel: "X", yLabel: "Y" }, style });
    push({ type: "circle", geometry: { center: { x: 120, y: 70 }, radius: 15 }, style });

    const canvas = document.querySelector(".drawing-canvas");
    const report = {};

    for (const zoom of [0.5, 1, 2, 4]) {
        drawingState.camera.zoom = zoom;
        renderCurrentDrawing();
        const overlay = canvas.querySelector("svg.drawing-overlay");

        const fromTop = (element) => {
            const box = element.getBoundingClientRect();
            return { w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 };
        };

        const fonts = [...overlay.querySelectorAll("text")].map((node) => {
            const local = node.getBoundingClientRect();
            const scaleFactor = (() => {
                const own = Number(node.getAttribute("font-size"));
                const painted = local.height;
                return own > 0 ? Math.round((painted / own) * 1000) / 1000 : null;
            })();
            return {
                text: node.textContent.slice(0, 12),
                size: node.getAttribute("font-size"),
                transform: node.getAttribute("transform"),
                painted: Math.round(local.width * 10) / 10 + "x" + Math.round(local.height * 10) / 10,
                paintedPerDeclared: scaleFactor
            };
        });

        const shapes = {};
        overlay.querySelectorAll("[data-feature-id]").forEach((group) => {
            const first = group.querySelector("circle,rect,path,polyline,line,polygon");
            if (first) {
                shapes[group.dataset.featureId] = { tag: first.tagName, ...fromTop(first) };
            }
        });

        report[zoom] = { fonts, shapes, elements: overlay.querySelectorAll("*").length };
    }

    return report;
});

fs.writeFileSync(path.join(root, "tests", "e2e", "zoom-probe3.json"), JSON.stringify(result, null, 2));
await page.screenshot({ path: path.join(root, "tests", "e2e", "zoom-probe3.png") });
console.log("written");
await browser.close();
server.close();
