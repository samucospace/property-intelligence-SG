import { newsletterYieldRanking } from '../utils/yieldMetrics.js';
import '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enqueueEmail, generateIdempotencyKey } from '../utils/emailQueue.js';
import { createConnection, withTransaction } from '../db.js';
import { releaseFeatures } from '../utils/releasePolicy.js';
import { initDb, dbAll, dbGet, dbRun, closeDb } from '../db.js';
import { generateUnsubscribeToken, escapeHtml } from '../utils/security.js';
import { assertProductionCollection } from '../utils/productionControls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate the responsive HTML email template
export function buildNewsletterHtml({ topYields, sora, recentCaveats, recipientEmail, baseUrl }) {
  let unsubUrl = `${baseUrl}/api/leads/unsubscribe`;
  try {
    const unsubToken = generateUnsubscribeToken(recipientEmail);
    unsubUrl += `?email=${encodeURIComponent(recipientEmail)}&token=${unsubToken}`;
  } catch (err) {
    // If UNSUBSCRIBE_SECRET is not set, log and continue in preview mode
    unsubUrl += `?email=${encodeURIComponent(recipientEmail)}`;
  }
  const currentDateStr = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Singapore Home Intel Weekly Watchlist</title>
  <style>
    body { margin: 0; padding: 0; background-color: #FFFAF0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #36454F; -webkit-font-smoothing: antialiased; }
    .wrapper { width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid rgba(54,69,79,0.12); border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #4F7942 0%, #3B5D31 100%); padding: 32px 24px; text-align: center; color: #FFFFFF; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.9; }
    .content { padding: 24px; }
    .sora-badge { display: inline-block; background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-bottom: 20px; }
    .section-title { font-size: 16px; font-weight: 700; color: #36454F; margin: 24px 0 12px; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #F0E6D2; padding-bottom: 6px; }
    .card { background: #FAF6F0; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; border: 1px solid rgba(54,69,79,0.08); }
    .card-top { display: flex; justify-content: space-between; align-items: baseline; }
    .proj-name { font-weight: 700; font-size: 15px; color: #36454F; }
    .yield-pill { background: #10B981; color: #FFFFFF; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; }
    .card-sub { font-size: 12px; color: #6A7B82; margin-top: 4px; }
    .agent-box { background: linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%); border: 1px solid #A7F3D0; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background: #4F7942; color: #FFFFFF !important; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; font-size: 13px; margin-top: 12px; }
    .sponsor-box { background: #FFFFFF; border: 1px dashed rgba(54,69,79,0.2); border-radius: 8px; padding: 12px 16px; font-size: 11px; color: #6A7B82; margin: 20px 0; text-align: center; }
    .footer { background: #FAF6F0; border-top: 1px solid rgba(54,69,79,0.08); padding: 24px; text-align: center; font-size: 11px; color: #8898AA; line-height: 1.5; }
    .footer a { color: #4F7942; text-decoration: underline; }
  </style>
</head>
<body>
  <div style="padding: 20px 10px;">
    <div class="wrapper">
      <!-- Header -->
      <div class="header">
        <h1>Singapore Home Intel</h1>
        <p>Official Singapore Real Estate Transaction Price & Yield Watchlist • ${currentDateStr}</p>
      </div>

      <div class="content">
        <!-- Benchmark Indicator -->
        <div style="text-align: center;">
          <div class="sora-badge">
            📊 SORA comparison unavailable — historical seed rates are unverified.
          </div>
        </div>

        <p style="font-size: 13px; line-height: 1.5; color: #6A7B82; margin-top: 0;">
          Here is your weekly analytical briefing of recorded Singapore condominium transactions lodged with the Urban Redevelopment Authority (URA), spotlighting high gross rental yield spreads and noteworthy transaction benchmarks.
        </p>

        <p>Project gross yield (%) = median rent psf × 12 ÷ median sale psf × 100. At least 3 usable rentals and 3 sales per project; sales and rentals use the trailing 24-month comparison window. Gross estimates exclude costs and vacancy; area bands use midpoint estimates.</p>
        <div class="section-title">
          🗝️ Estimated Project Yields (Median Inputs)
        </div>

        ${topYields.map((item, idx) => `
          <div class="card">
            <div class="card-top">
              <span class="proj-name">${idx + 1}. ${escapeHtml(item.project_name)}</span>
              <span class="yield-pill">${escapeHtml(item.gross_yield)}% Gross Yield</span>
            </div>
            <div class="card-sub">
              ${escapeHtml(item.market_segment)} • District ${escapeHtml(item.postal_district)} | Median Rent: S$${escapeHtml(Number(item.avg_rent).toLocaleString())}/mo (S$${escapeHtml(item.avg_psft)}/sqft) | Median Sale Price: ~S$${escapeHtml((item.avg_sale_price / 1e6).toFixed(2))}M
            </div>
          </div>
        `).join('')}

        <!-- Recent Notable Caveats -->
        <div class="section-title">
          🏷️ Recent Official Transaction Caveats
        </div>

        ${recentCaveats.map(c => `
          <div class="card" style="background: #FFFFFF;">
            <div class="card-top">
              <span style="font-weight: 600; font-size: 14px;">${escapeHtml(c.project_name)} (D${escapeHtml(c.postal_district)})</span>
              <span style="font-weight: 700; color: #4F7942; font-size: 14px;">S$${escapeHtml(Number(c.price_sgd).toLocaleString())}</span>
            </div>
            <div class="card-sub">
              Transacted on ${escapeHtml(c.contract_date)} • Floor Tier: ${escapeHtml(c.floor_range)} • Rate: S$${escapeHtml(Number(c.psft_sgd).toLocaleString())}/sqft (${escapeHtml(c.type_of_sale)})
            </div>
          </div>
        `).join('')}

        <!-- Direct CEA Specialist Monetization CTA -->
        <div class="agent-box">
          <div style="font-size: 11px; font-weight: 800; color: #065F46; text-transform: uppercase; letter-spacing: 0.5px;">
            Real Estate District Advisory
          </div>
          <div style="font-weight: 700; font-size: 15px; color: #36454F; margin-top: 4px;">
            Planning to Buy, Sell, or Lease a Unit?
          </div>
          <p style="font-size: 12px; color: #6A7B82; margin: 6px 0 0; line-height: 1.4;">
            Get an on-the-ground unit-level valuation breakdown, transacted caveats comparative analysis, and private transaction advisory from our appointed real estate real estate specialist.
          </p>
          <a href="${escapeHtml(baseUrl)}/?enquire=1" class="btn">
            Consult District Specialist (Free) →
          </a>
        </div>

        <!-- Sponsor Slot (Monetization Slot 2) -->
        <div class="sponsor-box">
          <strong>Featured Partner:</strong> Private Property Conveyancing & Home Refinancing Advisory.<br>
          <span style="color: #94A3B8;">Interested in sponsoring the Weekly Singapore Property Digest? Inquire at sponsor@homeintel.sg</span>
        </div>
      </div>

      <!-- PDPA Compliance & Unsubscribe Footer -->
      <div class="footer">
        <p style="margin: 0 0 8px;">
          <strong>Data Attribution:</strong> Official property transaction caveats and rental contracts sourced from the Urban Redevelopment Authority (URA) under the Singapore Open Data Licence. SORA comparisons are disabled pending verified observations.
        </p>
        <p style="margin: 0 0 8px;">
          <strong>Singapore PDPA Compliance:</strong> You are receiving this weekly digest because you subscribed via Singapore Home Intel (homeintel.sg). We respect your privacy and never sell personal data.
        </p>
        <p style="margin: 12px 0 0;">
          <a href="${escapeHtml(unsubUrl)}">Click here to 1-Click Unsubscribe</a> from this list.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

async function main(conn = null) {
  if (!releaseFeatures().leadCapture) return { skipped: true, successCount: 0, failCount: 0, reason: 'Newsletter disabled for read-only release.' };
  assertProductionCollection();
  const all = conn ? conn.all.bind(conn) : dbAll;
  const get = conn ? conn.get.bind(conn) : dbGet;
  const run = conn ? conn.run.bind(conn) : dbRun;
  const isPreview = process.argv.includes('--preview') || process.argv.includes('--dry-run');
  const resendApiKey = process.env.RESEND_API_KEY;
  const baseUrl = process.env.BASE_URL || 'https://homeintel.sg';
  const fromEmail = process.env.NEWSLETTER_FROM_EMAIL || 'Singapore Home Intel <digest@homeintel.sg>';

  console.log(`[${new Date().toISOString()}] Initializing Weekly Automated Newsletter Dispatch...`);
  if (!conn) await initDb();

  // 1. Fetch Latest 3M SORA rate
  const sora = await get(`SELECT reference_month, sora_3m, sora_1m FROM sora_rates ORDER BY reference_month DESC LIMIT 1`);

  // 2. Fetch Top 5 Gross Rental Yield Condominiums (Step 3.2: CTE query without cartesian explosion)
  const topYields = await newsletterYieldRanking(conn);

  // 3. Fetch 3 Recent Notable Transactions
  const recentCaveats = await all(`
    SELECT p.project_name, p.postal_district, t.contract_date, t.price_sgd, t.psft_sgd, t.floor_range, t.type_of_sale
    FROM property_transactions t
    JOIN projects p ON t.project_id = p.project_id
    ORDER BY t.contract_date DESC, t.transaction_id DESC
    LIMIT 3
  `);

  console.log(`Data extracted: ${topYields.length} top yield projects, SORA comparison disabled`);

  // 4. Fetch Active Subscribers who have not yet received this week's dispatch (OPS-01)
  const candidateSubscribers = await all(`
    SELECT lead_id, email, name
    FROM leads
    WHERE lead_type = 'newsletter'
      AND unsubscribed_at IS NULL
      AND confirmed_at IS NOT NULL
      AND (is_quarantined IS NULL OR is_quarantined = 0)
      AND (last_newsletter_sent_at IS NULL OR last_newsletter_sent_at < date('now', '-6 days'))
  `);

  // Filter against suppression ledger
  const { isEmailSuppressed } = await import('../utils/suppression.js');
  const subscribers = [];
  for (const candidate of candidateSubscribers) {
    if (await isEmailSuppressed(candidate.email, conn ? { get: get, run: run, all: all } : null)) {
      continue;
    }
    subscribers.push(candidate);
  }

  console.log(`Active newsletter subscribers pending dispatch: ${subscribers.length}`);

  // Generate Sample HTML
  const sampleEmail = 'preview@example.invalid';
  const sampleHtml = buildNewsletterHtml({ topYields, sora, recentCaveats, recipientEmail: sampleEmail, baseUrl });

  // Save HTML preview file locally
  const previewPath = process.env.NEWSLETTER_PREVIEW_PATH || path.join(__dirname, 'newsletter-preview.html');
  fs.writeFileSync(previewPath, sampleHtml, 'utf8');
  console.log(`✓ Generated local HTML preview at: ${previewPath}`);

  if (!isPreview && process.env.NODE_ENV==='production' && !resendApiKey) throw new Error('RESEND_API_KEY required for enabled newsletter');
  if (isPreview || !resendApiKey) {
    console.log(`\n--- PREVIEW MODE ACTIVE ---`);
    if (!resendApiKey) {
      console.log(`NOTE: RESEND_API_KEY is not configured in server/.env.`);
      console.log(`To send live emails, configure RESEND_API_KEY in server/.env.`);
    }
    console.log(`You can open and inspect the generated newsletter in your browser: file://${previewPath.replace(/\\/g, '/')}`);
    return { preview: true, successCount: 0, failCount: 0 };
  }

  if (!process.env.UNSUBSCRIBE_SECRET) {
    console.error('Fatal: UNSUBSCRIBE_SECRET must be configured before dispatching live newsletters to ensure secure 1-click unsubscribe compliance.');
    throw new Error('UNSUBSCRIBE_SECRET is required for newsletter dispatch.');
  }

  const queueDb = conn || createConnection();
  let queuedCount = 0;
  try {
    const week = new Date(Date.now()+8*60*60*1000);
    week.setUTCHours(0,0,0,0);
    week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
    const campaign = week.toISOString().slice(0,10);
    for (const sub of subscribers) {
      const unsubUrl = `${baseUrl}/api/leads/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${generateUnsubscribeToken(sub.email)}`;
      const result = await withTransaction(queueDb, () => enqueueEmail({
        recipient:sub.email, subject:'Weekly SG Property Yield Watchlist', emailType:'newsletter_digest', leadId:sub.lead_id,
        idempotencyKey:generateIdempotencyKey(sub.email,'newsletter_digest',campaign),
        payload:{from:fromEmail,html:buildNewsletterHtml({topYields,sora,recentCaveats,recipientEmail:sub.email,baseUrl}),
          headers:{'List-Unsubscribe':`<${unsubUrl}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}
      },queueDb));
      if (result.enqueued) queuedCount++;
    }
    return {queuedCount,successCount:0,failCount:0};
  } finally { if (!conn) await queueDb.close(); }

}

export const sendWeeklyNewsletter = main;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(async ({ failCount }) => { await closeDb(); process.exit(failCount > 0 ? 1 : 0); }).catch(err => {
    console.error('Fatal newsletter script error:', err);
    process.exit(1);
  });
}
