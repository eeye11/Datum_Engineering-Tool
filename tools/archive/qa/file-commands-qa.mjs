// Exercise Details, Share, Move to Trash (with Cancel), and a real rename.
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

  const openFileMenu = async () => {
    await page
      .getByRole("button", { name: "File", exact: true })
      .first()
      .click();
    await page.waitForTimeout(250);
  };

  const clickItem = async (id) => {
    await page.$eval(`.datum-menu-panel-file [data-menu-item="${id}"]`, (el) =>
      el.click(),
    );
    await page.waitForTimeout(400);
  };

  const out = {};

  // DETAILS
  await openFileMenu();
  await clickItem("details");
  out.details = await page.evaluate(() => {
    const d = document.querySelector(".engg-dialog");
    if (!d) return null;
    return {
      title: d.querySelector(".engg-dialog-title")?.textContent,
      rows: [...d.querySelectorAll(".datum-document-details-row")].map((r) => ({
        label: r.querySelector(".datum-document-details-label")?.textContent,
        value: r.querySelector(".datum-document-details-value")?.textContent,
      })),
      buttons: [...d.querySelectorAll(".engg-dialog-button")].map(
        (b) => b.textContent,
      ),
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // SHARE
  await openFileMenu();
  await clickItem("share");
  out.share = await page.evaluate(() => {
    const d = document.querySelector(".engg-dialog");
    if (!d) return null;
    return {
      title: d.querySelector(".engg-dialog-title")?.textContent,
      note: d.querySelector(".datum-share-note")?.textContent?.slice(0, 90),
      actions: [...d.querySelectorAll(".datum-share-action")].map(
        (b) => b.textContent,
      ),
      hasDisabledLink: !!d.querySelector('[disabled], [aria-disabled="true"]'),
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // MOVE TO TRASH — open, then CANCEL (must not change the document).
  const beforeTrash = await page.evaluate(
    () => document.querySelector("#headerDocumentBaseName")?.textContent,
  );

  await openFileMenu();
  await clickItem("move-to-trash");
  out.trashDialog = await page.evaluate(() => {
    const d = document.querySelector(".engg-dialog");
    if (!d) return null;
    return {
      title: d.querySelector(".engg-dialog-title")?.textContent,
      body: d
        .querySelector(".engg-dialog-description")
        ?.textContent?.slice(0, 140),
      choices: [...d.querySelectorAll("[data-choice]")].map((b) => ({
        id: b.dataset.choice,
        label: b.textContent,
        destructive: b.classList.contains("engg-dialog-button-destructive"),
      })),
    };
  });

  // Cancel via the Cancel button.
  await page.$eval('[data-choice="cancel"]', (el) => el.click());
  await page.waitForTimeout(400);

  out.cancelKeptDocument =
    (await page.evaluate(
      () => document.querySelector("#headerDocumentBaseName")?.textContent,
    )) === beforeTrash;

  // RENAME — perform one for real.
  await openFileMenu();
  await clickItem("rename");
  await page.$eval(".engg-dialog-field input", (el) => {
    el.value = "Beam Analysis";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.$eval(".engg-dialog-button-primary", (el) => el.click());
  await page.waitForTimeout(500);

  out.renamed = await page.evaluate(() => ({
    header: document.querySelector("#headerDocumentBaseName")?.textContent,
    title: document.title,
    dirty: !document.querySelector("#headerDocumentDirty")?.hidden,
  }));

  // And rename back so the session is left tidy.
  await openFileMenu();
  await clickItem("rename");
  await page.$eval(".engg-dialog-field input", (el) => {
    el.value = "Untitled";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.$eval(".engg-dialog-button-primary", (el) => el.click());
  await page.waitForTimeout(300);

  return { out, errors: errors.slice(0, 10) };
}
