/*
 * Two lines -> an ANGLE, with no Enter. Driven through the tool's own click
 * path, exactly as a student's two clicks would drive it.
 */
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

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
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;
    const inf = window.enggDimensionInference;
    const place = window.enggDimensionPlacement;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    /* Two lines from the SAME origin: 0 degrees and 45 degrees. */
    const base = F.line({ x: 0, y: 0 }, { x: 200, y: 0 }, { style: {} });
    base.id = "base";

    const slant = F.line({ x: 0, y: 0 }, { x: 140, y: 140 }, { style: {} });
    slant.id = "slant";

    st.objects.push(base, slant);
    ds.commitDrawingChange(st, before);

    ds.setActiveTool(st, "smart-dimension");

    /*
     * A click near the base line's midpoint, and one near the slanted line's
     * midpoint - which is what a student actually clicks. The anchors are
     * forced to the two ENDS, because both lines start at the same origin and
     * an angle measured between two `start` anchors is degenerate.
     */
    const firstRef = inf.dimensionReferenceAtClick({}, { x: 100, y: 0 }, false);
    const secondRef = inf.dimensionReferenceAtClick({}, { x: 70, y: 70 }, true);

    if (firstRef) {
      firstRef.anchor = "end";
    }

    if (secondRef) {
      secondRef.anchor = "end";
    }

    const result = {
      firstKind: firstRef ? firstRef.kind : null,
      secondKind: secondRef ? secondRef.kind : null,
      firstAnchor: firstRef ? firstRef.anchor : null,
      secondAnchor: secondRef ? secondRef.anchor : null,
    };

    if (!firstRef || !secondRef) {
      result.error = "a click did not resolve to a reference";
      return result;
    }

    /* FIRST click: a line on its own is a length, so this enters placement. */
    place.beginDimensionReferenceSelection(firstRef, { x: 100, y: 0 });

    result.afterFirst = {
      stage: st.interaction.dimensionStage,
      choice: st.interaction.dimensionChoice,
    };

    /*
     * Back to selecting, so the SECOND line can be picked - which is what the
     * student does by clicking another line while the length preview is up:
     * the tool treats a fresh selection as a new reference.
     */
    st.interaction.dimensionStage = "selecting";
    st.interaction.dimensionPickedRefs = [firstRef];
    st.interaction.dimensionRefs = null;
    st.interaction.dimensionChoice = null;

    /* SECOND click: two lines now describe an ANGLE. */
    place.beginDimensionReferenceSelection(secondRef, { x: 70, y: 70 });

    result.afterSecond = {
      stage: st.interaction.dimensionStage,
      choice: st.interaction.dimensionChoice,
      refs: Array.isArray(st.interaction.dimensionRefs)
        ? st.interaction.dimensionRefs.length
        : 0,
    };

    /* The measurement the tool would state. */
    result.measurement = (() => {
      try {
        const probe = ds.geometryFactories.dimension({
          dimensionType: st.interaction.dimensionChoice,
          refs: st.interaction.dimensionRefs,
          placement: { x: 50, y: 50 },
        });

        return ds.dimensionModel.formatMeasurement(probe, st);
      } catch (error) {
        return "error: " + error.message;
      }
    })();

    /* What the inference itself makes of the pair - the raw answer. */
    result.descriptor = (() => {
      try {
        const d = inf.inferDimensionDescriptor(firstRef, secondRef);

        return d
          ? {
              dimensionType: d.dimensionType,
              refs: d.refs.length,
              anchors: d.refs.map((r) => r.anchor),
            }
          : null;
      } catch (error) {
        return "error: " + error.message;
      }
    })();

    return result;
  });
}
