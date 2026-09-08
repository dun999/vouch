"use client";

import { useAccount } from "wagmi";
import { Shell } from "./Shell";
import { shortAddr } from "@/lib/format";
import { Icon } from "./Icon";

export function MerchantShell({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();

  const sections = [
    {
      items: [
        { href: "/merchant", label: "Storefronts", icon: <Icon name="storefront" /> },
        { href: "/merchant/menu", label: "Menu", icon: <Icon name="menu" /> },
        { href: "/merchant/quests", label: "Quests", icon: <Icon name="ticket" /> },
        { href: "/merchant/milestones", label: "Campaigns", icon: <Icon name="users" /> },
      ],
    },
  ];

  return (
    <Shell
      product="Vouch Merchant"
      sections={sections}
      footer={
        <div className="pf" style={{ cursor: "default" }}>
          <span className="pf-av">{address ? address.slice(2, 4).toUpperCase() : "—"}</span>
          <span className="pf-meta">
            <span className="pf-l1">Merchant</span>
            <span className="pf-l2 mono">{shortAddr(address)}</span>
          </span>
        </div>
      }
    >
      {children}
    </Shell>
  );
}
