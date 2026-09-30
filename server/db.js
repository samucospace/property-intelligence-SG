import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = process.env.DB_PATH || path.join(__dirname, 'property.db');

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Primary connection for general web app read queries
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA busy_timeout = 5000;');
  db.run('PRAGMA foreign_keys = ON;');
});

export function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

export function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Creates an isolated, dedicated database connection.
 * Used by batch ingestion and migrations so long-running operations
 * do not block or interfere with main web server requests.
 * @param {string} [customPath]
 * @returns {object} Connection object with promisified run, get, all, close methods
 */
export function createConnection(customPath = dbPath) {
  const conn = new sqlite3.Database(customPath);
  conn.serialize(() => {
    conn.run('PRAGMA journal_mode = WAL;');
    conn.run('PRAGMA busy_timeout = 5000;');
    conn.run('PRAGMA foreign_keys = ON;');
  });

  return {
    raw: conn,
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        conn.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        conn.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        conn.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        conn.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
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
export async function initDb() {
  const conn = createConnection();
  try {
    await runMigrations(conn);
    console.log('Database initialized and migrations applied successfully.');
  } finally {
    await conn.close();
  }
}

export default db;
