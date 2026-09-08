"use client";

import { useEffect } from "react";
import Link from "next/link";
import { shortAddr, usd, ctc } from "@/lib/format";
import { usePassArt } from "@/lib/useVouch";

const TIERS = ["Newcomer", "Regular", "Insider", "Patron", "Founding member"];

/// Deliberately fits on screen. The full perk list lives on the Benefits page — duplicating it
/// here is what forced this dialog to scroll, and a scrolling identity card reads as a form.
export function ProfileModal({
  onClose,
  address,
  level,
  stars,
  profile,
  thresholds,
}: {
  onClose: () => void;
  address?: `0x${string}`;
  level: number;
  stars: bigint;
  profile: any;
  thresholds: readonly bigint[];
}) {
  const { tokenId, image } = usePassArt(address);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const next = thresholds[level - 1];
  const prev = level >= 2 ? thresholds[level - 2] : 0n;
  const pct = next ? Number(((stars - prev) * 100n) / (next - prev || 1n)) : 100;
  const tier = TIERS[Math.min(level, TIERS.length) - 1] ?? TIERS[0];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal fit" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h between">
          <div>
            <div style={{ fontWeight: 640, fontSize: 17 }}>Benefit Pass</div>
            <div className="tiny mono dim">{shortAddr(address)}</div>
          </div>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="modal-b">
          <div className="pass-split">
            <div className="pass-frame">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="pass-art" src={image} alt={`Vouch Benefit Pass #${tokenId}`} />
              ) : (
                <div className="pass-empty">
                  <div className="pf-av" style={{ width: 44, height: 44, flexBasis: 44 }}>
                    {address ? address.slice(2, 4).toUpperCase() : "—"}
                  </div>
                  <div className="tiny dim" style={{ marginTop: 12 }}>
                    Your pass mints on your first verified purchase.
                  </div>
                </div>
              )}
            </div>

            <div className="pass-meta">
              <div className="label">{tier}</div>
              <div className="stat" style={{ margin: "4px 0 14px" }}>Level {level}</div>
              <div className="bar">
                <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
              </div>
              <div className="tiny dim" style={{ marginTop: 8, marginBottom: 18 }}>
                {next ? `${(next - stars).toString()} stars to level ${level + 1}` : "Max level"}
              </div>

              <div className="kv">
                <div className="kv-row">
                  <span>Verified spend</span>
                  <span>{profile ? usd(profile.verifiedSpend) : "$0.00"}</span>
                </div>
                <div className="kv-row">
                  <span>Purchases</span>
                  <span>{profile ? Number(profile.purchaseCount) : 0}</span>
                </div>
                <div className="kv-row">
                  <span>Cashback earned</span>
                  <span>{profile ? ctc(profile.totalCashback) : "0"} CTC</span>
                </div>
                <div className="kv-row">
                  <span>Total stars</span>
                  <span>{stars.toString()}</span>
                </div>
              </div>

              <Link href="/app/benefits" onClick={onClose}>
                <button className="ghost sm" style={{ marginTop: 18, width: "100%" }}>
                  See all perks
                </button>
              </Link>
            </div>
          </div>

          <div className="tiny dim" style={{ marginTop: 18 }}>
            Rendered on-chain from live progression — soulbound, so a level always means someone
            actually spent.
          </div>
        </div>
      </div>
    </div>
  );
}
