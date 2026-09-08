"use client";

import { useMemo, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { MockUSDCAbi, MilestoneManagerAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { creditcoinTestnet, sepolia } from "@/lib/chains";
import { usd, shortAddr } from "@/lib/format";
import {
  useCommerces, useAllQuests, useAllMilestones, useAllItems, useMyMilestoneUnits,
  useMyQuestProgress, useProfile, useUsdcBalance, useAppCashback, type Item,
} from "@/lib/useVouch";
import { addPending } from "@/lib/pending";
import { useEnsureChain } from "@/lib/useChain";
import { QuestCard, type BoardItem } from "@/components/QuestCard";
import { BuyModal } from "@/components/BuyModal";

type Filter = "all" | "quest" | "campaign";

export default function QuestsPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const ccClient = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  // Payments live on Sepolia, everything else on Creditcoin; the app moves the wallet, not the user.
  const { run: onChain, switching } = useEnsureChain();

  const { commerces } = useCommerces();
  const { quests } = useAllQuests(commerces);
  const { campaigns } = useAllMilestones(commerces);
  const { items, refetch: refetchItems } = useAllItems(commerces);
  const profile = useProfile(address);
  const usdc = useUsdcBalance(address);
  const app = useAppCashback(address);

  const campaignIds = useMemo(() => campaigns.map((c) => c.id), [campaigns]);
  const questIds = useMemo(() => quests.map((q) => q.id), [quests]);
  const { map: myUnits, refetch: refetchUnits } = useMyMilestoneUnits(campaignIds, address);
  const { map: myProgress } = useMyQuestProgress(questIds, address);

  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [buy, setBuy] = useState<{ commerceId: bigint; questId?: bigint; itemId?: bigint } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const p = profile.data as any;
  const level = p ? Number(p.level) : 1;
  const rateBps = app.rates.length ? (app.rates[Math.min(level, app.rates.length) - 1] ?? 0) : 0;

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id.toString(), i])), [items]);
  const itemsByCommerce = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) {
      const k = i.commerce.id.toString();
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return m;
  }, [items]);

  /// Quests and campaigns are one board. A customer does not care which contract holds the rule.
  const board: BoardItem[] = useMemo(() => {
    const empty = { purchases: 0, spendWei: 0n, completed: false };
    const out: BoardItem[] = [];

    for (const q of quests) {
      const mine = myProgress.get(q.id.toString()) ?? empty;
      const item = q.itemId > 0n ? itemsById.get(q.itemId.toString()) : undefined;
      out.push({
        key: `q${q.id}`,
        kind: "quest",
        id: q.id,
        title: q.title || `Quest #${q.id}`,
        description: q.description ?? "",
        commerce: q.commerce,
        cashback: q.cashback,
        active: q.active,
        item,
        minLevel: Number(q.minLevel),
        minPurchases: Number(q.minPurchases),
        minSpendWei: q.minSpendWei,
        claims: Number(q.claims),
        myPurchases: mine.purchases,
        mySpend: mine.spendWei,
        completed: mine.completed,
        targetUnits: 0, unitsSold: 0, minSpend: 0n, myUnits: 0n, claimed: false, slotsLeft: 0,
      });
    }

    for (const c of campaigns) {
      const mine = myUnits.get(c.id.toString());
      out.push({
        key: `c${c.id}`,
        kind: "campaign",
        id: c.id,
        title: c.title || `Campaign #${c.id}`,
        description: c.description ?? "",
        commerce: c.commerce,
        cashback: c.rewardPerUser,
        active: c.active,
        item: undefined,
        minLevel: 1, minPurchases: 0, minSpendWei: 0n, claims: 0,
        myPurchases: 0, mySpend: 0n, completed: false,
        targetUnits: Number(c.targetUnits),
        unitsSold: Number(c.unitsSold),
        minSpend: c.minSpend,
        myUnits: mine?.units ?? 0n,
        claimed: mine?.claimed ?? false,
        slotsLeft: c.rewardPerUser > 0n ? Number(c.budget / c.rewardPerUser) : 0,
      });
    }

    // Claimable first, then things in progress, then open, then level-locked and finished.
    const rank = (it: BoardItem) => {
      const reached = it.unitsSold >= it.targetUnits;
      if (it.kind === "campaign" && reached && it.myUnits > 0n && !it.claimed) return 0;
      if (it.completed || it.claimed) return 4;
      if (it.kind === "quest" && level < it.minLevel) return 3;
      if (it.myPurchases > 0 || it.myUnits > 0n) return 1;
      return 2;
    };
    return out.sort((a, b) => rank(a) - rank(b) || Number(a.cashback > b.cashback ? -1 : 1));
  }, [quests, campaigns, myProgress, myUnits, level, itemsById]);

  const visible = board.filter((it) => filter === "all" || it.kind === filter);

  /// A payment is always a purchase of one listed item, at that item's exact price.
  async function purchase(item: Item, questId?: bigint) {
    if (!address) return;
    setBusy("pay");
    setErr("");
    try {
      const hash = await onChain(sepolia.id, () =>
        writeContractAsync({
          address: addresses.PaymentToken,
          abi: MockUSDCAbi,
          functionName: "transfer",
          chainId: sepolia.id,
          args: [item.commerce.sepoliaPayout, item.price],
        }),
      );
      addPending(address, {
        txHash: hash,
        payout: item.commerce.sepoliaPayout,
        commerceName: item.commerce.name,
        itemId: item.id.toString(),
        itemName: item.name,
        amountWei: item.price.toString(),
        questIds: questId ? [questId.toString()] : [],
        createdAt: Date.now(),
      });
      setBuy(null);
      setNote(`${item.name} bought. Attestcoin needs ~9 minutes to prove it — track it under Activity.`);
      usdc.refetch();
      refetchItems();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Payment failed");
    } finally {
      setBusy("");
    }
  }

  async function mintUsdc() {
    setBusy("mint");
    setErr("");
    try {
      const hash = await onChain(sepolia.id, () =>
        writeContractAsync({
          address: addresses.PaymentToken,
          abi: MockUSDCAbi,
          functionName: "faucet",
          chainId: sepolia.id,
        }),
      );
      await publicClient?.waitForTransactionReceipt({ hash });
      usdc.refetch();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Faucet failed");
    } finally {
      setBusy("");
    }
  }

  async function claimCampaign(id: bigint) {
    setBusy(`ms${id}`);
    setErr("");
    try {
      const hash = await onChain(creditcoinTestnet.id, () =>
        writeContractAsync({
          address: addresses.MilestoneManager,
          abi: MilestoneManagerAbi,
          functionName: "claim",
          chainId: creditcoinTestnet.id,
          args: [id],
        }),
      );
      await ccClient?.waitForTransactionReceipt({ hash });
      refetchUnits();
      setNote("Cashback claimed — withdraw it from Benefits.");
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Claim failed");
    } finally {
      setBusy("");
    }
  }

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <>
      <div className="section-h">
        <h2>Quest board</h2>
        <span className="tiny dim">{visible.length} available</span>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="row" style={{ gap: 8 }}>
          {([["all", "All"], ["quest", "Personal"], ["campaign", "Community"]] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? "sm" : "ghost sm"} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
          {isConnected && (
            <button className="ghost sm" disabled={busy === "mint"} onClick={mintUsdc}>
              {busy === "mint"
                ? "Minting…"
                : `${usdc.data !== undefined ? usd(usdc.data as bigint) : "—"} · Top up`}
            </button>
          )}
        </div>
      </div>

      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {note && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <div className="between">
            <span>{note}</span>
            <button className="x" onClick={() => setNote("")}>✕</button>
          </div>
        </div>
      )}
      {!isConnected && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          Browsing read-only. Connect a wallet to buy and earn.
        </div>
      )}

      <div className="q-list">
        {visible.length === 0 ? (
          <div className="card empty">Nothing published here yet.</div>
        ) : (
          visible.map((it) => (
            <QuestCard
              key={it.key}
              item={it}
              level={level}
              rateBps={rateBps}
              open={open === it.key}
              onToggle={() => setOpen(open === it.key ? null : it.key)}
              onBuy={() =>
                setBuy({
                  commerceId: it.commerce.id,
                  questId: it.kind === "quest" ? it.id : undefined,
                  itemId: it.item?.id,
                })
              }
              onClaim={() => claimCampaign(it.id)}
              canAct={isConnected}
              busy={busy === `ms${it.id}`}
            />
          ))
        )}
      </div>

      {buy && (
        <BuyModal
          items={itemsByCommerce.get(buy.commerceId.toString()) ?? []}
          preselect={buy.itemId}
          questId={buy.questId}
          balance={usdc.data as bigint | undefined}
          busy={busy === "pay" || switching}
          rateBps={rateBps}
          ctcPerUsd={app.ctcPerUsd}
          onClose={() => setBuy(null)}
          onBuy={(item) => purchase(item, buy.questId)}
        />
      )}
    </>
  );
}
