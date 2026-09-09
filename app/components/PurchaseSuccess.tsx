"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { sepoliaTxUrl } from "@/lib/chains";
import { midHash, usd } from "@/lib/format";

/// The four things that have to happen before cashback is spendable. The first two are already
/// true by the time this card appears; the third is under way; the fourth has not started, and
/// says so with a plain dot rather than a spinner that would imply work is happening.
const STEPS = [
  { key: "sent", state: "done", label: "Payment sent on Ethereum Sepolia" },
  { key: "seen", state: "done", label: "Transaction accepted by the network" },
  { key: "attest", state: "active", label: "Attestcoin proving it to Creditcoin", note: "~9 min" },
  { key: "claim", state: "todo", label: "Claim your stars and cashback" },
] as const;

/// Ticks land one after another rather than all at once, so the eye reads the sequence as a
/// process with a queue rather than a static list of four green checks.
const STAGGER_MS = 420;

export function PurchaseSuccess({
  itemName,
  merchantName,
  amount,
  txHash,
  onClose,
}: {
  itemName: string;
  merchantName: string;
  amount: bigint;
  txHash?: `0x${string}`;
  onClose: () => void;
}) {
  // How many steps have animated in so far.
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    const timers = STEPS.map((_, i) =>
      setTimeout(() => setRevealed((n) => Math.max(n, i + 1)), 260 + i * STAGGER_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="overlay ps-overlay" onClick={onClose}>
      <div className="ps-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ps-seal">
          <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden>
            <circle className="ps-seal-ring" cx="36" cy="36" r="32" />
            <circle className="ps-seal-fill" cx="36" cy="36" r="32" />
            <path className="ps-seal-tick" d="M22 37.5 L32 47 L51 26" />
          </svg>
        </div>

        <h2 className="ps-title">Payment successful</h2>
        <p className="ps-lead">
          Wait while Attestcoin verifies your transaction — your cashback becomes claimable the
          moment it does.
        </p>

        <div className="ps-order">
          <div className="between">
            <span style={{ fontWeight: 600 }}>{itemName}</span>
            <span style={{ fontWeight: 640 }}>{usd(amount)}</span>
          </div>
          <div className="tiny dim" style={{ marginTop: 3 }}>{merchantName}</div>
          {txHash && (
            <a
              className="ps-hash mono tiny"
              href={sepoliaTxUrl(txHash)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {midHash(txHash)} ↗
            </a>
          )}
        </div>

        <ul className="ps-list">
          {STEPS.map((s, i) => {
            const shown = i < revealed;
            return (
              <li
                key={s.key}
                className={`ps-step ${shown ? "in" : ""} ${s.state}`}
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <span className="ps-mark">
                  {s.state === "done" && (
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                      <path className="ps-mark-tick" d="M6 12.5 L10.5 17 L18 8" />
                    </svg>
                  )}
                  {s.state === "active" && <span className="ps-spin" />}
                  {s.state === "todo" && <span className="ps-dot" />}
                </span>
                <span className="ps-step-label">{s.label}</span>
                {"note" in s && shown && <span className="ps-eta tiny">{s.note}</span>}
              </li>
            );
          })}
        </ul>

        <div className="ps-actions">
          <Link href="/app/activity" style={{ flex: 1 }}>
            <button className="ghost" style={{ width: "100%" }}>Track it</button>
          </Link>
          <button style={{ flex: 1 }} onClick={onClose} autoFocus>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
