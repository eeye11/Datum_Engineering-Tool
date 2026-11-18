// Dumps the compiled Source for one Heat Source, so a bad node is read directly.
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  for (const options of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* next */
    }
  }
  throw new Error("no browser");
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".drawing-canvas", { state: "attached" });
await page.evaluate(() =>
  document.querySelector('.tab[data-tab="drawing"]')?.click(),
);
await sleep(1200);

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const P = (fx, fy) => ({
  x: Math.round(box.x + box.w * fx),
  y: Math.round(box.y + box.h * fy),
});

await page.click('.drawing-category[data-category="HEAT TRANSFER"]');
await sleep(200);
await page.locator('.drawing-tool[data-tool-id="heat-source-sink"]').click();
await sleep(200);
await page.locator('[data-tool-id="heat-source"]').first().click();
await sleep(200);

const at = P(0.4, 0.4);
await page.mouse.move(at.x, at.y);
await page.mouse.down();
await page.mouse.move(at.x + 2, at.y + 2, { steps: 3 });
await page.mouse.up();
await sleep(500);

await page.keyboard.press("Enter");
await sleep(600);

await page.click("#drawingPanelTabSource").catch(() => {});
await sleep(600);

const source = await page.evaluate(() => {
  const editor = document.querySelector("#drawingSourceEditor textarea");
  return editor ? editor.value : "(no source editor)";
});

console.log(source);
await browser.close();
