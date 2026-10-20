export default async function run(page) {
  const src = await page.evaluate(async () => {
    const r = await fetch(
      "/src/features/workspace/interaction/creation-drag.js",
    );
    const t = await r.text();
    return {
      status: r.status,
      hasFinishCreationClick: t.includes("finishCreationClick"),
      hasThreshold: t.includes("DRAG_THRESHOLD_PX = 4"),
    };
  });

  const cls = await page.evaluate(async () => {
    const r = await fetch(
      "/src/components/layout/toolbar/tool-classification.js",
    );
    const t = await r.text();
    return {
      status: r.status,
      pipeDuct: /CLICK_CLICK_TOOLS[\s\S]{0,600}?pipe-duct/.test(t),
    };
  });

  return { src, cls };
}
