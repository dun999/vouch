"use client";

/// Pending payments live in localStorage keyed by the payer. Deliberately no database: the only
/// durable state that matters is on Creditcoin, and this is just a reminder of what to claim.
export type Pending = {
  txHash: string;
  payout: string;
  commerceName: string;
  /// The menu item this payment bought, so the claim can consume a unit of its stock.
  itemId: string;
  itemName: string;
  amountWei: string;
  questIds: string[];
  createdAt: number;
};

const key = (addr: string) => `vouch:pending:${addr.toLowerCase()}`;

export function loadPending(addr?: string): Pending[] {
  if (!addr || typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key(addr)) ?? "[]");
  } catch {
    return [];
  }
}

export function addPending(addr: string, p: Pending) {
  const all = loadPending(addr).filter((x) => x.txHash !== p.txHash);
  localStorage.setItem(key(addr), JSON.stringify([p, ...all].slice(0, 25)));
}

export function removePending(addr: string, txHash: string) {
  localStorage.setItem(
    key(addr),
    JSON.stringify(loadPending(addr).filter((x) => x.txHash !== txHash)),
  );
}
