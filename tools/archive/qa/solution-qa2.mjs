// Check the figure link, the resizer, and both themes.
export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  const tab = page.getByText("Written Solution", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(700);
  }

  await page.waitForSelector("#solutionWorkspace", { timeout: 15000 });

  const out = {};

  // The files list: the drawing sheets in the document.
  out.filesList = await page.$$eval(
    "#solutionFilesTree .solution-tree-row",
    (els) => els.map((e) => e.textContent),
  );
  out.filesEmpty = await page.$("#solutionFilesTree .solution-tree-empty");

  // The resizer: drag the nav divider and read the CSS variable.
  const before = await page.evaluate(() =>
    getComputedStyle(
      document.getElementById("solutionWorkspace"),
    ).getPropertyValue("--solution-nav-width"),
  );

  const splitter = await page.$("#solutionSplitterNav");
  const box = await splitter.boundingBox();

  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() =>
    getComputedStyle(
      document.getElementById("solutionWorkspace"),
    ).getPropertyValue("--solution-nav-width"),
  );

  out.resizer = {
    before: before.trim(),
    after: after.trim(),
    changed: before !== after,
  };

  // Both themes: the paper must stay a light sheet with dark type.
  const readPaper = () =>
    page.evaluate(() => {
      const paper = document.querySelector(".solution-paper");
      const cs = getComputedStyle(paper);
      const ws = getComputedStyle(document.getElementById("solutionWorkspace"));
      return {
        paperBg: cs.backgroundColor,
        paperColor: cs.color,
        workspaceBg: ws.backgroundColor,
        theme: document.documentElement.getAttribute("data-theme"),
      };
    });

  out.lightPaper = await readPaper();

  await page.evaluate(() => {
    localStorage.setItem("datum.theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.waitForTimeout(300);

  out.darkPaper = await readPaper();

  // Back to light.
  await page.evaluate(() => {
    localStorage.setItem("datum.theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
  });

  return { out, errors: errors.slice(0, 8) };
}
