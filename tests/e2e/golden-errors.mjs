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

/*
 * AND A TOOL THAT SHOULD CREATE SOMETHING, DID.
 *
 * A page error is not the only way a tool breaks: a click the router answered
 * before the tool saw it creates nothing and throws nothing. These steps draw a
 * feature by a fixed gesture on every machine, so an empty result is a fault.
 * (A recording made before `created` was stored has nothing to check.)
 */
const MUST_CREATE = [
    "STATICS/body/particle",
    "STATICS/body/rigid-body",
    "STATICS/body/beam",
    "STATICS/body/truss",
    "STATICS/body/cable",
    "STATICS/body/shaft",
    "STATICS/point-force",
    "STATICS/load/distributed-load",
    "STATICS/load/varying-distributed-load",
    "STATICS/moment",
    "STATICS/support/pin-support",
    "STATICS/support/roller-support",
    "STATICS/support/fixed-support",
    "STATICS/support/smooth-support",
    "STATICS/reference-point",
    "STATICS/reference-line"
];

const empty = MUST_CREATE.filter((key) => recording[key] && recording[key].created === 0);

empty.forEach((key) => console.log(`✗ ${key} created nothing`));

console.log(`${MUST_CREATE.length - empty.length}/${MUST_CREATE.length} Statics creation steps created a feature`);

process.exit(failing.length || empty.length ? 1 : 0);
