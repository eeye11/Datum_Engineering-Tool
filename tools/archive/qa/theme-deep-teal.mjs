/*
 * DAETUM - Deep Teal & Ice theme QA.
 *
 * Drives the real application: switches the theme through the model-level
 * commands, reads back the computed colours of the surfaces and the default line
 * colour a new feature would get, and confirms existing geometry is never
 * recoloured.
 *
 * Run: node <skill>/browser.mjs http://localhost:5174/ --script ./tools/qa/theme-deep-teal.mjs
 */

export default async function run(page, ui) {
  const results = {};

  const readTokens = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);

      return {
        themeAttr: document.documentElement.getAttribute("data-theme"),
        page: cs.getPropertyValue("--datum-page").trim(),
        surface: cs.getPropertyValue("--datum-surface").trim(),
        ink: cs.getPropertyValue("--datum-ink").trim(),
        muted: cs.getPropertyValue("--datum-muted").trim(),
        accent: cs.getPropertyValue("--datum-green").trim(),
        border: cs.getPropertyValue("--datum-border").trim(),
        canvasInk: cs.getPropertyValue("--datum-canvas-ink").trim(),
      };
    });

  const setTheme = (value) =>
    page.evaluate(async (v) => {
      const mod = await import("/src/editor/theme-preference.js");
      mod.applyThemePreference(v);
      return document.documentElement.getAttribute("data-theme");
    }, value);

  /* --- LIGHT --- */
  await setTheme("light");
  const light = await readTokens();

  /* A new default-coloured line, as the model would create it. */
  const lightLine = await page.evaluate(async () => {
    const state = await import("/src/core/model/drawing-state.js");
    const theme = await import("/src/editor/theme.js");
    const engg = state.default;
    engg.setThemeLineColour(theme.defaultLineColour());
    const line = engg.geometryFactories.line({ x: 0, y: 0 }, { x: 10, y: 0 });
    return {
      stroke: line.style.stroke,
      defaultLineColour: theme.defaultLineColour(),
    };
  });

  /* --- DARK --- */
  await setTheme("dark");
  const dark = await readTokens();

  const darkLine = await page.evaluate(async () => {
    const state = await import("/src/core/model/drawing-state.js");
    const theme = await import("/src/editor/theme.js");
    const engg = state.default;
    engg.setThemeLineColour(theme.defaultLineColour());
    const line = engg.geometryFactories.line({ x: 0, y: 0 }, { x: 10, y: 0 });
    return {
      stroke: line.style.stroke,
      defaultLineColour: theme.defaultLineColour(),
    };
  });

  /* --- EXISTING GEOMETRY IS NEVER RECOLOURED --- */
  const preserved = await page.evaluate(async () => {
    const state = await import("/src/core/model/drawing-state.js");
    const drawing = await import("/src/editor/editor-state.js");
    const themePref = await import("/src/editor/theme-preference.js");

    const engg = state.default;

    /* Start on light, create a default line, and record its colour. */
    themePref.applyThemePreference("light");
    const before = engg.geometryFactories.line({ x: 0, y: 0 }, { x: 5, y: 0 });
    engg.addObject(drawing.drawingState, before);
    const strokeBefore = before.style.stroke;

    /* Switch to dark - the object must not move. */
    themePref.applyThemePreference("dark");
    const strokeAfter = before.style.stroke;

    const onSheet = drawing.drawingState.objects.find(
      (o) => o.id === before.id,
    );

    return {
      strokeBefore,
      strokeAfter,
      onSheetStroke: onSheet?.style?.stroke ?? null,
    };
  });

  /* --- EXPLICIT CHOICE IS PRESERVED --- */
  const explicit = await page.evaluate(async () => {
    const state = await import("/src/core/model/drawing-state.js");
    const engg = state.default;

    const chosen = engg.geometryFactories.line(
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { style: { stroke: "#C0392B" } },
    );

    return { stroke: chosen.style.stroke };
  });

  return {
    light,
    dark,
    lightLine,
    darkLine,
    preserved,
    explicit,
    checks: {
      lightPageIsF2F8F7: light.page.toLowerCase() === "#f2f8f7",
      lightAccentIs087E83: light.accent.toLowerCase() === "#087e83",
      darkPageIs142426: dark.page.toLowerCase() === "#142426",
      darkAccentIs4DD0C5: dark.accent.toLowerCase() === "#4dd0c5",
      lightDefaultLine: lightLine.stroke.toLowerCase() === "#193335",
      darkDefaultLine: darkLine.stroke.toLowerCase() === "#e8f5f3",
      accentSeparateFromLine:
        light.accent.toLowerCase() !== lightLine.stroke.toLowerCase(),
      existingNotRecoloured: preserved.strokeBefore === preserved.strokeAfter,
      sheetObjectNotRecoloured:
        preserved.onSheetStroke === preserved.strokeBefore,
      explicitKept: explicit.stroke === "#C0392B",
    },
  };
}
