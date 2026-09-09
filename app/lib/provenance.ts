"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem, type Address, type Hash } from "viem";
import { addresses } from "./addresses";
import { CC_LOGS_RPC, creditcoinTestnet, sepolia } from "./chains";

/// A receipt records *where* the payment was, not *which* transaction it was: VouchCore stores
/// (sourceHeight, sourceTxIndex) because that is the only pair the block-prover precompile can
/// attest to. Both hashes a customer would actually want to click are therefore derived:
///
///   - the Sepolia payment hash is `block(sourceHeight).transactions[sourceTxIndex]`, which is
///     the same lookup the precompile's Merkle proof is built over;
///   - the Creditcoin verification hash is the transaction that emitted `PurchaseVerified` for
///     this receipt id.
///
/// Nothing here is remembered client-side, so a receipt claimed on another device still resolves.
export type Provenance = {
  /// The Sepolia transaction the customer signed to pay the merchant.
  sourceTxHash?: Hash;
  /// The Creditcoin transaction that submitted the proof and minted the receipt.
  verifyTxHash?: Hash;
  verifyBlock?: bigint;
  verifiedAt?: number;
};

const PURCHASE_VERIFIED = parseAbiItem(
  "event PurchaseVerified(uint256 indexed receiptId, address indexed user, uint256 indexed commerceId, uint256 amount, uint64 sourceHeight, uint64 sourceTxIndex, uint256 starsEarned, uint256 cashbackEarned, uint32 levelAfter)",
);

const ccLogs = createPublicClient({
  chain: creditcoinTestnet,
  transport: http(CC_LOGS_RPC, { timeout: 20_000 }),
});

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(undefined, { timeout: 20_000 }),
});

/// Sepolia blocks and Creditcoin logs are both immutable once seen, so they are cached for the
/// life of the tab rather than refetched on every render of the Activity table.
const blockTxCache = new Map<string, readonly Hash[]>();
const verifyCache = new Map<string, Provenance>();

async function sepoliaTxAt(height: bigint, index: bigint): Promise<Hash | undefined> {
  const key = height.toString();
  let txs = blockTxCache.get(key);
  if (!txs) {
    const block = await sepoliaClient.getBlock({ blockNumber: height });
    txs = block.transactions as readonly Hash[];
    blockTxCache.set(key, txs);
  }
  return txs[Number(index)];
}

async function loadVerifications(user: Address): Promise<Map<string, Provenance>> {
  const logs = await ccLogs.getLogs({
    address: addresses.VouchCore,
    event: PURCHASE_VERIFIED,
    args: { user },
    fromBlock: 0n,
    toBlock: "latest",
  });

  const out = new Map<string, Provenance>();
  for (const log of logs) {
    const id = log.args.receiptId?.toString();
    if (!id || !log.transactionHash) continue;
    out.set(id, { verifyTxHash: log.transactionHash, verifyBlock: log.blockNumber ?? undefined });
  }
  return out;
}

/// Resolves provenance for every receipt in one pass. Sepolia lookups are keyed by block, so a
/// day of purchases from the same block costs one request.
export function useProvenance(
  receipts: Array<{ id: bigint; v: { sourceHeight: bigint; sourceTxIndex: bigint } }>,
  user?: Address,
) {
  const [map, setMap] = useState<Map<string, Provenance>>(new Map());
  const [error, setError] = useState("");

  // The set of receipts, as a value, so the effect re-runs when a new one lands and not on every
  // poll that returns the same list.
  const fingerprint = receipts
    .map((r) => `${r.id}:${r.v.sourceHeight}:${r.v.sourceTxIndex}`)
    .join(",");

  useEffect(() => {
    if (!user || receipts.length === 0) {
      setMap(new Map());
      return;
    }
    let live = true;

    (async () => {
      const next = new Map<string, Provenance>();
      const unresolved = receipts.filter((r) => !verifyCache.has(`${user}:${r.id}`));

      if (unresolved.length > 0) {
        try {
          const found = await loadVerifications(user);
          for (const [id, p] of found) verifyCache.set(`${user}:${id}`, p);
        } catch (e) {
          // A missing Creditcoin hash degrades one column; it must not blank the whole table.
          if (live) setError(e instanceof Error ? e.message : "Verification lookup failed");
        }
      }

      for (const r of receipts) {
        next.set(r.id.toString(), { ...verifyCache.get(`${user}:${r.id}`) });
      }

      await Promise.all(
        receipts.map(async (r) => {
          try {
            const hash = await sepoliaTxAt(r.v.sourceHeight, r.v.sourceTxIndex);
            const entry = next.get(r.id.toString());
            if (entry) entry.sourceTxHash = hash;
          } catch {
            /* the row still shows height/index, which is what the proof actually covers */
          }
        }),
      );

      if (live) setMap(next);
    })();

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, user]);

  return { provenance: map, error };
}

export type SourceTxDetail = {
  status: "success" | "reverted";
  from: Address;
  to: Address | null;
  gasUsed: bigint;
  feeWei: bigint;
  blockTimestamp: number;
  nonce: number;
};

/// The Sepolia side of the story, fetched only when a receipt is actually opened. This is the
/// data the precompile checked: the transaction had to be in that block *and* have succeeded.
export function useSourceTx(hash?: Hash) {
  const [detail, setDetail] = useState<SourceTxDetail>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hash) return;
    let live = true;
    setDetail(undefined);
    setError("");

    (async () => {
      try {
        const [tx, receipt] = await Promise.all([
          sepoliaClient.getTransaction({ hash }),
          sepoliaClient.getTransactionReceipt({ hash }),
        ]);
        const block = await sepoliaClient.getBlock({ blockNumber: receipt.blockNumber });
        if (!live) return;
        setDetail({
          status: receipt.status,
          from: receipt.from,
          to: receipt.to,
          gasUsed: receipt.gasUsed,
          feeWei: receipt.gasUsed * receipt.effectiveGasPrice,
          blockTimestamp: Number(block.timestamp),
          nonce: tx.nonce,
        });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not read the Sepolia transaction");
      }
    })();

    return () => {
      live = false;
    };
  }, [hash]);

  return { detail, error };
}
