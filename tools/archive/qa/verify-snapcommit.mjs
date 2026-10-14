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
  const bb = await page.locator(".drawing-canvas").first().boundingBox();

  let seq = 0;
  const inPage = (lines) => {
    seq += 1;
    const key = "data-q" + seq;
    return page
      .evaluate(
        (src) => {
          const s = document.createElement("script");
          s.textContent = src;
          document.body.appendChild(s);
          return null;
        },
        "(function(){\n" +
          lines.join("\n").split("__K__").join(key) +
          "\n})();",
      )
      .then(() => page.getAttribute("html", key))
      .then((v) => (v === null ? null : JSON.parse(v)));
  };

  const activate = async (category, tool, caption) => {
    await page.locator(`button[data-category="${category}"]`).click();
    await page.waitForTimeout(400);
    const direct = page.locator(`#drawingToolList [data-tool-id="${tool}"]`);
    if (await direct.count()) {
      await direct.click();
      await page.waitForTimeout(300);
      return;
    }
    await page.locator('#drawingToolList [data-tool-id="body"]').click();
    await page.waitForTimeout(600);
    await page
      .locator(".drawing-coordinate-submenu-item", { hasText: caption })
      .first()
      .click();
    await page.waitForTimeout(300);
  };

  /*
   * THE POINT OF THE WHOLE EXERCISE
   *
   * Hover into a horizontal alignment, read the point the PREVIEW is
   * using, then click - and read the point the COMMITTED feature ended
   * up with. If those differ, the status line is lying: it would say
   * "Horizontal snap" over a beam that is a fraction off-axis.
   */
  const commitCheck = async (category, tool, caption, label) => {
    await activate(category, tool, caption);

    const sx = bb.x + 300;
    const sy = bb.y + 240;
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(500);

    // Hover 4px off the start's Y: snapped.
    await page.mouse.move(sx + 150, sy + 4);
    await page.waitForTimeout(400);

    const preview = await inPage([
      "  const st = window.enggDrawing.state;",
      "  document.documentElement.setAttribute('__K__', JSON.stringify({",
      "    effective: st.interaction.effectiveConstructionPoint,",
      "    start: st.interaction.startPoint",
      "  }));",
    ]);

    await page.mouse.click(sx + 150, sy + 4);
    await page.waitForTimeout(800);

    const committed = await inPage([
      "  const st = window.enggDrawing.state;",
      "  const types = ['beam','cable','shaft','line'];",
      "  let found = null;",
      "  for (const t of types) {",
      "    const o = [...st.objects].reverse().find(x => x.type === t);",
      "    if (o) { found = { type: o.type, geometry: o.geometry }; break; }",
      "  }",
      "  document.documentElement.setAttribute('__K__', JSON.stringify(found));",
    ]);

    const end = committed && (committed.geometry.end || committed.geometry);

    return {
      label,
      previewY: preview && preview.effective && preview.effective.y,
      startY: preview && preview.start && preview.start.y,
      committedType: committed && committed.type,
      committedEndY: end && end.y,
      snappedInPreview:
        preview && preview.effective
          ? Math.abs(preview.effective.y - preview.start.y) < 0.001
          : null,
      commitMatchesPreview:
        preview && end ? Math.abs(end.y - preview.effective.y) < 0.001 : null,
    };
  };

  out.line = await commitCheck("GEOMETRY", "line", "Line", "Geometry -> Line");
  out.beam = await commitCheck("STATICS", "beam", "Beam", "Beam");
  out.cable = await commitCheck("STATICS", "cable", "Cable", "Cable");
  out.shaft = await commitCheck("STATICS", "shaft", "Shaft", "Shaft");

  return out;
}
