export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    [...document.querySelectorAll("[data-tool-id]")]
      .find((n) => n.getAttribute("data-tool-id") === "line")
      ?.click();
  });

  await page.waitForTimeout(400);

  const probe = await page.evaluate(() => {
    const out = {};
    const el = document.querySelector("#drawingToolList");

    out.elementKeys = Object.keys(el || {}).filter((k) =>
      /react|vue|__|fiber/i.test(k),
    );

    out.windowHigh = Object.keys(window).filter((k) => /datum|engg/i.test(k));

    /* Which module instance does the canvas read? Ask the message module. */
    return out;
  });

  const mod = await page.evaluate(async () => {
    const a = await import("/src/components/layout/toolbar/toolbar-render.js");

    return {
      keys: Object.keys(a).slice(0, 20),
      message: document.querySelector("#drawingToolMessage")?.textContent,
    };
  });

  return { probe, mod };
}
