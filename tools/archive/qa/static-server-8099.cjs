const http = require("http"),
  fs = require("fs"),
  p = require("path");
const T = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer((q, s) => {
    let u = decodeURIComponent(q.url.split("?")[0]);
    if (u === "/") u = "/index.html";
    const f = p.join(__dirname, u);
    fs.readFile(f, (e, d) => {
      if (e) {
        s.writeHead(404);
        return s.end("not found");
      }
      s.writeHead(200, {
        "Content-Type": T[p.extname(f)] || "application/octet-stream",
      });
      s.end(d);
    });
  })
  .listen(8099, () => console.log("serving on 8099"));
