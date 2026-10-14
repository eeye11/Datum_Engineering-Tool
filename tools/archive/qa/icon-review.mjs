/*
 * Draw ONLY the thickness and colour icons, large, on a plain surface - so the
 * shapes can be judged without the toolbar around them.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const thickness = document.getElementById("drawingThicknessPreview");
    const colourIcon = document
      .querySelector(".drawing-strip-colour")
      ?.querySelector(".drawing-strip-icon svg");

    const host = document.createElement("div");
    host.id = "icon-review";
    host.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:99999",
      "background:#ffffff",
      "display:flex",
      "gap:40px",
      "align-items:center",
      "justify-content:center",
    ].join(";");

    const pane = (label, svg, colour) => {
      const box = document.createElement("div");
      box.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:18px;color:#1F2937;font:14px sans-serif;";
      const cell = document.createElement("div");
      cell.style.cssText = [
        "width:120px",
        "height:120px",
        "border:1px solid #DCE4E8",
        "border-radius:6px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        colour ? `background:${colour}` : "background:#fff",
      ].join(";");
      const big = svg.cloneNode(true);
      big.setAttribute("width", "84");
      big.setAttribute("height", "84");
      big.style.filter = colour
        ? "drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff)"
        : "";
      cell.appendChild(big);
      box.appendChild(cell);
      const cap = document.createElement("div");
      cap.textContent = label;
      box.appendChild(cap);
      return box;
    };

    host.appendChild(pane("line thickness", thickness.querySelector("svg")));
    host.appendChild(pane("colour (on #000)", colourIcon, "#000000"));
    host.appendChild(pane("colour (on #fff)", colourIcon, "#ffffff"));

    document.body.appendChild(host);
  });

  await page.waitForTimeout(300);
  return { ok: true };
}
