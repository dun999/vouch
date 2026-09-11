"use client";

import { useEffect, useState } from "react";
import { useAccount, useBlock, useWriteContract, usePublicClient } from "wagmi";
import { VouchCoreAbi } from "@/lib/abis";
import { addresses } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { timeUntil } from "@/lib/format";
import { useProfile } from "@/lib/useVouch";
import { Icon } from "./Icon";

const DAY_STARS = [5, 5, 10, 10, 10, 10, 60];

/// Daily check-in, floating beside the wallet button instead of living on the Benefits page.
/// Same contract call, same chain-clock guard — just reachable from anywhere.
export function CheckInPopover() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();
  const profile = useProfile(address);
  // VouchCore's day index is `block.timestamp / 1 days`, so read the chain's clock rather than
  // the browser's: a skewed local clock would otherwise offer a check-in that reverts.
  const head = useBlock({ chainId: creditcoinTestnet.id, query: { refetchInterval: 60_000 } });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const p = profile.data as any;
  const streak = p ? Number(p.streak) : 0;
  const nowSec = head.data ? Number(head.data.timestamp) : Math.floor(Date.now() / 1000);
  const today = Math.floor(nowSec / 86400);
  const checkedIn = !!p && Number(p.lastCheckInDay) >= today;
  const untilReset = (today + 1) * 86400 - nowSec;

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open ]);

  if (!isConnected) return null;

  async function checkIn() {
    setBusy(true);
    setErr("");
    try {
      const hash = await ensure(creditcoinTestnet.id, () =>
        writeContractAsync({
          address: addresses.VouchCore,
          abi: VouchCoreAbi,
          functionName: "checkIn",
          chainId: creditcoinTestnet.id,
        }),
      );
      await client?.waitForTransactionReceipt({ hash });
      profile.refetch();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Check-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pop-wrap">
      <button
        className="ghost sm checkin-btn"
        onClick={() => setOpen((o) => !o)}
        title={checkedIn ? "Daily login done" : "Daily login"}
        aria-expanded={open}
      >
        <Icon name="calendar" size={15} />
        {checkedIn ? "Done today" : streak > 0 ? `${streak}-day streak` : "Check in"}
      </button>

      {open && (
        <>
          <div className="pop-overlay" onClick={() => setOpen(false)} />
          <div className="checkin-pop" role="dialog" aria-label="Daily login">
            <div className="between" style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 640, fontSize: 15 }}>Daily login</span>
              <button className="x" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="tiny dim" style={{ marginBottom: 12 }}>
              {checkedIn
                ? `Checked in — streak at ${streak} day${streak === 1 ? "" : "s"}. Next opens in ${timeUntil(untilReset)}.`
                : `Check in once per UTC day. Miss a day and the streak resets.`}
            </div>
            {err && <div className="banner err small" style={{ marginBottom: 10 }}>{err}</div>}
            <button
              className="sm"
              style={{ width: "100%" }}
              disabled={busy || checkedIn}
              onClick={checkIn}
            >
              {busy ? "Checking in…" : checkedIn ? `Checked in · ${streak}-day streak` : "Check in today"}
            </button>
            <div className="checkin-grid">
              {DAY_STARS.map((v, i) => {
                const done = streak > i;
                return (
                  <div
                    key={i}
                    className="checkin-day"
                    style={{
                      background: done ? "var(--accent-dim)" : "var(--panel-2)",
                      borderColor: done ? "var(--accent)" : "var(--line)",
                    }}
                  >
                    <div className="tiny dim">D{i + 1}</div>
                    <div style={{ fontWeight: 640, fontSize: 13 }}>+{v}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
