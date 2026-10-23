const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const j = require(locate("model/fluids/junction.js")).default;

/* Main run runs west (-1, 0). The branch points north (0, 1). */
const main = { x: -1, y: 0 };
const north = { x: 0, y: 1 };
const east = { x: 1, y: 0 };

console.log("signed(main->north)", j.signedAngleBetween(main, north));
console.log("signed(main->east)", j.signedAngleBetween(main, east));
console.log("branchAngleFrom(main, north)", j.branchAngleFrom(main, north));

/* Which arm is "main" in defaultBranchSet? */
const set = j.constructor; // unused
const branchSet = [
  { id: "a", direction: { x: -main.x, y: -main.y }, main: true, angle: 0 },
  { id: "b", direction: { x: main.x, y: main.y }, angle: 180 },
  { id: "c", direction: north, angle: 90 },
  { id: "d", direction: { x: 0, y: -1 }, angle: 270 },
];
console.log("branch set a direction", branchSet[0].direction);
