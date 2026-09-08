"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { isDeployed } from "@/lib/addresses";
import { usd, ctc, shortAddr, timeAgo } from "@/lib/format";
import { useReceipts, useCommerces, useAllItems } from "@/lib/useVouch";
import { loadPending, type Pending } from "@/lib/pending";
import { PendingRow } from "@/components/PendingRow";

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { receipts, refetch } = useReceipts(address);
  const { commerces } = useCommerces();
  const { items } = useAllItems(commerces);
  const [pending, setPending] = useState<Pending[]>([]);

  // Receipts store an itemId; the human-readable name lives in the catalog.
  const itemNames = new Map(items.map((i) => [i.id.toString(), i.name]));

  const refresh = () => setPending(loadPending(address));
  useEffect(refresh, [address]);

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Activity</h1>
      <div className="sub">
        Every payment you make, and whether Attestcoin has proven it to Creditcoin yet.
      </div>

      {!isConnected && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          Connect a wallet to see your activity.
        </div>
      )}

      {pending.length > 0 && (
        <>
          <div className="between" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Awaiting verification</h2>
            <span className="pill wait">
              <i className="dot" /> Attestcoin trails Sepolia by ~9 min
            </span>
          </div>
          <div className="grid" style={{ gap: 12, marginBottom: 34 }}>
            {pending.map((p) => (
              <PendingRow
                key={p.txHash}
                p={p}
                onDone={() => {
                  refresh();
                  refetch();
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className="section-h">
        <h2>Verified transactions</h2>
        <span className="tiny dim">{receipts.length} on Creditcoin</span>
      </div>
      <div className="card pad0 scroll-x">
        {receipts.length === 0 ? (
          <div className="empty">
            {isConnected
              ? "No verified purchases yet. Spend at a merchant to get started."
              : "Nothing to show."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Bought</th>
                <th>Amount</th>
                <th>Earned</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(({ id, v }) => (
                <tr key={id.toString()}>
                  <td>
                    <div style={{ fontWeight: 590 }}>
                      {itemNames.get(v.itemId.toString()) ?? `Receipt #${id.toString()}`}
                    </div>
                    <div className="tiny dim">#{id.toString()} · {timeAgo(Number(v.timestamp))}</div>
                  </td>
                  <td style={{ fontWeight: 570 }}>{usd(v.amount)}</td>
                  <td>
                    <span className="pill acc">+{v.starsEarned.toString()} stars</span>
                    {v.cashbackEarned > 0n && (
                      <span className="pill ok" style={{ marginLeft: 5 }}>
                        {ctc(v.cashbackEarned)} CTC
                      </span>
                    )}
                  </td>
                  <td className="tiny dim mono">
                    block {v.sourceHeight.toString()} · idx {v.sourceTxIndex.toString()}
                    <div>{shortAddr(v.commercePayout)}</div>
                  </td>
                  <td>
                    <span className="pill ok">
                      <i className="dot" /> Attestcoin Verified
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="tiny dim" style={{ marginTop: 16, maxWidth: "80ch" }}>
        A receipt exists only because the Creditcoin block-prover precompile accepted an inclusion
        proof for the Sepolia transaction, and the transaction's own receipt status was success.
      </div>
    </>
  );
}
