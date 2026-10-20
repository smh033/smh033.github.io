#!/usr/bin/env python3
"""Prepare 2026 FBS football rosters + logos for STATIC GitHub Pages hosting.

Requires a CFBD account/API key. The token is used ONLY by this script, never
written to the web files, and must NOT be committed to a public repository.
Python 3.9+; standard library only.
"""
import argparse, datetime as dt, json, os, pathlib, re, time, unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / 'college'
API = 'https://api.collegefootballdata.com'

def norm(text):
    s = unicodedata.normalize('NFKD', str(text)).encode('ascii','ignore').decode().lower()
    return re.sub('[^a-z0-9]', '', s)

ALIASES = {
    'appstate': ['appalachianstate'], 'miami': ['miamifl'], 'miamioh': ['miamiohio'],
    'ulmonroe': ['louisianamonroe'], 'louisiana': ['louisianalafayette','ull'],
    'fiu': ['floridainternational'], 'floridainternational': ['fiu'],
    'utsanantonio': ['utsa'], 'utsanantonio': ['utsa'],
    'hawaii': ['hawaii'], 'connecticut': ['uconn'], 'uconn': ['connecticut'],
    'centralflorida': ['ucf'], 'southflorida': ['usf'], 'smu': ['southernmethodist'],
    'utsa': ['texassanantonio'], 'texassanmarcos': ['texasstate'],
    'utep': ['texaselpaso'], 'olemiss': ['mississippi'],
    'southernmiss': ['southernmississippi'], 'ndsu': ['northdakotastate'],
    'sacramentostate': ['sacramentostate'],
}

# Known alternate CFBD school spellings. "Miami" here is Miami (FL), not Miami (OH).
SPECIAL = {
    'Miami': ['Miami', 'Miami (FL)'],
    'Miami (OH)': ['Miami (OH)', 'Miami Ohio'],
    "Hawai'i": ['Hawai\'i', 'Hawaii'],
    'App State': ['Appalachian State', 'App State'],
    'UL Monroe': ['Louisiana Monroe', 'UL Monroe'],
    'Louisiana': ['Louisiana', 'Louisiana-Lafayette'],
    'UConn': ['UConn', 'Connecticut'],
    'Florida International': ['FIU', 'Florida International'],
    'Ole Miss': ['Ole Miss', 'Mississippi'],
    'Southern Miss': ['Southern Mississippi', 'Southern Miss'],
    'San José State': ['San José State', 'San Jose State'],
    'Sam Houston': ['Sam Houston', 'Sam Houston State'],
    'NC State': ['NC State', 'North Carolina State'],
    'UTSA': ['UTSA', 'Texas-San Antonio'],
    'UTEP': ['UTEP', 'Texas-El Paso'],
}

def fetch_json(path, key, query):
    url = API + path + '?' + urlencode(query)
    req = Request(url, headers={'Authorization':'Bearer '+key, 'User-Agent':'RetroFootballRosterImporter/1.0', 'Accept':'application/json'})
    with urlopen(req,timeout=25) as r:
        return json.loads(r.read().decode('utf-8'))

def fetch_logo(url, dest):
    if not url.startswith('https://'):
        return False
    req = Request(url,headers={'User-Agent':'Mozilla/5.0 RetroFootball Asset Importer'})
    try:
        with urlopen(req,timeout=20) as res:
            raw = res.read(4000000)
        if not (raw[:8] == b'\x89PNG\r\n\x1a\n' or raw[:3] == b'\xff\xd8\xff'):
            return False
        ext = '.png' if raw[:8] == b'\x89PNG\r\n\x1a\n' else '.jpg'
        dest = dest.with_suffix(ext)
        dest.write_bytes(raw)
        return str(dest.name)
    except Exception as e:
        print('    Could not download logo:',str(e)[:110]);return False

def display_name(p):
    first = str(p.get('first_name') or p.get('firstName') or '').strip()
    last = str(p.get('last_name') or p.get('lastName') or '').strip()
    raw = str(p.get('name') or '').strip()
    if first and last:
        return first,last
    if raw:
        parts=raw.split(' ',1)
        return parts[0],parts[1] if len(parts)>1 else ''
    return '', ''

def main():
    ap=argparse.ArgumentParser(description='Build static 2026 college roster and logo files for Retro Football.')
    ap.add_argument('--season',type=int,default=2026)
    ap.add_argument('--limit',type=int,default=0,help='Optional number of teams, for testing your API key')
    ap.add_argument('--skip-logos',action='store_true')
    args=ap.parse_args()
    key=os.getenv('CFBD_API_KEY','').strip()
    if not key:
        raise SystemExit('Set CFBD_API_KEY in your shell first. Never add your API key to index.html or commit it to GitHub.')
    index=json.loads((DATA/'teams.json').read_text(encoding='utf-8'))
    teams=index['teams']; by_name={}
    print('Getting official',args.season,'FBS team metadata...')
    fbs=fetch_json('/teams/fbs',key,{'year':args.season})
    for item in fbs:
        for k in ['school','abbreviation','alt_name1','alt_name2','alt_name3']:
            if item.get(k):by_name.setdefault(norm(item[k]),item)
    known=0;missing=[];total_players=0;logos=0
    for i,t in enumerate(teams[:args.limit or len(teams)],1):
        labels = SPECIAL.get(t['school'],[t['school']]) + [t['abbr']]
        match=next((by_name.get(norm(s)) for s in labels if by_name.get(norm(s))),None)
        if match is None:
            print(f'[{i:3}/{len(teams)}] TEAM NOT FOUND: {t["school"]}');missing.append(t['school']);continue
        name=match['school']
        for prop,cprop in [('mascot','mascot'),('c1','color'),('c2','alt_color')]:
            if match.get(cprop):t[prop]=match[cprop]
        t['name']=t['school']+' '+t['mascot']
        print(f'[{i:3}/{len(teams)}] {t["school"]} ({name})...',end=' ',flush=True)
        try:
            rows=fetch_json('/roster',key,{'year':args.season,'team':name})
        except Exception as e:
            print('ERROR:',str(e)[:100]);missing.append(t['school']);continue
        players=[]
        for r in rows:
            first,last=display_name(r)
            if not first or not last: continue
            players.append({
                'id':r.get('id'), 'first_name':first, 'last_name':last,
                'position':r.get('position') or '',
                'jersey':r.get('jersey') if r.get('jersey') is not None else r.get('jersey_number'),
                'year':r.get('year'),
                'height':r.get('height'), 'weight':r.get('weight'),
            })
        if not players:
            print('NO PLAYERS');missing.append(t['school']);continue
        dest=DATA/'rosters'/(t['id']+'.json')
        dest.write_text(json.dumps({'school':t['school'],'season':args.season,'source':'CollegeFootballData API /roster',
          'players':players},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        known+=1;total_players+=len(players)
        print(len(players),'players',end='')
        if not args.skip_logos:
            urls=match.get('logos') or []
            if urls:
                logo=fetch_logo(urls[0],DATA/'logos'/t['id'])
                if logo:
                    t['logo']='college/logos/'+logo;logos+=1
                    print(' + logo',end='')
        print()
        time.sleep(0.1)
    index['season']=args.season
    (DATA/'teams.json').write_text(json.dumps(index,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    manifest={'season':args.season,'updated_at':dt.datetime.now(dt.timezone.utc).isoformat(),
      'teams_with_real_rosters':known,'player_records':total_players,'downloaded_logos':logos,
      'missing_teams':missing,'requested_teams':args.limit or len(teams)}
    (DATA/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print('\nSummary:',known,'teams,',total_players,'real players,',logos,'logos.')
    if missing:print('Teams missing:',', '.join(missing))
    if known != len(teams) and not args.limit:
        print('WARNING: Not all 138 teams have usable rosters. The game will show an error instead of inventing players.')

if __name__=='__main__':main()
