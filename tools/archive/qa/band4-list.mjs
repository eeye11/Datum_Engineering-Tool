/*
 * List every child of Band 4, in order, with its size - so the exact sequence
 * and any stray control can be seen.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  const rows = await page.evaluate(() => {
    const strip = document.querySelector(".drawing-style-strip");
    return [...strip.children].map((c) => {
      const r = c.getBoundingClientRect();
      return [
        c.tagName.toLowerCase(),
        c.id || c.className.toString().split(" ")[0],
        `${Math.round(r.width)}x${Math.round(r.height)}`,
        (c.innerText || c.getAttribute("title") || "").trim().slice(0, 22),
      ];
    });
  });

  return rows.map((r) => r.join(" | ")).join("\n");
}
