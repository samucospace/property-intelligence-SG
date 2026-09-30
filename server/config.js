import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load server/.env regardless of process.cwd()
const serverEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

import { isPlaceholderSecret } from './utils/security.js';

// Validate critical variables in production
if (process.env.NODE_ENV === 'production') {
  const missing = [];
  if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.length < 32 || isPlaceholderSecret(process.env.ADMIN_API_KEY)) {
    missing.push('ADMIN_API_KEY (must be at least 32 characters and non-placeholder)');
  }
  if (!process.env.UNSUBSCRIBE_SECRET || process.env.UNSUBSCRIBE_SECRET.length < 16 || isPlaceholderSecret(process.env.UNSUBSCRIBE_SECRET)) {
    missing.push('UNSUBSCRIBE_SECRET (must be at least 16 characters and non-placeholder)');
  }
  if (!process.env.BASE_URL) {
    missing.push('BASE_URL (required for production links)');
  }

  if (missing.length > 0) {
    console.error('CRITICAL CONFIGURATION ERROR: Missing required production environment variables:');
    missing.forEach(m => console.error(`  - ${m}`));
    console.error('Please configure these in server/.env or your production environment.\n');
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  adminApiKey: process.env.ADMIN_API_KEY,
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  uraAccessKey: process.env.URA_ACCESS_KEY,
  resendApiKey: process.env.RESEND_API_KEY,
  newsletterFromEmail: process.env.NEWSLETTER_FROM_EMAIL || 'Singapore Home Intel <digest@homeintel.sg>'
};

export default config;
