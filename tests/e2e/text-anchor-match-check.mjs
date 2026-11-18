/*
 * THE TEXT IS WHERE YOU TYPED IT.
 *
 * One measurement frame - the canvas's own pixel space - for everything: the
 * click, the projected world anchor, the editing field, and the committed word.
 *
 * THE TOLERANCE IS HALF A LINE, AND IT MEANS THE SAME PLACE. An HTML field's
 * `top` is the top of its line box; the committed <text> is anchored on the
 * line's VERTICAL MIDDLE (dominant-baseline: middle). Half a font size apart in
 * `top` is therefore the same physical position, not a jump - so the field's top
 * must be the anchor's y MINUS half the font size.
 */
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
await sleep(1300);

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

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(200);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(200);

/* ---- the same place at four zooms ---- */

for (const zoom of [0.25, 1, 2, 4]) {
  await setZoom(zoom);

  const word = `w${String(zoom).replace(".", "")}`;
  const at = {
    x: Math.round(box.x + box.w * 0.3),
    y: Math.round(box.y + box.h * 0.6),
  };

  await page.mouse.move(at.x - 12, at.y - 12);
  await sleep(80);
  await page.mouse.click(at.x, at.y);
  await sleep(420);

  const field = await page.evaluate(() => {
    const host = document.querySelector(
      ".drawing-inline-entry, .drawing-label-entry, .drawing-canvas-text-editor",
    );
    const s = window.enggDrawing?.state;
    const size =
      Number(
        s?.objects.find((o) => o.annotateKind === "note")?.style?.fontSize,
      ) || 16;

    return host
      ? {
          left: parseFloat(host.style.left),
          top: parseFloat(host.style.top),
          size,
        }
      : null;
  });

  await page.keyboard.type(word);
  await sleep(200);
  await page.keyboard.press("Enter");
  await sleep(450);

  const placed = await page.evaluate((text) => {
    const canvas = document.querySelector(".drawing-canvas");
    const node = [...canvas.querySelectorAll("text")].find(
      (c) => c.textContent === text,
    );

    return node
      ? { x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")) }
      : null;
  }, word);

  if (!field || !placed) {
    record(
      false,
      `zoom ${zoom}: could not measure`,
      JSON.stringify({ field, placed }),
    );
    continue;
  }

  /* The field's top is the anchor raised by HALF A LINE, and nothing else. */
  const dx = Math.abs(field.left - placed.x);
  const dy = Math.abs(field.top - (placed.y - field.size / 2));

  record(
    dx <= 1 && dy <= 2,
    `zoom ${zoom}: the field sits exactly on the committed word`,
    `field=(${field.left},${field.top}) word=(${placed.x},${placed.y}) ` +
      `expected top=${placed.y - field.size / 2} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`,
  );
}

/* ---- and after a pan ---- */

await setZoom(1);

await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  if (s) s.camera.panX = 37;
  window.enggDrawing?.render?.();
});
await sleep(350);

{
  const word = "panned";
  const at = {
    x: Math.round(box.x + box.w * 0.55),
    y: Math.round(box.y + box.h * 0.35),
  };

  await page.mouse.move(at.x - 12, at.y - 12);
  await sleep(80);
  await page.mouse.click(at.x, at.y);
  await sleep(420);

  const field = await page.evaluate(() => {
    const host = document.querySelector(
      ".drawing-inline-entry, .drawing-label-entry, .drawing-canvas-text-editor",
    );

    return host
      ? { left: parseFloat(host.style.left), top: parseFloat(host.style.top) }
      : null;
  });

  await page.keyboard.type(word);
  await sleep(200);
  await page.keyboard.press("Enter");
  await sleep(450);

  const placed = await page.evaluate((text) => {
    const canvas = document.querySelector(".drawing-canvas");
    const node = [...canvas.querySelectorAll("text")].find(
      (c) => c.textContent === text,
    );

    return node
      ? { x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")) }
      : null;
  }, word);

  record(
    Boolean(field && placed && Math.abs(field.left - placed.x) <= 1),
    "after a pan, the field is still on the word's column",
    JSON.stringify({ field, placed }),
  );
}

/* ---- no duplicate indicators ---- */

const counts = await page.evaluate(() => ({
  editors: document.querySelectorAll(
    ".drawing-inline-entry, .drawing-label-entry, .drawing-canvas-text-editor",
  ).length,
  previews:
    document
      .querySelector(".drawing-canvas")
      ?.querySelectorAll(".drawing-annotation-preview").length ?? 0,
}));

record(counts.editors === 0, "no editor is left open", JSON.stringify(counts));

console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
