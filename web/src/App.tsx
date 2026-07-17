import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DangerSpan, MatchEvent, Outcome, TapeBundle, TapeManifestEntry, Tick } from '../shared/types';
import { OUTCOMES } from '../shared/types';
import { buy, sell, settle, equity, newPortfolio, tickAt, type Portfolio, STARTING_CASH } from '../shared/engine';
import { ReplayClock } from './replay';
import { MarketChart, type ChartHandle } from './Chart';
import { BotEngine } from './bots';
import LiveSession from './LiveSession';
import type { LiveMatch } from './live';

const NICKS = ['Maverick', 'Tifosi', 'Gaffer', 'Poacher', 'Regista', 'Libero', 'Trequartista', 'Enganche'];
function myName(): string {
  let n = localStorage.getItem('tt-nick');
  if (!n) {
    n = `${NICKS[Math.floor(Math.random() * NICKS.length)]}${Math.floor(Math.random() * 90) + 10}`;
    localStorage.setItem('tt-nick', n);
  }
  return n;
}

const SPEEDS = [1, 4, 10, 30, 60];
const fmtP = (v: number) => `${v.toFixed(1)}¢`;
const fmtC = (v: number) => Math.round(v).toLocaleString();

interface Toast { id: number; text: string; cls: string }

export default function App() {
  const [manifest, setManifest] = useState<TapeManifestEntry[]>([]);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [tape, setTape] = useState<TapeBundle | null>(null);
  const [liveMatch, setLiveMatch] = useState<LiveMatch | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const nick = useMemo(myName, []);

  useEffect(() => {
    fetch('/tapes/index.json').then(r => r.json() as Promise<TapeManifestEntry[]>).then((m) => {
      setManifest(m);
      const featured = m.find(e => e.featured) ?? m[0];
      if (featured) loadTape(featured.fixtureId);
    }).catch(() => {});
    // best-effort: live matches from the API (absent/failed = replay-only, judge-proof)
    const pollLive = () => fetch('/api/live').then(r => r.json() as Promise<LiveMatch[]>).then(setLiveMatches).catch(() => {});
    pollLive();
    const iv = setInterval(pollLive, 60_000);
    return () => clearInterval(iv);
  }, []);

  const loadTape = (fixtureId: number) => {
    setTape(null); setLiveMatch(null);
    fetch(`/tapes/${fixtureId}.json`).then(r => r.json() as Promise<TapeBundle>).then(setTape).catch(() => {});
    setPickerOpen(false);
  };
  const goLive = (m: LiveMatch) => { setTape(null); setLiveMatch(m); setPickerOpen(false); };

  return (
    <div className="app">
      {liveMatch
        ? <LiveSession key={liveMatch.fixture_id} match={liveMatch} nick={nick} onOpenPicker={() => setPickerOpen(true)} />
        : tape
          ? <MatchSession key={tape.fixtureId} tape={tape} onOpenPicker={() => setPickerOpen(true)} />
          : <div className="loading">loading the market…</div>}
      {pickerOpen && (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="modal picker" onClick={e => e.stopPropagation()}>
            {liveMatches.length > 0 && (
              <>
                <h2>🔴 Live now</h2>
                {liveMatches.map(m => (
                  <button key={m.fixture_id} className="picker-row live-row" onClick={() => goLive(m)}>
                    <span className="picker-label">{m.status === 'live' ? '● LIVE' : 'soon'}</span>
                    <span className="picker-match">{m.home} v {m.away}</span>
                    <span className="picker-score">{m.status === 'upcoming' ? new Date(m.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </button>
                ))}
              </>
            )}
            <h2>⏪ Time Traveler</h2>
            <p className="muted">Replay any match. Trade it like it's live — your clock, your market.</p>
            {manifest.map(e => (
              <button key={e.fixtureId} className="picker-row" onClick={() => loadTape(e.fixtureId)}>
                <span className="picker-label">{e.label}</span>
                <span className="picker-match">{e.home} v {e.away}</span>
                <span className="picker-score">{e.final ? `${e.final.home}–${e.final.away}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FairModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch('/attestations/index.json').then(r => r.json()).then(setData).catch(() => {});
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker" onClick={e => e.stopPropagation()}>
        <h2>⛓ Provably fair</h2>
        <p className="muted">
          Prices come from TxLINE consensus odds, purchased on Solana. Every settled market is anchored
          on-chain with TxLINE's Merkle stat root — the leaderboard can't be rigged, and you can check.
        </p>
        {data && (
          <>
            <a className="picker-row attest-row" href={data.subscriptionSolscan} target="_blank" rel="noreferrer">
              <span className="picker-label">Data feed</span>
              <span className="picker-match">TxLINE subscription purchased on Solana</span>
              <span className="picker-score">↗</span>
            </a>
            {data.attestations?.map((a: any) => (
              <a key={a.fixtureId} className="picker-row attest-row" href={a.solscan} target="_blank" rel="noreferrer">
                <span className="picker-label">settled</span>
                <span className="picker-match">{a.match.replace('-', ' v ')}</span>
                <span className="picker-score">{a.regulation?.[0]}–{a.regulation?.[1]} ↗</span>
              </a>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function MatchSession({ tape, onOpenPicker }: { tape: TapeBundle; onOpenPicker: () => void }) {
  const chart = useRef<ChartHandle>(null);
  const clockRef = useRef<ReplayClock | null>(null);
  const pfRef = useRef<Portfolio>(newPortfolio());
  const botsRef = useRef<BotEngine>(new BotEngine());
  const nick = useMemo(myName, []);

  const [prices, setPrices] = useState<[number, number, number] | null>(null);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [clockSec, setClockSec] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeedState] = useState(10);
  const [running, setRunning] = useState(true);
  const [focus, setFocus] = useState<Outcome>('home');
  const [danger, setDanger] = useState<DangerSpan | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [settled, setSettled] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [pro, setPro] = useState(() => localStorage.getItem('tt-pro') === '1');
  const [, forceUi] = useState(0); // portfolio changes

  const toast = useCallback((text: string, cls = '') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, text, cls }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  }, []);

  useEffect(() => {
    const pf = pfRef.current;
    const bots = botsRef.current;
    const rc = new ReplayClock(tape, {
      onTick: (tick) => { chart.current?.pushTick(tick); bots.onTick(tick); setPrices([...tick.p] as any); },
      onEvent: (ev) => {
        chart.current?.addEventMarker(ev, tape.home, tape.away);
        bots.onEvent(ev);
        if (ev.score) setScore(ev.score);
        if (ev.clockSec != null) setClockSec(ev.clockSec);
        handleEvent(ev);
      },
      onDanger: (d) => { bots.onDanger(d); setDanger(d.state === 'safe' ? null : d); },
      onTime: (_, p) => setProgress(p),
      onEnd: () => setRunning(false),
    });

    function handleEvent(ev: MatchEvent) {
      const name = ev.team === 1 ? tape.home : ev.team === 2 ? tape.away : '';
      switch (ev.kind) {
        case 'goal': {
          toast(`⚽ GOAL — ${name}!`, 'toast-goal');
          // flash for/against the user's actual holdings: green if the scoring side is
          // your biggest position, red if you're holding against it, neutral gold otherwise
          const scored: Outcome | null = ev.team === 1 ? 'home' : ev.team === 2 ? 'away' : null;
          const held = OUTCOMES.filter(o => pf.positions[o].shares > 0)
            .sort((a, b) => pf.positions[b].cost - pf.positions[a].cost)[0];
          if (held && scored) setFlash(held === scored ? 'up' : 'down');
          else if (held === 'draw') setFlash('down');
          setTimeout(() => setFlash(null), 1400);
          break;
        }
        case 'red_card': toast(`🟥 RED CARD — ${name}`, 'toast-red'); break;
        case 'yellow_card': toast(`🟨 Yellow — ${name}`); break;
        case 'var': toast('📺 VAR check…', 'toast-var'); break;
        case 'halftime': toast('⏸ Half-time'); break;
        case 'kickoff': toast('▶ Kick-off'); break;
        case 'fulltime': {
          if (ev.score) setScore(ev.score);
          if (tape.final && !pf.settled) {
            settle(pf, tape.final.winner);
            bots.settleAll(tape.final.winner);
            setSettled(true);
            fetch('/api/score', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ fixtureId: tape.fixtureId, nick, mode: 'replay', pnl: pf.cash - STARTING_CASH, equity: pf.cash }),
            }).catch(() => {});
          }
          break;
        }
      }
      forceUi(x => x + 1);
    }

    clockRef.current = rc;
    rc.speed = 10;
    chart.current?.setStoryRange(rc.t0, rc.t1);
    rc.start();
    return () => rc.pause();
  }, [tape]);

  const [attest, setAttest] = useState<any>(null);
  useEffect(() => {
    if (!settled) return;
    fetch(`/attestations/${tape.fixtureId}.json`).then(r => r.ok ? r.json() : null).then(setAttest).catch(() => {});
  }, [settled, tape.fixtureId]);

  const setSpeed = (s: number) => { setSpeedState(s); if (clockRef.current) clockRef.current.speed = s; };
  const togglePlay = () => {
    const rc = clockRef.current; if (!rc) return;
    if (rc.isRunning) { rc.pause(); setRunning(false); } else { rc.start(); setRunning(true); }
  };
  const seek = (f: number) => {
    const rc = clockRef.current; if (!rc) return;
    chart.current?.reset();
    // rebuild chart up to seek point (downsampled)
    const target = rc.t0 + f * (rc.t1 - rc.t0);
    const upto = tape.ticks.filter(t => t.t <= target);
    const step = Math.max(1, Math.floor(upto.length / 500));
    for (let i = 0; i < upto.length; i += step) chart.current?.pushTick(upto[i]);
    for (const ev of tape.events.filter(e => e.t <= target)) chart.current?.addEventMarker(ev, tape.home, tape.away);
    chart.current?.setStoryRange(rc.t0, rc.t1);
    rc.seek(f);
  };

  const doBuy = (o: Outcome) => {
    const rc = clockRef.current; if (!rc || settled) return;
    const tick = rc.currentTick(); if (!tick) return;
    const price = tick.p[OUTCOMES.indexOf(o)];
    const r = buy(pfRef.current, o, Math.min(100, pfRef.current.cash), price, rc.now);
    if (typeof r === 'string') toast(r, 'toast-err');
    else toast(`Bought ${o === 'home' ? tape.home : o === 'away' ? tape.away : 'Draw'} @ ${fmtP(price)}`, 'toast-fill');
    forceUi(x => x + 1);
  };
  const doSell = (o: Outcome) => {
    const rc = clockRef.current; if (!rc || settled) return;
    const tick = rc.currentTick(); if (!tick) return;
    const price = tick.p[OUTCOMES.indexOf(o)];
    const r = sell(pfRef.current, o, 1, price, rc.now);
    if (typeof r === 'string') toast(r, 'toast-err');
    else toast(`Sold @ ${fmtP(price)} (${r.coins - 0 > 0 ? '+' : ''}${fmtC(r.coins)} coins)`, 'toast-fill');
    forceUi(x => x + 1);
  };

  const pf = pfRef.current;
  const curTick: Tick | null = prices ? { t: 0, p: prices } : null;
  const eq = equity(pf, curTick);
  const pnl = eq - STARTING_CASH;
  const names: Record<Outcome, string> = { home: tape.home, draw: 'Draw', away: tape.away };
  const matchClock = clockSec != null ? `${Math.floor(clockSec / 60)}'` : '';

  return (
    <div className={`session ${flash ? `flash-${flash}` : ''} ${danger ? `danger-${danger.state}` : ''}`}>
      <header>
        <button className="btn-ghost" onClick={onOpenPicker}>⏪</button>
        <div className="title">
          <div className="match">{tape.home} <span className="score">{score[0]}–{score[1]}</span> {tape.away}</div>
          <div className="sub">{tape.meta.label ?? 'World Cup'} · {matchClock} {danger && danger.team !== 0 ? `· 🔥 ${danger.team === 1 ? tape.home : tape.away} ${danger.state.replace('_', ' ')}` : ''}</div>
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

      <div className="controls">
        <button className="btn-ghost" onClick={togglePlay}>{running ? '⏸' : '▶'}</button>
        <input type="range" min={0} max={1000} value={Math.round(progress * 1000)}
          onChange={e => seek(Number(e.currentTarget.value) / 1000)} />
        <div className="speeds">
          {SPEEDS.map(s => {
            const gated = s >= 30 && !pro;
            return (
              <button key={s} className={`btn-speed ${speed === s ? 'active' : ''} ${gated ? 'gated' : ''}`}
                onClick={() => gated ? setPayOpen(true) : setSpeed(s)}>
                {gated ? '🔒' : ''}{s}×
              </button>
            );
          })}
        </div>
      </div>

      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={`toast ${t.cls}`}>{t.text}</div>)}
      </div>

      {settled && tape.final && (
        <div className="modal-backdrop">
          <div className="modal settle">
            <h2>Full time</h2>
            <div className="settle-score">{tape.home} {tape.final.home}–{tape.final.away} {tape.away}</div>
            <p>Market settled: <b>{tape.final.winner === 'draw' ? 'Draw' : names[tape.final.winner]}</b> pays 100¢ per share.</p>
            <div className={`settle-pnl ${pnl >= 0 ? 'up' : 'down'}`}>{pnl >= 0 ? '+' : ''}{fmtC(pnl)} coins</div>
            <div className="settle-board">
              {botsRef.current.standings(pf, nick).map((r, i) => (
                <div key={r.name} className={`settle-row ${r.you ? 'you' : ''}`}>
                  <span>{i === 0 ? '🏆' : `${i + 1}.`} {r.emoji} {r.you ? `You (${nick})` : r.name}</span>
                  <span className={r.eq >= STARTING_CASH ? 'up' : 'down'}>{fmtC(r.eq)}</span>
                </div>
              ))}
            </div>
            {attest && (
              <a className="attest-link" href={attest.solscan} target="_blank" rel="noreferrer">
                ⛓ Provably settled on Solana — verify ↗
              </a>
            )}
            <button className="btn-buy" onClick={onOpenPicker}>Trade another match</button>
          </div>
        </div>
      )}
      <footer className="disclaimer">
        free to play · play coins · no real money · <button className="fair-link" onClick={() => setFairOpen(true)}>⛓ provably fair</button>
      </footer>
      {fairOpen && <FairModal onClose={() => setFairOpen(false)} />}
      {payOpen && (
        <div className="modal-backdrop" onClick={() => setPayOpen(false)}>
          <div className="modal pay" onClick={e => e.stopPropagation()}>
            <h2>⚡ Touchline Pro</h2>
            <p className="muted">Warp speed replays, the danger-state overlay, and entry-fee rooms with coin prizes.</p>
            <div className="pay-tiers">
              <div className="pay-tier">
                <div className="pay-name">Coin packs</div>
                <div className="pay-price">2,500 coins · $1.99</div>
                <div className="pay-note">Top up your stack</div>
              </div>
              <div className="pay-tier featured">
                <div className="pay-name">Pro season pass</div>
                <div className="pay-price">$4.99 / mo</div>
                <div className="pay-note">30× &amp; 60× replays · danger overlay · Pro rooms (5% coin rake)</div>
              </div>
            </div>
            <button className="btn-buy" onClick={() => { localStorage.setItem('tt-pro', '1'); setPro(true); setPayOpen(false); }}>
              Start free hackathon trial
            </button>
            <p className="muted" style={{ marginTop: 8 }}>Demo build: checkout is mocked — the trial unlocks everything.</p>
          </div>
        </div>
      )}
    </div>
  );
}
