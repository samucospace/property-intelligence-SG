import { Resend } from 'resend';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Memory log for inspection during testing / staging
const capturedEmails = [];

/**
 * Dispatches an email via Resend in live mode, or logs to disk/memory in mock mode.
 * Enforces safe staging defaults to prevent accidental outbound dispatches.
 *
 * @param {object} options
 * @param {string} options.from
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {object} [options.headers]
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function sendEmail({ from, to, subject, html, headers = {} }) {
  const isMock = process.env.MOCK_EMAIL === 'true' || 
                 process.env.NODE_ENV === 'test' || 
                 process.env.NODE_ENV === 'staging' || 
                 !process.env.RESEND_API_KEY || 
                 process.env.RESEND_API_KEY === 'mock' ||
                 process.env.RESEND_API_KEY.startsWith('re_mock');

  // Simulated error mode for testing resilience (GL-09)
  if (process.env.SIMULATE_EMAIL_ERROR === '422') {
    return {
      data: null,
      error: {
        name: 'validation_error',
        message: 'Simulated 422 Unprocessable Entity for testing',
        statusCode: 422
      }
    };
  }
  if (process.env.SIMULATE_EMAIL_ERROR === '500') {
    return {
      data: null,
      error: {
        name: 'internal_server_error',
        message: 'Simulated 500 Provider Outage for testing',
        statusCode: 500
      }
    };
  }

  if (isMock) {
    const mockId = `mock-email-${crypto.randomUUID()}`;
    const record = {
      id: mockId,
      timestamp: new Date().toISOString(),
      from,
      to,
      subject,
      headers
    };
    capturedEmails.push(record);
    console.log(`[EmailAdapter:MOCK] Captured email to ${to} (Subject: "${subject}") [ID: ${mockId}]`);

    // Write to staging log directory if available
    try {
      const logsDir = path.resolve(__dirname, '../logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      fs.appendFileSync(
        path.join(logsDir, 'mock-email-dispatches.log'),
        JSON.stringify(record) + '\n'
      );
    } catch (e) {
      // Non-fatal logging error
    }

    return {
      data: { id: mockId },
      error: null
    };
  }

  // Live Resend dispatch
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers
    });
    return result;
  } catch (err) {
    return {
      data: null,
      error: {
        name: err.name || 'SendError',
        message: err.message,
        statusCode: err.statusCode || 500
      }
    };
  }
}

/**
 * Returns captured emails in mock mode (used for unit/integration testing).
 */
export function getCapturedEmails() {
  return [...capturedEmails];
}

/**
 * Clears in-memory captured email queue.
 */
export function clearCapturedEmails() {
  capturedEmails.length = 0;
}
