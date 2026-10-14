import { makeHelpers } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = {};
  const h = await makeHelpers(page);
  await h.category("STATICS");

  await h.tool("body");
  await h.sub("Beam");
  await h.click(0.2, 0.4);
  await h.click(0.8, 0.4);
  await page.waitForTimeout(600);
  out.afterBeam = (await h.allObjects()).map((o) => o.type + " " + o.id);

  await h.tool("support");
  await h.sub("Pin Support");
  out.afterArm = { tool: (await h.state())?.tool, msg: await h.msg() };

  await h.click(0.5, 0.4);
  out.afterClick1 = {
    phase: (await h.state())?.phase,
    msg: await h.msg(),
    objects: (await h.allObjects()).map((o) => o.type),
  };

  await h.click(0.5, 0.45);
  await page.waitForTimeout(500);
  out.afterClick2 = {
    phase: (await h.state())?.phase,
    msg: await h.msg(),
    objects: (await h.allObjects()).map(
      (o) => o.type + " parent=" + (o.parentId || "none"),
    ),
  };

  return out;
}
