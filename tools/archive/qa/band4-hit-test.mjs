/*
 * What element is actually at the centre of each Band 4 control?
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  return await page.evaluate(() => {
    const describe = (el) =>
      el
        ? `${el.tagName.toLowerCase()}#${el.id || "-"}.${el.className || "-"}`
        : null;

    const ids = [
      "drawingUndo",
      "drawingRedo",
      "drawingThickness",
      "drawingColor",
      "drawingLineType",
      "drawingGridToggle",
      "drawingSnapToggle",
      "drawingVectorScale",
    ];

    return ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      return {
        id,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        topAtCentre: describe(document.elementFromPoint(cx, cy)),
      };
    });
  });
}
