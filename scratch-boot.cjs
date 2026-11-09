const { bootApp } = require("./tests/helpers/boot-app.cjs");

const page = bootApp();

console.log(
  "boot error:",
  page.error ? String(page.error && page.error.stack).slice(0, 1500) : "none",
);
process.exit(0);
