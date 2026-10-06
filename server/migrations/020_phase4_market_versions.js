export async function up(conn) {
  await conn.run('CREATE TABLE market_versions(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL)');
  await conn.run('INSERT INTO market_versions VALUES(1,0)');
  await conn.run('CREATE TABLE analytics_snapshots(cache_key TEXT PRIMARY KEY,generation INTEGER NOT NULL,payload_json TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  for(const table of ['projects','property_transactions','rental_transactions','project_benchmarks','amenities','project_identity_review']) {
    for(const action of ['INSERT','UPDATE','DELETE']) await conn.run(`CREATE TRIGGER phase4_${table}_${action.toLowerCase()} AFTER ${action} ON ${table}
      BEGIN UPDATE market_versions SET generation=generation+1 WHERE id=1; END`);
  }
}
