/*
 * Fail if any step of a golden-master recording raised a page error.
 *
 *   node tests/e2e/golden-errors.mjs <recording.golden.json>
 *
 * The scenario (golden-scenario.mjs) drives every tool, the Modify tools,
 * the clipboard, sheets, export and the written solution, and records the
 * errors the page threw at each step. A recording is machine-specific, so CI
 * cannot compare it against a stored one - but an error is an error on any
 * machine, so this is the part of the scenario CI can enforce.
 */
import fs from "fs";

const file = process.argv[2];

if (!file) {
    console.error("usage: node tests/e2e/golden-errors.mjs <recording.golden.json>");
    process.exit(2);
}

const recording = JSON.parse(fs.readFileSync(file, "utf8"));
const steps = Object.entries(recording);
const failing = steps.filter(([, step]) => Array.isArray(step?.errors) && step.errors.length);

for (const [key, step] of failing) {
    console.log(`✗ ${key}`);
    step.errors.forEach(error => console.log(`    ${error}`));
}

console.log(`\n${steps.length - failing.length}/${steps.length} steps ran without a page error`);
process.exit(failing.length ? 1 : 0);
