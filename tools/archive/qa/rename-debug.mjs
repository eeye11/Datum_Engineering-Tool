export default async function run(page) {
  const logs = [];
  page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
  page.on("pageerror", (e) =>
    logs.push("error: " + String((e && e.message) || e)),
  );

  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector(".datum-menubar", {
    state: "visible",
    timeout: 15000,
  });

  // Call the command directly and observe what it returns.
  const direct = await page.evaluate(async () => {
    const cmds = await import("/src/editor/document-commands.js");
    const ui = (await import("/src/ui/ui.js")).default;

    // Stub the prompt so the answer is deterministic.
    const original = ui.promptDialog;
    ui.promptDialog = async () => ({ name: "Beam Analysis" });

    let result;
    try {
      result = await cmds.renameDrawing();
    } catch (e) {
      result = "threw: " + String(e);
    }

    ui.promptDialog = original;

    return {
      result,
      header: document.querySelector("#headerDocumentBaseName")?.textContent,
      title: document.title,
      dirty: !document.querySelector("#headerDocumentDirty")?.hidden,
    };
  });

  return { direct, logs: logs.slice(0, 15) };
}
