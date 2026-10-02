import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-sg-tests-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(fixtureDir, 'default.sqlite');
process.env.RELEASE_SCOPE = 'analytics-readonly';
process.env.ENABLE_OUTBOUND_EMAIL = 'false';
process.env.ENABLE_DATA_SYNC = 'false';
process.env.ENABLE_LEAD_CLEANUP = 'false';
process.env.ENABLE_STARTUP_LEAD_CLEANUP = 'false';
process.env.ENABLE_SCHEDULED_NEWSLETTER = 'false';
process.env.MOCK_EMAIL = 'true';
process.env.RESEND_API_KEY = 're_mock_test';
process.env.URA_ACCESS_KEY = 'mock_test';
process.env.ADMIN_API_KEY = 'a'.repeat(48);
process.env.UNSUBSCRIBE_SECRET = 'b'.repeat(48);
delete process.env.BACKUP_KEY_FILE;
delete process.env.BACKUP_ENCRYPTION_KEY;
afterAll(async () => {
  const { closeDb } = await import('../db.js');
  await closeDb();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});
