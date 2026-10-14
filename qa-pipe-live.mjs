export default async function run(page, ui) {
  await page.waitForTimeout(1200);
  // Switch to the drawing workspace the way a user does.
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);
  const out = {};

  // Read the armed tool state from the app itself after clicking Pipe / Duct.
  const clickBtn = (label) =>
    page.evaluate((lbl) => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent.trim() === lbl,
      );
      if (!b) return "MISSING";
      b.click();
      return "clicked";
    }, label);

  out.fluids = await clickBtn("FLUIDS");
  await page.waitForTimeout(500);
  out.pipe = await clickBtn("Pipe / Duct");
  await page.waitForTimeout(500);

  out.stateAfterArm = await page.evaluate(() => {
    const msg = document.getElementById("drawingToolMessage");
    const canvas = document.querySelector(".drawing-canvas");
    return {
      message: msg?.textContent?.trim(),
      canvasActiveTool: canvas?.className,
    };
  });

  await page.screenshot({ path: "qa-shot-1-armed.png" });

  // Click a start point and watch state.
  const box = await page.evaluate(() => {
    const b = document
      .querySelector(".drawing-canvas svg")
      .getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  await page.mouse.move(cx - 150, cy + 80, { steps: 5 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  out.stateAfterClick1 = await page.evaluate(() =>
    document.getElementById("drawingToolMessage")?.textContent?.trim(),
  );
  await page.screenshot({ path: "qa-shot-2-firstclick.png" });

  // Move toward the second point: preview should appear.
  await page.mouse.move(cx + 50, cy + 80, { steps: 10 });
  await page.waitForTimeout(400);
  out.shapesAfterMove = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return [...svg.querySelectorAll("*")]
      .filter(
        (el) =>
          ["path", "line", "polyline", "circle"].includes(el.tagName) &&
          el.getAttribute("class") !== "drawing-engineering-grid",
      )
      .map(
        (el) =>
          el.tagName +
          "|" +
          (el.getAttribute("points") || el.getAttribute("d") || "").slice(
            0,
            90,
          ) +
          "|" +
          (el.getAttribute("class") || ""),
      );
  });
  await page.screenshot({ path: "qa-shot-3-preview.png" });

  // Second click.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  out.stateAfterClick2 = await page.evaluate(() =>
    document.getElementById("drawingToolMessage")?.textContent?.trim(),
  );
  out.shapesAfterClick2 = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return [...svg.querySelectorAll("polyline")].map((el) =>
      el.getAttribute("points"),
    );
  });
  await page.screenshot({ path: "qa-shot-4-secondclick.png" });

  // Third click, then Enter to finish.
  await page.mouse.move(cx + 50, cy - 60, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  out.stateAfterFinish = await page.evaluate(() =>
    document.getElementById("drawingToolMessage")?.textContent?.trim(),
  );
  out.finalShapes = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    return [...svg.querySelectorAll("polyline")].map((el) =>
      el.getAttribute("points"),
    );
  });
  await page.screenshot({ path: "qa-shot-5-finished.png" });

  return out;
}
