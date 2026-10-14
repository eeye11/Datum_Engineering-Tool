import { makeHelpers } from "./qa-helpers.mjs";

/* Read-only live trace of the Varying Distributed Load creation flow. */
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
      var loads = st.objects.filter(function (o) {
        return o.type === "load" || o.type === "varying-load";
      });
      document.documentElement.setAttribute("data-qa", JSON.stringify({
        phase: i && i.phase,
        hasPreview: Boolean(i && i.preview),
        previewId: i && i.preview && i.preview.id,
        previewPoints: i && i.preview && i.preview.geometry && i.preview.geometry.points,
        distributedLoadPoints: i && i.distributedLoadPoints,
        loads: loads.map(function (o) {
          return { type: o.type, points: (o.geometry.points || []).length,
            intensity: o.geometry.intensity };
        })
      }));`,
    );

  const msg = () => h.msg();

  await h.category("STATICS");
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await safe("activated", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.press(0.15, 0.4);
  await safe("click-1", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.press(0.85, 0.4);
  await safe("click-2", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.move(0.35, 0.3);
  await safe("move-toward-point", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.press(0.35, 0.3);
  await safe("click-point-1", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.move(0.7, 0.5);
  await safe("move-2", async () => ({ msg: await msg(), state: await snap() }));

  await h.press(0.7, 0.5);
  await safe("click-point-2", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await safe("after-enter", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  return out;
}
