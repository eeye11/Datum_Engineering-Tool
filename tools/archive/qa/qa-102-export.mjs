import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

/*
 * The export pipeline, exercised through the real code: build a
 * drawing, ask for a clean render, and check the result is a real
 * fitted rendering rather than a crop of the editor.
 */
const RENDER = [
  "var st = window.enggDrawing.state;",
  "var r = (function () {",
  "  // The same bounds logic fitDrawingToView uses.",
  "  var pts = [];",
  "  st.objects.forEach(function (o) {",
  "    var b = window.__qaRenderedBounds ? window.__qaRenderedBounds(o) : [];",
  "    pts = pts.concat(b);",
  "  });",
  "  if (!pts.length) return { err: 'no points' };",
  "  var out = window.enggDrawingExport.renderClean(st,",
  "    window.enggDrawingExport.paddedBounds(pts, 1200, 1200));",
  "  if (!out) return { err: 'no svg' };",
  "  return {",
  "    w: out.getAttribute('width'),",
  "    h: out.getAttribute('height'),",
  "    viewBox: out.getAttribute('viewBox'),",
  "    lines: out.querySelectorAll('line').length,",
  "    polygons: out.querySelectorAll('polygon').length,",
  "    paths: out.querySelectorAll('path').length,",
  "    groups: out.querySelectorAll('g.drawing-feature').length,",
  "    hasSelectionClass: !!out.querySelector('.drawing-entity-selected'),",
  "    hasHandles: !!out.querySelector('.drawing-manipulation-handle')",
  "  };",
  "})();",
  "document.documentElement.setAttribute('data-qa', JSON.stringify(r));",
].join("\n");

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 200) });
    }
  };
  const h = await makeHelpers(page);

  await safe("export module", () =>
    h.evalInPage(
      page,
      "document.documentElement.setAttribute('data-qa', JSON.stringify({",
      "  has: typeof window.enggDrawingExport,",
      "  bounds: window.enggDrawingExport &&",
      "    typeof window.enggDrawingExport.renderClean",
      "}));",
    ),
  );

  await h.category("STATICS");

  await h.tool("body");
  await h.sub("Beam");
  await h.click(0.15, 0.6);
  await h.click(0.85, 0.6);
  await page.waitForTimeout(400);

  await h.tool("point-force");
  await h.click(0.4, 0.6);
  await h.move(0.4, 0.4);
  await h.click(0.4, 0.4);
  await page.waitForTimeout(400);

  await h.tool("load");
  await h.sub("Varying Distributed Load");
  await h.click(0.7, 0.6);
  await h.move(0.7, 0.45);
  await h.click(0.7, 0.45);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  log(
    "objects",
    (await h.allObjects()).map((o) => o.type),
  );

  // The bounds helper lives in the controller, so reach it the way
  // the export does: through the exposed module plus the objects.
  await safe("clean render", () =>
    h.evalInPage(
      page,
      [
        "var st = window.enggDrawing.state;",
        "var pts = [];",
        "st.objects.forEach(function (o) {",
        "  var g = o.geometry || {};",
        "  if (g.start) pts.push(g.start, g.end);",
        "  if (g.end) pts.push(g.end);",
        "  if (g.position) pts.push(g.position);",
        "});",
        "var bounds = window.enggDrawingExport.paddedBounds(pts, 1200, 1200);",
        "var svg = bounds && window.enggDrawingExport.renderClean(st, bounds);",
        "document.documentElement.setAttribute('data-qa', JSON.stringify({",
        "  bounds: bounds && { w: Math.round(bounds.width),",
        "    x0: +bounds.minX.toFixed(1), x1: +bounds.maxX.toFixed(1) },",
        "  svg: svg && {",
        "    w: svg.getAttribute('width'), h: svg.getAttribute('height'),",
        "    viewBox: svg.getAttribute('viewBox'),",
        "    lines: svg.querySelectorAll('line').length,",
        "    polygons: svg.querySelectorAll('polygon').length,",
        "    features: svg.querySelectorAll('g.drawing-feature').length,",
        "    selected: !!svg.querySelector('.drawing-entity-selected'),",
        "    handles: !!svg.querySelector('.drawing-manipulation-handle')",
        "  }",
        "}));",
      ].join("\n"),
    ),
  );

  // And the raster path, which PNG and JPG both use.
  await safe("raster render", () =>
    h.evalInPage(
      page,
      [
        "var st = window.enggDrawing.state;",
        "var pts = [];",
        "st.objects.forEach(function (o) {",
        "  var g = o.geometry || {};",
        "  if (g.start) pts.push(g.start, g.end);",
        "  if (g.position) pts.push(g.position);",
        "});",
        "var img = window.enggDrawingExport.renderImage(st, pts, {",
        "  width: 1200, background: '#ffffff' });",
        "document.documentElement.setAttribute('data-qa', JSON.stringify({",
        "  ok: !!img,",
        "  canvas: img && [img.canvas.width, img.canvas.height],",
        "  url: img && img.canvas.toDataURL('image/png').slice(0, 22)",
        "}));",
      ].join("\n"),
    ),
  );

  return out;
}
