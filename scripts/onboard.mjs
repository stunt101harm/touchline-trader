// TxLINE devnet onboarding: guest JWT -> purchase quote -> co-sign + broadcast -> activate API token.
// Run: node --env-file=.env scripts/onboard.mjs
// Writes the resulting credentials to .env.txline (gitignored via .env* pattern? -> we add explicitly).
import { Connection, Keypair, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { writeFileSync, appendFileSync } from 'node:fs';

const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const AUTH_BASE = BASE.replace(/\/api\/?$/, '');
const RPC = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const secret = process.env.DEVNET_WALLET_SECRET;
if (!secret) throw new Error('DEVNET_WALLET_SECRET missing');

const wallet = Keypair.fromSecretKey(bs58.decode(secret));
const conn = new Connection(RPC, 'confirmed');
console.log('wallet:', wallet.publicKey.toBase58());

const j = async (res) => {
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.url} :: ${text.slice(0, 500)}`);
  return body;
};

// 0. ensure devnet SOL
let bal = await conn.getBalance(wallet.publicKey);
console.log('balance:', bal / LAMPORTS_PER_SOL, 'SOL');
if (bal < 0.05 * LAMPORTS_PER_SOL) {
  console.log('requesting airdrop…');
  try {
    const sig = await conn.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
    bal = await conn.getBalance(wallet.publicKey);
    console.log('post-airdrop balance:', bal / LAMPORTS_PER_SOL, 'SOL');
  } catch (e) {
    console.warn('airdrop failed (rate limit?):', e.message);
  }
}

// 1. guest JWT
const { token: jwt } = await j(await fetch(`${AUTH_BASE}/auth/guest/start`, { method: 'POST' }));
console.log('guest JWT acquired, claims:', JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()));

// 2. purchase quote
const quote = await j(await fetch(`${BASE}/guest/purchase/quote`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ buyerPubkey: wallet.publicKey.toBase58(), txlineAmount: 50 }),
}));
console.log('quote:', { baseUsdtCost: quote.baseUsdtCost, feeUsdtAmount: quote.feeUsdtAmount, totalUsdtCharged: quote.totalUsdtCharged });

// 3. co-sign + broadcast
const txBuf = Buffer.from(quote.transactionBase64, 'base64');
let raw;
try {
  const tx = Transaction.from(txBuf);
  tx.partialSign(wallet);
  raw = tx.serialize();
} catch {
  const vtx = VersionedTransaction.deserialize(txBuf);
  vtx.sign([wallet]);
  raw = vtx.serialize();
}
const txSig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
console.log('subscribe tx sent:', txSig);
await conn.confirmTransaction(txSig, 'confirmed');
console.log('confirmed. solscan:', `https://solscan.io/tx/${txSig}?cluster=devnet`);

// 4. activate (free bundle: empty leagues -> "txSig::jwt")
const message = new TextEncoder().encode(`${txSig}::${jwt}`);
const walletSignature = Buffer.from(nacl.sign.detached(message, wallet.secretKey)).toString('base64');
const activated = await j(await fetch(`${BASE}/token/activate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ txSig, walletSignature, leagues: [] }),
}));
console.log('activation response keys:', Object.keys(activated));
const apiToken = activated.token;

// decode TTLs where possible
for (const [name, t] of [['jwt', jwt], ['apiToken', apiToken]]) {
  try {
    const claims = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    console.log(`${name} claims:`, claims, claims.exp ? `(expires ${new Date(claims.exp * 1000).toISOString()})` : '');
  } catch { console.log(`${name}: not a decodable JWT (opaque token)`); }
}

writeFileSync(new URL('../.env.txline', import.meta.url),
  `TXLINE_JWT=${jwt}\nTXLINE_API_TOKEN=${apiToken}\nTXLINE_SUBSCRIBE_TX=${txSig}\n`);
console.log('credentials written to .env.txline');

// 5. smoke test a data endpoint
const snap = await fetch(`${BASE}/fixtures/snapshot`, {
  headers: { authorization: `Bearer ${jwt}`, 'x-api-token': apiToken },
});
const snapBody = await snap.text();
console.log('fixtures/snapshot status:', snap.status, 'bytes:', snapBody.length);
appendFileSync(new URL('../captures/fixtures-snapshot.json', import.meta.url), snapBody + '\n');
console.log('sample saved to captures/fixtures-snapshot.json');
