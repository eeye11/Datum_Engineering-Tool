/*
 * A RELIABLE MEASUREMENT OF ONE TEXT ANCHOR.
 *
 * Everything is measured in ONE frame: the canvas's own pixel space. The field
 * is a child of the canvas, so its style left/top are already canvas-local; the
 * world anchor is projected with the SAME formula the renderer uses.
 *
 * Prints, for a single click:
 *   clickInCanvas   where the pointer went, canvas-local
 *   worldAnchor     the object's stored geometry.position
 *   expectedCanvas  where that world point projects to
 *   editorCanvas    where the editing field actually sits
 *   committedCanvas where the committed word is drawn (after Enter)
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

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(200);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(200);

/* Click at a deliberately off-centre place. */
const at = {
  x: Math.round(box.x + box.w * 0.25),
  y: Math.round(box.y + box.h * 0.7),
};

await page.mouse.move(at.x - 12, at.y - 12);
await sleep(80);
await page.mouse.click(at.x, at.y);
await sleep(500);

const during = await page.evaluate(
  ({ clickX, clickY }) => {
    const canvas = document.querySelector(".drawing-canvas");
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const cs = window.enggDrawing?.state;
    const note = cs?.objects.find((o) => o.annotateKind === "note");
    const host = document.querySelector(
      ".drawing-inline-entry, .drawing-label-entry, .drawing-canvas-text-editor",
    );

    const zoom = cs?.camera?.zoom || 1;
    const scale = 2.4 * zoom;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const world = note?.geometry?.position || null;
    const expected = world
      ? { x: w / 2 + world.x * scale, y: h / 2 - world.y * scale }
      : null;

    return {
      clickInCanvas: {
        x: Math.round(clickX - rect.left),
        y: Math.round(clickY - rect.top),
      },
      canvasSize: { w: Math.round(w), h: Math.round(h) },
      zoom,
      worldAnchor: world,
      expectedCanvas: expected,
      editorStyle: host ? { left: host.style.left, top: host.style.top } : null,
      editorParent: host?.parentElement?.className || null,
      hostCount: document.querySelectorAll(
        ".drawing-inline-entry, .drawing-label-entry, .drawing-canvas-text-editor",
      ).length,
    };
  },
  { clickX: at.x, clickY: at.y },
);

console.log("DURING TYPING");
console.log(JSON.stringify(during, null, 2));

/* Type, commit, and measure where the word really is. */
await page.keyboard.type("Anchor");
await sleep(250);
await page.keyboard.press("Enter");
await sleep(500);

const after = await page.evaluate(() => {
  const canvas = document.querySelector(".drawing-canvas");
  const node = [...canvas.querySelectorAll("text")].find(
    (candidate) => candidate.textContent === "Anchor",
  );

  const cs = window.enggDrawing?.state;
  const note = cs?.objects.find((o) => o.annotateKind === "note");

  return {
    worldAnchor: note?.geometry?.position || null,
    textAttributes: node
      ? {
          x: node.getAttribute("x"),
          y: node.getAttribute("y"),
          transform: node.getAttribute("transform"),
          "font-size": node.getAttribute("font-size"),
        }
      : null,
    textCount: [...canvas.querySelectorAll("text")].filter(
      (candidate) => candidate.textContent === "Anchor",
    ).length,
  };
});

console.log("\nAFTER COMMIT");
console.log(JSON.stringify(after, null, 2));
console.log("\npage errors:", errors.length ? errors.join(" | ") : "none");

await browser.close();
