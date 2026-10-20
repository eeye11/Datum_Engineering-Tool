let lastStart = null;
let lastEnd = null;
let samples = [];

global.window = global.window || {};
global.document = global.document || {};

const drag = require("./helpers/source-path.cjs").modulePath(
  "creation-drag.js",
);
console.log("creation-drag:", drag);
