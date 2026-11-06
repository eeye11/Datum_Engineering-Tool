export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = {};

  await page.locator('.tab[data-tab="drawing"]').click({ force: true });
  await wait(2000);

  await page.evaluate(() => {
    document
      .querySelectorAll("[data-recovery-prompt], .drawing-recovery-prompt")
      .forEach((n) => n.remove());
  });

  const canvas = await page.locator(".drawing-canvas").first().boundingBox();

  const createWith = async (category, tool, action) => {
    await page.evaluate((cat) => {
      document
        .querySelector(`.drawing-category[data-category="${cat}"]`)
        ?.click();
    }, category);
    await wait(500);

    await page.evaluate((id) => {
      /* Open whatever collapsible family holds it. */
      for (const parent of document.querySelectorAll("[data-tool-id]")) {
        if (parent.getAttribute("aria-expanded") === "false") parent.click();
      }
      document.querySelector(`[data-tool-id="${id}"]`)?.click();
    }, tool);
    await wait(400);

    if (action === "click") {
      await page.mouse.click(canvas.x + 200, canvas.y + 200);
    } else {
      await page.mouse.move(canvas.x + 200, canvas.y + 200);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 330, canvas.y + 260, { steps: 8 });
      await page.mouse.up();
    }

    await wait(900);

    const result = await page.evaluate(() => ({
      labelField: document.querySelectorAll(".drawing-label-entry").length,
      anyPrompt: document.querySelectorAll(".drawing-inline-entry").length,
    }));

    await page.keyboard.press("Escape");
    await wait(300);

    return result;
  };

  out.particle = await createWith("DYNAMICS", "dynamics-particle", "click");
  out.rigidBody = await createWith("DYNAMICS", "dynamics-rigid-body", "drag");
  out.spring = await createWith("DYNAMICS", "dynamics-spring", "drag");

  return out;
}
