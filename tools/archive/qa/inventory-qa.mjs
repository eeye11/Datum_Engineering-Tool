/*
 * Inventory QA: for every category, list the tool buttons that render, then
 * click one tool in each of the eight "unimplemented" categories and report
 * what the bottom-bar message and the feature count become.
 *
 * The point is to record what ACTUALLY happens, not what should.
 */
export default async function run(page, ui) {
  const categories = [
    "GEOMETRY",
    "ANNOTATE",
    "STATICS",
    "DYNAMICS",
    "FLUIDS",
    "THERMODYNAMICS",
    "HEAT TRANSFER",
    "SOLID MECHANICS",
    "MECHANICAL DESIGN",
    "CONTROLS",
    "MATH / ANALYSIS",
  ];

  const result = {};

  for (const category of categories) {
    await page.evaluate((cat) => {
      const button = [...document.querySelectorAll(".drawing-category")].find(
        (el) => el.dataset.category === cat,
      );
      button?.click();
    }, category);

    await page.waitForTimeout(150);

    const tools = await page.evaluate(() => {
      return [
        ...document.querySelectorAll("#drawingToolList .drawing-tool"),
      ].map((el) => ({
        id: el.dataset.toolId || null,
        label: el.textContent.trim(),
        submenu: el.getAttribute("aria-haspopup") === "menu",
      }));
    });

    result[category] = { tools };
  }

  // Now: click a representative tool in each of the 8 unimplemented categories
  // and see whether anything is created or the message changes.
  const probes = [
    { category: "DYNAMICS", label: "Velocity" },
    { category: "FLUIDS", label: "Pipe" },
    { category: "THERMODYNAMICS", label: "State Point" },
    { category: "HEAT TRANSFER", label: "Wall" },
    { category: "SOLID MECHANICS", label: "Stress" },
    { category: "MECHANICAL DESIGN", label: "Gear" },
    { category: "CONTROLS", label: "Block" },
    { category: "MATH / ANALYSIS", label: "Function" },
  ];

  result.probes = [];

  for (const probe of probes) {
    await page.evaluate((cat) => {
      const button = [...document.querySelectorAll(".drawing-category")].find(
        (el) => el.dataset.category === cat,
      );
      button?.click();
    }, probe.category);

    await page.waitForTimeout(120);

    const before = await page.evaluate(
      () => document.querySelector("#drawingToolMessage")?.textContent || "",
    );
    const countBefore = await page.evaluate(
      () => window.__datumState?.objects?.length ?? null,
    );

    const clicked = await page.evaluate((label) => {
      const button = [
        ...document.querySelectorAll("#drawingToolList .drawing-tool"),
      ].find((el) => el.textContent.trim() === label);
      if (!button) return false;
      button.click();
      return true;
    }, probe.label);

    await page.waitForTimeout(150);

    // Try a click on the canvas to see whether anything is created.
    const canvas = await page.$("#drawingCanvas");
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
    }

    await page.waitForTimeout(150);

    const after = await page.evaluate(
      () => document.querySelector("#drawingToolMessage")?.textContent || "",
    );
    const activeTool = await page.evaluate(() => {
      const active = document.querySelector(
        "#drawingToolList .drawing-tool.active",
      );
      return active?.dataset.toolId || active?.textContent.trim() || null;
    });

    result.probes.push({
      category: probe.category,
      label: probe.label,
      buttonFound: clicked,
      messageBefore: before,
      messageAfter: after,
      activeTool,
      countBefore,
    });
  }

  return result;
}
