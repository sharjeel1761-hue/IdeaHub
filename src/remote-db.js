/*
 * Optional hosted database (Turso / libSQL) for hosts whose disk is wiped on restart, such as Render's free plan.
 * Turned on by TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN). The server still works in memory exactly as before;
 * this module loads every row from Turso at startup and copies each saved change back to it.
 * Needs the @libsql/client package (installed by `npm install`). Running locally without these settings needs nothing.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function schemaStatements() {
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
    .split(';').map(s => s.trim())
    .filter(s => s && !/^PRAGMA/i.test(s));
}

async function connect({ url, authToken, tables }) {
  const { createClient } = require('@libsql/client');
  const client = createClient({ url, authToken });
  await client.batch(schemaStatements(), 'write');

  return {
    // Every row of every table, as plain objects (integers as numbers).
    async loadAll() {
      const out = {};
      const results = await client.batch(tables.map(t => `SELECT * FROM ${t} ORDER BY id`), 'read');
      tables.forEach((t, i) => {
        out[t] = results[i].rows.map(r => {
          const o = {};
          for (const c of results[i].columns) o[c] = typeof r[c] === 'bigint' ? Number(r[c]) : r[c];
          return o;
        });
      });
      return out;
    },
    // Runs the statements in one transaction: all of them are saved, or none.
    async write(stmts) {
      if (stmts.length) await client.batch(stmts, 'write');
    },
  };
}

module.exports = { connect };
