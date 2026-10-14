// Open the File menu, read its exact order, and open each new dialog.
export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  const tab = page.getByText("Engineering Drawing", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(900);
  }

  await page.waitForSelector(".datum-menubar", {
    state: "visible",
    timeout: 15000,
  });

  await page.getByRole("button", { name: "File", exact: true }).first().click();
  await page.waitForTimeout(300);

  const readFileMenu = () =>
    page.$$eval(
      ".datum-menu-panel-file > .datum-menu-item, .datum-menu-panel-file > .datum-menu-separator",
      (els) =>
        els.map((el) =>
          el.classList.contains("datum-menu-separator")
            ? "---"
            : {
                id: el.dataset.menuItem,
                label: el.querySelector(".datum-menu-item-label")?.textContent,
                icon: !!el.querySelector(".datum-menu-item-icon svg"),
                chevron: !!el.querySelector(".datum-menu-item-chevron"),
              },
        ),
    );

  const out = {};
  out.fileMenu = await readFileMenu();

  // Top-level labels must remain the six.
  out.topLabels = await page.$$eval(".datum-menu > button", (els) =>
    els.map((el) => el.textContent.trim()),
  );

  // Open Rename.
  await page.$eval('.datum-menu-panel-file [data-menu-item="rename"]', (el) =>
    el.click(),
  );
  await page.waitForTimeout(400);
  out.renameDialog = await page.evaluate(() => {
    const d = document.querySelector(".engg-dialog");
    if (!d) return null;
    return {
      title: d.querySelector(".engg-dialog-title")?.textContent,
      fieldValue: d.querySelector(".engg-dialog-field input")?.value,
      buttons: [...d.querySelectorAll(".engg-dialog-button")].map(
        (b) => b.textContent,
      ),
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  return { out, errors: errors.slice(0, 10) };
}
