/*
 * ========================================================
 * ACCEPTANCE TEST - OPEN: THREE-DOT, MENU POSITION, DEDUPE, THUMBNAILS
 * ========================================================
 *
 *   - the three-dot is a small control, not a full-width button
 *   - clicking it opens the menu AT THE CURSOR, inside the viewport
 *   - the Open page stays open throughout
 *   - one physical file is one Recent entry
 *   - a preview is a FITTED drawing, not a letterboxed workspace
 */

export default async function run(page) {
  const out = {};
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* A drawing with real geometry, recorded twice, plus a second file. */
  out.setup = await page.evaluate(() => {
    window.enggRecentFiles.clear();

    const triangleDoc = {
      units: "mm",
      sheets: [
        {
          id: "s1",
          name: "Sheet 1",
          objects: [
            {
              id: "tri",
              type: "triangle",
              name: "Tri",
              geometry: {
                points: [
                  { x: 0, y: 0 },
                  { x: 120, y: 0 },
                  { x: 60, y: 90 },
                ],
              },
              style: { stroke: "#000000", lineWidth: 1, fill: "none" },
            },
          ],
        },
      ],
      activeSheetId: "s1",
    };

    /* Recorded twice on purpose - the duplicate the list must collapse. */
    window.enggRecentFiles.remember({
      name: "triangle.enggdraw",
      document: triangleDoc,
      preview: window.enggDrawingExport.renderFittedDocument(triangleDoc)
        ? new XMLSerializer().serializeToString(
            window.enggDrawingExport.renderFittedDocument(triangleDoc).svg,
          )
        : null,
    });

    window.enggRecentFiles.remember({
      name: "triangle.enggdraw",
      handle: { name: "triangle.enggdraw" },
      document: triangleDoc,
    });

    window.enggRecentFiles.remember({
      name: "beam.enggdraw",
      document: {
        units: "mm",
        sheets: [
          {
            id: "s2",
            name: "Sheet 1",
            objects: [
              {
                id: "beam",
                type: "beam",
                name: "Beam",
                geometry: {
                  start: { x: 0, y: 0 },
                  end: { x: 300, y: 0 },
                },
                style: { stroke: "#000000", lineWidth: 1 },
              },
            ],
          },
        ],
        activeSheetId: "s2",
      },
    });

    return { count: window.enggRecentFiles.list().length };
  });

  /* Open the launcher through the File menu's own control. */
  await page.evaluate(() => {
    document.querySelector('[data-file-action="open"]').click();
  });
  await page.waitForTimeout(600);

  out.launcher = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-recent-key]")];
    const menus = [...document.querySelectorAll(".datum-open-recent-menu")];
    const wrap = document.querySelector(".datum-open-recent-wrap");
    const thumb = document.querySelector(".datum-open-thumb");

    const rowRect = rows[0] ? rows[0].getBoundingClientRect() : null;
    const menuRect = menus[0] ? menus[0].getBoundingClientRect() : null;

    return {
      rowCount: rows.length,
      menuCount: menus.length,
      /* The row and the menu must be SEPARATE siblings. */
      rowAndMenuAreSiblings:
        wrap !== null &&
        rows[0] !== undefined &&
        menus[0] !== undefined &&
        rows[0].parentElement === menus[0].parentElement,
      /* The menu is NOT inside the row - the old bug. */
      menuInsideRow: rows[0] ? rows[0].contains(menus[0]) : null,
      menuWidth: menuRect ? Math.round(menuRect.width) : null,
      rowWidth: rowRect ? Math.round(rowRect.width) : null,
      /* A preview is present, and is an SVG (a real drawing), not a placeholder. */
      thumbHasSvg: Boolean(thumb && thumb.querySelector("svg")),
    };
  });

  out.launcher = out.launcher;

  /* Click the three-dot near the BOTTOM-RIGHT and check the menu placement. */
  out.menu = await page.evaluate(async () => {
    const menus = [...document.querySelectorAll(".datum-open-recent-menu")];
    const target = menus[menus.length - 1];

    const rect = target.getBoundingClientRect();

    /* A synthetic click carrying real coordinates, near the viewport corner. */
    const x = Math.min(rect.right - 4, window.innerWidth - 8);
    const y = Math.min(rect.bottom - 4, window.innerHeight - 8);

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });

    target.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 300));

    const menu = document.querySelector(".engg-context-menu");
    const menuRect = menu ? menu.getBoundingClientRect() : null;

    return {
      opened: Boolean(menu),
      openPageStillOpen:
        (document.querySelector(".engg-dialog-title") || {}).textContent ===
        "Open",
      items: menu
        ? [...menu.querySelectorAll(".engg-context-menu-item")].map(
            (n) => n.textContent,
          )
        : [],
      /* The whole menu must be inside the window. */
      insideViewport: menuRect
        ? menuRect.left >= 0 &&
          menuRect.top >= 0 &&
          menuRect.right <= window.innerWidth + 1 &&
          menuRect.bottom <= window.innerHeight + 1
        : null,
      /* And it must have opened NEAR the click, not at a fixed corner. */
      nearClick: menuRect
        ? Math.abs(menuRect.left - x) < 240 && Math.abs(menuRect.top - y) < 240
        : null,
      clickX: x,
      clickY: y,
      menuLeft: menuRect ? Math.round(menuRect.left) : null,
      menuTop: menuRect ? Math.round(menuRect.top) : null,
    };
  });

  out.menu = out.menu;

  /* Escape closes the menu, not the launcher. */
  out.escape = await page.evaluate(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    await new Promise((r) => setTimeout(r, 250));

    return {
      menuClosed: !document.querySelector(".engg-context-menu"),
      openStillOpen:
        (document.querySelector(".engg-dialog-title") || {}).textContent ===
        "Open",
    };
  });

  out.escape = out.escape;

  /* The preview must be FITTED: the drawing fills its box, not a sliver. */
  out.thumbnail = await page.evaluate(() => {
    const doc = {
      units: "mm",
      sheets: [
        {
          id: "s",
          name: "Sheet 1",
          objects: [
            {
              id: "tri",
              type: "triangle",
              name: "Tri",
              geometry: {
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                  { x: 50, y: 70 },
                ],
              },
              style: { stroke: "#000000", lineWidth: 1, fill: "none" },
            },
          ],
        },
      ],
      activeSheetId: "s",
    };

    const image = window.enggDrawingExport.renderFittedDocument(doc, {
      width: 160,
    });

    if (!image) {
      return { error: "no preview" };
    }

    const vb = image.svg.getAttribute("viewBox");

    return {
      viewBox: vb,
      /* The box must match the drawing's ~1.43 aspect, not a 160x1600 page. */
      aspect: (() => {
        const [, , w, h] = vb.split(/[\s,]+/).map(Number);
        return Number((w / Math.max(h, 1e-6)).toFixed(2));
      })(),
    };
  });

  out.thumbnail = out.thumbnail;

  out.errors = errors;

  return out;
}