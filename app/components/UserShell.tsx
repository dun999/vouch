"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Shell } from "./Shell";
import { ProfileModal } from "./ProfileModal";
import { useProfile, useLevelThresholds } from "@/lib/useVouch";
import { shortAddr } from "@/lib/format";
import { Icon } from "./Icon";

export function UserShell({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const profile = useProfile(address);
  const thresholds = useLevelThresholds();
  const [open, setOpen] = useState(false);

  const p = profile.data as any;
  const level = p ? Number(p.level) : 1;
  const stars = p ? BigInt(p.stars) : 0n;

  const sections = [
    {
      items: [
        { href: "/app", label: "Quests", icon: <Icon name="ticket" /> },
        { href: "/starboard", label: "Starboard", icon: <Icon name="star" /> },
        { href: "/redeem", label: "Redeem", icon: <Icon name="gift" /> },
        { href: "/app/activity", label: "Activity", icon: <Icon name="receipt" /> },
        { href: "/app/benefits", label: "Benefits", icon: <Icon name="pass" /> },
      ],
    },
  ];

  return (
    <>
      <Shell
        product="Vouch"
        sections={sections}
        footer={
          <button className="pf" onClick={() => setOpen(true)} title="Your profile">
            <span className="pf-av">{address ? address.slice(2, 4).toUpperCase() : "—"}</span>
            <span className="pf-meta">
              <span className="pf-l1">Level {level}</span>
              <span className="pf-l2">{stars.toString()} stars</span>
            </span>
          </button>
        }
      >
        {children}
      </Shell>

      {open && (
        <ProfileModal
          onClose={() => setOpen(false)}
          address={address}
          level={level}
          stars={stars}
          profile={p}
          thresholds={(thresholds.data as readonly bigint[] | undefined) ?? []}
        />
      )}
    </>
  );
}
