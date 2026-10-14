export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const data = await page.evaluate(() => {
    const strip = document.querySelector(".drawing-style-strip");
    const kids = [...strip.children];
    const rows = [];
    let prevRight = null;

    kids.forEach((c) => {
      const r = c.getBoundingClientRect();
      const gap = prevRight === null ? null : Math.round(r.left - prevRight);
      rows.push({
        el: c.id || c.className.toString().split(" ").slice(-1)[0],
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        gap,
      });
      prevRight = r.right;
    });

    /* The colour control's box vs the swatch inside it. */
    const colourWrap = document.querySelector(".drawing-strip-colour");
    const swatch = document.querySelector(".drawing-colour-swatch");
    const cw = colourWrap?.getBoundingClientRect();
    const sr = swatch?.getBoundingClientRect();

    return {
      rows,
      stripHeight: Math.round(strip.getBoundingClientRect().height),
      colourWrap: cw
        ? [
            Math.round(cw.x),
            Math.round(cw.y),
            Math.round(cw.width),
            Math.round(cw.height),
          ]
        : null,
      swatch: sr
        ? [
            Math.round(sr.x),
            Math.round(sr.y),
            Math.round(sr.width),
            Math.round(sr.height),
          ]
        : null,
      swatchRadius: swatch ? getComputedStyle(swatch).borderRadius : null,
    };
  });

  const lines = data.rows.map(
    (r) =>
      `${String(r.el).padEnd(28)} w=${String(r.w).padStart(3)} h=${String(r.h).padStart(2)} top=${String(r.top).padStart(3)} gap=${r.gap}`,
  );

  return (
    lines.join("\n") +
    `\n\nstripHeight=${data.stripHeight}\ncolourWrap=${JSON.stringify(data.colourWrap)}\nswatch=${JSON.stringify(data.swatch)}\nswatchRadius=${data.swatchRadius}`
  );
}
