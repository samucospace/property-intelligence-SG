import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function openReadonly(file) {
  let raw;
  const ready = new Promise((resolve, reject) => { raw = new sqlite3.Database(path.resolve(file), sqlite3.OPEN_READONLY, err => err ? reject(err) : resolve()); });
  const query = async (method, sql, params = []) => { await ready; return new Promise((resolve, reject) => raw[method](sql, params, (err, value) => err ? reject(err) : resolve(value))); };
  return { all: (sql, params) => query('all', sql, params), get: (sql, params) => query('get', sql, params), run: (sql, params) => query('run', sql, params), close: async () => { try { await ready; } catch { return; } return new Promise((resolve, reject) => raw.close(err => err ? reject(err) : resolve())); } };
}

export async function databaseMetrics(file) {
  const conn = openReadonly(file);
  try {
    const integrity = await conn.all('PRAGMA integrity_check');
    const foreignKeys = await conn.all('PRAGMA foreign_key_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeys.length) throw new Error('Database integrity or foreign-key validation failed');
    const tables = await conn.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const counts = {};
    for (const { name } of tables) counts[name] = (await conn.get(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`)).n;
    return { integrity: 'ok', foreignKeyViolations: 0, counts };
  } finally { await conn.close(); }
}

export function fileHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

export async function assertStagingDatabase(file) {
  if (process.env.NODE_ENV !== 'staging') return;
  const conn = openReadonly(file);
  try {
    const row = await conn.get("SELECT value FROM environment_metadata WHERE name='environment'");
    if (row?.value !== 'staging') throw new Error('Missing staging marker');
  } catch {
    throw new Error('Refusing staging startup: DB_PATH is not a prepared staging database');
  } finally { await conn.close(); }
}
