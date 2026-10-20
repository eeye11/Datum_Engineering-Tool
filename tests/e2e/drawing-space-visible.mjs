/*
 * ============================================================
 * IS THE COMPILED DRAWING ACTUALLY ON SCREEN?
 * ============================================================
 *
 * The regression this checks is not "does the API answer" or "is the picture
 * layer populated" - both can be true while the student sees an empty sheet.
 * It asks a browser where the compiled ink lands, and compares that with where
 * the editor's own camera says the model is:
 *
 *   - the screen bounding box of every path in the picture layer,
 *   - the screen projection of each object's geometry through the SAME
 *     camera the grid, the snapping and the hit test use
 *     (`window.enggDrawingState.engineeringToScreen`),
 *   - and whether the two cover the same pixels.
 *
 * A picture drawn as a LaTeX page (offset by its page corner), scaled by the
 * TeX points/millimetres ratio, or placed anywhere the model is not, fails
 * here even though the layer is full of valid SVG.
 *
 *   node --expose-gc tests/e2e/drawing-space-visible.mjs [baseUrl] [shotDir]
 *
 * Requires the server (`npm start`) - the renderer is the real one.
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] || "http://localhost:3000/";
const shotDir = process.argv[3] || path.join("tests", "e2e", "screenshots");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* How far apart the model's projection and the picture may be, in pixels. */
const TOLERANCE = 3;

const failures = [];
const check = (ok, label, detail) => {
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`,
  );
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error.message)));
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".drawing-canvas", { state: "attached" });

/* Enter the Drawing Space and hide the editor's distractions. */
await page.click("text=Engineering Drawing");
await sleep(400);
await page.click("#drawingPanelTabSource").catch(() => {});
await sleep(200);

/*
 * CREATE A DRAWING THROUGH THE MODEL, then wait for its source to compile.
 * The model path is deliberate: this test is about the RENDERING, not about
 * which toolbar button exists.
 */
const drawObject = async (object) =>
  page.evaluate((next) => {
    const state = window.enggDrawing.state;
    state.objects.push(next);
    window.enggDrawing.model.commitDrawingChange(state);
  }, object);

/* Wait until the picture layer holds ink and the source says it rendered. */
const waitForPicture = async (signatureChangedFrom = null, timeout = 40000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => {
      const layer = document.querySelector(
        ".drawing-canvas > svg.drawing-source-layer",
      );
      return {
        rendered: layer?.dataset.rendered || null,
        paths: layer
          ? layer.querySelectorAll(
              "path,line,polyline,polygon,circle,ellipse,rect",
            ).length
          : 0,
        signature: layer ? layer.innerHTML : "",
        text:
          document.getElementById("drawingSourceStatus")?.textContent?.trim() ||
          "",
      };
    });
    const ready =
      status.rendered === "source" &&
      status.paths > 0 &&
      (signatureChangedFrom === null ||
        status.signature !== signatureChangedFrom);
    if (ready) return status;
    await sleep(150);
  }
  return null;
};

/*
 * WHERE THE INK IS ON SCREEN, and where the MODEL says it should be.
 *
 * The model's side is projected with `engineeringToScreen` - the editor's own
 * camera - and the picture's side is `getBoundingClientRect` on its paths, so
 * this compares what a student sees with what the pointer believes.
 */
const compare = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".drawing-canvas");
    const layer = canvas.querySelector(":scope > svg.drawing-source-layer");
    const bounds = canvas.getBoundingClientRect();

    const state = window.enggDrawing.state;
    const model = window.enggDrawingState;
    const toScreen = (point) => model.engineeringToScreen(point, bounds, state);

    const ink = [
      ...(layer?.querySelectorAll("path,line,circle,rect,polyline,polygon") ||
        []),
    ]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0.5 || box.height > 0.5);

    const inkBox = ink.length
      ? ink.reduce(
          (acc, box) => ({
            left: Math.min(acc.left, box.left),
            top: Math.min(acc.top, box.top),
            right: Math.max(acc.right, box.right),
            bottom: Math.max(acc.bottom, box.bottom),
          }),
          {
            left: Infinity,
            top: Infinity,
            right: -Infinity,
            bottom: -Infinity,
          },
        )
      : null;

    /* Every object's drawn extent, projected through the editor's camera. */
    const points = [];
    state.objects.forEach((object) => {
      const geometry = object.geometry || {};
      if (object.type === "line") points.push(geometry.start, geometry.end);
      if (object.type === "rectangle" && geometry.position) {
        const { x, y } = geometry.position;
        points.push(
          { x, y },
          { x: x + geometry.width, y: y + geometry.height },
        );
      }
      if (object.type === "circle" && geometry.center) {
        const { x, y } = geometry.center;
        const r = geometry.radius;
        points.push({ x: x - r, y: y - r }, { x: x + r, y: y + r });
      }
    });

    const projected = points.filter(Boolean).map(toScreen);
    const modelBox = projected.length
      ? projected.reduce(
          (acc, p) => ({
            left: Math.min(acc.left, p.x),
            top: Math.min(acc.top, p.y),
            right: Math.max(acc.right, p.x),
            bottom: Math.max(acc.bottom, p.y),
          }),
          {
            left: Infinity,
            top: Infinity,
            right: -Infinity,
            bottom: -Infinity,
          },
        )
      : null;

    return {
      canvas: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      inkBox,
      modelBox,
      inkCount: ink.length,
      rendered: layer?.dataset.rendered || null,
      viewBox: layer?.getAttribute("viewBox") || null,
      status:
        document.getElementById("drawingSourceStatus")?.textContent?.trim() ||
        "",
    };
  });

const reportComparison = (label, result) => {
  const { inkBox, modelBox, canvas } = result;
  check(
    Boolean(result.rendered),
    `${label}: the picture layer says it rendered from the source`,
  );
  check(
    result.inkCount > 0,
    `${label}: the picture holds drawable elements`,
    `${result.inkCount}`,
  );
  check(
    (Boolean(inkBox) && inkBox.right - inkBox.left > 2) ||
      (inkBox && inkBox.bottom - inkBox.top > 2),
    `${label}: the drawing has visible extent`,
  );

  if (!inkBox || !modelBox) return;

  const offsets = {
    left: Math.round(inkBox.left - modelBox.left),
    top: Math.round(inkBox.top - modelBox.top),
    right: Math.round(inkBox.right - modelBox.right),
    bottom: Math.round(inkBox.bottom - modelBox.bottom),
  };
  const worst = Math.max(...Object.values(offsets).map(Math.abs));
  check(
    worst <= TOLERANCE,
    `${label}: the picture is drawn where the model is`,
    `offsets ${JSON.stringify(offsets)}`,
  );

  const inside =
    inkBox.left >= canvas.left - TOLERANCE &&
    inkBox.top >= canvas.top - TOLERANCE &&
    inkBox.right <= canvas.left + canvas.width + TOLERANCE &&
    inkBox.bottom <= canvas.top + canvas.height + TOLERANCE;
  check(inside, `${label}: the drawing is inside the visible Drawing Space`);
};

/* ---- A LINE ---- */
await drawObject({
  id: "e2e-line",
  type: "line",
  name: "Line",
  geometry: { start: { x: -30, y: 0 }, end: { x: 30, y: 0 } },
  style: {},
});
const lineReady = await waitForPicture();
check(Boolean(lineReady), "the line's source compiled into the picture");

const lineResult = await compare();
reportComparison("line", lineResult);

await page.screenshot({ path: path.join(shotDir, "drawing-line.png") });

/* ---- A DIFFERENT SHAPE, ELSEWHERE ---- */
await page.evaluate(() => {
  const state = window.enggDrawing.state;
  state.objects.length = 0;
  window.enggDrawingState.commitDrawingChange(state);
});
await page.evaluate(() => {
  const state = window.enggDrawing.state;
  state.objects.push({
    id: "e2e-rect",
    type: "rectangle",
    name: "Rectangle",
    geometry: {
      position: { x: 10, y: -15 },
      width: 40,
      height: 25,
      rotation: 0,
    },
    style: {},
  });
  window.enggDrawingState.commitDrawingChange(state);
});
const rectReady = await waitForPicture();
check(Boolean(rectReady), "the rectangle's source compiled into the picture");
reportComparison("rectangle", await compare());
await page.screenshot({ path: path.join(shotDir, "drawing-rectangle.png") });

/* ---- EDIT THE SOURCE, AND SEE THE DRAWING FOLLOW ---- */
const beforeEdit = await page.evaluate(() => {
  const layer = document.querySelector(
    ".drawing-canvas > svg.drawing-source-layer",
  );
  return layer.innerHTML;
});
await page.evaluate(() => {
  const editor = document.querySelector("#drawingSourceEditor textarea");
  editor.value = editor.value
    .replace("(40,25)", "(60,45)")
    .replace(/\(10,-15\).*?rectangle \(50,10\)/, "(10,-15) rectangle (70,30)");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
const afterEditSignature = await evaluateSignatures();
check(
  afterEditSignature.changed,
  "editing the Source changes the drawing after recompilation",
  afterEditSignature.status,
);
reportComparison("edited", await compare());

async function evaluateSignatures() {
  const deadline = Date.now() + 30000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await page.evaluate((previous) => {
      const layer = document.querySelector(
        ".drawing-canvas > svg.drawing-source-layer",
      );
      return {
        changed:
          Boolean(layer) &&
          layer.innerHTML !== previous &&
          layer.dataset.rendered === "source",
        status:
          document.getElementById("drawingSourceStatus")?.textContent?.trim() ||
          "",
      };
    }, beforeEdit);
    if (latest.changed) return latest;
    await sleep(200);
  }
  return latest;
}

/* ---- SWITCH AWAY AND BACK ---- */
await page.click(".tab[data-tab='solution']").catch(() => {});
await sleep(300);
await page.click(".tab[data-tab='drawing']").catch(() => {});
await sleep(600);
reportComparison("after switching tabs", await compare());

/* ---- GRID, SNAPPING AND HIT TESTING STILL SHARE THE CAMERA ---- */
const interaction = await page.evaluate(() => {
  const canvas = document.querySelector(".drawing-canvas");
  const overlay = canvas.querySelector(":scope > svg.drawing-overlay");
  const bounds = canvas.getBoundingClientRect();
  const state = window.enggDrawing.state;
  const model = window.enggDrawingState;

  const rect = state.objects.find((object) => object.type === "rectangle");
  const inside = model.engineeringToScreen({ x: 40, y: 0 }, bounds, state);
  const point = { x: inside.x - bounds.left, y: inside.y - bounds.top };

  /* Snapping a point near the grid lands on the grid. */
  const raw = model.screenToEngineering(point, bounds, state);
  const snapped = model.screenToEngineering(point, bounds, state, true);

  return {
    gridDrawn: Boolean(overlay?.querySelector("path")),
    gridHasSegments: (
      overlay
        ?.querySelector("path.drawing-engineering-grid")
        ?.getAttribute("d") || ""
    ).includes("M"),
    raw,
    snapped,
    spacing: state.grid?.spacing ?? null,
  };
});

check(
  interaction.gridDrawn && interaction.gridHasSegments,
  "the engineering grid is drawn over the picture",
);
check(
  Number.isFinite(interaction.raw?.x) && Number.isFinite(interaction.raw?.y),
  "a screen point in the Drawing Space maps back to model coordinates",
);
if (interaction.spacing) {
  check(
    Math.abs(
      interaction.snapped.x / interaction.spacing -
        Math.round(interaction.snapped.x / interaction.spacing),
    ) < 1e-6,
    "grid snapping still quantises to the grid spacing",
  );
}

/* ---- A FAILED COMPILE KEEPS THE LAST DRAWING ---- */
const beforeFailure = await page.evaluate(
  () =>
    document.querySelector(".drawing-canvas > svg.drawing-source-layer")
      .innerHTML,
);

await page.evaluate(() => {
  const editor = document.querySelector("#drawingSourceEditor textarea");
  editor.value = editor.value.replace("\\draw", "\\draw[not-a-real-key]");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(6000);

const failure = await page.evaluate((previous) => {
  const canvas = document.querySelector(".drawing-canvas");
  const layer = canvas.querySelector(":scope > svg.drawing-source-layer");
  return {
    kept: Boolean(layer) && layer.innerHTML === previous,
    rendered: layer?.dataset.rendered || null,
    paths: layer ? layer.querySelectorAll("path,line,circle,rect").length : 0,
    message:
      document.getElementById("drawingSourceStatus")?.textContent?.trim() ||
      document
        .getElementById("drawingSourceDiagnostics")
        ?.textContent?.trim() ||
      "",
  };
}, beforeFailure);

check(
  failure.kept,
  "a failed compile keeps the last drawing instead of blanking the sheet",
  `${failure.paths} elements, status "${failure.message.slice(0, 80)}"`,
);

await page.screenshot({
  path: path.join(shotDir, "drawing-after-failure.png"),
});

check(
  pageErrors.length === 0,
  "no page errors",
  pageErrors.slice(0, 3).join(" | "),
);

await browser.close();

if (failures.length) {
  console.error(
    `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}

console.log(
  "\nThe compiled drawing is visible, in the right place, and survives the workspace lifecycle.",
);
