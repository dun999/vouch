import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { isDeployed } from "@/lib/addresses";
import { Icon } from "@/components/Icon";

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="row landing-brand">
          <BrandLogo />
          <span className="pill" style={{ marginLeft: "auto" }}>Testnet preview</span>
        </div>
        <h1>Every purchase.<br /><span>A little more rewarding.</span></h1>
        <p className="sub">
          Discover local favorites, complete quests, and earn cashback.
          One loyalty pass carries your progress across every storefront.
        </p>
        {!isDeployed && (
          <div className="banner warn" style={{ marginBottom: 24 }}>
            This preview is waiting for its storefront connection. Please check back soon.
          </div>
        )}
        <div className="grid g2">
          <Link href="/app" className="role">
            <div className="role-ico"><Icon name="bag" size={24} /></div>
            <div className="role-title">Make yourself a regular.</div>
            <div className="muted small">
              Find something you love. Collect stars with verified purchases and unlock more benefits as you go.
            </div>
            <div className="role-footer"><span>Explore rewards</span><span aria-hidden="true">↗</span></div>
          </Link>
          <Link href="/merchant" className="role">
            <div className="role-ico"><Icon name="storefront" size={24} /></div>
            <div className="role-title">Give them a reason to return.</div>
            <div className="muted small">
              Set up your menu, create quests, and fund rewards for the customers who keep coming back.
            </div>
            <div className="role-footer"><span>Open merchant console</span><span aria-hidden="true">↗</span></div>
          </Link>
        </div>
        <div className="demo-card">
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontWeight: 640, fontSize: 16 }}>Watch the demo</span>
          </div>
          {/* Swap in the real recording anytime: replace public/demo.mp4, keep the filename. */}
          <video className="demo-video" controls preload="metadata" playsInline>
            <source src="/demo.mp4" type="video/mp4" />
            Your browser can&apos;t play this video. You can still explore the app below.
          </video>
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Pay on Sepolia → prove with Attestcoin → earn stars and cashback on Creditcoin.
          </div>
        </div>
        <div className="tiny muted landing-note">
          Payments on Sepolia · Verified by Attestcoin · Rewards on Creditcoin
          <div style={{ marginTop: 6 }}>Demo uses test tokens with no monetary value.</div>
        </div>
      </div>
    </div>
  );
}
