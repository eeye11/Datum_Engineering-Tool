/*
 * What is actually in the workspace's first row right now?
 * Lists every element with its text, so "the old menu bar" can be identified
 * rather than assumed.
 */
export default async function run(page) {
  await page.getByText("Engineering Drawing", { exact: true }).click();
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };

    const row = document.querySelector(".drawing-menu-row");

    const describe = (el) =>
      [...el.children].map((child) => ({
        tag: child.tagName,
        cls: String(child.className || "").slice(0, 60),
        id: child.id || null,
        text: (child.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90),
        box: box(child),
      }));

    return {
      menuRowChildren: row ? describe(row) : null,
      workspaceChildren: [
        ...document.querySelectorAll(".drawing-workspace > *"),
      ].map((c) => ({
        cls: String(c.className || "").slice(0, 50),
        id: c.id || null,
        text: (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
        box: box(c),
      })),
    };
  });
}
