// Real-browser check: the Annotate Text tool must open an INLINE editor on the
// canvas - never a modal - and the formatting strip must appear while it is open.
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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".drawing-canvas", { state: "attached" });
await page.evaluate(() => document.querySelector('.tab[data-tab="drawing"]')?.click());
await sleep(1200);

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const P = (fx, fy) => ({ x: Math.round(box.x + box.w * fx), y: Math.round(box.y + box.h * fy) });

const results = [];
const record = (ok, label, detail) => results.push(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);

/* ---- Annotate â†’ Note / Text ---- */

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(200);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(200);

const at = P(0.35, 0.4);
await page.mouse.click(at.x, at.y);
await sleep(400);

const dom = await page.evaluate(() => ({
  inlineField: Boolean(document.querySelector(".drawing-canvas-text-editor #noteText")),
  modal: Boolean(
    document.querySelector("dialog[open], [role=dialog]:not(.drawing-text-format-toolbar)"),
  ),
  toolbar: Boolean(document.querySelector(".drawing-text-format-toolbar")),
  activeId: document.activeElement?.id || null,
}));

record(dom.inlineField, "the Text tool opens an INLINE field on the canvas", JSON.stringify(dom));
record(!dom.modal, "no modal dialog is opened");
record(dom.toolbar, "the formatting strip appears while editing");
record(dom.activeId === "noteText", "the caret is in the field", String(dom.activeId));

/* Typing goes into the field, not the canvas. */
await page.keyboard.type("Hello DAETUM");
await sleep(250);

const typed = await page.evaluate(() => {
  const input = document.querySelector("#noteText");
  return input ? input.value : "(no field)";
});

record(typed === "Hello DAETUM", "typing appears in the field", JSON.stringify(typed));

/* The formatting strip changes the size live. */
const sizeBefore = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  const o = s?.objects.find((x) => x.annotateKind === "note");
  return o?.style?.fontSize || null;
});

await page.evaluate(() => {
  const select = [...document.querySelectorAll(".drawing-text-format-toolbar select")][1];
  if (select) {
    select.value = "24";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await sleep(250);

const sizeAfter = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  const o = s?.objects.find((x) => x.annotateKind === "note");
  return o?.style?.fontSize || null;
});

record(
  Number(sizeAfter) === 24,
  "the formatting strip writes the object's size live",
  `${sizeBefore} -> ${sizeAfter}`,
);

/* Commit with Escape's counterpart: press Enter closes a single-line field. */
await page.keyboard.press("Escape");
await sleep(300);

const afterCommit = await page.evaluate(() => ({
  toolbar: Boolean(document.querySelector(".drawing-text-format-toolbar")),
  inlineField: Boolean(document.querySelector(".drawing-canvas-text-editor #noteText")),
}));

record(!afterCommit.toolbar, "the formatting strip goes away when editing ends", JSON.stringify(afterCommit));

await page.screenshot({ path: "annotate-text-browser.png" });
console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
