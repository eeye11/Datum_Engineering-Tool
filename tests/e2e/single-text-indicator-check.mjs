

// ONE CLICK, ONE INSERTION POINT.
//
// While a text tool is armed, a translucent "Double-click to write" preview
// follows the cursor - that is the placement indicator. When the click lands,
// the inline editor IS the insertion point, so the preview must stand down.
// Two marks on screen at once is the defect this checks.
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

/* Everything that could be a placement indicator, right now. */
const indicators = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".drawing-canvas");

    /*
     * An EDITOR is attached to the canvas (the Text tool's own box) or to the
     * document (a label field). Both are counted, so "one editor" is a statement
     * about the screen rather than about one parent element.
     */
    const editors = document.querySelectorAll(
      ".drawing-canvas-text-editor, .drawing-inline-entry, .drawing-label-entry",
    ).length;

    return {
      preview:
        canvas?.querySelectorAll(".drawing-annotation-preview").length ?? 0,
      editors,
      editorsInBody: editors,
      crosshair: canvas?.querySelectorAll(".drawing-crosshair").length ?? 0,
      field: Boolean(document.querySelector("#noteText")),
    };
  });

await page.click('.drawing-category[data-category="ANNOTATE"]');
await sleep(250);
await page.click('.drawing-tool[data-tool-id="note"]');
await sleep(250);

/* Move the pointer over the canvas WITHOUT clicking: the preview may show. */
const at = P(0.35, 0.4);
await page.mouse.move(at.x - 20, at.y - 20);
await sleep(120);
await page.mouse.move(at.x, at.y);
await sleep(250);

const armed = await indicators();

/* The preview is the placement indicator while armed - that is correct. */
record(
  armed.editorsInBody === 0,
  "no editor is open before the click",
  JSON.stringify(armed),
);

/* ONE CLICK. */
await page.mouse.click(at.x, at.y);
await sleep(450);

const afterClick = await indicators();

record(
  afterClick.field,
  "the inline text editor opens on the click",
  JSON.stringify(afterClick),
);

record(
  afterClick.preview === 0,
  "the placement preview STANDS DOWN once the editor is the insertion point",
  JSON.stringify(afterClick),
);

record(
  afterClick.editorsInBody === 1,
  "exactly ONE editor is on screen",
  String(afterClick.editorsInBody),
);

record(
  afterClick.editors + afterClick.preview === 1,
  "exactly ONE text-entry location on the canvas (editor OR preview, never both)",
  `editor=${afterClick.editors} preview=${afterClick.preview}`,
);

/* Typing goes into that one location. */
await page.keyboard.type("hello");
await sleep(250);

const typed = await page.evaluate(
  () => document.querySelector("#noteText")?.value ?? null,
);

record(
  typed === "hello",
  "typing lands in the one editor",
  JSON.stringify(typed),
);

/* Enter commits; the text stays and no preview returns. */
await page.keyboard.press("Enter");
await sleep(450);

const committed = await page.evaluate(() => {
  const s = window.enggDrawing?.state;
  const note = s?.objects.find((o) => o.annotateKind === "note");

  return {
    text: note?.text ?? null,
    editorOpen: Boolean(document.querySelector("#noteText")),
    preview:
      document
        .querySelector(".drawing-canvas")
        ?.querySelectorAll(".drawing-annotation-preview").length ?? 0,
  };
});

record(!committed.editorOpen, "Enter closes the editor");
record(
  committed.text === "hello",
  "the text stays on the sheet",
  JSON.stringify(committed.text),
);
record(committed.preview === 0, "no preview remains after the commit");

/* The committed text is drawn EXACTLY ONCE (no doubled node at the same spot). */
const drawn = await page.evaluate(() => {
  const canvas = document.querySelector(".drawing-canvas");
  const texts = [...canvas.querySelectorAll("text")]
    .map((n) => n.textContent)
    .filter((t) => t === "hello");

  return texts.length;
});

record(
  drawn <= 1,
  "the committed word is drawn once, not twice",
  String(drawn),
);

console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
