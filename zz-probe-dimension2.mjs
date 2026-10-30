import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://localhost:5199/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.click("text=Engineering Drawing");
await page.waitForTimeout(900);

const lineId = await page.evaluate(() => {
    const S = window.enggDrawingStateLive;
    const line = window.enggDrawingState.geometryFactories.line({
        start: { x: 20, y: 20 },
        end: { x: 120, y: 20 },
    });
    window.enggDrawingState.addObject(S, line);
    window.enggDrawingRenderer.renderDrawing?.();
    document.querySelector('[data-category="GEOMETRY"]')?.click();
    return line.id;
});
await page.waitForTimeout(300);

await page.evaluate(() => {
    const b = [...document.querySelectorAll(".drawing-tool")].find(
        (el) => el.dataset.toolId === "dimension",
    );
    if (b) b.click();
});
await page.waitForTimeout(300);
console.log("active", await page.evaluate(() => window.enggDrawingStateLive.activeTool));

const spot = await page.evaluate((id) => {
    const S = window.enggDrawingStateLive;
    const line = S.objects.find((o) => o.id === id);
    if (!line) return { a: null, b: null, ids: S.objects.map((o) => o.id + ":" + o.type) };
    const el = document.querySelector(".drawing-canvas");
    const rr = el.getBoundingClientRect();
    const a = window.enggDrawingState.engineeringToScreen(line.geometry.start, { width: rr.width, height: rr.height }, S);
    const b = window.enggDrawingState.engineeringToScreen(line.geometry.end, { width: rr.width, height: rr.height }, S);
    return { a: { x: rr.left + a.x, y: rr.top + a.y }, b: { x: rr.left + b.x, y: rr.top + b.y } };
}, lineId);
console.log("line at", JSON.stringify(spot));

if (!spot.a || !spot.b) {
    console.log(errors.join("\n"));
    await browser.close();
    process.exit(1);
}

const mid = { x: (spot.a.x + spot.b.x) / 2, y: spot.a.y };
await page.mouse.move(mid.x, mid.y, { steps: 4 });
await page.waitForTimeout(120);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(400);
console.log(
    "after ref",
    JSON.stringify(
        await page.evaluate(() => ({
            stage: window.enggDrawingStateLive.interaction.dimensionStage,
            refs: window.enggDrawingStateLive.interaction.dimensionPickedRefs?.length,
        })),
    ),
);

const away = { x: mid.x, y: mid.y + 120 };
await page.mouse.move(away.x, away.y, { steps: 6 });
await page.waitForTimeout(120);
await page.mouse.click(away.x, away.y);
await page.waitForTimeout(700);

console.log(
    "after place",
    JSON.stringify(
        await page.evaluate(() => ({
            objects: window.enggDrawingStateLive.objects.map((o) => o.type),
            field: document.querySelector(".drawing-dimension-text-entry")?.textContent ?? null,
            popup: Boolean(document.querySelector(".drawing-creation-dimension")),
        })),
    ),
);

await page.screenshot({ path: "zz-dimension-field.png" });

const field = page.locator(".drawing-dimension-text-entry");
if (await field.count()) {
    await field.click();
    await page.keyboard.type("L = 100 mm");
    await field.press("Enter");
    await page.waitForTimeout(400);
    console.log(
        "after typing",
        JSON.stringify(
            await page.evaluate(() => ({
                label: window.enggDrawingStateLive.objects.find((o) => o.type === "dimension")?.label,
                field: Boolean(document.querySelector(".drawing-dimension-text-entry")),
                objects: window.enggDrawingStateLive.objects.length,
            })),
        ),
    );
    await page.screenshot({ path: "zz-dimension-field2.png" });
}

console.log(errors.join("\n"));
await browser.close();
