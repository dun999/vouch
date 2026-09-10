"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { VouchCoreAbi } from "@/lib/abis";
import { addresses } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { countdown, usd, shortAddr } from "@/lib/format";
import { removePending, type Pending } from "@/lib/pending";
import { useEnsureChain } from "@/lib/useChain";

type ProofState =
  | { status: "idle" }
  | { status: "pending"; message: string; etaSeconds: number | null; blocksRemaining: number | null }
  | { status: "ready"; proof: any }
  | { status: "error"; error: string };

/// Attestation trails Sepolia head by ~9 minutes, so a tight poll would be pure noise.
const POLL_MS = 20_000;

export function PendingRow({ p, onDone }: { p: Pending; onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();

  const [state, setState] = useState<ProofState>({ status: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Long-poll the prover's attestation cache so one request can ride out a short
        // attestation gap instead of this row polling for it.
        body: JSON.stringify({ txHash: p.txHash, waitMs: 15000 }),
      });
      const d = await r.json();
      if (d.status === "ready") setState({ status: "ready", proof: d.proof });
      else if (d.status === "pending")
        setState({
          status: "pending",
          message: d.message,
          etaSeconds: d.etaSeconds ?? null,
          blocksRemaining: d.blocksRemaining ?? null,
        });
      else setState({ status: "error", error: d.error ?? "Proof lookup failed" });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Network error" });
    }
  }, [p.txHash]);

  useEffect(() => {
    let live = true;
    const loop = async () => {
      if (!live) return;
      await poll();
      if (live) timer.current = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  useEffect(() => {
    if (state.status === "ready" && timer.current) clearTimeout(timer.current);
  }, [state.status]);

  async function claim() {
    if (state.status !== "ready" || !address) return;
    setClaiming(true);
    setClaimError("");
    try {
      const pf = state.proof;
      const hash = await ensure(creditcoinTestnet.id, () => writeContractAsync({
        address: addresses.VouchCore,
        abi: VouchCoreAbi,
        functionName: "recordPurchase",
        chainId: creditcoinTestnet.id,
        args: [
          BigInt(pf.height),
          pf.txBytes as `0x${string}`,
          {
            root: pf.merkleProof.root as `0x${string}`,
            siblings: pf.merkleProof.siblings.map((s: any) => ({
              hash: s.hash as `0x${string}`,
              isLeft: s.isLeft,
            })),
          },
          {
            lowerEndpointDigest: pf.continuityProof.lowerEndpointDigest as `0x${string}`,
            roots: pf.continuityProof.roots as `0x${string}`[],
          },
          BigInt(p.itemId ?? "0"),
          p.questIds.map((q) => BigInt(q)),
        ],
        // Estimates run low on this chain and an under-estimate burns the whole limit.
        gas: 3_000_000n,
      }));
      await publicClient?.waitForTransactionReceipt({ hash });
      if (address) removePending(address, p.txHash);
      onDone();
    } catch (e: any) {
      setClaimError(e?.shortMessage ?? e?.message ?? "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  const pct =
    state.status === "ready"
      ? 100
      : state.status === "pending" && state.blocksRemaining !== null
        ? Math.max(5, Math.min(96, 100 - (state.blocksRemaining / 45) * 100))
        : 6;

  return (
    <div className="card">
      <div className="between">
        <div>
          <span style={{ fontWeight: 590 }}>{p.itemName || p.commerceName}</span>{" "}
          <span className="muted small">· {usd(p.amountWei)}</span>
          {p.itemName && <div className="tiny dim">{p.commerceName}</div>}
        </div>
        {state.status === "ready" ? (
          <span className="pill ok"><i className="dot" /> Proof ready</span>
        ) : state.status === "error" ? (
          <span className="pill err">Error</span>
        ) : (
          <span className="pill wait"><i className="dot" /> Attesting</span>
        )}
      </div>

      <div className="tiny mono dim" style={{ margin: "6px 0 10px" }}>
        {shortAddr(p.txHash)} → {shortAddr(p.payout)}
      </div>

      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="small muted" style={{ marginTop: 7 }}>
        {state.status === "pending" && (
          <>
            {state.message}{" "}
            {state.etaSeconds !== null && <strong>{countdown(state.etaSeconds)}</strong>}
          </>
        )}
        {state.status === "idle" && "Checking Attestcoin…"}
        {state.status === "ready" && "Attestcoin has proven this payment. Claim it on Creditcoin."}
        {state.status === "error" && state.error}
      </div>

      {claimError && (
        <div className="banner err small" style={{ marginTop: 9 }}>
          {claimError}
        </div>
      )}

      <div className="row" style={{ marginTop: 11 }}>
        <button className="sm" disabled={state.status !== "ready" || claiming} onClick={claim}>
          {claiming ? "Claiming…" : "Claim reward"}
        </button>
        <button
          className="ghost sm"
          onClick={() => {
            if (address) removePending(address, p.txHash);
            onDone();
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
