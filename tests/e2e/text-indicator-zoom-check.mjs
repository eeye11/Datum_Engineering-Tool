// The same "one insertion point" rule at four zoom levels, and for a second
// text tool (a Heat Transfer label), so the fix is not Annotate-specific.
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".drawing-canvas", { state: "attached" });
await page.evaluate(() =>
  document.querySelector('.tab[data-tab="drawing"]')?.click(),
);
await sleep(1200);

const results = [];
const record = (ok, label, detail) =>
  results.push(
    `${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`,
  );

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

const setZoom = async (zoom) => {
  await page.evaluate((z) => {
    const s = window.enggDrawing?.state;
    if (s) s.camera.zoom = z;
    window.enggDrawing?.render?.();
  }, zoom);
  await sleep(300);
};

const indicators = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".drawing-canvas");

    return {
      preview:
        canvas?.querySelectorAll(".drawing-annotation-preview").length ?? 0,
      editors: document.querySelectorAll(
        ".drawing-canvas-text-editor, .drawing-inline-entry, .drawing-label-entry",
      ).length,
    };
  });

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(200);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(200);

for (const zoom of [0.25, 0.5, 1, 2, 4]) {
  await setZoom(zoom);

  /* A fresh spot each time, so each run is independent. */
  const x = box.x + box.w * (0.3 + zoom * 0.02);
  const y = box.y + box.h * (0.3 + zoom * 0.02);

  await page.mouse.move(x - 10, y - 10);
  await sleep(80);
  await page.mouse.click(x, y);
  await sleep(350);

  const state = await indicators();

  record(
    state.editors === 1 && state.preview === 0,
    `at ${zoom * 100}% zoom: one editor, no second indicator`,
    JSON.stringify(state),
  );

  await page.keyboard.press("Escape");
  await sleep(250);
}

/* ---- and a different tool: a Heat Transfer circuit node ---- */

await page.click('.drawing-category[data-category="HEAT TRANSFER"]');
await sleep(250);
await page.click('.drawing-tool[data-tool-id="thermal-circuit-node"]');
await sleep(250);

const nodeAt = {
  x: box.x + box.w * 0.6,
  y: box.y + box.h * 0.6,
};

await page.mouse.move(nodeAt.x - 10, nodeAt.y - 10);
await sleep(80);
await page.mouse.click(nodeAt.x, nodeAt.y);
await sleep(500);

const heat = await indicators();

record(
  heat.editors === 1,
  "a Heat Transfer label opens ONE editor",
  JSON.stringify(heat),
);

/* Its label must be drawn once, not twice. */
const labelCount = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  return s?.objects.filter((o) => o.metadata?.heatParentId).length ?? 0;
});

record(
  labelCount === 1,
  "exactly one label object exists for the node",
  String(labelCount),
);

await page.keyboard.press("Escape");
await sleep(200);

console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
