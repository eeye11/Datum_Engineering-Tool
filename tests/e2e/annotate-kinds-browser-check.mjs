// Every writable Annotate kind must edit INLINE. A LABEL and a LEADER used to
// fall through to a modal box, which is the popup the requirement removes.
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

/* What kind of editor is on screen right now. */
const editorKind = () =>
  page.evaluate(() => {
    const inline =
      document.querySelector(".drawing-canvas-text-editor") ||
      document.querySelector(".drawing-label-entry") ||
      document.querySelector(".drawing-inline-entry");

    return {
      inline: Boolean(inline),
      inlineClass: inline?.className || null,
      modal: Boolean(document.querySelector("dialog[open]")),
      field: Boolean(document.querySelector("#noteText")),
      focused: document.activeElement?.id || null,
    };
  });

const escapeAll = async () => {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape");
    await sleep(80);
  }
};

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(250);

/* ---- Label: place it, then edit its text ---- */
await page.click('.drawing-tool[data-tool-id="label"]');
await sleep(250);
await page.mouse.click(P(0.3, 0.35).x, P(0.3, 0.35).y);
await sleep(450);

const labelOpen = await editorKind();

record(
  labelOpen.inline && !labelOpen.modal,
  "a LABEL opens an INLINE editor, not a modal",
  JSON.stringify(labelOpen),
);

if (labelOpen.field) {
  await page.keyboard.type("L1");
  await sleep(200);
  await page.keyboard.press("Enter");
  await sleep(300);
}

await escapeAll();

/* ---- Leader: place it with two clicks, then edit ---- */
await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(150);
await page.click('.drawing-tool[data-tool-id="leader"]');
await sleep(250);
await page.mouse.click(P(0.45, 0.55).x, P(0.45, 0.55).y);
await sleep(150);
await page.mouse.click(P(0.55, 0.45).x, P(0.55, 0.45).y);
await sleep(500);

const leaderOpen = await editorKind();

record(
  leaderOpen.inline && !leaderOpen.modal,
  "a LEADER opens an INLINE editor, not a modal",
  JSON.stringify(leaderOpen),
);

await escapeAll();

/* ---- An existing note, edited by double-click ---- */
const noteId = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  const note = s?.objects.find((o) => o.annotateKind === "note");
  return note?.id || null;
});

record(
  Boolean(noteId),
  "the note from the earlier check is on the sheet",
  String(noteId),
);

await page.screenshot({ path: "annotate-kinds-browser.png" });
console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
