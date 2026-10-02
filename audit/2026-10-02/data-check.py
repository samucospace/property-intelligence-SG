"""Read-only source audit; creates an ignored local SQLite snapshot for benchmarks."""
import sqlite3, json, pathlib
root = pathlib.Path(__file__).resolve().parents[2]
out = pathlib.Path(__file__).resolve().parent
source = sqlite3.connect((root / 'server/property.db').as_uri() + '?mode=ro', uri=True)
target = sqlite3.connect(out / 'market-snapshot.db')
source.backup(target)
source.close()
# Do not retain real lead personal data in the benchmark fixture.
target.execute('DELETE FROM leads')
target.commit()
target.execute('VACUUM')
target.row_factory = sqlite3.Row
queries = {
 'integrity': 'PRAGMA integrity_check',
 'foreign_keys': 'PRAGMA foreign_key_check',
 'counts': '''SELECT (SELECT COUNT(*) FROM projects) projects,
 (SELECT COUNT(*) FROM property_transactions) sales,
 (SELECT COUNT(*) FROM rental_transactions) rentals,
 (SELECT COUNT(*) FROM project_benchmarks) benchmarks,
 (SELECT COUNT(*) FROM amenities) amenities''',
 'districts': "SELECT COUNT(*) total, SUM(postal_district BETWEEN '01' AND '28') valid, SUM(postal_district IS NULL) missing FROM projects",
 'geo': 'SELECT geo_source, COUNT(*) count, SUM(livability_score IS NOT NULL) scored FROM projects GROUP BY geo_source',
 'missing_geo': 'SELECT COUNT(*) count FROM projects WHERE latitude IS NULL OR longitude IS NULL',
 'dates_sales': 'SELECT MIN(contract_date) earliest, MAX(contract_date) latest FROM property_transactions',
 'dates_rentals': 'SELECT MIN(lease_date) earliest, MAX(lease_date) latest FROM rental_transactions',
 'benchmarks_dates': 'SELECT MIN(updated_at) oldest, MAX(updated_at) newest FROM project_benchmarks',
 'sora': 'SELECT reference_month, sora_1m, sora_3m FROM sora_rates ORDER BY reference_month DESC LIMIT 1',
 'migrations': 'SELECT name FROM schema_migrations ORDER BY name',
 'amenities': 'SELECT source, category, COUNT(*) count FROM amenities GROUP BY source, category',
 'sales_types': 'SELECT property_type, COUNT(*) count FROM property_transactions GROUP BY property_type',
 'rent_types': 'SELECT property_type, COUNT(*) count FROM rental_transactions GROUP BY property_type',
 'planning': 'SELECT COUNT(planning_area) populated, COUNT(DISTINCT planning_area) distinct_values FROM projects',
 'same_name_different_street': 'SELECT COUNT(*) count FROM (SELECT project_name FROM projects GROUP BY project_name HAVING COUNT(DISTINCT street_name)>1)',
 'unscored': 'SELECT COUNT(*) count FROM projects WHERE latitude IS NOT NULL AND livability_score IS NULL',
 'no_benchmark': 'SELECT COUNT(*) count FROM projects p LEFT JOIN project_benchmarks b ON b.project_id=p.project_id WHERE b.project_id IS NULL',
 'coordinate_clusters': "SELECT COUNT(*) clusters, SUM(n) projects FROM (SELECT COUNT(*) n FROM projects WHERE is_landed_aggregate=0 AND geo_source='svy21' GROUP BY latitude,longitude HAVING COUNT(*)>1)",
}
results = {k: [dict(r) for r in target.execute(q)] for k,q in queries.items()}
target.close()
(out/'data-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
