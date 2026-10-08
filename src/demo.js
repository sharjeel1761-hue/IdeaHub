/*
 * In-browser backend for the demo build: the same core.js router, persisted to localStorage.
 * Lets anyone try the full prototype without running a server.
 */
(function () {
  'use strict';
  const core = window.IdeaHubCore, seedLib = window.IdeaHubSeed;
  const KEY = 'ideahub-demo-v2', SKEY = 'ideahub-demo-session-v2';

  // Small synchronous SHA-256 (demo passwords only; the real server uses scrypt).
  function sha256(msg) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const bytes = new TextEncoder().encode(msg);
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total); buf.set(bytes); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, len * 8); dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64), ror = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(o + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = ror(W[t - 15], 7) ^ ror(W[t - 15], 18) ^ (W[t - 15] >>> 3), s1 = ror(W[t - 2], 17) ^ ror(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  const hash = pw => { const salt = randHex(8); return `sha256$${salt}$${sha256(salt + pw)}`; };
  const check = (pw, stored) => { const [algo, salt, hex] = String(stored).split('$'); return algo === 'sha256' && sha256(salt + pw) === hex; };

  const mem = {};
  const wrap = name => ({
    get(k) { try { return window[name].getItem(k); } catch (e) { return mem[name + k] || null; } },
    set(k, v) { try { window[name].setItem(k, v); } catch (e) { mem[name + k] = v; } },
    del(k) { try { window[name].removeItem(k); } catch (e) { delete mem[name + k]; } },
  });
  const ls = wrap('localStorage'), ss = wrap('sessionStorage');

  let store, userId = null;
  const save = () => ls.set(KEY, JSON.stringify(store.snapshot()));
  function load() {
    store = core.createStore(null);
    const raw = ls.get(KEY);
    if (raw) {
      try { const d = JSON.parse(raw); for (const t of core.TABLES) store.load(t, d[t] || []); return; } catch (e) { store.reset(); }
    }
    seedLib.seed(store, { hash, now: new Date().toISOString() });
    save();
  }
  load();
  userId = Number(ss.get(SKEY) || ls.get(SKEY)) || null;
  if (userId && !store.get('users', userId)) userId = null;

  const clone = x => JSON.parse(JSON.stringify(x));
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  // "Keep me logged in" keeps the session in localStorage; otherwise it ends when the browser tab closes.
  const setSession = (id, remember) => {
    userId = id; ls.del(SKEY); ss.del(SKEY);
    if (id) (remember ? ls : ss).set(SKEY, String(id));
  };

  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(path, 'http://demo');
        body = body ? clone(body) : {};
        const now = new Date().toISOString();
        const me = () => core.handle(store, { method: 'GET', path: '/api/me', userId, now }).body;
        if (url.pathname === '/api/config') return resolve({ mode: 'demo', allowed_domain: null });
        if (url.pathname === '/api/auth/login') {
          const u = core.findUserByUsername(store, body.username);
          if (!u || !check(String(body.password || ''), u.password_hash)) fail(401, 'Username or password is incorrect.');
          setSession(u.id, !!body.remember); return resolve(clone(me()));
        }
        if (url.pathname === '/api/auth/logout') { setSession(null); return resolve({ ok: true }); }
        if (url.pathname === '/api/auth/signup') {
          let fields;
          try { fields = core.validateSignup(store, body); } catch (e) { fail(e.status || 400, e.message); }
          const u = core.createUser({ store, now }, Object.assign({}, body, fields), hash(String(body.password)));
          save(); setSession(u.id, !!body.remember); return resolve(clone(me()));
        }
        const out = core.handle(store, { method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, userId, now });
        if (out.mutated) { if (out.failed) load(); else save(); }
        if (out.status !== 200) fail(out.status, out.body.error);
        resolve(clone(out.body));
      } catch (e) { reject(e); }
    });
  }

  window.IdeaHubDemo = {
    request,
    reset() { ls.del(KEY); setSession(null); load(); },
  };
})();
