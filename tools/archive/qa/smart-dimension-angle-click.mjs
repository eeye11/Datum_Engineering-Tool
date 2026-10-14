import { makeHelpers } from "./qa-helpers.mjs";

/*
 * ========================================================
 * SMART DIMENSION: A SECOND LINE AFTER THE FIRST IS AN ANGLE
 * ========================================================
 *
 * THE BUG: clicking one line with Smart Dimension jumped the tool straight into
 * placement, so the very next click was read as "where to stand the length
 * dimension" - a second line could never be picked, and the angle between two
 * lines could not be dimensioned.
 *
 * THE FIX: the first click ARMS its own measurement (previewed at once, no
 * keystroke) but the tool keeps accepting references. A click on a second
 * reference becomes an angle; a click on empty space places what is armed.
 *
 * This drives the real page: two lines at an angle, then Smart Dimension
 * clicked first on one and then on the other, then placed.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const out = { errs };

  // `main.js` runs its start-up side effects (including everything on
  // window.engg*) when it is evaluated. The page loads it as a module, but this
  // script must not race that, so it imports it explicitly and waits for the
  // handles - the same pattern tools/qa/probe-globals.mjs uses.
  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForFunction(
    () => !!(window.enggDrawing && window.enggDrawing.state),
    { timeout: 20000 },
  );

  const h = await makeHelpers(page);
  const at = (fx, fy) => h.at(fx, fy);

  const stage = () =>
    page.evaluate(() => window.enggDrawing.state.interaction.dimensionStage);

  const dimension = () =>
    page.evaluate(() => {
      const st = window.enggDrawing.state;
      const d = st.objects.find((o) => o.type === "dimension");
      if (!d) return null;
      return {
        dimensionType: d.dimensionType,
        refCount: (d.sourceRefs || []).length,
        refs: (d.sourceRefs || []).map((r) => r.featureId),
      };
    });

  // Two lines meeting near the centre, at a real angle to one another. Drawn
  // with the click-move-click workflow (mousedown/up at each end).
  await h.category("GEOMETRY");

  // The Line tool STAYS ARMED after a feature is committed, so it is selected
  // once. Re-clicking it would toggle it off to Select (a re-click of the active
  // tool cancels it), which is correct app behaviour but not what this test
  // wants.
  await h.tool("line");

  const drawLine = async (x1, y1, x2, y2) => {
    const a = at(x1, y1);
    const b = at(x2, y2);
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(180);
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(300);

    // The second click completes the span and opens the creation-size popup;
    // Enter accepts the size it suggests and commits the line.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(450);
  };

  await drawLine(0.18, 0.66, 0.52, 0.56);
  await drawLine(0.18, 0.34, 0.52, 0.44);

  out.lines = await page.evaluate(
    () =>
      window.enggDrawing.state.objects.filter((o) => o.type === "line").length,
  );

  // Smart Dimension, then click the two lines in turn.
  await h.category("ANNOTATE");
  await h.tool("smart-dimension");

  // Midpoint of the first line -> this ARMS its length.
  const first = at(0.35, 0.61);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(400);
  out.stageAfterFirst = await stage();
  out.afterFirst = await h.msg();

  // Midpoint of the second line -> THIS is the step that used to be impossible.
  const second = at(0.35, 0.39);
  await page.mouse.click(second.x, second.y);
  await page.waitForTimeout(400);
  out.stageAfterSecond = await stage();
  out.afterSecond = await h.msg();

  // Place it clear of both lines.
  const place = at(0.42, 0.5);
  await page.mouse.click(place.x, place.y);
  await page.waitForTimeout(600);
  out.afterPlace = await h.msg();

  out.dimension = await dimension();

  return out;
}
