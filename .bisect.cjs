const fs = require("fs");

const FILE = "src/features/workspace/interaction/canvas-events.js";
const BACKUP = ".allmine/ce-current.js";
const mode = process.argv[2];

if (mode === "restore") {
  fs.copyFileSync(BACKUP, FILE);
  console.log("restored");
  process.exit(0);
}

let s = fs.readFileSync(BACKUP, "utf8");

if (mode === "mousemove") {
  s = s.replace(
    'drawingCanvas.addEventListener("pointermove", updateDrawingCoordinates);',
    'drawingCanvas.addEventListener("mousemove", updateDrawingCoordinates);',
  );
}

if (mode === "noresolve") {
  s = s.replace(
    'drawingCanvas.addEventListener("pointermove", updateDrawingCoordinates);',
    "",
  );
}

if (mode === "noclassify") {
  s = s.replace(
    /drawingCanvas\.addEventListener\(\s*"pointermove",\s*event => \{\s*classifyTouchFrame\(event\);\s*\}\s*\);/,
    "",
  );
}

if (mode === "nopen") {
  s = s.replace(
    /drawingCanvas\.addEventListener\(\s*"pointerdown",\s*event => \{\s*if \(pointerKind\(event\) !== "pen"\) \{[\s\S]*?\{ capture: true \}\s*\);/,
    "",
  );
}

if (mode === "nohold") {
  s = s.replace(
    "function shouldHoldTouchPress(event) {",
    "function shouldHoldTouchPress(event) { return false;",
  );
}

fs.writeFileSync(FILE, s);
console.log("applied", mode);
