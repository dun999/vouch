"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseEther } from "viem";
import { QuestManagerAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc, usd, toUsdcBase } from "@/lib/format";
import { useCommerces, useQuestsOf, useItemsOf } from "@/lib/useVouch";

export default function MerchantQuestsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();
  const { commerces } = useCommerces();

  const mine = commerces.filter((c) => address && c.owner.toLowerCase() === address.toLowerCase());
  const [selected, setSelected] = useState<bigint | undefined>();
  const { quests, refetch } = useQuestsOf(selected);
  const { items } = useItemsOf(selected);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [itemId, setItemId] = useState("0");
  const [minPurchases, setMinPurchases] = useState("2");
  const [minSpend, setMinSpend] = useState("0");
  const [cashback, setCashback] = useState("0.25");
  const [minLevel, setMinLevel] = useState("1");
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

  const purchases = Number(minPurchases || 0);
  const item = items.find((i: any) => i.id.toString() === itemId);
  const requirement = [
    purchases > 0
      ? item
        ? `Buy ${purchases} × ${item.name}`
        : `${purchases} purchase${purchases === 1 ? "" : "s"} here`
      : "",
    Number(minSpend) > 0 ? `${usd(toUsdcBase(minSpend))} total spend` : "",
  ].filter(Boolean).join(" and ");
  const valid = title.trim().length > 0 && (purchases > 0 || Number(minSpend) > 0);

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Quests</h1>
      <div className="sub">
        A goal for one customer: do this, get CTC back. Rewards are paid from your storefront's
        cashback pool.
      </div>

      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {mine.length === 0 ? (
        <div className="banner warn">
          {isConnected ? "Register a storefront first." : "Connect a wallet to manage quests."}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 32 }}>
            <h2>New quest</h2>

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
                <label>Quest name</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Two-cup starter"
                  maxLength={60}
                />
              </div>
            </div>

            <div className="field">
              <label>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Buy any two coffees and the second one effectively pays for itself in CTC."
              />
              <div className="hint">Customers see this when they open the quest.</div>
            </div>

            <div className="label" style={{ margin: "8px 0 12px" }}>What the customer must do</div>
            <div className="field">
              <label>Item this quest is about</label>
              <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="0">Any item at this storefront</option>
                {items.map((i: any) => (
                  <option key={i.id.toString()} value={i.id.toString()}>
                    {i.name} — {usd(i.price)} ({Math.max(0, i.stock - i.sold)} left)
                  </option>
                ))}
              </select>
              <div className="hint">
                {items.length === 0
                  ? "No items listed yet — add some under Menu so quests can name a real product."
                  : "Naming an item is what turns \u201cspend $5\u201d into \u201cbuy two flat whites\u201d."}
              </div>
            </div>
            <div className="fields3">
              <div className="field">
                <label>Purchases required</label>
                <input value={minPurchases} onChange={(e) => setMinPurchases(e.target.value)} inputMode="numeric" />
              </div>
              <div className="field">
                <label>Total spend required (USDC)</label>
                <input value={minSpend} onChange={(e) => setMinSpend(e.target.value)} inputMode="decimal" />
                <div className="hint">0 to ignore.</div>
              </div>
              <div className="field">
                <label>Minimum level</label>
                <input value={minLevel} onChange={(e) => setMinLevel(e.target.value)} inputMode="numeric" />
                <div className="hint">1 opens it to everyone.</div>
              </div>
            </div>

            <div className="label" style={{ margin: "8px 0 12px" }}>What they get</div>
            <div className="fields3">
              <div className="field">
                <label>Cashback (CTC)</label>
                <input value={cashback} onChange={(e) => setCashback(e.target.value)} inputMode="decimal" />
              </div>
            </div>

            <div className="banner" style={{ marginBottom: 20 }}>
              <div className="kv">
                <div className="kv-row">
                  <span>Customer completes</span>
                  <span>{requirement || "— set a requirement"}</span>
                </div>
                <div className="kv-row">
                  <span>You pay</span>
                  <span>{cashback || 0} CTC from your cashback pool</span>
                </div>
                <div className="kv-row">
                  <span>They also earn</span>
                  <span>10 stars per $1 spent — set by the protocol, not by you</span>
                </div>
              </div>
            </div>

            <button disabled={busy === "new" || selected === undefined || !valid}
              onClick={() =>
                run(
                  "new",
                  () =>
                    writeContractAsync({
                      address: addresses.QuestManager,
                      abi: QuestManagerAbi,
                      functionName: "createQuest",
                      chainId: creditcoinTestnet.id,
                      args: [
                        {
                          commerceId: selected!,
                          title: title.trim(),
                          description: description.trim(),
                          itemId: BigInt(itemId || "0"),
                          minPurchases: Number(minPurchases || 0),
                          minSpendWei: toUsdcBase(minSpend),
                          cashback: parseEther(cashback || "0"),
                          minLevel: Number(minLevel || 1),
                          startsAt: 0n,
                          endsAt: 0n,
                          maxClaims: 0,
                        },
                      ],
                    }),
                  () => {
                    setTitle("");
                    setDescription("");
                    refetch();
                  },
                )
              }
            >
              {busy === "new" ? "Publishing…" : "Publish quest"}
            </button>
          </div>

          <div className="section-h">
            <h2>Live quests</h2>
            <span className="tiny dim">{quests.length} published</span>
          </div>
          <div className="card pad0 scroll-x">
            {quests.length === 0 ? (
              <div className="empty">No quests for this storefront yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Quest</th>
                    <th>Requirement</th>
                    <th>Cashback</th>
                    <th>Completed</th>
                    <th style={{ width: 1 }} />
                  </tr>
                </thead>
                <tbody>
                  {quests.map((q: any) => (
                    <tr key={q.id.toString()}>
                      <td>
                        <div style={{ fontWeight: 590 }}>{q.title || `Quest #${q.id}`}</div>
                        <div className="tiny dim">
                          #{q.id.toString()} · {Number(q.minLevel) > 1 ? `Level ${Number(q.minLevel)}+` : "Open to all"}
                          {q.active ? "" : " · Paused"}
                        </div>
                      </td>
                      <td className="muted">
                        {(() => {
                          const named = items.find((i: any) => i.id === q.itemId);
                          return named
                            ? `${Number(q.minPurchases)} × ${named.name}`
                            : `${Number(q.minPurchases)} purchase${Number(q.minPurchases) === 1 ? "" : "s"}`;
                        })()}
                        {q.minSpendWei > 0n && ` · min ${usd(q.minSpendWei)}`}
                      </td>
                      <td>
                        <span className="pill ok">{ctc(q.cashback)} CTC</span>
                      </td>
                      <td>{Number(q.claims)}</td>
                      <td>
                        <button
                          className="ghost sm"
                          disabled={busy === `t${q.id}`}
                          onClick={() =>
                            run(
                              `t${q.id}`,
                              () =>
                                writeContractAsync({
                                  address: addresses.QuestManager,
                                  abi: QuestManagerAbi,
                                  functionName: "setActive",
                                  chainId: creditcoinTestnet.id,
                                  args: [q.id, !q.active],
                                }),
                              refetch,
                            )
                          }
                        >
                          {q.active ? "Pause" : "Resume"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
