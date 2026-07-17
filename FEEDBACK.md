# TxLINE API Feedback (required hackathon deliverable)

Running log from building Touchline Trader — appended as we hit things. Written by a solo builder integrating the full surface (auth, streams, historical, validation) over the final days of the tournament.

## What we liked

- **`TXLineStablePriceDemargined` with the `Pct` field is excellent.** Getting de-margined implied probabilities directly on every odds update meant zero overround math on our side — the consensus feed is usable as a probability tape out of the box. This single design choice saved us hours and is the foundation of our whole product.
- **Historical odds intervals return every update in the bucket**, not a downsampled series. Replaying a past match's market at full fidelity "just works."
- **`FixtureId` on every stream event** makes per-fixture filtering trivial; `id:` lines on the SSE stream suggest Last-Event-ID resume, and 15s heartbeats make dead-connection detection easy.
- The **soccer event vocabulary is genuinely rich** — possession danger states (`attack/danger/high_danger/safe`), shots, VAR, `additional_time`, `clock_adjustment`, `game_finalised` — enough to drive a second-screen product with real dramatic texture, not just goals.
- **Free-tier on-chain subscribe (zero TxL) worked first try** once we found it, and the devnet pricing matrix being readable on-chain is a nice touch — we could verify "level 1 = 0 tokens/week, sampling 0s" ourselves instead of trusting docs.
- The `tx-on-chain` examples repo was the single most useful resource — `subscription_free_tier.ts` + the vendored IDL unblocked us when the docs couldn't.

## Friction / suggestions

1. **The paid onboarding path dead-ends on devnet with no faucet.** `POST /api/guest/purchase/quote` fails with `Insufficient USDT balance. Required: 50000 micro-USDT, Found: 0` and no documented way to obtain devnet USDT. The quickstart leads with the paid flow, so we burned time here before discovering the free tier. Suggest: docs state clearly "on devnet, use the free tier — the paid flow requires USDT you cannot get," or add a faucet.
2. **The shipped IDL's `address` is the mainnet program.** Using `idl/txoracle.json` against devnet silently targets `9Exb…` unless you override to `6pW64…`. A `devnet.idl.json` or a note in the devnet docs would prevent a confusing first failure.
3. **`/scores/historical/{fixtureId}` and `/scores/updates/{fixtureId}` return SSE-formatted text (`data:` lines) with a JSON content expectation.** Nothing in the OpenAPI spec says so — the response schema implies JSON. We initially parsed 1.25 MB responses as "empty." Documenting the response framing (or returning a JSON array like `/scores/snapshot`) would help.
4. **Empty vs. missing is indistinguishable.** Fixtures without historical score coverage return HTTP 200 with zero `data:` lines rather than a 404 or a coverage flag. A `coverage` field on the fixture (or 204/404) would let clients distinguish "quiet match" from "no data."
5. **`fixtures/snapshot` pagination is undocumented.** Without `startEpochDay` you get only current/upcoming; discovering the full tournament required iterating epoch days. Documenting `startEpochDay` (and adding an `endEpochDay` or `competition=all-history` mode) would help.
6. **Devnet historical score coverage is partial** (16 of 104 World Cup fixtures in our probe). Fine for a hackathon sample, but worth stating in the World Cup docs so builders scope replay features accordingly. Odds interval coverage was much better (101/104).
7. Minor: heartbeat frames put the `data:` line before `event: heartbeat`, which trips naive per-line parsers that dispatch on the first `data:`. Valid SSE, but worth a docs note for people writing raw parsers.

_(Items 1–7 logged on Day 0, 2026-07-17. Later findings appended below.)_
