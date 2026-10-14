import { makeHelpers } from "./qa-helpers.mjs";

/*
 * ========================================================
 * DRAGGING AN EXISTING FEATURE SNAPS HORIZONTALLY / VERTICALLY
 * ========================================================
 *
 * The real running application, driven with the real pointer. A line is
 * created, selected, and an ENDPOINT is dragged approximately horizontally;
 * the test then reads the LIVE inference state while the pointer is still
 * down, and the committed geometry after release.
 *
 * This is the behaviour the task is about, and it is deliberately checked
 * mid-drag: a guide appearing is not enough, the manipulated point itself
 * must move onto the inferred axis.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const out = { errs };

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForTimeout(800);

  const h = await makeHelpers(page);

  const readLine = () =>
    page.evaluate(() => {
      const st = window.enggDrawing.state;
      const line = st.objects.filter((o) => o.type === "line").slice(-1)[0];
      return line
        ? {
            id: line.id,
            start: { ...line.geometry.start },
            end: { ...line.geometry.end },
          }
        : null;
    });

  const readInteraction = () =>
    page.evaluate(() => {
      const it = window.enggDrawing.state.interaction || {};
      return {
        inference: it.inference ? it.inference.type : null,
        snap: it.snapCandidate ? it.snapCandidate.type : null,
        guideline: it.guideline ? it.guideline.inference?.type : null,
        drag: window.enggEditorState.manipulationDrag
          ? {
              kind: window.enggEditorState.manipulationDrag.kind,
              moved: window.enggEditorState.manipulationDrag.moved,
              anchor: window.enggEditorState.manipulationDrag.anchor,
            }
          : null,
      };
    });

  /* Screen coordinates of a feature point, in canvas-local pixels. */
  const screenOf = (which) =>
    page.evaluate((w) => {
      const st = window.enggDrawing.state;
      const line = st.objects.filter((o) => o.type === "line").slice(-1)[0];
      const D = window.enggDrawingState;
      const c = document
        .querySelector(".drawing-canvas")
        .getBoundingClientRect();
      const proj = (p) =>
        D.engineeringToScreen(p, { width: c.width, height: c.height }, st);
      const a = proj(line.geometry.start);
      const b = proj(line.geometry.end);
      if (w === "mid") return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return { x: b.x, y: b.y };
    }, which);

  /* ---------------------------------------------------------------- */
  /* The GEOMETRY category holds both the Line tool and Select. */
  await h.category("GEOMETRY");
  await h.tool("line");

  const p1 = h.at(0.3, 0.62);
  const p2 = h.at(0.66, 0.38);

  await page.mouse.move(p1.x, p1.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  out.lineCreated = await readLine();

  /* ---------------------------------------------------------------- */
  /* Arm Select: the one tool that may directly manipulate what exists. */
  await h.tool("select");
  await page.waitForTimeout(250);

  const line = out.lineCreated;
  if (!line) {
    out.error = "no line was created";
    return out;
  }

  const box = h.box;
  const toPage = (s) => ({ x: box.x + s.x, y: box.y + s.y });

  /* Select the line by clicking on its midpoint. */
  const midPage = toPage(await screenOf("mid"));
  await page.mouse.move(midPage.x, midPage.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(350);

  out.selectedAfterClick = await h.selected();

  /* ---------------------------------------------------------------- */
  /* Drag the END handle approximately HORIZONTALLY. */
  const anchorBefore = await readLine();
  const endPage = toPage(await screenOf("end"));

  await page.mouse.move(endPage.x, endPage.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(80);

  /* A long move right with a few pixels down: a near-horizontal drag. */
  const targetPage = { x: endPage.x + 120, y: endPage.y + 6 };
  await page.mouse.move(targetPage.x, targetPage.y, { steps: 16 });
  await page.waitForTimeout(220);

  out.midDragHorizontal = {
    interaction: await readInteraction(),
    liveLine: await readLine(),
    anchorRow: anchorBefore ? anchorBefore.end.y : null,
  };

  await page.mouse.up();
  await page.waitForTimeout(350);

  out.afterReleaseHorizontal = {
    committedLine: await readLine(),
    interaction: await readInteraction(),
  };

  /* ---------------------------------------------------------------- */
  /* Now the VERTICAL case: drag the same endpoint approximately upward. */
  const anchorBeforeV = await readLine();
  const endPage2 = toPage(await screenOf("end"));

  await page.mouse.move(endPage2.x, endPage2.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(80);

  /* Mostly up, a few pixels right. */
  const targetPage2 = { x: endPage2.x + 6, y: endPage2.y - 110 };
  await page.mouse.move(targetPage2.x, targetPage2.y, { steps: 16 });
  await page.waitForTimeout(220);

  out.midDragVertical = {
    interaction: await readInteraction(),
    liveLine: await readLine(),
    anchorCol: anchorBeforeV ? anchorBeforeV.end.x : null,
  };

  await page.mouse.up();
  await page.waitForTimeout(350);

  out.afterReleaseVertical = {
    committedLine: await readLine(),
  };

  /* ---------------------------------------------------------------- */
  /* REGRESSION: free dragging is still free. */
  const beforeFree = await readLine();
  const freeStart = toPage(await screenOf("end"));

  await page.mouse.move(freeStart.x, freeStart.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(80);

  /*
   * A diagonal move: far outside the 7-degree band, so nothing may be
   * constrained and the point must land where the cursor is.
   */
  await page.mouse.move(freeStart.x + 70, freeStart.y + 70, { steps: 14 });
  await page.waitForTimeout(200);

  out.freeDrag = {
    interaction: await readInteraction(),
    liveLine: await readLine(),
    before: beforeFree ? beforeFree.end : null,
  };

  await page.mouse.up();
  await page.waitForTimeout(300);

  /* ---------------------------------------------------------------- */
  /* REGRESSION: creation-time inference still works. */
  await h.tool("line");

  const c1 = h.at(0.35, 0.7);
  await page.mouse.move(c1.x, c1.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  /* A near-horizontal second point, using click-move-click. */
  await page.mouse.move(c1.x + 140, c1.y + 5, { steps: 14 });
  await page.waitForTimeout(220);

  out.creationInference = await readInteraction();

  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  return out;
}
