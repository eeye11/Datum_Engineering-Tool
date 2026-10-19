/* One-off: list TikZ-related files inside node-tikzjax's bundled tex_files.tar.gz. */
const tar = require("tar-fs");
const fs = require("fs");
const zlib = require("zlib");

const p = require.resolve("node-tikzjax/package.json");
const dir = require("path").join(p, "..", "tex", "tex_files.tar.gz");
const list = [];

fs.createReadStream(dir)
  .pipe(zlib.createGunzip())
  .pipe(
    tar.extract("scripts/.tmp-tex-list", {
      read: () => "",
      ignore: () => true,
    }),
  )
  .on("entry", (h, s, next) => {
    list.push(h.name);
    next();
  })
  .on("finish", () => {
    const relevant = list.filter((n) =>
      /tikz|pgf|standalone|arrows|calc/i.test(n),
    );
    console.log("total files:", list.length);
    console.log(relevant.join("\n") || "(no tikz matches)");
  })
  .on("error", (e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  });
