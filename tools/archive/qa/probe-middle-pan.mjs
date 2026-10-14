/*
 * ========================================================
 * ACCEPTANCE TEST - MIDDLE-BUTTON PAN
 * ========================================================
 *
 * Pressing the wheel and dragging must pan the view, whatever tool is armed,
 * without selecting anything and without disturbing the tool the user is using.
 * The existing behaviours must be untouched: wheel still zooms, the left button
 * still belongs to the armed tool.
 */

export default async function run(page) {
  const out = { steps: [] };
  const log = (name, value) => out.steps.push({ name, value });

  await page.waitForFunction(() => typeof window.datum === "object", null, {
    timeout: 20000,
  });

  await page.evaluate(async () => {
    if (typeof window.enggDrawing !== "object") {
      const mod = await import("/src/app/automation-hooks.js");
      mod.installAutomationHooks();
    }
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(800);
  }

  const canvasBox = await page.locator(".drawing-canvas").first().boundingBox();

  /* A drawing and an armed tool, so interference would be visible. */
  await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];
    const line = F.line({ x: 0, y: 0 }, { x: 200, y: 0 }, { style: {} });
    line.id = "line_pan";
    st.objects.push(line);
    ds.commitDrawingChange(st, before);

    /* Arm a creation tool, so a pan must not place anything. */
    ds.setActiveTool(st, "line");

    window.__qaBefore = {
      camera: { ...st.camera },
      objects: st.objects.length,
      selection: [...st.selection.selectedObjectIds],
    };
  });

  /* Press the wheel in the middle and drag. */
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 90, cy + 60, { steps: 8 });
  await page.mouse.up({ button: "middle" });

  await page.waitForTimeout(300);

  const afterPan = await page.evaluate(() => {
    const st = window.enggDrawing.state;

    return {
      before: window.__qaBefore,
      after: {
        camera: { ...st.camera },
        objects: st.objects.length,
        selection: [...st.selection.selectedObjectIds],
        activeTool: st.activeTool,
      },
    };
  });

  log("afterPan", afterPan);

  /* The wheel must still zoom, and the left button must still use the tool. */
  const wheelZoom = await page.evaluate(async () => {
    const st = window.enggDrawing.state;

    const before = st.camera.zoom;

    const canvas = document.querySelector(".drawing-canvas");

    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -120,
        bubbles: true,
        cancelable: true,
        clientX: canvas.getBoundingClientRect().left + 100,
        clientY: canvas.getBoundingClientRect().top + 100,
      }),
    );

    await new Promise((r) => setTimeout(r, 200));

    return {
      before,
      after: st.camera.zoom,
      changed: st.camera.zoom !== before,
    };
  });

  log("wheelZoom", wheelZoom);

  return out;
}
