export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(500);

  return await page.evaluate(async () => {
    const { drawingState } = await import("/src/editor/editor-state.js");
    const engg = (await import("/src/core/model/drawing-state.js")).default;
    const style = { ...drawingState.styleDefaults };

    // A point force on empty space.
    const force = engg.geometryFactories.force(
      { x: 100, y: 100 },
      { x: 100, y: 40 },
      { style, engineering: null },
    );
    force.name = "Test Force";
    force.geometry.magnitude = 100;
    drawingState.objects.push(force);

    // Derive its annotation and select it exactly as a click would.
    const model = (
      await import("/src/features/annotations/annotation-model.js")
    ).default;
    const derived = model.derivedAnnotations(force, drawingState);
    const first = derived[0];

    const { objectAtPoint } = await import("/src/editor/hit-testing.js");
    const picked = objectAtPoint(first.placement);

    const enggDrawingState = engg;
    enggDrawingState.selectObject(drawingState, picked.id);

    return {
      derivedId: first?.id || null,
      annotationText: model.textFor(first, drawingState),
      pickedId: picked?.id || null,
      pickedType: picked?.type || null,
      sameId: picked?.id === first?.id,
      selection: [...drawingState.selection.selectedObjectIds],
    };
  });
}
