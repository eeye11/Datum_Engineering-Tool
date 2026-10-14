export default async function run(page, ui) {
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);

  const out = {};

  // Check window.enggDrawing
  out.init = await page.evaluate(() => {
    return {
      hasEnggDrawing: !!window.enggDrawing,
      activeTool: window.enggDrawing?.state?.activeTool,
    };
  });

  // Switch to FLUIDS
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(400);

  const snap = await ui.snapshot();
  const pipeBtn = snap.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  out.pipeBtn = pipeBtn;
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(400);

  out.afterArm = await page.evaluate(() => {
    const s = window.enggDrawing?.state;
    const msg = document
      .getElementById("drawingToolMessage")
      ?.textContent?.trim();
    const btn = document.querySelector('[data-tool-id="pipe-duct"]');
    return {
      activeTool: s?.activeTool,
      interaction: s?.interaction,
      message: msg,
      buttonActive: btn?.classList?.contains("active"),
      buttonClass: btn?.className,
    };
  });

  return out;
}
