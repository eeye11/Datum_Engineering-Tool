/*
 * PIPE / DUCT CONTINUOUS DRAWING QA
 *
 * Drives the real application through the actual press-drag-release gesture and
 * reports what the document model contains afterwards. Every observation is read
 * from the app's own live state (window.enggDrawing.state), never from a guess.
 *
 *   node tools/qa/pipe-continuous-qa.mjs [url]
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] || "http://localhost:5199/";

const report = {};

function section(name, data) {
  report[name] = data;
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // Open the Engineering Drawing tab and wait for the canvas.
  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
  }
  await page.waitForTimeout(600);
  await page.locator(".drawing-canvas").first().waitFor({ timeout: 15000 });

  const box = await page.locator(".drawing-canvas").first().boundingBox();
  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });

  // Arm the Pipe / Duct tool via the real toolbar.
  const armPipe = async () => {
    await page.evaluate(() => {
      const fluids = [...document.querySelectorAll(".drawing-category")].find(
        (el) => el.dataset.category === "FLUIDS",
      );
      if (fluids) fluids.click();
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const b = document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]');
      if (b) b.click();
    });
    await page.waitForTimeout(250);
  };

  const state = () =>
    page.evaluate(() => {
      const st = window.enggDrawing.state;
      return {
        activeTool: st.activeTool,
        fluidsTool: st.interaction.fluidsTool,
        phase: st.interaction.phase,
        routeCommittedCount: st.interaction.routeCommittedCount,
        hasPreview: Boolean(st.interaction.preview),
        previousRun: st.interaction.previousRun
          ? {
              id: st.interaction.previousRun.id,
              end: st.interaction.previousRun.geometry.end,
            }
          : null,
        objects: st.objects.map((o) => ({
          id: o.id,
          type: o.type,
          name: o.name,
          parentId: o.parentId ?? null,
          start: o.geometry.start,
          end: o.geometry.end,
          position: o.geometry.position,
          previous: o.geometry.previous,
          next: o.geometry.next,
        })),
      };
    });

  // A real press-hold-drag-release gesture between two fractional canvas points.
  const dragDraw = async (from, to) => {
    const p1 = at(...from);
    const p2 = at(...to);
    const before = await page.evaluate(() => window.enggDrawing.state.objects.length);
    await page.mouse.move(p1.x, p1.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(60);
    // Move in steps so the app sees real pointermove events.
    await page.mouse.move(p2.x, p2.y, { steps: 8 });
    await page.waitForTimeout(120);
    const previewDuring = (await state()).hasPreview;
    const dragSession = await page.evaluate(() => {
      const s = window.enggEditorState.creationDrag;
      return s ? { pipeDuct: !!s.pipeDuct, moved: s.moved, annotate: !!s.annotateTool } : null;
    });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.enggDrawing.state.objects.length);
    return { previewDuring, dragSession, created: after - before };
  };

  /* ---------------------------------------------------------------
   * TEST A — continuous pipe run with a 90 and a 45 elbow.
   * --------------------------------------------------------------- */
  await armPipe();
  section("A0_armed", await state());

  // Leg 1: horizontal.
  const leg1Preview = await dragDraw([0.2, 0.3], [0.45, 0.3]);
  section("A1_afterLeg1", { previewDuring: leg1Preview, ...(await state()) });

  // Leg 2: continue from leg 1's end, upward (90 deg corner).
  const leg2Preview = await dragDraw([0.45, 0.3], [0.45, 0.55]);
  section("A2_afterLeg2_90", { previewDuring: leg2Preview, ...(await state()) });

  // Leg 3: continue from leg 2's end, diagonally (45 deg corner).
  const leg3Preview = await dragDraw([0.45, 0.55], [0.65, 0.75]);
  section("A3_afterLeg3_45", { previewDuring: leg3Preview, ...(await state()) });

  // Leg 4: continue, horizontal again.
  await dragDraw([0.65, 0.75], [0.85, 0.75]);
  section("A4_afterLeg4", await state());

  // Finish the run deliberately.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  section("A5_afterFinish", {
    message: await page.evaluate(
      () => document.getElementById("drawingToolMessage")?.textContent?.trim(),
    ),
    ...(await state()),
  });

  /* ---------------------------------------------------------------
   * TEST B — standalone elbow placement (twice, without reselecting).
   * --------------------------------------------------------------- */
  await page.evaluate(() => {
    const b = document.querySelector('.drawing-tool[data-tool-id="elbow"]');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  section("B0_elbowArmed", await state());

  await dragDraw([0.15, 0.6], [0.3, 0.6]);
  section("B1_afterElbow1", await state());
  await dragDraw([0.3, 0.6], [0.3, 0.75]);
  section("B2_afterElbow2", await state());

  section("consoleErrors", errors);

  await browser.close();
}

main().catch((e) => {
  console.error("QA FAILED:", e);
  process.exit(1);
});
