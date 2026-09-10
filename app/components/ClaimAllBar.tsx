"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { VouchCoreAbi } from "@/lib/abis";
import { addresses } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { countdown } from "@/lib/format";
import { removePending, type Pending } from "@/lib/pending";
import { useEnsureChain } from "@/lib/useChain";

type State =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "waiting"; message: string; etaSeconds: number | null }
  | { kind: "error"; error: string };

/// One click to prove and claim every pending Sepolia payment together. The batch shares a
/// single Attestcoin continuity proof, so it is cheaper than claiming row by row. All-or-nothing:
/// if any payment is not provable yet, nothing is submitted and the rows stay claimable alone.
export function ClaimAllBar({ pendings, onDone }: { pendings: Pending[]; onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function claimAll() {
    if (!address || pendings.length === 0) return;
    setState({ kind: "working", label: "Proving payments…" });
    try {
      const r = await fetch("/api/proof/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHashes: pendings.map((p) => p.txHash), waitMs: 15000 }),
      });
      const d = await r.json();

      if (d.status !== "ready") {
        if (d.status === "pending") {
          setState({
            kind: "waiting",
            message: d.message ?? "Attestcoin is still attesting these payments.",
            etaSeconds: d.etaSeconds ?? null,
          });
        } else {
          setState({ kind: "error", error: d.error ?? "Batch proof failed" });
        }
        return;
      }

      setState({ kind: "working", label: "Claiming rewards…" });
      const byHash = new Map(pendings.map((p) => [p.txHash.toLowerCase(), p]));
      const n = d.items.length;
      const hash = await ensure(creditcoinTestnet.id, () => writeContractAsync({
        address: addresses.VouchCore,
        abi: VouchCoreAbi,
        functionName: "recordPurchasesBatch",
        chainId: creditcoinTestnet.id,
        args: [
          d.items.map((it: any) => BigInt(it.height)),
          d.items.map((it: any) => it.txBytes as `0x${string}`),
          d.items.map((it: any) => ({
            root: it.merkleProof.root as `0x${string}`,
            siblings: it.merkleProof.siblings.map((s: any) => ({
              hash: s.hash as `0x${string}`,
              isLeft: s.isLeft,
            })),
          })),
          {
            lowerEndpointDigest: d.continuityProof.lowerEndpointDigest as `0x${string}`,
            roots: d.continuityProof.roots as `0x${string}`[],
          },
          d.items.map((it: any) => BigInt(byHash.get(String(it.txHash).toLowerCase())?.itemId ?? "0")),
          d.items.map((it: any) =>
            (byHash.get(String(it.txHash).toLowerCase())?.questIds ?? []).map((q) => BigInt(q)),
          ),
        ],
        // Estimates run low on this chain and an under-estimate burns the whole limit.
        gas: 3_000_000n + 2_000_000n * BigInt(Math.max(0, n - 1)),
      }));
      await publicClient?.waitForTransactionReceipt({ hash });
      if (address) for (const p of pendings) removePending(address, p.txHash);
      setState({ kind: "idle" });
      onDone();
    } catch (e: any) {
      setState({ kind: "error", error: e?.shortMessage ?? e?.message ?? "Claim-all failed" });
    }
  }

  const busy = state.kind === "working";

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="between">
        <div>
          <span style={{ fontWeight: 590 }}>Claim all at once</span>{" "}
          <span className="muted small">
            {pendings.length} pending · one shared Attestcoin proof
          </span>
          <div className="tiny dim" style={{ marginTop: 3 }}>
            {state.kind === "idle" && "Cheaper than claiming row by row. Skips nothing — any payment not ready yet stays listed below."}
            {state.kind === "working" && state.label}
            {state.kind === "waiting" && (
              <>
                {state.message}{" "}
                {state.etaSeconds !== null && state.etaSeconds > 0 && (
                  <strong>{countdown(state.etaSeconds)}</strong>
                )}
              </>
            )}
            {state.kind === "error" && state.error}
          </div>
        </div>
        <button disabled={busy || !address} onClick={claimAll}>
          {busy ? "Working…" : `Claim all (${pendings.length})`}
        </button>
      </div>
    </div>
  );
}
