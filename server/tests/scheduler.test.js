import { describe, it, expect } from 'vitest';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { acquireJobLock, releaseJobLock, runJobWithLock, getLastSuccessfulRun } from '../utils/jobRunner.js';
import { getSingaporeTime, SCHEDULED_JOBS } from '../scheduler.js';

describe('Scheduler & Distributed Job Coordination (GL-03)', () => {
  it('correctly calculates Singapore timezone components (UTC+8)', () => {
    // UTC 2026-10-02 00:00:00 -> Singapore 2026-10-02 08:00:00 (Friday)
    const utcDate = new Date('2026-10-02T00:00:00Z');
    const sg = getSingaporeTime(utcDate);
    expect(sg.hour).toBe(8);
    expect(sg.dayOfWeek).toBe(5); // Friday
    expect(sg.year).toBe(2026);
    expect(sg.month).toBe(10);
    expect(sg.day).toBe(2);
  });

  it('declares schedules that do not execute on deployment or arbitrary boot times', () => {
    // A regular Friday at 14:00 SGT
    const testTime = { dayOfWeek: 5, hour: 14, minute: 0, day: 2 };
    for (const job of SCHEDULED_JOBS) {
      expect(job.isDue(testTime)).toBe(false);
    }
  });

  it('triggers jobs strictly at their designated Singapore schedules', () => {
    const sunday2am = { dayOfWeek: 0, hour: 2, minute: 0, day: 4 };
    const monday8am = { dayOfWeek: 1, hour: 8, minute: 0, day: 5 };
    const firstOfMonth3am = { dayOfWeek: 3, hour: 3, minute: 0, day: 1 };
    const daily4am = { dayOfWeek: 2, hour: 4, minute: 0, day: 6 };

    const uraSync = SCHEDULED_JOBS.find(j => j.name === 'cron-ura-sync');
    const newsletter = SCHEDULED_JOBS.find(j => j.name === 'cron-weekly-newsletter');
    const cleanup = SCHEDULED_JOBS.find(j => j.name === 'cron-leads-cleanup');
    const backup = SCHEDULED_JOBS.find(j => j.name === 'cron-db-backup');

    expect(uraSync.isDue(sunday2am)).toBe(true);
    expect(newsletter.isDue(monday8am)).toBe(true);
    expect(cleanup.isDue(firstOfMonth3am)).toBe(true);
    expect(backup.isDue(daily4am)).toBe(true);
  });

  it('acquires and releases exclusive distributed job locks', async () => {
    const conn = createConnection(':memory:');
    try {
      await runMigrations(conn);

      const lock1 = await acquireJobLock(conn, 'test-job', 'worker-1', 15);
      expect(lock1.acquired).toBe(true);
      expect(lock1.runId).toBeDefined();

      // Second worker attempting concurrently must be rejected
      const lock2 = await acquireJobLock(conn, 'test-job', 'worker-2', 15);
      expect(lock2.acquired).toBe(false);
      expect(lock2.reason).toContain('is currently locked by worker-1');

      // Release lock
      await releaseJobLock(conn, 'test-job', lock1.runId, true, 42, null);

      // Verify audit history was updated
      const history = await conn.get(`SELECT * FROM job_history WHERE run_id = ?`, [lock1.runId]);
      expect(history.status).toBe('success');
      expect(history.items_processed).toBe(42);
      expect(history.finished_at).not.toBeNull();

      // Lock should now be available for worker-2
      const lock3 = await acquireJobLock(conn, 'test-job', 'worker-2', 15);
      expect(lock3.acquired).toBe(true);
      await releaseJobLock(conn, 'test-job', lock3.runId, true, 0, null);
    } finally {
      await conn.close();
    }
  });

  it('runs job with mutual exclusion wrapper and tracks execution in ledger', async () => {
    const conn = createConnection(':memory:');
    try {
      await runMigrations(conn);

      let executedCount = 0;
      const res = await runJobWithLock({
        jobName: 'audit-sync',
        conn,
        fn: async ({ runId }) => {
          executedCount++;
          return { totalIngested: 150 };
        }
      });

      expect(res.executed).toBe(true);
      expect(res.itemsProcessed).toBe(150);
      expect(executedCount).toBe(1);

      const lastSuccess = await getLastSuccessfulRun(conn, 'audit-sync');
      expect(lastSuccess).not.toBeNull();
      expect(lastSuccess.items_processed).toBe(150);
    } finally {
      await conn.close();
    }
  });
});
