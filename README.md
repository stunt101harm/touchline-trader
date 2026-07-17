# ⚽📈 Touchline Trader

**Trade the match like a stock.**

A live win-probability trading game for the 2026 World Cup. Every match is a market: the price of "Argentina to win" ticks in real time off [TxLINE](https://txline.txodds.com) consensus odds. Buy because you believe, sell because you're scared, and feel every goal as a market crash. Settlement is provably fair — the final result and its TxLINE Merkle proof root are posted on Solana.

Built solo for the **TxLINE World Cup Hackathon** (TxODDS × Solana / Superteam Earn), July 2026.

## What it does

- 📈 **Live market per match** — TxLINE consensus StablePrice odds stream rendered as a live price chart; goals, cards, and VAR decisions land as annotations, so every price move has a visible on-pitch cause.
- 💰 **Trade with free coins** — buy/sell win-probability at the live consensus price; positions, P&L, and streak badges update tick by tick. No payouts, no gambling — a game with provably fair settlement.
- 🤖 **Live match rooms** — leaderboard vs. friends and seeded rival traders.
- ⛓️ **Provably fair settlement** — at full time the market resolves to 0/100 from the Merkle-proved final score; result + proof root are committed on Solana devnet (Solscan-verifiable).
- ⏪ **Time Traveler mode** — trade any completed World Cup match in replay at 1×–60× speed. An entire match's market drama in 25 seconds.

## Status

🚧 In active development — see [PLAN.md](PLAN.md) for the implementation plan and the [issue tracker](https://github.com/stunt101harm/touchline-trader/issues) for progress.

## Stack

Next.js (Vercel) · Node ingest worker (TxLINE SSE) · Supabase (Postgres + Realtime) · lightweight-charts · Solana devnet (settlement attestation) · TxLINE API (odds/scores streams, historical replay, Merkle validation)
