export default async function run(page, ui) {
  await page.waitForFunction(() => !!window.enggDrawing, { timeout: 10000 });
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  // Click FLUIDS
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(300);

  // Click Pipe / Duct
  const snap = await ui.snapshot();
  const pipeBtn = snap.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(300);

  const armed = await page.evaluate(() => {
    const s = window.enggDrawing.state;
    return {
      activeTool: s.activeTool,
      interaction: JSON.parse(JSON.stringify(s.interaction)),
      message: document
        .getElementById("drawingToolMessage")
        ?.textContent?.trim(),
    };
  });

  return { armed };
}
