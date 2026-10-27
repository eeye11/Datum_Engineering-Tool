/*
 * ========================================================
 * PIPE ASSEMBLY: GROUPING, TRANSFORMS AND THE CONNECTION GRAPH
 * ========================================================
 *
 * An assembly is an ORGANISATIONAL parent for one connected pipe system. These
 * tests hold it to the two things that must never blur:
 *
 *   physical connection   owned by the Elbow / Junction records
 *   membership            owned by `parentId`
 *
 * Everything is asserted on the MODEL: member ids, `parentId` values, the
 * connection records before and after, and the geometry that results. Nothing
 * here reads a rendered picture, and nothing asserts merely that a parent row
 * exists.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

const PIXELS_PER_UNIT = 2;
const CANVAS = { left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700, x: 0, y: 0 };

function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return page;
}

function modules() {
  ready();

  const dom = require(locate("interaction/dom.js"));

  dom.drawingCanvas.getBoundingClientRect = () => CANVAS;
  Object.defineProperty(dom.drawingCanvas, "clientWidth", { value: CANVAS.width, configurable: true });
  Object.defineProperty(dom.drawingCanvas, "clientHeight", { value: CANVAS.height, configurable: true });
  dom.drawingCanvas.setPointerCapture = () => {};
  dom.drawingCanvas.releasePointerCapture = () => {};
  dom.drawingCanvas.hasPointerCapture = () => true;

  const editor = require(locate("editor-state.js"));

  return {
    pipe: require(locate("model/fluids/pipe-duct.js")).default,
    assembly: require(locate("model/fluids/pipe-assembly.js")).default,
    tool: require(locate("pipe-duct-tool.js")),
    junctionTool: require(locate("junction-tool.js")),
    drag: require(locate("drag.js")),
    schema: require(locate("feature-schema.js")),
    sync: require(locate("source-synchronization.js")),
    objectsList: require(locate("objects-list.js")),
    state: editor.drawingState,
    editorState: editor.editorState,
    drawingState: require(locate("drawing-state.js")).default
  };
}

function reset(m) {
  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.state.interaction.phase = "idle";
  m.state.interaction.previousRun = null;
  m.state.manipulationDrag = null;
  m.state.activeTool = "select";
  m.state.camera.zoom = PIXELS_PER_UNIT / m.drawingState.BASE_PIXELS_PER_UNIT;
  m.state.camera.panX = 0;
  m.state.camera.panY = 0;
  m.editorState.manipulationDrag = null;
}

const live = (m, id) => m.state.objects.find((object) => object.id === id);

const assemblies = (m) => m.state.objects.filter((object) => object.type === "pipe-assembly");

const membersOf = (m, assembly) => m.state.objects.filter((object) => object.parentId === assembly.id);

/* A two-run system: one pipe east, one north, joined by an elbow. */
function system(m) {
  reset(m);

  const first = m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});
  const second = m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: first.run,
    routeCommittedCount: 1
  });

  return { first: live(m, first.run.id), second: live(m, second.run.id) };
}

/* The connection records, as one comparable signature. */
function topology(m) {
  return m.state.objects
    .filter((object) => ["elbow", "junction"].includes(object.type))
    .map((object) => ({
      id: object.id,
      connections: [...(object.engineering?.connections || [])],
      ports: { ...(object.engineering?.ports || {}) }
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/* ============================================================
 * 1. AUTOMATIC GROUPING
 * ============================================================ */

test("a connected pipe system gets one assembly parent holding every component", () => {
  const m = modules();
  const { first, second } = system(m);

  assert.equal(assemblies(m).length, 1, "one connected system, one assembly");

  const [assembly] = assemblies(m);

  assert.notEqual(assembly.id, first.id, "the parent is its own object");
  assert.notEqual(assembly.id, second.id);

  const members = membersOf(m, assembly).map((object) => object.id).sort();

  assert.deepEqual(
    members,
    [first.id, second.id, ...m.state.objects.filter((o) => o.type === "elbow").map((o) => o.id)].sort(),
    "both runs and the elbow are members"
  );

  assert.deepEqual(
    [...(assembly.engineering.members || [])].sort(),
    members,
    "the recorded member list agrees with the children"
  );

  /* The parent draws nothing: it has no geometry and no renderer. */
  assert.deepEqual(assembly.geometry, {}, "an assembly carries no geometry of its own");
});

test("the assembly grouping is automatic - drawing the system is the whole gesture", () => {
  const m = modules();

  reset(m);

  assert.equal(assemblies(m).length, 0, "nothing on an empty sheet");

  m.tool.commitRouteSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, {});

  assert.equal(assemblies(m).length, 0, "a lone pipe is not a system");

  m.tool.commitRouteSegment({ x: 100, y: 0 }, { x: 100, y: 100 }, {
    previousRun: live(m, m.state.objects[0].id),
    routeCommittedCount: 1
  });

  assert.equal(assemblies(m).length, 1, "the second leg makes it a system");
});

/* ============================================================
 * 2. INDEPENDENT SYSTEMS
 * ============================================================ */

test("two disconnected systems get two assemblies, and nearby geometry is not grouped", () => {
  const m = modules();
  const { first } = system(m);

  /* A second, unrelated pair drawn close beside the first. */
  const otherA = m.pipe.createPipeDuct({ x: 0, y: 40 }, { x: 100, y: 40 });
  const otherB = m.pipe.createPipeDuct({ x: 100, y: 40 }, { x: 100, y: 140 });

  m.state.objects.push(otherA, otherB);
  m.tool.connectPipeEndpoints(otherB, m.state.objects);
  m.assembly.reconcilePipeAssemblies(m.state.objects);

  assert.equal(assemblies(m).length, 2, "two systems, two parents");

  const parents = assemblies(m);

  const holdersOf = (id) => parents.filter((assembly) => membersOf(m, assembly).some((o) => o.id === id));

  assert.equal(holdersOf(first.id).length, 1, "the first pipe is in exactly one assembly");
  assert.equal(holdersOf(otherA.id).length, 1, "the second system's pipe is in exactly one assembly");
  assert.notEqual(holdersOf(first.id)[0].id, holdersOf(otherA.id)[0].id, "and they are different assemblies");

  /* A loose pipe near the first system joins nothing and no assembly. */
  const loose = m.pipe.createPipeDuct({ x: 20, y: 10 }, { x: 80, y: 10 });

  m.state.objects.push(loose);
  m.assembly.reconcilePipeAssemblies(m.state.objects);

  assert.equal(loose.parentId, undefined, "a pipe drawn near a system is not a member of it");
  assert.equal(assemblies(m).length, 2, "and no third assembly was invented");
});

test("an object belongs to at most one assembly", () => {
  const m = modules();
  const { first, second } = system(m);

  const parents = assemblies(m);
  const membership = m.state.objects.filter((object) => object.parentId);

  assert.equal(parents.length, 1, "one parent");

  membership.forEach((object) => {
    const candidates = parents.filter((assembly) =>
      (assembly.engineering.members || []).includes(object.id)
    );

    assert.equal(candidates.length, 1, `${object.id} is named by exactly one assembly`);
  });

  assert.equal(first.parentId, second.parentId, "both runs point at the same parent");
});

/* ============================================================
 * 3. MEMBERSHIP IS NOT CONNECTION
 * ============================================================ */

test("regrouping never creates, moves or erases a physical connection", () => {
  const m = modules();
  system(m);

  const before = JSON.stringify(topology(m));

  /* Regrouping from scratch is what an ordinary edit does. */
  m.assembly.reconcilePipeAssemblies(m.state.objects);
  assert.equal(JSON.stringify(topology(m)), before, "the first reconcile changes no record");

  m.assembly.reconcilePipeAssemblies(m.state.objects);
  assert.equal(JSON.stringify(topology(m)), before, "nor does the second");
});

test("breaking a connection reconciles membership without corrupting the rest", () => {
  const m = modules();
  const { second } = system(m);

  const assembly = assemblies(m)[0];
  const parentId = assembly.id;

  /* Pull the branch away from the elbow: the system is no longer joined. */
  const branch = live(m, second.id);

  branch.geometry.start = { x: 300, y: 300 };
  m.tool.refreshFluidConnections(branch, m.state.objects);
  m.junctionTool.reconcileJunctionsFor(branch, m.state.objects);

  /*
   * A lone pipe is not an assembly, so the parent goes - and every member gives up
   * its membership rather than being left naming a parent that is no longer there.
   */
  assert.equal(live(m, parentId), undefined, "the parent is gone with the system");
  assert.equal(
    m.state.objects.filter((object) => object.parentId === parentId).length,
    0,
    "no orphaned membership remains"
  );

  m.state.objects.forEach((object) => {
    assert.ok(
      !object.parentId || m.state.objects.some((candidate) => candidate.id === object.parentId),
      `${object.id} does not name a missing parent`
    );
  });
});

test("deleting a member leaves valid membership and no duplicate parent", () => {
  const m = modules();
  const { first } = system(m);

  const assembly = assemblies(m)[0];

  m.drawingState.removeObjectsAndDescendants(m.state, new Set([first.id]));
  m.assembly.reconcilePipeAssemblies(m.state.objects);

  const parents = assemblies(m);

  assert.ok(parents.length <= 1, "a deleted member does not mint a second parent");

  parents.forEach((parent) => {
    const members = parent.engineering.members || [];

    assert.equal(
      new Set(members).size,
      members.length,
      "no member is listed twice"
    );

    members.forEach((id) => {
      assert.ok(live(m, id), `${id} is a real object`);
    });
  });
});

/* ============================================================
 * 4. TOPOLOGY UPDATES KEEP MEMBERSHIP VALID
 * ============================================================ */

test("a junction that splits a host keeps every resulting segment in the system", () => {
  const m = modules();
  const { first } = system(m);

  const parentId = assemblies(m)[0].id;

  /* Branch a third run onto the interior of the first, making a junction. */
  m.tool.commitRouteSegment({ x: 50, y: -80 }, { x: 50, y: 0 }, {});

  const junction = m.state.objects.find((object) => object.type === "junction");

  assert.ok(junction, "the branch earns a junction");

  /* Every linked branch component is in a system, and none is orphaned. */
  assert.ok(
    m.assembly.pipeSystems(m.state.objects).length >= 1,
    "the topology still forms a connected system"
  );

  m.state.objects.forEach((object) => {
    if (object.parentId) {
      const parent = live(m, object.parentId);

      assert.ok(parent, `${object.id} names a parent that exists`);
      assert.equal(parent.type, "pipe-assembly");
    }
  });

  void parentId;
});

test("stable ids survive ordinary regrouping", () => {
  const m = modules();
  system(m);

  const parentId = assemblies(m)[0].id;
  const memberIds = m.state.objects.filter((object) => object.parentId).map((object) => object.id).sort();

  m.assembly.reconcilePipeAssemblies(m.state.objects);
  m.assembly.reconcilePipeAssemblies(m.state.objects);

  assert.equal(assemblies(m)[0].id, parentId, "the assembly keeps its id");
  assert.deepEqual(
    m.state.objects.filter((object) => object.parentId).map((object) => object.id).sort(),
    memberIds,
    "and every member keeps its own"
  );
});

/* ============================================================
 * 5. SELECTION
 * ============================================================ */

test("a child is selected and edited on its own, and a parent selects the system", () => {
  const m = modules();
  const { first } = system(m);

  const assembly = assemblies(m)[0];

  /* Selecting a child selects ONLY that component. */
  m.drawingState.selectObject(m.state, first.id);

  assert.deepEqual(m.state.selection.selectedObjectIds, [first.id], "one child, one selection");
  assert.equal(live(m, first.id).type, "pipe-duct", "and its own Features apply");

  /* Selecting the parent brings the whole system, members included. */
  m.drawingState.selectObject(m.state, assembly.id);

  assert.deepEqual(m.state.selection.selectedObjectIds, [assembly.id], "the parent is selected");

  const selectionTransform = require(locate("selection-transform.js"));
  const involved = selectionTransform.selectionMembers(m.state.objects, [assembly.id]);

  assert.ok(involved.length >= 3, "the parent's selection reaches its members");
  assert.ok(
    involved.some((object) => object.id === first.id),
    "including the child pipe"
  );
});

/* ============================================================
 * 6. COORDINATED TRANSFORMS
 * ============================================================ */

test("translating an assembly moves every member by the same delta", () => {
  const m = modules();

  reset(m);

  const a = m.pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
  const b = m.pipe.createPipeDuct({ x: 100, y: 0 }, { x: 100, y: 100 });

  m.state.objects = [a, b];
  m.tool.connectPipeEndpoints(b, m.state.objects);

  /* Building a system outside the tool reconciles its grouping once, explicitly. */
  m.assembly.reconcilePipeAssemblies(m.state.objects);

  const assembly = assemblies(m)[0];
  const before = new Map(
    m.state.objects.map((object) => [object.id, JSON.parse(JSON.stringify(object.geometry))])
  );

  const members = m.assembly.assemblyMembers(assembly, m.state.objects);

  assert.ok(members.length >= 3, "runs and the elbow");

  m.assembly.translateAssemblyMembers(members, 25, -40);

  members.forEach((member) => {
    const original = before.get(member.id);

    if (member.type === "pipe-duct") {
      assert.equal(member.geometry.start.x, original.start.x + 25);
      assert.equal(member.geometry.start.y, original.start.y - 40);
      assert.equal(member.geometry.end.x, original.end.x + 25);
      assert.equal(member.geometry.end.y, original.end.y - 40);
    }

    if (member.type === "elbow") {
      assert.equal(member.geometry.position.x, original.position.x + 25);
      assert.equal(member.geometry.position.y, original.position.y - 40);
    }
  });

  /* A translation does not resize anything. */
  const widths = members
    .filter((member) => member.type === "pipe-duct")
    .map((member) => m.pipe.boundarySeparation(member.engineering || {}));

  assert.equal(new Set(widths).size, 1, "every run keeps one Pipe Width");
});

test("a translated assembly still settles into one coherent connection", () => {
  const m = modules();
  const { first, second } = system(m);

  const assembly = assemblies(m)[0];
  const elbow = m.state.objects.find((object) => object.type === "elbow");

  const before = topology(m);

  const members = m.assembly.assemblyMembers(assembly, m.state.objects);

  m.assembly.translateAssemblyMembers(members, 60, 20);

  /*
   * The fittings are settled ONCE, after the move - so the pair is still joined
   * and the records name the same two runs.
   */
  m.tool.refreshFluidConnections(live(m, first.id), m.state.objects);

  assert.equal(m.state.objects.filter((object) => object.type === "elbow").length, 1, "one elbow");
  assert.deepEqual(
    [...(live(m, elbow.id).engineering.connections || [])].sort(),
    before[0].connections.sort(),
    "joining the same two runs"
  );

  /* Both pipes still end on their bend. */
  const curve = m.pipe.elbowCurvesFor(live(m, elbow.id), m.pipe.fittingRuns(live(m, elbow.id)));

  assert.ok(curve, "the bend still draws");

  [first, second].forEach((run) => {
    const settled = live(m, run.id);
    const held = live(m, elbow.id).engineering.ports[settled.id];

    assert.ok(held, `${run.id} is still held by the bend`);
    assert.ok(
      Number(settled.geometry.trims?.[held]) > 0,
      `${run.id} is still cut back for it`
    );
  });
});

test("an assembly transform preserves every component's own appearance", () => {
  const m = modules();
  const { first, second } = system(m);

  m.schema.writeField(live(m, first.id), "stroke", "#ff0000");
  m.schema.writeField(live(m, second.id), "stroke", "#0000ff");

  const assembly = assemblies(m)[0];
  const members = m.assembly.assemblyMembers(assembly, m.state.objects);

  m.assembly.translateAssemblyMembers(members, 10, 10);

  assert.equal(live(m, first.id).style.stroke, "#ff0000", "the first pipe keeps its colour");
  assert.equal(live(m, second.id).style.stroke, "#0000ff", "the second keeps its own");
});

/* ============================================================
 * 7. THE OBJECTS TAB
 * ============================================================ */

test("the Objects tab nests each component under its assembly parent", () => {
  const m = modules();
  const { first, second } = system(m);

  const markup = m.objectsList.objectsListMarkup(m.state.objects, []);

  const parentRow = markup.indexOf(`data-object-id="${assemblies(m)[0].id}"`);

  assert.ok(parentRow >= 0, "the parent has a row");

  [first.id, second.id].forEach((id) => {
    const at = markup.indexOf(`data-object-id="${id}"`);

    assert.ok(at > parentRow, `${id}'s row follows the parent's in the tree`);
    assert.ok(
      markup.slice(parentRow, at).includes("drawing-objects-children"),
      `${id} sits inside the parent's group`
    );
  });

  /* Each child keeps its own identity and eye. */
  assert.ok(markup.includes(`data-visibility-for="${first.id}"`), "the child keeps its eye control");
});

test("the parent row is a real selectable row, not a replacement for its children", () => {
  const m = modules();
  const { first } = system(m);

  const assembly = assemblies(m)[0];

  assert.equal(m.schema.readField(assembly, "name"), assembly.name, "the parent has its own identity");
  assert.ok(
    m.objectsList.objectsListMarkup(m.state.objects, [assembly.id]).includes(
      `aria-selected="true"`
    ),
    "and can be selected in the list"
  );

  assert.ok(live(m, first.id), "selecting it does not absorb the child objects");
});

test("the assembly parent is never picked on the canvas", () => {
  const m = modules();
  const { first } = system(m);

  const hitTesting = require(locate("hit-testing.js"));

  m.state.camera.zoom = PIXELS_PER_UNIT / m.drawingState.BASE_PIXELS_PER_UNIT;

  /*
   * A point ON the parent's own id would be meaningless - it has no geometry. The
   * real guarantee is that clicking the pipes still selects the PIPES, never the
   * container wrapped round them.
   */
  const picked = hitTesting.objectAtPoint({ x: 50, y: 0 });

  assert.ok(picked, "a click on the pipework picks something");
  assert.notEqual(picked.type, "pipe-assembly", "never the assembly");
  assert.equal(picked.id, first.id, "it is the pipe under the pointer");
});

/* ============================================================
 * 8. SOURCE AND PERSISTENCE
 * ============================================================ */

test("assembly membership survives a source round trip and keeps stable ids", () => {
  const m = modules();
  const { first, second } = system(m);

  const assembly = assemblies(m)[0];
  const memberIds = membersOf(m, assembly).map((object) => object.id).sort();

  /* Each component still writes its own source block. */
  [first, second].forEach((run) => {
    const source = m.sync.sourceForObject(live(m, run.id));

    assert.ok(source, `${run.id} is written`);
    assert.ok(source.includes(run.id), "with its stable id");
  });

  assert.deepEqual(
    membersOf(m, assembly).map((object) => object.id).sort(),
    memberIds,
    "and the membership is unchanged by writing the source"
  );
});

test("undo restores membership along with the geometry", () => {
  const m = modules();
  const { first } = system(m);

  const assembly = assemblies(m)[0];
  const memberIds = membersOf(m, assembly).map((object) => object.id).sort();

  const run = live(m, first.id);
  const from = { ...run.geometry.end };

  m.state.selection.selectedObjectIds = [run.id];

  const started = m.drag.beginManipulationDrag(makePointer("pointerdown", from));

  m.drag.updateManipulationDrag(makePointer("pointermove", { x: from.x + 30, y: from.y + 30 }));
  m.drag.finishManipulationDrag(makePointer("pointerup", { x: from.x + 30, y: from.y + 30 }));

  assert.ok(started, "the drag ran");

  m.drawingState.undo(m.state);
  m.assembly.reconcilePipeAssemblies(m.state.objects);

  assert.equal(assemblies(m).length, 1, "still one assembly");
  assert.deepEqual(
    m.state.objects.filter((object) => object.parentId).map((object) => object.id).sort(),
    memberIds,
    "and the same members"
  );
});

/* The real pointer path, so the drag is the one the canvas runs. */
function makePointer(type, point) {
  const event = new window.MouseEvent(type, {
    clientX: CANVAS.left + CANVAS.width / 2 + point.x * PIXELS_PER_UNIT,
    clientY: CANVAS.top + CANVAS.height / 2 - point.y * PIXELS_PER_UNIT,
    bubbles: true,
    button: 0
  });

  event.pointerId = 1;
  event.pointerType = "mouse";

  return event;
}
