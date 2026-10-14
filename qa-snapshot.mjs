export default async function run(page, ui) {
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(800);
  const snap = await ui.snapshot();
  return {
    snap: snap
      .split("\n")
      .filter((l) => /fluid|pipe|tool|category|discipline/i.test(l))
      .slice(0, 60),
    all: snap.split("\n").slice(0, 120),
  };
}
