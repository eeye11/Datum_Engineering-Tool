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
  const msg = () =>
    page.evaluate(
      () => document.getElementById("drawingToolMessage")?.textContent,
    );

  const inPage = (lines) =>
    page
      .evaluate(
        (src) => {
          const s = document.createElement("script");
          s.textContent = src;
          document.body.appendChild(s);
          return null;
        },
        "(function(){\n" + lines.join("\n") + "\n})();",
      )
      .then(() => page.getAttribute("html", "data-res"))
      .then((v) => JSON.parse(v));

  const bb = await page.locator(".drawing-canvas").first().boundingBox();

  // A point force.
  await page.locator('button[data-category="STATICS"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="point-force"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 200, bb.y + 320);
  await page.waitForTimeout(300);
  await page.mouse.click(bb.x + 230, bb.y + 265);
  await page.waitForTimeout(800);

  const at = await inPage([
    "  const g = document.querySelector('svg .drawing-feature');",
    "  const r = g.getBoundingClientRect();",
    "  document.documentElement.setAttribute('data-res', JSON.stringify({",
    "    x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)",
    "  }));",
  ]);

  // Label it, placed well away.
  await page.locator('button[data-category="ANNOTATE"]').click();
  await page.waitForTimeout(400);
  await page.locator('#drawingToolList [data-tool-id="annotation"]').click();
  await page.waitForTimeout(300);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  await page.mouse.move(at.x + 210, at.y - 150);
  await page.waitForTimeout(350);
  await page.mouse.click(at.x + 210, at.y - 150);
  await page.waitForTimeout(800);
  out.placed = await msg();

  const before = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const f = st.objects.find(o => o.type === 'force');",
    "  const a = st.objects.find(o => o.type === 'annotation');",
    "  document.documentElement.setAttribute('data-res', JSON.stringify({",
    "    forceGeom: f.geometry, annPlacement: a.placement, annId: a.id,",
    "    selected: st.selection.selectedObjectIds",
    "  }));",
  ]);
  out.before = before;

  // Where is the label actually drawn?
  const annBox = await inPage([
    "  const texts = [...document.querySelectorAll('svg .drawing-feature text')];",
    "  const t = texts[texts.length - 1];",
    "  const r = t.getBoundingClientRect();",
    "  document.documentElement.setAttribute('data-res', JSON.stringify({",
    "    x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: t.textContent",
    "  }));",
  ]);
  out.annBox = annBox;

  // Now try to DRAG it, as §33 requires.
  await page.mouse.move(annBox.x, annBox.y);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(annBox.x - 120, annBox.y + 90, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  out.afterDrag = await inPage([
    "  const st = window.enggDrawing.state;",
    "  const f = st.objects.find(o => o.type === 'force');",
    "  const a = st.objects.find(o => o.type === 'annotation');",
    "  document.documentElement.setAttribute('data-res', JSON.stringify({",
    "    forceGeom: f.geometry, annPlacement: a.placement",
    "  }));",
  ]);

  out.forceMoved =
    JSON.stringify(out.afterDrag.forceGeom) !==
    JSON.stringify(before.forceGeom);
  out.annotationMoved =
    JSON.stringify(out.afterDrag.annPlacement) !==
    JSON.stringify(before.annPlacement);

  // And the Move tool, the explicit path.
  await page.locator('#drawingGlobalToolGroups [data-tool-id="move"]').click();
  await page.waitForTimeout(400);
  out.moveToolMsg = await msg();

  return out;
}
