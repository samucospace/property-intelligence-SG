import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns current resolved database path dynamically.
 * Evaluates process.env.DB_PATH at call time so runtime or test overrides take effect immediately.
 */
export function getDbPath() {
  return process.env.DB_PATH || path.join(__dirname, 'property.db');
}

/**
 * Creates an isolated database connection with awaited PRAGMA initialization.
 * Order: busy_timeout (10s) -> journal_mode (WAL) -> synchronous (NORMAL) -> foreign_keys (ON).
 * @param {string} [customPath]
 * @returns {object} Connection object with promisified run, get, all, close methods
 */
export function createConnection(customPath) {
  const targetPath = customPath || getDbPath();
  const dbDir = path.dirname(targetPath);
  if (targetPath !== ':memory:' && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const raw = new sqlite3.Database(targetPath);

  // Prevent unhandled error event emissions on the raw database instance
  raw.on('error', () => {
    // Error is surfaced through query promises
  });

  const readyPromise = new Promise((resolve) => {
    raw.serialize(() => {
      // 1. busy_timeout MUST be set before any contending write/journal pragmas
      raw.run('PRAGMA busy_timeout = 10000;', () => {});
      // 2. Set WAL mode
      raw.run('PRAGMA journal_mode = WAL;', () => {});
      // 3. Normal synchronous for WAL durability and performance
      raw.run('PRAGMA synchronous = NORMAL;', () => {});
      // 4. Enforce foreign keys
      raw.run('PRAGMA foreign_keys = ON;', () => {
        resolve();
      });
    });
  });

  const ensureReady = async () => {
    await readyPromise;
  };

  return {
    raw,
    path: targetPath,
    async run(sql, params = []) {
      await ensureReady();
      return new Promise((resolve, reject) => {
        raw.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    },
    async get(sql, params = []) {
      await ensureReady();
      return new Promise((resolve, reject) => {
        raw.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    async all(sql, params = []) {
      await ensureReady();
      return new Promise((resolve, reject) => {
        raw.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    async close() {
      await ensureReady();
      return new Promise((resolve, reject) => {
        raw.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
}

let primaryConn = null;
let currentPrimaryPath = null;

/**
 * Returns or initializes the shared primary database connection.
 * Automatically adapts if process.env.DB_PATH changes.
 */
export function getPrimaryConnection() {
  const targetPath = getDbPath();
  if (!primaryConn || currentPrimaryPath !== targetPath) {
    if (primaryConn) {
      primaryConn.close().catch(() => {});
    }
    primaryConn = createConnection(targetPath);
    currentPrimaryPath = targetPath;
  }
  return primaryConn;
}

export function dbRun(sql, params = []) {
  return getPrimaryConnection().run(sql, params);
}

export function dbAll(sql, params = []) {
  return getPrimaryConnection().all(sql, params);
}

export function dbGet(sql, params = []) {
  return getPrimaryConnection().get(sql, params);
}

/**
 * Executes a function inside an immediate SQLite transaction.
 * Rolls back automatically on error.
 * @param {object} conn Connection object with run method (or defaults to dbRun)
 * @param {Function} fn Async callback to execute inside the transaction
 * @returns {Promise<any>}
 */
export async function withTransaction(conn, fn) {
  const run = conn?.run ? conn.run.bind(conn) : dbRun;
  await run('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await run('COMMIT');
    return result;
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * Initializes database by executing pending versioned migrations.
 */
export async function initDb(customPath) {
  const targetPath = customPath || getDbPath();
  const conn = createConnection(targetPath);
  try {
    await runMigrations(conn);
    console.log(`Database initialized and migrations applied successfully (${targetPath}).`);
  } finally {
    await conn.close();
  }
}

/**
 * Cleanly closes the primary database connection.
 */
export async function closeDb() {
  if (primaryConn) {
    const connToClose = primaryConn;
    primaryConn = null;
    currentPrimaryPath = null;
    await connToClose.close();
  }
}

export default {
  get raw() {
    return getPrimaryConnection().raw;
  }
};
