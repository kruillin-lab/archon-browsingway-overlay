#!/usr/bin/env python3
"""Download the raw damage and buff events of one FFLogs fight.

Usage: python3 tools/fflogs_events.py REPORT_CODE FIGHT_ID OUTPUT_FOLDER

Why: FFLogs publishes the exact per-hit events it used to compute rDPS/aDPS/nDPS/cDPS.
We feed these same events into our own math and check we get FFLogs' totals.

Needs ~/.config/archon-overlay/fflogs.env (see fflogs_check.py). Standard library only.
"""
import json
import os
import sys

# Reuse the login helpers from the sibling script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fflogs_check import load_credentials, get_token, graphql  # noqa: E402

META_QUERY = """
query($code: String!, $fight: Int!) {
  reportData { report(code: $code) {
    startTime
    fights(fightIDs: [$fight]) { id name startTime endTime }
    masterData { actors { id name type subType petOwner }
                 abilities { gameID name type } }
  } }
}
"""

EVENTS_QUERY = """
query($code: String!, $fight: Int!, $start: Float!, $end: Float!, $type: EventDataType!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end,
           dataType: $type, limit: 10000) {
      data nextPageTimestamp
    }
  } }
}
"""


def all_events(token, code, fight, start, end, data_type):
    # The API returns at most 10000 events per call; follow nextPageTimestamp until done.
    events, cursor = [], start
    while cursor is not None:
        r = graphql(token, EVENTS_QUERY, {"code": code, "fight": fight,
                                          "start": cursor, "end": end, "type": data_type})
        page = r["reportData"]["report"]["events"]
        events.extend(page["data"])
        cursor = page["nextPageTimestamp"]
        print(f"  {data_type}: {len(events)} events so far")
    return events


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    code, fight, out_dir = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    token = get_token(*load_credentials())

    meta = graphql(token, META_QUERY, {"code": code, "fight": fight})["reportData"]["report"]
    f = meta["fights"][0]
    print(f"Fight {f['id']}: {f['name']}")

    result = {"report": code, "fight": f, "reportStart": meta["startTime"],
              "actors": meta["masterData"]["actors"],
              "abilities": meta["masterData"]["abilities"]}
    for data_type in ("DamageDone", "Buffs"):
        result[data_type] = all_events(token, code, fight, f["startTime"], f["endTime"], data_type)

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"events_{code}_{fight}.json")
    with open(path, "w") as fh:
        json.dump(result, fh)
    print(f"Saved {path}")


if __name__ == "__main__":
    main()
