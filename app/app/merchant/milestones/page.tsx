"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseEther } from "viem";
import { MilestoneManagerAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc, usd, toUsdcBase } from "@/lib/format";
import { useCommerces, useMilestonesOf } from "@/lib/useVouch";

export default function CampaignsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();
  const { commerces } = useCommerces();

  const mine = commerces.filter((c) => address && c.owner.toLowerCase() === address.toLowerCase());
  const [selected, setSelected] = useState<bigint | undefined>();
  const { campaigns, refetch } = useMilestonesOf(selected);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("50");
  const [minSpend, setMinSpend] = useState("1");
  const [reward, setReward] = useState("2");
  const [budget, setBudget] = useState("100");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!selected && mine.length) setSelected(mine[0].id);
  }, [mine, selected]);

  async function run(kind: string, fn: () => Promise<`0x${string}`>, after?: () => void) {
    setBusy(kind);
    setErr("");
    try {
      const hash = await ensure(creditcoinTestnet.id, fn);
      await client?.waitForTransactionReceipt({ hash });
      after?.();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Transaction failed");
    } finally {
      setBusy("");
    }
  }

  const winners = Math.floor(Number(budget || 0) / Math.max(0.000001, Number(reward || 0)));
  const valid = title.trim().length > 0 && Number(target) > 0 && Number(reward) > 0 && Number(budget) >= Number(reward);

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Community campaigns</h1>
      <div className="sub">
        A shared goal: sell N and every buyer gets cashback. Units only count from
        Attestcoin-verified purchases, and your budget is a hard cap you can never overspend.
      </div>

      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {mine.length === 0 ? (
        <div className="banner warn">
          {isConnected ? "Register a storefront first." : "Connect a wallet to manage campaigns."}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 32 }}>
            <h2>New campaign</h2>

            <div className="grid g2">
              <div className="field">
                <label>Storefront</label>
                <select value={selected?.toString() ?? ""} onChange={(e) => setSelected(BigInt(e.target.value))}>
                  {mine.map((c) => (
                    <option key={c.id.toString()} value={c.id.toString()}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Campaign name</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Sell-out Saturday"
                  maxLength={60}
                />
              </div>
            </div>

            <div className="field">
              <label>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="If we sell 50 cups today, everyone who bought one gets CTC back."
              />
              <div className="hint">Customers see this when they open the campaign.</div>
            </div>

            <div className="label" style={{ margin: "8px 0 12px" }}>The goal</div>
            <div className="fields3">
              <div className="field">
                <label>Purchases to unlock</label>
                <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" />
              </div>
              <div className="field">
                <label>Min spend per purchase (USDC)</label>
                <input value={minSpend} onChange={(e) => setMinSpend(e.target.value)} inputMode="decimal" />
              </div>
              <div className="field">
                <label>Window (hours)</label>
                <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" />
                <div className="hint">0 leaves it open-ended.</div>
              </div>
            </div>

            <div className="label" style={{ margin: "8px 0 12px" }}>The reward</div>
            <div className="fields3">
              <div className="field">
                <label>Cashback per buyer (CTC)</label>
                <input value={reward} onChange={(e) => setReward(e.target.value)} inputMode="decimal" />
              </div>
              <div className="field">
                <label>Total budget (CTC)</label>
                <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" />
                <div className="hint">Funded now, in this transaction.</div>
              </div>
            </div>

            <div className="banner" style={{ marginBottom: 20 }}>
              <div className="kv">
                <div className="kv-row">
                  <span>Unlocks at</span>
                  <span>{target || 0} verified purchases of {usd(toUsdcBase(minSpend))} or more</span>
                </div>
                <div className="kv-row">
                  <span>Each buyer claims</span>
                  <span>{reward || 0} CTC</span>
                </div>
                <div className="kv-row">
                  <span>Your budget covers</span>
                  <span>{winners} claim{winners === 1 ? "" : "s"}, first come</span>
                </div>
              </div>
              <div className="hint">
                Buyers also earn 10 stars per $1 spent — protocol-set, not something you fund.
              </div>
            </div>

            <button
              disabled={busy === "new" || selected === undefined || !valid}
              onClick={() =>
                run(
                  "new",
                  () => {
                    const h = Number(hours || 0);
                    const endsAt = h > 0 ? BigInt(Math.floor(Date.now() / 1000) + h * 3600) : 0n;
                    return writeContractAsync({
                      address: addresses.MilestoneManager,
                      abi: MilestoneManagerAbi,
                      functionName: "createCampaign",
                      chainId: creditcoinTestnet.id,
                      args: [
                        selected!,
                        title.trim(),
                        description.trim(),
                        BigInt(target || "0"),
                        toUsdcBase(minSpend),
                        parseEther(reward || "0"),
                        0n,
                        endsAt,
                      ],
                      value: parseEther(budget || "0"),
                      gas: 900_000n,
                    });
                  },
                  () => {
                    setTitle("");
                    setDescription("");
                    refetch();
                  },
                )
              }
            >
              {busy === "new" ? "Launching…" : `Launch & fund ${budget} CTC`}
            </button>
          </div>

          <div className="section-h">
            <h2>Your campaigns</h2>
            <span className="tiny dim">{campaigns.length} created</span>
          </div>
          <div className="grid g2">
            {campaigns.length === 0 ? (
              <div className="card empty">No campaigns yet.</div>
            ) : (
              campaigns.map((c: any) => {
                const sold = Number(c.unitsSold);
                const tgt = Number(c.targetUnits);
                const reached = sold >= tgt;
                const pct = Math.min(100, (sold / Math.max(1, tgt)) * 100);
                const left = c.rewardPerUser > 0n ? Number(c.budget / c.rewardPerUser) : 0;
                return (
                  <div className="card" key={c.id.toString()}>
                    <div className="between" style={{ marginBottom: 4 }}>
                      <span style={{ fontWeight: 620, fontSize: 16 }}>{c.title || `Campaign #${c.id}`}</span>
                      <span className={`pill ${reached ? "ok" : c.active ? "wait" : ""}`}>
                        {reached ? "Unlocked" : c.active ? "Running" : "Paused"}
                      </span>
                    </div>
                    <div className="small muted" style={{ margin: "0 0 16px" }}>
                      {tgt} purchases · {ctc(c.rewardPerUser)} CTC each · min {usd(c.minSpend)}
                    </div>
                    <div className="bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <div className="between tiny dim" style={{ marginTop: 8 }}>
                      <span>{sold} of {tgt} verified purchases</span>
                      <span>{Number(c.participantCount)} buyers</span>
                    </div>
                    <div className="between" style={{ marginTop: 18 }}>
                      <span className="pill acc">{ctc(c.budget)} CTC left · {left} claims</span>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          className="ghost sm"
                          disabled={busy === `t${c.id}`}
                          onClick={() =>
                            run(
                              `t${c.id}`,
                              () =>
                                writeContractAsync({
                                  address: addresses.MilestoneManager,
                                  abi: MilestoneManagerAbi,
                                  functionName: "setActive",
                                  chainId: creditcoinTestnet.id,
                                  args: [c.id, !c.active],
                                }),
                              refetch,
                            )
                          }
                        >
                          {c.active ? "Pause" : "Resume"}
                        </button>
                        <button
                          className="ghost sm"
                          disabled={busy === `r${c.id}` || c.budget === 0n}
                          title="Only available once the campaign is paused or its window has closed"
                          onClick={() =>
                            run(
                              `r${c.id}`,
                              () =>
                                writeContractAsync({
                                  address: addresses.MilestoneManager,
                                  abi: MilestoneManagerAbi,
                                  functionName: "reclaim",
                                  chainId: creditcoinTestnet.id,
                                  args: [c.id],
                                }),
                              refetch,
                            )
                          }
                        >
                          Reclaim
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}
