"""Read-only checks of source-candidate archives and out-of-window preservation."""
import collections
import hashlib
import json
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[2]
folder = pathlib.Path(__file__).resolve().parent
candidate = folder / 'phase2-source-candidate-v3.sqlite'
manifest = json.loads((folder / 'provider-source-network/source-manifest.json').read_text())
def connect(file):
    return sqlite3.connect(file.as_uri() + '?mode=ro', uri=True)
report = {'candidateSha256': hashlib.sha256(candidate.read_bytes()).hexdigest(), 'checks': {}}
with connect(root / 'server/property.db') as original, connect(candidate) as rebuilt:
    for kind, table, date in [('sales', 'property_transactions', 'contract_date'), ('rentals', 'rental_transactions', 'lease_date')]:
        expression = 'substr(lease_date,1,7)' if kind == 'rentals' else date
        bounds = [manifest[kind]['dateFrom'], manifest[kind]['dateTo']]
        query = f'SELECT * FROM {table} WHERE {expression} NOT BETWEEN ? AND ?'
        columns = [r[1] for r in original.execute(f'PRAGMA table_info({table})')]
        original_rows = [dict(zip(columns, row)) for row in original.execute(query, bounds)]
        # Compare retained raw identity, amount and date; migrations may deliberately clear derived estimates.
        fields = ['project_id', date, 'price_sgd' if kind == 'sales' else 'rent_sgd']
        key = lambda row: tuple(row[field] for field in fields)
        rebuilt.row_factory = sqlite3.Row
        rebuilt_rows = list(rebuilt.execute(query, bounds))
        archived = rebuilt.execute('SELECT COUNT(*) FROM source_snapshot_archive WHERE kind=?', [kind]).fetchone()[0]
        covered = original.execute(f'SELECT COUNT(*) FROM {table} WHERE {expression} BETWEEN ? AND ?', bounds).fetchone()[0]
        check = {'outOfWindowOriginal': len(original_rows), 'outOfWindowCandidate': len(rebuilt_rows),
                 'outOfWindowIdentityAmountsDatesMatch': collections.Counter(map(key, original_rows)) == collections.Counter(map(key, rebuilt_rows)),
                 'originalCoveredRecords': covered, 'archivedRecords': archived, 'archiveCountMatch': covered == archived}
        report['checks'][kind] = check
    report['candidateCounts'] = {table: rebuilt.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                                for table in ['projects', 'property_transactions', 'rental_transactions', 'leads']}
report['passed'] = all(c['outOfWindowIdentityAmountsDatesMatch'] and c['archiveCountMatch'] for c in report['checks'].values())
(folder / 'phase2-candidate-preservation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
if not report['passed']:
    raise SystemExit(1)
