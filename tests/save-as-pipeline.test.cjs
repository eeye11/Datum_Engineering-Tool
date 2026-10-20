/*
 * ========================================================
 * ONE SAVE AS: THE DOCUMENT, A PNG, OR A JPG
 * ========================================================
 *
 * Save As is the one place a student chooses what they are saving, and the
 * choice is made in the system's own file panel - not in an application-owned
 * dialog. This file pins the three things that make that safe:
 *
 *   1. THE FORMAT FOLLOWS THE FILENAME the panel returned. "Beam.png" is a
 *      PNG because the name says so; the document format is the fallback for
 *      anything unrecognised, so a freely-typed name saves the WORK rather
 *      than silently becoming an image.
 *
 *   2. THE EXTENSION IS NOT DOUBLED. "Beam.png" is "Beam.png", never
 *      "Beam.png.png", and a name with no extension gets the format's.
 *
 *   3. CANCELLING DOES NOTHING, and an IMAGE SAVE DOES NOT RE-BRAND THE
 *      DOCUMENT. The document's handle is adopted only by a document save, so
 *      a later Save writes JSON where the document lives - never into a .png.
 *
 * The panel is stubbed at `window.showSaveFilePicker`, which is the real
 * integration point: what is under test is everything this application does
 * AROUND the native picker.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
const dir = path.join(
  __dirname,
  "..",
  "src",
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.Blob = dom.window.Blob;
global.URL = dom.window.URL;

loadModule("document-file.js");
loadModule("file-save.js");

const file = global.window.enggDocumentFile;
const save = global.window.enggFileSave;

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

/* A document body the format module will accept. */
const BODY = { objects: [], sheets: [] };

/*
 * A fake native panel. It records what it was asked for and returns a handle
 * for a chosen name - or throws AbortError, which is what a cancelled panel
 * does.
 */
function fakePicker(outcome) {
  const calls = [];

  global.window.showSaveFilePicker = async (options) => {
    calls.push(options);

    if (outcome === "cancel") {
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    }

    return {
      name: outcome,
      createWritable: async () => ({
        write: async () => {},
        close: async () => {},
      }),
    };
  };

  return calls;
}

const saved = (pickerCalls) => pickerCalls[pickerCalls.length - 1];

async function main() {
console.log("\n  the native panel is offered Datum, PNG and JPG\n");

{
  const calls = fakePicker("drawing.tex");
  await save.saveAs(BODY, "drawing.tex", {});

  const types = saved(calls).types;

  check(
    "the panel is asked for the four file types",
    Array.isArray(types) && types.length === 4,
    JSON.stringify(types),
  );

  const extensions = types.flatMap((t) =>
    Object.values(t.accept).flat(),
  );

  check(
    "the Datum extension is offered",
    extensions.includes(".tex"),
    extensions.join(", "),
  );
  check("PNG is offered", extensions.includes(".png"), extensions.join(", "));
  check(
    "both JPG spellings are offered",
    extensions.includes(".jpg") && extensions.includes(".jpeg"),
    extensions.join(", "),
  );

  check(
    "and a suggested name is given",
    typeof saved(calls).suggestedName === "string" &&
      saved(calls).suggestedName.length > 0,
    String(saved(calls).suggestedName),
  );
}

console.log("\n  the format follows the chosen filename\n");

{
  check(
    ".tex is the document",
    save.formatForName("Beam.tex").id === "tex",
  );
  check(".png is a PNG", save.formatForName("Beam.png").id === "png");
  check(".jpg is a JPG", save.formatForName("Beam.jpg").id === "jpg");
  check(".jpeg is a JPG", save.formatForName("Beam.jpeg").id === "jpg");
  check(
    "an unknown extension saves the document",
    save.formatForName("Beam.xyz").id === "tex",
    "a freely-typed name must not become an image",
  );
  check(
    "a bare name saves the document",
    save.formatForName("Beam").id === "tex",
  );
  check(
    "the match is case-insensitive",
    save.formatForName("Beam.PNG").id === "png",
  );
}

console.log("\n  the extension is not doubled\n");

{
  check(
    "Beam + PNG is Beam.png",
    save.normaliseName("Beam", { id: "png", extensions: [".png"] }) ===
      "Beam.png",
    save.normaliseName("Beam", { id: "png", extensions: [".png"] }),
  );
  check(
    "Beam.png + PNG is Beam.png, not Beam.png.png",
    save.normaliseName("Beam.png", { id: "png", extensions: [".png"] }) ===
      "Beam.png",
    save.normaliseName("Beam.png", { id: "png", extensions: [".png"] }),
  );
  check(
    "Beam.tex + PNG is Beam.png",
    save.normaliseName("Beam.tex", { id: "png", extensions: [".png"] }) ===
      "Beam.png",
    save.normaliseName("Beam.tex", { id: "png", extensions: [".png"] }),
  );
  check(
    "Beam.jpg + JPG is Beam.jpg, not Beam.jpg.jpg",
    save.normaliseName("Beam.jpg", { id: "jpg", extensions: [".jpg", ".jpeg"] }) ===
      "Beam.jpg",
    save.normaliseName("Beam.jpg", { id: "jpg", extensions: [".jpg", ".jpeg"] }),
  );
  check(
    "an empty name falls back to drawing",
    save.normaliseName("", { id: "png", extensions: [".png"] }) ===
      "drawing.png",
  );
}

console.log("\n  a document save writes the document\n");

{
  const calls = fakePicker("Beam.tex");

  let rendered = 0;

  const result = await save.saveAs(BODY, "Beam.tex", {
    renderImage: async () => {
      rendered++;
      return new Blob(["img"], { type: "image/png" });
    },
  });

  check(
    "the result reports the document format",
    result && result.format === "tex" && result.image === false,
    JSON.stringify(result),
  );
  check(
    "and the image renderer was NOT consulted",
    rendered === 0,
    "a document save must not pay for an image render",
  );
  check(
    "the document now has a handle to save back to",
    save.currentFileHandle() !== null,
  );
}

console.log("\n  an image save writes an image and does NOT re-brand the document\n");

{
  save.forgetFileHandle();

  const calls = fakePicker("Beam.png");

  let requestedFormat = null;

  const result = await save.saveAs(BODY, "Beam.tex", {
    renderImage: async (formatId) => {
      requestedFormat = formatId;
      return new Blob(["img"], { type: "image/png" });
    },
  });

  check(
    "the renderer was asked for a PNG",
    requestedFormat === "png",
    String(requestedFormat),
  );
  check(
    "the result reports an image",
    result && result.format === "png" && result.image === true,
    JSON.stringify(result),
  );
  check(
    "and the document did NOT adopt the image's handle",
    save.currentFileHandle() === null,
    "a later Save would have written JSON into a .png",
  );
}

console.log("\n  cancelling the panel does nothing\n");

{
  save.forgetFileHandle();

  const calls = fakePicker("cancel");

  let rendered = 0;

  const result = await save.saveAs(BODY, "Beam.tex", {
    renderImage: async () => {
      rendered++;
      return new Blob(["img"]);
    },
  });

  check(
    "the result is null",
    result === null,
    JSON.stringify(result),
  );
  check(
    "nothing was rendered",
    rendered === 0,
    "a cancelled save must not render an image",
  );
  check(
    "and the document still has no handle",
    save.currentFileHandle() === null,
  );
}

console.log("\n  a failed render is reported, not silently saved\n");

{
  save.forgetFileHandle();

  fakePicker("Beam.png");

  const result = await save.saveAs(BODY, "Beam.tex", {
    renderImage: async () => null,
  });

  check(
    "an unrenderable image reports an error",
    result && typeof result.error === "string",
    JSON.stringify(result),
  );
  check(
    "and does not adopt a document handle",
    save.currentFileHandle() === null,
  );
}

console.log("\n  Save writes the DOCUMENT to the remembered file\n");

{
  save.forgetFileHandle();
  save.setFileHandle({
    name: "Beam.tex",
    createWritable: async () => ({
      write: async (blob) => {
        lastWritten = blob;
      },
      close: async () => {},
    }),
  });

  let lastWritten = null;

  const name = await save.save(BODY);

  check(
    "Save returns the file's name",
    name === "Beam.tex",
    String(name),
  );
  check(
    "and writes a document, never an image",
    lastWritten && lastWritten.type === file.MEDIA_TYPE,
    lastWritten ? lastWritten.type : "nothing written",
  );
}

console.log("\n  with no handle, Save asks the caller to do a Save As\n");

{
  save.forgetFileHandle();

  const name = await save.save(BODY);

  check(
    "Save returns null, so Save As runs instead",
    name === null,
    String(name),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
