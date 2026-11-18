/* Print the size probe as one row per measured property, across zooms. */
const data = require("./size-probe.json");

const zooms = Object.keys(data);
const rows = new Map();

const walk = (value, property, index) => {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, inner]) =>
      walk(inner, property ? `${property}.${key}` : key, index),
    );
    return;
  }

  const list = rows.get(property) || zooms.map(() => "");
  list[index] = Array.isArray(value) ? value.join("/") : String(value);
  rows.set(property, list);
};

Object.entries(data).forEach(([, entry], index) => walk(entry, "", index));

const drift = (values) => {
  /*
   * A LIST (several elements' widths) is compared as a SET: the same widths in
   * the same order at every zoom. Comparing the joined string as one number is
   * what flagged an identical list as drift.
   */
  const parts = values.map((value) => value.split("/").filter(Boolean).join(","));

  return new Set(parts).size === 1 ? 0 : 1;
};

console.log(`zooms: ${zooms.join(", ")}`);

[...rows.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .forEach(([name, values]) => {
    const spread = drift(values);
    const flag = spread === 0 ? "ok" : "DRIFT";

    console.log(
      `${flag.padEnd(6)} ${name.padEnd(30)} ${values.map((value) => value || "-").join(" | ")}`,
    );
  });
