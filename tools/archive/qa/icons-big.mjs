/*
 * Render the thickness and line-type icons big, on the button surface, next to
 * what the dropdown would look like - so both the icon and the dropdown
 * formatting can be judged.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const thickness = document.getElementById("drawingThicknessPreview");
    const lineType = document.getElementById("drawingLineTypePreview");

    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#F8FAFC;display:flex;gap:36px;align-items:center;justify-content:center;font:13px 'Segoe UI',sans-serif;color:#1F2937";

    const pane = (label, node) => {
      const box = document.createElement("div");
      box.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:14px";

      const cell = document.createElement("div");
      cell.style.cssText =
        "width:104px;height:104px;border:1px solid #C7D2D9;border-radius:6px;display:flex;align-items:center;justify-content:center;background:#fff;color:#1F2937";

      const big = node.cloneNode(true);
      big.removeAttribute("id");
      big.setAttribute("style", "background:transparent;border:0");
      const svg = big.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "72");
        svg.setAttribute("height", "72");
      }
      cell.appendChild(big);
      box.appendChild(cell);

      const cap = document.createElement("div");
      cap.textContent = label;
      box.appendChild(cap);
      return box;
    };

    host.appendChild(pane("line thickness", thickness));
    host.appendChild(pane("line type", lineType));

    document.body.appendChild(host);
  });

  await page.waitForTimeout(250);
  return { ok: true };
}
