"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { isDeployed } from "@/lib/addresses";
import { sepoliaTxUrl } from "@/lib/chains";
import { usd, ctc, midHash, shortAddr, timeAgo } from "@/lib/format";
import { useReceipts, useCommerces, useAllItems } from "@/lib/useVouch";
import { useProvenance } from "@/lib/provenance";
import { loadPending, type Pending } from "@/lib/pending";
import { PendingRow } from "@/components/PendingRow";
import { ClaimAllBar } from "@/components/ClaimAllBar";
import { ReceiptModal } from "@/components/ReceiptModal";
import { Icon } from "@/components/Icon";

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { receipts, refetch } = useReceipts(address);
  const { commerces } = useCommerces();
  const { items } = useAllItems(commerces);
  const [pending, setPending] = useState<Pending[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Receipts store an itemId; the human-readable name lives in the catalog.
  const itemNames = new Map(items.map((i) => [i.id.toString(), i.name]));
  const merchantNames = new Map(commerces.map((c) => [c.id.toString(), c.name]));

  // Neither tx hash is on the receipt — both are derived. See lib/provenance.ts.
  const { provenance } = useProvenance(receipts, address);

  const refresh = () => setPending(loadPending(address));
  useEffect(refresh, [address]);

  const open = useMemo(
    () => receipts.find((r) => r.id.toString() === openId),
    [receipts, openId],
  );

  const nameOf = (r: (typeof receipts)[number]) =>
    itemNames.get(r.v.itemId.toString()) ?? `Receipt #${r.id.toString()}`;

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Activity</h1>
      <div className="sub">
        Every payment you make, and whether Attestcoin has proven it to Creditcoin yet. Open any
        verified row for the Sepolia transaction that paid, the proof that carried it, and the
        Creditcoin transaction that recorded it.
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
            {pending.length >= 2 && (
              <ClaimAllBar
                pendings={pending}
                onDone={() => {
                  refresh();
                  refetch();
                }}
              />
            )}
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
                <th>Sepolia payment</th>
                <th>Proven at</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => {
                const { id, v } = r;
                const prov = provenance.get(id.toString());
                const cashback = v.cashbackEarned + v.appCashbackEarned;
                return (
                  <tr
                    key={id.toString()}
                    className="clickable"
                    tabIndex={0}
                    role="button"
                    onClick={() => setOpenId(id.toString())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenId(id.toString());
                      }
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: 590 }}>{nameOf(r)}</div>
                      <div className="tiny dim">
                        #{id.toString()} · {merchantNames.get(v.commerceId.toString()) ?? shortAddr(v.commercePayout)}
                        {" · "}
                        {timeAgo(Number(v.timestamp))}
                      </div>
                    </td>
                    <td style={{ fontWeight: 570 }}>{usd(v.amount)}</td>
                    <td>
                      <span className="stars-earn">
                        <Icon name="star" size={14} /> +{v.starsEarned.toString()}
                      </span>
                      {cashback > 0n && (
                        <span className="ctc-earn" style={{ marginLeft: 10 }}>
                          <Icon name="coins" size={14} /> {ctc(cashback)} CTC
                        </span>
                      )}
                    </td>
                    <td className="tiny mono">
                      {prov?.sourceTxHash ? (
                        <a
                          className="rc-link"
                          href={sepoliaTxUrl(prov.sourceTxHash)}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {midHash(prov.sourceTxHash)}
                        </a>
                      ) : (
                        <span className="dim">resolving…</span>
                      )}
                      <div className="tiny dim">
                        block {v.sourceHeight.toString()} · idx {v.sourceTxIndex.toString()}
                      </div>
                    </td>
                    <td className="tiny mono">
                      {prov?.verifyTxHash ? (
                        <>
                          <span>{midHash(prov.verifyTxHash)}</span>
                          <div className="tiny dim">
                            CC block {prov.verifyBlock?.toString() ?? "—"}
                          </div>
                        </>
                      ) : (
                        <span className="dim">resolving…</span>
                      )}
                    </td>
                    <td>
                      <span className="pill ok">
                        <i className="dot" /> Attestcoin Verified
                      </span>
                      <div className="tiny dim" style={{ marginTop: 4 }}>Level {v.levelAfter} after</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="tiny dim" style={{ marginTop: 16, maxWidth: "80ch" }}>
        A receipt exists only because the Creditcoin block-prover precompile accepted an inclusion
        proof for the Sepolia transaction, and the transaction&apos;s own receipt status was success.
      </div>

      {open && (
        <ReceiptModal
          receiptId={open.id}
          receipt={open.v}
          itemName={nameOf(open)}
          merchantName={merchantNames.get(open.v.commerceId.toString())}
          provenance={provenance.get(open.id.toString())}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
