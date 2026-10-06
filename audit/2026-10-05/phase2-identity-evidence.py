import pathlib,sqlite3,json,re
root=pathlib.Path(__file__).resolve().parents[2]
def rows(file):
    db=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    result=[dict(r) for r in db.execute('SELECT * FROM projects')];db.close();return result
old=rows(root/'server/backups/baseline-authoritative-20261002.db')
current=rows(root/'server/property.db');ids={r['project_id'] for r in current}
def street(value): return re.sub(r'^(ST\.|STREET\.|ST )\s*','SAINT ',value.strip().upper())
file=root/'server/migrations/data/project_adjudication_map.json'
mapping=json.loads(file.read_text());prior={r['sourceId']:r for r in mapping['entries']}
baseline=sqlite3.connect((root/'server/backups/baseline-authoritative-20261002.db').as_uri()+'?mode=ro',uri=True)
entries=[]
for source in old:
    if source['project_id'] in ids:continue
    matches=[r for r in current if r['project_name']==source['project_name'] and street(r['street_name'])==street(source['street_name'])]
    if len(matches)!=1:raise RuntimeError('Ambiguous local mapping; manual review required')
    target=next(r for r in old if r['project_id']==matches[0]['project_id'])
    entry=prior.get(source['project_id'],{'sourceId':source['project_id'],'targetId':target['project_id'],'projectName':source['project_name'],'status':'pending','approvedBy':None,'approvedAt':None})
    entry['sourceEvidence']='Local original baseline/current identity comparison plus retained 5 October URA response hashes; human mapping approval pending'
    for which,row in [('Source',source),('Target',target)]:
        entry['baseline'+which]={k:row[k] for k in ['project_name','street_name','postal_district','latitude','longitude','geo_source']}
        entry['expected'+which]={k:row[k] for k in ['project_name','street_name','postal_district']}
    entry['baselineSalesMoved']=baseline.execute('SELECT COUNT(*) FROM property_transactions WHERE project_id=?',(source['project_id'],)).fetchone()[0]
    entry['baselineRentalsMoved']=baseline.execute('SELECT COUNT(*) FROM rental_transactions WHERE project_id=?',(source['project_id'],)).fetchone()[0]
    entries.append(entry)
baseline.close();mapping['entries']=entries
file.write_text(json.dumps(mapping,indent=2)+'\n')
print(json.dumps({'removedIdentityGroups':len(entries),'zeroTransactionSourceRows':sum(r['baselineSalesMoved']+r['baselineRentalsMoved']==0 for r in entries)}))
