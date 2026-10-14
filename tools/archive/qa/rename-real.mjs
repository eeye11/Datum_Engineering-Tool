export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector(".datum-menubar", {
    state: "visible",
    timeout: 15000,
  });

  // Open File > Rename through the UI.
  await page.getByRole("button", { name: "File", exact: true }).first().click();
  await page.waitForTimeout(250);
  await page.$eval('.datum-menu-panel-file [data-menu-item="rename"]', (el) =>
    el.click(),
  );
  await page.waitForTimeout(400);

  const opened = await page.evaluate(() => {
    const input = document.querySelector(".engg-dialog-field input");
    return { present: !!input, value: input?.value };
  });

  // Type into the field the way a user does - select all, then type.
  await page.click(".engg-dialog-field input");
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type("Beam Analysis");
  await page.waitForTimeout(150);

  const typed = await page.evaluate(
    () => document.querySelector(".engg-dialog-field input")?.value,
  );

  // Confirm with Enter (the dialog's own convention).
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  return {
    opened,
    typed,
    after: await page.evaluate(() => ({
      header: document.querySelector("#headerDocumentBaseName")?.textContent,
      title: document.title,
      dirty: !document.querySelector("#headerDocumentDirty")?.hidden,
      dialogGone: !document.querySelector(".engg-dialog"),
    })),
    errors: errors.slice(0, 8),
  };
}
