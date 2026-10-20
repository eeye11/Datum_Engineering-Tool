/*
 * ========================================================
 * ARC AND POLYGON ARM THEIR TOOL FROM THE SUBMENU
 * ========================================================
 *
 * Arc and Polygon each offer a construction METHOD (three-point vs centre;
 * centre vs side) from a toolbar submenu. Picking a method ARMS the tool
 * through `activateTool`, exactly as clicking the tool button does.
 *
 * The bug this guards against: `activateTool` toggles a tool back off to
 * Select when it is re-clicked while already active - so picking the second
 * method while the tool was already active switched the student back to
 * Select. The submenu closed, nothing was drawn, and the tool LOOKED like a
 * placeholder even though its drawing pipeline was fully implemented.
 *
 * Arc and Polygon are therefore PLACEMENT tools: re-arming them must keep
 * them armed rather than toggling them off. These checks pin that rule, and
 * pin the companion fact that neither is placeholder-gated - the two things
 * whose combination produced the "arc and polygon are still placeholders"
 * symptom.
 *
 * A SOURCE-LEVEL CHECK, deliberately. The arming entry points reach for
 * toolbar DOM, message banners and renderers; a jsdom boot would test the
 * scaffolding rather than the rule. What matters, and what is asserted
 * here, is that the rule is stated in the one place every arming path reads.
 */

const fs = require("fs");

const { locate } = require("./helpers/source-path.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const activation = fs.readFileSync(locate("tool-activation.js"), "utf8");
const phaseReset = fs.readFileSync(locate("phase-reset.js"), "utf8");

/* The body of activateTool, so the checks cannot be satisfied elsewhere. */
const activateToolBody = (() => {
  const start = activation.indexOf("export function activateTool(");
  const end = activation.indexOf("\nexport function ", start + 1);

  return activation.slice(start, end < 0 ? undefined : end);
})();

console.log("\n  Arc and Polygon are NOT placeholder-gated\n");

const nonResetList = (() => {
  const start = phaseReset.indexOf("const NON_RESET_TOOLS = [");
  const end = phaseReset.indexOf("];", start);

  return phaseReset.slice(start, end);
})();

check(
  "arc is exempt from the Phase 1 reset",
  /"arc"/.test(nonResetList),
  "a gated arc would never reach its drawing pipeline",
);

check(
  "the reference-arc variant is exempt too",
  /"reference-arc"/.test(nonResetList),
);

check(
  "polygon is exempt from the Phase 1 reset",
  /"polygon"/.test(nonResetList),
);

check(
  "both reach the real activation path, not the placeholder branch",
  /if \(isLegacyResetTool\(toolId\)\)/.test(activateToolBody) &&
    activateToolBody.indexOf("isLegacyResetTool(toolId)") <
      activateToolBody.indexOf("isPlacementTool"),
  "the placeholder gate must be consulted, and the real path taken after it",
);

console.log("\n  Re-arming from the submenu keeps the tool armed\n");

check(
  "arc counts as a placement tool",
  /isPlacementTool[\s\S]{0,800}?(?:toolId|requestedTool) === "arc"/.test(activateToolBody),
  "otherwise the submenu would toggle it back to Select",
);

check(
  "the reference-arc variant counts too",
  /isPlacementTool[\s\S]{0,800}?(?:toolId|requestedTool) === "reference-arc"/.test(
    activateToolBody,
  ),
);

check(
  "polygon counts as a placement tool",
  /isPlacementTool[\s\S]{0,800}?(?:toolId|requestedTool) === "polygon"/.test(activateToolBody),
);

check(
  "a placement tool is never toggled back to Select",
  /activeTool ===\s*\n?\s*(?:toolId|requestedTool) &&\s*\n?\s*!isPlacementTool/.test(
    activateToolBody,
  ),
  "the toggle must be guarded by the placement test",
);

check(
  "so the armed tool id is the one that was asked for",
  /const nextTool =[\s\S]{0,200}\?\s*"select"\s*\n?\s*:\s*(?:toolId|requestedTool)/.test(
    activateToolBody,
  ),
);

/*
 * (`requestedTool` is the tool a Fluids entry arms - its primitive - and is
 * `toolId` itself for every other tool, so either name is the asked-for tool.)
 */
console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
