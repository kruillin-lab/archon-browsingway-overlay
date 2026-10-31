# DPS metrics we need to reproduce

Status: DRAFT. Official FFLogs formulas are not verified yet (FFLogs and Archon
guide pages block automated reading). Phase 0 verifies this file against the
FFLogs v2 API using real reports.

## Definitions (plain words)
- raw DPS: your damage / fight time.
- rDPS: raw DPS, minus damage your damage got from OTHER players' buffs, plus
  damage your buffs gave to OTHER players.
- aDPS: raw DPS minus damage you got from other players' buffs. You get no
  credit for buffs you give.
- nDPS, cDPS: variants of the above. Exact rules UNVERIFIED. Do not guess; fill
  in from the official guide or API comparison.

## Known math (community, unverified against FFLogs)
Damage buffs multiply. If a hit did D with buff multiplier m, the buff's share
is D - D/m (for one buff). Several buffs split the extra damage between them
(FFLogs uses a log-based split; see the 2019 forum thread "A matter in rdps
calculation" for a worked example and a proposed fix for crit buffs).

Crit/direct-hit buffs (Chain Stratagem, Battle Litany, Devilment, Battle Voice)
raise a chance, not a multiplier. On a crit they are credited a fraction of the
hit based on how much of your crit chance came from the buff.

Stat formulas (per-level constants change by patch; verify for current level):
- crit rate, crit multiplier, direct hit rate, determination: see Allagan Studies.
