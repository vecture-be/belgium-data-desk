"""Inventory Statbel archive collections from a Belgium Data Desk PDF audit JSON or ZIP."""
import argparse, csv, json, re, zipfile
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit, unquote

SERIES = re.compile(r'/publications/([A-Z]\d{3}\.[A-Z0-9]+(?:\.[A-Z0-9]+)?)/([^/]+)')
YEAR = re.compile(r'(?<!\d)(?:18\d{2}|19\d{2}|20[012]\d)(?!\d)')
# Editorial shortlist, not a measured novelty or value score.
SHORTLIST = {'S600.A2': (1,'Industrial statistics'), 'S510.A1':(2,'Agricultural statistics'),
 'S440.A1':(3,'Property sales'), 'S740.A1':(4,'Monthly transport statistics'),
 'S364.A3':(5,'Occupational accidents'), 'S321.A5':(6,'Household expenditure'),
 'S700.A1':(7,'Domestic trade and transport'), 'S750.A1':(8,'Radio and television licences'),
 'S740.A3':(9,'Inland navigation'), 'S000.A4':(10,'Statistical yearbooks')}

def inventory(audit):
    groups = defaultdict(list)
    unmatched = []
    total = 0
    for c in audit['candidates']:
        refs = [r for r in c['references'] if r['provider'] == 'Statbel']
        if not refs: continue
        total += 1
        u = urlsplit(c['url']); m = SERIES.fullmatch(u.path)
        if u.hostname != 'doc.statbel.fgov.be' or not m:
            unmatched.append({'url':c['url'],'title':refs[0]['title']}); continue
        code, raw = m.groups(); f = unquote(raw)
        lang = re.match(re.escape(code)+r'([A-Z]+)_',f)
        groups[code].append((c,refs,f,lang[1] if lang else 'unknown'))
    rows = []
    for code, a in groups.items():
        years = sorted({int(y) for _,_,f,_ in a for y in YEAR.findall(f)})
        langs = Counter(lang for *_,lang in a)
        rank,label = SHORTLIST.get(code,(None,''))
        rows.append(dict(collection_code=code, editorial_rank=rank, editorial_label=label,
          pdf_urls=len(a), filename_year_min=min(years,default=None), filename_year_max=max(years,default=None),
          distinct_filename_years=len(years), filename_languages=json.dumps(langs,sort_keys=True),
          explicit_open_hint_urls=sum(any(r['licenceHint']=='explicit-open-hint' for r in refs) for _,refs,_,_ in a),
          no_alternative_hint_urls=sum(all(not r['machineReadableAlternativeHint'] for r in refs) for _,refs,_,_ in a),
          sample_title=a[0][1][0]['title'],sample_url=a[0][0]['url']))
    rows.sort(key=lambda r:(r['editorial_rank'] is None,r['editorial_rank'] or 0,-r['pdf_urls'],r['collection_code']))
    assert sum(r['pdf_urls'] for r in rows)+len(unmatched)==total
    return rows, unmatched, total

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('audit',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    if zipfile.is_zipfile(a.audit):
        with zipfile.ZipFile(a.audit) as z: audit=json.loads(z.read('pdf-audit.json'))
    else: audit=json.loads(a.audit.read_text())
    rows, unmatched,total=inventory(audit);a.out.mkdir(parents=True,exist_ok=True)
    for name,data in [('series.csv',rows),('unclassified.csv',unmatched)]:
        if data:
            with (a.out/name).open('w',newline='',encoding='utf-8') as f:
                w=csv.DictWriter(f,fieldnames=data[0].keys());w.writeheader();w.writerows(data)
    print(json.dumps({'statbel_urls':total,'classified_urls':total-len(unmatched),'collections':len(rows),'unclassified':len(unmatched)}))

if __name__=='__main__':main()
