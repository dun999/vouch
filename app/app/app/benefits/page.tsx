"use client";

import { useState } from "react";
import { useAccount, useBlock, useWriteContract, usePublicClient } from "wagmi";
import { VouchCoreAbi, RewardVaultAbi, MilestoneManagerAbi, AppCashbackAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc, timeUntil } from "@/lib/format";
import { BENEFITS } from "@/lib/benefits";
import { Icon } from "@/components/Icon";
import {
  useProfile, useClaimable, useMilestoneClaimable, useAppCashback,
} from "@/lib/useVouch";

const DAY_STARS = [5, 5, 10, 10, 10, 10, 60];

export default function BenefitsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();

  const profile = useProfile(address);
  const questCash = useClaimable(address);
  const campaignCash = useMilestoneClaimable(address);
  const app = useAppCashback(address);
  // VouchCore's day index is `block.timestamp / 1 days`, so read the chain's clock rather than
  // the browser's: a skewed local clock would otherwise offer a check-in that reverts.
  const head = useBlock({ chainId: creditcoinTestnet.id, query: { refetchInterval: 60_000 } });

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const p = profile.data as any;
  const level = p ? Number(p.level) : 1;
  const streak = p ? Number(p.streak) : 0;

  const nowSec = head.data ? Number(head.data.timestamp) : Math.floor(Date.now() / 1000);
  const today = Math.floor(nowSec / 86400);
  // `>=` rather than `===`: if our clock reads behind the chain, stay disabled rather than
  // offering a check-in the contract will reject with AlreadyCheckedInToday.
  const checkedIn = !!p && Number(p.lastCheckInDay) >= today;
  const untilReset = (today + 1) * 86400 - nowSec;

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

      {/* ---------------------------------------------------------- cashback */}
      <div className="card cash-card" style={{ marginBottom: 16 }}>
        <div className="cash-main">
          <div className="label">Cashback ready to withdraw</div>
          <div className="stat cash-total">{ctc(total)} CTC</div>
          <button disabled={total === 0n || busy === "w"} onClick={withdrawAll}>
            {busy === "w" ? "Withdrawing…" : `Withdraw ${ctc(total)} CTC`}
          </button>
          {[qc, cc, ac].filter((v) => v > 0n).length > 1 && (
            <div className="hint">
              Separate pools, so your wallet will ask you to sign once for each.
            </div>
          )}
        </div>
        <div className="cash-split">
          <div className="label" style={{ marginBottom: 12 }}>Where it came from</div>
          <div className="kv">
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
          Ethereum mainnet (WCTC/USDT) and proven to Creditcoin by the same precompile that proves
          your payment — so nobody can quote you a made-up price.
          {app.priceIsManual && " This deployment is on an administered rate, not a proven Sync."}
        </div>
      </div>

      {/* ---------------------------------------------------------- streak */}
      <div className="section-h">
        <h2>Daily login</h2>
        <span className="tiny dim">
          Current streak: {streak} day{streak === 1 ? "" : "s"}
        </span>
        {checkedIn && <span className="pill ok"><i className="dot" /> Today done</span>}
      </div>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="between" style={{ marginBottom: 16 }}>
          <span className="small muted">
            {checkedIn
              ? `Checked in for today. The next one opens in ${timeUntil(untilReset)}.`
              : "Check in once per UTC day. Miss a day and the streak resets."}
          </span>
          <button
            className="sm"
            disabled={!isConnected || busy === "ci" || checkedIn}
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
            {busy === "ci" ? "Checking in…" : checkedIn ? "Checked in today" : "Check in today"}
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
