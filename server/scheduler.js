import './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, createConnection, getDbPath } from './db.js';
import { assertStagingDatabase } from './utils/databaseArtifacts.js';
import { runJobWithLock, getLastSuccessfulRun } from './utils/jobRunner.js';
import { releaseFeatures } from './utils/releasePolicy.js';

// Maintenance scripts
import { fetchUraData } from './ingestion.js';
import { cleanupLeads } from './scripts/cleanup-leads.js';
import { backupDatabase } from './scripts/backup-db.js';
import { sendWeeklyNewsletter } from './scripts/send-weekly-newsletter.js';
import { processOutboxBatch } from './utils/emailQueue.js';
import { assertProductionCollection } from './utils/productionControls.js';
import {runOperationsMonitor} from './utils/operationalAlerts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns current date and components in Singapore Time (Asia/Singapore, UTC+8, no DST).
 */
export function getSingaporeTime(date = new Date()) {
  const sgDate = new Date(date.getTime() + (8 * 60 + date.getTimezoneOffset()) * 60000);
  return {
    date: sgDate,
    year: sgDate.getFullYear(),
    month: sgDate.getMonth() + 1, // 1-12
    day: sgDate.getDate(), // 1-31
    dayOfWeek: sgDate.getDay(), // 0 (Sunday) - 6 (Saturday)
    hour: sgDate.getHours(), // 0-23
    minute: sgDate.getMinutes(), // 0-59
    slotKey: `${sgDate.getFullYear()}-${String(sgDate.getMonth() + 1).padStart(2, '0')}-${String(sgDate.getDate()).padStart(2, '0')} ${String(sgDate.getHours()).padStart(2, '0')}:${String(sgDate.getMinutes()).padStart(2, '0')}`
  };
}

/**
 * Job schedule definitions in Asia/Singapore timezone.
 * None of these execute on container or process boot.
 */
export const SCHEDULED_JOBS = [
  {
    name:'cron-operations-monitor',
    enabled:()=>process.env.ENABLE_OPERATIONS_MONITORING==='true',
    description:'Check freshness/disk/failure signals and deliver transition alerts',
    isDue:()=>true,
    execute:async({conn})=>runOperationsMonitor({conn})
  },
  {
    name: 'cron-email-outbox',
    enabled: () => releaseFeatures().outboundEmail,
    description: 'Dispatch due email outbox work every minute',
    isDue: () => true,
    execute: async ({conn}) => {
      const result = await processOutboxBatch({conn});
      return {...result,status:result.failed || result.permanentFailed ? 'partial_success' : result.mocked ? 'skipped' : 'success'};
    }
  },
  {
    name: 'cron-ura-sync',
    enabled: () => releaseFeatures().dataSync,
    description: 'Weekly URA Caveats and Rental Sync (Sunday 02:00 SGT)',
    isDue: ({ dayOfWeek, hour, minute }) => dayOfWeek === 0 && hour === 2 && minute === 0,
    execute: async ({ runId, conn }) => {
      const accessKey = process.env.URA_ACCESS_KEY;
      if (!accessKey) {
        console.warn('[Scheduler:sync-ura] Skipped: URA_ACCESS_KEY is not configured.');
        return { skipped: true, reason: 'URA_ACCESS_KEY is not configured' };
      }
      const res = await fetchUraData(accessKey, conn);
      return res;
    }
  },
  {
    name: 'cron-weekly-newsletter',
    enabled: () => releaseFeatures().leadCapture && releaseFeatures().outboundEmail && process.env.ENABLE_SCHEDULED_NEWSLETTER === 'true',
    description: 'Weekly Market Digest Newsletter (Monday 08:00 SGT)',
    isDue: ({ dayOfWeek, hour, minute }) => dayOfWeek === 1 && hour === 8 && minute === 0,
    execute: async ({ runId, conn }) => {
      if (process.env.ENABLE_SCHEDULED_NEWSLETTER !== 'true') {
        console.log('[Scheduler:newsletter] Skipped: ENABLE_SCHEDULED_NEWSLETTER !== "true" (Phase 0 scope protection).');
        return 0;
      }
      const result = await sendWeeklyNewsletter(conn);
      if (result.skipped) return result;
      return { status: result.failCount ? 'partial_success' : result.mockedCount ? 'skipped' : 'success',
        count: result.queuedCount || 0, reason: result.mockedCount ? 'Mock transport; no live dispatch' : undefined };
    }
  },
  {
    name: 'cron-leads-cleanup',
    enabled: () => releaseFeatures().leadCleanup,
    description: 'Monthly PDPA Lead Retention Cleanup (1st of month 03:00 SGT)',
    isDue: ({ day, hour, minute }) => day === 1 && hour === 3 && minute === 0,
    execute: async ({ runId, conn }) => {
      return await cleanupLeads(conn);
    }
  },
  {
    name: 'cron-db-backup',
    description: 'Daily Authenticated Database Backup (Daily 04:00 SGT)',
    isDue: ({ hour, minute }) => hour === 4 && minute === 0,
    execute: async ({ runId, conn }) => {
      return await backupDatabase(conn);
    }
  }
];

class SchedulerDaemon {
  constructor({ jobs = SCHEDULED_JOBS, now = () => new Date(), conn = null, intervalMs = 30000 } = {}) {
    this.jobs = jobs;
    this.now = now;
    this.conn = conn;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastExecutedSlots = new Map();
    this.runningJobs = new Set();
    this.stopping = false;
  }

  async start() {
    assertProductionCollection();
    await assertStagingDatabase(getDbPath());
    console.log('====================================================');
    console.log(' Singapore Home Intel - Maintenance Scheduler Daemon');
    console.log(' Timezone: Asia/Singapore (UTC+8)');
    console.log('====================================================');

    // 1. Ensure migrations are applied before scheduler operates
    console.log('[Scheduler] Ensuring database initialized and migrations applied...');
    await initDb();

    console.log('[Scheduler] Registered jobs:');
    for (const job of this.jobs) {
      console.log(`  • ${job.name}: ${job.description}`);
    }

    // Handle CLI manual trigger flag (e.g., node server/scheduler.js --now=cron-db-backup)
    const runNowArg = process.argv.find(a => a.startsWith('--now=') || a === '--now');
    if (runNowArg) {
      const targetJobName = runNowArg.includes('=') ? runNowArg.split('=')[1] : null;
      await this.runImmediate(targetJobName);
      process.exit(0);
    }

    console.log('\n[Scheduler] Daemon listening for scheduled slots. No deploy-time side effects executed.');
    
    // Check schedule every 30 seconds
    this.timer = setInterval(() => this.tick().catch(error => console.error('[Scheduler] Tick failed:', error.message)), this.intervalMs);
    // Boot registers the scheduler only; the timer performs the first due check.
  }

  async runImmediate(targetJobName) {
    const jobsToRun = targetJobName 
      ? SCHEDULED_JOBS.filter(j => j.name === targetJobName)
      : SCHEDULED_JOBS;

    if (jobsToRun.length === 0) {
      console.error(`[Scheduler] Unknown job name '${targetJobName}'. Available:`, SCHEDULED_JOBS.map(j => j.name));
      process.exit(1);
    }

    for (const job of jobsToRun) {
      if (job.enabled && !job.enabled()) throw new Error(`Job '${job.name}' is disabled by release policy`);
      console.log(`[Scheduler] Executing immediate manual run for '${job.name}'...`);
      await runJobWithLock({
        jobName: job.name,
        fn: job.execute
      });
    }
  }

  async tick() {
    if (this.stopping) return;
    const sg = getSingaporeTime(this.now());
    const pending = [];

    for (const job of this.jobs) {
      if (job.enabled && !job.enabled()) continue;
      const executionKey = `${job.name}@${sg.slotKey}`;
      if (this.lastExecutedSlots.has(executionKey)) {
        continue; // Already dispatched for this minute slot
      }

      if (job.isDue(sg)) {
        this.lastExecutedSlots.set(executionKey, true);
        console.log(`[Scheduler] Slot triggered: ${job.name} at ${sg.slotKey} SGT`);

        this.runningJobs.add(job.name);
        pending.push(runJobWithLock({
          jobName: job.name,
          fn: job.execute,
          slotKey: sg.slotKey,
          conn: this.conn
        })
          .catch(err => {
            console.error(`[Scheduler] Unhandled job failure for ${job.name}:`, err.message);
          })
          .finally(() => {
            this.runningJobs.delete(job.name);
          }));
      }
    }

    // Prune slots older than 2 hours to avoid memory leak
    if (this.lastExecutedSlots.size > 200) {
      this.lastExecutedSlots.clear();
    }
    await Promise.all(pending);
  }

  async stop(signal = 'SIGTERM') {
    console.log(`\n[Scheduler] Received ${signal}. Stopping scheduler daemon gracefully...`);
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.runningJobs.size > 0) {
      console.log(`[Scheduler] Awaiting ${this.runningJobs.size} currently executing jobs...`);
      const waitStart = Date.now();
      while (this.runningJobs.size > 0 && Date.now() - waitStart < 15000) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log('[Scheduler] Scheduler stopped cleanly.');
    process.exit(0);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const daemon = new SchedulerDaemon();
  daemon.start().catch(err => {
    console.error('[Scheduler] Fatal startup error:', err);
    process.exit(1);
  });

  process.on('SIGTERM', () => daemon.stop('SIGTERM'));
  process.on('SIGINT', () => daemon.stop('SIGINT'));
}

export { SchedulerDaemon };
