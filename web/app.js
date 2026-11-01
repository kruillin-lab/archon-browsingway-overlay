// Overlay page: connects to the OverlayPlugin websocket (IINACT), feeds log lines to the
// parser, and draws a table. Everything is plain DOM, no libraries.
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const WS_URL = params.get("OVERLAY_WS") || "ws://127.0.0.1:10501/ws";
  const COLS = [
    ["raw", "DPS"], ["rdps", "rDPS"], ["adps", "aDPS"], ["ndps", "nDPS"], ["cdps", "cDPS"],
  ];
  // ?cols=rdps,adps chooses columns; clicking a header sorts by it.
  const wanted = (params.get("cols") || "raw,rdps,adps,ndps,cdps").split(",");
  const cols = COLS.filter(([k]) => wanted.includes(k));
  let sortKey = params.get("sort") || "rdps";

  let parser = new LogParser.LogParser(window.BUFF_TABLE);
  let party = null; // Set of player ids, once the game tells us the party
  let me = null; // my own player id: who counts when there is no party list
  let fightStart = null;
  let lastSeen = 0, lastHit = null, lastMsg = 0, msgs = 0;

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + "k" : Math.round(n).toString());

  // The game's "in combat" flag is not reliable enough to time a fight (it can stay on for ages),
  // so the clock runs from the first hit to the last hit, plus a short grace while hits are fresh.
  const GRACE_MS = 3000;     // keep counting up for this long after the last hit
  const NEW_FIGHT_MS = 20000; // a hit after this much quiet starts a brand new fight
  // Only these people's damage appears or times a fight; strangers nearby are ignored.
  // If we do not know who anyone is yet, hide nobody.
  function counts(id) {
    if (party) return party.has(id);
    return me ? id === me : true;
  }
  const toParty = (ids) => (ids.length > 0 ? new Set(ids) : null);

  function seconds() {
    if (fightStart === null) return 0;
    const end = lastHit !== null && lastSeen - lastHit > GRACE_MS ? lastHit : lastSeen;
    return Math.max(3, (end - fightStart) / 1000); // never divide by less than 3s: the first hit would look huge
  }

  function render() {
    const s = seconds();
    $("timer").textContent = fightStart === null ? "waiting for combat" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const rows = [];
    for (const id of parser.engine.players.keys()) {
      if (!counts(id)) continue;
      const m = parser.engine.metrics(id, s || 3);
      if (m.raw <= 0 && parser.engine.totals(id).given <= 0) continue;
      rows.push({ id, name: parser.names.get(id) || id, ...m });
    }
    rows.sort((a, b) => b[sortKey] - a[sortKey]);
    const ago = lastMsg ? Math.round((Date.now() - lastMsg) / 1000) : "-";
    $("debug").textContent = `${parser.hits} hits, ${s.toFixed(0)}s, ${msgs} lines, last data ${ago}s ago | ability lines ${parser.seen.abilityLines} (not enemy ${parser.seen.notEnemy}, zero ${parser.seen.noDamage}, not player ${parser.seen.notPlayer})`;
    $("head").innerHTML = `<th class="name">Player</th>` + cols.map(([k, label]) => `<th data-k="${k}" class="${k === sortKey ? "on" : ""}">${label}</th>`).join("");
    $("body").innerHTML = rows
      .map((r) => `<tr><td class="name">${r.name.replace(/</g, "&lt;")}</td>` + cols.map(([k]) => `<td class="${k === sortKey ? "on" : ""}">${fmt(r[k])}</td>`).join("") + "</tr>")
      .join("");
  }

  function onLine(f) {
    if (f[1]) {
      const t = Date.parse(f[1]);
      if (!Number.isNaN(t)) lastSeen = t;
    }
    if (f[0] === "11") { // party list: count, then ids
      party = toParty(f.slice(3, 3 + parseInt(f[2], 10)));
      return;
    }
    if (f[0] === "02") { me = f[2]; return; } // the log names my character
    if (f[0] === "260") return; // game combat flag: it flickers mid-fight and can stick on, so it never splits fights
    // A new pull starts after a quiet gap: the clock restarts at its first hit.
    // Only real damage from people who count: a heal, a sprint or a stranger must not wipe the frozen numbers.
    const source = parser.damageSource(f);
    if (source && !counts(source)) return;
    if (source && lastHit !== null && lastSeen - lastHit > NEW_FIGHT_MS) { parser.reset(); fightStart = null; }
    const before = parser.hits;
    parser.ingest(f);
    if (parser.hits > before) {
      lastHit = lastSeen;
      if (fightStart === null) fightStart = lastSeen;
    }
  }

  // IINACT sends these as soon as we subscribe, so a page loaded mid-session still knows who is who.
  function onEvent(d) {
    if (d.type === "ChangePrimaryPlayer") me = d.charID.toString(16).toUpperCase();
    if (d.type === "PartyChanged") party = toParty(d.party.filter((p) => p.inParty).map((p) => p.id));
  }

  function connect() {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      $("status").textContent = "";
      ws.send(JSON.stringify({ call: "subscribe", events: ["LogLine", "ChangePrimaryPlayer", "PartyChanged"] }));
    };
    ws.onmessage = (m) => {
      let d;
      try { d = JSON.parse(m.data); } catch { return; }
      if (d.type === "LogLine" && Array.isArray(d.line)) {
        lastMsg = Date.now(); msgs++;
        try { onLine(d.line); } catch (err) { $("status").textContent = "error: " + err.message; }
      } else {
        try { onEvent(d); } catch (err) { $("status").textContent = "error: " + err.message; }
      }
    };
    ws.onclose = () => {
      $("status").textContent = "not connected to IINACT, retrying…";
      setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
  }

  // ?demo=1 shows made-up numbers so you can see the layout without the game.
  function demo() {
    const A = "10000001", B = "10000002", C = "10000003";
    let t = Date.now();
    const line = (a) => { a[1] = new Date(t).toISOString(); return a; };
    const ability = (src, dmg) => { const f = new Array(54).fill("0"); Object.assign(f, { 0: "21", 2: src, 3: names[src], 6: "40000001", 7: "Boss", 8: "710003", 9: dmg, 47: "E0000000" }); return line(f); };
    const status = (id, giver, target) => { const f = new Array(12).fill("0"); Object.assign(f, { 0: "26", 2: id, 3: "S", 5: giver, 6: names[giver], 7: target, 8: names[target] }); return line(f); };
    const names = { [A]: "Warrior Example", [B]: "Astrologian Example", [C]: "Ninja Example" };
    onLine(line(["260", "", "1", "1", "1", "1"]));
    fightStart = t;
    onLine(status("756", B, A)); // Divination (0x756) from B onto A
    onLine(status("756", B, C));
    for (let i = 0; i < 60; i++) {
      t += 1000;
      onLine(ability(A, "27BC0000")); onLine(ability(B, "13880000")); onLine(ability(C, "1F400000"));
      if (i === 40) { onLine(line(["30", "", "756", "S", "0", B, "x", A, "y"])); onLine(line(["30", "", "756", "S", "0", B, "x", C, "y"])); }
    }
    render();
  }

  document.addEventListener("click", (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (k) { sortKey = k; render(); }
  });
  window.overlayDebug = { onLine, onEvent, render }; // handy for tests
  if (params.get("demo")) demo();
  else connect();
  // Never let one bad frame freeze the table: show the error instead.
  setInterval(() => { try { render(); } catch (err) { $("status").textContent = "error: " + err.message; } }, 500);
  render();
})();
