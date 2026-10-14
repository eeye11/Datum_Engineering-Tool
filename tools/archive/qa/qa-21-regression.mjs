import { makeHelpers } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 250) });
    }
  };
  const phase = async () => (await h.state())?.phase;

  const h = await makeHelpers(page);
  await page.locator(".drawing-canvas").first().waitFor({ timeout: 15000 });

  // --- Line still completes.
  await h.category("GEOMETRY");
  await h.tool("line");
  await h.click(0.2, 0.15);
  await h.click(0.5, 0.15);
  await safe("line built", h.count);

  // --- Truss still completes and squares up.
  await h.category("STATICS");
  await h.tool("body");
  await h.sub("Truss");
  await h.click(0.2, 0.35);
  await h.click(0.6, 0.35);
  await h.click(0.6, 0.6);
  await h.click(0.2, 0.6);
  await h.click(0.4, 0.48);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await safe("truss built", h.count);

  // --- Varying Load on an existing body (body-first path intact).
  await h.tool("body");
  await h.sub("Beam");
  await h.click(0.8, 0.25);
  await h.click(0.8, 0.45);
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.8, 0.35);
  await safe("body-first phase", phase);
  await h.move(0.8, 0.28);
  await h.click(0.8, 0.28);
  await h.move(0.8, 0.42);
  await h.click(0.8, 0.42);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await safe("body-first load created", h.count);

  // --- Varying Load in blank space (line-style span) still works.
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.2, 0.8);
  await h.click(0.6, 0.8);
  await h.move(0.4, 0.72);
  await h.click(0.4, 0.72);
  await h.move(0.6, 0.76);
  await h.click(0.6, 0.76);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await safe("blank-space load created", h.count);

  // --- Esc mid-construction creates nothing.
  const before = await h.count();
  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.7, 0.9);
  await h.click(0.9, 0.9);
  await h.move(0.8, 0.85);
  await h.click(0.8, 0.85);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await safe("count after esc", async () => ({
    before,
    after: await h.count(),
  }));

  // --- Constant Distributed Load still finishes in one click.
  await h.tool("load");
  await h.sub("Distributed Load");
  await h.click(0.2, 0.95);
  await h.click(0.5, 0.95);
  await h.move(0.35, 0.88);
  await h.click(0.35, 0.88);
  await page.waitForTimeout(400);
  await safe("constant load created", h.count);

  return out;
}
