#!/usr/bin/env node
// Bundle the overlay into ONE file (dist/overlay.html) so Browsingway can load it from
// disk or any web address with nothing else to fetch.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
// The parser file does require("./engine.js") in Node; in the browser it reads a global.
const html = read("web/index.src.html")
  .replace("/*BUFFS*/", () => JSON.stringify(JSON.parse(read("data/buffs.json"))))
  .replace("/*ENGINE*/", () => read("web/engine.js"))
  .replace("/*PARSER*/", () => read("web/logparser.js"))
  .replace("/*APP*/", () => read("web/app.js"));
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/overlay.html"), html);
console.log(`wrote dist/overlay.html (${(html.length / 1024).toFixed(0)} KB)`);
