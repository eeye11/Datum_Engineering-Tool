
const path = require("path");


const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
global.window = {};
loadModule("sheets.js");
loadModule("document-file.js");
const f = global.window.enggDocumentFile;

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `\n       expected ${JSON.stringify(e)}\n       actual   ${JSON.stringify(a)}`}`);
};

const dim = {
  id: "dimension-1", name: "Dimension 1", type: "dimension",
  content: {
    dimensionType: "linear",
    sourceRefs: [
      { kind: "between", featureId: "beam-1", anchor: "start" },
      { kind: "between", featureId: "beam-1", anchor: "end" }
    ],
    label: "Length", orientation: "horizontal", resolved: true
  }
};
const ann = {
  id: "annotation-1", name: "Force Label 1", type: "annotation",
  content: {
    annotationKind: "force-value", textMode: "auto", text: "",
    sourceFeatureId: "force-1", anchorRef: null,
    placement: { x: 300, y: 150 }, placementMode: "manual",
    leader: { enabled: true, target: "source", elbow: null },
    visible: true
  }
};
const body = {
  objects: [
    { id: "beam-1", type: "beam" },
    { id: "force-1", type: "force" },
    dim,
    ann
  ],
  units: "mm"
};

console.log("\nDimensions and annotations survive a save/open round trip");
const doc = f.createDocument(body);
const text = JSON.stringify(doc);
const back = f.readDocument(JSON.parse(text));
if (!back.ok) {
  console.log("  FAIL readDocument rejected the file:", back.detail);
  process.exit(1);
}
const body2 = back.document;

const objs = body2.objects || [];
const d2 = objs.find(o => o.id === "dimension-1");
const a2 = objs.find(o => o.id === "annotation-1");

check("the file still declares its format", JSON.parse(text).format, "enggdraw");
check("the dimension comes back", !!d2, true);
check("still a dimension, not flattened into a line", d2 && d2.type, "dimension");
check("keeping its measurement type", d2 && d2.content.dimensionType, "linear");
check("keeping its source references", d2 && d2.content.sourceRefs.length, 2);
check("referring to the real beam", d2 && d2.content.sourceRefs[0].featureId, "beam-1");
check("the annotation comes back", !!a2, true);
check("still an annotation, not text over a feature", a2 && a2.type, "annotation");
check("keeping its source link", a2 && a2.content.sourceFeatureId, "force-1");
check("keeping the student's chosen position", a2 && a2.content.placement, { x: 300, y: 150 });
check("knowing that position was the student's choice", a2 && a2.content.placementMode, "manual");
check("keeping its leader state", a2 && a2.content.leader.enabled, true);
check("keeping visibility", a2 && a2.content.visible, true);


/*
 * SHEETS
 *
 * A dimension or annotation belongs to the sheet it was made on, and the
 * relationship is held by the sheet holding it - not by a name, a tab index,
 * or anything the student can retype. So the checks here are that two sheets

 * keep their objects apart through a save and open, and that renaming one
 * leaves the other untouched.

 * Verified in the browser as well: adding a second sheet shows none of the first

 * sheet's dimensions, and switching back restores the same dimension id.

 */
console.log("\nDimensions stay on the sheet they were made on");

const twoSheets = f.createDocument({
  sheets: [
    {
      id: "sheet-one",
      name: "Setup",
      objects: [
        { id: "beam-1", type: "beam" },
        { id: "dimension-1", type: "dimension", content: {
          dimensionType: "linear",
          sourceRefs: [
            { kind: "between", featureId: "beam-1", anchor: "start" },
            { kind: "between", featureId: "beam-1", anchor: "end" }
          ]
        } }
      ]
    },
    {
      id: "sheet-two",
      name: "Analysis",
      objects: [{ id: "line-9", type: "line" }]
    }
  ]
});

const sheetsBack = f.readDocument(JSON.parse(JSON.stringify(twoSheets)));
check("the file is accepted", sheetsBack.ok, true);

const saved = sheetsBack.document.sheets;
check("both sheets survive", saved.length, 2);
check("the first keeps its dimension",
  saved[0].objects.filter((o) => o.type === "dimension").length, 1);
check("the second has none of it",
  saved[1].objects.filter((o) => o.type === "dimension").length, 0);

console.log("\nA rename cannot break the relationship");
const renamed = sheetsBack.document;
renamed.sheets[0].name = "Setup renamed";

const reread = f.readDocument(f.createDocument({ sheets: renamed.sheets }));
check("the file is still accepted", reread.ok, true);
check("the sheet is found by its id, not its new name",
  reread.document.sheets[0].id, "sheet-one");
check("and still holds its dimension",
  reread.document.sheets[0].objects.filter((o) => o.type === "dimension").length, 1);
