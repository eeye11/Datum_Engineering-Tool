global.window = {};
require("./js/engineering-drawing/load-profile.js");
const p = global.window.enggLoadProfile;

const build = (interval) => ({
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  intensity: 0,
  direction: -90,
  interval,
  points: [
    { t: 0, magnitude: 0 },
    { t: 0.37, magnitude: 10 },
    { t: 1, magnitude: 0 },
  ],
});

const at = (samples, t) => samples.some((s) => Math.abs(s.t - t) < 1e-6);

console.log("=== Requirement scenario: defined points 0 / 37 / 100 ===\n");

for (const interval of [20, 60, 7, 45, 3]) {
  const s = p.arrowSamples(build(interval));
  const shown = s
    .map((x) => Number(x.t.toFixed(4)).toString().padStart(6))
    .join(" ");
  console.log(`interval ${String(interval).padStart(3)} -> ${shown}`);
  console.log(
    `   arrow at 0: ${String(at(s, 0)).padEnd(5)}` +
      `  at 37: ${String(at(s, 0.37)).padEnd(5)}` +
      `  at 100: ${String(at(s, 1)).padEnd(5)}` +
      `  substituted for 40: ${at(s, 0.4) && interval === 20 ? "yes" : "no"}`,
  );
  console.log(
    `   intermediates 0-37: ${s.filter((x) => x.t > 0 && x.t < 0.37).length}` +
      `   intermediates 37-100: ${s.filter((x) => x.t > 0.37 && x.t < 1).length}`,
  );
}

console.log(
  "\n=== Duplicated positions: each defined point still gets an arrow ===",
);
const dup = {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  interval: 20,
  direction: -90,
  points: [
    { t: 0, magnitude: 5 },
    { t: 0.5, magnitude: 8 },
    { t: 0.5, magnitude: 3 },
    { t: 1, magnitude: 5 },
  ],
};
const ds = p.arrowSamples(dup);
console.log(
  "  arrows at 0.5:",
  ds.filter((x) => Math.abs(x.t - 0.5) < 1e-6).length,
  "(expected 2)",
);
console.log(
  "  magnitudes:",
  ds.filter((x) => Math.abs(x.t - 0.5) < 1e-6).map((x) => x.magnitude),
);

console.log(
  "\n=== Constant Distributed Load: uniform, unchanged rendering ===",
);
const uniform = {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  intensity: 4,
  direction: -90,
  interval: 20,
};
const us = p.arrowSamples(uniform);
console.log("  sample count:", us.length, "(expected 6: 0,20,40,60,80,100)");
console.log("  t:", us.map((x) => Number((x.t * 100).toFixed(1))).join(" "));
console.log(
  "  all magnitudes equal:",
  us.every((x) => x.magnitude === 4),
);
