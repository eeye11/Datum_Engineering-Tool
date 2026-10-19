const path = require("path");
const { pathToFileURL } = require("url");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");
const server = pathToFileURL(path.join(projectRoot, "server", "tikz.js")).href;

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { loadModule } = require("./helpers/source-path.cjs");

loadModule("load-profile.js");
loadModule("diagram-equations.js");

const statics = loadModule("statics.js");

const STYLE = { stroke: "#193335", lineWidth: 0.75, lineType: "solid" };

const SAMPLES = {
  particle: { position: { x: 20, y: 20 } },
  "rigid-body": {
    position: { x: 0, y: 0 },
    width: 40,
    height: 20,
    rotation: 0,
  },
  beam: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  truss: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, panels: 4 },
  cable: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
  shaft: { start: { x: 0, y: 0 }, end: { x: 90, y: 0 }, diameter: 16 },
  force: {
    start: { x: 10, y: 10 },
    position: { x: 10, y: 10 },
    magnitude: 20,
    angle: 90,
  },
  load: {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    intensity: 5,
    direction: -90,
    interval: 25,
    points: [
      { t: 0, magnitude: 5 },
      { t: 1, magnitude: 5 },
    ],
  },
  "varying-load": {
    start: { x: 0, y: 0 },
    end: { x: 90, y: 0 },
    startIntensity: 0,
    endIntensity: 8,
    direction: -90,
    interval: 15,
    loadUnit: "kN/m",
    points: [
      { t: 0, magnitude: 0 },
      { t: 1, magnitude: 8 },
    ],
  },
  moment: {
    position: { x: 40, y: 40 },
    magnitude: 10,
    direction: "CCW",
    unit: "N\u00B7m",
  },
  "pin-support": { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  "roller-support": { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  "fixed-support": { position: { x: 0, y: 0 }, orientation: Math.PI / 2 },
  "smooth-support": { position: { x: 50, y: 0 }, orientation: Math.PI / 2 },
  "pin-connection": { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
  "fixed-connection": { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
  "slider-connection": { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
  resultant: {
    start: { x: 0, y: 0 },
    end: { x: 30, y: 40 },
    magnitude: 50,
    angle: 53.13,
  },
  "force-components": {
    start: { x: 0, y: 0 },
    end: { x: 30, y: 40 },
    horizontal: { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
    vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 40 } },
  },
  "coordinate-system-2d": {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
  },
  point: { position: { x: 5, y: 6 } },
  line: { start: { x: 0, y: 0 }, end: { x: 30, y: 40 } },
  arc: { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: 90 },
};

const objectFor = (type, geometry) => ({
  id: `${type}-t`,
  type,
  name: `${type} 1`,
  geometry,
  style: { ...STYLE },
});

(async () => {
  const { loadTikz, renderTikz } = await import(server);

  await loadTikz();

  let pass = 0;
  let fail = 0;

  for (const [type, geometry] of Object.entries(SAMPLES)) {
    const code = statics.serializeStaticsObject(objectFor(type, geometry), {
      state: null,
    });

    if (!code) {
      console.log(`  FAIL ${type}: no source`);
      fail += 1;
      continue;
    }

    const document = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${code}\n\\end{tikzpicture}`;

    try {
      const svg = await renderTikz(document);

      if (String(svg).includes("<svg")) {
        console.log(`  ok   ${type} compiles`);
        pass += 1;
      } else {
        console.log(`  FAIL ${type}: no svg`);
        fail += 1;
      }
    } catch (error) {
      console.log(`  FAIL ${type}: ${error.message}`);
      fail += 1;
    }
  }

  console.log(`\n${pass} compiled, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
