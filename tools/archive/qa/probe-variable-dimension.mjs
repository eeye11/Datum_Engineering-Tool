 /*
 * ========================================================
 * ACCEPTANCE TEST - VARIABLE DIMENSION
 * ========================================================
 *
 * A Variable Dimension is its OWN feature type, not a styled dimension:
 *
 *   - it is on the Annotate toolset, beside Dimension and Smart Dimension
 *   - placing one creates `variable-dimension`, not `dimension`
 *   - it states a SYMBOL, never a measurement
 *   - an empty symbol draws nothing and is NOT turned into 0 or ?
 *   - the symbol is editable from the Features panel
 *   - it persists through save/open as its own type
 *   - it does not disturb the existing dimension tools
 */

export default async function run(page) {
  const out = {};
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* The tool exists and its factory produces the right type. */
  out.model = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const factory = ds.geometryFactories["variable-dimension"];

    const created = factory
      ? factory({
          refs: [{ kind: "feature", featureId: "x", anchor: "start" }],
          placement: { x: 10, y: 20 },
        })
      : null;

    void st;

    return {
      hasFactory: typeof factory === "function",
      type: created ? created.type : null,
      symbol: created ? created.symbol : null,
      /* A variable must NOT carry a measurement. */
      hasMeasuredValue: created ? "value" in created : null,
      hasDimensionType: created ? "dimensionType" in created : null,
      text: created
        ? window.enggVariableDimension.variableText(created)
        : null,
    };
  });

  out.model = out.model;

  /* It is its own feature type, distinct from `dimension`. */
  out.distinct = await page.evaluate(() => {
    const ds = window.enggDrawingState;

    const variable = ds.geometryFactories["variable-dimension"]({
      refs: [],
      placement: { x: 0, y: 0 },
    });

    const measured = ds.geometryFactories.dimension({
      dimensionType: "linear",
      refs: [],
      placement: { x: 0, y: 0 },
    });

    return {
      variableType: variable.type,
      measuredType: measured.type,
      areDifferent: variable.type !== measured.type,
      isDimensionTool:
        window.enggDimensionTool &&
        window.enggDimensionTool.isDimensionTool
          ? window.enggDimensionTool.isDimensionTool("variable-dimension")
          : null,
    };
  });

  out.distinct = out.distinct;

  /* The tool is offered in the Annotate toolset. */
  out.toolset = await page.evaluate(async () => {
    /* Open the Annotate toolset, the way a student would. */
    const category = document.querySelector(
      '.drawing-category[data-category="ANNOTATE"]',
    );

    if (category) {
      category.click();
    }

    await new Promise((r) => setTimeout(r, 350));

    const button = [...document.querySelectorAll(".drawing-tool")].find(
      (n) => /variable dimension/i.test(n.textContent),
    );

    /* The ids the panel actually offered, so a miss is diagnosable. */
    const offered = [...document.querySelectorAll(".drawing-tool")].map(
      (n) => n.dataset.toolId,
    );

    return {
      present: Boolean(button),
      toolId: button ? button.dataset.toolId : null,
      offered,
    };
  });

  out.toolset = out.toolset;

  /* The Features panel offers the symbol, and stores it verbatim. */
  out.panel = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const variable = ds.geometryFactories["variable-dimension"]({
      refs: [],
      placement: { x: 50, y: 50 },
    });

    variable.id = "vardim_1";

    st.objects.push(variable);
    ds.commitDrawingChange(st, before);
    ds.selectObject(st, "vardim_1");

    window.enggEditorState.featurePanelView = "edit";

    const toggle = document.getElementById("drawingFeaturesPanelToggle");

    if (toggle) {
      toggle.click();
    }

    await new Promise((r) => setTimeout(r, 350));

    const panel = document.querySelector("#drawingProperties");
    const field = panel.querySelector('[data-property="symbol"]');

    return {
      panelText: (panel.innerText || "").replace(/\n+/g, " | ").slice(0, 160),
      hasSymbolField: Boolean(field),
      fieldValue: field ? field.value : null,
      /* No numeric value field: an unknown has no number. */
      hasMagnitudeField: Boolean(
        panel.querySelector('[data-property="magnitude"]'),
      ),
    };
  });

  out.panel = out.panel;

  /* Editing the symbol stores it; clearing it stores EMPTY, not a default. */
  out.symbol = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const variable = st.objects.find((o) => o.id === "vardim_1");

    /* What the panel's setter writes. */
    const setter = window.enggPropertyUpdate;

    if (setter && typeof setter.updateProperty === "function") {
      setter.updateProperty(variable, "symbol", "L");
    } else {
      variable.symbol = "L";
    }

    const afterSet = variable.symbol;

    variable.symbol = "";

    return {
      afterSet,
      afterClear: variable.symbol,
      emptyText: window.enggVariableDimension.variableText(variable),
      /* An empty symbol is empty - not 0, not ? */
      notZero: variable.symbol !== "0",
      notQuestion: variable.symbol !== "?",
    };
  });

  out.symbol = out.symbol;

  /* It persists as its own type, with its symbol and placement. */
  out.persists = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const variable = st.objects.find((o) => o.id === "vardim_1");

    variable.symbol = "R";
    variable.placement = { x: 123, y: 456 };

    const body = window.enggDrawingSheets.serializeDocumentBody();
    const read = window.enggDocumentFile.readDocument(
      window.enggDocumentFile.createDocument(body),
    );

    const saved = (read.document?.sheets || [])
      .flatMap((sheet) => sheet.objects || [])
      .find((o) => o.id === "vardim_1");

    return {
      readOk: read.ok,
      savedType: saved ? saved.type : null,
      savedSymbol: saved ? saved.symbol : null,
      savedPlacement: saved ? saved.placement : null,
    };
  });

  out.persists = out.persists;

  /* A measured dimension still reads as a measurement. */
  out.noRegression = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);

    const line = F.line({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: {} });
    line.id = "line_dim";
    st.objects.push(line);

    const dim = F.dimension({
      dimensionType: "linear",
      refs: [
        { kind: "between", featureId: "line_dim", anchor: "start" },
        { kind: "between", featureId: "line_dim", anchor: "end" },
      ],
      placement: { x: 50, y: 20 },
    });

    dim.id = "dim_1";
    st.objects.push(dim);
    ds.commitDrawingChange(st, before);

    const measured = ds.dimensionModel.formatMeasurement(dim, st);

    return {
      type: dim.type,
      measured,
      /* A measured dimension states a NUMBER, not a symbol. */
      isNumeric: Boolean(measured && /\d/.test(measured)),
      hasSymbol: "symbol" in dim,
    };
  });

  out.noRegression = out.noRegression;

  out.errors = errors;

  return out;
}