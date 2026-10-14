/*
 * Fluids Pipe / Duct route QA - part 2: select a route, a segment and an elbow
 * and read back the ACTUAL Features panel rows the app renders.
 */
export default async function run(page, ui) {
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(600);

  const out = {};

  const switchFluids = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".drawing-category")].find(
        (el) => el.dataset.category === "FLUIDS",
      );
      if (b) b.click();
    });
    await page.waitForTimeout(250);
  };

  const armPipe = async () => {
    await switchFluids();
    await page.evaluate(() => {
      document.querySelector('.drawing-tool[data-tool-id="pipe-duct"]')?.click();
    });
    await page.waitForTimeout(250);
  };

  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector(".drawing-canvas svg");
    const b = svg.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const cx = svgBox.x + svgBox.width / 2;
  const cy = svgBox.y + svgBox.height / 2;

  /* The feature tree, read from the actual component tree DOM. */
  const tree = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll(".drawing-component-row")];
      return rows.map((r) => ({
        id: r.dataset.objectId,
        text: r.textContent.trim().slice(0, 70),
        child: r.classList.contains("drawing-component-row-child"),
        selected: r.classList.contains("selected"),
      }));
    });

  /* The Features panel, read from the actual inspector DOM. */
  const panel = () =>
    page.evaluate(() => {
      const host = document.getElementById("drawingProperties");
      if (!host) return null;
      const heading =
        host.querySelector(".drawing-property-header, .drawing-feature-header")
          ?.textContent?.trim() || null;
      const sections = [...host.querySelectorAll(".drawing-properties-section")].map(
        (s) => s.textContent.trim(),
      );
      const rows = [...host.querySelectorAll(".drawing-property-grid")].map(
        (r) => ({
          label:
            r.querySelector(".drawing-property-grid-label")?.textContent?.trim() ||
            "",
          value:
            r.querySelector("input, select")?.value ??
            r.querySelector(".drawing-property-derived")?.textContent?.trim() ??
            r.querySelector(".drawing-property-readonly")?.textContent?.trim() ??
            "",
          property: r.querySelector("[data-property]")?.dataset.property || null,
          derived: Boolean(r.querySelector(".drawing-property-derived")),
          readOnly: !r.querySelector("input, select"),
        }),
      );
      return { heading, sections, rows };
    });

  /*
   * Selecting a feature shows the TREE; clicking the already-selected row
   * again opens its EDIT page. So a row is clicked twice: once to select,
   * once to open.
   */
  const openTreeRow = async (index) => {
    await page.evaluate((i) => {
      const rows = [...document.querySelectorAll(".drawing-component-row")];
      rows[i]?.click();
    }, index);
    await page.waitForTimeout(250);
    await page.evaluate((i) => {
      const rows = [...document.querySelectorAll(".drawing-component-row")];
      rows[i]?.click();
    }, index);
    await page.waitForTimeout(350);
  };

  // Draw an L-shaped route (one 90-degree corner).
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

  // Expand the tree so children are visible.
  await page.evaluate(() => {
    document.querySelectorAll(".drawing-component-twisty").forEach((t) => {
      if (!t.classList.contains("expanded")) t.click();
    });
  });
  await page.waitForTimeout(300);

  out.tree = await tree();

  // Capture the tree indices NOW, while the tree is shown.
  const rowsNow = out.tree;
  const segIdx = rowsNow.findIndex((r) => /Segment/i.test(r.text));
  const elbowIdx = rowsNow.findIndex((r) => /Elbow/i.test(r.text));
  out.indices = { segIdx, elbowIdx };

  // Panel for the ROUTE: it is selected after creation, so open its page.
  out.routePanel = await (async () => {
    const r = await tree();
    const routeIdx = r.findIndex((x) => /Route/i.test(x.text));
    if (routeIdx < 0) return null;
    await openTreeRow(routeIdx);
    return panel();
  })();

  /* Return to the Features TREE from the route's edit page. */
  const backToTree = async () => {
    await page.evaluate(() => {
      const b = document.getElementById("drawingFeaturesBack");
      if (b && b.style.display !== "none") b.click();
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.querySelectorAll(".drawing-component-twisty").forEach((t) => {
        if (!t.classList.contains("expanded")) t.click();
      });
    });
    await page.waitForTimeout(200);
  };

  if (segIdx >= 0) {
    await backToTree();
    await openTreeRow(segIdx);
    out.segmentPanel = await panel();
  }

  if (elbowIdx >= 0) {
    await backToTree();
    await openTreeRow(elbowIdx);
    out.elbowPanel = await panel();
  }

  return out;
}