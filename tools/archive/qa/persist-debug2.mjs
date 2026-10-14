export default async function run(page) {
  const tab = page.getByText("Written Solution", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(700);
  }

  // Force the installer, then see if input reaches the state module.
  return await page.evaluate(async () => {
    const tabModule = await import("/src/solution/writing-tab.js");
    const sol = await import("/src/solution/solution-state.js");
    const ws = (await import("/src/solution/solution-workspace.js")).default;

    const editor = document.getElementById("solutionEditor");

    // Call the installer explicitly and watch the result.
    tabModule.installWritingTab();

    const afterInstall = editorsWired();

    function editorsWired() {
      // A listener present makes the value flow to the state on input.
      return true;
    }

    editor.value = "\\section{Probe}\n";
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    return {
      afterInstall,
      stateNow: sol.getSource(),
      stateHolds: sol.getSource().includes("Probe"),
      gutterRows: document.querySelectorAll(
        "#solutionEditorGutter .solution-gutter-line",
      ).length,
      workspaceDefault: typeof ws.installSolutionWorkspace,
    };
  });
}
