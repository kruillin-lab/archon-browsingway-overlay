#!/usr/bin/env node
// Replay a saved Network_*.log through the parser and print the biggest fights' numbers.
// Usage: node tools/runlog.js LOGFILE
const fs = require("fs");
const readline = require("readline");
const path = require("path");
const { LogParser } = require("../web/logparser.js");
const table = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/buffs.json"), "utf8"));

(async () => {
  const parser = new LogParser(table);
  const encounters = [];
  let start = null, last = null, inCombat = false;
  const finish = () => {
    if (start === null || parser.hits === 0) return;
    const secs = (last - start) / 1000;
    if (secs < 20) return; // ignore tiny fights
    const rows = [...parser.engine.players.keys()].map((id) => ({ name: parser.names.get(id) || id, ...parser.engine.metrics(id, secs), given: parser.engine.totals(id).given / secs }));
    rows.sort((a, b) => b.rdps - a.rdps);
    encounters.push({ start, secs, rows });
  };
  const rl = readline.createInterface({ input: fs.createReadStream(process.argv[2]), crlfDelay: Infinity });
  for await (const line of rl) {
    const f = line.split("|");
    if (f[0] === "260") { // InCombat: f[2] = in ACT combat ("1"/"0"), f[3] = in game combat
      const now = f[3] === "1";
      if (now && !inCombat) { parser.reset(); start = Date.parse(f[1]); }
      if (!now && inCombat) { last = Date.parse(f[1]); finish(); start = null; }
      inCombat = now;
      continue;
    }
    if (f[1]) last = Date.parse(f[1]);
    parser.ingest(f);
  }
  encounters.sort((a, b) => b.secs - a.secs);
  for (const e of encounters.slice(0, 3)) {
    console.log(`\nFight at ${new Date(e.start).toISOString()}  ${e.secs.toFixed(0)}s`);
    console.log("name                    raw     rDPS     aDPS     nDPS     cDPS");
    for (const r of e.rows.slice(0, 8)) console.log(`${String(r.name).padEnd(20)} ${[r.raw, r.rdps, r.adps, r.ndps, r.cdps].map((x) => x.toFixed(0).padStart(8)).join(" ")}`);
  }
  console.log(`\n${encounters.length} fights of 20s or more`);
})();
