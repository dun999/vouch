"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { UserShell } from "@/components/UserShell";
import { ProfileModal } from "@/components/ProfileModal";
import { Icon } from "@/components/Icon";
import { useLeaderboard, type LeaderRow } from "@/lib/leaderboard";
import { useLevelThresholds } from "@/lib/useVouch";
import { isDeployed } from "@/lib/addresses";
import { ccAddressUrl } from "@/lib/chains";
import { shortAddr } from "@/lib/format";

function rankCell(rank: number) {
  if (rank <= 3) {
    return (
      <span className="pill acc" style={{ gap: 6 }}>
        <Icon name="medal" size={14} /> {rank}
      </span>
    );
  }
  return <span className="dim" style={{ fontWeight: 600 }}>{rank}</span>;
}

export default function StarboardPage() {
  const { address, isConnected } = useAccount();
  const { rows, isLoading, error, refetch } = useLeaderboard();
  const thresholds = useLevelThresholds();
  const [openAddr, setOpenAddr] = useState<string | null>(null);

  const open: LeaderRow | undefined = useMemo(
    () => rows.find((r) => r.address.toLowerCase() === openAddr),
    [rows, openAddr],
  );
  const myRank = useMemo(
    () => (address ? rows.findIndex((r) => r.address.toLowerCase() === address.toLowerCase()) : -1),
    [rows, address],
  );

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <UserShell>
      <h1>Starboard</h1>
      <div className="sub">
        Ranked by stars collected — verified spend plus daily check-ins. Open any row to see the
        collector&apos;s Benefit Pass and progression.
        {isConnected && myRank >= 0 && (
          <> You sit at <strong>#{myRank + 1}</strong> of {rows.length}.</>
        )}
      </div>

      {error && (
        <div className="banner err" style={{ marginBottom: 16 }}>
          {error}{" "}
          <button className="ghost sm" style={{ marginLeft: 8 }} onClick={refetch}>Retry</button>
        </div>
      )}
      {!isConnected && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          Browsing read-only. Connect a wallet to see your own rank.
        </div>
      )}

      <div className="section-h">
        <h2>Top collectors</h2>
        <span className="tiny dim">{rows.length} ranked</span>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="ghost sm" onClick={refetch} disabled={isLoading}>
          {isLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="card pad0 scroll-x">
        {isLoading && rows.length === 0 ? (
          <div className="empty">Reading progression from Creditcoin…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No collectors yet. Be the first to earn stars.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Rank</th>
                <th>Collector</th>
                <th>Stars collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const mine = address?.toLowerCase() === r.address.toLowerCase();
                return (
                  <tr
                    key={r.address}
                    className="clickable"
                    tabIndex={0}
                    role="button"
                    style={mine ? { background: "var(--accent-dim)" } : undefined}
                    onClick={() => setOpenAddr(r.address.toLowerCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenAddr(r.address.toLowerCase());
                      }
                    }}
                  >
                    <td>{rankCell(i + 1)}</td>
                    <td>
                      <span style={{ fontWeight: mine ? 650 : 560 }} className="mono">
                        {shortAddr(r.address)}
                      </span>{" "}
                      <a
                        className="rc-link tiny"
                        href={ccAddressUrl(r.address)}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ↗
                      </a>
                      {mine && (
                        <span className="pill acc" style={{ marginLeft: 8 }}>You</span>
                      )}
                    </td>
                    <td>
                      <span className="stars-earn" style={{ fontSize: 16 }}>
                        <Icon name="star" size={18} />
                        {r.stars.toString()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="tiny dim" style={{ marginTop: 16, maxWidth: "80ch" }}>
        Stars come only from Attestcoin-verified Sepolia spend and daily check-ins — merchants
        can fund cashback, never stars — so this board reads actual customer history.
      </div>

      {open && (
        <ProfileModal
          onClose={() => setOpenAddr(null)}
          address={open.address}
          level={open.level}
          stars={open.stars}
          profile={{
            verifiedSpend: open.verifiedSpend,
            purchaseCount: open.purchaseCount,
            totalCashback: open.totalCashback,
          }}
          thresholds={(thresholds.data as readonly bigint[] | undefined) ?? []}
        />
      )}
    </UserShell>
  );
}
