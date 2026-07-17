// Live match session — same experience as replay, driven by the polling LiveFeed.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DangerSpan, MatchEvent, Outcome, Tick } from '../shared/types';
import { OUTCOMES } from '../shared/types';
import { buy, sell, settle, equity, newPortfolio, type Portfolio, STARTING_CASH } from '../shared/engine';
import { MarketChart, type ChartHandle } from './Chart';
import { BotEngine } from './bots';
import { LiveFeed, type LiveMatch } from './live';

const fmtP = (v: number) => `${v.toFixed(1)}¢`;
const fmtC = (v: number) => Math.round(v).toLocaleString();

interface Toast { id: number; text: string; cls: string }

export default function LiveSession({ match, nick, onOpenPicker }: { match: LiveMatch; nick: string; onOpenPicker: () => void }) {
  const chart = useRef<ChartHandle>(null);
  const feedRef = useRef<LiveFeed | null>(null);
  const pfRef = useRef<Portfolio>(newPortfolio());
  const botsRef = useRef<BotEngine>(new BotEngine());

  const [prices, setPrices] = useState<[number, number, number] | null>(null);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [clockSec, setClockSec] = useState<number | null>(null);
  const [status, setStatus] = useState(match.status);
  const [focus, setFocus] = useState<Outcome>('home');
  const [danger, setDanger] = useState<DangerSpan | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [settled, setSettled] = useState(false);
  const [finalMeta, setFinalMeta] = useState<LiveMatch | null>(null);
  const [, forceUi] = useState(0);

  const toast = (text: string, cls = '') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, text, cls }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  };

  useEffect(() => {
    const pf = pfRef.current;
    const bots = botsRef.current;
    const feed = new LiveFeed(match.fixture_id, {
      onTick: (tick: Tick) => { chart.current?.pushTick(tick); bots.onTick(tick); setPrices([...tick.p] as any); },
      onDanger: (d) => { bots.onDanger(d); setDanger(d.state === 'safe' ? null : d); },
      onMeta: (m) => setStatus(m.status),
      onEvent: (ev: MatchEvent) => {
        chart.current?.addEventMarker(ev, match.home, match.away);
        bots.onEvent(ev);
        if (ev.score) setScore(ev.score);
        if (ev.clockSec != null) setClockSec(ev.clockSec);
        const name = ev.team === 1 ? match.home : ev.team === 2 ? match.away : '';
        if (ev.kind === 'goal') {
          toast(`⚽ GOAL — ${name}!`, 'toast-goal');
          const scored: Outcome | null = ev.team === 1 ? 'home' : ev.team === 2 ? 'away' : null;
          const held = OUTCOMES.filter(o => pf.positions[o].shares > 0)
            .sort((a, b) => pf.positions[b].cost - pf.positions[a].cost)[0];
          if (held && scored) setFlash(held === scored ? 'up' : 'down');
          setTimeout(() => setFlash(null), 1400);
        }
        if (ev.kind === 'red_card') toast(`🟥 RED CARD — ${name}`, 'toast-red');
        if (ev.kind === 'yellow_card') toast(`🟨 Yellow — ${name}`);
        if (ev.kind === 'var') toast('📺 VAR check…', 'toast-var');
        if (ev.kind === 'halftime') toast('⏸ Half-time');
        if (ev.kind === 'kickoff') toast('▶ Kick-off — market is live', 'toast-fill');
        forceUi(x => x + 1);
      },
      onFinal: (m) => {
        if (!pf.settled && m.winner) {
          settle(pf, m.winner);
          bots.settleAll(m.winner);
          setFinalMeta(m);
          setSettled(true);
          const eq = pf.cash;
          fetch('/api/score', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fixtureId: m.fixture_id, nick, mode: 'live', pnl: eq - STARTING_CASH, equity: eq }),
          }).catch(() => {});
        }
      },
    });
    feedRef.current = feed;
    chart.current?.setStoryRange(match.kickoff - 40 * 60_000, match.kickoff + 2.2 * 3600_000);
    feed.start();
    return () => feed.stop();
  }, [match.fixture_id]);

  const doBuy = (o: Outcome) => {
    const tick = feedRef.current?.currentTick(); if (!tick || settled) return;
    const price = tick.p[OUTCOMES.indexOf(o)];
    const r = buy(pfRef.current, o, Math.min(100, pfRef.current.cash), price, tick.t);
    if (typeof r === 'string') toast(r, 'toast-err');
    else toast(`Bought @ ${fmtP(price)}`, 'toast-fill');
    forceUi(x => x + 1);
  };
  const doSell = (o: Outcome) => {
    const tick = feedRef.current?.currentTick(); if (!tick || settled) return;
    const r = sell(pfRef.current, o, 1, tick.p[OUTCOMES.indexOf(o)], tick.t);
    if (typeof r === 'string') toast(r, 'toast-err');
    else toast(`Sold (+${fmtC(r.coins)} coins)`, 'toast-fill');
    forceUi(x => x + 1);
  };

  const pf = pfRef.current;
  const curTick: Tick | null = prices ? { t: 0, p: prices } : null;
  const eq = equity(pf, curTick);
  const pnl = eq - STARTING_CASH;
  const names: Record<Outcome, string> = { home: match.home, draw: 'Draw', away: match.away };
  const matchClock = clockSec != null ? `${Math.floor(clockSec / 60)}'` : '';

  return (
    <div className={`session ${flash ? `flash-${flash}` : ''} ${danger ? `danger-${danger.state}` : ''}`}>
      <header>
        <button className="btn-ghost" onClick={onOpenPicker}>⏪</button>
        <div className="title">
          <div className="match">
            <span className={`live-chip ${status === 'live' ? 'on' : ''}`}>● LIVE</span> {match.home} <span className="score">{score[0]}–{score[1]}</span> {match.away}
          </div>
          <div className="sub">
            {status === 'upcoming' ? 'Pre-match market open' : status === 'live' ? matchClock : 'Full time'}
            {danger && danger.team !== 0 ? ` · 🔥 ${danger.team === 1 ? match.home : match.away} ${danger.state.replace('_', ' ')}` : ''}
          </div>
        </div>
        <div className="wallet">
          <div className={`pnl ${pnl >= 0 ? 'up' : 'down'}`}>{pnl >= 0 ? '+' : ''}{fmtC(pnl)}</div>
          <div className="cash">{fmtC(eq)} coins</div>
        </div>
      </header>

      <MarketChart ref={chart} focus={focus} />

      <div className="outcomes">
        {OUTCOMES.map((o, i) => {
          const pos = pf.positions[o];
          const price = prices?.[i];
          return (
            <div key={o} className={`outcome ${focus === o ? 'focused' : ''} oc-${o}`} onClick={() => setFocus(o)}>
              <div className="oc-name">{names[o]}</div>
              <div className="oc-price">{price != null ? fmtP(price) : '—'}</div>
              <button className="btn-buy" disabled={settled} onClick={(e) => { e.stopPropagation(); doBuy(o); }}>
                BUY 100
              </button>
              {pos.shares > 0 && price != null && (
                <div className="oc-pos">
                  {pos.shares.toFixed(1)} sh · {(pos.shares * price - pos.cost) >= 0 ? '+' : ''}{fmtC(pos.shares * price - pos.cost)}
                  <button className="btn-sell" disabled={settled} onClick={(e) => { e.stopPropagation(); doSell(o); }}>SELL</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="lb-strip">
        {botsRef.current.standings(pf, nick).map((r, i) => (
          <div key={r.name} className={`lb-chip ${r.you ? 'you' : ''}`}>
            <span className="lb-rank">{i + 1}</span> {r.emoji} {r.you ? 'You' : r.name.split(' ')[0]}
            <span className={`lb-eq ${r.eq >= STARTING_CASH ? 'up' : 'down'}`}>{fmtC(r.eq)}</span>
          </div>
        ))}
      </div>

      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={`toast ${t.cls}`}>{t.text}</div>)}
      </div>

      {settled && finalMeta && (
        <div className="modal-backdrop">
          <div className="modal settle">
            <h2>Full time</h2>
            <div className="settle-score">{match.home} {finalMeta.reg_home}–{finalMeta.reg_away} {match.away}</div>
            <p>Market settled: <b>{finalMeta.winner === 'draw' ? 'Draw' : names[finalMeta.winner!]}</b> pays 100¢ per share.</p>
            <div className={`settle-pnl ${pnl >= 0 ? 'up' : 'down'}`}>{pnl >= 0 ? '+' : ''}{fmtC(pnl)} coins</div>
            <p className="muted">Settlement attestation posts on-chain moments after the final whistle.</p>
            <button className="btn-buy" onClick={onOpenPicker}>Back to matches</button>
          </div>
        </div>
      )}
      <footer className="disclaimer">free to play · play coins · no real money</footer>
    </div>
  );
}
