export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const out = {};

  const tab = page.locator('.tab[data-tab="drawing"]');
  await tab.click({ force: true });
  await wait(2000);

  /* Listen for the browser's own click event at the document level. */
  await page.evaluate(() => {
    window.__hits = 0;
    window.__patched = 0;
    document.addEventListener(
      "click",
      (event) => {
        if (event.target?.closest?.("#drawingSpecialSymbols")) window.__hits += 1;
      },
      true,
    );
  });

  await page.locator("#drawingSpecialSymbols").click({ force: true });
  await wait(900);

  out.result = await page.evaluate(() => ({
    hits: window.__hits,
    picker: document.querySelectorAll(".datum-symbol-picker").length,
    bodyChildren: document.body.children.length,
    lastChild: document.body.lastElementChild
      ? `${document.body.lastElementChild.tagName}.${document.body.lastElementChild.className}`.slice(0, 60)
      : null,
    /* Is the panel the button lives in actually the visible one? */
    stripRect: (() => {
      const strip = document.querySelector(".drawing-style-strip");
      const r = strip?.getBoundingClientRect();
      return r ? { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) } : null;
    })()
  }));

  return out;
}
