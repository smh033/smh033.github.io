#!/usr/bin/env python3
"""Convert user-supplied, publication-authorized CSV roster files to compact
Retro Football JSON. No outside network access or API credentials required.

Expected source file: roster_csv/ohio-state.csv
Columns: first_name,last_name,position,jersey,year
"""
import csv, json, pathlib, sys
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE/'college'
SOURCE=HERE/'roster_csv'

def run():
    idx=json.loads((BASE/'teams.json').read_text(encoding='utf-8'))
    good=[];missing=[]
    (BASE/'rosters').mkdir(exist_ok=True)
    for t in idx['teams']:
        infile=SOURCE/(t['id']+'.csv')
        if not infile.is_file():missing.append(t['school']);continue
        with infile.open(newline='',encoding='utf-8-sig') as f:
            reader=csv.DictReader(f)
            required={'first_name','last_name','position'}
            if not required.issubset(set(reader.fieldnames or [])):
                print('BAD COLUMNS:',infile);continue
            rows=[]
            for row in reader:
                first=row.get('first_name','').strip();last=row.get('last_name','').strip();pos=row.get('position','').strip().upper()
                if not(first and last and pos):continue
                rows.append({'first_name':first,'last_name':last,'position':pos,'jersey':row.get('jersey','').strip(),'year':row.get('year','').strip()})
        if not rows:
            print('EMPTY ROSTER:',infile);continue
        (BASE/'rosters'/(t['id']+'.json')).write_text(json.dumps({'school':t['school'],'season':2026,'source':'User-supplied authorized roster CSV','players':rows},separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
        good.append(t['school'])
    print('Imported',len(good),'real roster CSV files. Missing',len(missing),'of',len(idx['teams']))
    if missing:print('Missing schools:',', '.join(missing))

if __name__=='__main__':
    print('Only import and publish roster information you are authorized to redistribute.')
    if not SOURCE.is_dir():sys.exit('Create a roster_csv folder with one <school-id>.csv per school. See README.md.')
    run()
