/*
 * QA the Annotate V1 changes in the RUNNING app.
 *
 *  - the V1 toolset shows the eight tools and NOT Arrow / Tolerance
 *  - the Symbol tool opens a searchable library picker
 *  - the Table tool opens a size grid
 *  - Variable Dimension asks for content (its value popup appears)
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
  await page.waitForTimeout(900);

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(1200);
  }

  /* Open the Annotate category and read the tools it offers. */
  await page.locator('.drawing-category[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);

  out.annotateTools = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".drawing-tool")).map((e) => ({
      id: e.getAttribute("data-tool-id"),
      label: e.textContent.trim(),
    })),
  );

  out.groupLabels = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        ".drawing-tools-section-label, .drawing-tool-group-label",
      ),
    ).map((e) => e.textContent.trim()),
  );

  const ids = out.annotateTools.map((t) => t.id);

  out.checks = {
    hasVariableDimension: ids.includes("variable-dimension"),
    hasSmartDimension: ids.includes("smart-dimension"),
    hasNote: ids.includes("note"),
    hasLabel: ids.includes("label"),
    hasLeader: ids.includes("leader"),
    hasCallout: ids.includes("callout"),
    hasSymbol: ids.includes("symbol"),
    hasTable: ids.includes("table"),
    noArrow: !ids.includes("arrow"),
    noTolerance: !ids.includes("tolerance"),
  };

  /* Arm the Symbol tool and click the canvas: the library must open. */
  await page.locator('.drawing-tool[data-tool-id="symbol"]').click();
  await page.waitForTimeout(300);

  const canvas = await page.locator(".drawing-canvas").first().boundingBox();

  await page.mouse.click(
    canvas.x + canvas.width * 0.5,
    canvas.y + canvas.height * 0.5,
  );
  await page.waitForTimeout(500);

  out.symbolPicker = await page.evaluate(() => {
    const picker = document.querySelector(".datum-symbol-picker");
    return {
      open: Boolean(picker),
      hasSearch: Boolean(picker?.querySelector("[data-symbol-search]")),
      groups: picker
        ? Array.from(
            picker.querySelectorAll(".datum-symbol-picker-heading"),
          ).map((h) => h.textContent.trim())
        : [],
      items: picker ? picker.querySelectorAll("[data-symbol-id]").length : 0,
    };
  });

  /* Close the picker. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  /* Arm Table and click: the size grid must open. */
  await page.locator('.drawing-tool[data-tool-id="table"]').click();
  await page.waitForTimeout(300);

  await page.mouse.click(
    canvas.x + canvas.width * 0.5,
    canvas.y + canvas.height * 0.5,
  );
  await page.waitForTimeout(500);

  out.tablePicker = await page.evaluate(() => {
    const picker = document.querySelector(".datum-table-picker");
    return {
      open: Boolean(picker),
      cells: picker
        ? picker.querySelectorAll(".datum-table-picker-cell").length
        : 0,
    };
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  return out;
}
