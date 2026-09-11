"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { VouchCoreAbi } from "./abis";
import { addresses } from "./addresses";
import { CC_LOGS_RPC, creditcoinTestnet } from "./chains";

/// Users are discovered, not enumerated: VouchCore keeps profiles in a mapping with no registry,
/// so the board collects every address that ever emitted progression events and reads their
/// current profile. Unfiltered log scans only — the Blockscout eth-rpc mirror answers those;
/// user-filtered topics incorrectly return empty (see lib/provenance.ts).
const PURCHASED = parseAbiItem(
  "event PurchaseVerified(uint256 indexed receiptId, address indexed user, uint256 indexed commerceId, uint256 amount, uint64 sourceHeight, uint64 sourceTxIndex, uint256 starsEarned, uint256 cashbackEarned, uint32 levelAfter)",
);
const CHECKED_IN = parseAbiItem(
  "event CheckedIn(address indexed user, uint32 streak, uint256 starsEarned)",
);
const LEVELED_UP = parseAbiItem(
  "event LevelUp(address indexed user, uint32 fromLevel, uint32 toLevel)",
);

const ccLogs = createPublicClient({
  chain: creditcoinTestnet,
  transport: http(CC_LOGS_RPC, { timeout: 20_000 }),
});

export type LeaderRow = {
  address: Address;
  stars: bigint;
  level: number;
  purchaseCount: number;
  verifiedSpend: bigint;
  questsCompleted: number;
  streak: number;
  totalCashback: bigint;
};

const MAX_USERS = 100;
/// Tab-lifetime cache with stale-while-revalidate: remounts (page switches) render instantly
/// from the last board while a background refresh keeps rankings honest.
let boardCache: { rows: LeaderRow[]; at: number } | null = null;
let inflight: Promise<LeaderRow[]> | null = null;

async function fetchBoard(): Promise<LeaderRow[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    const [purchased, checkedIn, leveledUp] = await Promise.all([
      ccLogs.getLogs({ address: addresses.VouchCore, event: PURCHASED, fromBlock: 0n, toBlock: "latest" }),
      ccLogs.getLogs({ address: addresses.VouchCore, event: CHECKED_IN, fromBlock: 0n, toBlock: "latest" }),
      ccLogs.getLogs({ address: addresses.VouchCore, event: LEVELED_UP, fromBlock: 0n, toBlock: "latest" }),
    ]);

    const seen = new Map<string, Address>();
    for (const log of [...purchased, ...checkedIn, ...leveledUp]) {
      const u = (log.args as { user?: string } | undefined)?.user;
      if (u) seen.set(u.toLowerCase(), u as Address);
    }
    const users = [...seen.values()].slice(0, MAX_USERS);

    const profiles = await Promise.all(
      users.map((u) =>
        ccLogs
          .readContract({ address: addresses.VouchCore, abi: VouchCoreAbi, functionName: "profileOf", args: [u] })
          .then((prof: any) => ({
            address: u,
            stars: BigInt(prof.stars ?? 0),
            level: Number(prof.level ?? 1) || 1,
            purchaseCount: Number(prof.purchaseCount ?? 0),
            verifiedSpend: BigInt(prof.verifiedSpend ?? 0),
            questsCompleted: Number(prof.questsCompleted ?? 0),
            streak: Number(prof.streak ?? 0),
            totalCashback: BigInt(prof.totalCashback ?? 0),
          }))
          .catch(() => null),
      ),
    );

    const out = profiles.filter((r): r is LeaderRow => r !== null);
    out.sort((a, b) => (b.stars > a.stars ? 1 : b.stars < a.stars ? -1 : 0));
    boardCache = { rows: out, at: Date.now() };
    return out;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function useLeaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>(() => boardCache?.rows ?? []);
  const [isLoading, setLoading] = useState(() => boardCache === null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    fetchBoard().then(
      (out) => {
        if (live) {
          setRows(out);
          setLoading(false);
        }
      },
      (e) => {
        // Cached rows stay on screen; only a cache-less failure surfaces an error.
        if (live) {
          if (boardCache === null) setError(e instanceof Error ? e.message : "Leaderboard lookup failed");
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [nonce]);

  return { rows, isLoading, error, refetch: () => setNonce((n) => n + 1) };
}
