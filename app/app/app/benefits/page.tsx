"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { RewardVaultAbi, MilestoneManagerAbi, AppCashbackAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc } from "@/lib/format";
import { BENEFITS } from "@/lib/benefits";
import { Icon } from "@/components/Icon";
import {
  useProfile, useClaimable, useMilestoneClaimable, useAppCashback,
} from "@/lib/useVouch";

export default function BenefitsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();

  const profile = useProfile(address);
  const questCash = useClaimable(address);
  const campaignCash = useMilestoneClaimable(address);
  const app = useAppCashback(address);

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const p = profile.data as any;
  const level = p ? Number(p.level) : 1;

  // Three contracts hold the money, but to a customer it is one balance: cashback they earned.
  const qc = (questCash.data as bigint) ?? 0n;
  const cc = (campaignCash.data as bigint) ?? 0n;
  const ac = app.claimable;
  const total = qc + cc + ac;

  // The ladder is the concrete thing a level buys, so state it in the units people think in.
  const rates = app.rates.length ? app.rates : [0, 200, 400, 700, 1000];
  const pctFor = (lvl: number) => (rates[Math.min(lvl, rates.length) - 1] ?? 0) / 100;
  const maxPct = pctFor(rates.length);

  function refetchAll() {
    profile.refetch();
    questCash.refetch();
    campaignCash.refetch();
    app.refetch();
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
      <div className="card cash-card cash-single" style={{ marginBottom: 16 }}>
        <div className="cash-main">
          <div className="cash-gift-row">
            <span className="cash-gift"><Icon name="gift" size={30} /></span>
            <div>
              <div className="label">Cashback ready to withdraw</div>
              <div className="stat cash-total">{ctc(total)} CTC</div>
            </div>
          </div>
          <button className="classic" disabled={total === 0n || busy === "w"} onClick={withdrawAll}>
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
          Ethereum mainnet (WCTC/USDT) and proven to Creditcoin by the same precompile that proves
          your payment — so nobody can quote you a made-up price.
          {app.priceIsManual && " This deployment is on an administered rate, not a proven Sync."}
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
