"use client";

import { useReadContract, useReadContracts } from "wagmi";
import {
  CommerceRegistryAbi,
  BenefitPassAbi,
  VouchCoreAbi,
  QuestManagerAbi,
  RewardVaultAbi,
  MilestoneManagerAbi,
  CatalogAbi,
  PriceOracleAbi,
  AppCashbackAbi,
  MockUSDCAbi,
} from "./abis";
import { addresses, isDeployed } from "./addresses";
import { creditcoinTestnet, sepolia } from "./chains";

const chainId = creditcoinTestnet.id;

export function useProfile(address?: `0x${string}`) {
  return useReadContract({
    address: addresses.VouchCore,
    abi: VouchCoreAbi,
    functionName: "profileOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isDeployed && !!address, refetchInterval: 8000 },
  });
}

export function useLevelThresholds() {
  return useReadContract({
    address: addresses.VouchCore,
    abi: VouchCoreAbi,
    functionName: "getLevelThresholds",
    chainId,
    query: { enabled: isDeployed },
  });
}

export function useClaimable(address?: `0x${string}`) {
  return useReadContract({
    address: addresses.RewardVault,
    abi: RewardVaultAbi,
    functionName: "claimable",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isDeployed && !!address, refetchInterval: 8000 },
  });
}

/// The protocol-funded cashback stream: the level ladder, your balance, and the live CTC price.
export function useAppCashback(address?: `0x${string}`) {
  const res = useReadContracts({
    contracts: [
      { address: addresses.AppCashback, abi: AppCashbackAbi, functionName: "getLevelRates", chainId },
      { address: addresses.AppCashback, abi: AppCashbackAbi, functionName: "claimable", args: [address!], chainId },
      { address: addresses.PriceOracle, abi: PriceOracleAbi, functionName: "readRate", chainId },
      { address: addresses.PriceOracle, abi: PriceOracleAbi, functionName: "isManual", chainId },
      { address: addresses.AppCashback, abi: AppCashbackAbi, functionName: "treasury", chainId },
      { address: addresses.AppCashback, abi: AppCashbackAbi, functionName: "totalClaimable", chainId },
    ],
    query: { enabled: isDeployed, refetchInterval: 10000 },
  });

  const ok = (i: number) => res.data?.[i]?.status === "success";
  const rate = ok(2) ? (res.data![2].result as readonly [bigint, boolean]) : undefined;
  const treasury = ok(4) ? (res.data![4].result as bigint) : 0n;
  const owed = ok(5) ? (res.data![5].result as bigint) : 0n;

  return {
    /// Basis points per level, index 0 == level 1.
    rates: (ok(0) ? (res.data![0].result as readonly number[]) : []) as readonly number[],
    claimable: ok(1) ? (res.data![1].result as bigint) : 0n,
    /// CTC wei per whole US dollar.
    ctcPerUsd: rate?.[0] ?? 0n,
    priceIsFresh: rate?.[1] ?? false,
    priceIsManual: ok(3) ? (res.data![3].result as boolean) : false,
    /// What the treasury can still promise.
    unreserved: treasury > owed ? treasury - owed : 0n,
    refetch: res.refetch,
  };
}

export function useMilestoneClaimable(address?: `0x${string}`) {
  return useReadContract({
    address: addresses.MilestoneManager,
    abi: MilestoneManagerAbi,
    functionName: "claimable",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isDeployed && !!address, refetchInterval: 8000 },
  });
}

/// USDC balance on Sepolia — what the user can actually spend.
export function useUsdcBalance(address?: `0x${string}`) {
  return useReadContract({
    address: addresses.PaymentToken,
    abi: MockUSDCAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: sepolia.id,
    query: { enabled: isDeployed && !!address, refetchInterval: 10000 },
  });
}

export type Commerce = {
  id: bigint;
  owner: `0x${string}`;
  sepoliaPayout: `0x${string}`;
  name: string;
  metadataURI: string;
  active: boolean;
};

/// Merchants are enumerated from the registry counter — fine at hackathon scale, no indexer.
export function useCommerces() {
  const total = useReadContract({
    address: addresses.CommerceRegistry,
    abi: CommerceRegistryAbi,
    functionName: "totalCommerces",
    chainId,
    query: { enabled: isDeployed },
  });

  const n = Number(total.data ?? 0n);
  const list = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      address: addresses.CommerceRegistry,
      abi: CommerceRegistryAbi,
      functionName: "getCommerce" as const,
      args: [BigInt(i + 1)],
      chainId,
    })),
    query: { enabled: isDeployed && n > 0 },
  });

  const commerces = (list.data ?? [])
    .map((r, i) => (r.status === "success" ? ({ id: BigInt(i + 1), ...(r.result as any) } as Commerce) : null))
    .filter(Boolean) as Commerce[];

  return {
    commerces,
    isLoading: total.isLoading || list.isLoading,
    refetch: () => {
      total.refetch();
      list.refetch();
    },
  };
}

function useIdList(address: `0x${string}`, abi: any, listFn: string, itemFn: string, arg?: bigint) {
  const ids = useReadContract({
    address,
    abi,
    functionName: listFn,
    args: arg !== undefined ? [arg] : undefined,
    chainId,
    query: { enabled: isDeployed && arg !== undefined },
  });

  const idList = (ids.data as bigint[] | undefined) ?? [];
  const list = useReadContracts({
    contracts: idList.map((id) => ({ address, abi, functionName: itemFn, args: [id], chainId })),
    query: { enabled: isDeployed && idList.length > 0 },
  });

  const items = (list.data ?? [])
    .map((r, i) => (r.status === "success" ? { id: idList[i], ...(r.result as any) } : null))
    .filter(Boolean) as any[];

  return {
    items,
    refetch: () => {
      ids.refetch();
      list.refetch();
    },
  };
}

export function useQuestsOf(commerceId?: bigint) {
  const { items, refetch } = useIdList(
    addresses.QuestManager, QuestManagerAbi, "questsOfCommerce", "getQuest", commerceId,
  );
  return { quests: items, refetch };
}

export type Item = {
  id: bigint;
  commerceId: bigint;
  name: string;
  description: string;
  price: bigint;
  stock: number;
  sold: number;
  active: boolean;
  commerce: Commerce;
};

/// Every listed menu item across every merchant. This is what a customer actually buys.
export function useAllItems(commerces: Commerce[]) {
  const per = useReadContracts({
    contracts: commerces.map((c) => ({
      address: addresses.Catalog,
      abi: CatalogAbi,
      functionName: "itemsOfCommerce" as const,
      args: [c.id],
      chainId,
    })),
    query: { enabled: isDeployed && commerces.length > 0 },
  });

  const flat: { id: bigint; commerce: Commerce }[] = [];
  (per.data ?? []).forEach((r, i) => {
    if (r.status !== "success") return;
    (r.result as bigint[]).forEach((id) => flat.push({ id, commerce: commerces[i] }));
  });

  const details = useReadContracts({
    contracts: flat.map((f) => ({
      address: addresses.Catalog,
      abi: CatalogAbi,
      functionName: "getItem" as const,
      args: [f.id],
      chainId,
    })),
    query: { enabled: isDeployed && flat.length > 0, refetchInterval: 10000 },
  });

  const items = (details.data ?? [])
    .map((r, i) =>
      r.status === "success"
        ? ({
            id: flat[i].id,
            commerce: flat[i].commerce,
            ...(r.result as any),
            stock: Number((r.result as any).stock),
            sold: Number((r.result as any).sold),
          } as Item)
        : null,
    )
    .filter(Boolean) as Item[];

  return { items, isLoading: per.isLoading || details.isLoading, refetch: () => { per.refetch(); details.refetch(); } };
}

/// One merchant's menu, for the merchant console.
export function useItemsOf(commerceId?: bigint) {
  const { items, refetch } = useIdList(
    addresses.Catalog, CatalogAbi, "itemsOfCommerce", "getItem", commerceId,
  );
  return {
    items: items.map((i) => ({ ...i, stock: Number(i.stock), sold: Number(i.sold) })),
    refetch,
  };
}

export function useMilestonesOf(commerceId?: bigint) {
  const { items, refetch } = useIdList(
    addresses.MilestoneManager, MilestoneManagerAbi, "campaignsOfCommerce", "getCampaign", commerceId,
  );
  return { campaigns: items, refetch };
}

/// Every quest across every merchant — the quest board.
export function useAllQuests(commerces: Commerce[]) {
  const perCommerce = useReadContracts({
    contracts: commerces.map((c) => ({
      address: addresses.QuestManager,
      abi: QuestManagerAbi,
      functionName: "questsOfCommerce" as const,
      args: [c.id],
      chainId,
    })),
    query: { enabled: isDeployed && commerces.length > 0 },
  });

  const flat: { questId: bigint; commerce: Commerce }[] = [];
  (perCommerce.data ?? []).forEach((r, i) => {
    if (r.status !== "success") return;
    (r.result as bigint[]).forEach((qid) => flat.push({ questId: qid, commerce: commerces[i] }));
  });

  const details = useReadContracts({
    contracts: flat.map((f) => ({
      address: addresses.QuestManager,
      abi: QuestManagerAbi,
      functionName: "getQuest" as const,
      args: [f.questId],
      chainId,
    })),
    query: { enabled: isDeployed && flat.length > 0 },
  });

  const quests = (details.data ?? [])
    .map((r, i) => (r.status === "success" ? { id: flat[i].questId, commerce: flat[i].commerce, ...(r.result as any) } : null))
    .filter(Boolean) as any[];

  return { quests, isLoading: perCommerce.isLoading || details.isLoading };
}

/// Every milestone campaign across every merchant.
export function useAllMilestones(commerces: Commerce[]) {
  const per = useReadContracts({
    contracts: commerces.map((c) => ({
      address: addresses.MilestoneManager,
      abi: MilestoneManagerAbi,
      functionName: "campaignsOfCommerce" as const,
      args: [c.id],
      chainId,
    })),
    query: { enabled: isDeployed && commerces.length > 0 },
  });

  const flat: { id: bigint; commerce: Commerce }[] = [];
  (per.data ?? []).forEach((r, i) => {
    if (r.status !== "success") return;
    (r.result as bigint[]).forEach((id) => flat.push({ id, commerce: commerces[i] }));
  });

  const details = useReadContracts({
    contracts: flat.map((f) => ({
      address: addresses.MilestoneManager,
      abi: MilestoneManagerAbi,
      functionName: "getCampaign" as const,
      args: [f.id],
      chainId,
    })),
    query: { enabled: isDeployed && flat.length > 0, refetchInterval: 10000 },
  });

  const campaigns = (details.data ?? [])
    .map((r, i) => (r.status === "success" ? { id: flat[i].id, commerce: flat[i].commerce, ...(r.result as any) } : null))
    .filter(Boolean) as any[];

  return { campaigns };
}

export function useMyMilestoneUnits(campaignIds: bigint[], address?: `0x${string}`) {
  const res = useReadContracts({
    contracts: campaignIds.flatMap((id) => [
      {
        address: addresses.MilestoneManager,
        abi: MilestoneManagerAbi,
        functionName: "unitsOf" as const,
        args: [id, address!],
        chainId,
      },
      {
        address: addresses.MilestoneManager,
        abi: MilestoneManagerAbi,
        functionName: "claimed" as const,
        args: [id, address!],
        chainId,
      },
    ]),
    query: { enabled: isDeployed && !!address && campaignIds.length > 0, refetchInterval: 10000 },
  });

  const map = new Map<string, { units: bigint; claimed: boolean }>();
  campaignIds.forEach((id, i) => {
    const u = res.data?.[i * 2];
    const c = res.data?.[i * 2 + 1];
    map.set(id.toString(), {
      units: u?.status === "success" ? (u.result as bigint) : 0n,
      claimed: c?.status === "success" ? (c.result as boolean) : false,
    });
  });
  return { map, refetch: res.refetch };
}

/// Per-user progress on a set of quests: how far along, and whether it is already finished.
export function useMyQuestProgress(questIds: bigint[], address?: `0x${string}`) {
  const res = useReadContracts({
    contracts: questIds.flatMap((id) => [
      {
        address: addresses.QuestManager,
        abi: QuestManagerAbi,
        functionName: "progressOf" as const,
        args: [address!, id],
        chainId,
      },
      {
        address: addresses.QuestManager,
        abi: QuestManagerAbi,
        functionName: "completedBy" as const,
        args: [address!, id],
        chainId,
      },
    ]),
    query: { enabled: isDeployed && !!address && questIds.length > 0, refetchInterval: 10000 },
  });

  const map = new Map<string, { purchases: number; spendWei: bigint; completed: boolean }>();
  questIds.forEach((id, i) => {
    const prog = res.data?.[i * 2];
    const done = res.data?.[i * 2 + 1];
    const tuple = prog?.status === "success" ? (prog.result as readonly [number, bigint]) : undefined;
    map.set(id.toString(), {
      purchases: tuple ? Number(tuple[0]) : 0,
      spendWei: tuple ? tuple[1] : 0n,
      completed: done?.status === "success" ? (done.result as boolean) : false,
    });
  });
  return { map, refetch: res.refetch };
}

/// The pass's on-chain art, decoded from its data: tokenURI. Nothing is fetched off-chain.
export function usePassArt(address?: `0x${string}`) {
  const tokenId = useReadContract({
    address: addresses.BenefitPass,
    abi: BenefitPassAbi,
    functionName: "tokenOfOwner",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isDeployed && !!address },
  });

  const id = (tokenId.data as bigint | undefined) ?? 0n;
  const uri = useReadContract({
    address: addresses.BenefitPass,
    abi: BenefitPassAbi,
    functionName: "tokenURI",
    args: [id],
    chainId,
    query: { enabled: isDeployed && id > 0n, refetchInterval: 15000 },
  });

  let image: string | undefined;
  const raw = uri.data as string | undefined;
  if (raw?.startsWith("data:application/json;base64,")) {
    try {
      const json = JSON.parse(atob(raw.slice("data:application/json;base64,".length)));
      image = json.image;
    } catch {
      /* a malformed tokenURI should not take the page down */
    }
  }
  return { tokenId: id, image };
}

export type Receipt = {
  user: `0x${string}`;
  commercePayout: `0x${string}`;
  commerceId: bigint;
  itemId: bigint;
  amount: bigint;
  sourceHeight: bigint;
  sourceTxIndex: bigint;
  timestamp: bigint;
  starsEarned: bigint;
  cashbackEarned: bigint;
  levelAfter: number;
};

export function useReceipts(address?: `0x${string}`) {
  const ids = useReadContract({
    address: addresses.VouchCore,
    abi: VouchCoreAbi,
    functionName: "receiptsOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isDeployed && !!address, refetchInterval: 10000 },
  });

  const idList = (ids.data as bigint[] | undefined) ?? [];
  // getReceipt returns the struct. The `receipts` mapping getter's positional tuple silently
  // reshuffles whenever a field is added, which is exactly how `itemId` broke this page once.
  const list = useReadContracts({
    contracts: idList.map((rid) => ({
      address: addresses.VouchCore,
      abi: VouchCoreAbi,
      functionName: "getReceipt" as const,
      args: [rid],
      chainId,
    })),
    query: { enabled: isDeployed && idList.length > 0 },
  });

  const receipts = (list.data ?? [])
    .map((r, i) => (r.status === "success" ? { id: idList[i], v: r.result as any } : null))
    .filter(Boolean) as Array<{ id: bigint; v: Receipt }>;

  return { receipts: [...receipts].reverse(), refetch: () => { ids.refetch(); list.refetch(); } };
}
