export default async function run(page, ui) {
  const errs = [];
  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 200)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 160));
  });

  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const tab = page
    .locator("button", { hasText: "Engineering Drawing" })
    .first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(1500);

  const out = { errs };
  const b = await page.locator(".drawing-workspace").first().boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const msg = () =>
    page.evaluate(
      () => document.getElementById("drawingToolMessage")?.textContent,
    );

  // A point force to label.
  await page.locator('button[data-category="STATICS"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="point-force"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(cx - 100, cy + 20);
  await page.waitForTimeout(250);
  await page.mouse.move(cx - 80, cy - 10);
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 80, cy - 10);
  await page.waitForTimeout(700);

  // The Annotation tool.
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  out.tools = await page.evaluate(() =>
    [...document.querySelectorAll("#drawingToolList [data-tool-id]")].map((x) =>
      x.getAttribute("data-tool-id"),
    ),
  );

  await page.locator('#drawingToolList [data-tool-id="annotation"]').click();
  await page.waitForTimeout(300);
  out.onActivate = await msg();

  // Click the force to arm a label.
  await page.mouse.click(cx - 80, cy - 10);
  await page.waitForTimeout(500);
  out.armed = await msg();
  out.previewText = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-annotation-preview text")].map(
      (t) => t.textContent.trim(),
    ),
  );

  // Move away, then place.
  await page.mouse.move(cx + 60, cy - 60);
  await page.waitForTimeout(350);
  out.previewAfterMove = await page.evaluate(() =>
    [...document.querySelectorAll(".drawing-annotation-preview text")].map(
      (t) => t.textContent.trim(),
    ),
  );

  await page.mouse.click(cx + 60, cy - 60);
  await page.waitForTimeout(800);
  out.placedMsg = await msg();

  out.state = await page
    .evaluate(() => {
      const s = document.createElement("script");
      s.textContent = `
      (function(){
        const st = window.enggDrawing.state;
        const A = window.enggAnnotationModel;
        const ann = st.objects.find(o => o.type === 'annotation');
        document.documentElement.setAttribute('data-res', JSON.stringify({
          types: st.objects.map(o => o.type),
          annotation: ann ? {
            kind: ann.annotationKind,
            sourceFeatureId: ann.sourceFeatureId,
            textMode: ann.textMode,
            placement: ann.placement,
            text: A.textFor(ann, st)
          } : null
        }));
      })();`;
      document.body.appendChild(s);
      return null;
    })
    .then(() => page.getAttribute("html", "data-res"))
    .then((v) => JSON.parse(v || "null"));

  return out;
}
