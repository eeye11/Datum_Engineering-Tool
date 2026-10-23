/* eslint-disable no-console */
/*
 * ========================================================
 * FLUIDS ICONS AND PER-OBJECT VISIBILITY
 * ========================================================
 *
 * Two things the Objects tab owes the student:
 *
 *   1. a row whose icon says what the object IS - the icon of the tool that
 *      drew it, not a neutral mark shared by every Fluids object;
 *   2. an eye at the far right of every row that hides and shows that ONE
 *      object, without deleting it, disconnecting it or disturbing its
 *      neighbours.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

async function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }

    const canvas = page.document.querySelector(".drawing-canvas");

    if (canvas) {
      canvas.getBoundingClientRect = () => ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
      });
    }

    await whenReady();
  }

  return page;
}

const locate = (name) => require("./helpers/source-path.cjs").locate(name);

function modules() {
  return {
    schema: require(locate("feature-schema.js")),
    tools: require(locate("tools.js")),
    list: require(locate("objects-list.js")),
    sync: require(locate("source-synchronization.js")),
    hit: require(locate("hit-testing.js")),
    state: require(locate("editor-state.js")).drawingState,
    ds: require(locate("drawing-state.js")).default,
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
  };
}

const GENERIC = "M10 3l7 4v6l-7 4-7-4V7z";

/* ============================================================
 * 1. ICONS
 * ============================================================ */

const FLUIDS_ICONS = [
  ["pipe-duct", "Pipe / Duct"],
  ["elbow", "Elbow"],
  ["junction", "Junction"],
  ["reducer-expander", "Reducer / Expander"],
  ["reservoir-tank", "Reservoir / Tank"],
  ["pump", "Pump"],
  ["valve", "Valve"],
  ["flow-meter", "Flow Meter"],
  ["flow-arrow", "Flow Arrow"],
  ["fluid-level", "Fluid Level"],
  ["pressure-tap", "Pressure Tap"],
  ["flow-direction-diagram", "Flow Direction Diagram"],
  ["pressure-profile", "Pressure Profile"],
  ["section-plane", "Section Plane"],
];

test("every Fluids object type shows its own tool's icon", async () => {
  await ready();

  const { schema, tools } = modules();

  FLUIDS_ICONS.forEach(([type, label]) => {
    const icon = schema.iconForObject({ type });

    assert.ok(icon, `${type} has no icon`);
    assert.ok(
      !icon.includes(GENERIC),
      `${type} fell back to the generic object mark`,
    );
    assert.equal(
      icon,
      tools.toolIcons[label],
      `${type} must use the ${label} tool icon`,
    );
  });
});

test("the shared reference types use the same artwork Statics uses", async () => {
  await ready();

  const { schema, tools } = modules();

  assert.equal(
    schema.iconForObject({ type: "coordinate-system-2d" }),
    tools.toolIcons["Coordinate System"],
  );
  assert.equal(schema.iconForObject({ type: "point" }), tools.toolIcons.Point);
  assert.equal(schema.iconForObject({ type: "line" }), tools.toolIcons.Line);
});

test("no two Fluids types share an icon, and none is generic", async () => {
  await ready();

  const { schema } = modules();
  const icons = FLUIDS_ICONS.map(([type]) => schema.iconForObject({ type }));

  assert.equal(
    new Set(icons).size,
    icons.length,
    "each Fluids type needs its own artwork",
  );
});

test("an automatically generated Elbow shows the Elbow icon", async () => {
  await ready();

  const { schema, tools, state, tool } = modules();

  state.objects = [];

  const first = tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = tool.commitRouteSegment(
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    {
      previousRun: first.run,
      routeCommittedCount: 1,
    },
  );

  assert.ok(second.elbow, "a 90 degree corner must generate an elbow");
  assert.equal(schema.iconForObject(second.elbow), tools.toolIcons.Elbow);
});

test("a manually drawn elbow and an automatic one use the same icon", async () => {
  await ready();

  const { schema, state, tool } = modules();

  state.objects = [];

  const first = tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = tool.commitRouteSegment(
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    {
      previousRun: first.run,
      routeCommittedCount: 1,
    },
  );

  const manual = { type: "elbow", name: "Elbow 9" };

  assert.equal(
    schema.iconForObject(second.elbow),
    schema.iconForObject(manual),
  );
});

test("non-Fluids icons are unchanged", async () => {
  await ready();

  const { schema, tools } = modules();

  [
    ["line", "Line"],
    ["beam", "Beam"],
    ["force", "Point Force"],
    ["dimension", "Dimension"],
  ].forEach(([type, label]) => {
    assert.equal(
      schema.iconForObject({ type }),
      tools.toolIcons[label],
      `${type} icon changed`,
    );
  });
});

/* ============================================================
 * 2. THE VISIBILITY BUTTON
 * ============================================================ */

test("every row has a visibility button at the far right", async () => {
  await ready();

  const { state, list } = modules();

  state.objects = [
    { id: "a", type: "pipe-duct", name: "Pipe / Duct 1" },
    { id: "b", type: "pump", name: "Pump 1" },
  ];

  const markup = list.objectsListMarkup(state.objects, []);

  assert.equal((markup.match(/data-visibility-for=/g) || []).length, 2);

  /* The button is the row's LAST child, after the icon and the name. */
  const rows = [...markup.matchAll(/<li[\s\S]*?<\/li>/g)].map(
    (match) => match[0],
  );

  rows.forEach((row) => {
    assert.ok(
      /<button[^>]*data-visibility-for[^>]*>[\s\S]*<\/button>\s*<\/li>$/.test(
        row,
      ),
      "the eye must be the last thing in the row",
    );
  });
});

test("a visible object shows the eye, a hidden one the eye-off", async () => {
  await ready();

  const { state, list } = modules();

  state.objects = [
    { id: "a", type: "pipe-duct", name: "Pipe / Duct 1" },
    { id: "b", type: "valve", name: "Valve 1", visible: false },
  ];

  const markup = list.objectsListMarkup(state.objects, []);

  assert.ok(/data-visibility-for="a"[^>]*data-visible="true"/.test(markup));
  assert.ok(/data-visibility-for="b"[^>]*data-visible="false"/.test(markup));

  /* The eye-off artwork is the eye with the slash. */
  const hiddenRow = markup.slice(markup.indexOf('data-visibility-for="b"'));

  assert.ok(
    /M4 4l12 12/.test(hiddenRow),
    "the hidden row must show the eye-off icon",
  );
});

test("the accessible label names the object and the action", async () => {
  await ready();

  const { state, list } = modules();

  state.objects = [{ id: "a", type: "pipe-duct", name: "Pipe / Duct 1" }];

  const visible = list.objectsListMarkup(state.objects, []);

  assert.ok(/aria-label="Hide Pipe \/ Duct 1"/.test(visible), visible);
  assert.ok(/title="Hide Pipe \/ Duct 1"/.test(visible));

  state.objects[0].visible = false;

  const hidden = list.objectsListMarkup(state.objects, []);

  assert.ok(/aria-label="Show Pipe \/ Duct 1"/.test(hidden), hidden);
});

test("every object type gets the button, not only Fluids ones", async () => {
  await ready();

  const { state, list } = modules();

  state.objects = [
    { id: "l", type: "line", name: "Line 1" },
    { id: "e", type: "elbow", name: "Elbow 1" },
    { id: "b", type: "beam", name: "Beam 1" },
  ];

  const markup = list.objectsListMarkup(state.objects, []);

  ["l", "e", "b"].forEach((id) => {
    assert.ok(
      markup.includes(`data-visibility-for="${id}"`),
      `${id} has no eye`,
    );
  });
});

/* ============================================================
 * 3. TOGGLING
 * ============================================================ */

function twoRunSystem() {
  const m = modules();

  m.state.objects = [];

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment(
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    {
      previousRun: first.run,
      routeCommittedCount: 1,
    },
  );

  return { ...m, first: first.run, second: second.run, elbow: second.elbow };
}

test("the toggle hides and restores exactly one object", async () => {
  await ready();

  const { state, ds, first, elbow } = twoRunSystem();

  assert.equal(ds.toggleObjectVisible(state, elbow.id), true);
  assert.equal(elbow.visible, false);
  assert.equal(
    first.visible !== false,
    true,
    "the connected pipe must stay visible",
  );

  assert.equal(ds.toggleObjectVisible(state, elbow.id), true);
  assert.equal(elbow.visible, true);
});

test("hiding keeps the object, its id, geometry and connections", async () => {
  await ready();

  const { state, ds, elbow } = twoRunSystem();

  const id = elbow.id;
  const geometry = JSON.stringify(elbow.geometry);
  const connections = JSON.stringify(elbow.engineering.connections);

  ds.toggleObjectVisible(state, id);

  const stored = state.objects.find((object) => object.id === id);

  assert.ok(stored, "a hidden object must remain in the model");
  assert.equal(stored.id, id, "the stable id must not change");
  assert.equal(
    JSON.stringify(stored.geometry),
    geometry,
    "its geometry must not change",
  );
  assert.equal(JSON.stringify(stored.engineering.connections), connections);
});

test("hiding is not a deletion and does not cascade to connected objects", async () => {
  await ready();

  const { state, ds, elbow } = twoRunSystem();

  const before = state.objects.length;

  ds.toggleObjectVisible(state, elbow.id);

  assert.equal(state.objects.length, before, "nothing may be deleted");
  assert.equal(
    state.objects
      .filter((object) => object.type === "pipe-duct")
      .every((object) => object.visible !== false),
    true,
    "the connected pipes must stay visible",
  );
});

test("a fixed object can still be hidden and shown", async () => {
  await ready();

  const { state, ds, elbow } = twoRunSystem();

  elbow.locked = true;

  assert.equal(ds.toggleObjectVisible(state, elbow.id), true);
  assert.equal(elbow.visible, false);

  assert.equal(ds.toggleObjectVisible(state, elbow.id), true);
  assert.equal(elbow.visible, true);
});

test("toggling twice is one round trip and an unknown id changes nothing", async () => {
  await ready();

  const { state, ds, elbow } = twoRunSystem();

  assert.equal(ds.toggleObjectVisible(state, "not-an-object"), false);
  assert.equal(
    ds.setObjectVisible(state, elbow.id, true),
    false,
    "an already-visible object is not a change",
  );
});

/* ============================================================
 * 4. THE CANVAS AND THE SOURCE
 * ============================================================ */

test("a hidden object cannot be picked on the canvas", async () => {
  await ready();

  const { state, ds, hit, elbow } = twoRunSystem();

  assert.equal(
    hit.objectAtPoint({ x: 100, y: 0 })?.id,
    elbow.id,
    "the elbow is pickable while visible",
  );

  ds.toggleObjectVisible(state, elbow.id);

  assert.notEqual(
    hit.objectAtPoint({ x: 100, y: 0 })?.id,
    elbow.id,
    "a hidden object must not be picked",
  );
});

test("a hidden object is left out of the compiled picture", async () => {
  await ready();

  const { ds, sync, elbow, first } = twoRunSystem();

  assert.ok(
    sync.sourceForObject(elbow),
    "the elbow writes source while visible",
  );

  ds.toggleObjectVisible(elbow.id);

  assert.equal(
    sync.sourceForObject(elbow),
    null,
    "a hidden object must not be drawn",
  );
  assert.ok(
    sync.sourceForObject(first),
    "the visible pipes must still be written",
  );

  ds.toggleObjectVisible(elbow.id);

  assert.ok(sync.sourceForObject(elbow), "showing it again restores the block");
});

test("visibility survives a tab change because it lives in the model", async () => {
  await ready();

  const { state, ds, list, elbow } = twoRunSystem();

  ds.toggleObjectVisible(state, elbow.id);

  /* A re-render of the list reads the model, not a UI copy. */
  const markup = list.objectsListMarkup(state.objects, []);

  assert.ok(
    new RegExp(
      `data-visibility-for="${elbow.id}"[^>]*data-visible="false"`,
    ).test(markup),
  );
  assert.equal(
    list
      .objectsListMarkup(state.objects, [])
      .includes("drawing-objects-item-hidden"),
    true,
  );
});

test("hiding does not add a Visibility section to the Features tab", async () => {
  await ready();

  const { schema, elbow } = twoRunSystem();

  const headings = schema.groupsFor(elbow).map((group) => group.heading);

  assert.ok(!headings.includes("Visibility"), headings.join(", "));
});
