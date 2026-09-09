"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import {
  BLOCK_PROVER_PRECOMPILE, SEPOLIA_CHAIN_KEY,
  ccAddressUrl, ccBlockUrl, ccTxUrl,
  sepoliaAddressUrl, sepoliaBlockUrl, sepoliaTxUrl,
} from "@/lib/chains";
import { addresses } from "@/lib/addresses";
import { ctc, fullTime, midHash, shortAddr, timeAgo, usd } from "@/lib/format";
import { useSourceTx, type Provenance } from "@/lib/provenance";
import type { Receipt } from "@/lib/useVouch";

/// One row of the dossier: a label, a monospace value, a copy button and a link out to whichever
/// explorer owns that chain. Everything a customer would need to reconcile the claim themselves.
function Field({
  label,
  value,
  display,
  href,
  hint,
  tone,
}: {
  label: string;
  value?: string;
  display?: string;
  href?: string;
  hint?: string;
  tone?: "ok" | "wait";
}) {
  const [copied, setCopied] = useState(false);
  const shown = display ?? value ?? "—";

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard is blocked in some embedded browsers; the value is still selectable */
    }
  }

  return (
    <div className="rc-field">
      <div className="rc-label">{label}</div>
      <div className="rc-value">
        {href ? (
          <a className="rc-link" href={href} target="_blank" rel="noreferrer noopener">
            <span className={tone ? `rc-mono rc-${tone}` : "rc-mono"}>{shown}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1.6 1.6 0 0 1-1.6 1.6H5.4A1.6 1.6 0 0 1 3.8 19V7.6A1.6 1.6 0 0 1 5.4 6h5" />
            </svg>
          </a>
        ) : (
          <span className={tone ? `rc-mono rc-${tone}` : "rc-mono"}>{shown}</span>
        )}
        {value && (
          <button className="rc-copy" onClick={copy} title={`Copy ${label.toLowerCase()}`}>
            {copied ? "copied" : "copy"}
          </button>
        )}
      </div>
      {hint && <div className="rc-hint">{hint}</div>}
    </div>
  );
}

/// The full story of one receipt, in the order it actually happened: paid on Sepolia, proven by
/// Attestcoin, recorded on Creditcoin. The three sections are the three chains.
export function ReceiptModal({
  receiptId,
  receipt,
  itemName,
  merchantName,
  provenance,
  onClose,
}: {
  receiptId: bigint;
  receipt: Receipt;
  itemName: string;
  merchantName?: string;
  provenance?: Provenance;
  onClose: () => void;
}) {
  const { detail, error } = useSourceTx(provenance?.sourceTxHash);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const totalCashback = receipt.cashbackEarned + receipt.appCashbackEarned;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h between">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 640, fontSize: 17 }}>{itemName}</div>
            <div className="tiny dim">
              Receipt #{receiptId.toString()}
              {merchantName ? ` · ${merchantName}` : ""} · {fullTime(Number(receipt.timestamp))}
            </div>
          </div>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="modal-b">
          <div className="rc-summary">
            <div>
              <div className="label">Paid</div>
              <div className="stat" style={{ fontSize: 26 }}>{usd(receipt.amount)}</div>
            </div>
            <div>
              <div className="label">Stars</div>
              <div className="stat" style={{ fontSize: 26 }}>+{receipt.starsEarned.toString()}</div>
            </div>
            <div>
              <div className="label">Cashback</div>
              <div className="stat" style={{ fontSize: 26, color: totalCashback > 0n ? "var(--green)" : undefined }}>
                {ctc(totalCashback)} <span style={{ fontSize: 14, fontWeight: 560 }}>CTC</span>
              </div>
            </div>
            <div>
              <div className="label">Level after</div>
              <div className="stat" style={{ fontSize: 26 }}>{receipt.levelAfter}</div>
            </div>
          </div>

          {/* ------------------------------------------------------- step 1 */}
          <div className="rc-step">
            <span className="rc-step-n done">1</span>
            <div className="rc-step-body">
              <div className="rc-step-h">
                <span>Paid on Ethereum Sepolia</span>
                {/* The precompile only accepts a successful source transaction, so a receipt
                    implies this — but it is read back from Sepolia rather than asserted. */}
                <span className={`pill ${detail?.status === "reverted" ? "err" : "ok"}`}>
                  <i className="dot" /> {detail ? (detail.status === "success" ? "Succeeded" : "Reverted") : "Checking…"}
                </span>
              </div>
              <div className="rc-step-sub">
                The transaction the customer signed. USDC moves here; nothing on Creditcoin can
                change it after the fact.
              </div>

              <div className="rc-fields">
                <Field
                  label="Transaction hash"
                  value={provenance?.sourceTxHash}
                  display={provenance?.sourceTxHash ? midHash(provenance.sourceTxHash) : "resolving from block…"}
                  href={provenance?.sourceTxHash ? sepoliaTxUrl(provenance.sourceTxHash) : undefined}
                  hint="Derived from the receipt's block height and transaction index — the exact pair the Merkle proof covers."
                />
                <div className="rc-pair">
                  <Field
                    label="Block"
                    value={receipt.sourceHeight.toString()}
                    href={sepoliaBlockUrl(receipt.sourceHeight)}
                  />
                  <Field label="Index in block" value={receipt.sourceTxIndex.toString()} />
                </div>
                <div className="rc-pair">
                  <Field
                    label="Payer"
                    value={receipt.user}
                    display={shortAddr(receipt.user)}
                    href={sepoliaAddressUrl(receipt.user)}
                  />
                  <Field
                    label="Merchant payout"
                    value={receipt.commercePayout}
                    display={shortAddr(receipt.commercePayout)}
                    href={sepoliaAddressUrl(receipt.commercePayout)}
                  />
                </div>
                <Field
                  label="Token contract"
                  value={addresses.PaymentToken}
                  display={shortAddr(addresses.PaymentToken)}
                  href={sepoliaAddressUrl(addresses.PaymentToken)}
                  hint="The payment is an ERC-20 Transfer log, not a native send — so the amount is decoded from the receipt logs."
                />
                {detail && (
                  <div className="rc-pair">
                    <Field label="Mined" value={fullTime(detail.blockTimestamp)} />
                    <Field
                      label="Gas paid"
                      value={`${detail.gasUsed.toString()} gas · ${Number(formatEther(detail.feeWei)).toFixed(6)} ETH`}
                    />
                  </div>
                )}
                {error && <div className="rc-hint">Sepolia detail unavailable: {error}</div>}
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------- step 2 */}
          <div className="rc-step">
            <span className="rc-step-n done">2</span>
            <div className="rc-step-body">
              <div className="rc-step-h">
                <span>Proven by Attestcoin</span>
                <span className="pill ok"><i className="dot" /> Attestcoin verified</span>
              </div>
              <div className="rc-step-sub">
                Attestcoin attests Sepolia block roots to Creditcoin. The block-prover precompile
                checked an inclusion proof for this transaction against an attested root, and
                checked that the transaction&apos;s own status was success.
              </div>

              <div className="rc-fields">
                <div className="rc-pair">
                  <Field
                    label="Block-prover precompile"
                    value={BLOCK_PROVER_PRECOMPILE}
                    display={shortAddr(BLOCK_PROVER_PRECOMPILE)}
                    href={ccAddressUrl(BLOCK_PROVER_PRECOMPILE)}
                  />
                  <Field
                    label="Source chain key"
                    value={String(SEPOLIA_CHAIN_KEY)}
                    display={`${SEPOLIA_CHAIN_KEY} · Sepolia ethereum`}
                  />
                </div>
                <Field
                  label="Purchase id"
                  value={`chainKey ${SEPOLIA_CHAIN_KEY} · height ${receipt.sourceHeight} · index ${receipt.sourceTxIndex}`}
                  hint="Hashed and stored as used, so the same Sepolia payment can never be claimed twice."
                />
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------- step 3 */}
          <div className="rc-step last">
            <span className="rc-step-n done">3</span>
            <div className="rc-step-body">
              <div className="rc-step-h">
                <span>Recorded on Creditcoin</span>
                <span className="tiny dim">{timeAgo(Number(receipt.timestamp))}</span>
              </div>
              <div className="rc-step-sub">
                Only after the proof passed did the receipt exist, the stars land, and the cashback
                become withdrawable.
              </div>

              <div className="rc-fields">
                <Field
                  label="Verification transaction"
                  value={provenance?.verifyTxHash}
                  display={
                    provenance?.verifyTxHash ? midHash(provenance.verifyTxHash) : "looking up PurchaseVerified…"
                  }
                  href={provenance?.verifyTxHash ? ccTxUrl(provenance.verifyTxHash) : undefined}
                  hint="The call to recordPurchase that carried the inclusion proof."
                />
                <div className="rc-pair">
                  <Field
                    label="Creditcoin block"
                    value={provenance?.verifyBlock?.toString()}
                    href={provenance?.verifyBlock ? ccBlockUrl(provenance.verifyBlock) : undefined}
                  />
                  <Field
                    label="VouchCore"
                    value={addresses.VouchCore}
                    display={shortAddr(addresses.VouchCore)}
                    href={ccAddressUrl(addresses.VouchCore)}
                  />
                </div>
                <div className="rc-pair">
                  <Field
                    label="Cashback from your level"
                    value={`${ctc(receipt.appCashbackEarned)} CTC`}
                  />
                  <Field
                    label="Cashback from quests"
                    value={`${ctc(receipt.cashbackEarned)} CTC`}
                  />
                </div>
                <Field
                  label="Recorded at"
                  value={fullTime(Number(receipt.timestamp))}
                  hint="Creditcoin block time, not the Sepolia payment time — the gap is how long attestation took."
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
