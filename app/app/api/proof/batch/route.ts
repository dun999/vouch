import { NextResponse } from "next/server";
import { proofProvider } from "@gluwa/usc-sdk";
import { PROVER_URLS, SEPOLIA_BLOCK_SECONDS } from "@/lib/chains";
import { getAttestedHeight, getSepoliaReceipts, resolveSepoliaChainKey, waitForAttestation } from "../attest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 10;
/// Attestcoin serves one batch continuity proof per 1000-block window.
const MAX_BATCH_RANGE = 1000;

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Resolve several Sepolia payments into one Attestcoin batch proof (shared continuity proof)
 * for `VouchCore.recordPurchasesBatch`. All-or-nothing by design, mirroring the contract:
 * every hash must be mined, successful, and provable, otherwise the route reports `pending`
 * (or a 422 for reverted/out-of-range batches) and the client keeps the individual claims.
 *
 * Optional `waitMs` waits for the highest block first (capped at 25s). A wait timeout is not
 * an error: the route falls through to its normal pending response with per-payment progress.
 */
export async function POST(req: Request) {
  let txHashes: string[];
  let waitMs = 0;
  try {
    ({ txHashes, waitMs = 0 } = await req.json());
  } catch {
    return NextResponse.json({ status: "error", error: "Malformed JSON body" }, { status: 400 });
  }

  if (!Array.isArray(txHashes) || txHashes.length === 0 || txHashes.length > MAX_BATCH) {
    return NextResponse.json(
      { status: "error", error: `Send 1 to ${MAX_BATCH} transaction hashes.` },
      { status: 400 },
    );
  }
  if (txHashes.some((h) => typeof h !== "string" || !HASH_RE.test(h))) {
    return NextResponse.json({ status: "error", error: "Invalid transaction hash in batch." }, { status: 400 });
  }
  const lowered = txHashes.map((h) => h.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    return NextResponse.json({ status: "error", error: "Duplicate transaction hash in batch." }, { status: 400 });
  }

  try {
    const receipts = await getSepoliaReceipts(lowered);

    const chainKey = await resolveSepoliaChainKey();
    const attestedHeight = await getAttestedHeight(chainKey);

    const items = lowered.map((h, i) => {
      const r = receipts[i];
      const targetHeight = r?.blockNumber ?? null;
      const blocksRemaining =
        targetHeight !== null && attestedHeight > 0 ? Math.max(0, targetHeight - attestedHeight) : null;
      return {
        txHash: txHashes[i],
        mined: !!r,
        reverted: !!r && r.status !== 1,
        targetHeight,
        blocksRemaining,
        etaSeconds: blocksRemaining === null ? null : blocksRemaining * SEPOLIA_BLOCK_SECONDS,
      };
    });

    const reverted = items.filter((it) => it.reverted);
    if (reverted.length > 0) {
      // Attestcoin would still prove inclusion; VouchCore would reject the batch. Fail early.
      return NextResponse.json(
        {
          status: "error",
          error: "One payment in this batch reverted on Sepolia, so the batch cannot earn stars. Claim the others individually.",
          reverted: reverted.map((it) => it.txHash),
        },
        { status: 422 },
      );
    }

    const unconfirmed = items.filter((it) => !it.mined);
    if (unconfirmed.length > 0) {
      return NextResponse.json({
        status: "pending",
        phase: "unconfirmed",
        chainKey,
        message: `${unconfirmed.length} payment${unconfirmed.length === 1 ? " is" : "s are"} still waiting to be mined on Sepolia.`,
        items,
      });
    }

    const heights = items.map((it) => it.targetHeight as number);
    if (Math.max(...heights) - Math.min(...heights) > MAX_BATCH_RANGE) {
      return NextResponse.json(
        {
          status: "error",
          error: `This batch spans more than ${MAX_BATCH_RANGE} Sepolia blocks, so it cannot share one continuity proof. Claim these payments individually.`,
        },
        { status: 422 },
      );
    }

    // Live waiter: optionally block until the prover has ingested the highest block.
    const { waited } = await waitForAttestation(chainKey, Math.max(...heights), waitMs);

    let lastError = "";
    for (const url of PROVER_URLS) {
      try {
        const builder = new proofProvider.service.ProofBuilder(chainKey, url, 30000);
        const result = await builder.getBatchProof(lowered);
        if (result?.success && result.data) {
          const d = result.data;
          const byHash = new Map<string, { height: number; txBytes: string; merkleProof: unknown }>();
          for (const [header, perIndex] of d.merkleProofs as Map<number, Map<number, { txHash: string; txBytes: string; merkleProof: unknown }>>) {
            for (const [, entry] of perIndex) {
              byHash.set(entry.txHash.toLowerCase(), {
                height: Number(header),
                txBytes: entry.txBytes,
                merkleProof: entry.merkleProof,
              });
            }
          }
          const missing = lowered.filter((h) => !byHash.has(h));
          if (missing.length > 0) {
            lastError = `prover omitted ${missing.length} transaction${missing.length === 1 ? "" : "s"}`;
            continue;
          }
          return NextResponse.json({
            status: "ready",
            chainKey: Number(d.chainKey),
            waited,
            continuityProof: d.continuityProof,
            items: lowered.map((h) => ({ txHash: h, ...byHash.get(h)! })),
            prover: url,
          });
        }
        lastError = result?.error ?? "prover returned no batch proof";
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    const maxRemaining = Math.max(...items.map((it) => it.blocksRemaining ?? 0));
    return NextResponse.json({
      status: "pending",
      phase: "attesting",
      chainKey,
      waited,
      attestedHeight,
      items,
      etaSeconds: maxRemaining * SEPOLIA_BLOCK_SECONDS,
      message:
        maxRemaining > 0
          ? `Attestcoin is still attesting these payments (${maxRemaining} block${maxRemaining === 1 ? "" : "s"} behind the latest).`
          : "Blocks attested; the prover is still preparing the batch proof.",
      detail: lastError,
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", error: e instanceof Error ? e.message : "Batch proof lookup failed" },
      { status: 500 },
    );
  }
}
