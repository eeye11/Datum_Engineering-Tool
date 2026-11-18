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

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(200);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(200);

const at = {
  x: Math.round(box.x + box.w * 0.4),
  y: Math.round(box.y + box.h * 0.5),
};

await page.mouse.move(at.x - 12, at.y - 12);
await sleep(80);
await page.mouse.click(at.x, at.y);
await sleep(450);

await page.keyboard.type("Note");
await sleep(350);

const report = await page.evaluate(() => {
  const canvas = document.querySelector(".drawing-canvas");
  const out = [];

  /* EVERY visible box-like thing inside the canvas. */
  canvas.querySelectorAll("*").forEach((node) => {
    const r = node.getBoundingClientRect();
    const style = getComputedStyle(node);

    const visible =
      r.width > 1 &&
      r.height > 1 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0.05;

    if (!visible) return;

    const bordered =
      style.borderBottomWidth !== "0px" ||
      style.outlineStyle !== "none" ||
      style.borderTopWidth !== "0px";

    const isText = node.tagName.toLowerCase() === "text";
    const isEditor = node.id === "noteText" || node.closest("#noteText");

    if (isText || isEditor || bordered) {
      out.push({
        tag: node.tagName.toLowerCase(),
        id: node.id || null,
        cls: String(node.className?.baseVal ?? node.className ?? "").slice(
          0,
          60,
        ),
        text: (node.textContent || "").slice(0, 24),
        rect: {
          x: Math.round(r.left - canvas.getBoundingClientRect().left),
          y: Math.round(r.top - canvas.getBoundingClientRect().top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        border: `${style.borderBottomWidth} ${style.borderBottomStyle}`,
        outline: `${style.outlineWidth} ${style.outlineStyle}`,
        fontSize: style.fontSize,
      });
    }
  });

  return out;
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
