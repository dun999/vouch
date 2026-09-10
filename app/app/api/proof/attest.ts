import { JsonRpcProvider } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { PROVER_URLS, SEPOLIA_CHAIN_KEY, sepolia } from "@/lib/chains";

const CREDITCOIN_RPC =
  process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

/// Sepolia receipts with one retry: the public RPC intermittently answers `null` (or errors)
/// for long-mined transactions, which otherwise surfaces as a bogus "waiting to be mined".
export async function getSepoliaReceipts(txHashes: string[]) {
  const rpc = new JsonRpcProvider(SEPOLIA_RPC, undefined, { staticNetwork: true });
  const receipts = await Promise.all(
    txHashes.map((h) => rpc.getTransactionReceipt(h).catch(() => null)),
  );
  const missing = receipts.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  if (missing.length > 0) {
    await new Promise((res) => setTimeout(res, 2000));
    await Promise.all(
      missing.map(async (i) => {
        try {
          receipts[i] = await rpc.getTransactionReceipt(txHashes[i]);
        } catch {
          // Stays null; the caller reports unconfirmed and the client retries.
        }
      }),
    );
  }
  return receipts;
}

/// The SDK's own doc comments show chainKey 1 as Ethereum mainnet, but live
/// `get_supported_chains()` on CC3 testnet reports key 1 as Sepolia. Resolve the key for
/// Sepolia's chainId at runtime so a re-keying does not silently prove the wrong chain.
let cachedKey: { key: number; at: number } | null = null;
const KEY_TTL_MS = 5 * 60_000;

export async function resolveSepoliaChainKey(): Promise<number> {
  if (cachedKey && Date.now() - cachedKey.at < KEY_TTL_MS) return cachedKey.key;
  try {
    const creditcoin = new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true });
    const info = new chainInfo.PrecompileChainInfoProvider(creditcoin);
    const chains = await info.getSupportedChains();
    const found = chains.find((c) => Number(c.chainId) === sepolia.id);
    if (found) {
      cachedKey = { key: Number(found.chainKey), at: Date.now() };
      return cachedKey.key;
    }
  } catch {
    // Non-fatal: fall through to the recorded default below.
  }
  return SEPOLIA_CHAIN_KEY;
}

/// Progress only — see the proof routes for why this never gates readiness.
export async function getAttestedHeight(chainKey: number): Promise<number> {
  try {
    const creditcoin = new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true });
    const info = new chainInfo.PrecompileChainInfoProvider(creditcoin);
    const latest = await info.getLatestAttestedHeightAndHash(chainKey);
    return Number(latest?.height ?? 0);
  } catch {
    return 0;
  }
}

/// Live waiter: block until the prover service has ingested the attestation for `targetHeight`,
/// so one request can ride out a short attestation gap instead of the client polling for it.
/// Bounded well under typical fetch timeouts; a timeout is not an error — the caller falls
/// through to its normal pending response.
export async function waitForAttestation(
  chainKey: number,
  targetHeight: number,
  waitMs?: number,
): Promise<{ waited: boolean; timedOut: boolean }> {
  if (!waitMs || waitMs <= 0) return { waited: false, timedOut: false };
  const timeout = Math.min(Math.floor(waitMs), 25_000);
  try {
    const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URLS[0], 20000);
    await builder.waitUntilHeightAttested(chainKey, targetHeight, 5000, timeout);
    return { waited: true, timedOut: false };
  } catch {
    return { waited: true, timedOut: true };
  }
}
