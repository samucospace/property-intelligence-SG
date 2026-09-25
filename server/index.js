import 'dotenv/config';
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
import { getSearchSuggestions, getPriceAnalytics, getAllProjects, getRentalYieldAnalytics } from './queryEngine.js';
import { seedAmenities, calculateLivabilityScore } from './livabilityEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy (Caddy / Nginx / Cloudflare)
app.set('trust proxy', 1);

// Security & Performance middlewares
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// General Rate Limiter (300 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

// Ingestion Admin Auth Guard
const requireAdmin = (req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY;
  // If in production or if ADMIN_API_KEY is configured, strictly enforce
  if (process.env.NODE_ENV === 'production' || adminKey) {
    const authHeader = req.headers['x-admin-key'] || req.query.adminKey;
    if (!adminKey || authHeader !== adminKey) {
      return res.status(401).json({ error: 'Unauthorized: Valid X-Admin-Key header required.' });
    }
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

app.get('/sitemap.xml', async (req, res) => {
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
    console.error('Error generating sitemap:', err);
    res.status(500).send('Error generating sitemap');
  }
});

// 1b. Lead Capture (Agent Advisory & Weekly Newsletter)
app.post('/api/leads/submit', async (req, res) => {
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
    console.error('Error submitting lead:', err);
    res.status(500).json({ error: err.message });
  }
});

// 1c. 1-Click PDPA Unsubscribe Endpoint
app.get('/api/leads/unsubscribe', async (req, res) => {
  try {
    const { email, token } = req.query;
    if (!email) {
      return res.status(400).send('Email address is required.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const secret = process.env.ADMIN_API_KEY || 'property_sg_newsletter_secret';
    const expectedToken = crypto.createHash('sha256').update(`${cleanEmail}|${secret}`).digest('hex').slice(0, 16);

    if (token && token !== expectedToken) {
      return res.status(403).send('Invalid or expired unsubscribe link.');
    }

    await dbRun(`UPDATE leads SET unsubscribed_at = CURRENT_TIMESTAMP WHERE LOWER(email) = ?`, [cleanEmail]);

    res.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed | Property Intelligence SG</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFFAFO; color: #36454F; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 16px; }
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
          <p>Your email <strong>${cleanEmail}</strong> has been removed from the Property Intelligence SG Weekly Watchlist. You will receive no further automated emails from this list.</p>
          <p style="margin-top: 24px;"><a href="/">← Return to Valuation Portal</a></p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).send('An error occurred processing your request.');
  }
});

// 2. Search Autocomplete
app.get('/api/search/suggestions', async (req, res) => {
  try {
    const q = req.query.q || '';
    const suggestions = await getSearchSuggestions(q);
    res.json(suggestions);
  } catch (err) {
    console.error('Error fetching suggestions:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Price Trends & Analytics Query
app.post('/api/analytics/price-trends', async (req, res) => {
  try {
    const filters = req.body.filters || req.body || {};
    const analytics = await getPriceAnalytics(filters);
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3b. Rental Prices & Gross Rental Yield Analytics POST
app.post('/api/analytics/rental-yields', async (req, res) => {
  try {
    const filters = req.body.filters || req.body || {};
    const analytics = await getRentalYieldAnalytics(filters);
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching rental yield analytics:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. All Projects overview
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await getAllProjects();
    res.json(projects);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Project Livability Score & Amenity Details
app.get('/api/projects/:id/livability', async (req, res) => {
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

    const livability = await calculateLivabilityScore(project.latitude, project.longitude, customWeights);
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
    console.error('Error calculating project livability:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Get All Amenities for GIS Map Rendering
app.get('/api/amenities', async (req, res) => {
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
    console.error('Error fetching amenities:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Bulk Import Real URA Data Payload (JSON Array or Object)
app.post('/api/ingest/import-data', async (req, res) => {
  try {
    const { jsonData } = req.body;
    if (!jsonData) {
      return res.status(400).json({ error: 'jsonData is required in request body.' });
    }
    const result = await importRealUraData(jsonData);
    res.json(result);
  } catch (err) {
    console.error('Error importing real URA dataset:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Trigger Live URA Data Fetch
app.post('/api/ingest/ura', async (req, res) => {
  try {
    const { accessKey } = req.body;
    if (!accessKey) {
      return res.status(400).json({ error: 'AccessKey is required in request body.' });
    }
    const result = await fetchUraData(accessKey);
    res.json(result);
  } catch (err) {
    console.error('Error executing URA live fetch:', err);
    res.status(500).json({ error: err.message });
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

  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});


