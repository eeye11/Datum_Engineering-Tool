/*
 * Look at the four top bands on the Engineering Drawing tab and report what is
 * actually there: heights, order, text, and whether each control reads real
 * state. Read-only; changes nothing.
 */
export default async function run(page, ui) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const report = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        visible: r.width > 0 && r.height > 0,
      };
    };

    const strip = document.querySelector(".drawing-style-strip");
    const children = strip
      ? [...strip.children].map((c) => ({
          tag: c.tagName.toLowerCase(),
          cls: c.className?.toString().slice(0, 30),
          text: (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 28),
          w: Math.round(c.getBoundingClientRect().width),
        }))
      : [];

    const theme =
      document.documentElement.getAttribute("data-theme") || "(system)";

    return {
      theme,
      header: box(".header"),
      headerText: document
        .querySelector(".header")
        ?.innerText.replace(/\n/g, " | "),
      documentText: document.getElementById("headerDocumentBaseName")
        ?.textContent,
      dirtyShown: !document.getElementById("headerDocumentDirty")?.hidden,
      tabs: [...document.querySelectorAll(".tabs .tab")].map((t) => ({
        text: t.innerText.trim(),
        active: t.classList.contains("active"),
        top: Math.round(t.getBoundingClientRect().top),
      })),
      menubar: box(".datum-menubar"),
      menuLabels: [...document.querySelectorAll(".datum-menu-label")].map(
        (l) => l.textContent,
      ),
      toolset: box(".drawing-toolbar"),
      toolsetItems: [...document.querySelectorAll(".drawing-category")].map(
        (c) => ({
          text: c.textContent.trim(),
          active: c.classList.contains("active"),
        }),
      ),
      strip,
      stripChildren: children,
      undoDisabled: document.getElementById("drawingUndo")?.disabled,
      redoDisabled: document.getElementById("drawingRedo")?.disabled,
      grid: document.getElementById("drawingGridToggle")?.className,
      snap: document.getElementById("drawingSnapToggle")?.className,
      dimensions: document.getElementById("drawingDimensionsToggle")?.className,
      magnitudes: document.getElementById("drawingMagnitudesToggle")?.className,
      vectorScaleValue: document.getElementById("drawingVectorScale")?.value,
      colour: document.getElementById("drawingColor")?.value,
      thickness: document.getElementById("drawingThickness")?.value,
      lineType: document.getElementById("drawingLineType")?.value,
      bodyScrollW: document.documentElement.scrollWidth,
      bodyClientW: document.documentElement.clientWidth,
    };
  });

  return report;
}
