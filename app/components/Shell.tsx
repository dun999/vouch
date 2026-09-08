"use client";

import Link from "next/link";
import { BrandLogo } from "./BrandLogo";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { creditcoinTestnet } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { useAutoChain } from "@/lib/useChain";

export type NavItem = { href: string; label: string; icon: React.ReactNode; badge?: string | number };
export type NavSection = { title?: string; items: NavItem[] };

const KEY = "vouch:sidebar-collapsed";

export function Shell({
  sections,
  product,
  footer,
  children,
}: {
  sections: NavSection[];
  product: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {
      /* private mode: keep the default */
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* non-fatal */
      }
      return !c;
    });
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="sb-head">
          <Link href="/" className="brand-home" title="Vouch home" aria-label="Vouch home">
            <BrandLogo compact={collapsed} />
            {!collapsed && product !== "Vouch" && <span className="brand-context">Merchant</span>}
          </Link>
          <button className="sb-collapse" onClick={toggle} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <nav className="sb-scroll">
          {sections.map((s, i) => (
            <div key={i}>
              {s.title && <div className="sb-section">{s.title}</div>}
              {s.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`sb-item ${path === it.href ? "on" : ""}`}
                  title={it.label}
                >
                  <span className="sb-ico">{it.icon}</span>
                  <span className="sb-label">{it.label}</span>
                  {it.badge !== undefined && it.badge !== "" && (
                    <span className="sb-badge">{it.badge}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-foot">{footer}</div>
      </aside>

      <main className="main">
        <TopBar />
        <div className="content">
          <div className="container">{children}</div>
        </div>
      </main>
    </div>
  );
}

function TopBar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  // The app puts the wallet on the right network itself rather than making the user find it.
  const { onCreditcoin } = useAutoChain();

  // wagmi's injected() connector always exists, so its presence says nothing about whether a wallet
  // is installed. Without this the button hangs on "Connecting…" forever.
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  useEffect(() => {
    setHasWallet(typeof window !== "undefined" && !!(window as any).ethereum);
  }, []);

  const wrongChain = isConnected && !onCreditcoin;

  return (
    <div className="topbar">
      <div className="container">
        <span className="tiny dim">Creditcoin CC3 · Attestcoin · Ethereum Sepolia</span>
        <div className="spacer" />
        {wrongChain && (
          <span className="pill wait">
            <i className="dot" /> Switching to Creditcoin…
          </span>
        )}
        {isConnected ? (
          <>
            <span className="pill mono">{shortAddr(address)}</span>
            <button className="ghost sm" onClick={() => disconnect()}>
              Disconnect
            </button>
          </>
        ) : hasWallet === false ? (
          <span className="pill" title="Install MetaMask to transact">
            Read-only — no wallet detected
          </span>
        ) : (
          <button
            className="sm"
            disabled={isPending || hasWallet === null}
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          >
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>
    </div>
  );
}
