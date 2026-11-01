// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const { DpsEngine, splitHit } = require("../web/engine.js");
const table = require("../data/buffs.json");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("one buff alone gets hit * (1 - 1/m)", () => {
  const [s] = splitHit(1060, [{ mult: 1.06 }]);
  near(s.share, 60);
});

test("two buffs split the pool by logarithm and add up to the pool", () => {
  const out = splitHit(1113, [{ mult: 1.05 }, { mult: 1.06 }]);
  near(out[0].share + out[1].share, 113); // 1113 * (1 - 1/1.113)
  assert.ok(out[1].share > out[0].share); // the bigger buff gets more
});

test("rule: self-given party buffs and unknown buffs are ignored", () => {
  const e = new DpsEngine(table);
  e.addHit("A", 1000, [{ statusId: 1878, giver: "A" }, { statusId: 99999, giver: "B" }]);
  const t = e.totals("A");
  assert.strictEqual(t.taken, 0);
  assert.strictEqual(e.totals("B").given, 0);
});

test("taken for the hitter equals given for the buff owner", () => {
  const e = new DpsEngine(table);
  e.addHit("A", 1060, [{ statusId: 1878, giver: "B" }]); // Divination from B
  near(e.totals("A").taken, 60);
  near(e.totals("B").given, 60);
  const m = e.metrics("A", 1);
  near(m.rdps, 1000); near(m.ndps, 1000); near(m.raw, 1060);
  near(m.adps, 1060); // Divination is not a single-target buff, aDPS keeps it
});

test("single-target buffs (cards) are removed from aDPS", () => {
  const e = new DpsEngine(table);
  e.addHit("A", 1060, [{ statusId: 3887, giver: "B" }]); // The Balance from B
  const m = e.metrics("A", 1);
  near(m.adps, 1000);
  near(m.cdps, 1000); // cDPS = aDPS + given, and A gave nothing here
  near(e.metrics("B", 1).cdps, 0 + 60);
});
