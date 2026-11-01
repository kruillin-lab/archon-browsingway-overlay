#!/usr/bin/env node
// Check the engine against FFLogs: feed it a fight's raw FFLogs events and compare
// to FFLogs' own totals.
// Usage: node tools/verify_fight.js EVENTS.json EXPECTED.json
//   EVENTS.json   written by tools/fflogs_events.py
//   EXPECTED.json {"Player Name": {"rdps":..,"adps":..,"ndps":..,"cdps":..}} (total damage, not per second)
const fs = require("fs");
const path = require("path");
const { DpsEngine } = require("../web/engine.js");
const table = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/buffs.json"), "utf8"));

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expected = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

const actors = new Map(data.actors.map((a) => [a.id, a]));
const owner = (id) => (actors.get(id) && actors.get(id).petOwner) || id; // pets count for their owner
const statusOf = (gameId) => gameId - 1000000; // FFLogs prefixes status ids with 1000000

// Build "who gave which buff to whom, and when" from the buff events.
const open = new Map();
const windows = new Map(); // "target:status" -> [{start, end, giver}]
const push = (k, w) => (windows.has(k) ? windows.get(k).push(w) : windows.set(k, [w]));
for (const e of [...data.Buffs].sort((a, b) => a.timestamp - b.timestamp)) {
  const k = `${e.targetID}:${e.abilityGameID}`;
  if (e.type === "applybuff") open.set(k, { start: e.timestamp, giver: e.sourceID });
  else if (e.type === "refreshbuff") {
    if (open.has(k)) push(k, { ...open.get(k), end: e.timestamp });
    open.set(k, { start: e.timestamp, giver: e.sourceID });
  } else if (e.type === "removebuff" && open.has(k)) {
    push(k, { ...open.get(k), end: e.timestamp });
    open.delete(k);
  }
}
for (const [k, w] of open) push(k, { ...w, end: data.fight.endTime });
// Fallback: if timing is off by a bit, use whoever usually gives that buff to others.
const usual = new Map();
for (const e of data.Buffs) {
  if ((e.type === "applybuff" || e.type === "refreshbuff") && e.sourceID !== e.targetID) {
    const c = usual.get(e.abilityGameID) || new Map();
    c.set(e.sourceID, (c.get(e.sourceID) || 0) + 1);
    usual.set(e.abilityGameID, c);
  }
}
const usualGiver = (gameId) => {
  const c = usual.get(gameId);
  return c ? [...c.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
};
const giverOf = (target, gameId, t) => {
  for (const w of windows.get(`${target}:${gameId}`) || []) if (t >= w.start - 1000 && t <= w.end + 1000) return w.giver;
  return usualGiver(gameId);
};

const engine = new DpsEngine(table);
for (const e of data.DamageDone) {
  if (e.type !== "damage") continue; // 'calculateddamage' is the pre-hit preview, skip it
  const ids = (e.buffs || "").split(".").filter(Boolean).map(Number);
  const active = ids.map((gid) => ({ statusId: statusOf(gid), giver: owner(giverOf(e.sourceID, gid, e.timestamp)) }));
  engine.addHit(owner(e.sourceID), e.amount, active);
}

const seconds = (data.fight.endTime - data.fight.startTime) / 1000;
let worst = 0;
console.log(`${"player".padEnd(20)} metric   engine total    FFLogs total   diff`);
for (const [name, want] of Object.entries(expected)) {
  const a = [...actors.values()].find((x) => x.name === name && x.type === "Player" && engine.players.has(x.id));
  if (!a) { console.log(`${name}: not found`); continue; }
  const m = engine.metrics(a.id, seconds);
  for (const k of ["rdps", "adps", "ndps", "cdps"]) {
    const got = m[k] * seconds;
    const diff = got - want[k];
    worst = Math.max(worst, Math.abs(diff));
    console.log(`${name.padEnd(20)} ${k.padEnd(6)} ${got.toFixed(2).padStart(14)} ${want[k].toFixed(2).padStart(14)} ${diff.toFixed(2).padStart(8)}`);
  }
}
console.log(`\nlargest difference: ${worst.toFixed(3)} damage`);
process.exit(worst < 1 ? 0 : 1);
