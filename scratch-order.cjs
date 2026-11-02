const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;

const radians = (30 * Math.PI) / 180;
const far = { x: 100 + 120 * Math.cos(radians), y: 120 * Math.sin(radians) };

function build() {
  const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = pipe.createPipeDuct(far, { x: 100, y: 0 });
  return { a, b };
}

[
  ["a,b", (x) => [x.a, x.b]],
  ["b,a", (x) => [x.b, x.a]],
].forEach(([label, order]) => {
  const pair = build();
  const [first, second] = order(pair);

  const made = tool.generateElbowFor(
    first,
    second,
    pipe.defaultPipeEngineering(),
  );

  console.log(
    label,
    "->",
    JSON.stringify(made.geometry),
    "ports:",
    JSON.stringify(made.engineering.ports),
  );
});

process.exit(0);
