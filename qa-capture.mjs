export default async function run(page) {
  const captured = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/render-tikz")) return;
    let body = "<unreadable>";
    try {
      const text = await res.text();
      const j = JSON.parse(text);
      body = { success: j.success, error: j.error, svg: String(j.svg || "").slice(0, 160), log: String(j.log || "").slice(-900) };
    } catch { body = "<non-json>"; }
    captured.push({ status: res.status(), body, sent: res.request().postData()?.slice(0, 700) });
  });

  await page.evaluate(() => document.querySelector('.tab[data-tab="writing"]')?.click());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const editor = document.getElementById("solutionEditor");
    editor.value = "Text.\n"; editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.setSelectionRange(editor.value.length, editor.value.length);
    document.getElementById("solutionEnterDrawing")?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll(".engg-dialog button")].find(b => b.textContent.trim() === "Draw a new figure")?.click());
  await page.waitForTimeout(3000);
  return { captured };
}
