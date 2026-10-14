/* Open the Engineering Drawing tab, then report the rows and the menu bar. */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(900);

  const rows = await page.evaluate(() => {
    const ws = document.querySelector(".drawing-workspace");
    const strip = document.querySelector(".drawing-style-strip");

    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height) };
    };

    return {
      menuRow: box(document.querySelector(".drawing-menu-row")),
      menubar: box(document.querySelector(".datum-menubar")),
      menubarChildren:
        document.querySelector(".datum-menubar")?.children.length,
      menuLabels: [...document.querySelectorAll(".datum-menu-label")].map(
        (l) => l.textContent,
      ),
      toolBar: box(document.querySelector(".drawing-toolbar")),
      styleStrip: box(strip),
      canvas: box(document.querySelector(".drawing-canvas")),
    };
  });

  return rows;
}
