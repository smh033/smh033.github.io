/* Retro Football online relay (Cloudflare Worker + Durable Objects).
   Each 4-letter game code gets its own little room. The host and the joiner both connect to
   wss://<this worker>/r/CODE; whatever one sends to a topic, the other receives.
   Online franchise leagues live at https://<this worker>/lg/CODE (6 letters): one stored league
   file per code, saved with a version number so two coaches can't overwrite each other.
   Skins added from the fitter page live at https://<this worker>/sk (same storage, key needed to change).
   Player accounts live at https://<this worker>/acct/USERNAME: a username can only be taken once, the password is
   stored only as a salted PBKDF2 hash, and the saves behind it can only be read or changed with a login token. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-enc, x-key, x-tok',
  'access-control-expose-headers': 'x-v, x-enc, x-on',
  'access-control-max-age': '86400'
};
const SKIN_KEY_HASH = '708fb806a1bc6cb0bdb5b7b779712007d8b9143f2f9fd20e9b5d584010a4685d';   /* sha-256 of the fitter key */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    /* connection test (nettest.html): which Cloudflare city and network this request came through, and where a
       game room for ?r=CODE runs. Lets a slow school network show whether the delay is the network or the relay. */
    if (url.pathname === '/where') {
      const cf = req.cf || {}, r = url.searchParams.get('r');let room = null;
      if (r && /^[A-Z]{4}$/.test(r)) { try { room = await (await env.ROOMS.get(env.ROOMS.idFromName(r)).fetch('https://room/where')).json(); } catch (e) {} }
      return new Response(JSON.stringify({ colo: cf.colo, city: cf.city, region: cf.region, country: cf.country, org: cf.asOrganization, asn: cf.asn, rtt: cf.clientTcpRtt, room }),
        { headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, CORS) });
    }
    /* skins added from the fitter page: anyone can read them, only the fitter key can change them */
    if (url.pathname === '/sk') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.method === 'PUT') {
        const key = req.headers.get('x-key') || '';
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
        const hex = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (hex !== SKIN_KEY_HASH) return new Response('wrong key', { status: 403, headers: CORS });
      }
      return env.LEAGUES.get(env.LEAGUES.idFromName('__skins__')).fetch(req);
    }
    const ac = url.pathname.match(/^\/acct\/([a-z0-9_]{3,16})$/);
    if (ac) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return env.LEAGUES.get(env.LEAGUES.idFromName('acct:' + ac[1])).fetch(req);
    }
    const lg = url.pathname.match(/^\/lg\/([A-Z]{6})$/);
    if (lg) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return env.LEAGUES.get(env.LEAGUES.idFromName(lg[1])).fetch(req);
    }
    const m = url.pathname.match(/^\/r\/([A-Z]{4})$/);
    if (!m) return new Response('Retro Football relay is running', { headers: { 'access-control-allow-origin': '*' } });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  }
};
export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    if (new URL(req.url).pathname === '/where') {   /* the Cloudflare city this room runs in (for the connection test) */
      if (!this.colo) { try { this.colo = ((await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text()).match(/colo=(\w+)/) || [])[1]; } catch (e) {} }
      return new Response(JSON.stringify({ colo: this.colo || null }), { headers: { 'content-type': 'application/json' } });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ subs: [] });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    if (m.ping) { ws.send('{"pong":1}'); return; }
    if (m.s) {
      const a = ws.deserializeAttachment() || { subs: [] };
      if (!a.subs.includes(m.s)) { a.subs.push(m.s); if (a.subs.length > 20) a.subs.shift(); ws.serializeAttachment(a); }
      return;
    }
    if (m.p && typeof m.d === 'string') {
      for (const o of this.state.getWebSockets()) {
        if (o === ws) continue;
        const a = o.deserializeAttachment();
        if (a && a.subs.includes(m.p)) { try { o.send(m.d); } catch (e) {} }
      }
    }
  }
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code); } catch (e) {} }
  async webSocketError(ws) { try { ws.close(); } catch (e) {} }
}
/* One online league. GET returns the league file (x-v = its version); GET ?have=N answers 204 when
   nothing changed since version N, so polling is cheap. PUT ?v=N saves only if the stored version is
   still N (0 = create), otherwise 409 with the current version: the coach merges and tries again.
   ?me=TEAM marks that coach as on the site; x-on lists who was seen in the last 25 seconds. */
/* MAX: biggest file one save may hold (leagues and the whole skin store, which keeps every skin's picture).
   48 MB stays well inside Cloudflare's 100 MB request body and 128 MB Durable Object memory limits. */
const CHUNK = 512 * 1024, MAX = 48 * 1024 * 1024, ACCT_MAX = 12 * 1024 * 1024;
/* ---------- accounts ---------- */
const BAD_NAMES = ['fuck','shit','bitch','cunt','nigg','nigga','fag','dick','pussy','cock','slut','whore','rape','nazi','hitler','retard','porn','sex','penis','vagina','kkk','chink','spic','kike','tranny'];
const badName = u => BAD_NAMES.some(w => u.replace(/_/g, '').includes(w)) || /^(admin|mod|moderator|retrofootball|official|staff)$/.test(u);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function pbk(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
}
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
function recCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(12)); let s = ''; for (let i = 0; i < 12; i++) { s += A[b[i] % A.length]; if (i === 3 || i === 7) s += '-'; } return s; }
const sameStr = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export class League {
  constructor(state) { this.state = state; this.seen = {}; }
  online(me) {
    const now = Date.now();
    if (me != null && /^\d{1,2}$/.test(me)) this.seen[me] = now;
    const on = [];
    for (const k in this.seen) { if (now - this.seen[k] < 25000) on.push(+k); else delete this.seen[k]; }
    return JSON.stringify(on);
  }
  async fetch(req) {
    const url = new URL(req.url), st = this.state.storage;
    if (url.pathname.startsWith('/acct/')) return this.account(req, url, st);
    const meta = (await st.get('meta')) || { v: 0, n: 0, enc: 'raw' };
    return this.store(req, url, st, meta, this.online(url.searchParams.get('me')), MAX);
  }
  /* the versioned file (a league, the skin store, or an account's saves) */
  async store(req, url, st, meta, on, max) {
    const h = (o) => Object.assign({ 'x-v': String(meta.v), 'x-on': on, 'cache-control': 'no-store' }, CORS, o || {});
    if (req.method === 'GET') {
      if (!meta.v) return new Response('no such league', { status: 404, headers: h() });
      if (url.searchParams.get('have') === String(meta.v)) return new Response(null, { status: 204, headers: h() });
      const keys = []; for (let i = 0; i < meta.n; i++) keys.push('c' + i);
      const got = await st.get(keys), parts = keys.map(k => new Uint8Array(got.get(k)));
      const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return new Response(out, { headers: h({ 'x-enc': meta.enc, 'content-type': 'application/octet-stream' }) });
    }
    if (req.method === 'PUT') {
      const want = +url.searchParams.get('v');
      if (want !== meta.v) return new Response(JSON.stringify({ v: meta.v }), { status: 409, headers: h({ 'content-type': 'application/json' }) });
      const buf = new Uint8Array(await req.arrayBuffer());
      if (!buf.length || buf.length > max) return new Response('bad size', { status: 413, headers: h() });
      const put = {}; let n = 0;
      for (let i = 0; i < buf.length; i += CHUNK) put['c' + n++] = buf.slice(i, i + CHUNK).buffer;
      const next = { v: meta.v + 1, n, enc: req.headers.get('x-enc') === 'gz' ? 'gz' : 'raw', at: Date.now() };
      put.meta = next;
      const stale = []; for (let i = n; i < meta.n; i++) stale.push('c' + i);
      await st.put(put);
      if (stale.length) await st.delete(stale);
      meta.v = next.v;
      return new Response(JSON.stringify({ v: next.v }), { headers: h({ 'content-type': 'application/json' }) });
    }
    return new Response('method not allowed', { status: 405, headers: h() });
  }
  /* one account: who owns the name, and their saves. ops: exists, create, login, reset, logout; GET/PUT = saves (token needed) */
  async account(req, url, st) {
    const u = url.pathname.slice(6), op = url.searchParams.get('op') || '';
    const J = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, CORS) });
    let a = await st.get('acct');
    if (op === 'exists') return J({ taken: !!a || badName(u) });
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const now = Date.now(), pwOk = p => typeof p === 'string' && p.length >= 6 && p.length <= 64;
    const newTok = async () => { const t = rnd(24); a.toks = (a.toks || []).filter(x => now - x.at < 400 * 86400000).slice(-9); a.toks.push({ h: await sha(t), at: now }); return t; };
    const tooMany = () => { a.fails = (a.fails || []).filter(t => now - t < 600000); return a.fails.length >= 8; };   /* 8 wrong tries per 10 minutes */
    if (req.method === 'POST' && op === 'create') {
      if (a) return J({ err: 'THAT USERNAME IS TAKEN' }, 409);
      if (badName(u)) return J({ err: 'PICK A DIFFERENT USERNAME' }, 400);
      if (!pwOk(body.pw)) return J({ err: 'PASSWORD MUST BE 6 TO 64 CHARACTERS' }, 400);
      const salt = rnd(16), rec = recCode(), rsalt = rnd(16);
      a = { u, salt, h: await pbk(body.pw, salt), rsalt, rh: await pbk(rec, rsalt), at: now, fails: [], toks: [] };
      const tok = await newTok(); await st.put('acct', a);
      return J({ tok, rec, v: 0 });
    }
    if (!a) return J({ err: 'NO ACCOUNT WITH THAT USERNAME' }, 404);
    if (req.method === 'POST' && (op === 'login' || op === 'reset')) {
      if (tooMany()) { await st.put('acct', a); return J({ err: 'TOO MANY TRIES. WAIT 10 MINUTES' }, 429); }
      const ok = op === 'login' ? pwOk(body.pw) && sameStr(await pbk(body.pw, a.salt), a.h)
        : typeof body.rec === 'string' && sameStr(await pbk(body.rec.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})(.{4})$/, '$1-$2-$3'), a.rsalt), a.rh);
      if (!ok) { a.fails.push(now); await st.put('acct', a); return J({ err: op === 'login' ? 'WRONG PASSWORD' : 'WRONG RECOVERY CODE' }, 401); }
      a.fails = []; let rec = null;
      if (op === 'reset') { if (!pwOk(body.pw)) return J({ err: 'PASSWORD MUST BE 6 TO 64 CHARACTERS' }, 400); a.salt = rnd(16); a.h = await pbk(body.pw, a.salt); rec = recCode(); a.rsalt = rnd(16); a.rh = await pbk(rec, a.rsalt); a.toks = []; }   /* new password logs out every other device */
      const tok = await newTok(); await st.put('acct', a);
      const meta = (await st.get('meta')) || { v: 0 };
      return J(rec ? { tok, rec, v: meta.v } : { tok, v: meta.v });
    }
    /* everything below needs a login token */
    const th = await sha(req.headers.get('x-tok') || ''), tk = (a.toks || []).find(x => sameStr(x.h, th));
    if (!tk) return J({ err: 'LOGGED OUT' }, 401);
    if (req.method === 'POST' && op === 'logout') { a.toks = a.toks.filter(x => x !== tk); await st.put('acct', a); return J({ ok: 1 }); }
    if (req.method === 'GET' || req.method === 'PUT') {
      if (req.method === 'PUT' && +(req.headers.get('content-length') || 0) > ACCT_MAX) return J({ err: 'SAVES TOO BIG' }, 413);
      const meta = (await st.get('meta')) || { v: 0, n: 0, enc: 'raw' };
      if (req.method === 'GET' && !meta.v) return new Response(null, { status: 204, headers: Object.assign({ 'x-v': '0', 'cache-control': 'no-store' }, CORS) });
      return this.store(req, url, st, meta, '[]', ACCT_MAX);
    }
    return J({ err: 'BAD REQUEST' }, 400);
  }
}
