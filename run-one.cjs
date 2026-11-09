const { execSync } = require("child_process");
const out = execSync("node --test tests/fluids-schematic-tools.test.cjs", {
  encoding: "utf8",
  cwd: process.cwd(),
});
console.log(out);
