import { execFileSync } from "node:child_process";

const bin =
  "C:/Users/eeyei/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const out = execFileSync(
  process.execPath,
  [
    "C:/Users/eeyei/.codegpt/skills/browser-automation/browser.mjs",
    "http://localhost:5173/",
    "--script",
    "./zz-tab-check.mjs",
    "--screenshot",
    "./zz-tab.png",
  ],
  {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: "0",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: bin,
    },
    encoding: "utf8",
  },
);
console.log(out);
