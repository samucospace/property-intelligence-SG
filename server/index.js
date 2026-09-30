import './config.js';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
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

    const projects = await dbAll(`SELECT project_name, updated_at FROM projects ORDER BY project_name ASC LIMIT 5000`);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

    for (const p of projects) {
      const encoded = encodeURIComponent(p.project_name);
      xml += `  <url>\n    <loc>${baseUrl}/?project=${encoded}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }
    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

// 1b. Lead Capture (Agent Advisory & Weekly Newsletter)
app.post('/api/leads/submit', async (req, res, next) => {
  try {
    const { name, email, phone, leadType, enquiryType, projectInterest, pdpaConsent, details } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    await dbRun(
      `INSERT INTO leads (name, email, phone, lead_type, enquiry_type, project_interest, pdpa_consent, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name ? name.trim() : null,
        email.trim().toLowerCase(),
        phone ? phone.trim() : null,
        leadType || 'agent_advisory',
        enquiryType || 'General Enquiry',
        projectInterest || null,
        pdpaConsent ? 1 : 0,
        details || null
      ]
    );
    res.json({ status: 'success', message: 'Enquiry received. An accredited CEA representative will be in touch.' });
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
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// Catch-all route to serve Vite index.html for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'));
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

  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
