import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection, initDb } from '../db.js';
import { runMigrations } from '../migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Startup & Concurrency Reliability (GL-02)', () => {
  const testDir = path.join(__dirname, 'temp-startup-test');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('reliably initializes fresh disk databases without SQLITE_BUSY (G1-1)', async () => {
    for (let i = 0; i < 5; i++) {
      const diskDb = path.join(testDir, `fresh-${Date.now()}-${i}.db`);
      await initDb(diskDb);

      const conn = createConnection(diskDb);
      const tables = await conn.all(`SELECT name FROM sqlite_master WHERE type='table'`);
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('job_locks');
      await conn.close();

      try {
        fs.unlinkSync(diskDb);
        if (fs.existsSync(`${diskDb}-wal`)) fs.unlinkSync(`${diskDb}-wal`);
        if (fs.existsSync(`${diskDb}-shm`)) fs.unlinkSync(`${diskDb}-shm`);
      } catch {}
    }
  });

  it('deterministically coordinates concurrent migration execution via schema_lock (G1-2)', async () => {
    const concurrentDb = path.join(testDir, `concurrent-${Date.now()}.db`);

    // Launch 3 simultaneous migration runners against the same fresh disk file
    const runner = async () => {
      const conn = createConnection(concurrentDb);
      try {
        await runMigrations(conn);
        return { success: true };
      } finally {
        await conn.close();
      }
    };

    const results = await Promise.allSettled([runner(), runner(), runner()]);

    // All runners must settle without throwing unhandled SQLITE_BUSY
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
      if (r.status === 'fulfilled') {
        expect(r.value.success).toBe(true);
      }
    }

    // Verify all migrations applied exactly once
    const verifyConn = createConnection(concurrentDb);
    try {
      const applied = await verifyConn.all(`SELECT name FROM schema_migrations ORDER BY name`);
      const names = applied.map(a => a.name);
      expect(names).toContain('001_baseline_schema');
      expect(names).toContain('009_scheduler_and_job_locks');
      // No duplicate rows
      expect(new Set(names).size).toBe(names.length);
    } finally {
      await verifyConn.close();
    }
  });
});
