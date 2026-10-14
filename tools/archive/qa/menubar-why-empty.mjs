/*
 * Why is the menu bar empty? Ask the app directly.
 */
export default async function run(page) {
  return await page.evaluate(async () => {
    const out = {};

    /* Can the module be imported and its menus built? */
    try {
      const mod = await import("/src/editor/menu-commands.js");
      out.menusExist = Array.isArray(mod.MENUS);
      out.menusLength = mod.MENUS ? mod.MENUS.length : null;

      if (mod.MENUS) {
        const built = mod.MENUS.map((m) => {
          try {
            const def = m();
            return { ok: true, id: def.id, label: def.label };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        });
        out.built = built;
      }
    } catch (error) {
      out.importError = String(error);
    }

    /* Any recorded failures? */
    try {
      const log = await import("/src/app/error-log.js");
      out.logKeys = Object.keys(log.default || log);
    } catch (error) {
      out.logError = String(error);
    }

    return out;
  });
}
