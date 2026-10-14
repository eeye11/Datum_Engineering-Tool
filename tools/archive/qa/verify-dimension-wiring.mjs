/*
 * The dimension and annotation wiring, checked in the real application.
 *
 * The four model modules are tested in Node. What cannot be tested
 * there is whether the document can HOLD them - whether a dimension
 * survives being created, selected, moved, deleted, saved and
 * restored. That needs the real addObject, the real undo stack and the
 * real file format, which is what this drives.
 */
export default async function run(page) {
  page.setDefaultTimeout(120000);

  const out = {};
  const log = (key, value) => {
    out[key] = value;
  };

  async function ask(body) {
    const content =
      "(function(){" +
      "var out;try{out=(function(){" +
      body +
      "})();}catch(e){out={error:String(e), stack:String(e.stack||'').slice(0,300)};}" +
      "document.documentElement.setAttribute('data-probe'," +
      "JSON.stringify(out===undefined?null:out));" +
      "})();";

    try {
      await page.addScriptTag({ content });
    } catch (error) {
      return { questionFailed: String(error).slice(0, 300) };
    }

    try {
      const raw = await page.evaluate(() =>
        document.documentElement.getAttribute("data-probe"),
      );
      await page.evaluate(() =>
        document.documentElement.removeAttribute("data-probe"),
      );
      return raw === null ? null : JSON.parse(raw);
    } catch (error) {
      return { answerFailed: String(error).slice(0, 300) };
    }
  }

  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForSelector(".drawing-sheet-tab");
  await page.waitForTimeout(400);

  log(
    "modulesLoaded",
    await ask(
      "return {" +
        "measurement: typeof window.enggMeasurement," +
        "dimension: typeof window.enggDimensionModel," +
        "annotation: typeof window.enggAnnotationModel," +
        "smart: typeof window.enggSmartDimension," +
        "reachableFromState: {" +
        "measurement: typeof window.enggDrawingState.measurement," +
        "dimension: typeof window.enggDrawingState.dimensionModel," +
        "annotation: typeof window.enggDrawingState.annotationModel }" +
        "};",
    ),
  );

  /* A beam to measure. */
  log(
    "beamCreated",
    await ask(
      "var M = window.enggDrawing.state;" +
        "var id = M.addObject(window.enggDrawing.state, " +
        "M.model.geometryFactories.beam({ x: -100, y: 0 }, { x: 100, y: 0 }));" +
        "return { id: id, objects: window.enggDrawing.state.objects.length };",
    ),
  );

  log(
    "dimensionCreated",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var beam = S.objects.find(function (o) { return o.type === 'beam'; });" +
        "var id = S.model.addObject(S, S.model.geometryFactories.dimension({" +
        "  dimensionType: 'horizontal'," +
        "  refs: [" +
        "    { featureId: beam.id, anchor: 'start' }," +
        "    { featureId: beam.id, anchor: 'end' }]," +
        "  placement: { x: 0, y: 40 }" +
        "}));" +
        "var created = S.objects.find(function (o) { return o.id === id; });" +
        "return {" +
        "id: id," +
        "name: created.name," +
        "type: created.type," +
        "hasGeometry: Object.keys(created.geometry || {}).length > 0," +
        "content: created.content," +
        "objects: S.objects.length" +
        "};",
    ),
  );

  log(
    "annotationCreated",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var id = S.model.addObject(S, S.model.geometryFactories.annotation({" +
        "  kind: 'free-text'," +
        "  text: 'Assume negligible self-weight.'," +
        "  position: { x: 40, y: 60 }" +
        "}));" +
        "var created = S.objects.find(function (o) { return o.id === id; });" +
        "return {" +
        "id: id, name: created.name, type: created.type," +
        "text: created.content.text," +
        "placement: created.content.placement," +
        "placementMode: created.content.placementMode" +
        "};",
    ),
  );

  log(
    "numbered",
    await ask(
      "var S = window.enggDrawing.state;" +
        "return S.objects.map(function (o) { return o.name; });",
    ),
  );

  /* Selection and hit-testing see them as ordinary features. */
  log(
    "selectable",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var dim = S.objects.find(function (o) { return o.type === 'dimension'; });" +
        "S.model.selectObject(S, dim.id);" +
        "return { selected: S.selection.selectedObjectIds.slice() };",
    ),
  );

  /* A second dimension, to confirm numbering continues. */
  log(
    "secondDimension",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var beam = S.objects.find(function (o) { return o.type === 'beam'; });" +
        "var id = S.model.addObject(S, S.model.geometryFactories.dimension({" +
        "  dimensionType: 'vertical'," +
        "  refs: [" +
        "    { featureId: beam.id, anchor: 'start' }," +
        "    { featureId: beam.id, anchor: 'end' }]," +
        "  placement: { x: 120, y: 0 }" +
        "}));" +
        "var created = S.objects.find(function (o) { return o.id === id; });" +
        "return { name: created.name };",
    ),
  );

  /* Undo must remove them like any other feature. */
  log(
    "undo",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var before = S.objects.length;" +
        "S.model.undo(S);" +
        "var afterUndo = S.objects.length;" +
        "S.model.redo(S);" +
        "return { before: before, afterUndo: afterUndo, afterRedo: S.objects.length };",
    ),
  );

  /* Serialisation must carry them into a file. */
  log(
    "serialised",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var body = JSON.parse(S.model.serializeDrawing(S));" +
        "var payload = window.enggDocumentFile.createDocument(body);" +
        "var json = JSON.stringify(payload);" +
        "return {" +
        "hasDimension: json.indexOf('\"dimension\"') !== -1," +
        "hasAnnotation: json.indexOf('\"annotation\"') !== -1," +
        "hasSourceRefs: json.indexOf('sourceRefs') !== -1," +
        "hasPlacementMode: json.indexOf('placementMode') !== -1," +
        "version: payload.version," +
        "objectTypes: body.objects.map(function (o) { return o.type; })" +
        "};",
    ),
  );

  /* And a round trip through the real reader must restore them. */
  log(
    "roundTrip",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var body = JSON.parse(S.model.serializeDrawing(S));" +
        "var payload = window.enggDocumentFile.createDocument(body);" +
        "var read = window.enggDocumentFile.readDocument(payload);" +
        "if (!read.ok) return { ok: false, detail: read.detail };" +
        "var restored = S.model.createDrawingState();" +
        "S.model.restoreDocument(restored, read.document);" +
        "var dims = restored.objects.filter(function (o) { return o.type === 'dimension'; });" +
        "var notes = restored.objects.filter(function (o) { return o.type === 'annotation'; });" +
        "return {" +
        "ok: true," +
        "dimensions: dims.length," +
        "annotations: notes.length," +
        "firstHasRefs: dims.length > 0 && Array.isArray(dims[0].content.sourceRefs)," +
        "annotationTextKept: notes.length > 0 && notes[0].content.text" +
        "};",
    ),
  );

  /* The model must read the restored object's content, not raw geometry. */
  log(
    "measurementFromRestored",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var body = JSON.parse(S.model.serializeDrawing(S));" +
        "var read = window.enggDocumentFile.readDocument(window.enggDocumentFile.createDocument(body));" +
        "var restored = S.model.createDrawingState();" +
        "S.model.restoreDocument(restored, read.document);" +
        "var dim = restored.objects.find(function (o) { return o.type === 'dimension'; });" +
        "var model = window.enggDimensionModel;" +
        "/* The dimension model works on plain descriptors; the feature's */" +
        "/* content is what supplies them. */" +
        "var asDimension = { dimensionType: dim.content.dimensionType, sourceRefs: dim.content.sourceRefs, placement: dim.content.placement, style: {}, id: dim.id };" +
        "return { text: model.formatMeasurement(asDimension, restored) };",
    ),
  );

  /* Moving a dimension must not move the beam. */
  log(
    "moveIsIndependent",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var beam = S.objects.find(function (o) { return o.type === 'beam'; });" +
        "var before = JSON.stringify(beam.geometry);" +
        "var dim = S.objects.find(function (o) { return o.type === 'dimension'; });" +
        "dim.content.placement = { x: 500, y: 500 };" +
        "return { beamUnchanged: JSON.stringify(beam.geometry) === before," +
        "placement: dim.content.placement };",
    ),
  );

  /* Deleting them works like any feature. */
  log(
    "delete",
    await ask(
      "var S = window.enggDrawing.state;" +
        "var before = S.objects.length;" +
        "var dim = S.objects.find(function (o) { return o.type === 'dimension'; });" +
        "S.model.removeObject(S, dim.id);" +
        "return { before: before, after: S.objects.length };",
    ),
  );

  await page.screenshot({ path: "shots/dimension-wiring.png" });

  return out;
}
