"use client";

import { useEffect, useState } from "react";
import { usd, ctc, shortAddr } from "@/lib/format";
import type { Item } from "@/lib/useVouch";
import { Icon, iconForItem } from "./Icon";

const STARS_PER_DOLLAR = 10;

/// Buying is picking a listed item at its listed price, not typing a number into a box. The old
/// "spend $5" flow left the customer with no idea what the $5 was for.
export function BuyModal({
  items,
  preselect,
  questId,
  balance,
  busy,
  rateBps,
  ctcPerUsd,
  onClose,
  onBuy,
}: {
  items: Item[];
  preselect?: bigint;
  questId?: bigint;
  balance?: bigint;
  busy: boolean;
  /// The buyer's app-cashback rate in basis points, and the live CTC price.
  rateBps: number;
  ctcPerUsd: bigint;
  onClose: () => void;
  onBuy: (item: Item) => void;
}) {
  const sellable = items.filter((i) => i.active && i.stock > i.sold);
  const [chosen, setChosen] = useState<string | undefined>(
    preselect?.toString() ?? sellable[0]?.id.toString(),
  );

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const item = sellable.find((i) => i.id.toString() === chosen) ?? sellable[0];
  const merchant = items[0]?.commerce;
  const short = balance !== undefined && item !== undefined && balance < item.price;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h between">
          <div>
            <div style={{ fontWeight: 640, fontSize: 17 }}>{merchant?.name ?? "Menu"}</div>
            <div className="tiny dim">
              {questId ? `Counts toward quest #${questId}` : "Pick what you're buying"}
            </div>
          </div>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="modal-b">
          {sellable.length === 0 ? (
            <div className="empty" style={{ padding: 28 }}>
              Everything here is sold out. Check back when the merchant restocks.
            </div>
          ) : (
            <>
              <div className="menu">
                {sellable.map((i) => {
                  const left = i.stock - i.sold;
                  const on = item?.id === i.id;
                  return (
                    <button
                      key={i.id.toString()}
                      className={`menu-row ${on ? "on" : ""}`}
                      onClick={() => setChosen(i.id.toString())}
                    >
                      <span className="menu-ico"><Icon name={iconForItem(i.name)} size={22} /></span>
                      <span className="menu-main">
                        <span className="menu-name">{i.name}</span>
                        {i.description && <span className="menu-desc">{i.description}</span>}
                        <span className={`menu-stock ${left <= 5 ? "low" : ""}`}>
                          {left} of {i.stock} left
                        </span>
                      </span>
                      <span className="menu-price">{usd(i.price)}</span>
                    </button>
                  );
                })}
              </div>

              {item && (
                <>
                  <div className="banner" style={{ margin: "20px 0" }}>
                    <div className="kv">
                      <div className="kv-row">
                        <span>You pay</span>
                        <span>{usd(item.price)} USDC on Sepolia</span>
                      </div>
                      <div className="kv-row">
                        <span>Stars once verified</span>
                        <span>
                          +{Math.round((Number(item.price) / 1e6) * STARS_PER_DOLLAR)} stars
                        </span>
                      </div>
                      <div className="kv-row">
                        <span>Cashback at your level</span>
                        <span style={{ color: rateBps > 0 ? "var(--green)" : undefined }}>
                          {rateBps > 0 && ctcPerUsd > 0n
                            ? `${rateBps / 100}% · ${ctc((item.price * ctcPerUsd * BigInt(rateBps)) / 1000000n / 10000n)} CTC`
                            : rateBps > 0
                              ? `${rateBps / 100}% · price feed unavailable`
                              : "Reach level 2 to start earning a rate"}
                        </span>
                      </div>
                      <div className="kv-row">
                        <span>Goes to</span>
                        <span className="mono">{shortAddr(item.commerce.sepoliaPayout)}</span>
                      </div>
                    </div>
                    <div className="hint">
                      One unit of stock is reserved only when Attestcoin proves the payment — about
                      9 minutes.
                    </div>
                  </div>

                  {short && (
                    <div className="banner warn" style={{ marginBottom: 16 }}>
                      Your USDC balance is below {usd(item.price)}. Top up from the quest board.
                    </div>
                  )}

                  <button
                    className="lg"
                    style={{ width: "100%" }}
                    disabled={busy || short}
                    onClick={() => onBuy(item)}
                  >
                    {busy ? "Sending…" : `Buy ${item.name} · ${usd(item.price)}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
