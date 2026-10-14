/*
 * The recovery module is pure apart from its storage calls, so it
 * is tested in Node against a stub. Every case here is something
 * that can actually be in a user's browser: a good copy, a corrupt
 * one, an ancient one, and storage that refuses outright.
 */
let store = {};
const unavailable = { value: false };

global.window = {
  localStorage: {
    getItem(key) {
      if (unavailable.value) throw new Error("denied");
      return key in store ? store[key] : null;
    },
    setItem(key, value) {
      if (unavailable.value) throw new Error("denied");
      store[key] = value;
    },
    removeItem(key) {
      if (unavailable.value) throw new Error("denied");
      delete store[key];
    },
  },
  setTimeout: () => 1,
  clearTimeout: () => {},
};

require("./js/engineering-drawing/document-recovery.js");
const r = global.window.enggRecovery;

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n       expected ${JSON.stringify(expected)}` +
        `\n       actual   ${JSON.stringify(actual)}`,
    );
  }
};

const body = { objects: [{ id: "a", type: "beam" }], units: "mm" };

console.log("\nNothing stored");
check("no record to read", r.read(), null);
check("nothing to offer", r.available(), false);
check("nothing to describe", r.describe(), null);

console.log("\nStoring and reading");
check("write succeeds", r.write(body, "Report.enggdraw"), true);
check("a copy now exists", r.available(), true);

const record = r.read();
check("keeps the document", record.document, body);
check("remembers the name", record.fileName, "Report.enggdraw");
check("records a time", Number.isFinite(record.savedAt), true);

const described = r.describe();
check("counts the features", described.features, 1);

console.log("\nDiscarding");
r.discard();
check("gone after discard", r.available(), false);
check("and cannot be read", r.read(), null);

console.log("\nDamaged copies");
store[r.STORAGE_KEY] = "{not json";
check("corrupt JSON is refused", r.read(), null);
check("and is cleared", Object.keys(store).length, 0);

store[r.STORAGE_KEY] = JSON.stringify({ savedAt: Date.now() });
check("a record with no document is refused", r.read(), null);

console.log("\nAn old copy");
r.write(body, null);
store[r.STORAGE_KEY] = JSON.stringify({
  savedAt: Date.now() - (r.MAX_AGE_MS + 1000),
  document: body,
});
check("an expired copy is refused", r.available(), false);

console.log("\nStorage that refuses");
unavailable.value = true;
check("reading is survivable", r.read(), null);
check("writing reports failure", r.write(body), false);
check("discarding is survivable", r.discard(), undefined);
check("offering is survivable", r.available(), false);
unavailable.value = false;

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
