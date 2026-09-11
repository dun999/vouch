"use client";

import { useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { StarRedeemAbi } from "@/lib/abis";
import { addresses, isDeployed, isRedeemDeployed } from "@/lib/addresses";
import { creditcoinTestnet, ccTxUrl } from "@/lib/chains";
import { useEnsureChain } from "@/lib/useChain";
import { ctc, midHash } from "@/lib/format";
import { useProfile } from "@/lib/useVouch";
import { UserShell } from "@/components/UserShell";
import { Icon } from "@/components/Icon";

export default function RedeemPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: creditcoinTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { run: ensure } = useEnsureChain();

  const profile = useProfile(address);
  const contract = {
    address: addresses.StarRedeem,
    abi: StarRedeemAbi,
    chainId: creditcoinTestnet.id,
  } as const;

  const reads = useReadContracts({
    contracts: [
      { ...contract, functionName: "floorStars" },
      { ...contract, functionName: "ctcPerStar" },
      { ...contract, functionName: "treasury" },
      { ...contract, functionName: "spendableOf", args: [address!] },
      { ...contract, functionName: "redeemed", args: [address!] },
    ],
    query: { enabled: isRedeemDeployed && !!address, refetchInterval: 10000 },
  });

  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [doneHash, setDoneHash] = useState<`0x${string}` | null>(null);

  const ok = (i: number) => reads.data?.[i]?.status === "success";
  const floor = ok(0) ? BigInt(reads.data![0].result as bigint) : 700n;
  const rate = ok(1) ? BigInt(reads.data![1].result as bigint) : 10n ** 17n;
  const treasury = ok(2) ? BigInt(reads.data![2].result as bigint) : 0n;
  const spendable = ok(3) ? BigInt(reads.data![3].result as bigint) : 0n;
  const alreadyRedeemed = ok(4) ? BigInt(reads.data![4].result as bigint) : 0n;

  const p = profile.data as any;
  const stars: bigint = p ? BigInt(p.stars) : 0n;

  const want = useMemo(() => {
    try {
      return BigInt(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);
  const quote = want * rate;
  const tooMuch = want > spendable;
  const shortTreasury = quote > treasury;

  async function redeem() {
    if (!address || want <= 0n) return;
    setBusy(true);
    setErr("");
    setDoneHash(null);
    try {
      const hash = await ensure(creditcoinTestnet.id, () =>
        writeContractAsync({
          address: addresses.StarRedeem,
          abi: StarRedeemAbi,
          functionName: "redeem",
          chainId: creditcoinTestnet.id,
          args: [want],
          gas: 500_000n,
        }),
      );
      await client?.waitForTransactionReceipt({ hash });
      setDoneHash(hash);
      setAmount("100");
      profile.refetch();
      reads.refetch();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Redemption failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isDeployed) return <div className="banner err">Contracts are not configured.</div>;

  return (
    <UserShell>
      <h1>Redeem</h1>
      <div className="sub">
        Past 700 stars you hold a surplus — every star above the Level 5 line swaps for CTC at{" "}
        <strong>100 stars = 10 CTC</strong>. Your level never drops: redemption is tracked
        separately, so the floor stays yours.
      </div>

      {!isRedeemDeployed && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          The redemption contract isn&apos;t deployed yet — balances below are live, claiming
          unlocks once it is.
        </div>
      )}
      {!isConnected && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          Connect a wallet to see your spendable stars.
        </div>
      )}
      {err && <div className="banner err" style={{ marginBottom: 16 }}>{err}</div>}
      {doneHash && (
        <div className="banner" style={{ marginBottom: 16 }}>
          Redeemed — CTC is in your wallet.{" "}
          <a className="rc-link mono tiny" href={ccTxUrl(doneHash)} target="_blank" rel="noreferrer noopener">
            {midHash(doneHash)} ↗
          </a>
        </div>
      )}

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="label">Your stars</div>
          <div className="stat stars-earn" style={{ marginTop: 6 }}>
            <Icon name="star" size={24} /> {stars.toString()}
          </div>
        </div>
        <div className="card">
          <div className="label">Spendable now</div>
          <div className="stat stars-earn" style={{ marginTop: 6 }}>
            <Icon name="star" size={24} /> {spendable.toString()}
          </div>
          <div className="tiny dim" style={{ marginTop: 4 }}>
            {alreadyRedeemed > 0n
              ? `${alreadyRedeemed} already redeemed · floor ${floor}`
              : `Floor ${floor} stays untouched`}
          </div>
        </div>
        <div className="card">
          <div className="label">Treasury</div>
          <div className="stat" style={{ marginTop: 6 }}>{ctc(treasury)} <span style={{ fontSize: 14 }}>CTC</span></div>
          <div className="tiny dim" style={{ marginTop: 4 }}>Funds every redemption</div>
        </div>
      </div>

      <div className="card">
        <h2>Swap stars for CTC</h2>
        {stars < floor ? (
          <div className="empty" style={{ padding: 28 }}>
            {(floor - stars).toString()} stars to go before redemption unlocks at {floor} stars.
          </div>
        ) : (
          <>
            <div className="field">
              <label>Stars to redeem</label>
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="100"
              />
              <div className="row" style={{ marginTop: 10 }}>
                {["100", "500"].map((v) => (
                  <button key={v} className="ghost sm" onClick={() => setAmount(v)}>{v}</button>
                ))}
                <button className="ghost sm" onClick={() => setAmount(spendable.toString())}>Max</button>
              </div>
            </div>
            <div className="banner" style={{ marginBottom: 16 }}>
              <div className="kv">
                <div className="kv-row"><span>You burn</span><span>{want.toString()} stars</span></div>
                <div className="kv-row"><span>You receive</span><span>{ctc(quote)} CTC</span></div>
              </div>
            </div>
            {tooMuch && want > 0n && (
              <div className="banner warn" style={{ marginBottom: 16 }}>
                That&apos;s above your {spendable.toString()} spendable stars.
              </div>
            )}
            {shortTreasury && want > 0n && !tooMuch && (
              <div className="banner warn" style={{ marginBottom: 16 }}>
                The treasury can&apos;t cover this right now. Try a smaller amount later.
              </div>
            )}
            <button
              disabled={!isConnected || !isRedeemDeployed || busy || want <= 0n || tooMuch || shortTreasury}
              onClick={redeem}
            >
              {busy ? "Redeeming…" : want > 0n ? `Redeem ${want} stars → ${ctc(quote)} CTC` : "Enter an amount"}
            </button>
          </>
        )}
      </div>
    </UserShell>
  );
}
