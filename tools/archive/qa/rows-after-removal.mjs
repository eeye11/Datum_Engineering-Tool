/*
 * THE WORKSPACE ROWS, AFTER REMOVING THE TOOL BAR.
 *
 * The workspace is a six-track grid matched positionally to its children. The
 * menu row replaced the tool bar as the first child, so the strip must still be
 * in row three and the canvas must still have its full height.
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const ws = document.querySelector(".drawing-workspace");

    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height) };
    };

    return {
      workspaceChildren: [...ws.children].map((c) =>
        String(c.className || c.id || c.tagName).slice(0, 34),
      ),
      menubar: box(".datum-menubar"),
      menuLabels: [...document.querySelectorAll(".datum-menu-label")].map(
        (l) => l.textContent,
      ),
      toolBarGone: !document.querySelector(".drawing-app-toolbar"),
      toolTypeBar: box(".drawing-toolbar"),
      styleStrip: box(".drawing-style-strip"),
      styleStripLabels: [
        ...document.querySelectorAll(".drawing-style-strip label"),
      ].map((l) =>
        l.textContent
          .trim()
          .split(/\s{2,}/)[0]
          .slice(0, 16),
      ),
      canvas: box(".drawing-canvas"),
      undoButtonGone: !document.getElementById("drawingUndo"),
    };
  });
}
