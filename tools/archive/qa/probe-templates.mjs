/*
 * ========================================================
 * ACCEPTANCE TEST - USER TEMPLATES
 * ========================================================
 *
 * The template library must start EMPTY, and a template must be creatable only
 * by the user from an .enggdraw they already have:
 *
 *   - no built-in template cards
 *   - "+ Add Template" opens the file panel
 *   - the chosen file is validated with the SAME loader an Open uses
 *   - a name is asked for, defaulted to the file's name
 *   - the template stores a COPY of the document, not a path
 *   - the source file is never modified
 *   - using the template makes a NEW document, leaving the template unchanged
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

    /* Start from an empty library, so "ships empty" is actually tested. */
    window.enggTemplates.clear();
    window.enggRecentFiles.clear();

    window.__qaAlerts = [];
    window.alert = (message) => window.__qaAlerts.push(String(message));

    /* A .enggdraw payload the Add Template flow can read. */
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const beam = F.beam({ x: 0, y: 0 }, { x: 240, y: 0 }, { style: {} });
    beam.id = "beam_tpl";
    st.objects.push(beam);

    st.scale = { mmPerUnit: 3, unit: "mm" };

    ds.commitDrawingChange(st, before);

    window.__qaTemplatePayload = JSON.stringify(
      window.enggDocumentFile.createDocument(
        window.enggDrawingSheets.serializeDocumentBody(),
      ),
    );
  });

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(800);
  }

  /* ---------------------------------------------------------------- */
  /* 1. The library starts EMPTY and says so.                          */
  /* ---------------------------------------------------------------- */

  const emptyLibrary = await page.evaluate(async () => {
    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 500));

    return {
      templateCards: document.querySelectorAll("[data-template]").length,
      emptyText: (
        [...document.querySelectorAll(".datum-open-empty")].map(
          (n) => n.textContent,
        )
      ).join(" | "),
      hasAdd: Boolean(document.querySelector(".datum-open-add-template")),
    };
  });

  log("emptyLibrary", emptyLibrary);

  /* ---------------------------------------------------------------- */
  /* 2. Add Template -> file picker -> name -> stored copy.             */
  /* ---------------------------------------------------------------- */

  const added = await page.evaluate(async () => {
    const raw = window.__qaTemplatePayload;

    /*
     * Intercept the input Add Template creates BEFORE clicking it. The input is
     * created synchronously in the same turn as the click, so an override
     * installed afterwards would miss it.
     */
    const realCreate = document.createElement.bind(document);
    let produced = null;

    document.createElement = (tag) => {
      const node = realCreate(tag);
      if (String(tag).toLowerCase() === "input") {
        produced = node;
        node.click = () => {
          Object.defineProperty(node, "files", {
            value: [
              new File([raw], "Beam Assignment.enggdraw", {
                type: "application/vnd.enggdraw+json",
              }),
            ],
            configurable: true,
          });
          node.dispatchEvent(new Event("change"));
        };
      }
      return node;
    };

    const addButton = document.querySelector(".datum-open-add-template");
    addButton.click();

    await new Promise((r) => setTimeout(r, 800));

    document.createElement = realCreate;

    /* The name dialog should now be up, defaulted to the file's name. */
    const dialogTitle = (document.querySelector(".engg-dialog-title") || {})
      .textContent;

    const field = document.querySelector(".engg-dialog-input");

    const defaultValue = field ? field.value : null;

    if (field) {
      field.value = "ENGG 130 Beam Setup";
    }

    const confirm = [...document.querySelectorAll(".engg-dialog-button")].find(
      (b) => /add template/i.test(b.textContent),
    );

    if (confirm) {
      confirm.click();
    }

    await new Promise((r) => setTimeout(r, 600));

    return {
      inputCreated: Boolean(produced),
      dialogTitle,
      defaultValue,
      templates: window.enggTemplates.list().map((t) => ({
        name: t.name,
        hasDocument: Boolean(window.enggTemplates.documentFor(t.id)),
        hasPreview: Boolean(t.preview),
      })),
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
      currentDrawingUntouched: window.enggDrawing.state.objects.map(
        (o) => o.id,
      ),
      errors: (window.enggErrorLog ? window.enggErrorLog.recent() : []).map(
        (e) => [e.operation, e.message],
      ),
    };
  });

  log("added", added);

  /* ---------------------------------------------------------------- */
  /* 3. The card appears, and the empty state is gone.                  */
  /* ---------------------------------------------------------------- */

  const cardShown = await page.evaluate(async () => {
    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 450));

    const cards = [...document.querySelectorAll("[data-template]")].map((n) =>
      n.dataset.template,
    );

    const cardText = (
      document.querySelector(".datum-open-template-label") || {}
    ).textContent;

    return {
      cardCount: cards.length,
      cardText,
      stillEmpty: Boolean(
        [...document.querySelectorAll(".datum-open-empty")].find((n) =>
          /no templates yet/i.test(n.textContent),
        ),
      ),
      hasAdd: Boolean(document.querySelector(".datum-open-add-template")),
    };
  });

  log("cardShown", cardShown);

  /* ---------------------------------------------------------------- */
  /* 4. Using the template makes a NEW document; the template is intact. */
  /* ---------------------------------------------------------------- */

  const used = await page.evaluate(async () => {
    const before = window.enggTemplates.list();

    if (!before.length) {
      return { error: "no template was created in step 2" };
    }

    const storedBefore = window.enggTemplates.copyDocumentFor(before[0].id);

    const card = document.querySelector("[data-template]");
    card.click();
    await new Promise((r) => setTimeout(r, 900));

    const st = window.enggDrawing.state;

    return {
      objects: st.objects.length,
      ids: st.objects.map((o) => o.id),
      scale: st.scale,
      title: document.title,
      templateStillThere: window.enggTemplates.list().length,
      templateUnchanged:
        JSON.stringify(window.enggTemplates.copyDocumentFor(before[0].id)) ===
        JSON.stringify(storedBefore),
      message: (document.getElementById("drawingToolMessage") || "")
        .textContent,
    };
  });

  log("used", used);

  return out;
}
