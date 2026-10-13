/*
 * QA that a circular dimension DRIVES the geometry through the running app.
 *
 * Two things only a live page shows:
 *
 *   1. A Driven dimension created through the factory KEEPS its state - the panel
 *      reports it as a reading and the edit is refused. The factory used to drop
 *      the `driven` bit, so a dimension that was created as a reading behaved as
 *      Driving and could move geometry.
 *   2. An arc-length target actually changes the arc's radius while the sweep
 *      survives, and the dimension then reads the target back.
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

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForTimeout(900);

  out.result = await page.evaluate(async () => {
    const st = window.enggDrawing.state;
    const D = window.enggDrawingState;
    const model = (await import("/src/features/dimensions/dimension-model.js"))
      .default;
    const edit = await import("/src/features/dimensions/dimension-edit.js");

    st.objects.length = 0;
    st.selection.selectedObjectIds = [];
    st.scale = { unitsPerMillimetre: 1, unit: "mm", calibrated: true };

    const F = D.geometryFactories;

    /* An arc of radius 30 sweeping a quarter turn: length 47.12 mm. */
    const arc = F.arc({ x: 0, y: 0 }, 30, 0, Math.PI / 2);
    D.addObject(st, arc);

    const dim = F.dimension({
      dimensionType: "arc-length",
      refs: [{ kind: "between", featureId: arc.id, anchor: "start" }],
      placement: { x: 0, y: 0 },
    });
    D.addObject(st, dim);

    const measure = () => {
      const m = model.measurementFor(dim, st);
      return m ? Math.round(m.value * 100) / 100 : null;
    };

    const before = measure();
    const editableBefore = edit.dimensionEditable(dim, st);

    /* Ask for a radius of 60: 60 * pi/2 = 94.25 mm. */
    const target = 60 * (Math.PI / 2);
    const applied = edit.applyDimensionValue(dim, st, target);

    const after = measure();

    /* And a Driven dimension, created through the factory, must keep its state. */
    const circle = F.circle({ x: 200, y: 0 }, 15);
    D.addObject(st, circle);

    const drivenDim = F.dimension({
      dimensionType: "radius",
      refs: [{ kind: "between", featureId: circle.id, anchor: "center" }],
      placement: { x: 215, y: 0 },
      driven: true,
    });
    D.addObject(st, drivenDim);

    const drivenFlagOnFeature = drivenDim.driven === true;
    const drivenEditable = edit.dimensionEditable(drivenDim, st);
    const drivenApply = edit.applyDimensionValue(drivenDim, st, 20);

    return {
      before,
      editableBefore,
      applied,
      arcRadius: arc.geometry.radius,
      arcSweep: Math.abs(arc.geometry.endAngle - arc.geometry.startAngle),
      after,
      target,
      drivenFlagOnFeature,
      drivenEditable,
      drivenRefused: drivenApply.ok === false,
      drivenReason: drivenApply.reason,
      circleRadiusUntouched: circle.geometry.radius,
    };
  });

  return out;
}
