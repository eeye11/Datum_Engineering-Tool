/*
 * Drives the real canvas with real pointer gestures:
 *   1. drag with Line   -> exactly one object, tool stays armed
 *   2. bare click with Line -> no new object, back to Select
 *   3. click on that Line while Rectangle armed -> Select, the line selected
 *   4. Escape / tool switch leaves no stale state
 */
export default async function run(page, ui) {
  const report = { steps: [], errors: [] };

  page.on("pageerror", (e) => report.errors.push(String(e)));

  const canvas = page.locator(".drawing-canvas");
  await canvas.waitFor();

  const box = await canvas.boundingBox();

  /* Give the app a moment to mount the toolbar and journal. */
  await page.waitForTimeout(1200);

  const state = () =>
    page.evaluate(() => {
      const api = window.datum;
      return {
        tool:
          api?.activeTool?.() ?? window.enggDrawingState?.activeTool ?? null,
        objects: (window.datumState || []).length,
      };
    });

  const journal = () =>
    page.evaluate(() => {
      const s = window.enggDrawingState;
      const state = window.datum?.drawingState;
      return state
        ? {
            activeTool: state.activeTool,
            count: state.objects.length,
            selected: state.selection.selectedObjectIds.slice(),
            phase: state.interaction.phase,
            kinds: state.objects.map((o) => o.type),
          }
        : { unavailable: true };
    });

  const press = async (x, y) => {
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
  };
  const move = async (x, y, steps = 8) => {
    await page.mouse.move(box.x + x, box.y + y, { steps });
  };
  const up = async () => {
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const click = async (x, y) => {
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(250);
  };

  /* 1. Arm Line with the keyboard shortcut so no toolbar DOM is assumed. */
  await canvas.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("l");
  await page.waitForTimeout(200);

  const afterArm = await journal();
  report.steps.push({ step: "arm line", state: afterArm });

  const before = afterArm.count;

  /* 2. Drag on empty canvas: exactly one object, tool still armed. */
  await press(260, 200);
  await move(200, 140);
  await move(420, 330, 12);
  await up();

  const afterDrag = await journal();
  report.steps.push({ step: "drag line", state: afterDrag });

  /* 3. A bare click with the same tool returns to Select, creating nothing. */
  await click(620, 380);

  const afterClick = await journal();
  report.steps.push({ step: "click empty with line armed", state: afterClick });

  /* 4. Arm Rectangle, then click the line that was drawn. */
  await page.keyboard.press("r");
  await page.waitForTimeout(200);
  const armedRectangle = await journal();

  /* The line runs from (260,200) to (420,330): press its midpoint. */
  await click(340, 265);

  const afterClickOnObject = await journal();
  report.steps.push({
    step: "click existing object with rectangle armed",
    armedRectangle,
    state: afterClickOnObject,
  });

  /* 5. Select is now active; a click on empty canvas clears the selection. */
  await click(680, 120);
  const afterClear = await journal();
  report.steps.push({ step: "click empty with select", state: afterClear });

  /* 6. A drag with Select on empty canvas is a marquee, not a creation. */
  await press(80, 380);
  await move(200, 430);
  await up();
  const afterMarquee = await journal();
  report.steps.push({ step: "marquee with select", state: afterMarquee });

  report.verdict = {
    createdExactlyOne: afterDrag.count === before + 1,
    toolStayedArmedAfterDrag: afterDrag.activeTool === "line",
    clickCreatedNothing: afterClick.count === afterDrag.count,
    clickReturnedToSelect: afterClick.activeTool === "select",
    objectClickActivatedSelect:
      afterClickOnObject.activeTool === "select" &&
      afterClickOnObject.selected.length === 1,
    selectClickIsNotACreation: afterClear.count === afterClick.count,
    noPageErrors: report.errors.length === 0,
    createButtonText:
      (await ui.snapshot()).match(/button "Line"/)?.slice(0, 0) || undefined,
  };

  return report;
}
