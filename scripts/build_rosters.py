#!/usr/bin/env python3
"""Build nfl-rosters.json for Retro Football from nflverse's public weekly roster file.

The game loads this file from the same site (fast, no CORS), and runs its normal
roster logic on it. Only the latest row per player for the season is kept, with
just the columns the game uses, so the file stays small.

Usage:  python3 scripts/build_rosters.py [season]
"""
import csv, io, json, os, sys, urllib.request, datetime

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SEASON = int(ARGS[0]) if ARGS else 2026
LOOKS = "--looks" in sys.argv
URL = f"https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{SEASON}.csv"
DEPTH_URL = f"https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_{SEASON}.csv"
GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
KEEP = ["season", "week", "team", "status", "full_name", "first_name", "last_name", "position",
        "years_exp", "jersey_number", "birth_date", "gsis_id", "espn_id", "headshot_url", "draft_number"]

def get(url):
    return urllib.request.urlopen(url, timeout=180).read().decode("utf-8")

def depth_ranks():
    """Latest depth chart per team -> {gsis_id or espn_id: (rank, pos_abb)} (rank 1 = starter)."""
    try:
        rows = list(csv.DictReader(io.StringIO(get(DEPTH_URL))))
    except Exception as e:
        print("depth charts unavailable:", e); return {}
    last = {}
    for r in rows:
        if r["dt"] > last.get(r["team"], ""): last[r["team"]] = r["dt"]
    out = {}
    for r in rows:
        if r["dt"] != last[r["team"]]: continue
        if r["pos_abb"] in ("FB", "KR", "PR", "H", "LS"): continue   # special-teams / fullback slots aren't starters here
        try: rk = int(r["pos_rank"])
        except ValueError: continue
        for k in (r.get("gsis_id"), r.get("espn_id")):
            if k and (k not in out or rk < out[k][0]): out[k] = (rk, r["pos_abb"])
    return out

def stat_url(season):
    return f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_{season}.csv"

def production():
    """Per-game production score by position from real stats, this season blended with last
    season (last season fades out as games are played), turned into a percentile 0..1 within
    each position. Offensive line has no individual stats, so OL get no score."""
    def load(season):
        try: return {r["player_id"]: r for r in csv.DictReader(io.StringIO(get(stat_url(season))))}
        except Exception as e: print("stats unavailable", season, e); return {}
    cur, prev = load(SEASON), load(SEASON - 1)
    f = lambda r, k: float(r.get(k) or 0)
    def score(r, pos):
        g = max(1.0, f(r, "games"))
        if pos == "QB": v = f(r,"passing_yards")/25 + f(r,"passing_tds")*4 - f(r,"passing_interceptions")*2 + f(r,"rushing_yards")/10 + f(r,"rushing_tds")*6 + (f(r,"passing_epa")+f(r,"rushing_epa"))*0.3
        elif pos == "RB": v = f(r,"rushing_yards")/10 + f(r,"rushing_tds")*6 + f(r,"receptions")*0.5 + f(r,"receiving_yards")/10 + f(r,"receiving_tds")*6 + (f(r,"rushing_epa")+f(r,"receiving_epa"))*0.3
        elif pos in ("WR", "TE"): v = f(r,"receptions")*0.5 + f(r,"receiving_yards")/10 + f(r,"receiving_tds")*6 + f(r,"receiving_epa")*0.3
        elif pos == "DL": v = f(r,"def_sacks")*4 + f(r,"def_tackles_for_loss")*1.5 + f(r,"def_qb_hits") + (f(r,"def_tackles_solo")+f(r,"def_tackle_assists")*0.5)*0.4 + f(r,"def_fumbles_forced")*3 + f(r,"def_pass_defended")
        elif pos == "LB": v = (f(r,"def_tackles_solo")+f(r,"def_tackle_assists")*0.5)*0.6 + f(r,"def_sacks")*4 + f(r,"def_tackles_for_loss")*1.5 + f(r,"def_interceptions")*5 + f(r,"def_pass_defended")*1.5 + f(r,"def_fumbles_forced")*3
        elif pos == "DB": v = f(r,"def_interceptions")*6 + f(r,"def_pass_defended")*2.5 + (f(r,"def_tackles_solo")+f(r,"def_tackle_assists")*0.5)*0.4 + f(r,"def_fumbles_forced")*3 + f(r,"def_tds")*6
        elif pos == "K": v = f(r,"fg_made")*3 - f(r,"fg_missed")*2.5
        else: return None, 0
        return v/g, f(r, "games")
    POS = {"QB":"QB","RB":"RB","FB":"RB","WR":"WR","TE":"TE","DE":"DL","DT":"DL","NT":"DL","DL":"DL","LB":"LB","ILB":"LB","OLB":"LB","MLB":"LB","CB":"DB","S":"DB","SS":"DB","FS":"DB","DB":"DB","K":"K","PK":"K"}
    vals = {}
    for pid in set(cur) | set(prev):
        r = cur.get(pid) or prev.get(pid); pos = POS.get(r.get("position", ""))
        if not pos: continue
        a, ga = score(cur[pid], pos) if pid in cur else (None, 0)
        b, gb = score(prev[pid], pos) if pid in prev else (None, 0)
        if a is None and b is None: continue
        w = ga/(ga+4) if a is not None else 0
        v = a if b is None else b if a is None else w*a + (1-w)*b
        if ga + gb < 3: continue                     # too small a sample to judge
        vals.setdefault(pos, []).append((v, pid))
    out = {}
    for pos, lst in vals.items():
        lst.sort()
        n = len(lst)
        for i, (v, pid) in enumerate(lst): out[pid] = round((i + 0.5)/n, 3)
    return out

def team_power():
    """Point margin per game (60%) blended with the betting-line implied margin (40%)."""
    try:
        games = [g for g in csv.DictReader(io.StringIO(get(GAMES_URL))) if g["season"] == str(SEASON) and g["game_type"] == "REG"]
    except Exception as e:
        print("schedule unavailable:", e); return {}
    pd, line = {}, {}
    for g in games:
        h, a = g["home_team"], g["away_team"]
        if g["spread_line"]:
            s = float(g["spread_line"]); line.setdefault(h, []).append(s); line.setdefault(a, []).append(-s)
        if g["home_score"] and g["away_score"]:
            m = int(g["home_score"]) - int(g["away_score"]); pd.setdefault(h, []).append(m); pd.setdefault(a, []).append(-m)
    avg = lambda v: sum(v)/len(v) if v else 0.0
    out = {}
    for t in set(pd) | set(line):
        p, l = avg(pd.get(t, [])), avg(line.get(t, []))
        w = min(1.0, len(pd.get(t, []))/6)*0.6          # trust results more as the season goes on
        out[t] = round(w*p + (1-w)*l, 2)
    return out

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
    # A player whose last appearance is older than his team's current week is no longer on
    # that roster (released / waived) -> he is a free agent now.
    team_wk = {}
    for r in latest.values():
        t = r.get("team") or ""
        team_wk[t] = max(team_wk.get(t, 0), int(r.get("week") or 0))
    cut = 0
    for r in latest.values():
        t = r.get("team") or ""
        if t and int(r.get("week") or 0) < team_wk[t]:
            r["team"], r["status"] = "", "CUT"; cut += 1
    rows = [{c: r.get(c, "") for c in KEEP} for r in latest.values()]
    dr = depth_ranks()
    for r in rows:
        d = dr.get(r.get("gsis_id")) or dr.get(r.get("espn_id"))
        if d and r["team"]: r["depth"], r["dpos"] = d
    perf = production()
    for r in rows:
        if r.get("gsis_id") in perf: r["perf"] = perf[r["gsis_id"]]
    print(f"production percentile for {sum(1 for r in rows if 'perf' in r)} players")
    print(f"{cut} released players moved to free agency; depth chart entries matched: {sum(1 for r in rows if 'depth' in r)}")
    rows.sort(key=lambda r: (r["team"], r["position"], r["full_name"]))
    out = {"season": SEASON, "builtAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z",
           "source": "nflverse weekly_rosters + depth_charts + schedules", "teamPower": team_power(), "rows": rows}
    # attach the estimated look for each player's headshot (see build_looks.py)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import build_looks
        if LOOKS: build_looks.update(rows)
        looks = json.load(open("nfl-looks.json"))
        for r in rows:
            raw = looks.get(r.get("headshot_url"))
            if isinstance(raw, dict) and raw.get("v") == 2: r["look"] = build_looks.finalize(raw)
    except (FileNotFoundError, ImportError):
        pass
    for r in rows: r.pop("headshot_url", None)
    with open("nfl-rosters.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    teams = len({r["team"] for r in rows if r["team"]})
    print(f"wrote nfl-rosters.json: {len(rows)} players, {teams} teams, max week {max(int(r['week'] or 0) for r in rows)}")

if __name__ == "__main__":
    main()
