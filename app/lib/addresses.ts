import type { Address } from "viem";

/// Filled in by `forge script Deploy`. Override without editing code via NEXT_PUBLIC_* env vars.
export const addresses = {
  CommerceRegistry: (process.env.NEXT_PUBLIC_COMMERCE_REGISTRY ?? "") as Address,
  BenefitPass: (process.env.NEXT_PUBLIC_BENEFIT_PASS ?? "") as Address,
  VouchCore: (process.env.NEXT_PUBLIC_VOUCH_CORE ?? "") as Address,
  QuestManager: (process.env.NEXT_PUBLIC_QUEST_MANAGER ?? "") as Address,
  RewardVault: (process.env.NEXT_PUBLIC_REWARD_VAULT ?? "") as Address,
  MilestoneManager: (process.env.NEXT_PUBLIC_MILESTONE_MANAGER ?? "") as Address,
  Catalog: (process.env.NEXT_PUBLIC_CATALOG ?? "") as Address,
  PriceOracle: (process.env.NEXT_PUBLIC_PRICE_ORACLE ?? "") as Address,
  AppCashback: (process.env.NEXT_PUBLIC_APP_CASHBACK ?? "") as Address,
  /// MockUSDC on Ethereum Sepolia, 6 decimals.
  PaymentToken: (process.env.NEXT_PUBLIC_PAYMENT_TOKEN ?? "") as Address,
  /// StarRedeem on Creditcoin. Optional: the redeem page explains itself when unset.
  StarRedeem: (process.env.NEXT_PUBLIC_STAR_REDEEM ?? "") as Address,
};

export const USDC_DECIMALS = 6;

const { StarRedeem: _starRedeem, ...coreAddresses } = addresses;
export const isDeployed = Object.values(coreAddresses).every((a) => a && a.length === 42);
export const isRedeemDeployed = isDeployed && addresses.StarRedeem.length === 42;
