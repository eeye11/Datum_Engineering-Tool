/*
 * ONE BOX, ONE SIZE.
 *
 * The editing field and the committed words must agree in BOTH senses:
 *
 *   SIZE      the field renders at the same font size the drawing will use
 *   WIDTH     the field's box is as wide as the text, with no padding
 *   BOXES     there is exactly one element on the canvas while editing
 *
 * The last one is the "two rectangles" complaint: a second bordered element
 * beside the first is a duplicate however well it is aligned.
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
await sleep(420);

/* Type a long word, so a width comparison is meaningful. */
await page.keyboard.type("Measurement");
await sleep(300);

const during = await page.evaluate(() => {
  const canvas = document.querySelector(".drawing-canvas");

  /*
   * EVERY element mounted on the canvas that could be an editing box. The
   * complaint is that there is more than one; this counts them rather than
   * assuming a particular class.
   */
  const hosts = [
    ...canvas.querySelectorAll(
      ".drawing-label-entry, .drawing-inline-entry, .drawing-canvas-text-editor",
    ),
  ];

  const input = canvas.querySelector("#noteText");
  const s = window.enggDrawing?.state;
  const note = s?.objects.find((o) => o.annotateKind === "note");

  const style = input ? getComputedStyle(input) : null;
  const rect = input?.getBoundingClientRect();

  return {
    hostCount: hosts.length,
    hostClasses: hosts.map((h) => h.className),
    fieldFontSize: style ? parseFloat(style.fontSize) : null,
    fieldPadding: style
      ? {
          left: parseFloat(style.paddingLeft),
          right: parseFloat(style.paddingRight),
        }
      : null,
    fieldWidthCss: style ? style.width : null,
    fieldRectWidth: rect ? Math.round(rect.width) : null,
    fieldScrollWidth: input?.scrollWidth ?? null,
    objectFontSize: note?.style?.fontSize ?? null,
  };
});

record(
  during.hostCount === 1,
  "exactly ONE editing element sits on the canvas",
  JSON.stringify(during.hostClasses),
);

record(
  during.fieldPadding?.left === 0 && during.fieldPadding?.right === 0,
  "the field has NO horizontal padding, so its box is the text's box",
  JSON.stringify(during.fieldPadding),
);

record(
  during.fieldFontSize === 16,
  "the field renders at the note's committed size (16 px)",
  String(during.fieldFontSize),
);

/* Commit, and compare the drawn size. */
await page.keyboard.press("Enter");
await sleep(450);

const after = await page.evaluate(() => {
  const canvas = document.querySelector(".drawing-canvas");
  const node = [...canvas.querySelectorAll("text")].find(
    (c) => c.textContent === "Measurement",
  );

  if (!node) {
    return null;
  }

  const style = getComputedStyle(node);
  const screenScale = node.getScreenCTM?.()?.a || 1;

  return {
    attrSize: parseFloat(node.getAttribute("font-size")),
    renderedPx: style.fontSize,
    /* A zoom-compensated text: the attribute carries the camera, the transform
     * divides it back out, so the SCREEN size is what matters. */
    ctmScale: Number(screenScale.toFixed(3)),
    rectWidth: Math.round(node.getBoundingClientRect().width),
  };
});

record(Boolean(after), "the committed word is drawn", JSON.stringify(after));

record(
  after?.renderedPx === "16px",
  "the committed word renders at 16 px, the same as the field",
  after?.renderedPx,
);

console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
