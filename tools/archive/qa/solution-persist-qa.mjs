// Proves the written solution travels in the .enggdraw document: write, round
// trip through the document body, and confirm the source is restored.
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  const tab = page.getByText("Written Solution", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(700);
  }

  await page.waitForSelector("#solutionWorkspace", { timeout: 15000 });

  const out = await page.evaluate(async () => {
    const cmd = await import("/src/editor/document-commands.js");
    const sol = await import("/src/solution/solution-state.js");
    const file = (await import("/src/file/document-file.js")).default;
    const ws = (await import("/src/solution/solution-workspace.js")).default;

    const editor = document.getElementById("solutionEditor");

    const MARK = "\\section{Round Trip}\nThe solution survives a save.\n";

    // Type it through the editor, so the change path is the real one.
    editor.value = MARK;
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    // The document body must carry it.
    const body = cmd.serializeDocumentBody();
    const key = sol.SOLUTION_DOCUMENT_KEY;
    const carried = body[key] === MARK;

    // The full file envelope must carry it too, and stay valid.
    const payload = file.createDocument(body);
    const readBack = file.readDocument(JSON.parse(JSON.stringify(payload)));

    // Clear the editor, then load the document back.
    editor.value = "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    const cleared = editor.value === "";

    // Restore the whole document the way Open does.
    cmd.loadDrawing(payload, "round-trip.enggdraw");
    await new Promise((r) => setTimeout(r, 400));

    void ws;

    return {
      carriedInBody: carried,
      fileStaysValid: readBack.ok === true,
      carriedInFile: readBack.ok && readBack.document[key] === MARK,
      cleared,
      restoredInEditor:
        document.getElementById("solutionEditor").value === MARK,
      restoredInState: sol.getSource() === MARK,
    };
  });

  return { out, errors: errors.slice(0, 8) };
}
