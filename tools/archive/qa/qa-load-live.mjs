import { makeHelpers } from "./qa-helpers.mjs";

/* Read-only live trace of the Distributed Load creation flow. */
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
        previewId: i && i.preview && i.preview.id,
        previewPoints: i && i.preview && i.preview.geometry && i.preview.geometry.points,
        loadStart: i && i.loadStart,
        loadEnd: i && i.loadEnd,
        objects: st.objects.length
      }));`,
    );

  const msg = () => h.msg();

  await h.category("STATICS");
  await h.tool("load");
  await h.sub("Distributed Load");
  await safe("after-activate", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.press(0.2, 0.35);
  await safe("after-click-1", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.move(0.8, 0.35);
  await safe("after-move-2", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.press(0.8, 0.35);
  await safe("after-click-2", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.move(0.3, 0.35);
  await safe("after-move-3", async () => ({
    msg: await msg(),
    state: await snap(),
  }));
  await h.press(0.3, 0.35);
  await safe("after-click-3", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.move(0.7, 0.35);
  await safe("after-move-4", async () => ({
    msg: await msg(),
    state: await snap(),
  }));
  await h.press(0.7, 0.35);
  await safe("after-click-4", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  await h.move(0.5, 0.6);
  await safe("after-move-5", async () => ({
    msg: await msg(),
    state: await snap(),
  }));
  await h.press(0.5, 0.6);
  await safe("after-click-5", async () => ({
    msg: await msg(),
    state: await snap(),
  }));

  return out;
}
