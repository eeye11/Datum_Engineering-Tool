import { updateFeatureProperty } from "./src/editor/property-update.js";
import { mmOf } from "./src/editor/handles.js";
import { drawingState } from "./src/editor-state.js";
import enggDocumentUnits from "./src/core/units/document-units.js";

/* Document reads in metres. */
enggDocumentUnits.setDocumentLengthUnit(drawingState, "m");

const pipe = {
  id: "p1",
  type: "pipe-duct",
  geometry: { start: { x: 0, y: 0 }, end: { x: 500, y: 0 } },
  engineering: {
    shape: "circular",
    diameter: 120,
    material: "",
    roughness: undefined,
  },
};

/* Student sees "0.12 m" in the panel and retypes 0.12. */
updateFeatureProperty(pipe, "diameter", 0.12, "m");

console.log("diameter stored:", pipe.engineering.diameter);
console.log(
  "panel would show:",
  enggDocumentUnits.documentLengthUnit(drawingState),
  mmOf(pipe.engineering.diameter).value,
);

/* Same check on an unedited value. */
console.log("untouched read-back:", mmOf(120).value);
