import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { PROVER_URLS, SEPOLIA_CHAIN_KEY, SEPOLIA_BLOCK_SECONDS } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CREDITCOIN_RPC = process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";

/**
 * Resolve a Sepolia payment into an Attestcoin inclusion proof.
 *
 * Stateless by design: attestation progress lives on-chain and in the prover's cache, so the client
 * can simply poll this route. No database, no job queue.
 *
 * Readiness is decided by actually attempting `getProof`, NOT by the on-chain attested height. The
 * SDK notes the prover serves from its own cache and lags on-chain finalization (it even applies a
 * default 15s `extraDelayMs`), so the chain can report a height as attested before a proof for it
 * can be served. The on-chain height is used only to show honest progress while waiting.
 */
export async function POST(req: Request) {
  let txHash: string;
  try {
    ({ txHash } = await req.json());
  } catch {
    return NextResponse.json({ status: "error", error: "Malformed JSON body" }, { status: 400 });
  }

  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ status: "error", error: "Invalid transaction hash" }, { status: 400 });
  }

  try {
    const sepolia = new JsonRpcProvider(SEPOLIA_RPC, undefined, { staticNetwork: true });
    const receipt = await sepolia.getTransactionReceipt(txHash);

    if (!receipt) {
      return NextResponse.json({
        status: "pending",
        phase: "unconfirmed",
        message: "Waiting for the payment to be mined on Sepolia.",
      });
    }
    if (receipt.status !== 1) {
      // Attestcoin would still prove inclusion; VouchCore would reject it. Fail early and clearly.
      return NextResponse.json(
        { status: "error", error: "That Sepolia transaction reverted, so it cannot earn stars." },
        { status: 422 },
      );
    }

    const targetHeight = receipt.blockNumber;

    // Progress only -- see the note above about why this does not gate readiness.
    let attestedHeight = 0;
    try {
      const creditcoin = new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true });
      const info = new chainInfo.PrecompileChainInfoProvider(creditcoin);
      const latest = await info.getLatestAttestedHeightAndHash(SEPOLIA_CHAIN_KEY);
      attestedHeight = Number(latest?.height ?? 0);
    } catch {
      // Non-fatal: we can still try the prover.
    }

    const blocksRemaining = attestedHeight > 0 ? Math.max(0, targetHeight - attestedHeight) : null;

    // Try each prover host; the documented one first.
    let lastError = "";
    for (const url of PROVER_URLS) {
      try {
        const builder = new proofProvider.service.ProofBuilder(SEPOLIA_CHAIN_KEY, url, 20000);
        const result = await builder.getProof(txHash);
        if (result?.success && result.data) {
          const d = result.data;
          return NextResponse.json({
            status: "ready",
            proof: {
              chainKey: Number(d.chainKey),
              height: Number(d.headerNumber),
              txIndex: Number(d.txIndex),
              txHash: d.txHash,
              txBytes: d.txBytes,
              merkleProof: d.merkleProof,
              continuityProof: d.continuityProof,
            },
            prover: url,
          });
        }
        lastError = result?.error ?? "prover returned no proof";
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    return NextResponse.json({
      status: "pending",
      phase: "attesting",
      targetHeight,
      attestedHeight,
      blocksRemaining,
      etaSeconds: blocksRemaining === null ? null : blocksRemaining * SEPOLIA_BLOCK_SECONDS,
      message:
        blocksRemaining === null
          ? "Waiting for Attestcoin to attest this block."
          : blocksRemaining > 0
            ? `Attestcoin is ${blocksRemaining} block${blocksRemaining === 1 ? "" : "s"} behind this payment.`
            : "Block attested; the prover is still preparing the proof.",
      detail: lastError,
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", error: e instanceof Error ? e.message : "Proof lookup failed" },
      { status: 500 },
    );
  }
}
