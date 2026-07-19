# Demo Filming Script — 7 shots, ~4:45 total

**How to film:** record each shot as a SEPARATE screen-recording clip (QuickTime on Mac: ⌘⇧5 → record selected window; or iPhone screen record). Don't talk while recording — read the voiceover (VO) lines into Voice Memos afterward, one take per shot. Assembly: drop clips in order into iMovie/CapCut, lay VO over, export 1080p. Name clips `shot1.mov` … `shot7.mov`.

**Setup once:** Do Not Disturb ON · browser window sized like a tall phone (~420px wide) · Shot 1 in an **incognito window** (fresh-user experience) · Shot 5 in your **normal window** (Phantom lives there, devnet mode ON).

---

### SHOT 1 — The hook (0:00–0:35) · *Fan UX*
**Do:** Incognito → open `https://touchline-trader.h-dhaliwal2250.workers.dev` → intro appears over the running match → tap **Start trading** → you're in last night's France v England → tap **BUY 100** on England.
**VO:** "Last night France and England played a ten-goal thriller for World Cup bronze. This is Touchline Trader — every match is a live stock market. Prices are real win odds from TxLINE's consensus feed. You get a thousand coins, no signup, and one job: back what you believe."

### SHOT 2 — Feel the goals (0:35–1:25) · *Real-time*
**Do:** Open `…workers.dev/?match=18257865&t=0.45` → hold your England position through the goal storm (bursts, screen shake, P&L deltas, 🎙 Floor lines). Tap 🔒30× → **Try Pro free** → watch at 30× briefly, then back to 10×.
**VO:** "This is the real market from last night, tick for tick — three thousand price updates our pipeline recorded live off TxLINE's streams. When a goal hits, the market detonates and you feel your position move. The Floor calls the drama. Sell high — or ride it to the whistle."

### SHOT 3 — Time Traveler + rooms (1:25–2:05) · *Originality*
**Do:** Tap **⏪ MATCHES** → scroll the 17-match library (your career record shows on top) → tap **⚔️ Challenge friends** (room code pops, link copied) → open **England v Argentina** → set 60×.
**VO:** "Every match of this World Cup is a market you can step back into. Challenge friends to the same match — same tape, same odds, and the room leaderboard settles the argument. An entire semifinal, its comeback and its heartbreak, in under a minute."

### SHOT 4 — Provably fair settlement (2:05–2:50) · *Solana #1*
**Do:** In England v Argentina, drag the scrubber to the end (dots show where goals are) → full-time modal: your P&L, bot rankings, world board → click **⛓ Provably settled on Solana — verify ↗** → show the Solscan transaction → back → footer **⛓ provably fair** → scroll the list.
**VO:** "Full time is settlement: the winning outcome pays a hundred cents — provably. Every settled market is anchored on Solana with TxLINE's Merkle proof root, and even this app's data subscription was purchased on-chain. Every market we've ever settled: auditable, by anyone."

### SHOT 5 — Real tokens (2:50–3:30) · *Solana #2*
**Do:** Normal browser window (Phantom on devnet) → tap **⛓ Connect** → approve in Phantom → "1,000 TT airdropped on-chain!" toast → open Phantom, show **Touchline Coin** balance → (optional: finish any replay in profit → settle modal shows "💰 winnings paid to your wallet ↗").
**VO:** "Connect a wallet and the coins get real — a thousand Touchline Coins, airdropped on Solana. Win a market and your profit pays out to your wallet automatically, receipt on-chain. No popups while you trade: web3 at the edges, instant in the middle."

### SHOT 6 — How TxLINE powers it (3:30–4:10) · *required tech segment*
**Do:** Screen-record the README's **"TxLINE endpoints used"** table, then the terminal running:
`node --env-file=.env --env-file=.env.txline -e "const r=await fetch(process.env.TXLINE_BASE+'/odds/stream',{headers:{authorization:'Bearer '+process.env.TXLINE_JWT,'x-api-token':process.env.TXLINE_API_TOKEN,accept:'text/event-stream'}}); const rd=r.body.getReader(); const d=new TextDecoder(); for(let i=0;i<6;i++){const c=await rd.read(); process.stdout.write(d.decode(c.value));}"`
(shows live `data: {…"Pct":["64.4","35.5"]…}` lines)
**VO:** "Under the hood, TxLINE's de-margined consensus odds are literally our price feed — the Pct field is the market's live win probability, streamed over server-sent events, alongside goals, cards, VAR, and possession danger states in one normalized schema. Odds stream, scores stream, historical replays, Merkle stat validation — that's the whole backend."

### SHOT 7 — The close (4:10–4:45) · *Commercial + completeness*
**Do:** Tap **⏪ MATCHES** → show **● Spain v Argentina** sitting in "Live now" (tonight's final, pre-match market already ticking) → end on the root view with the chart running.
**VO:** "Free to play, with coin packs, a Pro tier, and challenge rooms built for a rake. And because TxLINE's schema is normalized across competitions, every league night becomes a new market — this is a year-round product that happened to launch at a World Cup. Built solo in 48 hours on TxLINE, Solana, and Cloudflare. Touchline Trader: don't just watch the match. Trade it."

---

**If you have last-night TV footage** (phone filming TV + app): splice ~8 seconds of it into Shot 2 right at a goal — broadcast left, app right. If not, Shot 2 already carries the segment: it's the real market data either way.

**Timing:** film all 7 (~20 min), VO (~10 min), assemble (~30 min), upload unlisted YouTube. Hard target: submitted before the final kicks off (3 PM ET).
