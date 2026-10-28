export default async function run(page) {
  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="writing"]')?.click(),
  );
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");
    editor.focus();
    editor.value = "A simply supported beam carries a point load.\n";
    editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    document.getElementById("solutionEnterDrawing")?.click();

    return document.getElementById("solutionEditor").value;
  });

  await page.waitForTimeout(400);

  const dialog = await page.evaluate(() => {
    const node = document.querySelector(".engg-dialog");
    const buttons = [...document.querySelectorAll(".engg-dialog button")].map(
      (b) => b.textContent.trim(),
    );

    return {
      open: Boolean(node),
      title: node?.querySelector(".engg-dialog-title")?.textContent,
      description: node?.querySelector("p")?.textContent,
      buttons,
      onWritingTab: document
        .querySelector('.tab[data-tab="writing"]')
        ?.classList.contains("active"),
      onDrawingTab: document
        .querySelector('.tab[data-tab="drawing"]')
        ?.classList.contains("active"),
      source: document.getElementById("solutionEditor")?.value,
    };
  });

  await page.screenshot({ path: "./qa-enter-drawing.png" });

  return { before, dialog };
}
