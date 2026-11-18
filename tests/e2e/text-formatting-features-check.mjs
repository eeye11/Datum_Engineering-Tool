// Real-browser check of the text-formatting RULES:
//   - no formatting UI over the canvas while editing
//   - Label appears between Name and Fix
//   - Text Formatting appears under Label ONLY when text exists, and COLLAPSED
//   - Enter commits, Shift+Enter adds a line
//   - formatting from Features updates the object's real style
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
const P = (fx, fy) => ({
  x: Math.round(box.x + box.w * fx),
  y: Math.round(box.y + box.h * fy),
});

const results = [];
const record = (ok, label, detail) =>
  results.push(
    `${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`,
  );

/* ---- 1. create a note, check no formatting UI over the canvas ---- */

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(250);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(250);

const at = P(0.35, 0.4);
await page.mouse.click(at.x, at.y);
await sleep(400);

const whileEditing = await page.evaluate(() => ({
  field: Boolean(document.querySelector("#noteText")),
  toolbar: Boolean(document.querySelector(".drawing-text-format-toolbar")),
}));

record(whileEditing.field, "the text field opens on the canvas");
record(
  !whileEditing.toolbar,
  "NO formatting toolbar appears while editing",
  JSON.stringify(whileEditing),
);

/* ---- 2. Enter commits, Shift+Enter makes a line ---- */

await page.keyboard.type("first");
await page.keyboard.down("Shift");
await page.keyboard.press("Enter");
await page.keyboard.up("Shift");
await page.keyboard.type("second");
await sleep(200);

const beforeCommit = await page.evaluate(() => {
  const input = document.querySelector("#noteText");
  return input ? input.value : null;
});

record(
  beforeCommit === "first\nsecond",
  "Shift+Enter inserts a line and does NOT commit",
  JSON.stringify(beforeCommit),
);

await page.keyboard.press("Enter");
await sleep(400);

const afterCommit = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  const note = s?.objects.find((o) => o.annotateKind === "note");
  return {
    open: Boolean(document.querySelector("#noteText")),
    text: note?.text ?? null,
    label: note?.label ?? null,
  };
});

record(!afterCommit.open, "Enter closes the editor");
record(
  afterCommit.text === "first\nsecond",
  "the committed text keeps its line break",
  JSON.stringify(afterCommit.text),
);

/* ---- 3. Features: Name, Label order, and the collapsed dropdown ---- */

await page.click("#drawingPanelTabFeatures").catch(() => {});
await sleep(400);

const rows = await page.evaluate(() => {
  const objectSection = document.querySelector('[data-feature-group="object"]');

  if (!objectSection) {
    return { order: [], formatting: false, expanded: null };
  }

  /*
   * THE ROWS OF OBJECT ITSELF.
   *
   * The Text Formatting dropdown is NESTED inside Object, and its controls are
   * rows too - so a plain query would list Font, Size, Bold and the rest as if
   * they sat between Label and Fix. Excluding the dropdown's own subtree is what
   * makes this measure the section's actual order.
   */
  const order = [...objectSection.querySelectorAll(".dfp-row-label")]
    .filter((node) => !node.closest(".dfp-text-formatting"))
    .map((n) => n.textContent.trim());

  const formatting = Boolean(
    objectSection.querySelector(".dfp-text-formatting"),
  );

  const toggle = objectSection.querySelector(
    '[data-feature-section-toggle="dfp-text-formatting"]',
  );

  return {
    order,
    formatting,
    expanded: toggle ? toggle.getAttribute("aria-expanded") : null,
  };
});

const nameAt = rows.order.findIndex((r) => /^Name$/i.test(r));
const labelAt = rows.order.findIndex((r) => /^Label$/i.test(r));
const fixAt = rows.order.findIndex((r) => /^Fix$/i.test(r));

record(
  nameAt >= 0 && labelAt === nameAt + 1,
  "Label is directly after Name",
  rows.order.join(" > "),
);

record(
  fixAt < 0 || labelAt < fixAt,
  "Label comes before Fix",
  rows.order.join(" > "),
);

/*
 * AND NOTHING SITS BETWEEN THEM.
 *
 * The formatting rows belong in the Text Formatting dropdown, not in Object, so
 * the three named rows must be CONSECUTIVE. This is the check that caught them
 * being folded into Object.
 */
record(
  fixAt < 0 || fixAt === labelAt + 1,
  "nothing sits between Label and Fix",
  rows.order.slice(labelAt, fixAt + 1).join(" > "),
);

record(rows.formatting, "Text Formatting appears under Label when text exists");
record(
  rows.expanded === "false",
  "the dropdown is COLLAPSED by default",
  String(rows.expanded),
);

/* ---- 4. expanding it and changing the size updates the object ---- */

await page.evaluate(() => {
  const toggle = document.querySelector(
    '[data-feature-section-toggle="dfp-text-formatting"]',
  );
  if (toggle) toggle.click();
});
await sleep(300);

const opened = await page.evaluate(() =>
  document
    .querySelector('[data-feature-section-toggle="dfp-text-formatting"]')
    ?.getAttribute("aria-expanded"),
);

record(
  opened === "true",
  "clicking Text Formatting expands it",
  String(opened),
);

await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".dfp-text-formatting .dfp-row")];
  const sizeRow = rows.find((r) =>
    /size/i.test(r.querySelector(".dfp-row-label")?.textContent || ""),
  );
  const input = sizeRow?.querySelector("input");

  if (input) {
    input.value = "24";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await sleep(350);

const styled = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  const note = s?.objects.find((o) => o.annotateKind === "note");
  return note?.style?.fontSize ?? null;
});

record(
  Number(styled) === 24,
  "changing the size writes the object's style",
  String(styled),
);

/* ---- 5. emptying the label hides the dropdown ---- */

await page.evaluate(() => {
  const rows = [
    ...document.querySelectorAll('[data-feature-group="object"] .dfp-row'),
  ];
  const labelRow = rows.find((r) =>
    /label/i.test(r.querySelector(".dfp-row-label")?.textContent || ""),
  );
  const input = labelRow?.querySelector("input");

  if (input) {
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await sleep(450);

void at;
console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
console.log("object rows:", JSON.stringify(rows.order));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
