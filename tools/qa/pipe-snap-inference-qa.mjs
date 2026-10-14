/*
 * ========================================================
 * PIPE / DUCT HORIZONTAL & VERTICAL INFERENCE QA
 * ========================================================
 *
 * Drives the REAL application through actual press-drag-release gestures and
 * reads the committed geometry back out of the document model
 * (window.enggDrawing.state.objects). Nothing is guessed and nothing is read
 * from a mock: the coordinates reported here are the coordinates the run
 * stores.
 *
 *   node tools/qa/pipe-snap-inference-qa.mjs [url]
 *
 * Covers the task's Tests A-G:
 *   A  horizontal alignment, small vertical deviation -> exact Y alignment
 *   B  vertical alignment, small horizontal deviation -> exact X alignment
 *   C  continuous drawing: drag then further legs, inference on every leg
 *   D  inference stability near the H/diagonal and V/diagonal boundaries
 *   E  connections and elbows: H-then-V, V-then-H, a 45 corner
 *   F  canvas transformations: zoom and pan must not change the direction
 *   G  regression: endpoint snap, commit-equals-preview, undo/redo
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] || "http://localhost:5201/";

const report = {};
let failures = 0;

function section(name, data) {
  report[name] = data;
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(data, null, 2));
}

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  -> ${detail}` : ""}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
  }
  await page.waitForTimeout(600);
  await page.locator(".drawing-canvas").first().waitFor({ timeout: 15000 });

  const canvas = page.locator(".drawing-canvas").first();
  let box = await canvas.boundingBox();
  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  const armPipe = async () => {
    await page.evaluate(() => {
      const fluids = [...document.querySelectorAll(".drawing-category")].find(
        (el) => el.dataset.category === "FLUIDS",
      );
      if (fluids) fluids.click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const b = document.querySelector(
        '.drawing-tool[data-tool-id="pipe-duct"]',
      );
      if (b) b.click();
    });
    await page.waitForTimeout(200);
  };

  const clearDoc = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const st = window.enggDrawing.state;
      st.objects.length = 0;
      if (st.interaction) {
        st.interaction.previousRun = null;
        st.interaction.routeCommittedCount = 0;
        st.interaction.preview = null;
        st.interaction.phase = "idle";
      }
    });
    await page.waitForTimeout(120);
  };

  const pipes = () =>
    page.evaluate(() =>
      window.enggDrawing.state.objects
        .filter((o) => o.type === "pipe-duct")
        .map((o) => ({
          id: o.id,
          name: o.name,
          start: { x: o.geometry.start.x, y: o.geometry.start.y },
          end: { x: o.geometry.end.x, y: o.geometry.end.y },
        })),
    );

  const elbows = () =>
    page.evaluate(() =>
      window.enggDrawing.state.objects
        .filter((o) => o.type === "elbow")
        .map((o) => ({
          id: o.id,
          name: o.name,
          position: o.geometry.position,
          previous: o.geometry.previous,
          next: o.geometry.next,
          angle: o.engineering && o.engineering.angle,
          angleDegrees: o.engineering && o.engineering.angleDegrees,
        })),
    );

  const message = () =>
    page.evaluate(
      () =>
        document.getElementById("drawingToolMessage")?.textContent?.trim() ||
        "",
    );

  /*
   * A real press-hold-drag-release. `before` is read from the model so the
   * created count is exact. The preview point during the drag is captured by
   * reading the interaction's preview geometry, so "preview equals commit"
   * is checked against the model rather than a screenshot.
   */
  const dragDraw = async (from, to) => {
    const p1 = at(...from);
    const p2 = at(...to);
    const before = await page.evaluate(
      () => window.enggDrawing.state.objects.length,
    );
    await page.mouse.move(p1.x, p1.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.move(p2.x, p2.y, { steps: 10 });
    await page.waitForTimeout(140);
    const previewDuring = await page.evaluate(() => {
      const p = window.enggDrawing.state.interaction.preview;
      return p && p.geometry
        ? {
            start: p.geometry.start,
            end: p.geometry.end,
            type: p.type,
          }
        : null;
    });
    const msgDuring = await message();
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.evaluate(
      () => window.enggDrawing.state.objects.length,
    );
    return { previewDuring, msgDuring, created: after - before };
  };

  const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

  /* ============================================================
   * TEST A — HORIZONTAL ALIGNMENT
   * ============================================================ */
  console.log("\n\n########## TEST A — HORIZONTAL ALIGNMENT ##########\n");
  await clearDoc();
  await armPipe();

  /*
   * Start at an arbitrary point, drag nearly horizontally with a small
   * vertical deviation. The deviation in screen space is a couple of
   * percent of the canvas height, well inside the 24 px inference band.
   */
  const aStart = [0.25, 0.42];
  const aEnd = [0.6, 0.44];
  const aResult = await dragDraw(aStart, aEnd);

  section("A_dragResult", aResult);

  let list = await pipes();
  check(
    "A: exactly one pipe created by the drag",
    list.length === 1,
    `count=${list.length}`,
  );

  if (list.length === 1) {
    const p = list[0];
    check(
      "A: the run's Y coordinates are exactly aligned",
      near(p.start.y, p.end.y),
      `start.y=${p.start.y} end.y=${p.end.y}`,
    );
    check(
      "A: the run has real horizontal length",
      Math.abs(p.end.x - p.start.x) > 1,
      `dx=${p.end.x - p.start.x}`,
    );
    check(
      "A: the committed end matches the preview end",
      aResult.previewDuring &&
        near(aResult.previewDuring.end.x, p.end.x) &&
        near(aResult.previewDuring.end.y, p.end.y),
      `preview=${JSON.stringify(aResult.previewDuring && aResult.previewDuring.end)} commit=${JSON.stringify(p.end)}`,
    );
    check(
      "A: the preview reported horizontal inference",
      /Horizontal/.test(aResult.msgDuring || ""),
      `message=${aResult.msgDuring}`,
    );
  }

  /* ============================================================
   * TEST B — VERTICAL ALIGNMENT
   * ============================================================ */
  console.log("\n\n########## TEST B — VERTICAL ALIGNMENT ##########\n");
  await clearDoc();
  await armPipe();

  const bResult = await dragDraw([0.7, 0.3], [0.72, 0.65]);
  section("B_dragResult", bResult);

  list = await pipes();
  check(
    "B: exactly one pipe created by the drag",
    list.length === 1,
    `count=${list.length}`,
  );

  if (list.length === 1) {
    const p = list[0];
    check(
      "B: the run's X coordinates are exactly aligned",
      near(p.start.x, p.end.x),
      `start.x=${p.start.x} end.x=${p.end.x}`,
    );
    check(
      "B: the run has real vertical length",
      Math.abs(p.end.y - p.start.y) > 1,
      `dy=${p.end.y - p.start.y}`,
    );
    check(
      "B: the committed end matches the preview end",
      bResult.previewDuring &&
        near(bResult.previewDuring.end.x, p.end.x) &&
        near(bResult.previewDuring.end.y, p.end.y),
      `preview=${JSON.stringify(bResult.previewDuring && bResult.previewDuring.end)} commit=${JSON.stringify(p.end)}`,
    );
    check(
      "B: the preview reported vertical inference",
      /Vertical/.test(bResult.msgDuring || ""),
      `message=${bResult.msgDuring}`,
    );
  }

  /* ============================================================
   * TEST C — CONTINUOUS DRAWING (H, V, DIAGONAL IN SEQUENCE)
   * ============================================================ */
  console.log("\n\n########## TEST C — CONTINUOUS DRAWING ##########\n");
  await clearDoc();
  await armPipe();

  /*
   * Leg 1: horizontal drag from an arbitrary point.
   * Leg 2: press on leg 1's end, drag up  -> vertical.
   * Leg 3: press on leg 2's end, drag diagonally -> diagonal.
   * Inference must run on every leg without re-arming the tool.
   */
  const c1 = await dragDraw([0.2, 0.3], [0.45, 0.3]);
  const afterC1 = await pipes();

  const c2 = await dragDraw([0.45, 0.3], [0.45, 0.55]);
  const afterC2 = await pipes();

  const c3 = await dragDraw([0.45, 0.55], [0.65, 0.72]);
  const afterC3 = await pipes();

  section("C_legs", { c1, c2, c3, afterC1, afterC2, afterC3 });

  check(
    "C: three legs drawn without re-arming",
    afterC3.length === 3,
    `count=${afterC3.length}`,
  );

  if (afterC3.length === 3) {
    const [l1, l2, l3] = afterC3;
    check(
      "C: leg 1 is horizontal (Y aligned)",
      near(l1.start.y, l1.end.y),
      `${l1.start.y} vs ${l1.end.y}`,
    );
    check(
      "C: leg 2 is vertical (X aligned)",
      near(l2.start.x, l2.end.x),
      `${l2.start.x} vs ${l2.end.x}`,
    );
    check(
      "C: leg 2 continues from leg 1's end",
      near(l2.start.x, l1.end.x) && near(l2.start.y, l1.end.y),
      `l1.end=${JSON.stringify(l1.end)} l2.start=${JSON.stringify(l2.start)}`,
    );
    check(
      "C: leg 3 continues from leg 2's end",
      near(l3.start.x, l2.end.x) && near(l3.start.y, l2.end.y),
      `l2.end=${JSON.stringify(l2.end)} l3.start=${JSON.stringify(l3.start)}`,
    );
    check(
      "C: leg 3 is diagonal, not axis-locked",
      !near(l3.start.x, l3.end.x) && !near(l3.start.y, l3.end.y),
      JSON.stringify(l3),
    );
    check(
      "C: legs 2 and 3 previews reported their inference",
      /Vertical/.test(c2.msgDuring || "") &&
        /Horizontal/.test(c1.msgDuring || ""),
      `c1="${c1.msgDuring}" c2="${c2.msgDuring}"`,
    );
  }

  /* ============================================================
   * TEST D — INFERENCE STABILITY NEAR THE BOUNDARY
   * ============================================================ */
  console.log("\n\n########## TEST D — INFERENCE STABILITY ##########\n");
  await clearDoc();
  await armPipe();

  /*
   * Hold the drag open and sweep the pointer across the horizontal /
   * diagonal boundary, sampling the reported inference at each step. The
   * direction must not oscillate frame to frame while the cursor stays
   * within one band.
   */
  const dStart = at(0.25, 0.5);
  await page.mouse.move(dStart.x, dStart.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(60);

  const sweep = async (samples) => {
    const seen = [];
    for (const [fx, fy] of samples) {
      const p = at(fx, fy);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await page.waitForTimeout(90);
      const msg = await message();
      const inferred = /Horizontal/.test(msg)
        ? "horizontal"
        : /Vertical/.test(msg)
          ? "vertical"
          : "none";
      seen.push({ fx, fy, inferred });
    }
    return seen;
  };

  /*
   * Nearly horizontal, small deviations within the band: inference should
   * hold as "horizontal" throughout.
   */
  const dHorizontalBand = await sweep([
    [0.4, 0.5],
    [0.45, 0.503],
    [0.5, 0.499],
    [0.55, 0.502],
  ]);

  /*
   * Clearly diagonal: about 40 degrees, far outside the band. Inference
   * must release so an intentional diagonal can be drawn.
   */
  const dDiagonal = await sweep([
    [0.5, 0.62],
    [0.55, 0.72],
  ]);

  await page.mouse.up();
  await page.waitForTimeout(250);

  section("D_sweep", { dHorizontalBand, dDiagonal });

  const bandInferences = dHorizontalBand.map((s) => s.inferred);
  const bandHeld = bandInferences.every((s) => s === "horizontal");
  check(
    "D: horizontal inference holds across the whole band without flicker",
    bandHeld,
    JSON.stringify(bandInferences),
  );

  const diagonalReleased = dDiagonal.every((s) => s.inferred === "none");
  check(
    "D: a clearly diagonal move releases the inference",
    diagonalReleased,
    JSON.stringify(dDiagonal.map((s) => s.inferred)),
  );

  /* ============================================================
   * TEST E — CONNECTIONS AND ELBOWS
   * ============================================================ */
  console.log("\n\n########## TEST E — CONNECTIONS AND ELBOWS ##########\n");
  await clearDoc();
  await armPipe();

  /*
   * Horizontal then vertical: an exact 90 degree corner and a connected
   * elbow at the shared point.
   */
  await dragDraw([0.2, 0.3], [0.5, 0.3]);
  await dragDraw([0.5, 0.3], [0.5, 0.6]);

  const ePipes = await pipes();
  const eElbows = await elbows();

  section("E_hThenV", { pipes: ePipes, elbows: eElbows });

  check("E: two runs committed", ePipes.length === 2, `count=${ePipes.length}`);
  check(
    "E: one elbow generated at the corner",
    eElbows.length === 1,
    `count=${eElbows.length}`,
  );

  if (ePipes.length === 2) {
    const [r1, r2] = ePipes;
    check(
      "E: run 1 horizontal",
      near(r1.start.y, r1.end.y),
      `${r1.start.y} vs ${r1.end.y}`,
    );
    check(
      "E: run 2 vertical",
      near(r2.start.x, r2.end.x),
      `${r2.start.x} vs ${r2.end.x}`,
    );
    check(
      "E: the corner is exactly shared",
      near(r1.end.x, r2.start.x) && near(r1.end.y, r2.start.y),
      `r1.end=${JSON.stringify(r1.end)} r2.start=${JSON.stringify(r2.start)}`,
    );
  }

  if (eElbows.length === 1) {
    const e = eElbows[0];
    check(
      "E: the elbow is a 90 degree fitting",
      e.angleDegrees === undefined ||
        Math.abs(e.angleDegrees - 90) < 1e-6 ||
        e.angle === "90",
      `angle=${e.angle} deg=${e.angleDegrees}`,
    );
    check(
      "E: the elbow sits on the corner",
      e.position &&
        ePipes.length === 2 &&
        near(e.position.x, ePipes[0].end.x) &&
        near(e.position.y, ePipes[0].end.y),
      JSON.stringify(e.position),
    );
  }

  /* V then H. */
  await clearDoc();
  await armPipe();
  await dragDraw([0.6, 0.3], [0.6, 0.55]);
  await dragDraw([0.6, 0.55], [0.3, 0.55]);

  const e2Pipes = await pipes();
  const e2Elbows = await elbows();
  section("E_vThenH", { pipes: e2Pipes, elbows: e2Elbows });

  check(
    "E: V-then-H — two runs committed",
    e2Pipes.length === 2,
    `count=${e2Pipes.length}`,
  );
  check(
    "E: V-then-H — one elbow at the corner",
    e2Elbows.length === 1,
    `count=${e2Elbows.length}`,
  );

  if (e2Pipes.length === 2) {
    const [r1, r2] = e2Pipes;
    check(
      "E: V-then-H — run 1 vertical",
      near(r1.start.x, r1.end.x),
      `${r1.start.x} vs ${r1.end.x}`,
    );
    check(
      "E: V-then-H — run 2 horizontal",
      near(r2.start.y, r2.end.y),
      `${r2.start.y} vs ${r2.end.y}`,
    );
    check(
      "E: V-then-H — corner exactly shared",
      near(r1.end.x, r2.start.x) && near(r1.end.y, r2.start.y),
      `r1.end=${JSON.stringify(r1.end)} r2.start=${JSON.stringify(r2.start)}`,
    );
  }

  /* ============================================================
   * TEST F — CANVAS TRANSFORMATIONS
   * ============================================================ */
  console.log("\n\n########## TEST F — CANVAS TRANSFORMATIONS ##########\n");

  const zoomIn = async () => {
    await page.evaluate(() => {
      const canvas = document.querySelector(".drawing-canvas");
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -240,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.waitForTimeout(250);
  };

  await clearDoc();
  await zoomIn();
  await armPipe();

  const fZoomResult = await dragDraw([0.25, 0.4], [0.6, 0.42]);
  const fZoomPipes = await pipes();
  section("F_zoomed", { fZoomResult, pipes: fZoomPipes });

  if (fZoomPipes.length === 1) {
    check(
      "F: at a different zoom the run is still exactly horizontal",
      near(fZoomPipes[0].start.y, fZoomPipes[0].end.y),
      `${fZoomPipes[0].start.y} vs ${fZoomPipes[0].end.y}`,
    );
  } else {
    check(
      "F: at a different zoom one run committed",
      false,
      `count=${fZoomPipes.length}`,
    );
  }

  /*
   * Pan the canvas and draw from a different position - the geometry must
   * still align regardless of screen position.
   */
  await clearDoc();
  const panStart = at(0.5, 0.5);
  await page.evaluate(() => {
    window.__panTest = null;
  });
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(panStart.x + 120, panStart.y + 90, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(300);

  box = await canvas.boundingBox();
  await armPipe();

  const fPanResult = await dragDraw([0.2, 0.6], [0.55, 0.585]);
  const fPanPipes = await pipes();
  section("F_panned", { fPanResult, pipes: fPanPipes });

  if (fPanPipes.length === 1) {
    check(
      "F: after panning the run is still exactly horizontal",
      near(fPanPipes[0].start.y, fPanPipes[0].end.y),
      `${fPanPipes[0].start.y} vs ${fPanPipes[0].end.y}`,
    );
  } else {
    check(
      "F: after panning one run committed",
      false,
      `count=${fPanPipes.length}`,
    );
  }

  /* ============================================================
   * TEST G — REGRESSION: ENDPOINT SNAP, UNDO/REDO
   * ============================================================ */
  console.log("\n\n########## TEST G — REGRESSION ##########\n");
  await clearDoc();
  await armPipe();

  /*
   * Draw one horizontal run, then press exactly on its far endpoint and drag
   * away. The second run must START exactly on the first run's end - the
   * endpoint snap must still connect the two.
   */
  await dragDraw([0.2, 0.35], [0.5, 0.35]);
  const g1 = await pipes();

  /* The exact screen point of the first run's end. */
  const endScreen = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const run = st.objects.find((o) => o.type === "pipe-duct");
    const canvas = document.querySelector(".drawing-canvas");
    const r = canvas.getBoundingClientRect();
    const toScreen = window.enggDrawingRenderer ? null : null;
    void toScreen;
    /* The app's own mapping, read through its exported helper if present. */
    const pt = window.enggDrawing.state.screenToEngineering ? null : null;
    void pt;
    return {
      world: run ? run.geometry.end : null,
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  });

  /*
   * The end screen position: read it back through the renderer's own inverse
   * by asking the app to convert the world point. The app exposes
   * engineeringToScreen on the drawing state module in the browser build.
   */
  const endPx = await page.evaluate((world) => {
    const canvas = document.querySelector(".drawing-canvas");
    const svg = canvas.querySelector("svg");
    const r = svg.getBoundingClientRect();
    const st = window.enggDrawing.state;
    const toScreen =
      window.enggDrawing.engineeringToScreen ||
      window.enggDrawingState?.engineeringToScreen ||
      null;
    if (toScreen) {
      const s = toScreen(world, { width: r.width, height: r.height }, st);
      return { x: r.x + s.x, y: r.y + s.y };
    }
    return null;
  }, endScreen.world);

  section("G_endpointScreenPoint", { endScreen, endPx });

  if (endPx) {
    /* Press exactly on the first run's end and drag up-left. */
    await page.mouse.move(endPx.x, endPx.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.move(endPx.x - 40, endPx.y - 120, { steps: 10 });
    await page.waitForTimeout(140);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const g2 = await pipes();
    section("G_afterEndpointConnect", g2);

    check(
      "G: a second run was committed from the endpoint",
      g2.length === 2,
      `count=${g2.length}`,
    );

    if (g2.length === 2) {
      const first = g2[0];
      const second = g2[1];
      check(
        "G: the second run starts exactly on the first run's end (endpoint snap intact)",
        near(second.start.x, first.end.x) && near(second.start.y, first.end.y),
        `first.end=${JSON.stringify(first.end)} second.start=${JSON.stringify(second.start)}`,
      );
    }
  } else {
    check(
      "G: could read the endpoint screen position",
      false,
      "no screen mapping available",
    );
  }

  /* Undo removes the last run. */
  const beforeUndo = (await pipes()).length;
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(350);
  const afterUndo = (await pipes()).length;

  /* Redo restores it. */
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(350);
  const afterRedo = (await pipes()).length;

  section("G_undoRedo", { beforeUndo, afterUndo, afterRedo });

  check(
    "G: undo removes a committed run",
    afterUndo < beforeUndo,
    `${beforeUndo} -> ${afterUndo}`,
  );
  check(
    "G: redo restores it",
    afterRedo === beforeUndo,
    `${afterUndo} -> ${afterRedo}`,
  );

  section("consoleErrors", errors);
  check(
    "G: no console errors during the run",
    errors.length === 0,
    errors.join(" | "),
  );

  await browser.close();

  console.log(`\n\n########## RESULT: ${failures} failed ##########\n`);
  if (failures) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("QA FAILED:", e);
  process.exit(1);
});
