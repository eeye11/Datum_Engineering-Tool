/**
 * The regression test from the bug report, driven in a real browser.
 *
 * The acceptance case is exact: a beam, a dimension above it, a point force
 * with a magnitude annotation dragged far to the right, an SFD below, then
 * Fit - and everything must be inside the fitted viewport. Then Print must
 * produce a page containing the same content.
 *
 * It is driven through the application's own state rather than by clicking,
 * because what is being checked is the BOUNDS SYSTEM, and the interesting
 * question is what it says about a drawing - not whether a particular button
 * is where this script expects it.
 */
export default async function run(page, ui) {
  const result = await page.evaluate(() => {
    const bounds = window.enggDrawingBounds;
    const state = window.enggDrawingState;

    if (!bounds || !state) {
      return { error: "modules not attached" };
    }

    const drawing = state.createDrawingState
      ? state.createDrawingState()
      : state.newDrawingState();

    /* Calibrated: 1 world unit = 250 mm. */
    drawing.scale = { mmPerUnit: 250, unit: "mm", reference: null };

    const beam = {
      id: "beam-1",
      type: "beam",
      name: "Beam",
      geometry: { start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, depth: 0.2 },
    };

    const dimension = {
      id: "dim-1",
      type: "dimension",
      name: "Beam Length",
      dimensionType: "linear",
      /* ABOVE the beam, which is the case that used to be cropped. */
      placement: { x: 1, y: 1 },
      sourceRefs: [
        { kind: "entity", featureId: beam.id, anchor: "start" },
        { kind: "entity", featureId: beam.id, anchor: "end" },
      ],
    };

    const force = {
      id: "force-1",
      type: "force",
      name: "Point Force",
      geometry: { start: { x: 1, y: 0 }, magnitude: 0.6, angle: 90 },
    };

    const annotation = {
      id: "note-1",
      type: "annotation",
      name: "Magnitude",
      annotationKind: "magnitude",
      textMode: "manual",
      text: "100 N",
      visible: true,
      placementMode: "manual",
      /* DRAGGED FAR AWAY from the force, which is the point of a box. */
      placement: { x: 8, y: 3 },
      style: { fontSize: 12, align: "left" },
    };

    const sfd = {
      id: "sfd-1",
      type: "shear-force-diagram",
      name: "SFD",
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
        diagramType: "sfd",
      },
    };

    drawing.objects.push(beam, dimension, force, annotation, sfd);

    const context = { state: drawing, zoom: 1, dimensionFontSize: 11 };

    const all = bounds.calculateDrawingBounds(drawing, { zoom: 1 });

    /* GEOMETRY ALONE - the old, broken answer. */
    const geometryOnly = bounds.getDrawableBounds(beam, context);

    const perFeature = {};
    for (const object of drawing.objects) {
      const own = bounds.getDrawableBounds(object, context);
      perFeature[object.type] = own
        ? {
            minX: Number(own.minX.toFixed(3)),
            maxX: Number(own.maxX.toFixed(3)),
            minY: Number(own.minY.toFixed(3)),
            maxY: Number(own.maxY.toFixed(3)),
          }
        : null;
    }

    const inside = (r, x, y) =>
      x >= r.minX - 1e-6 &&
      x <= r.maxX + 1e-6 &&
      y >= r.minY - 1e-6 &&
      y <= r.maxY + 1e-6;

    /* EVERY ITEM'S OWN EXTENT IS INSIDE THE WHOLE. */
    const content = bounds.collectVisibleDrawingContent(drawing, { zoom: 1 });
    const allContained = content.every((item) => {
      const b = item.bounds;
      return (
        b.minX >= all.minX - 1e-6 &&
        b.maxX <= all.maxX + 1e-6 &&
        b.minY >= all.minY - 1e-6 &&
        b.maxY <= all.maxY + 1e-6
      );
    });

    /* MOVE THE DIMENSION, AND THE ANSWER MOVES WITH IT. */
    dimension.placement = { x: 1, y: 12 };
    const afterDimensionMove = bounds.calculateDrawingBounds(drawing, {
      zoom: 1,
    });
    dimension.placement = { x: 1, y: 1 };

    /* MOVE THE ANNOTATION, AND THE ANSWER MOVES WITH IT. */
    annotation.placement = { x: -9, y: 3 };
    const afterAnnotationMove = bounds.calculateDrawingBounds(drawing, {
      zoom: 1,
    });
    annotation.placement = { x: 8, y: 3 };

    /* RETYPE THE MAGNITUDE, AND THE WIDTH CHANGES. */
    const noteBounds = bounds.getDrawableBounds(annotation, context);
    const widthBefore = noteBounds.maxX - noteBounds.minX;
    annotation.text = "10000 N";
    const widthAfter =
      bounds.getDrawableBounds(annotation, context).maxX -
      bounds.getDrawableBounds(annotation, context).minX;
    annotation.text = "100 N";

    /* EMPTY SHEET. */
    const empty = bounds.calculateDrawingBounds(
      { objects: [], camera: { zoom: 1 }, scale: null },
      { zoom: 1 },
    );

    /* THE SHEET SCALE, THROUGH THE FEATURE PANEL'S OWN CONVERSION. */
    const engineering = window.enggDimensions.toEngineering(drawing, 2);
    const roundTrip = window.enggDimensions.fromEngineering(
      drawing,
      engineering.value,
      "mm",
    );

    return {
      featureTypes: content.map((item) => item.object.type),
      whole: {
        minX: Number(all.minX.toFixed(3)),
        maxX: Number(all.maxX.toFixed(3)),
        minY: Number(all.minY.toFixed(3)),
        maxY: Number(all.maxY.toFixed(3)),
      },
      geometryOnly: {
        maxX: Number(geometryOnly.maxX.toFixed(3)),
        maxY: Number(geometryOnly.maxY.toFixed(3)),
      },
      perFeature,
      allContained,

      /* Each of the six required items is inside the shared bounds. */
      beamInside: inside(all, 0, 0),
      dimensionInside: inside(all, 1, 1),
      forceInside: inside(all, 1, 0.6),
      annotationInside: inside(all, 8, 3),
      sfdInside: inside(all, 1, 0),

      /* The bug: the dimension and the SFD are OUTSIDE geometry alone. */
      dimensionOutsideGeometryAlone: !inside(geometryOnly, 1, 1),
      sfdOutsideGeometryAlone: geometryOnly.minY > all.minY,

      dimensionMoveGrows: afterDimensionMove.maxY > all.maxY,
      annotationMoveGrows: afterAnnotationMove.minX < all.minX,
      retypingWidens: widthAfter > widthBefore,
      widthBefore: Number(widthBefore.toFixed(3)),
      widthAfter: Number(widthAfter.toFixed(3)),

      emptyIsNull: empty === null,

      engineering: { value: engineering.value, unit: engineering.unit },
      roundTrip: Number(roundTrip.toFixed(9)),
    };
  });

  /* Now the real page: does it still load without errors? */
  const snapshot = await ui.snapshot();

  return { ...result, pageLoaded: snapshot.length > 0 };
}
