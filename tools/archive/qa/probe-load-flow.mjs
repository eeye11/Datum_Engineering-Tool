import { makeHelpers } from "./qa-helpers.mjs";

/*
 * Probe the DISTRIBUTED LOAD creation flow step by step and report what the
 * tool message and interaction state are after each click, plus whether a
 * preview object is present. Read-only: it does not change the app.
 */
export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 300) });
    }
  };

  const h = await makeHelpers(page);

  const snap = () =>
    h.evalInPage(
      page,
      `
      var st = window.enggDrawing.state;
      var i = st.interaction;
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        phase: i && i.phase,
        hasPreview: Boolean(i && i.preview),
        previewType: i && i.preview && i.preview.id,
        loadStart: i && i.loadStart,
        loadEnd: i && i.loadEnd,
        loadMagnitude: i && i.loadMagnitude,
        loadDirection: i && i.loadDirection,
        objectCount: st.objects.length
      }));`,
    );

  await safe("message-after-goto", h.msg);

  await h.category("STATICS");
  await h.tool("load");
  await h.sub("Distributed Load");
  await safe("after-open-menu", snap);

  /* Click empty space to begin (falls back to a two-click span). */
  await h.press(0.2, 0.35);
  await safe("after-first-click", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  await h.press(0.8, 0.35);
  await safe("after-second-click", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  /* The magnitude step: try a canvas click, as a student would. */
  await h.move(0.5, 0.5);
  await safe("after-move-magnitude-step", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  await h.press(0.5, 0.5);
  await safe("after-canvas-click-magnitude-step", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  await safe("panel-on-magnitude-step", h.panel);

  /* Now type a magnitude into the panel field, as designed. */
  const field = page.locator("#drawingLoadMagnitude");
  await safe("field-present", async () => (await field.count()) > 0);
  await safe("type-magnitude", async () => {
    if ((await field.count()) === 0) return "no field";
    await field.fill("50");
    await field.dispatchEvent("input");
    await field.press("Enter");
    await page.waitForTimeout(400);
    return true;
  });
  await safe("after-type-magnitude", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  /* The direction step: move the pointer and check the preview turns. */
  await h.move(0.5, 0.7);
  await safe("after-move-direction-step", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  /* Click to commit the direction. */
  await h.press(0.5, 0.7);
  await safe("after-direction-click", async () => ({
    msg: await h.msg(),
    state: await snap(),
  }));

  return out;
}
