import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, dbGet, dbAll } from './db.js';
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


