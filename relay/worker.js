/* Retro Football online relay (Cloudflare Worker + Durable Object).
   Each 4-letter game code gets its own little room. The host and the joiner both connect to
   wss://<this worker>/r/CODE; whatever one sends to a topic, the other receives. */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/r\/([A-Z]{4})$/);
    if (!m) return new Response('Retro Football relay is running', { headers: { 'access-control-allow-origin': '*' } });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  }
};
export class Room {
  constructor(state) { this.state = state; }
  async fetch() {
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
