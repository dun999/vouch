"use client";

import type { ReactNode } from "react";

/// Line icons drawn on a 24x24 grid, 1.75 stroke, round caps — the shared convention that
/// Feather/Lucide-style sets use, so they read at 16px without hinting.
///
/// Every one is a *thing in this product*: the shop you buy from, the menu you buy off, the
/// voucher the quest hands you, the receipt Attestcoin proves. Abstract diamonds and triangles
/// told the user nothing.
const PATHS: Record<string, ReactNode> = {
  // A shop with a striped awning. Merchants, storefronts.
  storefront: (
    <>
      <path d="M2.6 10.4 4.4 4.5A1 1 0 0 1 5.4 3.8h13.2a1 1 0 0 1 1 .7l1.8 5.9" />
      <path d="M4.6 10.4V20a1.2 1.2 0 0 0 1.2 1.2h12.4A1.2 1.2 0 0 0 19.4 20v-9.6" />
      <path d="M2.6 10.4h18.8" />
      <path d="M8.4 3.8 7.6 10.4M12 3.8v6.6M15.6 3.8l.8 6.6" />
      <path d="M9.7 21.2v-5.4h4.6v5.4" />
    </>
  ),
  // A menu card: heading rule, then priced lines. What the merchant lists.
  menu: (
    <>
      <rect x="3.6" y="2.6" width="16.8" height="18.8" rx="2" />
      <path d="M7.6 6.6h8.8" />
      <path d="M7.6 10.8h5.4M15.4 10.8h1.2" />
      <path d="M7.6 14.4h5.4M15.4 14.4h1.2" />
      <path d="M7.6 18h3.6M15.4 18h1.2" />
    </>
  ),
  // A torn-off ticket. A quest is a voucher for one specific item.
  ticket: (
    <>
      <path d="M4.2 6h15.6a1.6 1.6 0 0 1 1.6 1.6v2.9a1.5 1.5 0 0 0 0 3v2.9a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6v-2.9a1.5 1.5 0 0 0 0-3V7.6A1.6 1.6 0 0 1 4.2 6Z" />
      <path d="M15 6v12" strokeDasharray="1.5 2" />
      <path d="M6.4 12h5" />
    </>
  ),
  // Three people. A community campaign only unlocks if enough of them show up.
  users: (
    <>
      <circle cx="9" cy="8.4" r="3.1" />
      <path d="M3.4 20.2a5.6 5.6 0 0 1 11.2 0" />
      <path d="M16.4 5.7a3.1 3.1 0 0 1 0 5.4" />
      <path d="M17.4 14.4a5.6 5.6 0 0 1 3.2 5.8" />
    </>
  ),
  // A paper receipt with a torn edge — the same object the Benefit Pass art is built around.
  receipt: (
    <>
      <path d="M5.8 2.8h12.4v17l-2.1-1.4-2 1.4-2.1-1.4-2 1.4-2.1-1.4-2 1.4Z" />
      <path d="M8.8 7.4h6.4M8.8 11h6.4M8.8 14.6h4" />
    </>
  ),
  // A medal on a ribbon. Levels and the perks they unlock.
  medal: (
    <>
      <path d="M7.5 13.4 3.8 6.9a1.6 1.6 0 0 1 .1-1.7l1.2-1.7a1.6 1.6 0 0 1 1.3-.7h11.2a1.6 1.6 0 0 1 1.3.7l1.2 1.7a1.6 1.6 0 0 1 .1 1.7l-3.7 6.5" />
      <path d="M8.4 3.4 11.5 8.8M15.6 3.4 12.5 8.8" />
      <circle cx="12" cy="16.4" r="5.1" />
    </>
  ),
  // A membership card with a portrait band. The Benefit Pass itself.
  pass: (
    <>
      <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.2" />
      <path d="M2.6 9.2h18.8" />
      <circle cx="8" cy="13.6" r="1.9" />
      <path d="M5.4 17.4a3 3 0 0 1 5.2 0" />
      <path d="M13.6 12.6h4.6M13.6 15.6h3" />
    </>
  ),
  // A shopping bag. The customer side of the app.
  bag: (
    <>
      <path d="M4.6 8h14.8l1 12.2a1.2 1.2 0 0 1-1.2 1.3H4.8a1.2 1.2 0 0 1-1.2-1.3Z" />
      <path d="M8.9 10.6V6.9a3.1 3.1 0 0 1 6.2 0v3.7" />
    </>
  ),
  // A stamped seal. Attestcoin proved it.
  seal: (
    <>
      <circle cx="12" cy="9.4" r="6.2" />
      <path d="M9.3 9.5l1.8 1.9 3.6-4" />
      <path d="M8 14.8 6.4 21.4 12 18.6l5.6 2.8L16 14.8" />
    </>
  ),
  // A padlock, open. Level gates that have lifted.
  unlocked: (
    <>
      <rect x="4.4" y="10.6" width="15.2" height="10.4" rx="2" />
      <path d="M8.4 10.6V7.4a3.6 3.6 0 0 1 7-1.2" />
      <path d="M12 14.6v2.6" />
    </>
  ),
  // A rosette. Founding standing on the pass.
  rosette: (
    <>
      <path d="M12 2.8l2.4 1.7 2.9-.3 1 2.8 2.4 1.7-1 2.8 1 2.8-2.4 1.7-1 2.8-2.9-.3L12 20.5l-2.4-1.7-2.9.3-1-2.8-2.4-1.7 1-2.8-1-2.8 2.4-1.7 1-2.8 2.9.3Z" />
      <path d="M9.4 11.6l1.9 2 3.5-4" />
    </>
  ),
  // A stopwatch. Early access, before everyone else.
  early: (
    <>
      <circle cx="12" cy="13.4" r="7.6" />
      <path d="M12 9.2v4.2l2.8 1.8" />
      <path d="M9.4 2.6h5.2M12 2.6v3.2" />
    </>
  ),
  // Stacked coins. Cashback.
  coins: (
    <>
      <circle cx="9.2" cy="14.4" r="6.4" />
      <circle cx="9.2" cy="14.4" r="2.3" />
      <circle cx="16.2" cy="7.4" r="4.4" />
    </>
  ),

  // ---- menu-item categories, matched by keyword so a listed item looks like itself ----
  coffee: (
    <>
      <path d="M4.2 9.4h12.4v5.2a4.6 4.6 0 0 1-4.6 4.6H8.8a4.6 4.6 0 0 1-4.6-4.6Z" />
      <path d="M16.6 10.8h1.8a2.6 2.6 0 0 1 0 5.2h-1.8" />
      <path d="M7.6 2.8v2.8M11.6 2.8v2.8" />
      <path d="M3 21.4h14.8" />
    </>
  ),
  book: (
    <>
      <path d="M4.4 4.2A2 2 0 0 1 6.4 2.2h12.2a1 1 0 0 1 1 1v14.4a1 1 0 0 1-1 1H6.4a2 2 0 0 0-2 2Z" />
      <path d="M4.4 17.6a2 2 0 0 1 2-2h13.2" />
      <path d="M8.4 6.6h6.6" />
    </>
  ),
  bowl: (
    <>
      <path d="M2.8 11.2h18.4a9.2 9.2 0 0 1-18.4 0Z" />
      <path d="M6.6 20.2h10.8" />
      <path d="M9.2 8.6c-.9-1.3.9-2.1 0-3.4M12 8.6c-.9-1.3.9-2.1 0-3.4M14.8 8.6c-.9-1.3.9-2.1 0-3.4" />
    </>
  ),
  // A price tag. The fallback for anything a merchant lists.
  tag: (
    <>
      <path d="M12.4 2.8H20a1.2 1.2 0 0 1 1.2 1.2v7.6a2 2 0 0 1-.6 1.4l-7.4 7.4a2 2 0 0 1-2.8 0l-6.4-6.4a2 2 0 0 1 0-2.8L11 3.4a2 2 0 0 1 1.4-.6Z" />
      <circle cx="16.6" cy="7.4" r="1.5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/// Merchants type free text, so match the obvious categories and fall back to a price tag rather
/// than guessing wrong.
export function iconForItem(name: string): IconName {
  const n = name.toLowerCase();
  if (/coffee|espresso|latte|brew|americano|cappu|flat white|mocha|macchiato|cortado|matcha|chai|tea|drink|juice|soda/.test(n)) return "coffee";
  if (/book|paperback|novel|zine|magazine|read|comic|manga/.test(n)) return "book";
  if (/ramen|bowl|noodle|soup|gyoza|rice|pho|curry|udon|donburi|salad/.test(n)) return "bowl";
  return "tag";
}
