import sqlite3, json, pathlib, collections

root = pathlib.Path(__file__).resolve().parents[2]
live = root / 'server/property.db'
baseline = root / 'server/backups/baseline-authoritative-20261002.db'
out = {}
for label, file in [('current', live), ('baseline', baseline), ('restored', root / 'audit/recovery-drill/restored-baseline.db'), ('staging', root / 'server/staging-property.db')]:
    if not file.exists():
        out[label] = {'exists': False}
        continue
    db = sqlite3.connect(file.as_uri() + '?mode=ro', uri=True)
    db.execute('PRAGMA query_only=ON')
    tables = ['projects','property_transactions','rental_transactions','project_benchmarks','amenities','sora_rates','leads','schema_migrations']
    out[label] = {'counts': {t: db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in tables}, 'integrity': db.execute('PRAGMA integrity_check').fetchone()[0], 'fk_errors': len(db.execute('PRAGMA foreign_key_check').fetchall())}
    if label == 'current':
        out[label]['approximate'] = db.execute("SELECT COUNT(*), SUM(livability_score IS NOT NULL), SUM(livability_data IS NOT NULL) FROM projects WHERE geo_source='district_centre'").fetchone()
        out[label]['non_landed_misflags'] = db.execute("SELECT COUNT(*) FROM projects WHERE project_name LIKE '%NON-LANDED%' AND is_landed_aggregate=1").fetchone()[0]
        out[label]['sparse_benchmarks'] = db.execute('SELECT COUNT(*) FROM project_benchmarks WHERE sale_count < 3 AND rolling_24m_median_psft IS NOT NULL').fetchone()[0]
        out[label]['amenity_sources'] = db.execute('SELECT source, COUNT(*) FROM amenities GROUP BY source').fetchall()
        out[label]['sora_columns'] = [r[1] for r in db.execute('PRAGMA table_info(sora_rates)')]
    db.close()

db = sqlite3.connect(live.as_uri() + '?mode=ro', uri=True)
db.execute('ATTACH DATABASE ? AS baseline', (baseline.as_uri() + '?mode=ro',))
db.execute('PRAGMA query_only=ON')
out['transaction_comparison'] = {}
for table, idcol, value in [('property_transactions','transaction_id','price_sgd'), ('rental_transactions','rental_id','rent_sgd')]:
    cols = [r[1] for r in db.execute(f'PRAGMA table_info({table})') if r[1] != 'project_id']
    colstr = ','.join(cols)
    out['transaction_comparison'][table] = {
        'changed_or_added_excluding_project_id': db.execute(f'SELECT COUNT(*) FROM (SELECT {colstr} FROM main.{table} EXCEPT SELECT {colstr} FROM baseline.{table})').fetchone()[0],
        'removed_or_changed_excluding_project_id': db.execute(f'SELECT COUNT(*) FROM (SELECT {colstr} FROM baseline.{table} EXCEPT SELECT {colstr} FROM main.{table})').fetchone()[0],
        'reassigned': db.execute(f'SELECT COUNT(*) FROM main.{table} a JOIN baseline.{table} b USING ({idcol}) WHERE a.project_id != b.project_id').fetchone()[0],
        'current_value_total': db.execute(f'SELECT SUM({value}) FROM main.{table}').fetchone()[0],
        'baseline_value_total': db.execute(f'SELECT SUM({value}) FROM baseline.{table}').fetchone()[0],
    }
out['project_mapping'] = db.execute('SELECT DISTINCT b.project_id, a.project_id, p.project_name FROM main.property_transactions a JOIN baseline.property_transactions b USING(transaction_id) JOIN baseline.projects p ON p.project_id=b.project_id WHERE a.project_id != b.project_id UNION SELECT DISTINCT b.project_id, a.project_id, p.project_name FROM main.rental_transactions a JOIN baseline.rental_transactions b USING(rental_id) JOIN baseline.projects p ON p.project_id=b.project_id WHERE a.project_id != b.project_id').fetchall()
db.close()
path = pathlib.Path(__file__).with_name('phase-validation-data.json')
path.write_text(json.dumps(out, indent=2))
print(json.dumps({k:v for k,v in out.items() if k != 'project_mapping'}, indent=2))
