#!/usr/bin/env node
/*
 * IdeaHub DDUC server. Zero dependencies: Node 22+ (built-in node:sqlite).
 *   node server.js            → http://localhost:3000
 * Env: PORT, DB_PATH (default data/ideahub.db), SEED=0 to start without the sample ideas,
 *      MODERATORS=name1,name2 (these usernames get the moderator role),
 *      TURSO_DATABASE_URL + TURSO_AUTH_TOKEN to keep the data in a hosted Turso database (see DEPLOY.md).
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const core = require('./src/core.js');
const { seed } = require('./src/seed.js');

const PORT = Number(process.env.PORT) || 3000;
const REMOTE_URL = process.env.TURSO_DATABASE_URL || '';
const DB_PATH = REMOTE_URL ? ':memory:' : process.env.DB_PATH || path.join(__dirname, 'data', 'ideahub.db');
const PUBLIC = path.join(__dirname, 'public');
const MODERATORS = (process.env.MODERATORS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
// Behind a hosting proxy (Render sets RENDER) the visitor's address and https come from forwarded headers.
const BEHIND_PROXY = !!(process.env.RENDER || process.env.TRUST_PROXY);

// ───────── database ─────────
// With TURSO_DATABASE_URL the local SQLite database lives in memory and every committed change is also written to Turso,
// so nothing is lost when the host restarts or wipes its disk.
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'schema.sql'), 'utf8'));
let remote = null;
let pending = []; // changes made in the current transaction, sent to Turso before COMMIT

const stmtCache = new Map();
const prep = sql => { let s = stmtCache.get(sql); if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); } return s; };
const toSql = (table, row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = (core.JSON_COLS[table] || []).includes(k) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v;
  }
  return out;
};
const sqliteAdapter = {
  insert(table, row) {
    const r = toSql(table, row), cols = Object.keys(r);
    prep(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(r);
    if (remote) pending.push({ sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: Object.values(r) });
  },
  update(table, id, patch) {
    const r = toSql(table, patch), cols = Object.keys(r);
    if (!cols.length) return;
    prep(`UPDATE ${table} SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@__id`).run(Object.assign({ __id: id }, r));
    if (remote) pending.push({ sql: `UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`, args: [...Object.values(r), id] });
  },
  remove(table, id) {
    prep(`DELETE FROM ${table} WHERE id=?`).run(id);
    if (remote) pending.push({ sql: `DELETE FROM ${table} WHERE id=?`, args: [id] });
  },
};

const store = core.createStore(sqliteAdapter);
function loadAll() {
  store.reset();
  for (const t of core.TABLES) store.load(t, prep(`SELECT * FROM ${t} ORDER BY id`).all().map(r => Object.assign({}, r)));
}

// Transactions: one change at a time, saved to Turso (when used) before the local COMMIT, so both always agree.
let queue = Promise.resolve();
function transaction(fn) {
  const run = queue.then(async () => {
    db.exec('BEGIN');
    pending = [];
    try {
      const out = await fn();
      if (out && out.failed) throw Object.assign(new Error('rolled back'), { rollbackWith: out });
      if (remote) await remote.write(pending);
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      loadAll();
      if (e.rollbackWith) return e.rollbackWith;
      if (!(e instanceof core.ApiError) && remote) console.error('Saving to the database failed:', e);
      throw e;
    } finally {
      pending = [];
    }
  });
  queue = run.catch(() => {});
  return run;
}

function promoteModerators() {
  for (const u of store.all('users')) {
    if (MODERATORS.includes(u.username.toLowerCase()) && u.role !== 'moderator') store.update('users', u.id, { role: 'moderator' });
  }
}

async function openDatabase() {
  if (REMOTE_URL) {
    remote = await require('./src/remote-db.js').connect({ url: REMOTE_URL, authToken: process.env.TURSO_AUTH_TOKEN, tables: core.TABLES });
    const rows = await remote.loadAll();
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of core.TABLES) {
      for (const r of rows[t]) {
        const cols = Object.keys(r);
        prep(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(r);
      }
    }
    db.exec('PRAGMA foreign_keys = ON');
    console.log(`Loaded ${rows.users.length} users and ${rows.ideas.length} ideas from Turso.`);
  }
  loadAll();
  // seed on first run
  if (!store.all('users').length && process.env.SEED !== '0') {
    await transaction(() => seed(store, { hash: hashPassword, now: new Date().toISOString() }));
    console.log('Added sample ideas from fictional students. Sample account for testing: username priya (moderator: neha), password dduc1234.');
  }
  if (MODERATORS.length) await transaction(promoteModerators);
}

// ───────── auth ─────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [algo, salt, hex] = String(stored).split('$');
  const want = Buffer.from(hex || '', 'hex');
  let got;
  if (algo === 'scrypt') got = crypto.scryptSync(pw, salt, 64);
  else if (algo === 'sha256') got = crypto.createHash('sha256').update(salt + pw).digest();
  else return false;
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');
function sessionUser(req) {
  const m = /(?:^|;\s*)ih_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = store.all('sessions').find(x => x.token === tokenHash(m[1]));
  return s ? s.user_id : null;
}
// Without "keep me logged in" the cookie lasts until the browser closes, so the next visit asks for the username and password again.
const isHttps = req => BEHIND_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https');
const clientIp = req => (BEHIND_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
function startSession(req, res, userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  store.insert('sessions', { token: tokenHash(token), user_id: userId, created_at: new Date().toISOString() });
  res.setHeader('Set-Cookie', `ih_session=${token}; HttpOnly; SameSite=Lax; Path=/${isHttps(req) ? '; Secure' : ''}${remember ? `; Max-Age=${60 * 60 * 24 * 30}` : ''}`);
}
const attempts = new Map();
function throttle(key) {
  const now = Date.now(), list = (attempts.get(key) || []).filter(t => now - t < 60e3);
  list.push(now); attempts.set(key, list);
  if (list.length > 10) throw new core.ApiError(429, 'Too many attempts. Wait a minute and try again.');
}

function authRoute(req, res, body) {
  const now = new Date().toISOString();
  const ctx = { store, userId: null, now };
  if (req.url === '/api/auth/signup') {
    throttle('signup:' + clientIp(req));
    const fields = core.validateSignup(store, body);
    const u = core.createUser(ctx, Object.assign({}, body, fields), hashPassword(String(body.password)));
    if (MODERATORS.includes(u.username.toLowerCase())) store.update('users', u.id, { role: 'moderator' });
    startSession(req, res, u.id, !!body.remember);
    return core.handle(store, { method: 'GET', path: '/api/me', userId: u.id, now }).body;
  }
  if (req.url === '/api/auth/login') {
    throttle('login:' + clientIp(req));
    const u = core.findUserByUsername(store, body.username);
    if (!u || !checkPassword(String(body.password || ''), u.password_hash)) throw new core.ApiError(401, 'Username or password is incorrect.');
    startSession(req, res, u.id, !!body.remember);
    return core.handle(store, { method: 'GET', path: '/api/me', userId: u.id, now }).body;
  }
  if (req.url === '/api/auth/logout') {
    const m = /(?:^|;\s*)ih_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (m) { const s = store.all('sessions').find(x => x.token === tokenHash(m[1])); if (s) store.remove('sessions', s.id); }
    res.setHeader('Set-Cookie', 'ih_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  }
  throw new core.ApiError(404, 'No such endpoint.');
}

// ───────── http ─────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new core.ApiError(413, 'Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new core.ApiError(400, 'Invalid JSON.')); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'GET' ? {} : await readBody(req);
      if (req.method !== 'GET' && req.headers['content-type'] && !req.headers['content-type'].includes('application/json')) {
        throw new core.ApiError(415, 'Send JSON.');
      }
      if (url.pathname === '/api/config') return send(res, 200, { mode: 'server' });
      // Every API call runs as one transaction (even GETs can record activity), so changes are saved together or not at all.
      const out = await transaction(() => {
        if (url.pathname.startsWith('/api/auth/') && req.method === 'POST') {
          req.url = url.pathname;
          return { status: 200, body: authRoute(req, res, body) };
        }
        return core.handle(store, {
          method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, userId: sessionUser(req), now: new Date().toISOString(),
        });
      });
      return send(res, out.status, out.body);
    }
    // static files, SPA fallback
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof core.ApiError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on our side.' });
  }
});

openDatabase().then(
  () => server.listen(PORT, () => console.log(`IdeaHub DDUC running at http://localhost:${PORT}`)),
  e => { console.error('Could not open the database:', e.message || e); process.exit(1); },
);
