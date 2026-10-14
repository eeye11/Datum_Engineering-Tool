/*
 * THE CABLE PANEL, ON ITS OWN.
 *
 * The Cable panel had two fields bound to one property, so typing into Span
 * silently overwrote Length. The general sweep could not open every panel's
 * edit view, so this replicates exactly the sequence that is known to work for
 * the Point Force - create, select, render, click the tree row twice - and
 * checks the one thing that matters: Span is the editable field, Length is
 * derived, and neither writes the other's property.
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

  const made = await bridge(`function (w, d) {
    var state = w.enggDrawing.state;

    state.objects.push({
      id: 'qa-cable',
      type: 'cable',
      name: 'QA Cable',
      geometry: {
        start: { x: 0, y: 100 },
        end: { x: 400, y: 100 },
        tension: 250,
        segments: []
      },
      style: { stroke: '#000', lineWidth: 1 }
    });

    state.selection.selectedObjectIds = ['qa-cable'];

    if (w.renderCurrentDrawing) w.renderCurrentDrawing();
    if (w.renderProperties) w.renderProperties();

    return { objects: state.objects.length };
  }`);

  await page.waitForTimeout(900);

  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      document
        .querySelector('.drawing-component-row[data-object-id="qa-cable"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(600);
  }

  const panel = await bridge(`function (w, d) {
    var root = d.getElementById('drawingProperties');

    var rows = [...root.querySelectorAll('.drawing-property-grid-value')]
      .map(function (r) {
        var label = r.querySelector('.drawing-property-grid-label');
        var input = r.querySelector('input[data-property]');
        var readonly = r.querySelector('.drawing-property-readonly');
        var unit = r.querySelector('.drawing-property-unit');

        return {
          label: label ? label.textContent.trim() : '',
          property: input ? input.getAttribute('data-property') : null,
          editable: !!input,
          value: readonly ? readonly.textContent.trim() : null,
          unit: unit ? unit.textContent.trim() : ''
        };
      })
      .filter(function (r) { return r.label; });

    return {
      rowCount: rows.length,
      rows: rows,
      text: root.innerText,
    };
  }`);

  check(
    "the cable panel rendered its rows",
    panel.rowCount > 0,
    panel.text.slice(0, 160),
  );

  const span = panel.rows.find((r) => r.label === "Span");
  const length = panel.rows.find((r) => r.label === "Length");

  check("the cable has a Span", Boolean(span), JSON.stringify(panel.rows));
  check("the cable has a Length", Boolean(length));

  check(
    "Span is the editable one",
    span?.editable === true,
    `span editable=${span?.editable}`,
  );

  check(
    "Length is derived, not a second input on the same property",
    length?.editable === false,
    `length editable=${length?.editable} - if it were editable it would write the same property as Span, and typing in either would overwrite the other`,
  );

  check(
    "the two do not claim the same property",
    !(span?.property && length?.property && span.property === length.property),
    `both write "${span?.property}"`,
  );

  check(
    "the derived Length states mm",
    length?.unit === "mm",
    `unit was "${length?.unit}"`,
  );

  check(
    "the ORIENTATION angle states degrees",
    panel.rows.find((r) => r.label === "Angle")?.unit === "°",
    `angle unit was "${panel.rows.find((r) => r.label === "Angle")?.unit}"`,
  );

  check("no middot anywhere in the panel", !panel.text.includes("·"));

  check(
    'no "Feature Type" inspector field',
    !panel.text.includes("Feature Type"),
  );

  return {
    made,
    panel,
    checks,
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
  };
}
