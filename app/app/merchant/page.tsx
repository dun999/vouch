"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useReadContracts } from "wagmi";
import { parseEther } from "viem";
import { CommerceRegistryAbi, RewardVaultAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc, shortAddr } from "@/lib/format";
import { useCommerces } from "@/lib/useVouch";

export default function StorefrontsPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();
  const { commerces, refetch } = useCommerces();

  const mine = commerces.filter((c) => address && c.owner.toLowerCase() === address.toLowerCase());

  const balances = useReadContracts({
    contracts: mine.map((c) => ({
      address: addresses.RewardVault,
      abi: RewardVaultAbi,
      functionName: "campaignBalance" as const,
      args: [c.id],
      chainId: creditcoinTestnet.id,
    })),
    query: { enabled: isDeployed && mine.length > 0, refetchInterval: 8000 },
  });

  const [name, setName] = useState("");
  const [meta, setMeta] = useState("");
  const [payout, setPayout] = useState("");
  const [fund, setFund] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

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

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <h1>Storefronts</h1>
      <div className="sub">
        Customers pay you in USDC on Sepolia. You fund cashback in CTC on Creditcoin. Stars are
        protocol-set from verified spend, so there is nothing to configure there.
      </div>

      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {!isConnected && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          Connect a wallet to register and manage storefronts.
        </div>
      )}

      <div className="grid g2">
        <div className="card">
          <h2>Register a storefront</h2>
          <div className="field">
            <label>Display name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada's Coffee Bar" />
          </div>
          <div className="field">
            <label>Metadata URI (optional)</label>
            <input value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="ipfs://…" />
          </div>
          <div className="field">
            <label>Sepolia payout address</label>
            <input className="mono" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x…" />
          </div>
          <div className="hint" style={{ marginBottom: 18 }}>
            One storefront per payout address — it is how a proven payment is attributed to you.
          </div>
          <button
            disabled={busy === "reg" || !isConnected || !name || !/^0x[0-9a-fA-F]{40}$/.test(payout)}
            onClick={() =>
              run(
                "reg",
                () =>
                  writeContractAsync({
                    address: addresses.CommerceRegistry,
                    abi: CommerceRegistryAbi,
                    functionName: "register",
                    chainId: creditcoinTestnet.id,
                    args: [name, meta, payout as `0x${string}`],
                  }),
                () => {
                  setName("");
                  setMeta("");
                  setPayout("");
                  refetch();
                },
              )
            }
          >
            {busy === "reg" ? "Registering…" : "Register storefront"}
          </button>
        </div>

        <div className="card">
          <h2>Cashback pool</h2>
          <div className="small muted" style={{ marginBottom: 18 }}>
            Prefund CTC per storefront. A quest reward cannot pay out from an empty pool.
          </div>
          {mine.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>No storefronts yet.</div>
          ) : (
            mine.map((c, i) => {
              const bal = (balances.data?.[i]?.result as bigint) ?? 0n;
              const key = c.id.toString();
              return (
                <div key={key} style={{ paddingTop: i ? 16 : 0, borderTop: i ? "1px solid var(--line)" : undefined, marginTop: i ? 16 : 0 }}>
                  <div className="between" style={{ marginBottom: 10 }}>
                    <span style={{ fontWeight: 570 }}>{c.name}</span>
                    <span className="pill acc">{ctc(bal)} CTC</span>
                  </div>
                  <div className="row">
                    <input
                      style={{ flex: 1, minWidth: 90 }}
                      placeholder="1.0"
                      value={fund[key] ?? ""}
                      onChange={(e) => setFund({ ...fund, [key]: e.target.value })}
                    />
                    <button
                      className="sm"
                      disabled={busy === `f${key}` || !fund[key]}
                      onClick={() =>
                        run(
                          `f${key}`,
                          () =>
                            writeContractAsync({
                              address: addresses.RewardVault,
                              abi: RewardVaultAbi,
                              functionName: "fund",
                              chainId: creditcoinTestnet.id,
                              args: [c.id],
                              value: parseEther(fund[key] || "0"),
                            }),
                          () => {
                            setFund({ ...fund, [key]: "" });
                            balances.refetch();
                          },
                        )
                      }
                    >
                      Fund
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="section-h">
        <h2>Your storefronts</h2>
        <span className="tiny dim">{mine.length} registered</span>
      </div>
      <div className="card pad0 scroll-x">
        {mine.length === 0 ? (
          <div className="empty">You haven't registered a storefront yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Sepolia payout</th>
                <th>Cashback pool</th>
                <th>Status</th>
                <th style={{ width: 1 }} />
              </tr>
            </thead>
            <tbody>
              {mine.map((c, i) => (
                <tr key={c.id.toString()}>
                  <td style={{ fontWeight: 560 }}>
                    {c.name}
                    <div className="tiny dim">#{c.id.toString()}</div>
                  </td>
                  <td className="mono dim">{shortAddr(c.sepoliaPayout)}</td>
                  <td>{ctc((balances.data?.[i]?.result as bigint) ?? 0n)} CTC</td>
                  <td>
                    <span className={`pill ${c.active ? "ok" : ""}`}>
                      {c.active ? "Open" : "Closed"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="ghost sm"
                      disabled={busy === `a${c.id}`}
                      onClick={() =>
                        run(
                          `a${c.id}`,
                          () =>
                            writeContractAsync({
                              address: addresses.CommerceRegistry,
                              abi: CommerceRegistryAbi,
                              functionName: "setActive",
                              chainId: creditcoinTestnet.id,
                              args: [c.id, !c.active],
                            }),
                          refetch,
                        )
                      }
                    >
                      {c.active ? "Close" : "Open"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
