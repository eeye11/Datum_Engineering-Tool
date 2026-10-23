export default async function run(page) {
  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="drawing"]')?.click(),
  );
  await page.waitForTimeout(700);

  const first = await page.evaluate(() => {
    document.querySelector('[data-category="ANNOTATE"]')?.click();

    const button = [
      ...document.querySelectorAll("#drawingToolList button"),
    ].find((b) => /^Note \/ Text$/.test(b.textContent.trim()));

    button?.click();

    return Boolean(button);
  });

  await page.waitForTimeout(200);

  const box = await page.locator(".drawing-canvas").boundingBox();
  await page.mouse.click(
    Math.round(box.x + box.width * 0.42),
    Math.round(box.y + box.height * 0.55),
  );
  await page.waitForTimeout(400);

  const geometry = await page.evaluate(() => {
    const measure = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        tag: node.tagName,
      };
    };

    const prompt = document.querySelector(".drawing-inline-entry");
    const field = prompt?.querySelector("#noteText");
    const hint = prompt?.querySelector(".drawing-inline-entry-hint");
    const label = prompt?.querySelector(".drawing-inline-entry-label");
    const preview = prompt?.querySelector(".drawing-inline-entry-preview");

    return {
      prompt: measure(prompt),
      textarea: measure(field),
      label: measure(label),
      hint: measure(hint),
      preview: measure(preview),
      previewHidden: preview?.hidden,
      promptStyle: prompt
        ? {
            left: prompt.style.left,
            top: prompt.style.top,
            width: getComputedStyle(prompt).width,
          }
        : null,
    };
  });

  return { first, geometry };
}
