const { bootApp } = require("./tests/helpers/boot-app.cjs");

bootApp();

(async () => {
  const junction =
    await import("./src/features/workspace/model/fluids/junction.js");
  const j = junction.default;

  const created = j.createJunction({
    position: { x: 0, y: 0 },
    branches: [
      { direction: { x: -1, y: 0 }, main: true, width: 4 },
      { direction: { x: 1, y: 0 }, width: 4 },
      { direction: { x: 0, y: 1 }, width: 4 },
    ],
    engineering: { separation: 0 },
  });

  console.log("type", created.type, "id", created.id, "name", created.name);
  console.log("branches", JSON.stringify(created.geometry.branches, null, 1));
  console.log("ports", JSON.stringify(j.branchPorts(created)));

  const outline = j.junctionOutline(created);
  console.log("outline point count", outline.length);
  console.log("first few", JSON.stringify(outline.slice(0, 3)));

  /* The contour must close without a wild excursion. */
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  console.log(
    "extent",
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  );

  console.log("stub", j.stubLength(created, created.geometry.branches[0]));
  console.log(
    "angle of branch b",
    j.branchAngleFrom(
      created.geometry.mainDirection,
      created.geometry.branches[1].direction,
    ),
  );

  /* Width mixture. */
  created.geometry.branches[2].width = 14;
  const wide = j.junctionOutline(created);
  console.log("wide outline count", wide.length);

  /* Angle edit + collision refusal. */
  console.log("set c to 45:", j.setBranchAngle(created, "c", 45));
  console.log("set c onto b (0):", j.setBranchAngle(created, "c", 180));

  process.exit(0);
})();
