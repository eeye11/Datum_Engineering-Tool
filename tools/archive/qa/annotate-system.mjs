/*
 * ========================================================
 * ANNOTATE TOOLSET: STRUCTURE AND EVERY TOOL
 * ========================================================
 *
 * Checks the two things the redesign asks for, on the real page:
 *
 *   1. STRUCTURE - ANNOTATE shows Selection and Create as categories, with
 *      every command listed DIRECTLY under them. No caret, no submenu, no
 *      hidden command.
 *   2. FUNCTION - each of the ten tools activates and creates its feature.
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
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 15000 },
  );

  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1000);

  // --- STRUCTURE -----------------------------------------------------------
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);

  out.structure = await page.evaluate(() => {
    const list = document.querySelector("#drawingToolList");
    const groups = [...list.querySelectorAll(".drawing-tool-group")].map(
      (g) => ({
        label: g.querySelector(".drawing-tool-group-label")?.textContent?.trim(),
        tools: [...g.querySelectorAll(".drawing-tool")].map((b) => ({
          id: b.dataset.toolId,
          label: b.querySelector(".drawing-tool-label")?.textContent?.trim(),
          hasSubmenuCaret: !!b.querySelector(".drawing-tool-caret"),
          hasPopupAttr: b.getAttribute("aria-haspopup") || null,
        })),
      }),
    );

    return {
      heading: document.querySelector("#drawingToolHeading")?.textContent?.trim(),
      groups,
    };
  });

  // --- FUNCTION: create one of each ---------------------------------------
  const box = await page.locator(".drawing-canvas").first().boundingBox();
  const cx = box.x + box.width * 0.45;
  const cy = box.y + box.height * 0.45;

  const countObjects = (type) =>
    page.evaluate(
      (t) => window.enggDrawing.state.objects.filter((o) => o.type === t).length,
      type,
    );

  const annotateKindCount = () =>
    page.evaluate(() => {
      const byKind = {};
      window.enggDrawing.state.objects
        .filter((o) => o.type === "annotate")
        .forEach((o) => {
          byKind[o.annotateKind] = (byKind[o.annotateKind] || 0) + 1;
        });
      return byKind;
    });

  const tool = async (id) => {
    const b = page.locator(`#drawingToolList [data-tool-id="${id}"]`);
    if (!(await b.count())) return false;
    await b.first().click();
    await page.waitForTimeout(250);
    return true;
  };

  const dismissPopups = async () => {
    // A creation-size popup (for dimensions) commits on Enter.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
  };

  out.toolsActivated = {};

  /*
   * Line first, so the dimension tools have something to measure. The Line
   * tool STAYS ARMED after a commit, so it is selected ONCE and used twice -
   * re-clicking it would toggle it off to Select (correct app behaviour,
   * but not what this test wants).
   */
  await page.locator('button[data-category="GEOMETRY"]').click();
  await page.waitForTimeout(250);
  await tool("line");

  await page.mouse.click(cx - 120, cy + 60);
  await page.waitForTimeout(180);
  await page.mouse.click(cx + 60, cy - 40);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  out.lines = await countObjects("line");

  // A second line at an angle, for the angle measurement.
  await page.mouse.click(cx - 120, cy - 60);
  await page.waitForTimeout(180);
  await page.mouse.click(cx + 60, cy - 40);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  out.linesAfterSecond = await countObjects("line");

  // --- POINT-PLACED TOOLS --------------------------------------------------
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(300);

  const pointTools = ["note", "symbol", "table", "label", "tolerance"];
  for (const id of pointTools) {
    out.toolsActivated[id] = await tool(id);
    await page.mouse.click(cx + 30, cy + 30);
    await page.waitForTimeout(350);
  }

  // --- GEOMETRIC TOOLS: click-move-click ----------------------------------
  for (const id of ["leader", "callout", "arrow"]) {
    out.toolsActivated[id] = await tool(id);
    await page.mouse.click(cx - 60, cy + 80);
    await page.waitForTimeout(180);
    await page.mouse.click(cx + 20, cy + 120);
    await page.waitForTimeout(350);
  }

  // --- DIMENSIONS ----------------------------------------------------------
  out.toolsActivated["smart-dimension"] = await tool("smart-dimension");
  await page.mouse.click(cx - 60, cy + 30); // midpoint of the first line
  await page.waitForTimeout(300);
  await page.mouse.click(cx + 40, cy - 120); // place above
  await page.waitForTimeout(400);
  await dismissPopups();

  out.toolsActivated["variable-dimension"] = await tool("variable-dimension");
  await page.mouse.click(cx - 60, cy + 30);
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 40, cy - 130);
  await page.waitForTimeout(400);
  await dismissPopups();

  out.annotateKinds = await annotateKindCount();
  out.dimensions = await page.evaluate(() =>
    window.enggDrawing.state.objects
      .filter((o) => o.type === "dimension" || o.type === "variable-dimension")
      .map((o) => o.type),
  );

  // Select one annotate feature and check the panel renders it.
  out.panelAfterSelect = await page.evaluate(() => {
    const st = window.enggDrawing.state;
    const note = st.objects.find(
      (o) => o.type === "annotate" && o.annotateKind === "note",
    );
    if (!note) return { found: false };
    window.enggDrawingState.selectObject(st, note.id);
    return { found: true, name: note.name };
  });

  await page.waitForTimeout(300);

  return out;
}
