export default async function run(page) {
  const tab = page.getByText("Written Solution", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(700);
  }

  await page.waitForSelector("#solutionWorkspace", { timeout: 15000 });

  return await page.evaluate(async () => {
    const sol = await import("/src/solution/solution-state.js");
    const cmd = await import("/src/editor/document-commands.js");

    const editor = document.getElementById("solutionEditor");

    const before = sol.getSource();

    editor.value = "\\section{X}\n";
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    const afterTyping = sol.getSource();

    const body = cmd.serializeDocumentBody();
    const key = sol.SOLUTION_DOCUMENT_KEY;

    return {
      key,
      stateBefore: before,
      stateAfterTyping: afterTyping,
      // Does the state module hold the text at all?
      stateHoldsText: afterTyping.includes("X"),
      bodyHasKey: Object.prototype.hasOwnProperty.call(body, key),
      bodyKeys: Object.keys(body),
    };
  });
}
