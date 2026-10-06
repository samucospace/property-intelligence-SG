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
import { submitLead, confirmLead } from './utils/leadService.js';
import { releaseFeatures } from './utils/releasePolicy.js';
import { initDb, dbGet, dbAll, dbRun, closeDb, getDbPath, createConnection, withTransaction } from './db.js';
import { assertProductionCollection } from './utils/productionControls.js';
import { Resend } from 'resend';
import {analyticsSummary,encodeMapProjects} from './utils/analyticsContract.js';
import {readinessStatus} from './utils/operationalStatus.js';
import {openReadonly} from './utils/databaseArtifacts.js';
import { assertStagingDatabase } from './utils/databaseArtifacts.js';
import { fetchUraData, importRealUraData, seedSoraRates } from './ingestion.js';
import { getSearchSuggestions, getPriceAnalytics, getAllProjects, getRentalYieldAnalytics, initSaleValuationsCache, invalidateSaleValuationsCache, invalidateAnalyticsCache, prepareDefaultAnalytics } from './queryEngine.js';
import { seedAmenities, calculateLivabilityScore, initLivabilityCache, invalidateLivabilityCache, getProjectLivability } from './livabilityEngine.js';
import { safeEqual, escapeHtml, verifyUnsubscribeToken, checkAdminKey, generateAdminSession, verifyAdminSession, isPlaceholderSecret, isTokenRevoked, revokeAdminToken, logAdminAction } from './utils/security.js';
import { validateFilters, validateLeadSubmission } from './utils/validation.js';
import { isEmailSuppressed, suppressEmail } from './utils/suppression.js';
import { cleanupLeads } from './scripts/cleanup-leads.js';

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
    reportOnly: process.env.NODE_ENV !== 'production'
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.get('/api/health/live',(req,res)=>res.set('Cache-Control','no-store').json({status:'alive'}));
let readinessFlight=null,readinessCache=null,readinessExpires=0,readinessPath=null;
app.get('/api/health/ready',async(req,res)=>{
  if(readinessPath!==getDbPath()) {readinessPath=getDbPath();readinessCache=null;readinessExpires=0;}
  if(!readinessCache || Date.now()>=readinessExpires) {
    if(!readinessFlight) readinessFlight=(async()=>{
      let conn;
      try {if(fs.existsSync(getDbPath()+'.maintenance') || fs.existsSync(getDbPath()+'.swap.json')) throw new Error('Database maintenance in progress');conn=openReadonly(getDbPath());return await readinessStatus(conn);} catch {return {ready:false,checks:{database:false},dataState:'unavailable'};}
      finally {if(conn) await conn.close();}
    })().then(result=>{readinessCache=result;readinessExpires=Date.now()+5000;return result;}).finally(()=>{readinessFlight=null;});
    await readinessFlight;
  }
  res.set('Cache-Control','no-store').status(readinessCache.ready?200:503).json(readinessCache);
});
app.post('/api/email/webhook', express.raw({type:'application/json',limit:'100kb'}), async (req,res,next) => {
  if (!process.env.RESEND_WEBHOOK_SECRET) return res.status(503).json({error:'Email webhook not configured'});
  let event;
  try {
    event=new Resend('re_verification_only').webhooks.verify({payload:req.body.toString('utf8'),webhookSecret:process.env.RESEND_WEBHOOK_SECRET,
      headers:{id:req.get('svix-id'),timestamp:req.get('svix-timestamp'),signature:req.get('svix-signature')}});
  } catch { return res.status(401).json({error:'Invalid webhook signature'}); }
  const db=createConnection();
  try {
    await withTransaction(db,async () => {
      const inserted=await db.run('INSERT OR IGNORE INTO email_provider_events(event_id,provider_message_id,event_type) VALUES(?,?,?)',[req.get('svix-id'),event.data?.email_id || null,event.type]);
      if (!inserted.changes) return;
      const reason=event.type==='email.bounced' ? 'bounced' : event.type==='email.complained' ? 'complaint' : null;
      if (reason) for (const email of event.data?.to || []) {
        if (typeof email!=='string') throw new Error('Invalid event recipient');
        await suppressEmail({email,reason,sourceVersion:'provider-webhook'},db);
        await db.run('UPDATE leads SET unsubscribed_at=CURRENT_TIMESTAMP WHERE LOWER(email)=?',[email.trim().toLowerCase()]);
      }
    });
    res.json({status:'recorded'});
  } catch(error) { next(error); } finally { await db.close(); }
});
const allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.ALLOWED_ORIGINS;
if (allowedOrigin) {
  const allowedOrigins = allowedOrigin.split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Admin-Session'],
    credentials: true
  }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Admin-Session'],
    credentials: true
  }));
}

// Step 3.4.2: Strict 100kb body limit for public routes (exempting dedicated 50mb import-data route)
app.use((req, res, next) => {
  if (req.path === '/api/ingest/import-data') {
    return next();
  }
  express.json({ limit: '100kb' })(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// General Rate Limiter (300 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);
app.use(['/api/admin','/api/ingest'],(req,res,next) => {
  if (process.env.NODE_ENV==='production' && !safeEqual(req.get('x-admin-gateway'),process.env.ADMIN_GATEWAY_SECRET)) {
    return res.status(403).json({error:'Private administrative gateway required.'});
  }
  next();
});

// Enforce the selected release scope before parsing or executing protected flows.
app.use((req, res, next) => {
  const features = releaseFeatures();
  // Express routes are case-insensitive and accept a trailing slash by default.
  const routePath = req.path.toLowerCase().replace(/\/+$/, '');
  if (!features.leadCapture && (routePath.startsWith('/api/admin') ||
      routePath === '/api/leads/submit' || routePath.startsWith('/api/newsletter'))) {
    return res.status(403).json({ error: 'Lead and newsletter features are disabled for this release.' });
  }
  if (!features.dataSync && routePath.startsWith('/api/ingest')) {
    return res.status(403).json({ error: 'Data sync is contained pending safety verification.' });
  }
  next();
});
app.get('/api/features', (req, res) => res.set('Cache-Control', 'no-store').json({...releaseFeatures(),
  advisoryPartnerName:process.env.ADVISORY_PARTNER_NAME || null,advisoryPartnerRegistration:process.env.ADVISORY_PARTNER_CEA_REGISTRATION || null,
  hostingProcessorName:process.env.HOSTING_PROCESSOR_NAME || null,backupProcessorName:process.env.BACKUP_PROCESSOR_NAME || null}));

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
function validateAnalyticsFilters(req, res, next) {
  const filters = req.body?.filters !== undefined ? req.body.filters : req.body ?? {};
  const result = validateFilters(filters);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }
  next();
}

// Ingestion & Admin Auth Guard (Fail-closed independent of NODE_ENV - Step 1.3 & IAM-01)
export const requireAdmin = async (req, res, next) => {
  try {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || adminKey.length < 32 || isPlaceholderSecret(adminKey)) {
    return res.status(503).json({ error: 'Admin API disabled: ADMIN_API_KEY is not securely configured.' });
  }

  // 1. Check Bearer session token (IAM-01)
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const sessionToken = authHeader.slice(7).trim();
    if (verifyAdminSession(sessionToken, adminKey)) {
      const revoked = await isTokenRevoked(sessionToken);
      if (!revoked) {
        req.adminOperator = JSON.parse(Buffer.from(sessionToken.split('.')[0],'base64url').toString()).operator;
        req.adminSessionToken = sessionToken;
        return next();
      }
    }
  }

  // 2. Check X-Admin-Session header (IAM-01)
  const sessionHeader = req.get('x-admin-session');
  if (sessionHeader) {
    const sessionToken = sessionHeader.trim();
    if (verifyAdminSession(sessionToken, adminKey)) {
      const revoked = await isTokenRevoked(sessionToken);
      if (!revoked) {
        req.adminOperator = JSON.parse(Buffer.from(sessionToken.split('.')[0],'base64url').toString()).operator;
        req.adminSessionToken = sessionToken;
        return next();
      }
    }
  }

  return res.status(401).json({error:'Unauthorized: Valid admin session token required.'});
  } catch (error) { return res.status(503).json({error:'Admin authentication temporarily unavailable.'}); }
};
app.use('/api/ingest', requireAdmin);

// Admin Login Rate Limiter (5 attempts per 15 minutes to prevent brute forcing)
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin authentication attempts. Please try again after 15 minutes.' }
});

// Admin Session Login Endpoint (IAM-01)
app.post('/api/admin/login', adminLoginLimiter, async (req, res, next) => {
  try {
  const { adminKey } = req.body || {};
  const configuredKey = process.env.ADMIN_API_KEY;

  const check = checkAdminKey(configuredKey, adminKey);
  if (!check.ok) {
    return res.status(check.status).json({ error: check.error });
  }

  const session = generateAdminSession(configuredKey);
  await logAdminAction({ operator: process.env.ADMIN_OPERATOR || 'local-operator', action: 'login', ip: req.ip });
  console.log(`[Admin] Authenticated new admin session (expires at ${session.expiresAt}).`);
  res.json({
    status: 'success',
    token: session.token,
    expiresAt: session.expiresAt
  });
  } catch(error) { next(error); }
});

app.post('/api/admin/logout', requireAdmin, async (req, res, next) => {
  try {
  if (req.adminSessionToken) {
    await revokeAdminToken(req.adminSessionToken, 'operator_logout');
  }
  await logAdminAction({ operator: req.adminOperator, action: 'logout', ip: req.ip });
  res.json({ status: 'success', message: 'Logged out successfully.' });
  } catch(error) { next(error); }
});

// 1. Health check (Step 5.5: Return 503 if database check fails)
app.get('/api/health', async (req, res) => {
  try {
    await dbGet('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: 'Database check failed', timestamp: new Date().toISOString() });
  }
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
    assertProductionCollection();
    const validation = validateLeadSubmission(req.body);
    if (!validation.valid) return res.status(400).json({error:validation.error});
    if (validation.isBot) return res.json({status:'success',message:'Enquiry received.'});
    const result = await submitLead(req.body);
    return res.status(result.status).json(result.error ? {error:result.error} : {status:'success',message:result.message});
  } catch (error) { next(error); }
});

// Step 4.5.3: Double Opt-In Email Confirmation Endpoints (GL-10 Scanner-Safe Two-Step)
// GET renders confirmation page without mutating database (prevents link crawlers from opting in)
app.get('/api/newsletter/confirm', async (req, res, next) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

    if (!email || !token) {
      return res.status(400).send('Invalid confirmation request: email and token required.');
    }

    const lead = await dbGet(
      `SELECT lead_id, email, confirmation_token, confirmation_token_expires_at,
              datetime(confirmation_token_expires_at)>datetime('now') AS token_valid
       FROM leads
       WHERE email = ? AND lead_type = 'newsletter'`,
      [email]
    );

    if (!lead || !lead.confirmation_token || lead.confirmation_token !== token) {
      return res.status(403).type('text/html').send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>Invalid Link - Singapore Home Intel</title>
        <style>body { font-family: -apple-system, sans-serif; background: #FAF6F0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #FFFFFF; border-radius: 16px; padding: 36px 32px; max-width: 480px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        h2 { color: #CB6D51; margin-top: 0; }</style></head>
        <body><div class="card"><h2>Invalid or Expired Link</h2>
        <p>This confirmation link is invalid, expired, or has already been used. Please request a new subscription on the homepage.</p>
        <a href="/" style="display: inline-block; background: #4F7942; color: #FFF; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 12px;">Return to Homepage</a></div></body></html>
      `);
    }

    if (!lead.token_valid) {
      return res.status(403).type('text/html').send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>Expired Link - Singapore Home Intel</title>
        <style>body { font-family: -apple-system, sans-serif; background: #FAF6F0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #FFFFFF; border-radius: 16px; padding: 36px 32px; max-width: 480px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        h2 { color: #CB6D51; margin-top: 0; }</style></head>
        <body><div class="card"><h2>Confirmation Link Expired</h2>
        <p>Confirmation links expire after 24 hours. Please return to the homepage to request a fresh subscription.</p>
        <a href="/" style="display: inline-block; background: #4F7942; color: #FFF; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 12px;">Return to Homepage</a></div></body></html>
      `);
    }

    // Render interactive confirmation page without modifying state
    res.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirm Your Subscription - Singapore Home Intel</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #FAF6F0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #FFFFFF; border-radius: 16px; padding: 36px 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; }
          h2 { color: #4F7942; margin-top: 0; font-size: 1.4rem; }
          p { color: #64748B; font-size: 0.92rem; line-height: 1.5; }
          .btn { display: inline-block; background: #4F7942; color: #FFFFFF; padding: 12px 26px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.95rem; margin-top: 16px; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Confirm Your Subscription</h2>
          <p>Please click below to activate your subscription to the Singapore Home Intel weekly property intelligence digest under Singapore PDPA guidelines.</p>
          <form method="POST" action="/api/newsletter/confirm">
            <input type="hidden" name="email" value="${escapeHtml(email)}" />
            <input type="hidden" name="token" value="${escapeHtml(token)}" />
            <button type="submit" class="btn">Confirm Subscription</button>
          </form>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    next(err);
  }
});

// POST endpoint executes single-use confirmation and mutates state
app.post('/api/newsletter/confirm', async (req, res, next) => {
  try {
    const rawEmail = req.body?.email || req.query.email;
    const rawToken = req.body?.token || req.query.token;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';

    if (!email || !token) {
      return res.status(400).json({ error: 'Valid email and confirmation token required.' });
    }

    const confirmation = await confirmLead(email,token);
    if (confirmation.status!==200) return res.status(confirmation.status).json({error:'Invalid, expired, already used or suppressed confirmation token.'});

    if (req.accepts('html') && !req.xhr && !req.headers['content-type']?.includes('json')) {
      return res.type('text/html').send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>Subscription Confirmed - Singapore Home Intel</title>
        <style>body { font-family: -apple-system, sans-serif; background: #FAF6F0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #FFFFFF; border-radius: 16px; padding: 36px 32px; max-width: 480px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        h2 { color: #4F7942; margin-top: 0; }</style></head>
        <body><div class="card"><h2>Subscription Confirmed!</h2>
        <p>Thank you for verifying your email address. You are now subscribed to the weekly Singapore Home Intel property briefing under Singapore PDPA guidelines.</p>
        <a href="/" style="display: inline-block; background: #4F7942; color: #FFF; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Explore Property Caveats</a></div></body></html>
      `);
    }

    res.json({
      status: 'success',
      message: 'Subscription confirmed successfully.'
    });
  } catch (err) {
    next(err);
  }
});

// Step 4.5.4: Admin Leads View & CSV Export (Protected by requireAdmin)
app.get('/api/admin/leads', requireAdmin, async (req, res, next) => {
  try {
    await logAdminAction({ operator: req.adminOperator, action: 'view_leads', ip: req.ip });
    const leads = await dbAll(
      `SELECT lead_id, name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, consent_version, consent_at, confirmed_at, unsubscribed_at, is_quarantined, is_converted, created_at, details
       FROM leads
       ORDER BY created_at DESC
       LIMIT 500`
    );
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

function sanitizeCsvCell(val) {
  if (val == null) return '""';
  let str = String(val);
  // Mitigate CSV Formula Injection (CWE-1236): prefix cells starting with =, +, -, @, \t, \r with single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

app.get('/api/admin/leads/export.csv', requireAdmin, async (req, res, next) => {
  try {
    await logAdminAction({ operator: req.adminOperator, action: 'export_csv', ip: req.ip });
    const leads = await dbAll(
      `SELECT lead_id, name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, confirmed_at, created_at
       FROM leads
       ORDER BY created_at DESC`
    );

    let csv = 'ID,Name,Email,Phone,Type,Enquiry,Project,PDPA,ConfirmedAt,CreatedAt\n';
    for (const l of leads) {
      const row = [
        l.lead_id,
        sanitizeCsvCell(l.name),
        sanitizeCsvCell(l.email),
        sanitizeCsvCell(l.phone),
        sanitizeCsvCell(l.lead_type),
        sanitizeCsvCell(l.enquiry_type),
        sanitizeCsvCell(l.project_interest),
        l.pdpa_consent,
        sanitizeCsvCell(l.confirmed_at),
        sanitizeCsvCell(l.created_at)
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

// Step 3.1 / PRIV-01: Admin Right-to-Erasure Endpoint (PDPA Section 25 & GDPR Article 17)
app.post('/api/admin/leads/:id/conversion', requireAdmin, async (req,res,next) => {
  const id=Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<1 || typeof req.body?.converted!=='boolean') return res.status(400).json({error:'Valid lead ID and boolean converted required.'});
  const db=createConnection();
  try {
    const result=await withTransaction(db,async () => {
      await logAdminAction({operator:req.adminOperator,action:'set_conversion',targetId:String(id),ip:req.ip,details:{converted:req.body.converted}},db);
      return db.run(`UPDATE leads SET is_converted=?,retention_reviewed_at=CURRENT_TIMESTAMP,converted_at=CASE WHEN ?=1 THEN COALESCE(converted_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE lead_id=? AND lead_type='agent_advisory'`,[Number(req.body.converted),Number(req.body.converted),id]);
    });
    res.status(result.changes ? 200 : 404).json({status:result.changes ? 'updated' : 'not_found'});
  } catch(error) { next(error); } finally { await db.close(); }
});
app.delete('/api/admin/leads/:id', requireAdmin, async (req, res, next) => {
  try {
    const leadId = /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN;
    if (isNaN(leadId) || leadId <= 0) {
      return res.status(400).json({ error: 'Valid numeric lead ID required.' });
    }
    const db=createConnection();
    let erased;
    try {
      erased=await withTransaction(db,async () => {
        const lead=await db.get('SELECT lead_id,email FROM leads WHERE lead_id=?',[leadId]);
        if (!lead) return false;
        await logAdminAction({operator:req.adminOperator,action:'erase_lead',targetId:String(leadId),ip:req.ip},db);
        await suppressEmail({email:lead.email,reason:'erased',sourceVersion:'admin-erasure'},db);
        await db.run('DELETE FROM leads WHERE LOWER(email)=LOWER(?)',[lead.email]);
        return true;
      });
    } finally {await db.close();}
    if (!erased) return res.status(404).json({error:'Lead record not found.'});
    console.log(`[Admin] Lead ${leadId} permanently erased under Right-to-Erasure request.`);
    res.json({ status: 'success', message: `Lead ${leadId} permanently erased.` });
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

    const db=createConnection();
    try {
      await withTransaction(db,async () => {
        await suppressEmail({email,reason:'unsubscribed',sourceVersion:'user-unsubscribe'},db);
        await db.run('UPDATE leads SET unsubscribed_at=CURRENT_TIMESTAMP,confirmation_token=NULL WHERE LOWER(email)=?',[email]);
      });
    } finally {await db.close();}

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
    const filters = req.body?.filters || req.body || {};
    const analytics = await getPriceAnalytics(filters);
    res.json(analyticsSummary(analytics));
  } catch (err) {
    next(err);
  }
});

// 3b. Rental Prices & Gross Rental Yield Analytics (with input validation)
app.post('/api/analytics/rental-yields', validateAnalyticsFilters, async (req, res, next) => {
  try {
    const filters = req.body?.filters || req.body || {};
    const analytics = await getRentalYieldAnalytics(filters);
    res.json(analyticsSummary(analytics));
  } catch (err) {
    next(err);
  }
});

app.post('/api/analytics/map',validateAnalyticsFilters,async(req,res,next)=>{
  if(!['sale','rental'].includes(req.body?.mode)) return res.status(400).json({error:'Map mode must be sale or rental.'});
  try {
    const filters=req.body.filters || {};
    const analytics=await (req.body.mode==='sale' ? getPriceAnalytics(filters) : getRentalYieldAnalytics(filters));
    res.json(encodeMapProjects(analytics.mapProjects));
  } catch(error) {next(error);}
});

// 4. All Projects overview
app.get('/api/projects', async (req, res, next) => {
  try {
    let lifestyleWeights = null;
    if (req.query.weights) {
      try { lifestyleWeights = JSON.parse(req.query.weights); } catch (e) {}
    }
    const projects = await getAllProjects(lifestyleWeights);
    res.json(encodeMapProjects(projects));
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
    await logAdminAction({operator:req.adminOperator,action:'import_data',ip:req.ip});
    const result = await importRealUraData(jsonData);
    await invalidateSaleValuationsCache();
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
    await logAdminAction({operator:req.adminOperator,action:'manual_sync',ip:req.ip});
    const result = await fetchUraData(accessKey);
    await invalidateSaleValuationsCache();
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
app.use(express.static(clientDist, { index: false }));

// Step 4.5.5 & PRIV-01: Clean up expired leads according to PDPA & GDPR retention policies
async function cleanupExpiredLeads() {
  try {
    await cleanupLeads();
  } catch (err) {
    console.error('[Retention] Error cleaning up expired leads:', err);
  }
}

// Step 4.3.2 / PERF-01: Cache base index.html template in memory to eliminate synchronous disk I/O on hot-path SEO requests
let cachedIndexHtml = null;
let cachedIndexPath = null;

export function getIndexHtmlTemplate(targetPath) {
  if (process.env.NODE_ENV === 'production' && cachedIndexHtml && cachedIndexPath === targetPath) {
    return cachedIndexHtml;
  }
  const content = fs.readFileSync(targetPath, 'utf8');
  if (process.env.NODE_ENV === 'production') {
    cachedIndexHtml = content;
    cachedIndexPath = targetPath;
  }
  return content;
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

    let html = getIndexHtmlTemplate(targetHtmlPath);

    // Use replacer functions (() => val) to prevent $ characters in titles/descriptions from triggering regex patterns
    html = html.replace(/<title>.*?<\/title>/, () => `<title>${title}</title>`);
    html = html.replace(/<meta name="description" content=".*?" \/>/, () => `<meta name="description" content="${desc}" />`);
    html = html.replace(/<meta property="og:title" content=".*?" \/>/, () => `<meta property="og:title" content="${title}" />`);
    html = html.replace(/<meta property="og:description" content=".*?" \/>/, () => `<meta property="og:description" content="${desc}" />`);
    html = html.replace(/<meta property="og:url" content=".*?" \/>/, () => `<meta property="og:url" content="${canonicalUrl}" />`);
    html = html.replace(/<meta name="twitter:title" content=".*?" \/>/, () => `<meta name="twitter:title" content="${title}" />`);
    html = html.replace(/<meta name="twitter:description" content=".*?" \/>/, () => `<meta name="twitter:description" content="${desc}" />`);

    if (html.includes('<link rel="canonical"')) {
      html = html.replace(/<link rel="canonical" href=".*?" \/>/, () => `<link rel="canonical" href="${canonicalUrl}" />`);
    } else {
      html = html.replace('</head>', () => `  <link rel="canonical" href="${canonicalUrl}" />\n  </head>`);
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
  console.error('[Error]',{requestId:reqId,method:req.method,path:req.path,code:err.code || 'REQUEST_FAILED'});
  if (res.headersSent) {
    return next(err);
  }
  if(err.status===503) res.set('Retry-After','5');
  res.status(err.status || 500).json({
    error: 'An internal server error occurred.',
    requestId: reqId
  });
});

// Startup logic
async function startServer() {
  assertProductionCollection();
  await assertStagingDatabase(getDbPath());
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
  await prepareDefaultAnalytics();

  // Phase 0 containment: Do not run destructive cleanup on simple web server start
  if (releaseFeatures().leadCleanup && process.env.ENABLE_STARTUP_LEAD_CLEANUP === 'true') {
    await cleanupExpiredLeads();
  } else {
    console.log('[Startup] Automatic lead retention cleanup on boot skipped (ENABLE_STARTUP_LEAD_CLEANUP !== "true").');
  }

  const warming=setInterval(()=>prepareDefaultAnalytics().catch(error=>console.error('[Analytics] Preparation failed:',error.message)),30000);
  warming.unref();
  const server = app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });

  // Step 5.5: Graceful shutdown on SIGTERM / SIGINT
  const shutdown = async (signal) => {
    console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);
    clearInterval(warming);
    server.close(async () => {
      console.log('[Shutdown] HTTP listener closed.');
      try {
        await closeDb();
        console.log('[Shutdown] Database connection cleanly closed.');
        process.exit(0);
      } catch (dbErr) {
        console.error('[Shutdown] Error closing database connection:', dbErr);
        process.exit(1);
      }
    });

    // Hard exit after 10s if hanging
    setTimeout(() => {
      console.error('[Shutdown] Forceful shutdown after 10s timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  server.once('close',()=>clearInterval(warming));
  return server;
}

export { app, startServer };

// Step 5.5: Ensure startup failure exits non-zero so PM2/Docker triggers restart
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
