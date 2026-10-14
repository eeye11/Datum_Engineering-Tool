export default async function run(page, ui) {
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);

  const out = {};

  // Instrument activateTool by wrapping the module export? Exports are live bindings;
  // instead count via a MutationObserver-free approach: patch setActiveTool on the state object.
  await page.evaluate(async () => {
    const s = (await import("/src/editor/editor-state.js")).drawingState;
    window.__toolLog = [];
    const orig = s.activeTool;
    let _val = orig;
    Object.defineProperty(s, "activeTool", {
      get() {
        return _val;
      },
      set(v) {
        window.__toolLog.push({
          from: _val,
          to: v,
          stack: new Error().stack.split("\n").slice(1, 6).join(" | "),
        });
        _val = v;
      },
      configurable: true,
    });
  });

  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "FLUIDS")
      ?.click();
  });
  await page.waitForTimeout(400);
  const snap = await ui.snapshot();
  const pipeBtn = snap.match(/@(e\d+) button "Pipe \/ Duct/)?.[1];
  out.pipeBtn = pipeBtn;
  if (pipeBtn) await ui.click(pipeBtn);
  await page.waitForTimeout(400);

  out.log = await page.evaluate(() => window.__toolLog);
  out.final = await page.evaluate(async () => {
    const s = (await import("/src/editor/editor-state.js")).drawingState;
    return {
      activeTool: s.activeTool,
      message: document
        .getElementById("drawingToolMessage")
        ?.textContent?.trim(),
    };
  });

  return out;
}
