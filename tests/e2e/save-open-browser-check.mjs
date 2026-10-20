// Real-browser check: a drawing saves as .tex, and that .tex - and an older
// .enggdraw - reopen with every feature, through the ordinary file input.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const url = process.argv[2] || "http://localhost:5173/";
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "daetum-save-open-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
/* No File System Access pickers: Save downloads and Open uses the file input, which Playwright can drive. */
await context.addInitScript(() => {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

const results = [];
const check = (label, ok, detail = "") => results.push(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);

async function boot() {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".drawing-canvas", { state: "attached" });
  await page.click("text=Engineering Drawing");
  await sleep(400);
}

const box = async () => page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

const summary = () => page.evaluate(() => window.enggDrawing.state.objects.map((o) => ({
  type: o.type,
  name: o.name,
  arrowLength: o.geometry?.arrowLength ?? null,
  start: o.geometry?.start ? { x: +o.geometry.start.x.toFixed(3), y: +o.geometry.start.y.toFixed(3) } : null,
  end: o.geometry?.end ? { x: +o.geometry.end.x.toFixed(3), y: +o.geometry.end.y.toFixed(3) } : null,
})));

const runMenu = async (id) => {
  if (!(await page.locator(`[data-menu-item="${id}"]`).count())) {
    await page.click('[data-menu-id="file"]'); await sleep(200);
  }
  return runMenuItem(id);
};
const runMenuItem = (id) => page.evaluate((itemId) => {
  const item = document.querySelector(`[data-menu-item="${itemId}"]`);
  if (!item) throw new Error(`no menu item ${itemId}`);
  item.click();
}, id);

async function openFile(filePath) {
  const chooser = page.waitForEvent("filechooser");
  await runMenu("open");
  /* File > Open may show the Open popup first; its own "browse" button raises the chooser. */
  const picked = await Promise.race([chooser, sleep(1500).then(() => null)]);
  const fc = picked || await (async () => {
    const again = page.waitForEvent("filechooser");
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) => /browse|open a (file|drawing)|from this computer|choose/i.test(b.textContent));
      if (!button) throw new Error("no browse button in the Open popup");
      button.click();
    });
    return again;
  })();
  await fc.setFiles(filePath);
  await sleep(1200);
}

/* ---- 1. draw: a beam and a point force through the toolbar ---- */
await boot();
const b = await box();
const P = (fx, fy) => ({ x: Math.round(b.x + b.w * fx), y: Math.round(b.y + b.h * fy) });
const drag = async (a, c) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 10 }); await sleep(80); await page.mouse.up(); await sleep(250); };
const acceptPopups = async () => {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => [...document.querySelectorAll(".drawing-creation-dimension, dialog[open], [role=dialog]")]
      .some((el) => getComputedStyle(el).display !== "none" && el.getClientRects().length > 0));
    if (!open) return;
    await page.keyboard.type("50"); await page.keyboard.press("Enter"); await sleep(150);
  }
};
const escape = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(50); } };

await page.click('.drawing-category[data-category="STATICS"]'); await sleep(80);
const section = page.locator("#statics-body-tools");
if (await section.evaluate((el) => el.hidden)) { await page.click('.drawing-tool[data-tool-id="body"]'); await sleep(120); }
await section.locator('.drawing-tool[data-tool-id="beam"]').first().click(); await sleep(150);
await drag(P(0.25, 0.6), P(0.7, 0.6)); await acceptPopups(); await escape();
await page.click('.drawing-tool[data-tool-id="point-force"]'); await sleep(150);
await drag(P(0.55, 0.6), P(0.55, 0.4)); await acceptPopups(); await escape();

const drawn = await summary();
check("drew a beam and a point force", drawn.some((o) => o.type === "beam") && drawn.some((o) => o.type === "force"), drawn.map((o) => o.type).join(", "));

/* ---- 2. Save: with no save picker, Save downloads the drawing ---- */
const download = page.waitForEvent("download", { timeout: 15000 });
await runMenu("save");
await sleep(400);
/* Save may ask for a name first; accept whatever it suggests. */
await page.keyboard.press("Enter").catch(() => {});
const saved = await download.catch(() => null);
let texPath = null;
if (saved) {
  texPath = path.join(workDir, saved.suggestedFilename());
  await saved.saveAs(texPath);
}
check("Save downloads a .tex", !!saved && /\.tex$/i.test(saved.suggestedFilename()), saved ? saved.suggestedFilename() : "no download");

const texText = texPath ? fs.readFileSync(texPath, "utf8") : "";
check("the .tex is LaTeX with a picture", /\\documentclass/.test(texText) && /\\begin\{tikzpicture\}/.test(texText));
check("the .tex carries the document block", /%% DAETUM-DOCUMENT-BEGIN daetum-document base64/.test(texText));
check("nothing in it is the retired format", !/enggdraw/i.test(texText));

/* ---- 3. reopen the .tex in a fresh page ---- */
await boot();
check("a fresh page starts empty", (await summary()).length === 0);
if (texPath) await openFile(texPath);
const reopened = await summary();
check("the .tex reopens with every feature", JSON.stringify(reopened) === JSON.stringify(drawn),
  JSON.stringify(reopened) === JSON.stringify(drawn) ? `${reopened.length} features, same geometry` : `drew ${JSON.stringify(drawn)} reopened ${JSON.stringify(reopened)}`);

/* ---- 4. an older .enggdraw opens as an import ---- */
const envelope = await page.evaluate(() => window.datum.getDocument());
const legacy = { ...envelope, format: "enggdraw", application: "EnggDraw" };
const legacyPath = path.join(workDir, "Old Beam.enggdraw");
fs.writeFileSync(legacyPath, JSON.stringify(legacy));
await boot();
await openFile(legacyPath);
const imported = await summary();
check("an .enggdraw opens with every feature", JSON.stringify(imported) === JSON.stringify(drawn), `${imported.length} features`);
const message = await page.evaluate(() => document.body.innerText.match(/older format[^\n]*/i)?.[0] || "");
check("and says it will be saved as .tex", /Old Beam\.tex/.test(message), message || "no message seen");

console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
