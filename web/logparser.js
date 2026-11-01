// Turns IINACT / OverlayPlugin log lines into input for DpsEngine.
// Line formats come from the OverlayPlugin LogGuide (cactbot docs).
// Works in Node (require) and in the browser (window.LogParser).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.LogParser = factory(root.DpsEngine);
})(typeof self !== "undefined" ? self : this, function (engineLib) {
  "use strict";

  // The game stores damage in a packed 4-byte hex value. Examples from the LogGuide:
  //   "3D0000"   -> 0x003D0000 -> first two bytes 003D -> 61 damage
  //   "423F400F" -> third byte is 0x40 ("a lot" of damage) -> bytes D,A,B = 0F 42 3F -> 999999
  function decodeDamage(hex) {
    const v = hex.padStart(8, "0"); // always 8 hex chars = 4 bytes: A B C D
    const A = parseInt(v.slice(0, 2), 16);
    const B = parseInt(v.slice(2, 4), 16);
    const C = parseInt(v.slice(4, 6), 16);
    const D = parseInt(v.slice(6, 8), 16);
    if (C === 0x40) return (D << 16) | (A << 8) | B; // big hit: D is the top byte
    return (A << 8) | B;
  }

  // An ability line has 8 (flags, value) pairs starting at field 8. The low byte of
  // 'flags' says what kind of effect it is: 0x03 damage, 0x05 blocked, 0x06 parried.
  function damageOf(fields) {
    let total = 0;
    for (let i = 8; i < 24; i += 2) {
      const kind = parseInt(fields[i], 16) & 0xff;
      if (kind === 0x03 || kind === 0x05 || kind === 0x06) total += decodeDamage(fields[i + 1]);
    }
    return total;
  }

  // Field 47 names the player who owns a pet or summon. When there is no owner the game writes a
  // placeholder ("E0000000", "0" or "00"), so only a value that looks like a player id counts.
  function ownerOf(f) {
    return f[47] && f[47].startsWith("1") ? f[47] : f[2];
  }

  class LogParser {
    // table: parsed data/buffs.json
    constructor(table) {
      this.engine = new engineLib.DpsEngine(table);
      this.status = new Map(); // targetId -> Map(statusId -> giverId)
      this.names = new Map(); // id -> name
      this.hits = 0;
      // How many ability lines we saw and why some were not counted (shown in the overlay footer).
      this.seen = { abilityLines: 0, notEnemy: 0, noDamage: 0, notPlayer: 0 };
    }

    reset() {
      this.engine = new engineLib.DpsEngine(this.engineTable());
      this.hits = 0;
    }
    engineTable() {
      return { verified: [...this.engine.buffs].map(([statusId, b]) => ({ statusId, name: b.name, percent: Math.round((b.mult - 1) * 100), scope: b.single ? "single" : "party" })) };
    }

    // Whose damage is this line? The player's id, or null if it would not count as damage.
    // Lets the page decide about a line before it is recorded. Must agree with _ability and _dot.
    damageSource(f) {
      if (f[0] === "24") {
        const counts = f[4] === "DoT" && f[2].startsWith("4") && !!f[17] && f[17].startsWith("1") && parseInt(f[6], 16) > 0;
        return counts ? f[17] : null;
      }
      if (f[0] !== "21" && f[0] !== "22") return null;
      if (!f[6].startsWith("4") || damageOf(f) <= 0) return null;
      const owner = ownerOf(f);
      return owner.startsWith("1") ? owner : null;
    }

    // `f` = the log line already split on "|".
    ingest(f) {
      switch (f[0]) {
        case "21":
        case "22":
          return this._ability(f);
        case "24": // damage-over-time tick
          return this._dot(f);
        case "26": // status gained or refreshed
          return this._statusAdd(f);
        case "30": // status lost
          return this._statusRemove(f);
        case "03": // a combatant appeared: remember its name
          this.names.set(f[2], f[3]);
          return;
        default:
      }
    }

    // DoT ticks arrive as ONE total per target, with a single named source. The game does not say
    // how much each player's DoT contributed, so this is an approximation (FFLogs also estimates it).
    _dot(f) {
      if (f[4] !== "DoT") return; // skip healing-over-time
      const target = f[2];
      const source = f[17];
      if (!target.startsWith("4") || !source || !source.startsWith("1")) return;
      const amount = parseInt(f[6], 16); // the tick amount is plain hex, no packing
      if (!(amount > 0)) return;
      const mine = this.status.get(source);
      const active = mine ? [...mine].map(([statusId, giver]) => ({ statusId, giver })) : [];
      this.names.set(source, f[18]);
      this.engine.addHit(source, amount, active);
      this.hits++;
    }

    _statusAdd(f) {
      const statusId = parseInt(f[2], 16);
      const target = f[7];
      if (!this.status.has(target)) this.status.set(target, new Map());
      this.status.get(target).set(statusId, f[5]); // f[5] = who applied it
      this.names.set(f[5], f[6]);
      this.names.set(target, f[8]);
    }

    _statusRemove(f) {
      const m = this.status.get(f[7]);
      if (m) m.delete(parseInt(f[2], 16));
    }

    _ability(f) {
      const source = f[2];
      const target = f[6];
      this.seen.abilityLines++;
      // Count only damage to enemies (ids starting with 4). Players have ids starting with 1.
      if (!target.startsWith("4")) { this.seen.notEnemy++; return; }
      const amount = damageOf(f);
      if (amount <= 0) { this.seen.noDamage++; return; }
      // Pets and summons report their owner in field 47; their damage counts for the owner.
      const owner = ownerOf(f);
      if (!owner.startsWith("1")) { this.seen.notPlayer++; return; } // not a player's damage
      this.names.set(source, f[3]);
      const mine = this.status.get(source) || this.status.get(owner);
      const active = [];
      if (mine) {
        for (const [statusId, giver] of mine) {
          // a pet's buff giver may itself be a pet; map to its owner is not possible here,
          // so only keep givers that are players.
          active.push({ statusId, giver });
        }
      }
      this.engine.addHit(owner, amount, active);
      this.hits++;
    }
  }

  return { LogParser, decodeDamage, damageOf };
});
