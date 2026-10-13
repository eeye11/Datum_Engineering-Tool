/*
 * Checks the engineering grid's actual rendered colour and computed contrast in
 * both themes, in the running application.
 */
export default async function run(page, ui) {
  /* Open the Engineering Drawing workspace. */
  await page.getByText("Engineering Drawing").click();
  await page.waitForTimeout(600);

  const probe = async (theme) => {
    /* Force the theme the way the app's own resolver does. */
    await page.evaluate((t) => {
      const root = document.documentElement;
      if (t === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", t);
    }, theme);

    /* Ask the app to repaint, through its public theme entry point. */
    await page.evaluate(async () => {
      const mod = await import("/src/editor/theme.js").catch(() => null);
      if (mod && mod.setThemePreference)
        mod.setThemePreference(
          document.documentElement.getAttribute("data-theme") || "system",
        );
    });
    await page.waitForTimeout(500);

    return page.evaluate(() => {
      const canvas = document.querySelector(".drawing-canvas");
      const grid = document.querySelector(".drawing-engineering-grid");
      const style = (el) => (el ? getComputedStyle(el) : null);

      return {
        theme: document.documentElement.getAttribute("data-theme") || "system",
        canvasExists: Boolean(canvas),
        canvasBg: canvas ? style(canvas).backgroundColor : null,
        gridExists: Boolean(grid),
        gridStroke: grid ? style(grid).stroke : null,
        gridStrokePixels: grid ? style(grid).strokeWidth : null,
        gridDisplay: grid ? style(grid).display : null,
        gridOpacity: grid ? style(grid).opacity : null,
        gridVisibility: grid ? style(grid).visibility : null,
        gridBBox: grid
          ? (() => {
              const b = grid.getBBox();
              return { w: Math.round(b.width), h: Math.round(b.height) };
            })()
          : null,
        gridPathLen: grid ? grid.getAttribute("d").length : 0,
        gridParentIsSvg: grid ? grid.parentElement.tagName : null,
        gridIndexInSvg:
          grid && grid.parentElement
            ? Array.from(grid.parentElement.children).indexOf(grid)
            : null,
        svgChildCount: canvas ? canvas.querySelectorAll("svg > *").length : 0,
        gridStateVisible: window.enggDrawing?.state?.grid?.visible ?? null,
        tokens: {
          gridMinor: getComputedStyle(document.documentElement)
            .getPropertyValue("--grid-minor-color")
            .trim(),
          gridMajor: getComputedStyle(document.documentElement)
            .getPropertyValue("--grid-major-color")
            .trim(),
          canvas: getComputedStyle(document.documentElement)
            .getPropertyValue("--canvas-background")
            .trim(),
          axisX: getComputedStyle(document.documentElement)
            .getPropertyValue("--axis-x-color")
            .trim(),
        },
      };
    });
  };

  const light = await probe("light");
  const dark = await probe("dark");

  return { light, dark };
}
