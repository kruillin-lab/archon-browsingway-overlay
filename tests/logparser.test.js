const test = require("node:test");
const assert = require("node:assert");
const { LogParser, decodeDamage } = require("../web/logparser.js");
const table = require("../data/buffs.json");

test("normal damage uses the first two bytes", () => {
  assert.strictEqual(decodeDamage("3D0000"), 0x3d); // 61
  assert.strictEqual(decodeDamage("47280000"), 0x4728); // 18216, LogGuide example 1
});

test("a lot of damage (third byte 0x40) uses bytes D A B", () => {
  assert.strictEqual(decodeDamage("423F400F"), 999999); // LogGuide example
  // LogGuide example 2 says 82538, but its own bytes (01 42 6B) add up to 82539; the guide is off by one.
  assert.strictEqual(decodeDamage("426B4001"), 82539);
});

// Build a fake ability line: 54 fields, damage pair at fields 8 and 9.
function ability(source, target, flags, value, owner = "E0000000") {
  const f = new Array(54).fill("0");
  Object.assign(f, { 0: "21", 2: source, 3: "Src", 6: target, 7: "Tgt", 8: flags, 9: value, 47: owner });
  return f;
}
function status(kind, statusIdHex, giver, target) {
  const f = new Array(12).fill("0");
  Object.assign(f, { 0: kind, 2: statusIdHex, 3: "S", 5: giver, 6: "G", 7: target, 8: "T" });
  return f;
}

test("a buff from another player moves damage from taken to given", () => {
  const p = new LogParser(table);
  p.ingest(status("26", "756", "1000000B", "10000001")); // 0x756 = 1878 Divination from player B onto player A
  p.ingest(ability("10000001", "40000001", "710003", "27BC0000")); // 0x27BC = 10172 damage, no big mask
  const a = p.engine.totals("10000001");
  assert.strictEqual(a.raw, 0x27bc);
  assert.ok(a.taken > 0);
  assert.ok(Math.abs(p.engine.totals("1000000B").given - a.taken) < 1e-9);
});

test("pet damage counts for its owner; hits on players are ignored", () => {
  const p = new LogParser(table);
  p.ingest(ability("40000099", "40000001", "710003", "03E80000", "10000001")); // 1000 dmg by pet of A
  assert.strictEqual(p.engine.totals("10000001").raw, 1000);
  p.ingest(ability("40000001", "10000001", "710003", "03E80000")); // boss hits a player
  assert.strictEqual(p.hits, 1);
});

test("removing a status stops it counting", () => {
  const p = new LogParser(table);
  p.ingest(status("26", "756", "1000000B", "10000001"));
  p.ingest(status("30", "756", "1000000B", "10000001"));
  p.ingest(ability("10000001", "40000001", "710003", "27BC0000"));
  assert.strictEqual(p.engine.totals("10000001").taken, 0);
});

test("DoT ticks count for the named source player", () => {
  const p = new LogParser(table);
  const f = new Array(30).fill("0");
  Object.assign(f, { 0: "24", 2: "40000001", 3: "Boss", 4: "DoT", 6: "3E8", 17: "10000001", 18: "Src" }); // 0x3E8 = 1000
  p.ingest(f);
  assert.strictEqual(p.engine.totals("10000001").raw, 1000);
  f[4] = "HoT";
  p.ingest(f); // healing is ignored
  assert.strictEqual(p.engine.totals("10000001").raw, 1000);
});
