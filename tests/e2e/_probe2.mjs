export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).first().click();
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("*")].filter(
      (n) =>
        n.getAttribute("data-tool-id") ||
        n.className?.toString?.().includes?.("drawing-tool"),
    );

    return {
      count: nodes.length,
      kinds: nodes
        .slice(0, 40)
        .map(
          (n) =>
            `${n.tagName} class=${n.className} tool=${n.getAttribute("data-tool-id")} text=${(n.textContent || "").trim().slice(0, 16)}`,
        ),
      toolList: document
        .querySelector("#drawingToolList")
        ?.innerHTML?.slice(0, 400),
    };
  });
}
