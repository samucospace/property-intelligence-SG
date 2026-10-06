import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openPaths = new Map();
export function hasOpenConnections(file) { return (openPaths.get(path.resolve(file)) || 0) > 0; }

/**
 * Returns current resolved database path dynamically.
 * Evaluates process.env.DB_PATH at call time so runtime or test overrides take effect immediately.
 */
export function getDbPath() {
  return process.env.DB_PATH || path.join(__dirname, 'property.db');
}

/**
 * Creates an isolated database connection with awaited PRAGMA initialization.
 * Order: busy_timeout (10s) -> journal_mode (WAL) -> synchronous (FULL) -> foreign_keys (ON).
 * @param {string} [customPath]
 * @returns {object} Connection object with promisified run, get, all, close methods
 */
export function createConnection(customPath, { uri = false, maintenance = false, readonly = false } = {}) {
  const targetPath = customPath || getDbPath();
  if (targetPath !== ':memory:' && (fs.existsSync(targetPath + '.swap.json') || (!maintenance && fs.existsSync(targetPath + '.maintenance')))) throw new Error('Database maintenance/recovery in progress; refusing connection');
  const trackedPath = path.resolve(targetPath);
  const generationFile = trackedPath + '.generation';
  const generation = fs.existsSync(generationFile) ? fs.readFileSync(generationFile, 'utf8') : '';
  openPaths.set(trackedPath, (openPaths.get(trackedPath) || 0) + 1);
  const dbDir = path.dirname(targetPath);
  if (targetPath !== ':memory:' && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  let raw;
  let openFailed = false;
  let closed = false;
  let revision = 0;
  const opened = new Promise((resolve, reject) => {
    raw = new sqlite3.Database(targetPath, (readonly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) | sqlite3.OPEN_FULLMUTEX | (uri ? sqlite3.OPEN_URI : 0), error => error ? reject(error) : resolve());
  });
  opened.catch(() => { openFailed = true; });

  // Prevent unhandled error event emissions on the raw database instance
  raw.on('error', () => {
    // Error is surfaced through query promises
  });

  const readyPromise = opened.then(async () => {
    for (const sql of (readonly ? ['PRAGMA busy_timeout = 1000', 'PRAGMA query_only = ON'] : ['PRAGMA busy_timeout = 10000', 'PRAGMA journal_mode = WAL', 'PRAGMA synchronous = FULL', 'PRAGMA foreign_keys = ON'])) {
      const deadline = Date.now() + 10000;
      while (true) {
        try {
          await new Promise((resolve, reject) => raw.run(sql, error => error ? reject(error) : resolve()));
          break;
        } catch (error) {
          if (error.code !== 'SQLITE_BUSY' || Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
  });
  readyPromise.catch(() => {});

  const ensureReady = async () => {
    await readyPromise;
    if (closed) throw new Error('Database connection is closed');
    if (targetPath !== ':memory:' && !maintenance) {
      if (fs.existsSync(trackedPath + '.maintenance') || fs.existsSync(trackedPath + '.swap.json')) throw new Error('Database maintenance/recovery in progress');
      const current = fs.existsSync(generationFile) ? fs.readFileSync(generationFile, 'utf8') : '';
      if (current !== generation) throw new Error('Database was replaced; restart this connection');
    }
  };

  return {
    raw,
    get revision() { return revision; },
    path: targetPath,
    async run(sql, params = []) {
      await ensureReady();
      return new Promise((resolve, reject) => {
        raw.run(sql, params, function (err) {
          if (err) reject(err);
          else { revision++; resolve(this); }
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
      await readyPromise.catch(() => {});
      if (closed) return;
      closed = true;
      if (openFailed) {
        openPaths.set(trackedPath, Math.max(0, (openPaths.get(trackedPath) || 1) - 1));
        return;
      }
      return new Promise((resolve, reject) => {
        raw.close((err) => {
          if (err) {
            closed = false;
            reject(err);
          } else {
            openPaths.set(trackedPath, Math.max(0, (openPaths.get(trackedPath) || 1) - 1));
            resolve();
          }
        });
      });
    }
  };
}

let metadataConn=null,metadataPath=null;
// Reserve a read connection for tiny freshness/snapshot queries. Heavy custom
// analytics must not queue cached/default responses behind their SQLite work.
export function getMetadataConnection() {
  const target=getDbPath();
  if(target===':memory:') return getPrimaryConnection();
  if(!metadataConn || metadataPath!==target) {
    if(metadataConn) metadataConn.close().catch(()=>{});
    metadataConn=createConnection(target,{readonly:true});metadataPath=target;
  }
  return metadataConn;
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
  const nested = (conn?.transactionDepth || 0) > 0;
  const savepoint = `nested_${conn?.transactionDepth || 0}`;
  await run(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  if (conn) conn.transactionDepth = (conn.transactionDepth || 0) + 1;
  try {
    const result = await fn();
    await run(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (err) {
    await run(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK').catch(() => {});
    if (nested) await run(`RELEASE ${savepoint}`).catch(() => {});
    throw err;
  } finally {
    if (conn) conn.transactionDepth--;
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
  if(metadataConn) {const conn=metadataConn;metadataConn=null;metadataPath=null;await conn.close();}
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
