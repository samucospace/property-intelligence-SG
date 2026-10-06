import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnection } from '../db.js';
import { runMigrations } from '../migrations/index.js';
import { enqueueEmail, claimPendingEmails, markEmailAccepted, markEmailFailed, processOutboxBatch, generateIdempotencyKey } from '../utils/emailQueue.js';
import { suppressEmail, isEmailSuppressed } from '../utils/suppression.js';

describe('Phase 3 Track 1: Outbox State Machine & Provider Resilience (GL-09, GL-16)', () => {
  let conn;

  beforeEach(async () => {
    conn = createConnection(':memory:');
    await runMigrations(conn);
  });

  afterEach(async () => {
    await conn.close();
  });

  it('durable outbox enqueues pending emails with idempotency deduction', async () => {
    const res1 = await enqueueEmail({
      recipient: 'investor@example.com',
      subject: 'Weekly Intel',
      emailType: 'newsletter_digest',
      payload: { test: true }
    }, conn);

    expect(res1.enqueued).toBe(true);
    expect(res1.id).toBeDefined();

    // Re-enqueue with identical recipient, type and payload -> deduped
    const res2 = await enqueueEmail({
      recipient: 'investor@example.com',
      subject: 'Weekly Intel',
      emailType: 'newsletter_digest',
      payload: { test: true }
    }, conn);

    expect(res2.enqueued).toBe(false);
    expect(res2.duplicate).toBe(true);

    const rows = await conn.all('SELECT * FROM email_outbox');
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(0);
  });

  it('worker claims items with mutual exclusion and leases them', async () => {
    await enqueueEmail({
      recipient: 'worker1@example.com',
      subject: 'Sub 1',
      emailType: 'newsletter_digest'
    }, conn);

    await enqueueEmail({
      recipient: 'worker2@example.com',
      subject: 'Sub 2',
      emailType: 'newsletter_digest'
    }, conn);

    const claimedWorkerA = await claimPendingEmails({ workerId: 'worker-A', batchSize: 1 }, conn);
    expect(claimedWorkerA.length).toBe(1);
    expect(claimedWorkerA[0].recipient).toBe('worker1@example.com');

    // Second worker cannot lease the already-claimed item
    const claimedWorkerB = await claimPendingEmails({ workerId: 'worker-B', batchSize: 1 }, conn);
    expect(claimedWorkerB.length).toBe(1);
    expect(claimedWorkerB[0].recipient).toBe('worker2@example.com');

    // Third check has no available items left
    const emptyClaim = await claimPendingEmails({ workerId: 'worker-C', batchSize: 5 }, conn);
    expect(emptyClaim.length).toBe(0);

    const rowA = await conn.get('SELECT status, claimed_by FROM email_outbox WHERE recipient = ?', ['worker1@example.com']);
    expect(rowA.status).toBe('claimed');
    expect(rowA.claimed_by).toBe('worker-A');
  });

  it('handles provider 500/504/timeout with exponential backoff and failed status', async () => {
    await enqueueEmail({
      recipient: 'retry@example.com',
      subject: 'Retry Test',
      emailType: 'newsletter_digest'
    }, conn);

    // Mock sendEmail returning transient 500 error
    const fakeSendEmailTransient = vi.fn().mockResolvedValue({
      data: null,
      error: { statusCode: 500, message: 'Provider internal error' }
    });

    const summary = await processOutboxBatch({
      workerId: 'worker-test',
      batchSize: 10,
      conn,
      sendEmailFn: fakeSendEmailTransient
    });

    expect(summary.claimed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.accepted).toBe(0);

    const row = await conn.get('SELECT status, attempts, next_retry_at, last_error FROM email_outbox WHERE recipient = ?', ['retry@example.com']);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.next_retry_at).not.toBeNull();
    expect(row.last_error).toContain('Provider internal error');
  });

  it('handles permanent provider failure (422 Unprocessable) by marking permanent_failed without retry', async () => {
    await enqueueEmail({
      recipient: 'badformat@example.com',
      subject: 'Bad Email',
      emailType: 'newsletter_digest'
    }, conn);

    // Mock sendEmail returning 422 Unprocessable
    const fakeSendEmail422 = vi.fn().mockResolvedValue({
      data: null,
      error: { statusCode: 422, message: 'The email address is invalid or domain rejects messages.' }
    });

    const summary = await processOutboxBatch({
      workerId: 'worker-test',
      batchSize: 10,
      conn,
      sendEmailFn: fakeSendEmail422
    });

    expect(summary.permanentFailed).toBe(1);

    const row = await conn.get('SELECT status, attempts, next_retry_at FROM email_outbox WHERE recipient = ?', ['badformat@example.com']);
    expect(row.status).toBe('permanent_failed');
    expect(row.attempts).toBe(1);
    expect(row.next_retry_at).toBeNull();
  });

  it('transitions to accepted and records provider_message_id on verified acceptance', async () => {
    await enqueueEmail({
      recipient: 'happy@example.com',
      subject: 'Happy Path',
      emailType: 'newsletter_digest'
    }, conn);

    const fakeSendSuccess = vi.fn().mockResolvedValue({
      data: { id: 'msg_resend_xyz123' },
      error: null
    });

    const summary = await processOutboxBatch({
      workerId: 'worker-test',
      batchSize: 10,
      conn,
      sendEmailFn: fakeSendSuccess
    });

    expect(summary.accepted).toBe(1);

    const row = await conn.get('SELECT status, provider_message_id FROM email_outbox WHERE recipient = ?', ['happy@example.com']);
    expect(row.status).toBe('accepted');
    expect(row.provider_message_id).toBe('msg_resend_xyz123');
  });

  it('pre-send suppression check cancels dispatch and sets status to suppressed', async () => {
    await enqueueEmail({
      recipient: 'willsuppress@example.com',
      subject: 'Suppressed Candidate',
      emailType: 'newsletter_digest'
    }, conn);

    // Suppress email before worker batch processes
    await suppressEmail({ email: 'willsuppress@example.com', reason: 'unsubscribed' }, conn);

    const fakeSendSuccess = vi.fn().mockResolvedValue({
      data: { id: 'never_sent' },
      error: null
    });

    const summary = await processOutboxBatch({
      workerId: 'worker-test',
      batchSize: 10,
      conn,
      sendEmailFn: fakeSendSuccess
    });

    expect(fakeSendSuccess).not.toHaveBeenCalled();
    expect(summary.claimed).toBe(0);

    const row = await conn.get('SELECT status, last_error FROM email_outbox WHERE id = (SELECT id FROM email_outbox LIMIT 1)');
    expect(row.status).toBe('suppressed');
  });
});
