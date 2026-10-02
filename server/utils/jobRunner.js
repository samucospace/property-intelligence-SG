import crypto from 'crypto';
import os from 'node:os';
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
const workerIdentity = () => `${os.hostname()}:pid-${process.pid}`;
export async function acquireJobLock(conn, jobName, workerId = workerIdentity(), leaseMinutes = 15, slotKey = null) {
  const runId = crypto.randomUUID();

  return await withTransaction(conn, async () => {
    // 1. Check existing active lock
    const existing = await conn.get(
      `SELECT job_name, locked_by, run_id, lease_expires_at,
              datetime(lease_expires_at) > datetime('now') AS is_active
       FROM job_locks WHERE job_name = ?`,
      [jobName]
    );

    if (existing) {
      // Time expiry alone never fences a still-running worker. Require confirmed
      // local process death; unknown owners fail closed for operator recovery.
      const owner = /^(.*):pid-(\d+)$/.exec(existing.locked_by);
      const pid = owner?.[1] === os.hostname() ? owner[2] : null;
      let dead = false;
      if (pid) {
        try { process.kill(Number(pid), 0); } catch (error) { dead = error.code === 'ESRCH'; }
      }
      if (!dead) return {
        acquired: false,
        reason: `Job '${jobName}' is currently locked by ${existing.locked_by} until ${existing.lease_expires_at}`
      };
      await conn.run("UPDATE job_history SET status='interrupted', finished_at=datetime('now'), error_message='Worker process terminated' WHERE run_id=? AND status='running'", [existing.run_id]);
    }
    if (slotKey && await conn.get('SELECT run_id FROM job_slots WHERE job_name=? AND slot_key=?', [jobName, slotKey])) {
      return {
        acquired: false,
        reason: `Job '${jobName}' already claimed slot ${slotKey}`
      };
    }

    if (slotKey) await conn.run('INSERT INTO job_slots(job_name,slot_key,run_id) VALUES(?,?,?)', [jobName, slotKey, runId]);

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
    await withTransaction(conn, async () => {
      await conn.run(
        `UPDATE job_history
         SET finished_at = datetime('now'),
             status = ?,
             items_processed = ?,
             error_message = ?
         WHERE run_id = ?`,
        [typeof success === 'string' ? success : (success ? 'success' : 'failed'), itemsProcessed, errorMessage, runId]
      );

      await conn.run(
        `DELETE FROM job_locks WHERE job_name = ? AND run_id = ?`,
        [jobName, runId]
      );
    });
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
export async function runJobWithLock({ jobName, fn, conn = null, leaseMinutes = 15, slotKey = null, heartbeatMs = Math.max(1000, leaseMinutes * 60000 / 3) }) {
  const db = conn || createConnection();
  const shouldClose = !conn;

  try {
    const lockRes = await acquireJobLock(db, jobName, workerIdentity(), leaseMinutes, slotKey);
    if (!lockRes.acquired) {
      console.log(`[JobRunner] ${lockRes.reason}. Skipping execution.`);
      return { executed: false, skippedReason: lockRes.reason };
    }

    const { runId } = lockRes;
    console.log(`[JobRunner] Starting job '${jobName}' (Run ID: ${runId})...`);

    let itemsProcessed = 0;
    let renewal = Promise.resolve();
    let renewalError = null;
    const heartbeat = setInterval(() => {
      renewal = renewal.then(() => db.run("UPDATE job_locks SET lease_expires_at=datetime('now', '+' || ? || ' minutes') WHERE job_name=? AND run_id=?", [leaseMinutes, jobName, runId]))
        .then(result => { if (result.changes !== 1) throw new Error('Job ownership lost'); })
        .catch(error => { renewalError = error; });
    }, heartbeatMs);
    heartbeat.unref();
    try {
      const res = await fn({ runId, conn: db });
      if (typeof res === 'number') itemsProcessed = res;
      else if (res && typeof res.count === 'number') itemsProcessed = res.count;
      else if (res && typeof res.totalIngested === 'number') itemsProcessed = res.totalIngested;

      clearInterval(heartbeat);
      await renewal;
      if (renewalError) throw renewalError;
      const status = res?.skipped ? 'skipped' : res?.status || 'success';
      if (!['success', 'skipped'].includes(status)) {
        const error = new Error(`Job returned ${status}`);
        error.itemsProcessed = itemsProcessed;
        throw error;
      }
      await releaseJobLock(db, jobName, runId, status, itemsProcessed, res?.reason || null);
      console.log(`[JobRunner] Successfully finished job '${jobName}' (Processed: ${itemsProcessed}).`);
      return { executed: true, runId, itemsProcessed, status };
    } catch (jobErr) {
      clearInterval(heartbeat);
      await renewal;
      console.error(`[JobRunner] Error in job '${jobName}':`, jobErr.message);
      await releaseJobLock(db, jobName, runId, false, jobErr.itemsProcessed ?? itemsProcessed, jobErr.message);
      throw jobErr;
    }
  } finally {
    if (shouldClose) {
      await db.close();
    }
  }
}
