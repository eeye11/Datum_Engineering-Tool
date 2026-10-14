export default async function run(page) {
  const tab = page.getByText("Engineering Drawing", { exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(1000);
  }
  await page.waitForSelector(".drawing-canvas", {
    state: "visible",
    timeout: 15000,
  });

  return await page.evaluate(async () => {
    const popup = await import("/src/ui/editors/load-value-popup.js");

    const seen = [];

    popup.openLoadValuePopup({
      title: "Probe",
      label: "Value",
      value: "100",
      units: ["mm", "cm"],
      onPreview: (draft) => {
        seen.push(JSON.parse(JSON.stringify(draft)));
      },
      onConfirm: () => {},
    });

    const input = document.querySelector("[data-load-input]");

    input.value = "250";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 80));

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    return { previewCalls: seen, inputFound: !!input };
  });
}
