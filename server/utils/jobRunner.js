import crypto from 'crypto';
import { createConnection, withTransaction } from '../db.js';

/**
 * Distributed lease-based job coordination and audit runner for SQLite.
 */

/**
 * Attempts to acquire an exclusive lease lock for a named job.
 * @param {object} conn Database connection wrapper
 * @param {string} jobName Identifier of the job
 * @param {string} workerId Identifier of the executing worker/process
 * @param {number} leaseMinutes Expiration window for stale lease recovery
 * @returns {Promise<{ acquired: boolean, runId?: string, reason?: string }>}
 */
export async function acquireJobLock(conn, jobName, workerId = `pid-${process.pid}`, leaseMinutes = 15) {
  const runId = crypto.randomUUID();

  return await withTransaction(conn, async () => {
    // 1. Check existing active lock
    const existing = await conn.get(
      `SELECT job_name, locked_by, run_id, lease_expires_at,
              datetime(lease_expires_at) > datetime('now') AS is_active
       FROM job_locks WHERE job_name = ?`,
      [jobName]
    );

    if (existing && existing.is_active === 1) {
      return {
        acquired: false,
        reason: `Job '${jobName}' is currently locked by ${existing.locked_by} until ${existing.lease_expires_at}`
      };
    }

    // 2. Insert or take over expired lock
    await conn.run(
      `INSERT INTO job_locks (job_name, locked_at, locked_by, run_id, lease_expires_at)
       VALUES (?, datetime('now'), ?, ?, datetime('now', '+' || ? || ' minutes'))
       ON CONFLICT(job_name) DO UPDATE SET
         locked_at = datetime('now'),
         locked_by = excluded.locked_by,
         run_id = excluded.run_id,
         lease_expires_at = datetime('now', '+' || ? || ' minutes')`,
      [jobName, workerId, runId, leaseMinutes, leaseMinutes]
    );

    // 3. Record in audit history
    await conn.run(
      `INSERT INTO job_history (run_id, job_name, started_at, status)
       VALUES (?, ?, datetime('now'), 'running')`,
      [runId, jobName]
    );

    return { acquired: true, runId };
  });
}

/**
 * Releases job lock upon completion and updates history record.
 * @param {object} conn Database connection wrapper
 * @param {string} jobName
 * @param {string} runId
 * @param {boolean} success
 * @param {number} itemsProcessed
 * @param {string|null} errorMessage
 */
export async function releaseJobLock(conn, jobName, runId, success = true, itemsProcessed = 0, errorMessage = null) {
  try {
    await withTransaction(conn, async () => {
      await conn.run(
        `UPDATE job_history
         SET finished_at = datetime('now'),
             status = ?,
             items_processed = ?,
             error_message = ?
         WHERE run_id = ?`,
        [success ? 'success' : 'failed', itemsProcessed, errorMessage, runId]
      );

      await conn.run(
        `DELETE FROM job_locks WHERE job_name = ? AND run_id = ?`,
        [jobName, runId]
      );
    });
  } catch (err) {
    console.error(`[JobRunner] Error releasing lock for ${jobName} (${runId}):`, err.message);
  }
}

/**
 * Returns the last successful run for a given job.
 * @param {object} conn Database connection wrapper
 * @param {string} jobName
 * @returns {Promise<object|null>}
 */
export async function getLastSuccessfulRun(conn, jobName) {
  return await conn.get(
    `SELECT run_id, started_at, finished_at, items_processed
     FROM job_history
     WHERE job_name = ? AND status = 'success'
     ORDER BY started_at DESC LIMIT 1`,
    [jobName]
  );
}

/**
 * High-level helper: Runs an async task with mutual exclusion lock and full lifecycle tracking.
 * @param {object} options
 * @param {string} options.jobName
 * @param {Function} options.fn Async callback taking ({ runId, conn }) and returning itemsProcessed (number or { count })
 * @param {object} [options.conn] Optional connection (creates dedicated connection if omitted)
 * @param {number} [options.leaseMinutes] Default 15
 * @returns {Promise<{ executed: boolean, itemsProcessed?: number, runId?: string, skippedReason?: string }>}
 */
export async function runJobWithLock({ jobName, fn, conn = null, leaseMinutes = 15 }) {
  const db = conn || createConnection();
  const shouldClose = !conn;

  try {
    const lockRes = await acquireJobLock(db, jobName, `pid-${process.pid}`, leaseMinutes);
    if (!lockRes.acquired) {
      console.log(`[JobRunner] ${lockRes.reason}. Skipping execution.`);
      return { executed: false, skippedReason: lockRes.reason };
    }

    const { runId } = lockRes;
    console.log(`[JobRunner] Starting job '${jobName}' (Run ID: ${runId})...`);

    let itemsProcessed = 0;
    try {
      const res = await fn({ runId, conn: db });
      if (typeof res === 'number') itemsProcessed = res;
      else if (res && typeof res.count === 'number') itemsProcessed = res.count;
      else if (res && typeof res.totalIngested === 'number') itemsProcessed = res.totalIngested;

      await releaseJobLock(db, jobName, runId, true, itemsProcessed, null);
      console.log(`[JobRunner] Successfully finished job '${jobName}' (Processed: ${itemsProcessed}).`);
      return { executed: true, runId, itemsProcessed };
    } catch (jobErr) {
      console.error(`[JobRunner] Error in job '${jobName}':`, jobErr.message);
      await releaseJobLock(db, jobName, runId, false, itemsProcessed, jobErr.message);
      throw jobErr;
    }
  } finally {
    if (shouldClose) {
      await db.close();
    }
  }
}
