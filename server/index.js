import './config.js';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import { initDb, dbGet, dbAll, dbRun } from './db.js';
import { fetchUraData, importRealUraData, seedSoraRates } from './ingestion.js';
import { getSearchSuggestions, getPriceAnalytics, getAllProjects, getRentalYieldAnalytics, initSaleValuationsCache, invalidateSaleValuationsCache, invalidateAnalyticsCache } from './queryEngine.js';
import { seedAmenities, calculateLivabilityScore, initLivabilityCache, invalidateLivabilityCache, getProjectLivability } from './livabilityEngine.js';
import { safeEqual, escapeHtml, verifyUnsubscribeToken } from './utils/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy (Caddy / Nginx / Cloudflare - Step 1.4 & 3.4.3)
app.set('trust proxy', 1);

// Step 3.4.6: Request ID tracking middleware
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Security & Performance middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://www.onemap.gov.sg'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    },
    reportOnly: true
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors());

// Step 3.4.2: Strict 100kb body limit for public routes
app.use(express.json({ limit: '100kb' }));

// General Rate Limiter (300 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

// Step 3.4.4: Stricter rate limiter for expensive analytics routes (120 req / 5 min)
const analyticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analytics queries from this IP, please try again later.' }
});
app.use('/api/analytics', analyticsLimiter);

// Step 4.5.1: Dedicated rate limiter for lead submissions (5 req / 1 hr per IP)
const leadsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many enquiry submissions from this IP. Please try again later.' }
});

// Step 3.4.1: Input Validation Middleware for Analytics Endpoints
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;

function validateAnalyticsFilters(req, res, next) {
  const filters = req.body?.filters || req.body || {};

  // 1. Date format & bounds validation
  if (filters.dateFrom) {
    if (!DATE_REGEX.test(filters.dateFrom)) {
      return res.status(400).json({ error: 'Invalid dateFrom format. Expected YYYY-MM or YYYY-MM-DD.' });
    }
    const year = parseInt(filters.dateFrom.slice(0, 4), 10);
    if (year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'dateFrom year must be between 2000 and 2100.' });
    }
  }

  if (filters.dateTo) {
    if (!DATE_REGEX.test(filters.dateTo)) {
      return res.status(400).json({ error: 'Invalid dateTo format. Expected YYYY-MM or YYYY-MM-DD.' });
    }
    const year = parseInt(filters.dateTo.slice(0, 4), 10);
    if (year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'dateTo year must be between 2000 and 2100.' });
    }
  }

  if (filters.dateFrom && filters.dateTo) {
    if (filters.dateFrom > filters.dateTo) {
      return res.status(400).json({ error: 'dateFrom cannot be greater than dateTo.' });
    }
    const dFrom = new Date(filters.dateFrom);
    const dTo = new Date(filters.dateTo);
    const diffYears = (dTo - dFrom) / (1000 * 60 * 60 * 24 * 365.25);
    if (diffYears > 10) {
      return res.status(400).json({ error: 'Date range cannot exceed 10 years.' });
    }
  }

  // 2. Cap projects list at 50 items
  if (Array.isArray(filters.projects) && filters.projects.length > 50) {
    return res.status(400).json({ error: 'Cannot query more than 50 projects simultaneously.' });
  }

  // 3. Numeric fields validation
  if (filters.radiusKm != null && filters.radiusKm !== '') {
    const r = parseFloat(filters.radiusKm);
    if (isNaN(r) || r < 0.1 || r > 10) {
      return res.status(400).json({ error: 'radiusKm must be a number between 0.1 and 10 km.' });
    }
  }

  if (filters.priceMin != null && filters.priceMin !== '') {
    const p = parseFloat(filters.priceMin);
    if (isNaN(p) || p < 0) {
      return res.status(400).json({ error: 'priceMin must be a non-negative number.' });
    }
  }

  if (filters.priceMax != null && filters.priceMax !== '') {
    const p = parseFloat(filters.priceMax);
    if (isNaN(p) || p < 0) {
      return res.status(400).json({ error: 'priceMax must be a non-negative number.' });
    }
  }

  next();
}

// Ingestion Admin Auth Guard (Fail-closed independent of NODE_ENV - Step 1.3)
const requireAdmin = (req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || adminKey.length < 32 || adminKey === 'secure_admin_key_please_change') {
    return res.status(503).json({ error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.' });
  }
  const clientKey = req.get('x-admin-key');
  if (!clientKey || !safeEqual(clientKey, adminKey)) {
    return res.status(401).json({ error: 'Unauthorized: Valid X-Admin-Key header required.' });
  }
  next();
};
app.use('/api/ingest', requireAdmin);

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 1a. SEO: Robots.txt & Dynamic Sitemap
app.get('/robots.txt', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

    // Step 4.3.4: Point to canonical project URLs and include lastmod from projects.updated_at
    const projects = await dbAll(`SELECT project_name, updated_at FROM projects WHERE is_landed_aggregate = 0 ORDER BY project_name ASC LIMIT 5000`);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

    for (const p of projects) {
      const encoded = encodeURIComponent(p.project_name);
      const lastmod = p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      xml += `  <url>\n    <loc>${baseUrl}/?project=${encoded}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }
    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

// 1b. Lead Capture with Honeypot, Length Limits, Double Opt-In & Agent Delivery (Steps 4.4 & 4.5)
app.post('/api/leads/submit', leadsLimiter, async (req, res, next) => {
  try {
    const { name, email, phone, leadType, enquiryType, projectInterest, pdpaConsent, details, website } = req.body;

    // Honeypot check: spambots populate invisible 'website' field
    if (website) {
      console.warn('[Leads] Bot submission dropped via honeypot field');
      return res.json({ status: 'success', message: 'Enquiry received.' });
    }

    // Step 4.4.3: Reject unless pdpaConsent is explicitly true
    if (pdpaConsent !== true) {
      return res.status(400).json({ error: 'Explicit Singapore PDPA consent is required to proceed.' });
    }

    // Step 4.5.1: Maximum lengths and field validation
    if (name && typeof name === 'string' && name.length > 100) {
      return res.status(400).json({ error: 'Name must not exceed 100 characters.' });
    }
    if (!email || typeof email !== 'string' || email.length > 254) {
      return res.status(400).json({ error: 'A valid email address is required (maximum 254 characters).' });
    }
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    const cleanLeadType = leadType === 'newsletter' ? 'newsletter' : 'agent_advisory';

    // Agent advisory validations
    let cleanPhone = null;
    if (cleanLeadType === 'agent_advisory') {
      if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ error: 'A valid Singapore contact number is required for agent advisory.' });
      }
      cleanPhone = phone.trim();
      const SG_PHONE_REGEX = /^(?:\+65\s?)?[689]\d{7}$/;
      if (!SG_PHONE_REGEX.test(cleanPhone.replace(/\s+/g, ''))) {
        return res.status(400).json({ error: 'Please provide a valid 8-digit Singapore phone number starting with 6, 8, or 9.' });
      }
      if (details && typeof details === 'string' && details.length > 2000) {
        return res.status(400).json({ error: 'Enquiry details must not exceed 2000 characters.' });
      }
    }

    if (cleanLeadType === 'newsletter') {
      // Step 4.5.2 & 4.5.3: Double opt-in & prevent duplicate newsletter leads
      const confirmToken = crypto.randomBytes(24).toString('hex');
      const host = req.get('host');
      const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
      const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
      const confirmUrl = `${baseUrl}/api/newsletter/confirm?email=${encodeURIComponent(cleanEmail)}&token=${confirmToken}`;

      await dbRun(
        `INSERT INTO leads (name, email, lead_type, pdpa_consent, consent_version, consent_at, confirmation_token)
         VALUES (?, ?, 'newsletter', 1, 'v1.0', CURRENT_TIMESTAMP, ?)
         ON CONFLICT(email) WHERE lead_type = 'newsletter'
         DO UPDATE SET
           confirmation_token = excluded.confirmation_token,
           pdpa_consent = 1,
           consent_at = CURRENT_TIMESTAMP`,
        [name ? name.trim().slice(0, 100) : null, cleanEmail, confirmToken]
      );

      // If Resend API key configured, send confirmation email; otherwise log link (auto-confirm in dev)
      if (process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: process.env.SENDER_EMAIL || 'Singapore Home Intel <digest@homeintel.sg>',
            to: cleanEmail,
            subject: 'Confirm your subscription - Singapore Home Intel Market Watchlist',
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #1E293B;">
                <h2 style="color: #4F7942; margin-top: 0;">Confirm Your Subscription</h2>
                <p>Thank you for subscribing to Singapore Home Intel's weekly property intelligence briefing.</p>
                <p>Please click the button below to confirm your email address and activate your subscription under Singapore PDPA guidelines:</p>
                <div style="text-align: center; margin: 28px 0;">
                  <a href="${confirmUrl}" style="background-color: #4F7942; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Confirm Subscription</a>
                </div>
                <p style="font-size: 0.8rem; color: #64748B;">If you did not request this subscription, you can safely ignore this email.</p>
              </div>
            `
          });
        } catch (mailErr) {
          console.error('[Newsletter] Error sending confirmation email via Resend:', mailErr);
        }
      } else {
        console.log(`[Newsletter] Dev mode - Confirmation URL for ${cleanEmail}: ${confirmUrl}`);
        if (process.env.NODE_ENV !== 'production') {
          await dbRun(`UPDATE leads SET confirmed_at = CURRENT_TIMESTAMP WHERE email = ? AND lead_type = 'newsletter'`, [cleanEmail]);
        }
      }

      return res.json({
        status: 'success',
        message: process.env.RESEND_API_KEY
          ? 'Confirmation link sent to your email. Please check your inbox to confirm your subscription.'
          : 'Subscribed successfully to weekly market briefs.'
      });
    }

    // Agent Advisory Lead Submission
    await dbRun(
      `INSERT INTO leads (name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, consent_version, consent_at, details)
       VALUES (?, ?, ?, 'agent_advisory', ?, ?, 1, 'v1.0', CURRENT_TIMESTAMP, ?)`,
      [
        name ? name.trim().slice(0, 100) : null,
        cleanEmail,
        cleanPhone,
        enquiryType ? String(enquiryType).trim().slice(0, 50) : 'General Enquiry',
        projectInterest ? String(projectInterest).trim().slice(0, 100) : null,
        details ? String(details).trim().slice(0, 2000) : null
      ]
    );

    // Step 4.5.4: Deliver lead to appointed agent
    const agentEmail = process.env.AGENT_NOTIFICATION_EMAIL || process.env.AGENT_EMAIL;
    if (process.env.RESEND_API_KEY && agentEmail) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.SENDER_EMAIL || 'Singapore Home Intel Leads <leads@homeintel.sg>',
          to: agentEmail,
          subject: `[New Lead] ${enquiryType || 'Advisory'} Enquiry - ${projectInterest || 'General'}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; padding: 20px; color: #334155;">
              <h3 style="color: #4F7942;">New Real Estate Advisory Enquiry</h3>
              <p><strong>Name:</strong> ${escapeHtml(name || 'Unspecified')}</p>
              <p><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p>
              <p><strong>Phone:</strong> ${escapeHtml(cleanPhone)}</p>
              <p><strong>Enquiry Type:</strong> ${escapeHtml(enquiryType || 'General')}</p>
              <p><strong>Project Interest:</strong> ${escapeHtml(projectInterest || 'None')}</p>
              <p><strong>Notes:</strong> ${escapeHtml(details || 'None')}</p>
              <p style="font-size: 0.8rem; color: #64748B; margin-top: 20px;">Singapore PDPA consent confirmed at ${new Date().toISOString()}.</p>
            </div>
          `
        });
      } catch (agentMailErr) {
        console.error('[Leads] Error notifying agent via Resend:', agentMailErr);
      }
    }

    res.json({
      status: 'success',
      message: 'Enquiry received. An accredited CEA representative (ERA Realty Network / Lic: L3002382K) will be in touch shortly.'
    });
  } catch (err) {
    next(err);
  }
});

// Step 4.5.3: Double Opt-In Email Confirmation Endpoint
app.get('/api/newsletter/confirm', async (req, res, next) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

    if (!email || !token) {
      return res.status(400).send('Invalid confirmation request.');
    }

    const lead = await dbGet(
      `SELECT lead_id, confirmation_token FROM leads WHERE email = ? AND lead_type = 'newsletter'`,
      [email]
    );

    if (!lead || !lead.confirmation_token || lead.confirmation_token !== token) {
      return res.status(403).send('Invalid or expired confirmation token.');
    }

    await dbRun(
      `UPDATE leads SET confirmed_at = CURRENT_TIMESTAMP, unsubscribed_at = NULL, confirmation_token = NULL WHERE lead_id = ?`,
      [lead.lead_id]
    );

    res.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Subscription Confirmed - Singapore Home Intel</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #FAF6F0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #FFFFFF; border-radius: 16px; padding: 36px 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; }
          h2 { color: #4F7942; margin-top: 0; font-size: 1.4rem; }
          p { color: #64748B; font-size: 0.92rem; line-height: 1.5; }
          .btn { display: inline-block; background: #4F7942; color: #FFFFFF; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9rem; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Subscription Confirmed!</h2>
          <p>Thank you for verifying your email address. You are now subscribed to the weekly Singapore Home Intel property briefing under Singapore PDPA guidelines.</p>
          <a href="/" class="btn">Explore Property Caveats</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    next(err);
  }
});

// Step 4.5.4: Admin Leads View & CSV Export (Protected by requireAdmin)
app.get('/api/admin/leads', requireAdmin, async (req, res, next) => {
  try {
    const leads = await dbAll(
      `SELECT lead_id, name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, consent_version, consent_at, confirmed_at, unsubscribed_at, created_at, details
       FROM leads
       ORDER BY created_at DESC
       LIMIT 500`
    );
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/leads/export.csv', async (req, res, next) => {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    const providedKey = req.get('x-admin-key') || req.query.key;
    if (!adminKey || adminKey.length < 32 || !providedKey || !safeEqual(providedKey, adminKey)) {
      return res.status(401).send('Unauthorized: Valid admin key required.');
    }

    const leads = await dbAll(
      `SELECT lead_id, name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, confirmed_at, created_at
       FROM leads
       ORDER BY created_at DESC`
    );

    let csv = 'ID,Name,Email,Phone,Type,Enquiry,Project,PDPA,ConfirmedAt,CreatedAt\n';
    for (const l of leads) {
      const row = [
        l.lead_id,
        `"${(l.name || '').replace(/"/g, '""')}"`,
        `"${(l.email || '').replace(/"/g, '""')}"`,
        `"${(l.phone || '').replace(/"/g, '""')}"`,
        l.lead_type,
        `"${(l.enquiry_type || '').replace(/"/g, '""')}"`,
        `"${(l.project_interest || '').replace(/"/g, '""')}"`,
        l.pdpa_consent,
        l.confirmed_at || '',
        l.created_at
      ];
      csv += row.join(',') + '\n';
    }

    res.header('Content-Type', 'text/csv');
    res.attachment(`leads-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// 1c. 1-Click PDPA Unsubscribe Endpoints (RFC 8058 GET and POST)
const handleUnsubscribe = async (req, res, isPost = false) => {
  try {
    const rawEmail = req.query.email || req.body?.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const token = typeof req.query.token === 'string'
      ? req.query.token.trim()
      : (typeof req.body?.token === 'string' ? req.body.token.trim() : '');

    if (!email) {
      return isPost
        ? res.status(400).json({ error: 'Email address is required.' })
        : res.status(400).send('Email address is required.');
    }

    if (!token) {
      return isPost
        ? res.status(401).json({ error: 'Valid unsubscribe verification token required.' })
        : res.status(401).send('Valid unsubscribe verification token required.');
    }

    if (!verifyUnsubscribeToken(email, token)) {
      return isPost
        ? res.status(403).json({ error: 'Invalid or expired unsubscribe link.' })
        : res.status(403).send('Invalid or expired unsubscribe link.');
    }

    await dbRun(`UPDATE leads SET unsubscribed_at = CURRENT_TIMESTAMP WHERE LOWER(email) = ?`, [email]);

    if (isPost) {
      return res.status(200).json({ success: true, message: 'Unsubscribed successfully.' });
    }

    const safeEmail = escapeHtml(email);
    res.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed | Singapore Home Intel</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFAF0; color: #36454F; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 16px; }
          .card { background: #FFFFFF; border: 1px solid rgba(54,69,79,0.12); border-radius: 16px; padding: 40px 32px; max-width: 480px; text-align: center; box-shadow: 0 4px 20px rgba(54,69,79,0.06); }
          h2 { color: #CB6D51; margin-top: 0; font-size: 1.4rem; }
          p { font-size: 0.9rem; line-height: 1.6; color: #6A7B82; }
          .badge { display: inline-block; background: #ECFDF5; color: #065F46; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; margin-bottom: 16px; }
          a { color: #4F7942; text-decoration: none; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">Singapore PDPA Compliant Opt-Out</div>
          <h2>You Have Been Unsubscribed</h2>
          <p>Your email <strong>${safeEmail}</strong> has been removed from the Singapore Home Intel Weekly Watchlist. You will receive no further automated emails from this list.</p>
          <p style="margin-top: 24px;"><a href="/">← Return to Singapore Home Intel</a></p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(`[Error] [Request ID: ${req.id || 'unknown'}] Unsubscribe error:`, err);
    if (isPost) {
      res.status(500).json({ error: 'An error occurred processing your request.', requestId: req.id });
    } else {
      res.status(500).send('An error occurred processing your request.');
    }
  }
};

app.get('/api/leads/unsubscribe', (req, res) => handleUnsubscribe(req, res, false));
app.post('/api/leads/unsubscribe', (req, res) => handleUnsubscribe(req, res, true));

// 2. Search Autocomplete
app.get('/api/search/suggestions', async (req, res, next) => {
  try {
    const q = req.query.q || '';
    const suggestions = await getSearchSuggestions(q);
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});

// 3. Price Trends & Analytics Query (with input validation)
app.post('/api/analytics/price-trends', validateAnalyticsFilters, async (req, res, next) => {
  try {
    const filters = req.body.filters || req.body || {};
    const analytics = await getPriceAnalytics(filters);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// 3b. Rental Prices & Gross Rental Yield Analytics (with input validation)
app.post('/api/analytics/rental-yields', validateAnalyticsFilters, async (req, res, next) => {
  try {
    const filters = req.body.filters || req.body || {};
    const analytics = await getRentalYieldAnalytics(filters);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// 4. All Projects overview
app.get('/api/projects', async (req, res, next) => {
  try {
    let lifestyleWeights = null;
    if (req.query.weights) {
      try { lifestyleWeights = JSON.parse(req.query.weights); } catch (e) {}
    }
    const projects = await getAllProjects(lifestyleWeights);
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// 5. Get Project Livability Score & Amenity Details
app.get('/api/projects/:id/livability', async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const project = await dbGet(`SELECT * FROM projects WHERE project_id = ?`, [projectId]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    let customWeights = null;
    if (req.query.weights) {
      try { customWeights = JSON.parse(req.query.weights); } catch (e) {}
    }

    const livability = await getProjectLivability(project.project_id, project.latitude, project.longitude, customWeights, { trimmed: false });
    res.json({
      project: {
        id: project.project_id,
        name: project.project_name,
        street: project.street_name,
        district: project.postal_district,
        planningArea: project.planning_area,
        lat: project.latitude,
        lng: project.longitude
      },
      livability
    });
  } catch (err) {
    next(err);
  }
});

// 6. Get All Amenities for GIS Map Rendering
app.get('/api/amenities', async (req, res, next) => {
  try {
    const { category } = req.query;
    let sql = `SELECT amenity_id as id, category, name, latitude as lat, longitude as lng, details FROM amenities`;
    let params = [];
    if (category && category !== 'all') {
      sql += ` WHERE category = ?`;
      params.push(category);
    }
    const rows = await dbAll(sql, params);
    const amenities = rows.map(r => {
      let extra = {};
      try { extra = JSON.parse(r.details || '{}'); } catch (e) {}
      return { ...r, details: extra };
    });
    res.json(amenities);
  } catch (err) {
    next(err);
  }
});

// 7. Bulk Import Real URA Data Payload (Dedicated 50mb limit only on this admin route)
app.post('/api/ingest/import-data', express.json({ limit: '50mb' }), async (req, res, next) => {
  try {
    const { jsonData } = req.body;
    if (!jsonData) {
      return res.status(400).json({ error: 'jsonData is required in request body.' });
    }
    const result = await importRealUraData(jsonData);
    invalidateSaleValuationsCache();
    invalidateLivabilityCache();
    invalidateAnalyticsCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 8. Trigger Live URA Data Fetch
app.post('/api/ingest/ura', async (req, res, next) => {
  try {
    const { accessKey } = req.body;
    if (!accessKey) {
      return res.status(400).json({ error: 'AccessKey is required in request body.' });
    }
    const result = await fetchUraData(accessKey);
    invalidateSaleValuationsCache();
    invalidateLivabilityCache();
    invalidateAnalyticsCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 10. Serve Static Frontend in Production
// 10. Serve Static Frontend in Production
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// Step 4.5.5: Clean up expired unconverted agent advisory leads older than 12 months
async function cleanupExpiredLeads() {
  try {
    const result = await dbRun(
      `DELETE FROM leads
       WHERE lead_type = 'agent_advisory'
         AND created_at < date('now', '-12 months')`
    );
    if (result && result.changes > 0) {
      console.log(`[Retention] Purged ${result.changes} unconverted agent advisory leads older than 12 months.`);
    }
  } catch (err) {
    console.error('[Retention] Error cleaning up expired leads:', err);
  }
}

// Catch-all route to serve Vite index.html with Dynamic Server-Side Meta Tags (Step 4.3.2)
app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  const indexPath = path.join(clientDist, 'index.html');
  const fallbackPath = path.join(__dirname, '../client/index.html');
  const targetHtmlPath = fs.existsSync(indexPath) ? indexPath : fallbackPath;

  if (!fs.existsSync(targetHtmlPath)) {
    return res.status(404).send('Application client files not found.');
  }

  const projectName = typeof req.query.project === 'string' ? req.query.project.trim() : null;
  if (!projectName) {
    return res.sendFile(targetHtmlPath);
  }

  try {
    const project = await dbGet(
      `SELECT project_name, street_name, postal_district, market_segment, planning_area
       FROM projects
       WHERE UPPER(project_name) = UPPER(?) LIMIT 1`,
      [projectName]
    );

    if (!project) {
      return res.sendFile(targetHtmlPath);
    }

    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
    const canonicalUrl = `${baseUrl}/?project=${encodeURIComponent(project.project_name)}`;

    const title = `${escapeHtml(project.project_name)} - Caveats, Yields & Livability | Singapore Home Intel`;
    const desc = escapeHtml(
      `Official URA transaction caveats, gross rental yields, and OneMap livability analysis for ${project.project_name} on ${project.street_name || ''} (District ${project.postal_district || 'N/A'}, ${project.market_segment || 'Singapore'}).`
    );

    let html = fs.readFileSync(targetHtmlPath, 'utf8');

    html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
    html = html.replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${desc}" />`);
    html = html.replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${title}" />`);
    html = html.replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${desc}" />`);
    html = html.replace(/<meta property="og:url" content=".*?" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`);
    html = html.replace(/<meta name="twitter:title" content=".*?" \/>/, `<meta name="twitter:title" content="${title}" />`);
    html = html.replace(/<meta name="twitter:description" content=".*?" \/>/, `<meta name="twitter:description" content="${desc}" />`);

    if (html.includes('<link rel="canonical"')) {
      html = html.replace(/<link rel="canonical" href=".*?" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`);
    } else {
      html = html.replace('</head>', `  <link rel="canonical" href="${canonicalUrl}" />\n  </head>`);
    }

    res.type('text/html').send(html);
  } catch (err) {
    console.error('[SEO] Error injecting server-side meta tags:', err);
    res.sendFile(targetHtmlPath);
  }
});

// Step 3.4.6: Global Generic Error Handler with Request ID tracking
app.use((err, req, res, next) => {
  const reqId = req.id || 'unknown';
  console.error(`[Error] [Request ID: ${reqId}] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: 'An internal server error occurred.',
    requestId: reqId
  });
});

// Startup logic
async function startServer() {
  await initDb();

  const projectCount = await dbGet(`SELECT COUNT(*) as count FROM projects`);
  console.log(`Database ready. Total official developments: ${projectCount?.count || 0}`);
  if (!projectCount || projectCount.count === 0) {
    console.log('NOTICE: Database has no official property records yet. Run "node server/scripts/sync-ura.js" to synchronize official URA data.');
  }

  const soraCount = await dbGet(`SELECT COUNT(*) as count FROM sora_rates`);
  if (!soraCount || soraCount.count === 0) {
    console.log('SORA rate dataset empty. Seeding SORA rates...');
    await seedSoraRates();
  }

  await seedAmenities();
  console.log('Pre-warming livability and valuation caches...');
  await initLivabilityCache();
  await initSaleValuationsCache();
  await cleanupExpiredLeads();

  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
