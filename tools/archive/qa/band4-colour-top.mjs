/*
 * What is on top at the swatch's centre, and is the swatch actually sized?
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  return await page.evaluate(() => {
    const sw = document.getElementById("drawingColourSwatch");
    const r = sw.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = top;
    while (n && n !== document.body) {
      chain.push(
        `${n.tagName.toLowerCase()}#${n.id || "-"}.${String(n.className).split(" ")[0]}`,
      );
      n = n.parentElement;
    }
    const cs = getComputedStyle(sw);
    return {
      swatchRect: [
        Math.round(r.x),
        Math.round(r.y),
        Math.round(r.width),
        Math.round(r.height),
      ],
      swatchPos: cs.position,
      swatchZ: cs.zIndex,
      swatchPE: cs.pointerEvents,
      topAtCentre: `${top?.tagName.toLowerCase()}#${top?.id || "-"}.${String(top?.className).split(" ")[0]}`,
      topChain: chain,
    };
  });
}
