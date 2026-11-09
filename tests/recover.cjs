/* Find the lost creation-drag.js blob by content. */
const { execFileSync } = require("child_process");
const fs = require("fs");

const root = "c:\\Users\\eeyei\\OneDrive\\Desktop\\Assignment_Marker";

const cand = fs
  .readFileSync(`${root}\\tests\\.cand.txt`, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.split(" "));

let found = 0;

for (const [hash, size] of cand) {
  let body;

  try {
    body = execFileSync("git", ["cat-file", "-p", hash], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
  } catch (error) {
    continue;
  }

  if (body.includes("mathStroke") && body.includes("finishCreationDrag")) {
    fs.writeFileSync(`${root}\\tests\\.recovered-${hash}.js`, body);
    console.log(`MATCH ${hash} size=${size}`);
    found += 1;
  }
}

console.log("found", found);
