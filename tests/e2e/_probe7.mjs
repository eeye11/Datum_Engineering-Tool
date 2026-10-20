export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  const click = (id) =>
    page.evaluate((toolId) => {
      [...document.querySelectorAll("[data-tool-id]")]
        .find((n) => n.getAttribute("data-tool-id") === toolId)
        ?.click();
    }, id);

  const status = () =>
    page.evaluate(
      () =>
        (
          document.querySelector("#drawingToolMessage")?.textContent || ""
        ).trim() +
        " | active=" +
        [...document.querySelectorAll("[data-tool-id].active")].map((n) =>
          n.getAttribute("data-tool-id"),
        ),
    );

  await click("line");
  await page.waitForTimeout(250);

  const box = await page.locator(".drawing-canvas").boundingBox();
  const at = async (x, y) => ({
    page,
    x: box.x + x,
    y: box.y + y,
  });

  const before = await status();

  const p = await at(620, 400);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterOneClick = await status();

  /* Second press+release at the same place: if the first was a first point, this commits a zero-length line. */
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterTwoClicks = await status();

  /* Programmatic pointer events, in case Playwright's click synthesises a different sequence. */
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector(".drawing-canvas");

      const fire = (type) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            pointerId: 7,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );

      fire("pointerdown");
      fire("pointerup");
      canvas.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    },
    { x: p.x, y: p.y },
  );

  await page.waitForTimeout(400);
  const afterSynthetic = await status();

  return { before, afterOneClick, afterTwoClicks, afterSynthetic };
}
