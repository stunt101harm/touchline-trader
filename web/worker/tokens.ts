// Devnet SPL token grants: one-time claim airdrops and per-match winnings payouts.
// Gameplay stays off-chain for instant UX; the coin economy settles on-chain.
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

export const TT_MINT = new PublicKey('2j4xmGZShVpA6Ju7fjQrX5PxvtW1Y259EjEdrpNhd4r8');


export const CLAIM_AMOUNT = 1000;
export const MAX_PAYOUT = 5000;

/** Transfer `amount` TT (0-decimals) from the treasury to `recipient`, creating their ATA if needed. */
export async function sendTT(secret: string, recipient: string, amount: number, rpc?: string): Promise<string> {
  const authority = Keypair.fromSecretKey(bs58.decode(secret));
  const conn = new Connection(rpc ?? 'https://api.devnet.solana.com', {
    commitment: 'confirmed',
    // public devnet RPC 403s requests without a browser-like UA (workerd sends none)
    httpHeaders: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
  });
  const to = new PublicKey(recipient);
  const fromAta = getAssociatedTokenAddressSync(TT_MINT, authority.publicKey);
  const toAta = getAssociatedTokenAddressSync(TT_MINT, to);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, toAta, to, TT_MINT),
    createTransferInstruction(fromAta, toAta, authority.publicKey, BigInt(amount)),
  );
  const bh = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);
  const sig = await conn.sendRawTransaction(tx.serialize());
  // Patient status polling — blockhash-expiry confirmTransaction gives up while the
  // tx still lands on congested devnet. If unresolved after ~24s, return the sig
  // optimistically: the caller's grant row already locks against double-sends.
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return sig;
  }
  return sig;
}

export function isValidPubkey(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  try { new PublicKey(s); return true; } catch { return false; }
}
