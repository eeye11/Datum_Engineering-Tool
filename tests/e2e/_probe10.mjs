export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  return await page.evaluate(async () => {
    window.__CD_TRACE = [];

    const mod =
      await import("/src/features/workspace/interaction/canvas-events.js");

    [...document.querySelectorAll("[data-tool-id]")]
      .find((n) => n.getAttribute("data-tool-id") === "line")
      ?.click();

    await new Promise((r) => setTimeout(r, 300));

    const canvas = document.querySelector(".drawing-canvas");
    const b = canvas.getBoundingClientRect();

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: b.x + 620,
        clientY: b.y + 400,
        button: 0,
        buttons: 1,
        pointerId: 11,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );

    const afterDown = window.__CD_TRACE.join(" / ");

    await new Promise((r) => setTimeout(r, 200));

    return { afterDown, exports: Object.keys(mod) };
  });
}
