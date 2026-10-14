#!/usr/bin/env python3
"""Build nfl-rosters.json for Retro Football from nflverse's public weekly roster file.

The game loads this file from the same site (fast, no CORS), and runs its normal
roster logic on it. Only the latest row per player for the season is kept, with
just the columns the game uses, so the file stays small.

Usage:  python3 scripts/build_rosters.py [season]
"""
import csv, io, json, sys, urllib.request, datetime

SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
URL = f"https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{SEASON}.csv"
KEEP = ["season", "week", "team", "status", "full_name", "first_name", "last_name", "position",
        "years_exp", "jersey_number", "birth_date", "gsis_id", "espn_id"]

def ident(r):
    return r.get("gsis_id") or r.get("espn_id") or (r.get("full_name") or "").lower()

def main():
    raw = urllib.request.urlopen(URL, timeout=120).read().decode("utf-8")
    latest = {}
    for r in csv.DictReader(io.StringIO(raw)):
        if str(r.get("season")) != str(SEASON) or not r.get("full_name"):
            continue
        k = ident(r)
        wk = int(r.get("week") or 0)
        old = latest.get(k)
        if old is None or wk >= int(old.get("week") or 0):
            latest[k] = r
    rows = [{c: r.get(c, "") for c in KEEP} for r in latest.values()]
    rows.sort(key=lambda r: (r["team"], r["position"], r["full_name"]))
    out = {"season": SEASON, "builtAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z",
           "source": "nflverse weekly_rosters", "rows": rows}
    with open("nfl-rosters.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    teams = len({r["team"] for r in rows if r["team"]})
    print(f"wrote nfl-rosters.json: {len(rows)} players, {teams} teams, max week {max(int(r['week'] or 0) for r in rows)}")

if __name__ == "__main__":
    main()
