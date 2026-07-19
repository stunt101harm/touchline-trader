// Minimal Phantom-style wallet integration — optional, zero gameplay friction.
// Connect once → claim TT coins on-chain; winnings pay out automatically on settle.

export interface WalletState {
  pubkey: string | null;
  claimed: { amount: number; tx: string } | null;
}

function provider(): any | null {
  const w = window as any;
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana) return w.solana;
  if (w.braveSolana) return w.braveSolana; // Brave's built-in wallet injects here, not at window.solana
  if (w.backpack?.isBackpack) return w.backpack;
  if (w.solflare?.isSolflare) return w.solflare;
  return null;
}

export function hasWallet(): boolean {
  return provider() != null;
}

export async function connectWallet(): Promise<string> {
  const p = provider();
  if (!p) throw new Error('no-wallet');
  const res = await p.connect();
  const pubkey = (res?.publicKey ?? p.publicKey)?.toString();
  if (!pubkey) throw new Error('connect-failed');
  localStorage.setItem('tt-wallet', pubkey);
  return pubkey;
}

export function savedWallet(): string | null {
  return localStorage.getItem('tt-wallet');
}

export function disconnectWallet() {
  localStorage.removeItem('tt-wallet');
  try { provider()?.disconnect?.(); } catch { /* ignore */ }
}

export async function claimTT(wallet: string): Promise<{ amount: number; tx: string; alreadyClaimed?: boolean }> {
  const r = await fetch('/api/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet }),
  });
  const body = await r.json() as any;
  if (!r.ok) throw new Error(body.error ?? 'claim failed');
  return body;
}

export async function payoutTT(wallet: string, fixtureId: number, pnl: number): Promise<{ amount: number; tx?: string } | null> {
  try {
    const r = await fetch('/api/payout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet, fixtureId, pnl }),
    });
    if (!r.ok) return null;
    return await r.json() as any;
  } catch { return null; }
}

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
export const short = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`;
