// Touchline Trader Worker — API + static assets. The judged replay path is served
// entirely from bundled static tapes; these API routes add live mode + leaderboard on top.
import { Hono } from 'hono';

type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  MATCH_ROOM: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

// Everything else falls through to static assets (SPA + /tapes/*.json).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// Durable Object: one room per live fixture (Day 1 live mode — WebSocket fan-out).
export class MatchRoom {
  private sockets = new Set<WebSocket>();

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/ws')) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.endsWith('/broadcast') && req.method === 'POST') {
      const body = await req.text();
      for (const ws of this.sockets) {
        try { ws.send(body); } catch { this.sockets.delete(ws); }
      }
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }
}
