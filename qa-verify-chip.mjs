export default async function run(page) {
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const e = document.getElementById("solutionEditor");
    e.value = "Text.\n"; e.dispatchEvent(new Event("input", { bubbles: true }));
    e.setSelectionRange(e.value.length, e.value.length);
    document.getElementById("solutionEnterDrawing")?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => [...document.querySelectorAll(".engg-dialog button")].find(b => b.textContent.trim() === "Draw a new figure")?.click());
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({
    chips: [...document.querySelectorAll(".solution-drawing-chip")].map(c => ({ text: c.innerText, lock: Boolean(c.querySelector(".solution-drawing-chip-lock")) })),
    figure: document.querySelector(".drawing-reference-figure")?.className || null,
    figureText: document.querySelector(".drawing-reference-figure")?.innerText?.slice(0, 160),
  }));
}
