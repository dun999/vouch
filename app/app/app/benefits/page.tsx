"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { VouchCoreAbi, RewardVaultAbi, MilestoneManagerAbi, AppCashbackAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc, usd } from "@/lib/format";
import { BENEFITS } from "@/lib/benefits";
import { Icon } from "@/components/Icon";
import {
  useProfile, useLevelThresholds, useClaimable, useMilestoneClaimable, useAppCashback,
} from "@/lib/useVouch";

const DAY_STARS = [5, 5, 10, 10, 10, 10, 60];

export default function BenefitsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();

  const profile = useProfile(address);
  const thresholds = useLevelThresholds();
  const questCash = useClaimable(address);
  const campaignCash = useMilestoneClaimable(address);
  const app = useAppCashback(address);

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const p = profile.data as any;
  const level = p ? Number(p.level) : 1;
  const stars = p ? BigInt(p.stars) : 0n;
  const streak = p ? Number(p.streak) : 0;
  const thr = (thresholds.data as readonly bigint[] | undefined) ?? [];
  const next = thr[level - 1];
  const prev = level >= 2 ? thr[level - 2] : 0n;
  const pct = next ? Number(((stars - prev) * 100n) / (next - prev || 1n)) : 100;

  // Three contracts hold the money, but to a customer it is one balance: cashback they earned.
  const qc = (questCash.data as bigint) ?? 0n;
  const cc = (campaignCash.data as bigint) ?? 0n;
  const ac = app.claimable;
  const total = qc + cc + ac;

  // The ladder is the concrete thing a level buys, so state it in the units people think in.
  const rates = app.rates.length ? app.rates : [0, 200, 400, 700, 1000];
  const pctFor = (lvl: number) => (rates[Math.min(lvl, rates.length) - 1] ?? 0) / 100;
  const myPct = pctFor(level);
  const maxPct = pctFor(rates.length);

  function refetchAll() {
    profile.refetch();
    questCash.refetch();
    campaignCash.refetch();
    app.refetch();
  }

  async function run(kind: string, fn: () => Promise<`0x${string}`>) {
    setBusy(kind);
    setErr("");
    try {
      const hash = await ensure(creditcoinTestnet.id, fn);
      await client?.waitForTransactionReceipt({ hash });
      refetchAll();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Transaction failed");
    } finally {
      setBusy("");
    }
  }

  /// One button, however many vaults are actually holding the balance.
  async function withdrawAll() {
    setBusy("w");
    setErr("");
    try {
      if (qc > 0n) {
        const h = await ensure(creditcoinTestnet.id, () =>
          writeContractAsync({
            address: addresses.RewardVault,
            abi: RewardVaultAbi,
            functionName: "withdraw",
            chainId: creditcoinTestnet.id,
          }),
        );
        await client?.waitForTransactionReceipt({ hash: h });
      }
      if (cc > 0n) {
        const h = await ensure(creditcoinTestnet.id, () =>
          writeContractAsync({
            address: addresses.MilestoneManager,
            abi: MilestoneManagerAbi,
            functionName: "withdraw",
            chainId: creditcoinTestnet.id,
          }),
        );
        await client?.waitForTransactionReceipt({ hash: h });
      }
      if (ac > 0n) {
        const h = await ensure(creditcoinTestnet.id, () =>
          writeContractAsync({
            address: addresses.AppCashback,
            abi: AppCashbackAbi,
            functionName: "withdraw",
            chainId: creditcoinTestnet.id,
          }),
        );
        await client?.waitForTransactionReceipt({ hash: h });
      }
      refetchAll();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Withdrawal failed");
    } finally {
      setBusy("");
    }
  }

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Benefits</h1>
      <div className="sub">
        Levelling up raises the share of every purchase you get back in CTC — {pctFor(2)}% at level 2,
        up to {maxPct}% at level {rates.length}. Cashback is released only once Attestcoin verifies the
        Sepolia transaction that earned it.
      </div>

      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {!isConnected && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          Connect a wallet to check in and withdraw.
        </div>
      )}

      <div className="grid g2" style={{ marginBottom: 16 }}>
        {/* ------------------------------------------------------- level */}
        <div className="card">
          <div className="between" style={{ marginBottom: 14 }}>
            <div>
              <div className="label">Benefit Pass</div>
              <div className="stat">Level {level}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="label">Total stars</div>
              <div className="stat">{stars.toString()}</div>
            </div>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
          <div className="between tiny dim" style={{ marginTop: 8 }}>
            <span>{p ? usd(p.verifiedSpend) : "$0.00"} verified spend</span>
            <span>{next ? `${(next - stars).toString()} stars to level ${level + 1}` : "Max level"}</span>
          </div>
          <div className="kv" style={{ margin: "20px 0 0" }}>
            <div className="kv-row">
              <span>Proven purchases</span>
              <span>{p ? Number(p.purchaseCount) : 0}</span>
            </div>
            <div className="kv-row">
              <span>Quests completed</span>
              <span>{p ? Number(p.questsCompleted) : 0}</span>
            </div>
            <div className="kv-row">
              <span>Login streak</span>
              <span>{streak} day{streak === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 16 }}>
            Stars come from spend alone — $1 verified = 10 stars. No merchant can grant them.
          </div>
        </div>

        {/* ---------------------------------------------------- cashback */}
        <div className="card">
          <div className="label">Cashback ready to withdraw</div>
          <div className="stat" style={{ margin: "6px 0 16px" }}>{ctc(total)} CTC</div>
          <div className="kv" style={{ marginBottom: 18 }}>
            <div className="kv-row">
              <span>Your {myPct}% rate on every purchase</span>
              <span>{ctc(ac)} CTC</span>
            </div>
            <div className="kv-row">
              <span>From merchant quests</span>
              <span>{ctc(qc)} CTC</span>
            </div>
            <div className="kv-row">
              <span>From community campaigns</span>
              <span>{ctc(cc)} CTC</span>
            </div>
            <div className="kv-row">
              <span>Earned to date</span>
              <span>{p ? ctc(p.totalCashback) : "0"} CTC</span>
            </div>
          </div>
          <button disabled={total === 0n || busy === "w"} onClick={withdrawAll}>
            {busy === "w" ? "Withdrawing…" : `Withdraw ${ctc(total)} CTC`}
          </button>
          {[qc, cc, ac].filter((v) => v > 0n).length > 1 && (
            <div className="hint">
              Separate pools, so your wallet will ask you to sign once for each.
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ cashback rate */}
      <div className="section-h">
        <h2>Your cashback rate</h2>
        <span className="tiny dim">Paid by the app on every verified purchase</span>
      </div>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="ladder">
          {rates.map((bps, i) => {
            const lvl = i + 1;
            const on = lvl === level;
            const reached = lvl <= level;
            return (
              <div key={lvl} className={`rung ${on ? "on" : ""} ${reached ? "reached" : ""}`}>
                <div className="tiny dim">Level {lvl}</div>
                <div className="rung-pct">{bps / 100}%</div>
                <div className="tiny dim">
                  {bps === 0 ? "no rate yet" : `${ctc((BigInt(bps) * app.ctcPerUsd) / 10000n)} CTC per $1`}
                </div>
                {on && <span className="pill acc" style={{ marginTop: 8 }}>You</span>}
              </div>
            );
          })}
        </div>
        <div className="hint" style={{ marginTop: 18 }}>
          The dollar-to-CTC rate is read from a Uniswap V2 pool&apos;s <code>Sync</code> event on
          Ethereum and proven to Creditcoin by the same precompile that proves your payment — so
          nobody can quote you a made-up price.
          {app.priceIsManual && " No CTC/USD pool is listed on Sepolia yet, so this deployment runs on an administered rate until one exists."}
        </div>
      </div>

      {/* ---------------------------------------------------------- streak */}
      <div className="section-h">
        <h2>Daily login</h2>
        <span className="tiny dim">
          Current streak: {streak} day{streak === 1 ? "" : "s"}
        </span>
      </div>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="between" style={{ marginBottom: 16 }}>
          <span className="small muted">
            Check in once per UTC day. Miss a day and the streak resets.
          </span>
          <button
            className="sm"
            disabled={!isConnected || busy === "ci"}
            onClick={() =>
              run("ci", () =>
                writeContractAsync({
                  address: addresses.VouchCore,
                  abi: VouchCoreAbi,
                  functionName: "checkIn",
                  chainId: creditcoinTestnet.id,
                }),
              )
            }
          >
            {busy === "ci" ? "Checking in…" : "Check in today"}
          </button>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          {DAY_STARS.map((v, i) => {
            const done = streak > i;
            return (
              <div
                key={i}
                className="card"
                style={{
                  padding: "14px 8px",
                  textAlign: "center",
                  background: done ? "var(--accent-dim)" : "var(--panel-2)",
                  borderColor: done ? "var(--accent)" : "var(--line)",
                }}
              >
                <div className="tiny dim">Day {i + 1}</div>
                <div style={{ fontWeight: 640, fontSize: 15, marginTop: 3 }}>+{v}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------- benefits */}
      <div className="section-h">
        <h2>Perks by level</h2>
        <span className="tiny dim">
          {BENEFITS.filter((b) => b.level <= level).length} of {BENEFITS.length} unlocked
        </span>
      </div>
      <div className="grid g2">
        {BENEFITS.map((b) => {
          const earned = b.level <= level;
          return (
            <div className={`benefit ${earned ? "" : "locked"}`} key={b.title}>
              <span className="benefit-ico"><Icon name={b.icon} size={20} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="between">
                  <span style={{ fontWeight: 590 }}>{b.title}</span>
                  <span className={`pill ${earned ? "ok" : ""}`}>
                    {earned ? "Earned" : `Level ${b.level}`}
                  </span>
                </div>
                <div className="tiny dim" style={{ marginTop: 5 }}>{b.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
