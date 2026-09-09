import { formatUnits, parseUnits } from "viem";
import { USDC_DECIMALS } from "./addresses";

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/// USDC amounts are 6-decimal base units. Rendered as dollars, because that is what they are.
export const usd = (base: bigint | string | number, dp = 2) =>
  "$" + Number(formatUnits(BigInt(base), USDC_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export const toUsdcBase = (v: string) => parseUnits(v || "0", USDC_DECIMALS);

/// CTC is the Creditcoin native token, 18 decimals.
export const ctc = (wei: bigint | string | number, dp = 3) =>
  Number(formatUnits(BigInt(wei), 18)).toLocaleString(undefined, { maximumFractionDigits: dp });

export function countdown(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds <= 0) return "any moment";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `~${m}m ${s}s` : `~${s}s`;
}

export const timeAgo = (ts: number) => {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

/// Absolute time, for the places where "3h ago" is not enough to reconcile against an explorer.
export const fullTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

/// Long enough to compare against an explorer at a glance, short enough not to wrap a table cell.
export const midHash = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-8)}` : "—");

/// Time remaining, at the resolution someone waiting for it actually cares about.
export function timeUntil(seconds: number) {
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m` : "under a minute";
}
