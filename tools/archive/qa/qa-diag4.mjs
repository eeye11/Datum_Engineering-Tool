/*
 * The harness evaluates in an isolated world whose `window` is separate from
 * the page's. So page-script globals are invisible as `window.x` even though
 * they ran fine - and the console channel reports nothing either.
 *
 * The bridge is the DOM, which both worlds share: inject a real <script> into
 * the page, have it read the globals it can actually see, and write the answer
 * into an attribute. Then read the attribute.
 */
export default async function run(page, ui) {
  await page.evaluate(() => {
    window.showTab?.("drawing");
  });

  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = `
      (function () {
        var out = {
          showTab: typeof window.showTab,
          propertyPanel: typeof window.enggPropertyPanel,
          panelFns: Object.keys(window.enggPropertyPanel || {}).length,
          annotationModel: typeof window.enggAnnotationModel,
          annotatable: window.enggAnnotationModel &&
            window.enggAnnotationModel.annotatableTypes
              ? [...window.enggAnnotationModel.annotatableTypes()].sort()
              : null,
          canvases: document.querySelectorAll('canvas').length,
          canvasIds: [...document.querySelectorAll('canvas')].map(function (c) {
            return c.id || '(no id)';
          }),
        };
        var el = document.createElement('div');
        el.id = '__qa_result';
        el.setAttribute('data-json', JSON.stringify(out));
        document.body.appendChild(el);
      })();
    `;
    document.body.appendChild(script);
  });

  await page.waitForFunction(() => !!document.getElementById("__qa_result"), {
    timeout: 10000,
  });

  const data = await page.evaluate(() =>
    JSON.parse(
      document.getElementById("__qa_result").getAttribute("data-json"),
    ),
  );

  return data;
}
