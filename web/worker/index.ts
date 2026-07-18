// Touchline Trader Worker — API + static assets. The judged replay path is served
// entirely from bundled static tapes; these routes add live mode, leaderboards, and
// the on-chain TT-coin economy (claim airdrops + winnings payouts on Solana devnet).
import { Hono } from 'hono';
import { sendTT, isValidPubkey, CLAIM_AMOUNT, MAX_PAYOUT, TT_MINT } from './tokens';

type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  MATCH_ROOM: DurableObjectNamespace;
  INGEST_KEY?: string;
  DEVNET_WALLET_SECRET?: string;
  TOKEN_RPC?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

/** Local ingest process pushes normalized live events here. */
app.post('/api/ingest', async (c) => {
  if (c.req.header('x-ingest-key') !== c.env.INGEST_KEY) return c.text('forbidden', 403);
  const body = await c.req.json<{
    fixtureId: number;
    meta?: { home: string; away: string; kickoff: number; status?: string; winner?: string; regHome?: number; regAway?: number };
    events?: { t: number; type: string; payload: unknown }[];
  }>();
  const { fixtureId, meta, events } = body;
  if (meta) {
    await c.env.DB.prepare(
      `INSERT INTO live_matches (fixture_id, home, away, kickoff, status, winner, reg_home, reg_away, updated_at)
       VALUES (?1,?2,?3,?4,COALESCE(?5,'upcoming'),?6,?7,?8,?9)
       ON CONFLICT(fixture_id) DO UPDATE SET
         status=COALESCE(?5,status), winner=COALESCE(?6,winner),
         reg_home=COALESCE(?7,reg_home), reg_away=COALESCE(?8,reg_away), updated_at=?9`
    ).bind(fixtureId, meta.home, meta.away, meta.kickoff, meta.status ?? null, meta.winner ?? null,
      meta.regHome ?? null, meta.regAway ?? null, Date.now()).run();
  }
  if (events?.length) {
    const stmt = c.env.DB.prepare('INSERT INTO live_events (fixture_id, t, type, payload) VALUES (?1,?2,?3,?4)');
    await c.env.DB.batch(events.map(e => stmt.bind(fixtureId, e.t, e.type, JSON.stringify(e.payload))));
  }
  return c.json({ ok: true, inserted: events?.length ?? 0 });
});

/** Live/upcoming matches for the picker. */
app.get('/api/live', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM live_matches WHERE status IN ('upcoming','live') OR updated_at > ?1 ORDER BY kickoff"
  ).bind(Date.now() - 6 * 3600_000).all();
  return c.json(results);
});

/** Incremental event feed: backlog on after=0, then poll with the last seen id. */
app.get('/api/live/:id/events', async (c) => {
  const fixtureId = Number(c.req.param('id'));
  const after = Number(c.req.query('after') ?? 0);
  const { results } = await c.env.DB.prepare(
    'SELECT id, t, type, payload FROM live_events WHERE fixture_id = ?1 AND id > ?2 ORDER BY id LIMIT 8000'
  ).bind(fixtureId, after).all();
  const match = await c.env.DB.prepare('SELECT * FROM live_matches WHERE fixture_id = ?1').bind(fixtureId).first();
  return c.json({ match, events: results });
});

/** Post a finished session's score to the shared leaderboard. */
app.post('/api/score', async (c) => {
  const b = await c.req.json<{ fixtureId: number; nick: string; mode?: string; pnl: number; equity: number; room?: string }>();
  if (!b.fixtureId || typeof b.nick !== 'string' || !Number.isFinite(b.pnl)) return c.text('bad request', 400);
  const nick = b.nick.slice(0, 24).replace(/[^\w\s\-']/g, '');
  const room = typeof b.room === 'string' ? b.room.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  await c.env.DB.prepare(
    'INSERT INTO scores (fixture_id, nick, mode, pnl, equity, ts, room) VALUES (?1,?2,?3,?4,?5,?6,?7)'
  ).bind(b.fixtureId, nick, b.mode ?? 'replay', Math.round(b.pnl), Math.round(b.equity), Date.now(), room).run();
  return c.json({ ok: true });
});

app.get('/api/score/:id', async (c) => {
  const room = c.req.query('room');
  const { results } = room
    ? await c.env.DB.prepare(
        'SELECT nick, mode, pnl, equity, ts FROM scores WHERE fixture_id = ?1 AND room = ?2 ORDER BY pnl DESC LIMIT 20'
      ).bind(Number(c.req.param('id')), room.toUpperCase()).all()
    : await c.env.DB.prepare(
        'SELECT nick, mode, pnl, equity, ts FROM scores WHERE fixture_id = ?1 ORDER BY pnl DESC LIMIT 20'
      ).bind(Number(c.req.param('id'))).all();
  return c.json(results);
});

/** One-time on-chain claim: airdrop CLAIM_AMOUNT TT (devnet SPL) to a connected wallet. */
app.post('/api/claim', async (c) => {
  if (!c.env.DEVNET_WALLET_SECRET) return c.json({ error: 'onchain economy not configured' }, 503);
  const { wallet } = await c.req.json<{ wallet: string }>();
  if (!isValidPubkey(wallet)) return c.json({ error: 'invalid wallet' }, 400);
  const existing = await c.env.DB.prepare(
    "SELECT tx, amount FROM token_grants WHERE wallet = ?1 AND kind = 'claim'"
  ).bind(wallet).first<{ tx: string; amount: number }>();
  if (existing) return c.json({ ok: true, alreadyClaimed: true, amount: existing.amount, tx: existing.tx, mint: TT_MINT.toBase58() });
  // lock first via the unique index so a confirm-timeout retry can never double-send
  try {
    await c.env.DB.prepare(
      "INSERT INTO token_grants (wallet, kind, fixture_id, amount, tx, ts) VALUES (?1, 'claim', 0, ?2, 'pending', ?3)"
    ).bind(wallet, CLAIM_AMOUNT, Date.now()).run();
  } catch {
    return c.json({ error: 'claim already in flight' }, 409);
  }
  try {
    const tx = await sendTT(c.env.DEVNET_WALLET_SECRET, wallet, CLAIM_AMOUNT, c.env.TOKEN_RPC);
    await c.env.DB.prepare("UPDATE token_grants SET tx = ?1 WHERE wallet = ?2 AND kind = 'claim'").bind(tx, wallet).run();
    return c.json({ ok: true, amount: CLAIM_AMOUNT, tx, mint: TT_MINT.toBase58() });
  } catch (e: any) {
    await c.env.DB.prepare("DELETE FROM token_grants WHERE wallet = ?1 AND kind = 'claim' AND tx = 'pending'").bind(wallet).run();
    return c.json({ error: `transfer failed: ${e.message}` }, 502);
  }
});

/** Per-match winnings payout: transfer positive P&L as TT tokens, once per (wallet, fixture). */
app.post('/api/payout', async (c) => {
  if (!c.env.DEVNET_WALLET_SECRET) return c.json({ error: 'onchain economy not configured' }, 503);
  const b = await c.req.json<{ wallet: string; fixtureId: number; pnl: number }>();
  if (!isValidPubkey(b.wallet) || !Number.isFinite(b.fixtureId) || !Number.isFinite(b.pnl)) {
    return c.json({ error: 'bad request' }, 400);
  }
  const amount = Math.min(MAX_PAYOUT, Math.max(0, Math.round(b.pnl)));
  if (amount <= 0) return c.json({ ok: true, amount: 0 });
  const existing = await c.env.DB.prepare(
    "SELECT tx, amount FROM token_grants WHERE wallet = ?1 AND kind = 'payout' AND fixture_id = ?2"
  ).bind(b.wallet, b.fixtureId).first<{ tx: string; amount: number }>();
  if (existing) return c.json({ ok: true, alreadyPaid: true, amount: existing.amount, tx: existing.tx });
  try {
    await c.env.DB.prepare(
      "INSERT INTO token_grants (wallet, kind, fixture_id, amount, tx, ts) VALUES (?1, 'payout', ?2, ?3, 'pending', ?4)"
    ).bind(b.wallet, b.fixtureId, amount, Date.now()).run();
  } catch {
    return c.json({ error: 'payout already in flight' }, 409);
  }
  try {
    const tx = await sendTT(c.env.DEVNET_WALLET_SECRET, b.wallet, amount, c.env.TOKEN_RPC);
    await c.env.DB.prepare(
      "UPDATE token_grants SET tx = ?1 WHERE wallet = ?2 AND kind = 'payout' AND fixture_id = ?3"
    ).bind(tx, b.wallet, b.fixtureId).run();
    return c.json({ ok: true, amount, tx });
  } catch (e: any) {
    await c.env.DB.prepare(
      "DELETE FROM token_grants WHERE wallet = ?1 AND kind = 'payout' AND fixture_id = ?2 AND tx = 'pending'"
    ).bind(b.wallet, b.fixtureId).run();
    return c.json({ error: `transfer failed: ${e.message}` }, 502);
  }
});

// Everything else falls through to static assets (SPA + /tapes + /attestations).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// Durable Object: reserved for future WebSocket fan-out (polling serves live mode today).
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
