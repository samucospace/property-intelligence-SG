/**
 * Migration 005: Benchmarks, Tenure Classification & Bedroom Normalization (P1-P2)
 * - Creates project_benchmarks table for rolling 24-month median sale valuations
 * - Adds tenure_class ('freehold' | 'leasehold' | NULL) to projects and transactions
 * - Normalizes legacy bedroom labels in rental_transactions
 * - Populates initial project_benchmarks
 */

export const name = '005_benchmarks_and_tenure';

export async function up(conn) {
  const run = conn.run.bind(conn);
  const all = conn.all.bind(conn);

  // 1. Create project_benchmarks table
  await run(`
    CREATE TABLE IF NOT EXISTS project_benchmarks (
      project_id INTEGER PRIMARY KEY,
      rolling_24m_median_price REAL,
      rolling_24m_median_psft REAL,
      sale_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `);

  // 2. Add tenure_class to projects if missing
  const projCols = await all(`PRAGMA table_info(projects)`);
  const projColNames = new Set(projCols.map(c => c.name));
  if (!projColNames.has('tenure_class')) {
    await run(`ALTER TABLE projects ADD COLUMN tenure_class TEXT`);
  }
  await run(`CREATE INDEX IF NOT EXISTS idx_projects_tenure_class ON projects(tenure_class);`);

  // 3. Add tenure_class to property_transactions if missing
  const txCols = await all(`PRAGMA table_info(property_transactions)`);
  const txColNames = new Set(txCols.map(c => c.name));
  if (!txColNames.has('tenure_class')) {
    await run(`ALTER TABLE property_transactions ADD COLUMN tenure_class TEXT`);
  }
  await run(`CREATE INDEX IF NOT EXISTS idx_transactions_tenure_class ON property_transactions(tenure_class);`);

  // 4. Normalize legacy bedroom labels in rental_transactions
  console.log('[Migration 005] Normalizing rental bedroom counts...');
  await run(`
    UPDATE rental_transactions
    SET bedroom_count = 'Unspecified'
    WHERE bedroom_count IN ('NA-Bedder', '00-Bedder', '0-Bedder', '') OR bedroom_count IS NULL;
  `);

  await run(`
    UPDATE rental_transactions
    SET bedroom_count = '3-Bedder'
    WHERE bedroom_count = '03-Bedder';
  `);

  await run(`
    UPDATE rental_transactions
    SET bedroom_count = '5-Bedder'
    WHERE bedroom_count = '05-Bedder';
  `);

  // 5. Populate tenure_class on property_transactions
  console.log('[Migration 005] Classifying tenure on transactions...');
  await run(`
    UPDATE property_transactions
    SET tenure_class = CASE
      WHEN UPPER(tenure) LIKE '%FREEHOLD%' OR tenure LIKE '999%' OR tenure LIKE '956%' OR tenure LIKE '947%' OR tenure LIKE '946%' OR tenure LIKE '929%' OR tenure LIKE '993%' THEN 'freehold'
      WHEN UPPER(tenure) LIKE '%LEASE%' OR UPPER(tenure) LIKE '%YRS%' OR UPPER(tenure) LIKE '%YEARS%' THEN 'leasehold'
      ELSE NULL
    END
    WHERE tenure_class IS NULL;
  `);

  // 6. Populate tenure_class on projects
  console.log('[Migration 005] Setting project tenure_class from transaction records...');
  await run(`
    UPDATE projects
    SET tenure_class = (
      SELECT CASE
        WHEN SUM(CASE WHEN t.tenure_class = 'freehold' THEN 1 ELSE 0 END) > 0 THEN 'freehold'
        WHEN SUM(CASE WHEN t.tenure_class = 'leasehold' THEN 1 ELSE 0 END) > 0 THEN 'leasehold'
        ELSE NULL
      END
      FROM property_transactions t
      WHERE t.project_id = projects.project_id
    )
    WHERE tenure_class IS NULL;
  `);

  // 7. Pre-compute initial 24-month rolling benchmarks
  console.log('[Migration 005] Pre-computing initial 24-month rolling project benchmarks...');
  await run(`
    INSERT INTO project_benchmarks (project_id, rolling_24m_median_price, rolling_24m_median_psft, sale_count, updated_at)
    WITH ranked_psft AS (
      SELECT project_id, psft_sgd,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY psft_sgd) AS rn,
             COUNT(*) OVER (PARTITION BY project_id) AS cnt
      FROM property_transactions
      WHERE contract_date >= date('now', '-24 months')
        AND (no_of_units = 1 OR no_of_units IS NULL)
    ),
    med_psft AS (
      SELECT project_id,
             ROUND(AVG(psft_sgd), 2) AS rolling_24m_median_psft,
             cnt AS sale_count
      FROM ranked_psft
      WHERE rn IN ((cnt + 1)/2, (cnt + 2)/2)
      GROUP BY project_id
    ),
    ranked_price AS (
      SELECT project_id, price_sgd,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY price_sgd) AS rn,
             COUNT(*) OVER (PARTITION BY project_id) AS cnt
      FROM property_transactions
      WHERE contract_date >= date('now', '-24 months')
        AND (no_of_units = 1 OR no_of_units IS NULL)
    ),
    med_price AS (
      SELECT project_id,
             ROUND(AVG(price_sgd)) AS rolling_24m_median_price
      FROM ranked_price
      WHERE rn IN ((cnt + 1)/2, (cnt + 2)/2)
      GROUP BY project_id
    )
    SELECT p.project_id,
           pr.rolling_24m_median_price,
           p.rolling_24m_median_psft,
           p.sale_count,
           CURRENT_TIMESTAMP
    FROM med_psft p
    JOIN med_price pr ON p.project_id = pr.project_id
    ON CONFLICT(project_id) DO UPDATE SET
      rolling_24m_median_price = excluded.rolling_24m_median_price,
      rolling_24m_median_psft = excluded.rolling_24m_median_psft,
      sale_count = excluded.sale_count,
      updated_at = CURRENT_TIMESTAMP;
  `);
}
