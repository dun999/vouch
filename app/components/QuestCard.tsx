"use client";

import { usd, ctc, shortAddr } from "@/lib/format";
import type { Commerce, Item } from "@/lib/useVouch";
import { Icon, iconForItem } from "./Icon";

/// One row on the quest board. Personal quests and community campaigns are the same shape to the
/// customer — "do this, get CTC back" — so they render through one component and differ only in
/// how progress is counted.
export type BoardItem = {
  key: string;
  kind: "quest" | "campaign";
  id: bigint;
  title: string;
  description: string;
  commerce: Commerce;
  cashback: bigint;
  active: boolean;
  /// The menu item this quest is about, when it names one.
  item?: Item;
  /// Quests only.
  minLevel: number;
  minPurchases: number;
  minSpendWei: bigint;
  claims: number;
  myPurchases: number;
  mySpend: bigint;
  completed: boolean;
  /// Campaigns only.
  targetUnits: number;
  unitsSold: number;
  minSpend: bigint;
  myUnits: bigint;
  claimed: boolean;
  slotsLeft: number;
};

export type QuestCardProps = {
  item: BoardItem;
  level: number;
  /// The buyer's protocol cashback rate, in basis points.
  rateBps: number;
  open: boolean;
  onToggle: () => void;
  onBuy: () => void;
  onClaim: () => void;
  canAct: boolean;
  busy: boolean;
};

/// The one-line status a customer reads before deciding to open the card.
function statusOf(it: BoardItem, level: number) {
  if (it.kind === "campaign") {
    const reached = it.unitsSold >= it.targetUnits;
    if (it.claimed) return { text: "Claimed", cls: "ok" as const };
    if (reached && it.myUnits > 0n) return { text: "Ready to claim", cls: "ok" as const };
    if (reached) return { text: "Unlocked", cls: "ok" as const };
    if (it.myUnits > 0n) return { text: "You're in", cls: "acc" as const };
    return { text: `${it.unitsSold} of ${it.targetUnits} sold`, cls: "wait" as const };
  }
  if (it.completed) return { text: "Completed", cls: "ok" as const };
  if (level < it.minLevel) return { text: `Needs level ${it.minLevel}`, cls: "" as const };
  if (it.item && it.item.stock - it.item.sold <= 0) return { text: "Sold out", cls: "" as const };
  if (!it.active) return { text: "Paused", cls: "" as const };
  if (it.myPurchases > 0) return { text: "In progress", cls: "acc" as const };
  return { text: "Available", cls: "" as const };
}

/// "1 of 2 purchases", "$3.00 of $5.00" — whichever bar the quest actually gates on.
function progressOf(it: BoardItem) {
  if (it.kind === "campaign") {
    return {
      pct: Math.min(100, (it.unitsSold / Math.max(1, it.targetUnits)) * 100),
      left: `${it.unitsSold} of ${it.targetUnits} verified purchases`,
      right: `${it.slotsLeft} reward${it.slotsLeft === 1 ? "" : "s"} left`,
    };
  }
  if (it.minPurchases > 0) {
    const unit = it.item ? it.item.name : "purchases";
    return {
      pct: Math.min(100, (it.myPurchases / Math.max(1, it.minPurchases)) * 100),
      left: `${it.myPurchases} of ${it.minPurchases} ${unit}`,
      right: `${it.claims} completed`,
    };
  }
  const pct = it.minSpendWei > 0n ? Number((it.mySpend * 100n) / it.minSpendWei) : 0;
  return {
    pct: Math.min(100, pct),
    left: `${usd(it.mySpend)} of ${usd(it.minSpendWei)} spent`,
    right: `${it.claims} completed`,
  };
}

/// Reads as a shopping instruction: "Buy 2 x Flat White", never "spend $5 on something".
function requirement(it: BoardItem) {
  if (it.kind === "campaign") {
    return it.minSpend > 0n
      ? `${it.targetUnits} purchases of ${usd(it.minSpend)} or more, from anyone`
      : `${it.targetUnits} verified purchases, from anyone`;
  }
  const parts: string[] = [];
  if (it.minPurchases > 0) {
    parts.push(
      it.item
        ? `Buy ${it.minPurchases} × ${it.item.name}`
        : `${it.minPurchases} purchase${it.minPurchases === 1 ? "" : "s"} here`,
    );
  }
  if (it.minSpendWei > 0n) parts.push(`${usd(it.minSpendWei)} total spend`);
  return parts.join(" and ");
}

export function QuestCard({ item, level, rateBps, open, onToggle, onBuy, onClaim, canAct, busy }: QuestCardProps) {
  const locked = item.kind === "quest" && level < item.minLevel;
  const status = statusOf(item, level);
  const prog = progressOf(item);
  const reached = item.unitsSold >= item.targetUnits;
  const claimable = item.kind === "campaign" && reached && item.myUnits > 0n && !item.claimed;
  const soldOut = !!item.item && item.item.stock - item.item.sold <= 0;

  return (
    <div className={`q-item ${open ? "open" : ""} ${locked ? "locked" : ""}`}>
      <button className="q-head" onClick={onToggle} aria-expanded={open}>
        <span className={`q-ico ${item.kind === "campaign" ? "comm" : ""}`}>
          <Icon name={item.kind === "campaign" ? "users" : item.item ? iconForItem(item.item.name) : "ticket"} size={24} />
        </span>
        <span className="q-main">
          <span className="q-title" style={{ display: "block" }}>{item.title}</span>
          <span className="q-sub" style={{ display: "block" }}>
            {item.commerce.name}
            {item.item ? ` · ${item.minPurchases} × ${item.item.name}` : ""}
            {" · "}
            {item.kind === "campaign" ? "Community campaign" : "Personal quest"}
          </span>
        </span>
        <span className="q-side">
          <span className={`pill ${status.cls}`}>{status.text}</span>
          <span className="q-reward">
            <span className="q-reward-v">{ctc(item.cashback)} CTC</span>
            <span className="tiny dim" style={{ display: "block" }}>cashback</span>
          </span>
          <span className="q-chev">▾</span>
        </span>
      </button>

      {open && (
        <div className="q-body">
          {item.description && <div className="q-desc">{item.description}</div>}

          <div className="bar">
            <i style={{ width: `${prog.pct}%` }} />
          </div>
          <div className="between tiny dim" style={{ marginTop: 8, marginBottom: 22 }}>
            <span>{prog.left}</span>
            <span>{prog.right}</span>
          </div>

          <div className="q-cols">
            <div className="q-block">
              <div className="label">How to complete</div>
              <div className="kv">
                <div className="kv-row">
                  <span>Requirement</span>
                  <span>{requirement(item)}</span>
                </div>
                {item.item && (
                  <>
                    <div className="kv-row">
                      <span>Item price</span>
                      <span>{usd(item.item.price)} each</span>
                    </div>
                    <div className="kv-row">
                      <span>Stock left</span>
                      <span className={item.item.stock - item.item.sold <= 5 ? "sold-low" : ""}>
                        {Math.max(0, item.item.stock - item.item.sold)} of {item.item.stock}
                      </span>
                    </div>
                  </>
                )}
                {item.kind === "quest" && (
                  <div className="kv-row">
                    <span>Level gate</span>
                    <span>{item.minLevel > 1 ? `Level ${item.minLevel} and up` : "Open to everyone"}</span>
                  </div>
                )}
                <div className="kv-row">
                  <span>Counts when</span>
                  <span>Attestcoin proves the payment</span>
                </div>
              </div>
            </div>

            <div className="q-block">
              <div className="label">What you earn</div>
              <div className="kv">
                <div className="kv-row">
                  <span>Merchant cashback</span>
                  <span style={{ color: "var(--green)" }}>{ctc(item.cashback)} CTC</span>
                </div>
                <div className="kv-row">
                  <span>App cashback</span>
                  <span style={{ color: rateBps > 0 ? "var(--green)" : undefined }}>
                    {rateBps > 0 ? `${rateBps / 100}% of spend, in CTC` : "Level 2 and up"}
                  </span>
                </div>
                <div className="kv-row">
                  <span>Stars</span>
                  <span>10 stars per $1 spent</span>
                </div>
                <div className="kv-row">
                  <span>Paid</span>
                  <span>{item.kind === "campaign" ? "On claim, once unlocked" : "On completion"}</span>
                </div>
              </div>
              <div className="hint">
                Two pots: the merchant funds the quest reward, the app pays your level rate on every
                purchase. Neither can grant stars — your level only ever tracks what you spent.
              </div>
            </div>

            <div className="q-block">
              <div className="label">Merchant</div>
              <div className="kv">
                <div className="kv-row">
                  <span>Storefront</span>
                  <span>{item.commerce.name}</span>
                </div>
                <div className="kv-row">
                  <span>Status</span>
                  <span className={item.commerce.active ? "" : "dim"}>
                    {item.commerce.active ? "Open" : "Closed"}
                  </span>
                </div>
                <div className="kv-row">
                  <span>Storefront ID</span>
                  <span className="mono">#{item.commerce.id.toString()}</span>
                </div>
              </div>
              <div className="label" style={{ margin: "14px 0 7px" }}>Sepolia payout address</div>
              <div className="addr" title={item.commerce.sepoliaPayout}>
                {item.commerce.sepoliaPayout}
              </div>
              <div className="hint">Your USDC goes straight here. Nothing is escrowed.</div>
            </div>
          </div>

          <div className="q-actions">
            {claimable ? (
              <button disabled={!canAct || busy} onClick={onClaim}>
                {busy ? "Claiming…" : `Claim ${ctc(item.cashback)} CTC`}
              </button>
            ) : locked ? (
              <span className="pill">Reach level {item.minLevel} to unlock this quest</span>
            ) : item.completed || item.claimed ? (
              <span className="pill ok">
                <i className="dot" /> Done — reward is in your Benefits balance
              </span>
            ) : soldOut ? (
              <span className="pill">Sold out — waiting on a restock</span>
            ) : (
              <button disabled={!canAct || !item.active || !item.commerce.active} onClick={onBuy}>
                {item.item ? `Buy ${item.item.name} · ${usd(item.item.price)}` : `Order from ${item.commerce.name}`}
              </button>
            )}
            {!claimable && !item.completed && (
              <span className="tiny dim">Paid in USDC on Sepolia to {shortAddr(item.commerce.sepoliaPayout)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
