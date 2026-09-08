"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useChainId, useConfig, useSwitchChain } from "wagmi";
import { getAccount } from "@wagmi/core";
import { creditcoinTestnet, sepolia } from "./chains";

/// The app spans two chains: payments happen on Sepolia, progression lives on Creditcoin. Asking
/// the user to know that — and to add Creditcoin to their wallet by hand — is a wall in front of
/// the first purchase. These helpers move the wallet for them.
///
/// wagmi's `switchChain` sends `wallet_switchEthereumChain`, falling back to
/// `wallet_addEthereumChain` from the chain config when the wallet has never seen the network.
/// Both are user-approved prompts — this removes the guesswork, not the consent.

// ---------------------------------------------------------------- the lock
//
// `useAutoChain` parks the wallet on Creditcoin. `useEnsureChain` deliberately moves it elsewhere
// for a moment. Without a shared signal the first fights the second: it sees Sepolia, calls it a
// drift, and switches back *while the payment is still being submitted* — which surfaces as
// "current chain (102031) does not match the target chain (11155111)". This counter is how a
// deliberate switch says "leave it alone".

let held = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
const snapshot = () => held;
const serverSnapshot = () => 0;

function useChainLock() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/// Keeps the wallet on Creditcoin whenever it drifts, so reads and claims just work.
export function useAutoChain() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const busy = useChainLock();
  const asked = useRef<number | null>(null);

  useEffect(() => {
    if (chainId === creditcoinTestnet.id) {
      asked.current = null;
      return;
    }
    // Someone is mid-transaction on another chain. Not a drift.
    if (!isConnected || busy > 0) return;
    // Ask once per wrong-chain state; retrying every render would spam a user who declined.
    if (asked.current === chainId) return;
    asked.current = chainId;
    switchChain({ chainId: creditcoinTestnet.id });
  }, [isConnected, chainId, busy, switchChain]);

  return { onCreditcoin: chainId === creditcoinTestnet.id };
}

export type ChainTarget = typeof creditcoinTestnet.id | typeof sepolia.id;

/// Wraps a write so the wallet is on the right chain before it is submitted.
export function useEnsureChain() {
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);

  const run = useCallback(
    async <T,>(target: ChainTarget, fn: () => Promise<T>): Promise<T> => {
      held += 1;
      notify();
      try {
        // Read the live connector state, not a render-time snapshot: by the time a click is
        // handled the hook value may be a chain behind.
        if (getAccount(config).chainId !== target) {
          setSwitching(true);
          try {
            await switchChainAsync({ chainId: target });
            // The promise resolving means the wallet said yes; wagmi's store can still be a tick
            // behind, and writing into that gap is exactly the mismatch error.
            for (let i = 0; i < 60 && getAccount(config).chainId !== target; i++) {
              await new Promise((r) => setTimeout(r, 50));
            }
          } finally {
            setSwitching(false);
          }
        }
        return await fn();
      } finally {
        held = Math.max(0, held - 1);
        notify();
        // Releasing the lock lets useAutoChain walk the wallet back to Creditcoin on its own.
      }
    },
    [config, switchChainAsync],
  );

  return { run, switching };
}

export const chainLabel = (id: number) =>
  id === creditcoinTestnet.id ? "Creditcoin" : id === sepolia.id ? "Sepolia" : "an unsupported network";
