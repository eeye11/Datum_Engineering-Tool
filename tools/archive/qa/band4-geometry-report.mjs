/*
 * Report only the fields that matter, compactly.
 */
export default async function run(page, ui) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  const data = await page.evaluate(() => {
    const r = (el) => {
      if (!el) return "missing";
      const b = el.getBoundingClientRect();
      return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
    };
    const at = (el) => {
      if (!el) return "missing";
      const b = el.getBoundingClientRect();
      const t = document.elementFromPoint(
        b.x + b.width / 2,
        b.y + b.height / 2,
      );
      return t ? `${t.tagName.toLowerCase()}#${t.id || "-"}` : "none";
    };

    return [
      [
        "colourInput",
        r(document.getElementById("drawingColor")),
        at(document.getElementById("drawingColor")),
      ],
      [
        "swatch",
        r(document.querySelector(".drawing-colour-swatch")),
        at(document.querySelector(".drawing-colour-swatch")),
      ],
      [
        "colourWrap",
        r(document.querySelector(".drawing-strip-colour")),
        at(document.querySelector(".drawing-strip-colour")),
      ],
      [
        "ltSelect",
        r(document.getElementById("drawingLineType")),
        at(document.getElementById("drawingLineType")),
      ],
      [
        "grid",
        r(document.getElementById("drawingGridToggle")),
        at(document.getElementById("drawingGridToggle")),
      ],
      [
        "snap",
        r(document.getElementById("drawingSnapToggle")),
        at(document.getElementById("drawingSnapToggle")),
      ],
      [
        "thickness",
        r(document.getElementById("drawingThickness")),
        at(document.getElementById("drawingThickness")),
      ],
      [
        "vector",
        r(document.getElementById("drawingVectorScale")),
        at(document.getElementById("drawingVectorScale")),
      ],
    ];
  });

  return data
    .map(
      ([name, rect, top]) => `${name.padEnd(12)} ${rect.padEnd(22)} top=${top}`,
    )
    .join("\n");
}
