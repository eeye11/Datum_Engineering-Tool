import { chromium } from "@playwright/test";

const URL = process.argv[2] || "http://localhost:5201/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const tab = page.getByRole("button", { name: "Engineering Drawing" });
if (await tab.count()) await tab.first().click();
await page.waitForTimeout(600);
await page.locator(".drawing-canvas").first().waitFor({ timeout: 15000 });

const box = await page.locator(".drawing-canvas").first().boundingBox();
const at = (fx, fy) => ({
  x: box.x + box.width * fx,
  y: box.y + box.height * fy,
});

await page.evaluate(() => {
  const fluids = [...document.querySelectorAll(".drawing-category")].find(
    (el) => el.dataset.category === "FLUIDS",
  );
  if (fluids) fluids.click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const b = document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]');
  if (b) b.click();
});
await page.waitForTimeout(200);

/* Instrument the snap resolver to log what it receives. */
await page.evaluate(() => {
  window.__log = [];
});

const p1 = at(0.25, 0.42);
const p2 = at(0.6, 0.44);

await page.mouse.move(p1.x, p1.y);
await page.waitForTimeout(120);
await page.mouse.down();
await page.waitForTimeout(60);

/* Move in several steps and read the interaction + resolution each time. */
for (const [fx, fy] of [
  [0.35, 0.425],
  [0.45, 0.43],
  [0.55, 0.435],
  [0.6, 0.44],
]) {
  const p = at(fx, fy);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.waitForTimeout(120);
  const snap = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    return {
      activeTool: st.activeTool,
      fluidsTool: st.interaction.fluidsTool,
      phase: st.interaction.phase,
      startPoint: st.interaction.startPoint,
      routeSegmentStart: st.interaction.routeSegmentStart,
      previewEnd: st.interaction.preview && st.interaction.preview.geometry.end,
      snapGeometry: st.interaction.snapGeometry,
    };
  });
  console.log(JSON.stringify(snap));
}

await page.mouse.up();
await page.waitForTimeout(300);

const objs = await page.evaluate(() =>
  window.enggDrawing.state.objects
    .filter((o) => o.type === "pipe-duct")
    .map((o) => ({ start: o.geometry.start, end: o.geometry.end })),
);
console.log("COMMITTED:", JSON.stringify(objs));

await browser.close();
