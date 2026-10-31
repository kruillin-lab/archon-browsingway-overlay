#!/usr/bin/env python3
"""Pull DPS numbers for one FFLogs report so we can compare them to our own math.

Usage: python3 tools/fflogs_check.py REPORT_CODE [FIGHT_ID]
  REPORT_CODE is the part after /reports/ in a report link.
  FIGHT_ID is optional; without it the script lists the fights and uses the last one.

Needs ~/.config/archon-overlay/fflogs.env with FFLOGS_CLIENT_ID and FFLOGS_CLIENT_SECRET.
Uses only the Python standard library, so nothing to install.
"""
import base64
import json
import os
import sys
import urllib.request

TOKEN_URL = "https://www.fflogs.com/oauth/token"
API_URL = "https://www.fflogs.com/api/v2/client"
ENV_FILE = os.path.expanduser("~/.config/archon-overlay/fflogs.env")


def load_credentials():
    # The env file is plain KEY=VALUE lines written by the setup command.
    values = {}
    with open(ENV_FILE) as f:
        for line in f:
            if "=" in line:
                key, _, val = line.strip().partition("=")
                values[key] = val
    return values["FFLOGS_CLIENT_ID"], values["FFLOGS_CLIENT_SECRET"]


def get_token(client_id, client_secret):
    # OAuth "client credentials": trade the ID + secret for a short-lived access token.
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=b"grant_type=client_credentials",
        headers={"Authorization": f"Basic {basic}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["access_token"]


def graphql(token, query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)
    if "errors" in data:
        sys.exit("FFLogs API error: " + json.dumps(data["errors"], indent=2))
    return data["data"]


FIGHTS_QUERY = """
query($code: String!) {
  reportData { report(code: $code) {
    title
    fights { id name kill startTime endTime }
  } }
}
"""

TABLE_QUERY = """
query($code: String!, $fight: Int!) {
  reportData { report(code: $code) {
    table(dataType: DamageDone, fightIDs: [$fight])
  } }
}
"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    code = sys.argv[1]
    client_id, client_secret = load_credentials()
    token = get_token(client_id, client_secret)

    report = graphql(token, FIGHTS_QUERY, {"code": code})["reportData"]["report"]
    print(f"Report: {report['title']}")
    fights = [f for f in report["fights"] if f["endTime"] > f["startTime"]]
    for f in fights:
        secs = (f["endTime"] - f["startTime"]) / 1000
        print(f"  fight {f['id']:>3}  {f['name']:<30} {secs:6.0f}s  kill={f['kill']}")

    fight_id = int(sys.argv[2]) if len(sys.argv) > 2 else fights[-1]["id"]
    print(f"\nUsing fight {fight_id}\n")

    table = graphql(token, TABLE_QUERY, {"code": code, "fight": fight_id})
    table = table["reportData"]["report"]["table"]["data"]
    entries = table["entries"]

    # We do not yet know every metric field name FFLogs returns, so show every
    # field whose name mentions "dps" plus the plain total. This is how we
    # discover the exact names for rDPS, aDPS, nDPS and cDPS.
    seconds = table.get("totalTime", 0) / 1000
    for e in sorted(entries, key=lambda x: -x.get("total", 0)):
        dps_fields = {k: v for k, v in e.items() if "dps" in k.lower()}
        raw = e["total"] / seconds if seconds else 0
        print(f"{e['name']:<22}{e.get('type', ''):<14} raw={raw:9.1f}  {dps_fields}")

    # Save the full raw answer so later scripts and tests can reuse it offline.
    out = os.path.join(os.path.dirname(__file__), f"sample_{code}_{fight_id}.json")
    with open(out, "w") as f:
        json.dump(table, f, indent=2)
    print(f"\nSaved full response to {out}")


if __name__ == "__main__":
    main()
