/*
 * Which feature types actually contribute bounds to Fit?
 */
export default async function run(page) {
  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  return page.evaluate(() => {
    const ds = window.enggDrawingState;
    const F = ds.geometryFactories;

    const sample = (label, object) => {
      let points = [];

      try {
        points = window.enggDrawingRenderer ? [] : [];
      } catch (error) {
        /* ignore */
      }

      /* The editor's own rendered-bounds measurement. */
      let rendered = [];

      try {
        rendered = window.enggDrawingSheets
          ? window.enggDrawingRenderer.renderedBounds
            ? window.enggDrawingRenderer.renderedBounds(object, 1)
            : []
          : [];
      } catch (error) {
        rendered = [];
      }

      void points;

      return {
        label,
        type: object.type,
        boundsPoints: Array.isArray(rendered) ? rendered.length : -1,
        sample: Array.isArray(rendered) ? rendered.slice(0, 2) : null,
      };
    };

    const built = [];

    const add = (label, object) => {
      object.id = label;
      built.push({ label, object });
    };

    add("point", F.point({ x: 10, y: 10 }, { style: {} }));
    add("particle", F.particle({ x: 20, y: 20 }, { style: {} }));
    add("line", F.line({ x: 0, y: 0 }, { x: 30, y: 0 }, { style: {} }));
    add("circle", F.circle({ x: 40, y: 40 }, 10, { style: {} }));
    add("beam", F.beam({ x: 0, y: 5 }, { x: 50, y: 5 }, { style: {} }));
    add("force", F.force({ x: 0, y: 0 }, { x: 0, y: -30 }, { style: {} }));
    add("moment", F.moment({ x: 5, y: 5 }, { style: {} }));
    add(
      "coordinate-system",
      F["coordinate-system-2d"]
        ? F["coordinate-system-2d"]({ x: 0, y: 0 }, { style: {} })
        : { type: "coordinate-system-2d", geometry: {} },
    );

    /* The measurement the Fit actually uses. */
    const measure = (object) => {
      try {
        return window.enggDrawingSheets.renderReference ? null : null;
      } catch (error) {
        return null;
      }
    };

    void measure;

    /* `renderedBounds` lives in viewport.js; ask the export module instead. */
    const viaProvider = window.enggDrawingExport;

    const results = built.map(({ label, object }) => {
      let count = -1;

      try {
        /* The editor registers a bounds provider with the export module. */
        const points = viaProvider.boundsProviderForTest
          ? viaProvider.boundsProviderForTest([object], 1)
          : null;

        count = Array.isArray(points) ? points.length : -2;
      } catch (error) {
        count = -3;
      }

      return { label, type: object.type, count };
    });

    return {
      hasProviderForTest: Boolean(viaProvider.boundsProviderForTest),
      results,
    };
  });
}
