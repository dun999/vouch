"use client";

import { http, createConfig } from "wagmi";
// Imported from @wagmi/core, not wagmi/connectors: that barrel pulls in the Coinbase/Base
// account SDK, whose optional @x402/evm import breaks the build. We only need injected.
import { injected } from "@wagmi/core";
import { creditcoinTestnet, sepolia } from "./chains";

/// Injected-only on purpose: WalletConnect would need a project id, which is one more thing that
/// can be missing or rate-limited on demo day.
export const wagmiConfig = createConfig({
  chains: [creditcoinTestnet, sepolia],
  connectors: [injected()],
  transports: {
    [creditcoinTestnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
