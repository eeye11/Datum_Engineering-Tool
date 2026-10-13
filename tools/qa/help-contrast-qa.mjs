/*
 * QA the LIGHT-MODE contrast of the Help and Settings dialogs.
 *
 * The defect: the dialog BODY had no background of its own, so `--datum-ink` text
 * was drawn straight onto the dialog's dark backdrop scrim. On a light sheet that
 * is dark-on-dark - the User Guide and Drawing Help pages were hard to read.
 *
 * This opens each help page in the LIGHT theme and reads the computed background
 * of the body and the colour of the text on it, so the contrast is a number rather
 * than an opinion.
 */
export default async function run(page) {
  const errs = [];

  page.on("pageerror", (e) =>
    errs.push("PAGEERROR: " + e.message.slice(0, 220)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 180));
  });

  const out = { errs };

  await page.evaluate(async () => {
    await import("/src/main.js");
  });
  await page.waitForTimeout(900);

  /* Light theme, the one the report came from. */
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.waitForTimeout(250);

  out.theme = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );

  const readDialog = (pageId) =>
    page.evaluate(async (id) => {
      const help = (await import("/src/ui/help-dialog.js")).default;

      /*
       * `open` is the application's own entry point - the same one the Help menu
       * calls - so what is measured is the real dialog, not a stand-in.
       */
      help.open(id);

      await new Promise((r) => requestAnimationFrame(r));

      const dialog = document.querySelector(".datum-help-dialog");

      if (!dialog) {
        help.close();
        return { opened: false };
      }

      const body = dialog.querySelector(".datum-help-dialog-body");
      const title = dialog.querySelector(".datum-help-dialog-title");
      const heading = body ? body.querySelector("h4") : null;
      const para = body ? body.querySelector("p") : null;

      const result = {
        opened: true,
        bodyBackground: body ? getComputedStyle(body).backgroundColor : null,
        bodyTextColour: body ? getComputedStyle(body).color : null,
        headingColour: heading ? getComputedStyle(heading).color : null,
        paraColour: para ? getComputedStyle(para).color : null,
        titleBackground: title ? getComputedStyle(title).backgroundColor : null,
        titleColour: title ? getComputedStyle(title).color : null,
      };

      help.close();

      return result;
    }, pageId);

  out.guide = await readDialog("guide");
  out.drawing = await readDialog("drawing");

  return out;
}
