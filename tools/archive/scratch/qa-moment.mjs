export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  return await page.evaluate(async () => {
    const { drawingState } = await import("/src/editor/editor-state.js");
    const { default: tools } = await import("/src/editor/tools.js");

    // 1. The menu definition: no moments submenu, no couple.
    const { STATICS_TOOL_MENUS } = await import("/src/editor/statics-tools.js");
    const { STATICS_CHILD_TOOLS } =
      await import("/src/editor/statics-tools.js");

    const menuCheck = {
      hasMomentSubmenu: Boolean(STATICS_TOOL_MENUS.moment),
      momentTool: STATICS_CHILD_TOOLS.moment || null,
      appliedMomentGone: !STATICS_CHILD_TOOLS["applied-moment"],
      coupleGone: !STATICS_CHILD_TOOLS.couple,
    };

    // 2. Place a beam, then a moment on it, like a user would.
    const engg = (await import("/src/core/model/drawing-state.js")).default;
    const style = { ...drawingState.styleDefaults };
    const beam = engg.geometryFactories.line(
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { style, engineering: null },
    );
    drawingState.objects.push(beam);

    // Calibrate: 240 units = 100 mm.
    const enggDimensions = (await import("/src/core/scale/dimensions.js"))
      .default;
    enggDimensions.calibrate(drawingState, 240, 100, "mm");

    // Activate the moment tool the way the toolbar now does.
    const { activateTool } = await import("/src/editor/tool-activation.js");
    activateTool("moment");
    const toolAfterActivate = drawingState.activeTool;

    // Simulate a click mid-beam through the placement path.
    const { beginMomentPlacement } =
      await import("/src/editor/statics-attachment.js");
    beginMomentPlacement({ x: 120, y: 0 }, beam.id);

    // Find the created moment.
    const moment = drawingState.objects.find((o) => o.type === "moment");

    // 3. The panel rows for the moment.
    const { relativeCoordinateRows } =
      await import("/src/editor/relative-coordinates.js");
    const { default: enggPropertyPanel } =
      await import("/src/ui/feature-panel/property-panel.js");

    const rows = moment
      ? relativeCoordinateRows(moment, "RELATIONSHIP", {
          coordinate: (label, key, value, unit) =>
            `${label}=${value}${unit || ""}`,
          section: (label) => `[${label}]`,
        })
      : "(no moment created)";

    return {
      menuCheck,
      toolAfterActivate,
      momentCreated: Boolean(moment),
      momentParentId: moment?.parentId || null,
      rows,
    };
  });
}
