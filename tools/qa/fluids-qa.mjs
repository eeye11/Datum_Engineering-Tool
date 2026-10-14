/*
 * Fluids QA: select the FLUIDS toolset and read back what the Tools panel
 * actually renders - the category headings and the tools under each.
 *
 * The point is to record what ACTUALLY appears, not what the registry says.
 */
export default async function run(page, ui) {
  /*
   * The toolset buttons may be inside a hidden top bar in this workspace, so
   * wait for them in the DOM rather than for VISIBILITY - the inventory QA
   * clicks them the same way.
   */
  await page.waitForFunction(
    () => document.querySelectorAll(".drawing-category").length > 0,
    { timeout: 20000 },
  );

  /* Switch to the Fluids toolset. */
  const switched = await page.evaluate(() => {
    const button = [...document.querySelectorAll(".drawing-category")].find(
      (el) => el.dataset.category === "FLUIDS",
    );
    if (!button) return false;
    button.click();
    return true;
  });

  await page.waitForTimeout(300);

  const heading = await page.evaluate(
    () => document.querySelector("#drawingToolHeading")?.textContent?.trim() || "",
  );

  const structure = await page.evaluate(() => {
    const list = document.querySelector("#drawingToolList");
    if (!list) return { error: "no tool list" };

    return [...list.querySelectorAll(".drawing-tool-group")].map((group) => ({
      label:
        group.querySelector(".drawing-tool-group-label")?.textContent?.trim() ||
        "",
      tools: [...group.querySelectorAll(".drawing-tool")].map((button) => ({
        id: button.dataset.toolId || null,
        label: button.querySelector(".drawing-tool-label")?.textContent?.trim() ||
          button.textContent.trim(),
        icon: Boolean(button.querySelector("svg")),
        submenu: button.getAttribute("aria-haspopup") === "menu",
      })),
    }));
  });

  const totalTools = Array.isArray(structure)
    ? structure.reduce((sum, group) => sum + group.tools.length, 0)
    : 0;

  const missingIcons = Array.isArray(structure)
    ? structure
        .flatMap((group) => group.tools)
        .filter((tool) => !tool.icon)
        .map((tool) => tool.label)
    : [];

  /* Now press a representative tool in each capability and read the message. */
  const press = async (id) => {
    const ok = await page.evaluate((toolId) => {
      const button = document.querySelector(
        `.drawing-tool[data-tool-id="${toolId}"]`,
      );
      if (!button) return false;
      button.click();
      return true;
    }, id);

    await page.waitForTimeout(150);

    const message = await page.evaluate(
      () => document.querySelector("#drawingToolMessage")?.textContent?.trim() || "",
    );

    const active = await page.evaluate(
      (toolId) =>
        document
          .querySelector(`.drawing-tool[data-tool-id="${toolId}"]`)
          ?.classList.contains("active") || false,
      id,
    );

    return { pressed: ok, message, highlighted: active };
  };

  const probes = {
    "pipe-duct": await press("pipe-duct"),
    pump: await press("pump"),
    "flow-arrow": await press("flow-arrow"),
    "pipe-diameter": await press("pipe-diameter"),
    "flow-rate-label": await press("flow-rate-label"),
  };

  /* Back to Select so the drawing is left clean. */
  await page.evaluate(() => {
    document.querySelector('.drawing-tool[data-tool-id="select"]')?.click();
  });

  return {
    switched,
    heading,
    categoryCount: Array.isArray(structure) ? structure.length : 0,
    categories: Array.isArray(structure)
      ? structure.map((group) => `${group.label} (${group.tools.length})`)
      : structure,
    totalTools,
    missingIcons,
    structure,
    probes,
  };
}