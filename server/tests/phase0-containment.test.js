import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createConnection, closeDb } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { prepareStaging } from '../scripts/prepare-staging-db.js';
import { captureBaseline } from '../scripts/baseline-drill.js';
import { restoreBaseline } from '../scripts/restore-baseline.js';
import { databaseMetrics, assertStagingDatabase } from '../utils/databaseArtifacts.js';
import { rebuildCleanDb } from '../scripts/rebuild-clean-db.js';
import { cleanupLeads } from '../scripts/cleanup-leads.js';
import { sendEmail, getCapturedEmails, clearCapturedEmails } from '../utils/emailAdapter.js';
import { sendWeeklyNewsletter } from '../scripts/send-weekly-newsletter.js';
import { SCHEDULED_JOBS } from '../scheduler.js';
import { runBackup } from '../scripts/backup-db.js';

describe('Phase 0 operational containment and recoverable baseline', () => {
  let env, dir;
  beforeEach(() => {
    env = { ...process.env };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase0-fixture-'));
    process.env.DB_PATH = path.join(dir, 'primary.sqlite');
    clearCapturedEmails();
  });
  afterEach(async () => { await closeDb(); process.env = env; vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('rejects operational rebuild even with force, before creating or touching files', async () => {
    const sentinel = path.join(dir, 'source.sqlite');
    fs.writeFileSync(sentinel, 'unchanged');
    await expect(rebuildCleanDb({ targetLivePath: sentinel, isForce: true })).rejects.toThrow(/quarantined/);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('unchanged');
    await expect(rebuildCleanDb({ targetLivePath: process.env.DB_PATH, dataProvider: async () => ({ status: 'success' }) })).rejects.toThrow(/quarantined/);
  });

  it('blocks lead, admin, newsletter and ingestion HTTP flows without touching a database', async () => {
    const { app } = await import('../index.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const [method, endpoint] of [['POST','/api/leads/submit'], ['POST','/api/leads/submit/'], ['POST','/API/LEADS/SUBMIT'], ['GET','/API/ADMIN/leads/'], ['GET','/api/newsletter/confirm'], ['GET','/API/NEWSLETTER/confirm/'], ['GET','/api/admin/leads'], ['GET','/api/admin/leads/export.csv'], ['DELETE','/api/admin/leads/1'], ['POST','/api/admin/login'], ['POST','/api/ingest/import-data'], ['POST','/API/INGEST/ura/'], ['POST','/api/ingest/ura']]) {
        expect((await fetch(base + endpoint, { method, headers: { 'X-Admin-Key': process.env.ADMIN_API_KEY } })).status).toBe(403);
      }
      const features = await (await fetch(base + '/api/features')).json();
      expect(features).toMatchObject({ scope: 'analytics-readonly', leadCapture: false, outboundEmail: false, dataSync: false, leadCleanup: false });
      expect(fs.existsSync(process.env.DB_PATH)).toBe(false);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('skips cleanup and newsletter before opening an uninitialized database and disables destructive jobs', async () => {
    expect((await cleanupLeads()).skipped).toBe(true);
    expect((await sendWeeklyNewsletter()).skipped).toBe(true);
    for (const job of SCHEDULED_JOBS.filter(j => j.enabled)) expect(job.enabled()).toBe(false);
    expect(fs.existsSync(process.env.DB_PATH)).toBe(false);
  });

  it('uses a fake email transport in staging even with a production-shaped key, and checks simulated failures', async () => {
    process.env.RELEASE_SCOPE = 'full';
    process.env.NODE_ENV = 'staging';
    process.env.RESEND_API_KEY = 're_accidentally_inherited';
    process.env.MOCK_EMAIL = 'false';
    const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be used'));
    const result = await sendEmail({ from: 'fixture@example.invalid', to: 'recipient@example.invalid', subject: 'fixture', html: 'fixture' });
    expect(result.mocked).toBe(true);
    expect(getCapturedEmails()).toHaveLength(1);
    expect(outbound).not.toHaveBeenCalled();
    process.env.SIMULATE_EMAIL_ERROR = '422';
    expect((await sendEmail({ to: 'fixture@example.invalid' })).error.statusCode).toBe(422);
  });

  it('requires explicit production enablement for live email', async () => {
    process.env.RELEASE_SCOPE = 'full';
    process.env.NODE_ENV = 'production';
    process.env.MOCK_EMAIL = 'false';
    process.env.RESEND_API_KEY = 're_configured';
    expect((await sendEmail({ from: 'sender@example.invalid' })).error.statusCode).toBe(503);
    process.env.RELEASE_SCOPE = 'analytics-readonly';
    process.env.ENABLE_OUTBOUND_EMAIL = 'true';
    expect((await sendEmail({})).error.statusCode).toBe(503);
  });

  it('routes confirmation, agent and newsletter dispatch through the fake adapter, with honest failure results', async () => {
    process.env.RELEASE_SCOPE = 'full';
    process.env.AGENT_NOTIFICATION_EMAIL = 'agent@example.invalid';
    process.env.NEWSLETTER_PREVIEW_PATH = path.join(dir, 'preview.html');
    const conn = createConnection(process.env.DB_PATH);
    await runMigrations(conn);
    const { app } = await import('../index.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const outbound = vi.spyOn(globalThis, 'fetch');
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const submit = data => fetch(base + '/api/leads/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdpaConsent: true, ...data }) });
      expect((await submit({ email: 'newsletter@example.invalid', leadType: 'newsletter' })).status).toBe(202);
      expect((await submit({ email: 'advisory@example.invalid', phone: '91234567', leadType: 'agent_advisory', enquiryType: 'General' })).status).toBe(202);
      expect(getCapturedEmails()).toHaveLength(0);
      await conn.run("UPDATE leads SET confirmed_at=CURRENT_TIMESTAMP WHERE lead_type='newsletter'");
      const summary = await sendWeeklyNewsletter(conn);
      expect(summary.queuedCount).toBe(1);
      expect((await conn.get("SELECT last_newsletter_sent_at FROM leads WHERE lead_type='newsletter'")).last_newsletter_sent_at).toBeNull();
      expect(getCapturedEmails()).toHaveLength(0);
      process.env.SIMULATE_EMAIL_ERROR = '500';
      expect((await submit({ email: 'failure@example.invalid', leadType: 'newsletter' })).status).toBe(202);
      // Only our loopback HTTP requests used fetch; no Resend/provider requests occurred.
      expect(outbound.mock.calls.every(([url]) => String(url).startsWith(base))).toBe(true);
    } finally { await new Promise(resolve => server.close(resolve)); await conn.close(); }
  });

  it('fails closed before creating an unencrypted production backup', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BACKUP_KEY_FILE;
    delete process.env.BACKUP_ENCRYPTION_KEY;
    await expect(runBackup()).rejects.toThrow(/Production backups require/);
  });

  it('never loads local credentials into staging and rejects unprepared staging databases', async () => {
    const check = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./config.js');if(process.env.RESEND_API_KEY||process.env.URA_ACCESS_KEY)throw Error('Local credential leak');"], {
      cwd: path.resolve('..', 'server'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'staging', RESEND_API_KEY: '', URA_ACCESS_KEY: '' }
    });
    expect(check.status, check.stderr).toBe(0);
    process.env.NODE_ENV = 'staging';
    await expect(assertStagingDatabase(process.env.DB_PATH)).rejects.toThrow(/not a prepared staging/);
  });

  it('copies only market data and inserts synthetic leads, with no production tokens or job logs', async () => {
    const sourcePath = path.join(dir, 'source.sqlite'), targetPath = path.join(dir, 'staging.sqlite');
    const source = createConnection(sourcePath);
    await runMigrations(source);
    await source.run("INSERT INTO projects(project_name,street_name,market_segment) VALUES('MARKET FIXTURE','TEST ROAD','CCR')");
    await source.run("INSERT INTO leads(name,email,phone,lead_type,details,confirmation_token) VALUES('PRIVATE SENTINEL','private@example.com','98765432','newsletter','PRIVATE NOTES','PRIVATE TOKEN')");
    await source.run("INSERT INTO job_history(run_id,job_name,started_at,status,error_message) VALUES('private-run','fixture',CURRENT_TIMESTAMP,'failed','PRIVATE JOB ERROR')");
    await source.close();
    const result = await prepareStaging({ sourcePath, targetPath });
    expect(result.syntheticLeads).toBe(2);
    expect(result.counts.projects).toBe(1);
    expect(result.counts.job_history).toBe(0);
    expect(fs.readFileSync(targetPath).includes(Buffer.from('PRIVATE'))).toBe(false);
    const check = createConnection(targetPath);
    expect(await check.get('SELECT COUNT(*) AS n FROM leads WHERE confirmation_token IS NOT NULL')).toEqual({ n: 0 });
    await check.close();
    process.env.NODE_ENV = 'staging';
    await expect(assertStagingDatabase(targetPath)).resolves.toBeUndefined();
    await expect(prepareStaging({ sourcePath, targetPath: sourcePath })).rejects.toThrow(/new file/);
    await expect(prepareStaging({ sourcePath, targetPath })).rejects.toThrow(/new file/);
  });

  it('restores in a new process from a saved separate key and refuses overwrite or incorrect keys', async () => {
    const sourcePath = path.join(dir, 'source.sqlite');
    const source = createConnection(sourcePath);
    await runMigrations(source);
    await source.run("INSERT INTO leads(email,lead_type,confirmation_token) VALUES('restore@example.invalid','newsletter','restore-token')");
    await source.close();
    const keyFile = path.join(dir, 'keys', 'recovery.key');
    const workspaceRoot = path.join(dir, 'workspace');
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot,'app.js'),'export const fixture = true;');
    fs.writeFileSync(path.join(workspaceRoot,'.env'),'PRIVATE_FIXTURE=must-not-be-copied');
    expect(spawnSync('git',['init','-q',workspaceRoot]).status).toBe(0);
    expect(spawnSync('git',['-C',workspaceRoot,'add','app.js']).status).toBe(0);
    expect(spawnSync('git',['-C',workspaceRoot,'-c','user.name=Qualification','-c','user.email=qualification@example.invalid','commit','-qm','Fixture baseline']).status).toBe(0);
    const options = { sourcePath, backupRoot: path.join(dir, 'backups'), restoreRoot: path.join(dir, 'restores'), keyFile, createKey: true, workspaceRoot };
    const manifest = await captureBaseline(options);
    expect(manifest.workingTree.head).toMatch(/^[a-f0-9]{40,64}$/);
    expect(manifest.workingTree.files.map(f=>f.path)).toEqual(['app.js']);
    expect(fs.existsSync(path.join(path.dirname(manifest.encryptedBackup),'working-tree','.env'))).toBe(false);
    expect(manifest.restoreProcess).toMatch(/Fresh/);
    expect((await databaseMetrics(manifest.restoredPath)).counts.leads).toBe(1);
    expect(fs.readFileSync(keyFile, 'utf8')).toMatch(/^[a-f0-9]{64}$/);
    await expect(restoreBaseline({ backupPath: manifest.encryptedBackup, keyFile, outputPath: sourcePath, expectedHash: manifest.snapshotSha256 })).rejects.toThrow(/new isolated/);
    const wrongKey = path.join(dir, 'keys', 'wrong.key');
    fs.writeFileSync(wrongKey, '0'.repeat(64));
    const wrongOutput = path.join(dir, 'wrong.sqlite');
    await expect(restoreBaseline({ backupPath: manifest.encryptedBackup, keyFile: wrongKey, outputPath: wrongOutput, expectedHash: manifest.snapshotSha256 })).rejects.toThrow();
    expect(fs.existsSync(wrongOutput)).toBe(false);
    await expect(captureBaseline({ ...options, keyFile: path.join(options.backupRoot, 'unsafe.key') })).rejects.toThrow(/separately/);
  }, 20000);
});
