export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = { errors: [] };

  page.on("pageerror", (error) => out.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error")
      out.errors.push(`console: ${message.text()}`);
  });

  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="drawing"]')?.click(),
  );
  await wait(1500);

  /*
   * A CLONE test: if the button's listener is attached, clicking a detached
   * clone does nothing; clicking the real node should. Counting the appended
   * body children distinguishes "opened and removed" from "never ran".
   */
  out.windowHook = await page.evaluate(() => {
    const names = Object.keys(window).filter((key) =>
      /datum|symbol/i.test(key),
    );

    return {
      names,
      datumKeys: window.datum ? Object.keys(window.datum).slice(0, 20) : null,
    };
  });

  /* Does the Annotate → Symbols tool still open the same picker? */
  out.annotatePath = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("[data-tool-id]")].map(
      (n) => n.dataset.toolId,
    );
    const category = document.querySelector(
      '.drawing-category[data-category="ANNOTATE"]',
    );

    category?.click();

    const symbolTool = [...document.querySelectorAll("[data-tool-id]")].some(
      (n) => n.dataset.toolId === "symbol",
    );

    return { hasSymbolTool: symbolTool, sampleIds: buttons.slice(0, 12) };
  });

  await wait(500);

  return out;
}
