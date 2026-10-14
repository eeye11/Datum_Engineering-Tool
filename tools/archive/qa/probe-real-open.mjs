import { makeHelpers } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });

  const h = await makeHelpers(page);
  await page.waitForTimeout(400);

  /*
   * THE DRAWING WORKSPACE MUST BE MOUNTED. The application opens on the
   * Written Solution view; the drawing modules only exist once the
   * Engineering Drawing tab is showing, so it is switched to explicitly.
   */
  let mounted = await page.evaluate(() =>
    Boolean(document.querySelector(".drawing-canvas"))
  );

  if (!mounted) {
    const tab = page.getByRole("button", { name: "Engineering Drawing" });

    if (await tab.count()) {
      await tab.first().click();
      await page.waitForTimeout(900);
    }

    mounted = await page.evaluate(() =>
      Boolean(document.querySelector(".drawing-canvas"))
    );
  }

  log("mounted", mounted);

  if (!mounted) {
    return out;
  }

  /*
   * WAIT FOR THE DRAWING HANDSHAKE. `window.enggDrawing` is installed by the
   * editor's own entry point, so waiting for it is waiting for the workspace
   * to be genuinely ready rather than merely present in the DOM.
   */
  try {
    await page.waitForFunction(
      () => typeof window.enggDrawing === "object" && window.enggDrawing,
      null,
      { timeout: 10000 }
    );
  } catch (e) {
    log("hookTimeout", true);
  }

  const result = await page.evaluate(async () => {
    try {
      const mod = await import("/src/editor/document-commands.js");

      const ds = window.enggDrawingState;
      const st = window.enggDrawing.state;
      const F = ds.geometryFactories;

      ds.addObject(st, F.line({ x: 0, y: 0 }, { x: 120, y: 0 }, { style: {} }));
      ds.addObject(st, F.circle({ x: 200, y: 60 }, 30, { style: {} }));

      const before = st.objects.length;

      const body = window.enggDrawingSheets.serializeDocumentBody();
      const payload = window.enggDocumentFile.createDocument(body);

      st.objects = [];
      const cleared = st.objects.length;

      const ok = mod.loadDrawing(payload, "probe.enggdraw");

      const host = document.querySelector(".drawing-canvas");

      return {
        before,
        cleared,
        ok,
        after: st.objects.length,
        types: st.objects.map((o) => o.type),
        shapes: host.querySelectorAll("svg [data-feature-id]").length,
        message: (document.getElementById("drawingToolMessage") || {})
          .textContent
      };
    } catch (e) {
      return {
        error: String(e.message),
        stack: String(e.stack || "").slice(0, 400)
      };
    }
  });

  log("loadDrawing", result);

  return out;
}
