// WHERE THE TEXT APPEARS WHILE TYPING MUST BE WHERE IT IS COMMITTED.
//
// The editor box is measured while it is open; the committed word is measured
// from the canvas SVG after Enter. They must agree, at four zoom levels.
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
await page.evaluate(() =>
  document.querySelector('.tab[data-tab="drawing"]')?.click(),
);
await sleep(1200);

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

const results = [];
const record = (ok, label, detail) =>
  results.push(
    `${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`,
  );

const setZoom = async (zoom) => {
  await page.evaluate((z) => {
    const s = window.enggDrawing?.state;
    if (s) s.camera.zoom = z;
    window.enggDrawing?.render?.();
  }, zoom);
  await sleep(300);
};

/* The editor box's on-screen rect, while it is open. */
const editorRect = () =>
  page.evaluate(() => {
    const host = document.querySelector(
      ".drawing-inline-entry, .drawing-label-entry, .drawing-canvas-text-editor",
    );

    if (!host) {
      return null;
    }

    const r = host.getBoundingClientRect();

    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

/* The committed word's on-screen rect, from the canvas SVG. */
const committedRect = (word) =>
  page.evaluate((text) => {
    const canvas = document.querySelector(".drawing-canvas");
    const node = [...canvas.querySelectorAll("text")].find(
      (candidate) => candidate.textContent === text,
    );

    if (!node) {
      return null;
    }

    const r = node.getBoundingClientRect();

    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, word);

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(200);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(200);

for (const zoom of [0.5, 1, 2, 4]) {
  await setZoom(zoom);

  const word = `z${String(zoom).replace(".", "")}`;
  const at = {
    x: Math.round(box.x + box.w * 0.4),
    y: Math.round(box.y + box.h * 0.45),
  };

  await page.mouse.move(at.x - 12, at.y - 12);
  await sleep(80);
  await page.mouse.click(at.x, at.y);
  await sleep(400);

  const open = await editorRect();

  /* Type the word, then commit. */
  await page.keyboard.type(word);
  await sleep(250);

  const typing = await editorRect();

  await page.keyboard.press("Enter");
  await sleep(450);

  const placed = await committedRect(word);

  if (!open || !typing || !placed) {
    record(
      false,
      `zoom ${zoom}: could not measure`,
      JSON.stringify({ open, typing, placed }),
    );
    continue;
  }

  /*
   * THE TWO RECTS MUST OVERLAP AT THE SAME CORNER.
   *
   * A few pixels of tolerance: the glyph box and the field box are different
   * kinds of box, but their origin must be the same PLACE. More than a couple
   * of pixels is the jump this check exists to catch.
   */
  const dx = Math.abs(typing.left - placed.left);
  const dy = Math.abs(typing.top - placed.top);

  record(
    dx <= 8 && dy <= 12,
    `zoom ${zoom}: the words appear where they were typed`,
    `typed at (${Math.round(typing.left)},${Math.round(typing.top)}) ` +
      `committed at (${Math.round(placed.left)},${Math.round(placed.top)}) ` +
      `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`,
  );
}

await page.screenshot({ path: "text-position-match.png" });
console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
