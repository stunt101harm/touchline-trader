// TxLINE devnet FREE-TIER onboarding: on-chain subscribe (zero TxL) -> activate API token.
// Run: node --env-file=.env scripts/subscribe.mjs [serviceLevelId]
import anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { readFileSync, writeFileSync } from 'node:fs';

const PROGRAM_ID = '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'; // devnet (IDL ships mainnet address)
const TOKEN_MINT = new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG');
const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const AUTH_BASE = BASE.replace(/\/api\/?$/, '');

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.DEVNET_WALLET_SECRET));
const conn = new Connection(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed');
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(wallet), { commitment: 'confirmed' });
const idl = JSON.parse(readFileSync(new URL('./txoracle.idl.json', import.meta.url), 'utf8'));
idl.address = PROGRAM_ID;
const program = new anchor.Program(idl, provider);
console.log('wallet:', wallet.publicKey.toBase58(), '| program:', program.programId.toBase58());

// 1. pricing matrix — choose service level from facts
const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], program.programId);
const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
console.log('\nlevel  tokens/week  sampling(s)  leagueBundle  marketBundle');
for (const r of matrix.rows) {
  console.log(String(r.rowId).padStart(5), String(r.pricePerWeekToken).padStart(12), String(r.samplingIntervalSec).padStart(12), String(r.leagueBundleId).padStart(13), String(r.marketBundleId).padStart(13));
}
const free = matrix.rows.filter(r => Number(r.pricePerWeekToken) === 0)
  .sort((a, b) => Number(a.samplingIntervalSec) - Number(b.samplingIntervalSec));
if (!free.length) throw new Error('no zero-cost service level on devnet matrix');
const chosen = process.argv[2] ? Number(process.argv[2]) : Number(free[0].rowId);
const chosenRow = matrix.rows.find(r => Number(r.rowId) === chosen);
console.log(`\nchoosing service level ${chosen} (price ${chosenRow.pricePerWeekToken}/wk, sampling ${chosenRow.samplingIntervalSec}s)`);

// 2. guest JWT
const jwtRes = await fetch(`${AUTH_BASE}/auth/guest/start`, { method: 'POST' });
const { token: jwt } = await jwtRes.json();
const jwtClaims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
console.log('guest JWT ok, expires:', new Date(jwtClaims.exp * 1000).toISOString());

// 3. ensure Token-2022 ATA for TxL mint
const ata = getAssociatedTokenAddressSync(TOKEN_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
if (!(await conn.getAccountInfo(ata))) {
  console.log('creating Token-2022 ATA…');
  const tx = new Transaction().add(createAssociatedTokenAccountInstruction(
    wallet.publicKey, ata, wallet.publicKey, TOKEN_MINT, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  const sig = await provider.sendAndConfirm(tx);
  console.log('ATA created:', sig);
}
let tokenAccount;
for (let i = 0; i < 5; i++) {
  try { tokenAccount = await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID); break; }
  catch { await new Promise(r => setTimeout(r, 2000)); }
}
if (!tokenAccount) throw new Error('ATA not visible after retries');

// 4. subscribe on-chain (free: zero TxL, 4 weeks)
const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], program.programId);
const treasuryVault = getAssociatedTokenAddressSync(TOKEN_MINT, treasuryPda, true, TOKEN_2022_PROGRAM_ID);
console.log('subscribing on-chain: level', chosen, ', 4 weeks…');
const subTx = await program.methods
  .subscribe(chosen, 4)
  .accountsPartial({
    user: wallet.publicKey,
    pricingMatrix: pricingMatrixPda,
    tokenMint: TOKEN_MINT,
    userTokenAccount: ata,
    tokenTreasuryVault: treasuryVault,
    tokenTreasuryPda: treasuryPda,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .transaction();
const bh = await conn.getLatestBlockhash('confirmed');
subTx.recentBlockhash = bh.blockhash;
subTx.feePayer = wallet.publicKey;
subTx.sign(wallet);
const txSig = await conn.sendRawTransaction(subTx.serialize());
await conn.confirmTransaction({ signature: txSig, ...bh }, 'confirmed');
console.log('subscribe tx confirmed:', txSig);
console.log('solscan:', `https://solscan.io/tx/${txSig}?cluster=devnet`);

// 5. activate API token (free bundle: empty leagues)
const msg = new TextEncoder().encode(`${txSig}::${jwt}`);
const walletSignature = Buffer.from(nacl.sign.detached(msg, wallet.secretKey)).toString('base64');
const actRes = await fetch(`${BASE}/token/activate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ txSig, walletSignature, leagues: [] }),
});
const actText = await actRes.text();
if (!actRes.ok) throw new Error(`activate ${actRes.status}: ${actText.slice(0, 500)}`);
const apiToken = (() => { try { return JSON.parse(actText).token ?? actText; } catch { return actText; } })();
console.log('API token acquired (', String(apiToken).length, 'chars )');
try {
  const c = JSON.parse(Buffer.from(String(apiToken).split('.')[1], 'base64url').toString());
  console.log('apiToken claims:', c, c.exp ? `expires ${new Date(c.exp * 1000).toISOString()}` : '');
} catch { console.log('apiToken is opaque (not a JWT)'); }

writeFileSync(new URL('../.env.txline', import.meta.url),
  `TXLINE_JWT=${jwt}\nTXLINE_API_TOKEN=${apiToken}\nTXLINE_SUBSCRIBE_TX=${txSig}\nTXLINE_SERVICE_LEVEL=${chosen}\n`);
console.log('credentials written to .env.txline');

// 6. smoke test: World Cup fixtures (competition 72 per official example)
const snap = await fetch(`${BASE}/fixtures/snapshot?competitionId=72`, {
  headers: { authorization: `Bearer ${jwt}`, 'x-api-token': apiToken },
});
const body = await snap.text();
console.log('fixtures/snapshot?competitionId=72 →', snap.status, `${body.length} bytes`);
writeFileSync(new URL('../captures/fixtures-snapshot.json', import.meta.url), body);
if (snap.ok) {
  const fx = JSON.parse(body);
  const arr = Array.isArray(fx) ? fx : fx.fixtures ?? [];
  console.log('fixtures returned:', arr.length);
  console.log('sample:', JSON.stringify(arr[0])?.slice(0, 400));
}
