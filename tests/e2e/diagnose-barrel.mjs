/*
 * Is the abort inside `features/workspace/index.js`?
 *
 * `main.js` imports that barrel at line 48, BEFORE the automation hooks at line
 * 52. The barrel runs nine install functions and a first render as module side
 * effects. If any of them throws, the whole graph aborts silently and nothing
 * after line 48 ever runs - which matches exactly what is observed.
 *
 * Re-importing the barrel here reports whether it throws when its dependencies
 * are already initialised.
 */
export default async function run(page) {
  return page.evaluate(async () => {
    const out = {};

    try {
      const mod = await import(
        `/src/features/workspace/index.js?probe=${Date.now()}`
      );
      out.imported = "ok";
      out.exports = Object.keys(mod);
    } catch (e) {
      out.imported = `THREW: ${e.message}`;
      out.stack = String(e.stack).split("\n").slice(0, 8).join(" | ");
    }

    // And the pieces the barrel installs, each in isolation.
    const parts = [
      [
        "installSheetController",
        "/src/components/layout/workspace/sheet-controller.js",
      ],
      [
        "installWorkspaceLayout",
        "/src/components/layout/workspace/workspace-layout.js",
      ],
      ["installDrawingPanel", "/src/components/layout/panels/drawing-panel.js"],
      [
        "installCanvasEvents",
        "/src/features/workspace/interaction/canvas-events.js",
      ],
      [
        "installKeyboardShortcuts",
        "/src/features/workspace/interaction/keyboard-shortcuts.js",
      ],
    ];

    for (const [name, path] of parts) {
      try {
        const m = await import(`${path}?probe=${Date.now()}`);
        out[name] = typeof m[name] === "function" ? "exported" : "NOT exported";
      } catch (e) {
        out[name] = `import THREW: ${e.message}`;
      }
    }

    return out;
  });
}
