// DPS metric engine: raw DPS, rDPS, aDPS, nDPS, cDPS.
// Rule reproduced exactly against FFLogs data (see docs/metrics.md).
// Works in Node (require) and in the browser (window.DpsEngine).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DpsEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Split one hit's buff-given extra damage between the buffs that caused it.
  // `buffs` must only hold damage buffs given by OTHER players: [{mult, giver, single, ...}].
  // Returns the same objects plus `share` (damage credited to that buff).
  function splitHit(amount, buffs) {
    if (buffs.length === 0) return [];
    let M = 1;
    for (const b of buffs) M *= b.mult; // all multipliers combine by multiplication
    const pool = amount * (1 - 1 / M); // total extra damage those buffs added
    const lnM = Math.log(M);
    // Each buff gets a logarithmic share of the pool.
    return buffs.map((b) => ({ ...b, share: (pool * Math.log(b.mult)) / lnM }));
  }

  class DpsEngine {
    // table: the parsed data/buffs.json (only its "verified" list is used)
    constructor(table) {
      this.buffs = new Map(); // statusId -> {name, mult, single}
      for (const b of table.verified) {
        this.buffs.set(b.statusId, { name: b.name, mult: 1 + b.percent / 100, single: b.scope === "single" });
      }
      this.players = new Map();
    }

    _p(id) {
      if (!this.players.has(id)) this.players.set(id, { raw: 0, taken: 0, given: 0, singleRemoved: 0 });
      return this.players.get(id);
    }

    // One damage hit. `source` is the owner player id (pets already mapped to owner).
    // `active` lists buffs on the hitter: [{statusId, giver}] (giver = player id who applied it).
    addHit(source, amount, active) {
      const me = this._p(source);
      me.raw += amount;
      const others = [];
      for (const a of active) {
        const def = this.buffs.get(a.statusId);
        // Self buffs, and party buffs you cast on yourself, are ignored by the rule.
        if (!def || a.giver == null || a.giver === source) continue;
        others.push({ ...def, giver: a.giver });
      }
      for (const s of splitHit(amount, others)) {
        me.taken += s.share;
        this._p(s.giver).given += s.share;
        if (s.single) me.singleRemoved += s.share; // aDPS also removes these
      }
    }

    // `seconds` = fight length. Returns everything per second.
    metrics(player, seconds) {
      const p = this._p(player);
      const adps = (p.raw - p.singleRemoved) / seconds;
      return {
        raw: p.raw / seconds,
        rdps: (p.raw - p.taken + p.given) / seconds,
        ndps: (p.raw - p.taken) / seconds,
        adps,
        cdps: adps + p.given / seconds,
      };
    }

    totals(player) {
      return { ...this._p(player) };
    }
  }

  return { DpsEngine, splitHit };
});
