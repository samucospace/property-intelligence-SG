import { Resend } from 'resend';
import crypto from 'crypto';
import { releaseFeatures } from './releasePolicy.js';

const capturedEmails = [];
const failure = message => ({ data: null, error: { name: 'EmailDisabled', message, statusCode: 503 } });

// Every sender uses this boundary; isolated environments cannot reach the provider.
export async function sendEmail({ from, to, subject, html, headers = {} }) {
  const features = releaseFeatures();
  if (!features.leadCapture) return failure('Outbound email is disabled for the read-only release.');
  const isMock = ['test', 'staging'].includes(process.env.NODE_ENV) ||
    process.env.MOCK_EMAIL === 'true' || process.env.RESEND_API_KEY?.startsWith('re_mock');
  if (!isMock && (!features.outboundEmail || process.env.NODE_ENV !== 'production')) {
    return failure('Live outbound email requires explicit production enablement.');
  }
  if (!isMock && (!process.env.RESEND_API_KEY || !from)) return failure('Sender/provider configuration is missing.');
  if (isMock && ['422', '500'].includes(process.env.SIMULATE_EMAIL_ERROR)) {
    return { data: null, error: { name: 'SimulatedProviderError', message: 'Simulated provider failure', statusCode: Number(process.env.SIMULATE_EMAIL_ERROR) } };
  }
  if (isMock) {
    const id = `mock-email-${crypto.randomUUID()}`;
    capturedEmails.push({ id, timestamp: new Date().toISOString(), from, to, subject, headers });
    if (capturedEmails.length > 1000) capturedEmails.shift();
    console.log(`[EmailAdapter:MOCK] Captured test dispatch ${id}`);
    return { data: { id }, error: null, mocked: true };
  }
  try {
    return await new Resend(process.env.RESEND_API_KEY).emails.send({ from, to, subject, html, headers });
  } catch (err) {
    return { data: null, error: { name: err.name || 'SendError', message: err.message, statusCode: err.statusCode || 500 } };
  }
}
export function getCapturedEmails() { return [...capturedEmails]; }
export function clearCapturedEmails() { capturedEmails.length = 0; }
