/*
 * SUPPORT / CONNECTION CLICK PROBE
 *
 * Mirrors tests/e2e/golden-scenario.mjs: same STATICS group navigation, same
 * beam seeding, same click steps and popup handling - but only for the
 * support and connection tools, with a verbose per-step trace.
 *
 *   node tests/e2e/support-click-probe.mjs <baseUrl> [onlyRegex]
 */
import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] || "http://localhost:3000/";
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

const TOOLS = [
  ["STATICS", "support", "pin-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
  ["STATICS", "support", "roller-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
  ["STATICS", "support", "fixed-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
  ["STATICS", "support", "smooth-support", "beam", ["c:0.4,0.6", "c:0.25,0.6"]],
  [
    "STATICS",
    "connection",
    "pin-connection",
    "beam",
    ["c:0.4,0.6", "c:0.25,0.6", "c:0.5,0.6"],
  ],
  [
    "STATICS",
    "connection",
    "fixed-connection",
    "beam",
    ["c:0.4,0.6", "c:0.25,0.6", "c:0.5,0.6"],
  ],
  [
    "STATICS",
    "connection",
    "slider-connection",
    "beam",
    ["c:0.4,0.6", "c:0.25,0.6", "c:0.5,0.6"],
  ],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForSelector(".drawing-canvas", { timeout: 20000 });
await sleep(300);

const box = await page.evaluate(() => {
  const r = document.querySelector(".drawing-canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const P = (fx, fy) => ({
  x: Math.round(box.x + box.w * fx),
  y: Math.round(box.y + box.h * fy),
});
const BEAM = [P(0.25, 0.6), P(0.7, 0.6)];

const click = async (pt, settle = 120) => {
  await page.mouse.move(pt.x - 3, pt.y - 2);
  await sleep(40);
  await page.mouse.move(pt.x, pt.y);
  await sleep(40);
  await page.mouse.click(pt.x, pt.y);
  await sleep(settle);
};
const drag = async (a, b) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await sleep(80);
  await page.mouse.up();
  await sleep(200);
};
const escapeOnce = async () => {
  await page.keyboard.press("Escape");
  await sleep(150);
};

/* Accept a creation popup by pressing Enter, as the golden scenario does. */
const acceptPopups = async () => {
  for (let round = 0; round < 4; round++) {
    const waiting = await page.evaluate(() => {
      const shown = (el) =>
        el &&
        getComputedStyle(el).display !== "none" &&
        el.getClientRects().length > 0;
      return [
        ".drawing-inline-entry",
        ".drawing-creation-dimension",
        ".datum-symbol-picker",
        ".datum-table-picker",
        "dialog[open]",
        ".engg-dialog-backdrop",
        "[role=dialog]",
      ].some((selector) => shown(document.querySelector(selector)));
    });
    if (!waiting) return;
    await page.keyboard.press("Enter");
    await sleep(120);
  }
};

const count = () =>
  page.evaluate(() => window.enggDrawing.state.objects.length);

const newSheet = async () => {
  await page.evaluate(() => {
    const sheets = window.enggDrawingSheets;
    const created = sheets.createSheet();
    const id = created?.id || sheets.all()[sheets.all().length - 1].id;
    sheets.activateSheet(id);
  });
  await sleep(200);
};

const escapeKey = async () => {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape");
    await sleep(60);
  }
};

const seedBeam = async () => {
  await chooseTool("STATICS", "body", "beam");
  await drag(BEAM[0], BEAM[1]);
  await acceptPopups();
  await escapeKey();
};

const chooseTool = async (category, toolId, sub) => {
  await page.click(`.drawing-category[data-category="${category}"]`);
  await sleep(80);
  const section = page.locator(`#statics-${toolId}-tools`);
  if (
    sub &&
    (await section.count()) &&
    (await section.locator(`[data-tool-id="${sub}"]`).count())
  ) {
    if (await section.evaluate((el) => el.hidden)) {
      await page.click(`.drawing-tool[data-tool-id="${toolId}"]`);
      await sleep(120);
    }
    await section
      .locator(`.drawing-tool[data-tool-id="${sub}"]`)
      .first()
      .click();
    await sleep(150);
    return;
  }
  for (const group of ["body", "load", "support", "connection"]) {
    const parent = page.locator(`#statics-${group}-tools`);
    if (
      (await parent
        .locator(`.drawing-tool[data-tool-id="${toolId}"]`)
        .count()) &&
      (await parent.evaluate((el) => el.hidden))
    ) {
      await page.click(`.drawing-tool[data-tool-id="${group}"]`);
      await sleep(120);
    }
  }
  await page.click(`.drawing-tool[data-tool-id="${toolId}"]`);
  await sleep(120);
};

console.log(
  `beam seeding check: ${await (async () => {
    await seedBeam();
    return count();
  })()} objects after one beam`,
);

for (const [category, toolId, sub, , actions] of TOOLS) {
  const key = [category, toolId, sub].filter(Boolean).join("/");
  if (only && !only.test(key)) continue;

  await newSheet();
  await seedBeam();
  const before = await count();
  await chooseTool(category, toolId, sub);

  const armed = await page.evaluate(() => window.enggDrawing.state.activeTool);
  const steps = [];

  for (const action of actions) {
    const spot = P(...action.slice(2).split(",").map(Number));
    await click(spot);
    await acceptPopups();
    steps.push(await count());
  }

  await acceptPopups();
  await escape();

  const after = await count();
  const state = await page.evaluate(() => {
    const s = window.enggDrawing.state;
    const last = s.objects[s.objects.length - 1];
    return {
      tool: s.activeTool,
      lastType: last?.type,
      msg:
        document.getElementById("drawingToolMessage")?.textContent.trim() || "",
    };
  });

  console.log(
    `${key}: before=${before} steps=[${steps}] after=${after} (+${after - before}) armed="${armed}" toolAfter="${state.tool}" lastType=${state.lastType} msg="${state.msg.slice(0, 50)}"`,
  );
}

if (pageErrors.length) {
  console.log(`\npage errors (${pageErrors.length}):`);
  [...new Set(pageErrors)]
    .slice(0, 6)
    .forEach((e) => console.log(`  - ${e.slice(0, 220)}`));
} else {
  console.log("\nno page errors");
}

await browser.close();
