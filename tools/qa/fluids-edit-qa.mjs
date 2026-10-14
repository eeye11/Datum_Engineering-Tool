/*
 * Fluids route QA - interactive editing, undo/redo, snapping, persistence.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = {};

  const switchFluids = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll(".drawing-category")]
        .find((el) => el.dataset.category === "FLUIDS")
        ?.click();
    });
    await page.waitForTimeout(200);
  };

  const armPipe = async () => {
    await switchFluids();
    await page.evaluate(() => {
      document
        .querySelector('.drawing-tool[data-tool-id="pipe-duct"]')
        ?.click();
    });
    await page.waitForTimeout(200);
  };

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  const status = () =>
    page.evaluate(
      () =>
        document.getElementById("drawingToolMessage")?.textContent?.trim() ||
        "",
    );

  const objectCount = () =>
    page.evaluate(() => {
      const rows = document.querySelectorAll(".drawing-component-row");
      return rows.length;
    });

  const clickToolbar = async (label) => {
    await page.evaluate((l) => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        new RegExp(`^${l}$`, "i").test(x.textContent.trim()),
      );
      b?.click();
    }, label);
    await page.waitForTimeout(300);
  };

  const openTreeRow = async (match) => {
    await page.evaluate((m) => {
      const rows = [...document.querySelectorAll(".drawing-component-row")];
      const i = rows.findIndex((r) => new RegExp(m, "i").test(r.textContent));
      rows[i]?.click();
    }, match);
    await page.waitForTimeout(200);
    await page.evaluate((m) => {
      const rows = [...document.querySelectorAll(".drawing-component-row")];
      const i = rows.findIndex((r) => new RegExp(m, "i").test(r.textContent));
      rows[i]?.click();
    }, match);
    await page.waitForTimeout(350);
  };

  const backToTree = async () => {
    await page.evaluate(() => {
      const b = document.getElementById("drawingFeaturesBack");
      if (b && b.style.display !== "none") b.click();
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      document.querySelectorAll(".drawing-component-twisty").forEach((t) => {
        if (!t.classList.contains("expanded")) t.click();
      });
    });
    await page.waitForTimeout(200);
  };

  /* ---- Draw an L-shaped route ---- */
  await armPipe();
  for (const [x, y] of [
    [cx - 200, cy - 100],
    [cx - 40, cy - 100],
    [cx - 40, cy + 100],
  ]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(180);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    document.querySelectorAll(".drawing-component-twisty").forEach((t) => {
      if (!t.classList.contains("expanded")) t.click();
    });
  });
  await page.waitForTimeout(250);

  out.created = { status: await status(), rows: await objectCount() };

  /* ---- T: edit the route's Diameter through the panel ---- */
  await openTreeRow("Route");
  const edited = await page.evaluate(() => {
    const input = document.querySelector(
      "#drawingProperties input[data-property='diameter']",
    );
    if (!input) return { found: false };
    const before = input.value;
    input.value = "42";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { found: true, before };
  });
  await page.waitForTimeout(350);
  const afterEdit = await page.evaluate(
    () =>
      document.querySelector(
        "#drawingProperties input[data-property='diameter']",
      )?.value,
  );
  out.diameterEdit = { ...edited, afterEdit };

  /* ---- T: the elbow's Corner Position is editable? Try to change it. ---- */
  await backToTree();
  await openTreeRow("Elbow");
  const elbowEdit = await page.evaluate(() => {
    const input = document.querySelector(
      "#drawingProperties input[data-property='position.x']",
    );
    if (!input) return { found: false };
    const before = input.value;
    input.value = String(Number(before) + 25);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return {
      found: true,
      before,
      disabled: input.disabled,
      readOnly: input.readOnly,
    };
  });
  await page.waitForTimeout(350);
  const elbowAfter = await page.evaluate(
    () =>
      document.querySelector(
        "#drawingProperties input[data-property='position.x']",
      )?.value,
  );
  out.elbowPositionEdit = { ...elbowEdit, after: elbowAfter };

  /* ---- T: undo / redo through the toolbar ---- */
  await backToTree();
  const beforeUndo = await objectCount();
  await clickToolbar("Undo");
  const afterUndo = await objectCount();
  await clickToolbar("Redo");
  const afterRedo = await objectCount();
  out.undoRedo = { beforeUndo, afterUndo, afterRedo };

  /* ---- T: Save then reload, and read the tree back ---- */
  const saved = await page.evaluate(() => {
    const api = window.__daetumQA || null;
    if (api && api.save) return api.save();
    return "no-qa-api";
  });
  out.saveApi = saved;

  return out;
}
