/// Level-gated perks. Kept off-chain on purpose: the *level* is the on-chain fact, and what a
/// merchant network chooses to grant at each tier is presentation, not consensus.
import type { IconName } from "@/components/Icon";

export type Benefit = {
  level: number;
  icon: IconName;
  title: string;
  detail: string;
};

export const BENEFITS: Benefit[] = [
  { level: 1, icon: "seal", title: "Verified receipts", detail: "Every purchase proven by Attestcoin and recorded on Creditcoin." },
  { level: 1, icon: "ticket", title: "Open quests", detail: "Every merchant quest with no level gate, plus the daily check-in streak." },
  { level: 2, icon: "coins", title: "2% cashback on everything", detail: "The app returns 2% of every verified purchase in CTC, on top of anything the merchant pays." },
  { level: 2, icon: "unlocked", title: "Gated quests", detail: "The quests merchants reserve for level 2 — where the cashback gets bigger." },
  { level: 2, icon: "users", title: "Community campaigns", detail: "Join collective goals that pay every buyer once the merchant hits its target." },
  { level: 3, icon: "medal", title: "Priority quests", detail: "The richest cashback tier merchants publish, reserved for level 3 and above." },
  { level: 3, icon: "coins", title: "4% cashback on everything", detail: "Your protocol rate doubles. Still paid in CTC, still on every verified purchase." },
  { level: 4, icon: "coins", title: "7% cashback on everything", detail: "The second-highest rate on the ladder." },
  { level: 4, icon: "early", title: "Early access", detail: "See new merchant campaigns before they open to everyone." },
  { level: 5, icon: "coins", title: "10% cashback on everything", detail: "The cap. One dollar in ten comes back in CTC on every purchase you make." },
  { level: 5, icon: "rosette", title: "Founding member", detail: "Permanent standing on your soulbound Benefit Pass." },
];

export const earnedBenefits = (level: number) => BENEFITS.filter((b) => b.level <= level);
export const lockedBenefits = (level: number) => BENEFITS.filter((b) => b.level > level);
