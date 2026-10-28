import { createRequire } from "module";
const require = createRequire(import.meta.url);

const model = require("./tests/harness-renderer.cjs");

console.log("harness loaded:", Boolean(model));
