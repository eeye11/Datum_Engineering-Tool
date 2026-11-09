export default async function run(page) {
  await page.evaluate(() =>
    document.querySelector('.tab[data-tab="writing"]')?.click(),
  );
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");
    return { value: editor?.value, hasEditor: Boolean(editor) };
  });

  /* Put a reference in the document the way Enter Drawing does. */
  await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");
    editor.focus();
    editor.value =
      "The beam is loaded as shown.\n\n\\datumdrawing{sheet_abc123}\n\nTaking moments about A:";
    editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await page.waitForTimeout(700);

  const chips = await page.evaluate(() => {
    const chip = document.querySelector(".solution-drawing-chip");
    const editor = document.getElementById("solutionEditor");
    const host = document.querySelector(".solution-editor-host");
    const mirror = document.querySelector(".solution-editor-mirror");

    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };

    return {
      chip: rect(chip),
      chipText: chip?.textContent,
      chipStyle: chip
        ? {
            left: chip.style.left,
            top: chip.style.top,
            width: chip.style.width,
          }
        : null,
      editor: rect(editor),
      host: rect(host),
      mirror: rect(mirror),
      editorPadding: editor ? getComputedStyle(editor).padding : null,
      editorScrollLeft: editor?.scrollLeft,
      hostRect: rect(host),
    };
  });

  return { before, chips };
}
