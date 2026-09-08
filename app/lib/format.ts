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
