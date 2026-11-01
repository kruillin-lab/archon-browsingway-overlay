// Fight-splitting rules in web/app.js, run with fake browser objects.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ME = "10000001";

function loadOverlay() {
  const els = {};
  const sandbox = {
    location: { search: "" }, URLSearchParams, console,
    document: { getElementById: (id) => (els[id] ||= { textContent: "", innerHTML: "" }), addEventListener() {} },
    WebSocket: class { send() {} close() {} }, setInterval() {}, setTimeout() {},
    BUFF_TABLE: JSON.parse(fs.readFileSync(path.join(ROOT, "data/buffs.json"), "utf8")),
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ["web/engine.js", "web/logparser.js", "web/app.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox);
  }
  const { onLine, onEvent, render } = sandbox.overlayDebug;
  const hits = () => { render(); return Number(els.debug.textContent.split(" ")[0]); };
  const rows = () => { render(); return (els.body.innerHTML.match(/<tr>/g) || []).length; };
  return { onLine, onEvent, hits, rows };
}

const at = (secs) => new Date(Date.UTC(2026, 10, 1, 12, 0, secs)).toISOString();
function ability(secs, { source = ME, target = "40000001", flags = "3", value = "10000000" } = {}) {
  const f = new Array(54).fill("0");
  Object.assign(f, { 0: "21", 1: at(secs), 2: source, 3: "Someone", 6: target, 7: "Dummy", 8: flags, 9: value, 47: "E0000000" });
  return f;
}
const combatFlag = (secs, game) => ["260", at(secs), "1", game, "0", "1"];

test("combat flag flickering mid-fight does not wipe the numbers", () => {
  const { onLine, hits } = loadOverlay();
  onLine(combatFlag(0, "1"));
  onLine(ability(1));
  onLine(combatFlag(2, "0"));
  onLine(combatFlag(3, "1"));
  onLine(ability(4));
  assert.strictEqual(hits(), 2);
});

test("a non-damage ability after a long quiet leaves the old numbers frozen", () => {
  const { onLine, hits } = loadOverlay();
  onLine(ability(1));
  onLine(ability(40, { source: "10000002", target: "10000002", flags: "4", value: "5000000" })); // a heal
  assert.strictEqual(hits(), 1);
});

test("real damage after a long quiet starts a new fight", () => {
  const { onLine, hits } = loadOverlay();
  onLine(ability(1));
  onLine(ability(2));
  onLine(ability(40));
  assert.strictEqual(hits(), 1);
});

test("damage within the quiet window stays in the same fight", () => {
  const { onLine, hits } = loadOverlay();
  onLine(ability(1));
  onLine(ability(15));
  assert.strictEqual(hits(), 2);
});

const STRANGER = "10000099";
const IAM = { type: "ChangePrimaryPlayer", charID: 0x10000001, charName: "Me" };
const soloParty = { type: "PartyChanged", party: [{ id: ME, name: "Me", inParty: true }] };

test("a stranger's damage is not counted once the party is known", () => {
  const { onLine, onEvent, hits, rows } = loadOverlay();
  onEvent(soloParty);
  onLine(ability(1));
  onLine(ability(2, { source: STRANGER }));
  assert.strictEqual(hits(), 1);
  assert.strictEqual(rows(), 1);
});

test("a stranger's damage after a quiet does not wipe my frozen numbers", () => {
  const { onLine, onEvent, hits } = loadOverlay();
  onEvent(soloParty);
  onLine(ability(1));
  onLine(ability(2));
  onLine(ability(40, { source: STRANGER }));
  assert.strictEqual(hits(), 2);
});

test("a stranger hitting steadily does not stop my next pull starting fresh", () => {
  const { onLine, onEvent, hits } = loadOverlay();
  onEvent(soloParty);
  onLine(ability(1));
  for (let t = 5; t < 40; t += 5) onLine(ability(t, { source: STRANGER }));
  onLine(ability(40));
  assert.strictEqual(hits(), 1);
});

test("with no party list, only my own character counts", () => {
  const { onLine, onEvent, hits } = loadOverlay();
  onEvent(IAM);
  onEvent({ type: "PartyChanged", party: [] });
  onLine(ability(1));
  onLine(ability(2, { source: STRANGER }));
  assert.strictEqual(hits(), 1);
});

test("the primary-player log line also identifies me", () => {
  const { onLine, hits } = loadOverlay();
  onLine(["02", at(0), ME, "Me"]);
  onLine(ability(1));
  onLine(ability(2, { source: STRANGER }));
  assert.strictEqual(hits(), 1);
});

test("party members count, including people who are not me", () => {
  const { onLine, onEvent, hits, rows } = loadOverlay();
  onEvent({ type: "PartyChanged", party: [{ id: ME, inParty: true }, { id: "10000002", inParty: true }, { id: STRANGER, inParty: false }] });
  onLine(ability(1));
  onLine(ability(2, { source: "10000002" }));
  onLine(ability(3, { source: STRANGER }));
  assert.strictEqual(hits(), 2);
  assert.strictEqual(rows(), 2);
});

test("my pet's damage counts for me", () => {
  const { onLine, onEvent, hits } = loadOverlay();
  onEvent(soloParty);
  const pet = ability(1, { source: "40001234" });
  pet[47] = ME;
  onLine(pet);
  assert.strictEqual(hits(), 1);
});

test("an empty party-list log line does not hide everyone", () => {
  const { onLine, onEvent, rows } = loadOverlay();
  onEvent(IAM);
  onLine(["11", at(0), "0"]);
  onLine(ability(1));
  assert.strictEqual(rows(), 1);
});

test("if nobody is identified yet, nobody is hidden", () => {
  const { onLine, hits } = loadOverlay();
  onLine(ability(1));
  onLine(ability(2, { source: STRANGER }));
  assert.strictEqual(hits(), 2);
});
