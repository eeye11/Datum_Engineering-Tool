import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://localhost:5199/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 200)));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.click("text=Engineering Drawing");
await page.waitForTimeout(900);

await page.evaluate(() => {
    const S = window.enggDrawingStateLive;
    window.enggDrawingState.addObject(
        S,
        window.enggDrawingState.geometryFactories.line({ x: 20, y: 20 }, { x: 120, y: 20 }, {}),
    );
    window.enggDrawingRenderer.renderDrawing?.();
    document.querySelector('[data-category="ANNOTATE"]')?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
    [...document.querySelectorAll(".drawing-tool")].find((el) => el.dataset.toolId === "dimension")?.click();
});
await page.waitForTimeout(300);

const spot = await page.evaluate(() => {
    const S = window.enggDrawingStateLive;
    const rr = document.querySelector(".drawing-canvas").getBoundingClientRect();
    const bounds = { width: rr.width, height: rr.height };
    const line = S.objects.find((o) => o.type === "line");
    const a = window.enggDrawingState.engineeringToScreen(line.geometry.start, bounds, S);
    const b = window.enggDrawingState.engineeringToScreen(line.geometry.end, bounds, S);
    return { a: { x: rr.left + a.x, y: rr.top + a.y }, b: { x: rr.left + b.x, y: rr.top + b.y } };
});

const mid = { x: (spot.a.x + spot.b.x) / 2, y: spot.a.y };
await page.mouse.move(mid.x, mid.y, { steps: 4 });
await page.waitForTimeout(120);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(300);
await page.mouse.move(mid.x, mid.y + 90, { steps: 6 });
await page.waitForTimeout(120);
await page.mouse.click(mid.x, mid.y + 90);
await page.waitForTimeout(800);`r`nawait page.keyboard.type("L = 100 mm");`r`nawait page.keyboard.press("Enter");`r`nawait page.waitForTimeout(500);

console.log(JSON.stringify(await page.evaluate(() => {
    const box = document.querySelector(".drawing-dimension-text-entry");
    return {
      debug: globalThis.__dimCommitDebug ?? null,
      tag: box?.tagName,
        contenteditable: box?.getAttribute("contenteditable"),
        text: box?.textContent,
        selection: window.getSelection()?.toString(),
        active: document.activeElement === box,
        popup: Boolean(document.querySelector(".drawing-creation-dimension")),
        objects: window.enggDrawingStateLive.objects.map((o) => o.type),
        bodyTail: [...document.body.children].slice(-3).map((n) => `${n.tagName}#${n.id}.${n.className}`),
    };
})));

await browser.close();
