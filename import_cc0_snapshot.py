#!/usr/bin/env python3
"""One-time import of independently published CC0 NCAA football rosters.

Athletic year 2025-26, NOT guaranteed current 2026-season rosters.
Jersey numbers are absent in the source, so we leave jersey=None and let
Retro Football choose an explicitly synthetic visual jersey number.

Source: Dharit Shah, NCAA All Sports Rosters 2025-26 v2.1.1, CC0-1.0
https://github.com/Dharit13/NCAA_2025-26-Season-Dataset
https://huggingface.co/datasets/dharits3/ncaa-college-athlete-rosters-2025-26
"""
import argparse, csv, io, json, pathlib, re, sys, time, unicodedata
from collections import defaultdict
from urllib.request import urlopen, Request

ROOT=pathlib.Path(__file__).resolve().parent
DATA=ROOT/'college'
SOURCES=[
 'https://raw.githubusercontent.com/Dharit13/NCAA_2025-26-Season-Dataset/main/by_sport/football/all.csv',
 'https://huggingface.co/datasets/dharits3/ncaa-college-athlete-rosters-2025-26/resolve/main/by_sport/football/all.csv',
]

def standard_name(v):
 s=unicodedata.normalize('NFKD',str(v or '')).encode('ascii','ignore').decode().lower()
 s=s.replace('&',' and ').replace("'",'')
 s=re.sub(r'\bthe\b',' ',s)
 s=re.sub(r'\b(university|college|of|at|campus|main|and)\b',' ',s)
 s=re.sub(r'[^a-z0-9]+',' ',s)
 s=' '.join(s.split())
 return s

# Ambiguity-safe aliases: these are only applied to the exact target school.
ALIAS={
 'app-state':['Appalachian State','App State','Appalachian State University'],
 'byu':['Brigham Young','Brigham Young University'],
 'florida-international':['FIU','Florida International','Florida International University'],
 'miami':['Miami Florida','Miami FL','University of Miami','Miami Hurricanes'],
 'miami-oh':['Miami Ohio','Miami OH','Miami University','Miami University Ohio'],
 'massachusetts':['UMass','UMass Amherst','University of Massachusetts Amherst'],
 'uconn':['Connecticut','University of Connecticut'],
 'ul-monroe':['Louisiana Monroe','University of Louisiana Monroe','ULM'],
 'louisiana':['Louisiana Lafayette','Louisiana-Lafayette','UL Lafayette','University of Louisiana at Lafayette'],
 'nc-state':['North Carolina State','NC State University'],
 'ole-miss':['Mississippi','University of Mississippi','Ole Miss'],
 'southern-miss':['Southern Mississippi','University of Southern Mississippi'],
 'hawai-i':['Hawaii','University of Hawaii at Manoa','Hawaii Manoa'],
 'smu':['Southern Methodist','Southern Methodist University'],
 'ucf':['Central Florida','University of Central Florida'],
 'ucla':['California Los Angeles','University of California Los Angeles'],
 'usc':['Southern California','University of Southern California'],
 'utsa':['Texas San Antonio','University of Texas at San Antonio'],
 'utep':['Texas El Paso','University of Texas at El Paso'],
 'uab':['Alabama Birmingham','University of Alabama at Birmingham'],
 'tcu':['Texas Christian','Texas Christian University'],
 'lsu':['Louisiana State','Louisiana State University'],
 'texas-a-m':['Texas A&M','Texas AM','Texas A and M University'],
 'san-jose-state':['San Jose State','San Jose State University'],
 'sacramento-state':['Sacramento State','Sac State','California State University Sacramento'],
 'north-dakota-state':['North Dakota State','NDSU'],
 'james-madison':['James Madison University'],
 'sam-houston':['Sam Houston State','Sam Houston State University'],
 'middle-tennessee':['Middle Tennessee State','Middle Tennessee State University'],
 'new-mexico-state':['New Mexico State University'],
 'pittsburgh':['Pitt','University of Pittsburgh'],
 'penn-state':['Pennsylvania State','Pennsylvania State University'],
 'kent-state':['Kent State University'],
 'bowling-green':['Bowling Green State','Bowling Green State University'],
 'ball-state':['Ball State University'],
 'arkansas-state':['Arkansas State University'],
 'georgia-state':['Georgia State University'],
 'georgia-southern':['Georgia Southern University'],
 'fresno-state':['California State University Fresno','Fresno State'],
 'boise-state':['Boise State University'],
 'charlotte':['UNC Charlotte','University of North Carolina Charlotte'],
 'coastal-carolina':['Coastal Carolina University'],
 'western-kentucky':['Western Kentucky University'],
 'western-michigan':['Western Michigan University'],
 'central-michigan':['Central Michigan University'],
 'eastern-michigan':['Eastern Michigan University'],
 'north-texas':['University of North Texas'],
 'south-florida':['University of South Florida','USF'],
 'florida-atlantic':['Florida Atlantic University','FAU'],
 'old-dominion':['Old Dominion University'],
 'liberty':['Liberty University'],
 'delaware':['University of Delaware'],
 'missouri-state':['Missouri State University'],
 'jacksonville-state':['Jacksonville State University'],
 'kennesaw-state':['Kennesaw State University'],
 'navy':['United States Naval Academy','US Naval Academy'],
 'army':['United States Military Academy','Army West Point'],
 'air-force':['United States Air Force Academy','Air Force Academy'],
}

def normpos(p):
 s=str(p or '').strip().upper().replace('.','').replace('-','')
 s=s.replace(' ','')
 if s in ('QB','QUARTERBACK'):return 'QB'
 if s in ('RB','FB','HB','TB','RUNNINGBACK','FULLBACK','HALFBACK'):return 'RB'
 if s in ('WR','RECEIVER','WIDERECEIVER','SLOT'):return 'WR'
 if s in ('TE','TIGHTEND'):return 'TE'
 if s in ('OL','OT','OG','C','OC','LT','LG','RT','RG','T','G','OFFENSIVELINE','OFFENSIVELINEMAN'):return 'OL'
 if s in ('DL','DT','DE','NT','NG','EDGE','ED','DEFENSIVEEND','DEFENSIVETACKLE','DEFENSIVELINEMAN'):return 'DL'
 if s in ('LB','MLB','ILB','OLB','SLB','WLB','LINEBACKER'):return 'LB'
 if s in ('DB','CB','S','SS','FS','SAF','SAFETY','CORNERBACK','DEFENSIVEBACK','NICKEL'):return 'DB'
 if s in ('K','PK','KICKER','PLACEKICKER'):return 'K'
 return None

def class_year(raw,standing):
 s=(str(standing or '')+' '+str(raw or '')).lower()
 if 'fresh' in s or re.search(r'\bfr\b',s):return 1
 if 'soph' in s or re.search(r'\bso\b',s):return 2
 if 'junior' in s or re.search(r'\bjr\b',s):return 3
 if 'senior' in s or re.search(r'\bsr\b',s):return 4
 if 'grad' in s or re.search(r'\bgr\b',s):return 5
 return None

def download_csv(urls):
 errors=[]
 for url in urls:
  try:
   print('Downloading open roster snapshot:',url,flush=True)
   req=Request(url,headers={'User-Agent':'RetroFootballCC0Snapshot/1.0','Accept':'text/csv'})
   with urlopen(req,timeout=120) as stream:
    b=stream.read(60_000_000)
   if len(b)<100000:raise ValueError('Unusually small file: could be a Git LFS pointer')
   txt=b.decode('utf-8-sig');header=next(csv.reader(io.StringIO(txt)))
   if not {'first_name','last_name','school'}.issubset(set(header)):
    raise ValueError('Missing expected columns: '+repr(header[:12]))
   print('Downloaded',len(b),'bytes',flush=True)
   return txt,url
  except Exception as e:
   errors.append(f'{url}: {type(e).__name__}: {e}')
 raise SystemExit('Unable to download CC0 source. Provide --csv local/all.csv.\n'+'\n'.join(errors))

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--csv',help='A previously downloaded by_sport/football/all.csv; skips API entirely')
 ap.add_argument('--source-url',help='One-off URL for a compatible, openly licensed CSV')
 args=ap.parse_args()
 index=json.loads((DATA/'teams.json').read_text(encoding='utf-8'))
 teams=index['teams']
 if args.csv:
  raw=pathlib.Path(args.csv).read_text(encoding='utf-8-sig');origin=str(args.csv)
 else:
  raw,origin=download_csv([args.source_url] if args.source_url else SOURCES)
 rows=list(csv.DictReader(io.StringIO(raw)))
 print('CSV rows:',len(rows))
 # Build unambiguous school-name aliases.
 aliases={}
 ambiguous=set()
 for team in teams:
  names=[team['school'],team['id'].replace('-',' ')] + ALIAS.get(team['id'],[])
  for nm in names:
   key=standard_name(nm)
   if not key:continue
   if key in aliases and aliases[key]!=team['id']:
    ambiguous.add(key)
   else:aliases[key]=team['id']
 for key in ambiguous:aliases.pop(key,None)
 # Miami generic should never resolve accidentally to Miami (OH) or Florida.
 for key in ('miami','u','university'):aliases.pop(key,None)
 grouped=defaultdict(list)
 source_schools=defaultdict(int)
 for row in rows:
  if row.get('sport') and str(row['sport']).strip().lower() not in ('football','fb'):continue
  school=str(row.get('school') or '').strip()
  key=standard_name(school)
  plain=unicodedata.normalize('NFKD',school).encode('ascii','ignore').decode().lower().strip()
  if plain.startswith('university of miami') or plain in ('miami fl','miami (fl)','miami hurricanes'):
   school_id='miami'
  elif plain.startswith('miami university') or plain in ('miami oh','miami (oh)','miami ohio'):
   school_id='miami-oh'
  else:
   school_id=aliases.get(key)
  if not school_id:
   source_schools[school]+=1
   continue
  first=str(row.get('first_name') or '').strip();last=str(row.get('last_name') or '').strip()
  pos=normpos(row.get('position_raw') or row.get('position_group')) or normpos(row.get('position_group'))
  if not (first and last and pos):continue
  if first.lower() in ('first','name') or last.lower() in ('last','name'):continue
  year=class_year(row.get('class_year_raw'),row.get('class_standing'))
  grouped[school_id].append({'first_name':first,'last_name':last,'position':pos,'year':year,'jersey':None})
 complete=[];partial=[];missing=[]
 dest=DATA/'rosters';dest.mkdir(exist_ok=True)
 # Old stale roster files are removed before fresh import.
 for p in dest.glob('*.json'):p.unlink()
 for t in teams:
  rr=grouped.get(t['id'],[])
  # Remove duplicate name+position (keeping the original listing first).
  unique={}
  for r in rr:unique.setdefault((r['first_name'].casefold(),r['last_name'].casefold(),r['position']),r)
  rr=list(unique.values())
  if len(rr)<8:
   missing.append({'school':t['school'],'matchedPlayers':len(rr)})
   continue
  if len(rr)<12:partial.append(t['school'])
  (dest/(t['id']+'.json')).write_text(json.dumps({
   'school':t['school'],'season':2025,'athleticYear':'2025-26',
   'source':'Shah NCAA All Sports Rosters 2025-26 v2.1.1 (CC0-1.0)',
   'jerseysVerified':False,'players':rr},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
  complete.append(t['school'])
 manifest={'source':'Shah NCAA All Sports Rosters 2025-26 v2.1.1',
  'athletic_year':'2025-26','season':2025,'not_live':True,'no_auto_updates':True,
  'roster_source':origin,'license':'CC0-1.0',
  'teams_with_rosters':len(complete),'number_of_teams':len(teams),
  'player_records':sum(len(grouped[t['id']]) for t in teams if t['school'] in complete),
  'teams_with_fewer_than_12':partial,'missing_schools':missing,
  'notes':'Roster names and positions are source facts; jersey numbers and player skill ratings in game are fictional/simulated.'}
 (DATA/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
 print(f'SUCCESS: {len(complete)}/{len(teams)} FBS schools with 8+ real historical roster athletes. {sum(len(grouped[t["id"]]) for t in teams if t["school"] in complete)} player entries')
 if missing:
  print('Unmatched/insufficient schools:',', '.join(f'{r["school"]} ({r["matchedPlayers"]})' for r in missing))
  print('Sample unmatched source school names:',list(sorted(source_schools.items(),key=lambda x:-x[1]))[:45])
 print('No API key is used and nothing schedules future updates.')

if __name__=='__main__':main()
