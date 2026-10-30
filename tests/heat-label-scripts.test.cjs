const test = require("node:test");
const assert = require("node:assert/strict");

test("heat labels support subscripts, superscripts and a rate dot", async () => {
    const { annotationSubscript } = await import("../src/features/workspace/model/annotations/math-label.js");
    assert.deepEqual(annotationSubscript("Q_in"), { base: "Q", subscript: "in", superscript: "", suffix: "" });
    assert.deepEqual(annotationSubscript("q^{out}"), { base: "q", subscript: "", superscript: "out", suffix: "" });
    assert.deepEqual(annotationSubscript("Q̇_out"), { base: "Q̇", subscript: "out", superscript: "", suffix: "" });
    assert.deepEqual(annotationSubscript("Q_{in}^{2} = 10 W"), { base: "Q", subscript: "in", superscript: "2", suffix: " = 10 W" });
    assert.equal(annotationSubscript("ordinary text"), null);
});
