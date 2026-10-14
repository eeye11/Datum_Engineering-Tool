export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const rows = await page.evaluate(() => {
    const strip = document.querySelector(".drawing-style-strip");
    const out = [];

    [...strip.children].forEach((c) => {
      const r = c.getBoundingClientRect();
      const icons = [...c.querySelectorAll("svg")].map((s) => {
        const sr = s.getBoundingClientRect();
        return Math.round(sr.width) + "x" + Math.round(sr.height);
      });
      out.push([
        c.id || c.className.toString().split(" ").slice(-1)[0],
        Math.round(r.width) + "x" + Math.round(r.height),
        icons.join(",") || "-",
      ]);
    });

    return out;
  });

  return rows.map((r) => r.join("  |  ")).join("\n");
}
