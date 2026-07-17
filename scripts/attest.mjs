// Post on-chain settlement attestations: one devnet memo tx per completed fixture,
// anchoring the TxLINE Merkle-proved final score. Output: web/public/attestations/{id}.json + index.
// Run: node --env-file=.env --env-file=.env.txline scripts/attest.mjs [fixtureId…]
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MEMO_PROGRAM = new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo');
const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const H = { authorization: `Bearer ${process.env.TXLINE_JWT}`, 'x-api-token': process.env.TXLINE_API_TOKEN };
const wallet = Keypair.fromSecretKey(bs58.decode(process.env.DEVNET_WALLET_SECRET));
const conn = new Connection(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed');

const TAPES = fileURLToPath(new URL('../web/public/tapes', import.meta.url));
const OUT = fileURLToPath(new URL('../web/public/attestations', import.meta.url));
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2).map(Number).filter(Boolean);
const ids = readdirSync(TAPES).filter(f => /^\d+\.json$/.test(f)).map(f => Number(f.replace('.json', '')))
  .filter(id => !only.length || only.includes(id));

const index = [];
for (const id of ids) {
  const tape = JSON.parse(readFileSync(`${TAPES}/${id}.json`, 'utf8'));
  const outPath = `${OUT}/${id}.json`;
  if (existsSync(outPath)) {
    index.push(JSON.parse(readFileSync(outPath, 'utf8')));
    console.log(`${id} already attested — skip`);
    continue;
  }

  // final event seq -> Merkle-proved stats
  const hist = await (await fetch(`${BASE}/scores/historical/${id}`, { headers: H })).text();
  const evs = hist.split('\n').filter(l => l.startsWith('data: ')).map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const fin = evs.filter(e => e.Action === 'game_finalised').pop();
  if (!fin) { console.log(`${id}: no finalised event — skip`); continue; }
  const val = await (await fetch(`${BASE}/scores/stat-validation?fixtureId=${id}&seq=${fin.Seq}&statKeys=1,2`, { headers: H })).json();
  const goals = [0, 0];
  for (const s of val.statsToProve ?? []) if (s.key === 1) goals[0] = s.value; else if (s.key === 2) goals[1] = s.value;
  const root = bs58.encode(Uint8Array.from(val.eventStatRoot ?? []));

  const memo = JSON.stringify({
    app: 'touchline-trader', v: 1,
    fixture: id, match: `${tape.home}-${tape.away}`,
    goals, settled: tape.final?.winner,           // market settles on regulation score
    regulation: [tape.final?.home, tape.final?.away],
    txlineStatRoot: root, seq: fin.Seq, ts: fin.Ts,
  });

  const tx = new Transaction().add(new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, 'utf8'),
  }));
  const bh = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');

  const record = {
    fixtureId: id, match: `${tape.home}-${tape.away}`,
    regulation: [tape.final?.home, tape.final?.away], goals, winner: tape.final?.winner,
    statRoot: root, seq: fin.Seq, finalTs: fin.Ts,
    txSig: sig, solscan: `https://solscan.io/tx/${sig}?cluster=devnet`,
  };
  writeFileSync(outPath, JSON.stringify(record, null, 1));
  index.push(record);
  console.log(`${id} ${tape.home}-${tape.away} → attested ${sig.slice(0, 12)}… (root ${root.slice(0, 8)}…)`);
  await new Promise(r => setTimeout(r, 400)); // gentle on public RPC
}

index.sort((a, b) => b.finalTs - a.finalTs);
writeFileSync(`${OUT}/index.json`, JSON.stringify({
  wallet: wallet.publicKey.toBase58(),
  subscriptionTx: process.env.TXLINE_SUBSCRIBE_TX,
  subscriptionSolscan: `https://solscan.io/tx/${process.env.TXLINE_SUBSCRIBE_TX}?cluster=devnet`,
  attestations: index,
}, null, 1));
console.log(`\n${index.length} attestations → web/public/attestations/`);
