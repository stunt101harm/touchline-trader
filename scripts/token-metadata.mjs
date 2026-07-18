// Attach Metaplex metadata to the TT mint so wallets show "Touchline Coin" + logo.
// Run: node --env-file=.env --env-file=.env.txline scripts/token-metadata.mjs
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, percentAmount, some } from '@metaplex-foundation/umi';
import { createV1, TokenStandard, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import bs58 from 'bs58';

const RPC = 'https://devnet.helius-rpc.com/?api-key=dbed00f7-8841-431a-a6f2-f97890284f88';
const MINT = process.env.TT_MINT ?? '2j4xmGZShVpA6Ju7fjQrX5PxvtW1Y259EjEdrpNhd4r8';

const umi = createUmi(RPC).use(mplTokenMetadata());
const kp = umi.eddsa.createKeypairFromSecretKey(bs58.decode(process.env.DEVNET_WALLET_SECRET));
umi.use(keypairIdentity(kp));

console.log('authority:', kp.publicKey);
const res = await createV1(umi, {
  mint: publicKey(MINT),
  name: 'Touchline Coin',
  symbol: 'TT',
  uri: 'https://touchline-trader.h-dhaliwal2250.workers.dev/token/tt.json',
  sellerFeeBasisPoints: percentAmount(0),
  decimals: some(0),
  tokenStandard: TokenStandard.Fungible,
}).sendAndConfirm(umi);

console.log('metadata created:', bs58.encode(res.signature));
console.log('solscan:', `https://solscan.io/token/${MINT}?cluster=devnet`);
