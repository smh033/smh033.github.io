/* Retro Football online relay (Cloudflare Worker + Durable Objects).
   Each 4-letter game code gets its own little room. The host and the joiner both connect to
   wss://<this worker>/r/CODE; whatever one sends to a topic, the other receives.
   Online franchise leagues live at https://<this worker>/lg/CODE (6 letters): one stored league
   file per code, saved with a version number so two coaches can't overwrite each other.
   Skins added from the fitter page live at https://<this worker>/sk (same storage, key needed to change). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type, x-enc, x-key',
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
const CHUNK = 512 * 1024, MAX = 48 * 1024 * 1024;
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
    const meta = (await st.get('meta')) || { v: 0, n: 0, enc: 'raw' };
    const on = this.online(url.searchParams.get('me'));
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
      if (!buf.length || buf.length > MAX) return new Response('bad size', { status: 413, headers: h() });
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
}
