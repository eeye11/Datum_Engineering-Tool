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

  /*
   * One pass per tool.
   *
   * Each tool is placed the same way: click a start, then hover the
   * cursor at a deliberate small offset from the start's Y so that a
   * horizontal alignment is inside the tolerance but not exact. If the
   * shared snap is wired up, the preview point and the message both
   * have to follow it; if the tool is NOT wired up, the raw cursor
   * position stands and the message says nothing useful.
   *
   * The offset is the same for every tool, including Geometry -> Line,
   * so the tools are genuinely compared rather than each being given
   * whatever happens to suit it.
   */
  const probe = async (category, tool, label) => {
    const before = await inPage([
      "  const st = window.enggDrawing.state;",
      "  document.documentElement.setAttribute('data-res', String(st.objects.length));",
    ]);

    await page.locator(`button[data-category="${category}"]`).click();
    await page.waitForTimeout(400);
    await page.locator(`#drawingToolList [data-tool-id="${tool}"]`).click();
    await page.waitForTimeout(300);

    // Start point.
    const sx = bb.x + 260;
    const sy = bb.y + 200;
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(500);

    // Hover 4px off the start's Y, 120px along X: inside a horizontal
    // alignment, far from anything else worth snapping to.
    await page.mouse.move(sx + 120, sy + 4);
    await page.waitForTimeout(400);

    const horizontal = {
      message: await msg(),
      preview: await inPage([
        "  const st = window.enggDrawing.state;",
        "  const p = st.interaction.preview;",
        "  const st2 = st.interaction;",
        "  document.documentElement.setAttribute('data-res', JSON.stringify({",
        "    phase: st2.phase,",
        "    inference: st2.inference ? st2.inference.kind || st2.inference.type : null,",
        "    snap: st2.snapCandidate ? st2.snapCandidate.type : null,",
        "    effective: st2.effectiveConstructionPoint,",
        "    start: st2.startPoint",
        "  }));",
      ]),
    };

    // And the vertical case.
    await page.mouse.move(sx + 4, sy + 120);
    await page.waitForTimeout(400);

    const vertical = {
      message: await msg(),
      inference: await inPage([
        "  const st = window.enggDrawing.state;",
        "  document.documentElement.setAttribute('data-res', String(",
        "    st.interaction.inference ? st.interaction.inference.kind || st.interaction.inference.type : null));",
      ]),
    };

    // Well outside tolerance: nothing should be claimed.
    await page.mouse.move(sx + 120, sy + 120);
    await page.waitForTimeout(400);
    const clear = {
      message: await msg(),
      inference: await inPage([
        "  const st = window.enggDrawing.state;",
        "  document.documentElement.setAttribute('data-res', String(",
        "    st.interaction.inference ? st.interaction.inference.kind || st.interaction.inference.type : null));",
      ]),
    };

    return { label, horizontal, vertical, clear };
  };

  // The reference: Geometry -> Line.
  out.line = await probe("GEOMETRY", "line", "Geometry -> Line");

  // The four Statics construction tools.
  out.beam = await probe("STATICS", "beam", "Beam");
  out.cable = await probe("STATICS", "cable", "Cable");
  out.shaft = await probe("STATICS", "shaft", "Shaft");

  return out;
}
