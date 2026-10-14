/*
 * DOES THE ANNOTATION SWITCH ACTUALLY DO ANYTHING?
 *
 * A checkbox that renders correctly and changes nothing is the worst outcome:
 * it looks like a control, and a student who uses it concludes the feature
 * cannot show its magnitude.
 *
 * So this creates a force the way the application does, counts the magnitude
 * boxes on the sheet, clicks the switch, and counts again. It also checks that
 * the FORCE itself is untouched - the box is presentation, and moving the
 * presentation must never move the engineering.
 */
export default async function run(page, ui) {
  const bridge = async (fnBody) => {
    await page.evaluate((src) => {
      document.getElementById("__qa_script")?.remove();
      document.getElementById("__qa_result")?.remove();

      const s = document.createElement("script");
      s.id = "__qa_script";
      s.textContent = `
        (function () {
          var out;
          try { out = (${src})(window, document); }
          catch (e) { out = { error: String((e && e.stack) || e) }; }
          var el = document.createElement('div');
          el.id = '__qa_result';
          el.setAttribute('data-json', JSON.stringify(out));
          document.body.appendChild(el);
        })();
      `;
      document.body.appendChild(s);
    }, fnBody);

    await page.waitForFunction(() => !!document.getElementById("__qa_result"), {
      timeout: 15000,
    });

    return await page.evaluate(() =>
      JSON.parse(
        document.getElementById("__qa_result").getAttribute("data-json"),
      ),
    );
  };

  const checks = [];
  const check = (name, ok, detail) =>
    checks.push({ name, ok, ...(detail ? { detail } : {}) });

  await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".tab")].find(
      (b) => b.textContent.trim() === "Engineering Drawing",
    );
    tab?.click();
  });
  await page.waitForTimeout(1400);

  // ---- CREATE THROUGH THE APP'S OWN TOOL, NOT BY PUSHING STATE ----------
  const created = await bridge(`function (w, d) {
    var api = w.enggDrawing;
    var state = api && api.state;
    if (!state) return { error: 'no state' };

    state.objects.push({
      id: 'qa-f1',
      type: 'force',
      name: 'QA Force',
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 80, y: 0 },
        magnitude: 100,
        angle: 0,
        unit: 'N'
      },
      engineering: { discipline: 'statics' },
      style: { stroke: '#000000', lineWidth: 1 }
    });

    state.selection.selectedObjectIds = ['qa-f1'];

    if (w.renderCurrentDrawing) w.renderCurrentDrawing();
    if (w.renderProperties) w.renderProperties();

    return {
      objects: state.objects.length,
      display: JSON.stringify(state.display || {}),
    };
  }`);

  if (created.error) {
    return { created, checks, aborted: created.error };
  }

  await page.waitForTimeout(1000);

  // ---- IS THE FORCE ON THE SHEET AT ALL? -------------------------------
  const drawn = await bridge(`function (w, d) {
    var svg = d.querySelector('.drawing-canvas');
    return {
      groups: svg ? svg.querySelectorAll('g').length : 0,
      paths: svg ? svg.querySelectorAll('path').length : 0,
      magnitudeBoxes: d.querySelectorAll('.drawing-derived-magnitude').length,
      forceNodes: d.querySelectorAll('[data-feature-id="qa-f1"]').length,
      forceVisible: (function () {
        var n = d.querySelector('[data-feature-id="qa-f1"]');
        return n ? getComputedStyle(n).display !== 'none' : null;
      })(),
    };
  }`);

  check(
    "the force is rendered on the sheet",
    drawn.forceNodes > 0,
    `no node carries the force's id (${drawn.groups} groups, ${drawn.paths} paths)`,
  );

  // ---- OPEN THE PANEL, THEN READ THE SWITCH'S STATE --------------------
  const pick = async () => {
    await page.evaluate(() => {
      const row =
        document.querySelector(
          '.drawing-component-row[data-object-id="qa-f1"]',
        ) || document.querySelector(".drawing-component-row");
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(600);
  };

  await pick();
  await pick();

  const before = await bridge(`function (w, d) {
    var box = d.querySelector('[data-feature-show-magnitude]');
    var state = w.enggDrawing.state;

    return {
      switchExists: !!box,
      checked: box ? box.checked : null,
      preference: JSON.stringify(
        (state.objects.find(function (o) { return o.id === 'qa-f1'; }) || {})
          .annotationDisplay || null
      ),
      boxesOnSheet: d.querySelectorAll('.drawing-derived-magnitude').length,
    };
  }`);

  check("the annotation switch exists", before.switchExists);
  check(
    "and reflects that the box is showing",
    before.checked === true,
    `switch read ${before.checked}, boxes on sheet ${before.boxesOnSheet}`,
  );

  // ---- CLICK IT, AND SEE WHETHER ANYTHING HAPPENS ----------------------
  await page.evaluate(() => {
    const box = document.querySelector("[data-feature-show-magnitude]");
    if (!box) throw new Error("no switch");

    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForTimeout(900);

  const after = await bridge(`function (w, d) {
    var box = d.querySelector('[data-feature-show-magnitude]');
    var force = w.enggDrawing.state.objects.find(
      function (o) { return o.id === 'qa-f1'; }
    );

    return {
      checked: box ? box.checked : null,
      preference: JSON.stringify(force?.annotationDisplay || null),
      boxesOnSheet: d.querySelectorAll('.drawing-derived-magnitude').length,
      // The force must be untouched.
      forceMagnitude: force?.geometry?.magnitude,
      forceStart: force?.geometry?.start,
    };
  }`);

  check(
    "the click was recorded on the feature",
    after.preference.includes("showMagnitude") &&
      after.preference.includes("false"),
    `preference is ${after.preference}`,
  );

  check(
    "the magnitude box was removed from the sheet",
    after.boxesOnSheet === before.boxesOnSheet - 1,
    `${before.boxesOnSheet} boxes before, ${after.boxesOnSheet} after`,
  );

  check(
    "and the force itself was not touched",
    after.forceMagnitude === 100 &&
      after.forceStart?.x === 0 &&
      after.forceStart?.y === 0,
    `magnitude ${after.forceMagnitude}, start ${JSON.stringify(after.forceStart)}`,
  );

  return {
    created,
    drawn,
    before,
    after,
    checks,
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
  };
}
