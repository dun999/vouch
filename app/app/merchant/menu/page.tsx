"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { CatalogAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { usd, toUsdcBase } from "@/lib/format";
import { useCommerces, useItemsOf } from "@/lib/useVouch";

export default function MenuPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();
  const { commerces } = useCommerces();

  const mine = commerces.filter((c) => address && c.owner.toLowerCase() === address.toLowerCase());
  const [selected, setSelected] = useState<bigint | undefined>();
  const { items, refetch } = useItemsOf(selected);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("2.50");
  const [stock, setStock] = useState("50");
  const [top, setTop] = useState<Record<string, string>>({});
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

  const valid = name.trim().length > 0 && Number(price) > 0 && Number(stock) > 0;

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Menu</h1>
      <div className="sub">
        What you actually sell, at an exact price, in a finite number of units. Quests point at
        these items, so a customer is never told to "spend $5" without being told what for.
      </div>

      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {mine.length === 0 ? (
        <div className="banner warn">
          {isConnected ? "Register a storefront first." : "Connect a wallet to manage your menu."}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 32 }}>
            <h2>List an item</h2>

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
                <label>Item name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flat White" maxLength={48} />
              </div>
            </div>

            <div className="field">
              <label>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Double ristretto, steamed whole milk, 6oz."
              />
            </div>

            <div className="fields3">
              <div className="field">
                <label>Price (USDC)</label>
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
                <div className="hint">Customers pay exactly this.</div>
              </div>
              <div className="field">
                <label>Units in stock</label>
                <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
                <div className="hint">Counts down on proven sales only.</div>
              </div>
            </div>

            <button
              disabled={busy === "new" || selected === undefined || !valid}
              onClick={() =>
                run(
                  "new",
                  () =>
                    writeContractAsync({
                      address: addresses.Catalog,
                      abi: CatalogAbi,
                      functionName: "listItem",
                      chainId: creditcoinTestnet.id,
                      args: [selected!, name.trim(), description.trim(), toUsdcBase(price), Number(stock || 0)],
                    }),
                  () => {
                    setName("");
                    setDescription("");
                    refetch();
                  },
                )
              }
            >
              {busy === "new" ? "Listing…" : "List item"}
            </button>
          </div>

          <div className="section-h">
            <h2>Your menu</h2>
            <span className="tiny dim">{items.length} listed</span>
          </div>
          <div className="card pad0 scroll-x">
            {items.length === 0 ? (
              <div className="empty">Nothing listed yet. A quest needs an item to point at.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Sold</th>
                    <th>Remaining</th>
                    <th style={{ width: 200 }}>Restock</th>
                    <th style={{ width: 1 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it: any) => {
                    const left = Math.max(0, it.stock - it.sold);
                    const key = it.id.toString();
                    return (
                      <tr key={key}>
                        <td>
                          <div style={{ fontWeight: 590 }}>{it.name}</div>
                          <div className="tiny dim">
                            #{key}
                            {it.active ? "" : " · Hidden"}
                            {it.description ? ` · ${it.description}` : ""}
                          </div>
                        </td>
                        <td>{usd(it.price)}</td>
                        <td>{it.sold}</td>
                        <td>
                          <span className={`pill ${left === 0 ? "err" : left <= 5 ? "wait" : "ok"}`}>
                            {left} left
                          </span>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                            <input
                              style={{ width: 80 }}
                              placeholder="25"
                              inputMode="numeric"
                              value={top[key] ?? ""}
                              onChange={(e) => setTop({ ...top, [key]: e.target.value })}
                            />
                            <button
                              className="ghost sm"
                              disabled={busy === `r${key}` || !Number(top[key])}
                              onClick={() =>
                                run(
                                  `r${key}`,
                                  () =>
                                    writeContractAsync({
                                      address: addresses.Catalog,
                                      abi: CatalogAbi,
                                      functionName: "restock",
                                      chainId: creditcoinTestnet.id,
                                      args: [it.id, Number(top[key] || 0)],
                                    }),
                                  () => {
                                    setTop({ ...top, [key]: "" });
                                    refetch();
                                  },
                                )
                              }
                            >
                              Add
                            </button>
                          </div>
                        </td>
                        <td>
                          <button
                            className="ghost sm"
                            disabled={busy === `t${key}`}
                            onClick={() =>
                              run(
                                `t${key}`,
                                () =>
                                  writeContractAsync({
                                    address: addresses.Catalog,
                                    abi: CatalogAbi,
                                    functionName: "setActive",
                                    chainId: creditcoinTestnet.id,
                                    args: [it.id, !it.active],
                                  }),
                                refetch,
                              )
                            }
                          >
                            {it.active ? "Hide" : "Show"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
