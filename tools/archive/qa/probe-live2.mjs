/*
 * Live verification: create a Point Force through the real tool, inspect the
 * magnitude box, its panel, and drag it.
 */
export default async function run(page, ui) {
  const out = {};

  // Enter Statics, then pick the Point Force tool by its data-tool if present.
  out.toolInventory = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll("#drawingToolList *"),
    ).filter((e) => e.getAttribute && e.getAttribute("data-tool"));
    return btns.map((e) => e.getAttribute("data-tool"));
  });

  // Ask the model directly, in the real page, what a force annotation says.
  out.magnitudeTexts = await page.evaluate(() => {
    const model = window.enggAnnotationModel;
    if (!model) return { error: "no model" };

    const mk = (type, kind, geometry) => {
      const object = { id: `o-${kind}`, type, geometry };
      const ann = {
        id: `a-${kind}`,
        annotationKind: kind,
        textMode: "auto",
        sourceFeatureId: object.id,
      };
      return model.textFor(ann, {
        objects: [object],
        display: { showMagnitudes: true },
      });
    };

    return {
      force: mk("force", "force-value", {
        start: { x: 0, y: 0 },
        end: { x: 60, y: 0 },
        magnitude: 100,
        angle: 30,
        direction: 30,
      }),
      load: mk("load", "load-value", { intensity: 5, direction: 90 }),
      varyingW1: model.textFor(
        {
          id: "v1",
          annotationKind: "load-profile-value",
          textMode: "auto",
          sourceFeatureId: "o-vl",
          anchorRef: { index: 0 },
        },
        {
          objects: [
            {
              id: "o-vl",
              type: "varying-load",
              geometry: { points: [{ magnitude: 5 }, { magnitude: 10 }] },
            },
          ],
        },
      ),
      varyingW2: model.textFor(
        {
          id: "v2",
          annotationKind: "load-profile-value",
          textMode: "auto",
          sourceFeatureId: "o-vl",
          anchorRef: { index: 1 },
        },
        {
          objects: [
            {
              id: "o-vl",
              type: "varying-load",
              geometry: { points: [{ magnitude: 5 }, { magnitude: 10 }] },
            },
          ],
        },
      ),
      moment: mk("moment", "moment-value", {
        magnitude: 25,
        angle: 45,
        clockwise: true,
      }),
      components: mk("force", "force-components", {
        magnitude: 100,
        angle: 53.13,
      }),
      resultant: mk("resultant", "resultant-value", {
        magnitude: 150,
        angle: 20,
      }),
    };
  });

  return out;
}
