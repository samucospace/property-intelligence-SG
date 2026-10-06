"""Read-only local baseline evidence and isolated copy; never changes the market DB."""
import sqlite3, pathlib, json, hashlib
root = pathlib.Path(__file__).resolve().parents[2]
folder = pathlib.Path(__file__).resolve().parent
live = root / 'server/property.db'
baseline = root / 'server/backups/baseline-authoritative-20261002.db'
target = folder / 'phase2-rehearsal.sqlite'
if target.exists():
    raise RuntimeError('Refusing to overwrite prior rehearsal')
def ro(file):
    conn = sqlite3.connect(file.as_uri()+'?mode=ro', uri=True)
    conn.execute('PRAGMA query_only=ON')
    conn.row_factory=sqlite3.Row
    return conn
def digest(file): return hashlib.sha256(file.read_bytes()).hexdigest()
report={'sourceSha256':digest(live),'originalBaselineSha256':digest(baseline),'sourceUnmodified':False,'identityEvidence':'local preservation evidence only; external identity approval pending'}
with ro(live) as source, ro(baseline) as old:
    report['sourceCounts']={table:source.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ['projects','property_transactions','rental_transactions','leads','amenities','sora_rates']}
    mapping_path=root/'server/migrations/data/project_adjudication_map.json'
    mapping=json.loads(mapping_path.read_text())
    for entry in mapping['entries']:
        for which,id_key in [('Source','sourceId'),('Target','targetId')]:
            row=old.execute('SELECT project_name,street_name,postal_district,latitude,longitude,geo_source FROM projects WHERE project_id=?',(entry[id_key],)).fetchone()
            if row:
                entry['baseline'+which]=dict(row)
                entry['expected'+which]={k:row[k] for k in ['project_name','street_name','postal_district']}
        entry['baselineSalesMoved']=old.execute('SELECT COUNT(*) FROM property_transactions WHERE project_id=?',(entry['sourceId'],)).fetchone()[0]
        entry['baselineRentalsMoved']=old.execute('SELECT COUNT(*) FROM rental_transactions WHERE project_id=?',(entry['sourceId'],)).fetchone()[0]
    mapping_path.write_text(json.dumps(mapping,indent=2)+'\n')
    destination=sqlite3.connect(target)
    source.backup(destination)
    destination.close()
report['sourceUnmodified']=digest(live)==report['sourceSha256']
(folder/'phase2-copy-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
