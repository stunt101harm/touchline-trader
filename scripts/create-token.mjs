// Create the TT-COIN devnet SPL token: mint + treasury ATA + initial supply.
// Run: node --env-file=.env scripts/create-token.mjs
import { Connection, Keypair } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import bs58 from 'bs58';
import { appendFileSync } from 'node:fs';

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.DEVNET_WALLET_SECRET));
const conn = new Connection(process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com', 'confirmed');

console.log('authority:', wallet.publicKey.toBase58());
const mint = await createMint(conn, wallet, wallet.publicKey, null, 0); // 0 decimals — whole coins
console.log('mint:', mint.toBase58());

const treasury = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, wallet.publicKey);
console.log('treasury ATA:', treasury.address.toBase58());

const sig = await mintTo(conn, wallet, mint, treasury.address, wallet, 100_000_000n); // 100M supply
console.log('minted 100,000,000 TT →', sig);

appendFileSync(new URL('../.env.txline', import.meta.url),
  `TT_MINT=${mint.toBase58()}\nTT_TREASURY=${treasury.address.toBase58()}\n`);
console.log('saved TT_MINT / TT_TREASURY to .env.txline');
