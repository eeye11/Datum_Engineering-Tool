/*
 * Does the line-type icon show the SELECTED pattern? Set each type and read the
 * icon's stroke-dasharray.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForFunction(
    () => {
      const s = document.querySelector(".drawing-style-strip");
      return s && s.getBoundingClientRect().height > 0;
    },
    { timeout: 15000 },
  );
  await page.waitForTimeout(300);

  const read = () =>
    page.evaluate(() => {
      const p = document.getElementById("drawingLineTypeStroke");
      return {
        dash: p ? p.getAttribute("stroke-dasharray") : "NO PATH",
        title: document.getElementById("drawingLineType").getAttribute("title"),
      };
    });

  const out = {};

  for (const t of ["solid", "dashed", "center", "construction"]) {
    await page.evaluate((val) => {
      const el = document.getElementById("drawingLineType");
      el.value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, t);
    await page.waitForTimeout(150);
    out[t] = await read();
  }

  /* Restore. */
  await page.evaluate(() => {
    const el = document.getElementById("drawingLineType");
    el.value = "solid";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  return out;
}
