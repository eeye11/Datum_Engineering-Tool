// Real-browser check for the Heat Transfer label behaviours that only exist in
// the UI: the inline field opening with the whole notation SELECTED, the label
// being independently clickable, and the Objects tab never listing it.
//
// The unit suites prove the model; this proves the INTERACTION.
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://localhost:5173/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  for (const options of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* try the next */
    }
  }

  throw new Error(
    "No browser available: run `npx playwright install chromium`.",
  );
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".drawing-canvas", { state: "attached" });

/*
 * THE DRAWING EDITOR MOUNTS WHEN ITS TAB IS OPENED.
 *
 * The Written Solution workspace is the default view, so the canvas exists but
 * its category buttons and model hooks do not until the Drawing tab is active.
 * Pressing the tab by its data attribute is how the other scenarios do it.
 */
await page.evaluate(() => {
  const tab = document.querySelector('.tab[data-tab="drawing"]');
  if (tab) tab.click();
});
await sleep(1200);

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

const P = (fx, fy) => ({
  x: Math.round(box.x + box.w * fx),
  y: Math.round(box.y + box.h * fy),
});

const click = async (pt) => {
  await page.mouse.move(pt.x - 3, pt.y - 2);
  await sleep(40);
  await page.mouse.move(pt.x, pt.y);
  await sleep(40);
  await page.mouse.click(pt.x, pt.y);
  await sleep(180);
};

const drag = async (a, b) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(80);
  await page.mouse.up();
  await sleep(250);
};

/* The Heat Transfer category, then a tool id (with its dropdown if it has one). */
const chooseTool = async (toolId, sub) => {
  await page.click('.drawing-category[data-category="HEAT TRANSFER"]');
  await sleep(150);

  if (sub) {
    const section = page.locator(`#statics-${toolId}-tools`);

    if (
      (await section.count()) &&
      (await section.locator(`[data-tool-id="${sub}"]`).count())
    ) {
      if (await section.evaluate((el) => el.hidden)) {
        await page.click(`.drawing-tool[data-tool-id="${toolId}"]`);
        await sleep(150);
      }

      await section
        .locator(`.drawing-tool[data-tool-id="${sub}"]`)
        .first()
        .click();
      await sleep(200);
      return;
    }
  }

  await page.click(`.drawing-tool[data-tool-id="${toolId}"]`);
  await sleep(200);
};

const model = () =>
  page.evaluate(() => {
    const s = window.enggDrawing?.state;

    if (!s) {
      return { unavailable: true };
    }

    return {
      objects: s.objects.map((o) => ({
        id: o.id,
        type: o.type,
        name: o.name,
        text: o.text,
        parentId: o.parentId || null,
        heatParentId: o.metadata?.heatParentId || null,
        selected: s.selection.selectedObjectIds.includes(o.id),
      })),
      selected: s.selection.selectedObjectIds.slice(),
    };
  });

/* The inline field the creation label opens, from the DOM the editor writes. */
const inlineField = () =>
  page.evaluate(() => {
    const input = document.querySelector(
      ".drawing-label-entry input, #noteText",
    );

    if (!input) {
      return null;
    }

    return {
      value: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      length: input.value.length,
    };
  });

const objectsRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".drawing-objects-item")].map((li) => ({
      name: li.querySelector(".drawing-objects-name")?.textContent.trim(),
      type: li.dataset.objectType,
      depth: Number(li.dataset.objectDepth || 0),
    })),
  );

const results = [];
const record = (ok, label, detail) => {
  results.push(
    `${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`,
  );
};

await page.click("#drawingPanelTabObjects").catch(() => {});
await sleep(200);

/* ============================================ 1. notation and inline field */

await chooseTool("heat-source-sink", "heat-source");
await click(P(0.4, 0.4));

const field = await inlineField();
const afterPlacement = await model();

record(
  Boolean(field && field.value === "\\dot{Q}_1"),
  "placing a Heat Source opens the field with the default notation",
  field ? JSON.stringify(field.value) : "no inline field",
);

record(
  Boolean(
    field &&
    field.length > 0 &&
    field.selectionStart === 0 &&
    field.selectionEnd === field.length,
  ),
  "the WHOLE default is selected, so typing replaces it",
  field
    ? `${field.selectionStart}..${field.selectionEnd} of ${field.length}`
    : "no field",
);

record(
  afterPlacement.objects.some((o) => o.type === "heat-source-sink"),
  "the object is committed while the field is open",
);

/* Typing replaces the selection rather than appending to it. */
await page.keyboard.type("\\dot{Q}_{in}");
await page.keyboard.press("Enter");
await sleep(250);

const afterEdit = await model();
const label = afterEdit.objects.find((o) => o.heatParentId);

record(
  Boolean(label && label.text === "\\dot{Q}_{in}"),
  "typing REPLACES the default instead of appending",
  label ? JSON.stringify(label.text) : "no label object",
);

record(
  !afterEdit.objects.some(
    (o) => o.type === "annotate" && /dot\{Q\}_1/.test(String(o.text || "")),
  ),
  "the replaced default is not left behind as a second object",
);

/* ============================================ 2. the Objects tab */

const rows = await objectsRows();
const labelRows = rows.filter((row) => row.type === "annotate");

record(
  labelRows.length === 0,
  "the automatic label has NO row in the Objects tab (top-level or nested)",
  `${rows.length} rows, ${labelRows.length} annotate rows: ${rows.map((r) => `${r.name}@${r.depth}`).join(", ")}`,
);

record(
  rows.some((row) => /Heat Source/.test(String(row.name))),
  "its parent object DOES have a row",
  rows.map((row) => row.name).join(", "),
);

/* ============================================ 3. independent label selection */

const labelId = label?.id;
const parentId = label?.heatParentId;

/* Click the parent's geometry: the parent is selected, not the label. */
await page.keyboard.press("Escape");
await sleep(120);
await chooseTool("select");
await click(P(0.4, 0.4));

const onGeometry = await model();

record(
  onGeometry.selected.includes(parentId) &&
    !onGeometry.selected.includes(labelId),
  "clicking the GEOMETRY selects the parent, never the label",
  JSON.stringify(onGeometry.selected),
);

/* Click the label itself: the PARENT stays the selected object (no separate row). */
const labelPoint = await page.evaluate((id) => {
  const s = window.enggDrawing?.state;
  const o = s?.objects.find((candidate) => candidate.id === id);
  const at = o?.geometry?.position;

  if (!at) {
    return null;
  }

  const rect = document
    .querySelector(".drawing-canvas")
    .getBoundingClientRect();
  const cam = s.camera;
  const base = 2.4;
  const zoom = cam.zoom || 1;
  const width = rect.width;
  const height = rect.height;

  /* The same projection the renderer uses, so this lands on the drawn words. */
  const cx = width / 2;
  const cy = height / 2;

  return {
    x: Math.round(rect.left + cx + at.x * base * zoom + cam.panX * zoom),
    y: Math.round(rect.top + cy - at.y * base * zoom + cam.panY * zoom),
  };
}, labelId);

if (labelPoint) {
  /* Aim at the text, a few pixels right of its anchor. */
  await page.mouse.click(labelPoint.x + 8, labelPoint.y - 4);
  await sleep(250);

  const onLabel = await model();

  record(
    onLabel.selected.includes(parentId) && !onLabel.selected.includes(labelId),
    "clicking the LABEL keeps the PARENT selected (it is not a separate object)",
    JSON.stringify(onLabel.selected),
  );

  record(
    Boolean(
      await page.evaluate(
        () =>
          window.enggDrawing?.state?.selection?.selectedObjectIds?.length === 1,
      ),
    ),
    "exactly ONE object is selected after a label click",
  );
} else {
  record(false, "could not resolve the label's screen position");
}

/* ============================================ 4. no stray label rows, ever */

const finalRows = await objectsRows();

record(
  finalRows.filter((row) => row.type === "annotate").length === 0,
  "after editing, still no label row in the Objects tab",
  finalRows.map((row) => row.name).join(", "),
);

const final = await model();

record(
  final.objects.filter((o) => o.type === "annotate").length === 1,
  "the label exists exactly ONCE in the document",
  String(final.objects.filter((o) => o.type === "annotate").length),
);

await page.screenshot({ path: "heat-labels-browser.png" });

console.log(results.join("\n"));
console.log("page errors:", errors.length ? errors.join(" | ") : "none");

await browser.close();

process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);
