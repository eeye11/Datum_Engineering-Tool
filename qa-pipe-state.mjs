export default async function run(page, ui) {
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);
  const out = {};

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "FLUIDS")?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Pipe / Duct")?.click();
  });
  await page.waitForTimeout(400);

  const box = await page.evaluate(() => {
    const b = document.querySelector(".drawing-canvas svg").getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  await page.mouse.click(cx - 150, cy + 80);
  await page.waitForTimeout(200);
  await page.mouse.move(cx + 50, cy + 80, { steps: 10 });
  await page.waitForTimeout(400);

  // Read the live interaction state through the app's automation hooks if present.
  out.state = await page.evaluate(() => {
    const hooks = window.enggDrawingState || null;
    const live = hooks?.drawingState ? window.enggEditorState.drawingState : null;
    if (live) {
      const i = live.interaction || {};
      return {
        found: true,
        phase: i.phase,
        routePoints: i.routePoints,
        preview: i.preview
          ? { type: i.preview.type, geometry: i.preview.geometry }
          : null,
      };
    }
    return { found: false };
    // Fall back: inspect SVG children with a data-preview marker.
    const svg = document.querySelector(".drawing-canvas svg");
    return {
      hooks: Object.keys(window).filter((k) => /daetum|datum|engg/i.test(k)),
      svgChildren: [...svg.children].map((c) => c.tagName + "|" + (c.getAttribute("class") || "")),
    };
  });

  // Also check the app automation hooks module for the state export.
  out.hookProbe = await page.evaluate(async () => {
    try {
      const mod = await import("/src/app/automation-hooks.js");
      return Object.keys(mod);
    } catch (e) {
      return String(e).slice(0, 200);
    }
  });

  return out;
}
