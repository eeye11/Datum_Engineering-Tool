// Real-browser check: draw Statics objects through the toolbar, keep the pointer
// moving, and confirm Source and the compiled Drawing Space agree after each step.
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://localhost:5173/";
const shotDir = process.argv[3] || ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Playwright's own Chromium if it is installed, otherwise the system's Edge or Chrome. */
async function launch() {
  for (const options of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("No browser available: run `npx playwright install chromium`.");
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".drawing-canvas", { state: "attached" });
await page.click("text=Engineering Drawing");
await sleep(400);

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const P = (fx, fy) => ({ x: Math.round(box.x + box.w * fx), y: Math.round(box.y + box.h * fy) });

const click = async (pt) => { await page.mouse.move(pt.x - 3, pt.y - 2); await sleep(40); await page.mouse.move(pt.x, pt.y); await sleep(40); await page.mouse.click(pt.x, pt.y); await sleep(150); };
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 10 }); await sleep(80); await page.mouse.up(); await sleep(200); };
const escape = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(50); } };
const acceptPopups = async () => {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => [...document.querySelectorAll(".drawing-creation-dimension, dialog[open], [role=dialog]")]
      .some((el) => getComputedStyle(el).display !== "none" && el.getClientRects().length > 0));
    if (!open) return;
    await page.keyboard.type("50"); await page.keyboard.press("Enter"); await sleep(150);
  }
};
const chooseTool = async (category, toolId, sub) => {
  await page.click(`.drawing-category[data-category="${category}"]`); await sleep(80);
  const section = page.locator(`#statics-${toolId}-tools`);
  if (sub && await section.count() && await section.locator(`[data-tool-id="${sub}"]`).count()) {
    if (await section.evaluate((el) => el.hidden)) { await page.click(`.drawing-tool[data-tool-id="${toolId}"]`); await sleep(120); }
    await section.locator(`.drawing-tool[data-tool-id="${sub}"]`).first().click(); await sleep(150);
    return;
  }
  await page.click(`.drawing-tool[data-tool-id="${toolId}"]`); await sleep(150);
};

/* What the page shows right now. */
const state = () => page.evaluate(() => {
  const layer = document.querySelector(".drawing-canvas > svg.drawing-source-layer");
  const editor = document.querySelector("#drawingSourceEditor textarea");
  return {
    objects: window.enggDrawing.state.objects.map((o) => o.type),
    source: editor ? editor.value : "",
    status: document.getElementById("drawingSourceStatus")?.textContent.trim(),
    diagnostics: document.getElementById("drawingSourceDiagnostics")?.textContent.trim(),
    picture: layer ? layer.innerHTML.length : 0,
    pictureHash: layer ? [...layer.innerHTML].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) : 0,
  };
});

/* Wiggle the pointer over the canvas (the old starvation trigger) until the picture settles. */
async function settleWhileMoving(previousHash, label) {
  const deadline = Date.now() + 25000;
  let i = 0;
  while (Date.now() < deadline) {
    const pt = P(0.85 + 0.05 * Math.sin(i / 3), 0.15 + 0.05 * Math.cos(i / 3)); i++;
    await page.mouse.move(pt.x, pt.y);
    await sleep(40);
    const s = await state();
    if (/Rendered/.test(s.status) && s.pictureHash !== previousHash && s.picture > 0) return s;
  }
  const s = await state();
  await page.screenshot({ path: `${shotDir}/browser-fail.png` }); throw new Error(`${label}: the Drawing Space did not catch up with Source (status "${s.status}", picture ${s.picture} chars)\n${s.diagnostics}`);
}

await page.click("#drawingPanelTabSource"); await sleep(200);

const results = [];
let last = await state();
const step = async (label, action, expectType) => {
  const before = last;
  await action();
  await escape();
  const after = await settleWhileMoving(before.pictureHash, label);
  const added = after.objects.length - before.objects.length;
  const ok = after.objects.includes(expectType) && after.source !== before.source && !/error/i.test(after.status);
  results.push(`${ok ? "OK  " : "FAIL"} ${label}: objects ${before.objects.length}->${after.objects.length} (+${added}), source ${before.source.length}->${after.source.length} chars, picture redrawn, status "${after.status}"`);
  last = after;
};

await step("Beam", async () => { await chooseTool("STATICS", "body", "beam"); await drag(P(0.25, 0.6), P(0.7, 0.6)); await acceptPopups(); }, "beam");
await step("Point Force", async () => { await chooseTool("STATICS", "point-force"); await drag(P(0.55, 0.6), P(0.55, 0.4)); await acceptPopups(); }, "force");
await step("Pin Support", async () => { await chooseTool("STATICS", "support", "pin-support"); await click(P(0.4, 0.6)); await click(P(0.25, 0.6)); await acceptPopups(); }, "pin-support");
await step("Distributed Load", async () => { await chooseTool("STATICS", "load", "distributed-load"); await click(P(0.35, 0.6)); await click(P(0.3, 0.6)); await click(P(0.6, 0.6)); await page.keyboard.type("25"); await page.keyboard.press("Enter"); await sleep(150); await click(P(0.45, 0.4)); await acceptPopups(); }, "load");
await step("Moment", async () => { await chooseTool("STATICS", "moment"); await click(P(0.62, 0.6)); await acceptPopups(); }, "moment");
await step("Reference Line", async () => { await chooseTool("STATICS", "reference-line"); await drag(P(0.3, 0.8), P(0.6, 0.8)); await acceptPopups(); }, "line");

await page.screenshot({ path: `${shotDir}/browser-after-create.png` });

/* Delete the Point Force: it must leave the model, Source and the picture together. */
const before = last;
const forceId = await page.evaluate(() => window.enggDrawing.state.objects.find((o) => o.type === "force")?.id);
await page.evaluate((id) => { const s = window.enggDrawing.state; s.selection.selectedObjectIds = [id]; }, forceId);
await page.mouse.move(P(0.85, 0.15).x, P(0.85, 0.15).y);
await page.keyboard.press("Delete");
const afterDelete = await settleWhileMoving(before.pictureHash, "Delete Point Force");
const gone = !afterDelete.objects.includes("force") && afterDelete.objects.length === before.objects.length - 1;
results.push(`${gone && afterDelete.source.length < before.source.length ? "OK  " : "FAIL"} Delete Point Force: objects ${before.objects.length}->${afterDelete.objects.length}, source ${before.source.length}->${afterDelete.source.length} chars, picture redrawn, status "${afterDelete.status}"`);

await page.screenshot({ path: `${shotDir}/browser-after-delete.png` });
console.log(results.join("\n"));
console.log("final object types:", afterDelete.objects.join(", "));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
