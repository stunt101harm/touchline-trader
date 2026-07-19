import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DangerSpan, MatchEvent, Outcome, TapeBundle, TapeManifestEntry, Tick } from '../shared/types';
import { OUTCOMES } from '../shared/types';
import { buy, sell, settle, equity, newPortfolio, tickAt, type Portfolio, STARTING_CASH } from '../shared/engine';
import { ReplayClock, tapeBounds } from './replay';
import { MarketChart, type ChartHandle } from './Chart';
import { BotEngine } from './bots';
import LiveSession from './LiveSession';
import type { LiveMatch } from './live';
import { confetti } from './confetti';
import { renderShareCard, shareCard } from './share';
import { hasWallet, connectWallet, savedWallet, claimTT, payoutTT, solscanTx, short } from './wallet';
import { FloorCommentator, type FloorLine } from './commentary';
import { recordResult, careerSummary, currentRoom, setRoom, makeRoomCode, roomLink } from './career';

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
  const [introOpen, setIntroOpen] = useState(() => localStorage.getItem('tt-seen') !== '1');
  const nick = useMemo(myName, []);
  const params = useMemo(() => {
    const p = new URLSearchParams(location.search);
    if (p.has('fresh')) {
      // demo/testing helper: reset to the first-visit experience
      ['tt-seen', 'tt-traded', 'tt-career', 'tt-pro', 'tt-nick', 'tt-wallet'].forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem('tt-room');
      p.delete('fresh');
      history.replaceState(null, '', `${location.pathname}${p.toString() ? '?' + p.toString() : ''}`);
      location.reload();
    }
    return p;
  }, []);

  useEffect(() => {
    const room = params.get('room');
    if (room) setRoom(room);
    fetch('/tapes/index.json').then(r => r.json() as Promise<TapeManifestEntry[]>).then((m) => {
      setManifest(m);
      const wanted = Number(params.get('match'));
      const featured = m.find(e => e.fixtureId === wanted) ?? m.find(e => e.featured) ?? m[0];
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

  const closeIntro = () => { localStorage.setItem('tt-seen', '1'); setIntroOpen(false); };

  return (
    <div className="app">
      {liveMatch
        ? <LiveSession key={liveMatch.fixture_id} match={liveMatch} nick={nick} onOpenPicker={() => setPickerOpen(true)} />
        : tape
          ? <MatchSession key={tape.fixtureId} tape={tape} onOpenPicker={() => setPickerOpen(true)}
              onHelp={() => setIntroOpen(true)}
              initialSpeed={Number(params.get('speed')) || undefined}
              initialSeek={params.get('t') != null ? Number(params.get('t')) : undefined} />
          : <div className="loading">loading the market…</div>}
      {introOpen && (
        <div className="intro-backdrop" onClick={closeIntro}>
          <div className="intro" onClick={e => e.stopPropagation()}>
            <div className="intro-logo">⚽📈</div>
            <h1>Trade the match like a stock</h1>
            <ul>
              <li><b>Prices are live win odds</b> from the real betting market — 35¢ means a 35% chance.</li>
              <li><b>BUY the outcome you believe in.</b> Goals send prices soaring or crashing in seconds.</li>
              <li><b>SELL high to lock profit</b> — or hold to full time: the winner pays 100¢, the rest pay 0.</li>
              <li><b>⏪ Matches</b> opens the library — replay any classic at warp speed, or join a live match.</li>
            </ul>
            <button className="btn-buy intro-go" onClick={closeIntro}>Start trading — you have 1,000 coins</button>
            <p className="muted">free to play · no real money · provably fair on Solana</p>
          </div>
        </div>
      )}
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
            <CareerStrip />
            {tape && (
              <button className="picker-row challenge-row" onClick={() => {
                const code = currentRoom() ?? makeRoomCode();
                setRoom(code);
                navigator.clipboard?.writeText(roomLink(code, tape.fixtureId)).catch(() => {});
                alert(`Room ${code} — challenge link copied!\n\nSend it to friends: everyone trades ${tape.home} v ${tape.away} and the room leaderboard settles it.`);
              }}>
                <span className="picker-label">⚔️ 1v1</span>
                <span className="picker-match">Challenge friends on this match</span>
                <span className="picker-score">{currentRoom() ? `room ${currentRoom()}` : 'copy link'}</span>
              </button>
            )}
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

function CareerStrip() {
  const s = careerSummary();
  if (s.matches === 0) return null;
  return (
    <div className="career-strip">
      📈 Your record: <b>{s.matches}</b> market{s.matches === 1 ? '' : 's'} ·{' '}
      <b className={s.total >= 0 ? 'up' : 'down'}>{s.total >= 0 ? '+' : ''}{s.total.toLocaleString()}</b> lifetime
      {s.best && s.best.pnl > 0 && <> · best <b className="up">+{s.best.pnl.toLocaleString()}</b> ({s.best.match})</>}
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

function MatchSession({ tape, onOpenPicker, onHelp, initialSpeed, initialSeek }: {
  tape: TapeBundle; onOpenPicker: () => void; onHelp?: () => void;
  initialSpeed?: number; initialSeek?: number;
}) {
  const chart = useRef<ChartHandle>(null);
  const clockRef = useRef<ReplayClock | null>(null);
  const pfRef = useRef<Portfolio>(newPortfolio());
  const botsRef = useRef<BotEngine>(new BotEngine());
  const nick = useMemo(myName, []);
  const bounds = useMemo(() => tapeBounds(tape), [tape]);

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
  const [payOpen, setPayOpen] = useState<number | null>(null); // requested speed, or null
  const [pro, setPro] = useState(() => localStorage.getItem('tt-pro') === '1');
  const [shake, setShake] = useState(false);
  const [goalBurst, setGoalBurst] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<{ id: number; v: number }[]>([]);
  const [hasTraded, setHasTraded] = useState(() => localStorage.getItem('tt-traded') === '1');
  const [world, setWorld] = useState<any[] | null>(null);
  const [wallet, setWallet] = useState<string | null>(savedWallet());
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [payout, setPayout] = useState<{ amount: number; tx?: string } | null>(null);
  const [floor, setFloor] = useState<FloorLine | null>(null);
  const [, forceUi] = useState(0); // portfolio changes

  const doConnect = async () => {
    if (!hasWallet()) {
      toast('Install Phantom to claim coins on-chain', 'toast-err');
      window.open('https://phantom.app', '_blank');
      return;
    }
    let pk: string;
    try {
      pk = await connectWallet();
      setWallet(pk);
    } catch (e: any) {
      if (e.message !== 'no-wallet') toast('Wallet connection cancelled', 'toast-err');
      return;
    }
    try {
      const res = await claimTT(pk);
      setClaimTx(res.tx);
      toast(res.alreadyClaimed ? `Wallet linked — ${res.amount} TT already claimed` : `⛓ ${res.amount} TT airdropped on-chain!`, 'toast-fill');
    } catch {
      toast('Wallet linked — on-chain claim will retry at settlement', 'toast-fill');
    }
  };

  const toast = useCallback((text: string, cls = '') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, text, cls }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  }, []);

  useEffect(() => {
    const pf = pfRef.current;
    const bots = botsRef.current;
    const floorC = new FloorCommentator({ home: tape.home, away: tape.away }, setFloor);
    const rc = new ReplayClock(tape, {
      onTick: (tick) => { chart.current?.pushTick(tick); bots.onTick(tick); floorC.onTick(tick); setPrices([...tick.p] as any); },
      onEvent: (ev) => {
        chart.current?.addEventMarker(ev, tape.home, tape.away);
        bots.onEvent(ev);
        if (ev.score) { setScore(ev.score); floorC.onScore(ev.score); }
        if (ev.clockSec != null) { setClockSec(ev.clockSec); floorC.onClock(ev.clockSec); }
        floorC.onEvent(ev, rc.currentTick());
        handleEvent(ev);
      },
      onDanger: (d) => { bots.onDanger(d); floorC.onDanger(d); setDanger(d.state === 'safe' ? null : d); },
      onTime: (_, p) => setProgress(p),
      onEnd: () => setRunning(false),
    });

    function handleEvent(ev: MatchEvent) {
      const name = ev.team === 1 ? tape.home : ev.team === 2 ? tape.away : '';
      switch (ev.kind) {
        case 'goal': {
          toast(`⚽ GOAL — ${name}!`, 'toast-goal');
          setGoalBurst(name || 'GOAL');
          setShake(true);
          setTimeout(() => setShake(false), 500);
          setTimeout(() => setGoalBurst(null), 1100);
          try { (navigator as any).vibrate?.([80, 40, 120]); } catch { /* unsupported */ }
          // flash for/against the user's actual holdings: green if the scoring side is
          // your biggest position, red if you're holding against it, neutral gold otherwise
          const scored: Outcome | null = ev.team === 1 ? 'home' : ev.team === 2 ? 'away' : null;
          const held = OUTCOMES.filter(o => pf.positions[o].shares > 0)
            .sort((a, b) => pf.positions[b].cost - pf.positions[a].cost)[0];
          if (held && scored) setFlash(held === scored ? 'up' : 'down');
          else if (held === 'draw') setFlash('down');
          setTimeout(() => setFlash(null), 1400);
          // P&L delta pop once the market has repriced the goal
          const eq0 = equity(pf, rc.currentTick());
          setTimeout(() => {
            const d = equity(pf, rc.currentTick()) - eq0;
            if (Math.abs(d) >= 3) {
              const id = Date.now() + Math.random();
              setDeltas(ds => [...ds.slice(-2), { id, v: d }]);
              setTimeout(() => setDeltas(ds => ds.filter(x => x.id !== id)), 1500);
            }
          }, 1200);
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
            if (pf.cash > STARTING_CASH) confetti();
            const room = currentRoom();
            fetch('/api/score', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ fixtureId: tape.fixtureId, nick, mode: 'replay', pnl: pf.cash - STARTING_CASH, equity: pf.cash, room }),
            }).then(() => fetch(`/api/score/${tape.fixtureId}${room ? `?room=${room}` : ''}`))
              .then(r => r.ok ? r.json() : null)
              .then(rows => Array.isArray(rows) && rows.length ? setWorld(rows) : null)
              .catch(() => {});
            const w = savedWallet();
            if (w && pf.cash > STARTING_CASH) {
              payoutTT(w, tape.fixtureId, pf.cash - STARTING_CASH).then(setPayout);
            }
            recordResult({
              fixtureId: tape.fixtureId, match: `${tape.home} v ${tape.away}`,
              pnl: Math.round(pf.cash - STARTING_CASH), mode: 'replay', ts: Date.now(),
            });
          }
          break;
        }
      }
      forceUi(x => x + 1);
    }

    clockRef.current = rc;
    if (import.meta.env.DEV) (window as any).__rc = rc;
    const spd = initialSpeed && SPEEDS.includes(initialSpeed) ? initialSpeed : 10;
    rc.speed = spd;
    setSpeedState(spd);
    chart.current?.setStoryRange(rc.t0, rc.t1);
    if (initialSeek != null && initialSeek > 0 && initialSeek < 1) rc.seek(initialSeek);
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
    if (rc.isRunning) { rc.pause(); setRunning(false); return; }
    // at the end of the tape, play = watch it again from kickoff
    if (rc.now >= rc.t1 - 1000) seek(0);
    rc.start(); setRunning(true);
  };
  const seek = (f: number) => {
    const rc = clockRef.current; if (!rc) return;
    const wasRunning = rc.isRunning;
    rc.pause(); // stop event delivery while we rebuild — prevents duplicate markers
    chart.current?.reset();
    // never scrub past the full-time event — the tape carries post-match ticks,
    // so a raw clamp near t1 could skip FT and strand the session unsettled
    const ft = tape.events.find(e => e.kind === 'fulltime');
    const maxFrac = ft ? Math.max(0, (ft.t - 3000 - rc.t0) / (rc.t1 - rc.t0)) : 0.995;
    f = Math.min(f, maxFrac, 0.995);
    const target = rc.t0 + f * (rc.t1 - rc.t0);
    const upto = tape.ticks.filter(t => t.t <= target);
    const step = Math.max(1, Math.floor(upto.length / 500));
    for (let i = 0; i < upto.length; i += step) chart.current?.pushTick(upto[i]);
    const played = tape.events.filter(e => e.t <= target);
    for (const ev of played) chart.current?.addEventMarker(ev, tape.home, tape.away);
    // sync header state to the scrub position — score/clock must never lag the chart
    const lastScore = [...played].reverse().find(e => e.score)?.score;
    setScore(lastScore ?? [0, 0]);
    const lastClock = [...played].reverse().find(e => e.clockSec != null)?.clockSec;
    setClockSec(lastClock ?? null);
    const lastDanger = [...tape.danger.filter(d => d.t <= target)].pop();
    setDanger(lastDanger && lastDanger.state !== 'safe' ? lastDanger : null);
    chart.current?.setStoryRange(rc.t0, rc.t1);
    rc.seek(f);
    if (wasRunning && !settled) { rc.start(); setRunning(true); }
  };

  const doBuy = (o: Outcome) => {
    const rc = clockRef.current; if (!rc || settled) return;
    const tick = rc.currentTick(); if (!tick) return;
    const price = tick.p[OUTCOMES.indexOf(o)];
    const r = buy(pfRef.current, o, Math.min(100, pfRef.current.cash), price, rc.now);
    if (typeof r === 'string') toast(r, 'toast-err');
    else {
      toast(`Bought ${o === 'home' ? tape.home : o === 'away' ? tape.away : 'Draw'} @ ${fmtP(price)}`, 'toast-fill');
      if (!hasTraded) { setHasTraded(true); localStorage.setItem('tt-traded', '1'); }
    }
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
    <div className={`session ${flash ? `flash-${flash}` : ''} ${danger ? `danger-${danger.state}` : ''} ${shake ? 'shake' : ''}`}>
      <header>
        <button className="btn-matches" onClick={onOpenPicker}>⏪<span>Matches</span></button>
        <div className="title">
          <div className="match">{tape.home} <span className="score">{score[0]}–{score[1]}</span> {tape.away}</div>
          <div className="sub">{tape.meta.label ?? 'World Cup'} · {matchClock} {danger && danger.team !== 0 ? `· 🔥 ${danger.team === 1 ? tape.home : tape.away} ${danger.state.replace('_', ' ')}` : ''}</div>
        </div>
        {onHelp && <button className="btn-ghost help-pill" onClick={onHelp}>?</button>}
        <button className={`wallet-chip ${wallet ? 'linked' : ''}`} onClick={doConnect}
          title={wallet ? `Linked: ${wallet}` : 'Connect a Solana wallet to claim TT coins on-chain'}>
          {wallet ? `⛓ ${short(wallet)}` : '⛓ Connect'}
        </button>
        <div className="wallet">
          <div className={`pnl ${pnl >= 0 ? 'up' : 'down'}`}>{pnl >= 0 ? '+' : ''}{fmtC(pnl)}</div>
          <div className="cash" title="cash · total portfolio value (cash + positions at market price)">
            {fmtC(pf.cash)} cash · {fmtC(eq)} total
          </div>
        </div>
      </header>
      {goalBurst && <div className="goal-burst"><span>⚽ GOAL</span><em>{goalBurst}</em></div>}
      <div className="deltas">
        {deltas.map(d => <div key={d.id} className={`delta ${d.v >= 0 ? 'up' : 'down'}`}>{d.v >= 0 ? '+' : ''}{fmtC(d.v)}</div>)}
      </div>

      <MarketChart ref={chart} focus={focus} />

      {floor && (
        <div key={floor.text} className={`floor floor-${floor.tone}`}>
          <span className="floor-icon">🎙</span> {floor.text}
        </div>
      )}

      <div className="outcomes">
        {OUTCOMES.map((o, i) => {
          const pos = pf.positions[o];
          const price = prices?.[i];
          return (
            <div key={o} className={`outcome ${focus === o ? 'focused' : ''} oc-${o}`} onClick={() => setFocus(o)}>
              <div className="oc-name">{names[o]}</div>
              <div className="oc-price">{price != null ? fmtP(price) : '—'}</div>
              <button className={`btn-buy ${!hasTraded && o === 'home' ? 'pulse' : ''}`} disabled={settled} onClick={(e) => { e.stopPropagation(); doBuy(o); }}>
                BUY 100
              </button>
              {pos.shares > 0 && price != null && (
                <div className="oc-pos" title={`${pos.shares.toFixed(2)} shares — each pays 100 coins if this wins`}>
                  Pays {fmtC(pos.shares * 100)} · <span className={(pos.shares * price - pos.cost) >= 0 ? 'up' : 'down'}>{(pos.shares * price - pos.cost) >= 0 ? '+' : ''}{fmtC(pos.shares * price - pos.cost)}</span>
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
        <div className="scrub-wrap">
          <input type="range" min={0} max={1000} value={Math.round(progress * 1000)}
            onChange={e => seek(Number(e.currentTarget.value) / 1000)} />
          <div className="scrub-dots">
            {tape.events.filter(e => e.kind === 'goal' || e.kind === 'red_card' || e.kind === 'halftime').map((e, i) => (
              <span key={i}
                className={`dot dot-${e.kind} ${e.team === 1 ? 'team-home' : e.team === 2 ? 'team-away' : ''}`}
                style={{ left: `${(((e.t - bounds.t0) / (bounds.t1 - bounds.t0)) * 100).toFixed(2)}%` }}
                title={e.kind === 'goal' ? `⚽ ${e.team === 1 ? tape.home : tape.away}` : e.kind === 'red_card' ? '🟥' : 'HT'} />
            ))}
          </div>
        </div>
        <div className="speeds">
          {SPEEDS.map(s => {
            const gated = s >= 30 && !pro;
            return (
              <button key={s} className={`btn-speed ${speed === s ? 'active' : ''} ${gated ? 'gated' : ''}`}
                onClick={() => gated ? setPayOpen(s) : setSpeed(s)}>
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
            {world && (
              <div className="world-board">
                <div className="world-title">{currentRoom() ? `🏟 Room ${currentRoom()} — this match` : '🌍 Top traders on this match'}</div>
                {world.slice(0, 5).map((w: any, i: number) => (
                  <div key={i} className={`settle-row ${w.nick === nick ? 'you' : ''}`}>
                    <span>{i + 1}. {w.nick}{w.nick === nick ? ' (you)' : ''}</span>
                    <span className={w.pnl >= 0 ? 'up' : 'down'}>{w.pnl >= 0 ? '+' : ''}{fmtC(w.pnl)}</span>
                  </div>
                ))}
              </div>
            )}
            {attest && (
              <a className="attest-link" href={attest.solscan} target="_blank" rel="noreferrer">
                ⛓ Provably settled on Solana — verify ↗
              </a>
            )}
            {payout && payout.amount > 0 && payout.tx && (
              <a className="attest-link payout-link" href={solscanTx(payout.tx)} target="_blank" rel="noreferrer">
                💰 {payout.amount} TT winnings paid to your wallet ↗
              </a>
            )}
            {!wallet && pnl > 0 && (
              <button className="btn-sell claim-nudge" onClick={doConnect}>⛓ Connect a wallet to claim winnings on-chain</button>
            )}
            <div className="settle-actions">
              <button className="btn-sell share-btn" onClick={() => shareCard(renderShareCard({ tape, endCash: pf.cash }), `I turned 1,000 coins into ${fmtC(pf.cash)} trading ${tape.home} v ${tape.away} on Touchline Trader`)}>
                📤 Share result
              </button>
              <button className="btn-buy" onClick={onOpenPicker}>Trade another match</button>
            </div>
          </div>
        </div>
      )}
      <footer className="disclaimer">
        free to play · play coins · no real money · <button className="fair-link" onClick={() => setFairOpen(true)}>⛓ provably fair</button>
      </footer>
      {fairOpen && <FairModal onClose={() => setFairOpen(false)} />}
      {payOpen != null && (
        <div className="modal-backdrop" onClick={() => setPayOpen(null)}>
          <div className="modal pay" onClick={e => e.stopPropagation()}>
            <h2>⚡ Touchline Pro</h2>
            <p className="muted">Warp-speed replays and entry-fee rooms with coin prizes.</p>
            <div className="pay-tiers">
              <div className="pay-tier">
                <div className="pay-name">Coin packs</div>
                <div className="pay-price">2,500 coins · $1.99</div>
                <div className="pay-note">Top up your stack</div>
              </div>
              <div className="pay-tier featured">
                <div className="pay-name">Pro season pass</div>
                <div className="pay-price">$4.99 / mo</div>
                <div className="pay-note">30× &amp; 60× warp replays · entry-fee rooms (5% coin rake) · trader badges</div>
              </div>
            </div>
            <button className="btn-buy" onClick={() => {
              localStorage.setItem('tt-pro', '1'); setPro(true);
              const want = payOpen; setPayOpen(null);
              if (want && SPEEDS.includes(want)) setSpeed(want);
            }}>
              Try Pro free — unlock {payOpen && payOpen >= 30 ? `${payOpen}×` : 'everything'} now
            </button>
            <p className="muted" style={{ marginTop: 8 }}>Demo build: checkout is mocked — the trial unlocks everything.</p>
          </div>
        </div>
      )}
    </div>
  );
}
