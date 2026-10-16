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

COMBINE_URL = "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv"
# in-game attributes per position and how much each one counts toward the overall (same weights as POSW in index.html)
POSW = {"QB":{"str":.3,"acc":.45,"spd":.25},"RB":{"spd":.4,"str":.35,"cat":.25},"WR":{"cat":.35,"spd":.35,"str":.15,"stm":.15},
        "TE":{"cat":.3,"str":.25,"blk":.25,"spd":.2},"OL":{"blk":.45,"str":.4,"stm":.15},"DL":{"tkl":.3,"str":.4,"spd":.3},
        "LB":{"tkl":.45,"str":.25,"spd":.3},"DB":{"spd":.4,"str":.2,"stm":.4},"K":{"str":.5,"kac":.5}}
GPOS = {"QB":"QB","RB":"RB","FB":"RB","HB":"RB","WR":"WR","TE":"TE","T":"OL","G":"OL","C":"OL","OT":"OL","OG":"OL","OL":"OL","IOL":"OL",
        "DE":"DL","DT":"DL","NT":"DL","DL":"DL","EDGE":"DL","LB":"LB","ILB":"LB","OLB":"LB","MLB":"LB","CB":"DB","S":"DB","SS":"DB","FS":"DB","DB":"DB","SAF":"DB","K":"K","PK":"K"}

def nkey(n):
    import re
    n = re.sub(r"[^a-z ]", "", (n or "").lower())
    return " ".join(w for w in n.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v"))

def profiles(rows):
    """Attribute profile ("tilt") per player: who is faster than he is strong, a better catcher
    than blocker, etc. Built from combine testing (40, bench, weight, jumps) and real per-play
    stats (catch rate, depth of target, completion % over expected, tackles, pass breakups...).
    Each tilt is a z-score style offset per attribute with a weighted mean of zero, so it
    reshapes a player's ratings without changing his overall (the game keeps his overall/potential)."""
    try: comb = list(csv.DictReader(io.StringIO(get(COMBINE_URL))))
    except Exception as e: print("combine unavailable:", e); comb = []
    cb = {}
    for c in comb:
        g = GPOS.get(c.get("pos", ""));k = (nkey(c.get("player_name")), g)
        if g and (k not in cb or c["season"] > cb[k]["season"]): cb[k] = c
    def load(season):
        try: return {r["player_id"]: r for r in csv.DictReader(io.StringIO(get(stat_url(season))))}
        except Exception: return {}
    seasons = [load(SEASON), load(SEASON - 1), load(SEASON - 2)]   # traits are stable: use three seasons
    fl = lambda v: float(v) if v not in (None, "", "NA") else None
    def tot(pid, k):
        a = [fl(d[pid].get(k)) for d in seasons if pid in d]
        a = [x for x in a if x is not None]
        return sum(a) if a else 0.0
    def ht(h):
        try: f, i = h.split("-"); return int(f)*12+int(i)
        except Exception: return None
    met = {}   # (pos) -> {pid: {attr: [metric values]}} raw metrics, z-scored below
    raw = {}
    for r in rows:
        pos = GPOS.get(r.get("position", "")) or GPOS.get(r.get("dpos", ""))
        if pos not in POSW: continue
        pid = r.get("gsis_id"); c = cb.get((nkey(r.get("full_name")), pos)) or {}
        forty, wt, bench, vert, broad = fl(c.get("forty")), fl(c.get("wt")), fl(c.get("bench")), fl(c.get("vertical")), fl(c.get("broad_jump"))
        m = {}
        def add(attr, name, v):
            if v is not None: m.setdefault(attr, {})[name] = v
        g = max(1.0, tot(pid, "games"))
        sp = -forty if forty else None
        if pos == "QB":
            att = tot(pid, "attempts")
            if att >= 60:
                add("acc", "cmp", tot(pid, "completions")/att); add("acc", "ypa", tot(pid, "passing_yards")/att)
                add("str", "ay", tot(pid, "passing_air_yards")/att); add("str", "p40", tot(pid, "passing_40")/att)
                add("spd", "ryg", tot(pid, "rushing_yards")/g); add("spd", "ryg2", tot(pid, "rushing_yards")/g)   # judged against other real starters
            add("spd", "40", sp)
        elif pos == "RB":
            car, tg = tot(pid, "carries"), tot(pid, "targets")
            if car >= 25: add("spd", "br", tot(pid, "rushing_20")/car); add("str", "fd", tot(pid, "rushing_first_downs")/car)
            if tg >= 10: add("cat", "cr", tot(pid, "receptions")/tg)
            if g > 1: add("cat", "rpg", tot(pid, "receptions")/g)
            add("spd", "40", sp); add("str", "wt", wt); add("str", "bp", bench)
        elif pos in ("WR", "TE"):
            tg = tot(pid, "targets")
            if tg >= 15:
                add("cat", "cr", tot(pid, "receptions")/tg)
                add("spd", "adot", tot(pid, "receiving_air_yards")/tg)
                rec = max(1.0, tot(pid, "receptions")); add("str", "yac", tot(pid, "receiving_yards_after_catch")/rec)
            if pos == "WR":
                if g > 1: add("stm", "tpg", tg/g)
                add("spd", "40", sp); add("spd", "40b", sp); add("str", "wt", wt); add("str", "bp", bench)
            else:
                add("spd", "40", sp); add("str", "wt", wt); add("str", "bp", bench); add("blk", "wt", wt)
                if g > 1: add("blk", "ntpg", -tg/g)
        elif pos == "OL":
            add("str", "bp", bench); add("str", "wt", wt); add("blk", "wt", wt); add("blk", "br", broad); add("stm", "g", g if g > 1 else None)
        elif pos in ("DL", "LB"):
            tk = tot(pid, "def_tackles_solo") + 0.5*tot(pid, "def_tackle_assists")
            if g > 1: add("tkl", "tpg", tk/g); add("tkl", "tfl", tot(pid, "def_tackles_for_loss")/g)
            if g > 1: add("spd", "spg", (tot(pid, "def_sacks") + 0.5*tot(pid, "def_qb_hits"))/g)
            add("spd", "40", sp); add("str", "wt", wt); add("str", "bp", bench)
        elif pos == "DB":
            if g > 1:
                add("stm", "cov", (2*tot(pid, "def_interceptions") + tot(pid, "def_pass_defended"))/g)
                add("str", "tpg", (tot(pid, "def_tackles_solo") + 0.5*tot(pid, "def_tackle_assists"))/g)
            add("spd", "40", sp); add("spd", "vj", vert); add("str", "wt", wt)
        elif pos == "K":
            fa = tot(pid, "fg_att")
            if fa >= 5: add("kac", "pct", tot(pid, "fg_made")/fa); add("str", "50", tot(pid, "fg_made_50_59") + 2*tot(pid, "fg_made_60_"))
        raw[ident(r)] = (pos, m)
    # z-score each metric within its position
    stats = {}
    for pos, m in raw.values():
        for attr, d in m.items():
            for name, v in d.items(): stats.setdefault((pos, attr, name), []).append(v)
    mu = {k: (sum(v)/len(v), (sum((x - sum(v)/len(v))**2 for x in v)/max(1, len(v) - 1))**0.5 or 1.0) for k, v in stats.items() if len(v) >= 8}
    out = {}
    for key, (pos, m) in raw.items():
        z = {}
        for attr in POSW[pos]:
            zs = [(v - mu[(pos, attr, n)][0])/mu[(pos, attr, n)][1] for n, v in m.get(attr, {}).items() if (pos, attr, n) in mu]
            z[attr] = max(-2.5, min(2.5, sum(zs)/len(zs))) if zs else 0.0
        if not any(z.values()): continue
        w = POSW[pos]; mean = sum(z[a]*w[a] for a in w)
        out[key] = {a: round(max(-2.2, min(2.2, (z[a] - mean)*0.85)), 2) for a in w}
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
    prof = profiles(rows)
    for r in rows:
        t = prof.get(ident(r))
        if t: r["tilt"] = t
    print(f"attribute profiles for {sum(1 for r in rows if 'tilt' in r)} players")
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
