#!/usr/bin/env node
/**
 * End-to-end live claim, independent of the UI.
 *
 *   PRIVATE_KEY=0x… VOUCH_CORE=0x… node scripts/claim.mjs <sepoliaTxHash> [questId ...]
 *
 * Waits for Attestcoin to attest the payment's block, pulls the inclusion proof, and submits
 * recordPurchase on Creditcoin. Doubles as the integration test for the whole pipeline and as a
 * fallback path on demo day if the browser is being difficult.
 */
import { JsonRpcProvider, Wallet, Contract, formatEther } from "ethers";
import { readFileSync } from "node:fs";

const CREDITCOIN_RPC = process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const PROVERS = [
  "https://proof-gen-api.cc3-testnet.creditcoin.network",
  "https://prover.cc3-testnet.creditcoin.network",
];
const CHAIN_KEY = 1; // Ethereum Sepolia on CC3 testnet

// `--item <id>` names the catalog item this payment bought, so the claim consumes a unit of stock.
const rawArgs = process.argv.slice(2);
const itemFlag = rawArgs.indexOf("--item");
const itemId = itemFlag === -1 ? 0n : BigInt(rawArgs[itemFlag + 1] ?? "0");
if (itemFlag !== -1) rawArgs.splice(itemFlag, 2);
const [txHash, ...questIds] = rawArgs;
const pk = process.env.PRIVATE_KEY;
const coreAddr = process.env.VOUCH_CORE;

if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
  console.error(
    "usage: PRIVATE_KEY=0x… VOUCH_CORE=0x… node scripts/claim.mjs <txHash> [--item <itemId>] [questId…]",
  );
  process.exit(1);
}
if (!pk || !coreAddr) {
  console.error("PRIVATE_KEY and VOUCH_CORE must be set.");
  process.exit(1);
}

const abi = JSON.parse(readFileSync("contracts/out/VouchCore.sol/VouchCore.json", "utf8")).abi;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchProof(hash) {
  for (const base of PROVERS) {
    try {
      const res = await fetch(`${base}/api/v1/proof-by-tx/${CHAIN_KEY}/${hash}`);
      if (res.ok) return await res.json();
    } catch {
      /* try the next host */
    }
  }
  return null;
}

const main = async () => {
  const sepolia = new JsonRpcProvider(SEPOLIA_RPC, undefined, { staticNetwork: true });
  const receipt = await sepolia.getTransactionReceipt(txHash);
  if (!receipt) throw new Error("Transaction not found or not yet mined on Sepolia.");
  if (receipt.status !== 1) throw new Error("That Sepolia transaction reverted; it cannot earn XP.");

  console.log(`payment    ${txHash}`);
  console.log(`block      ${receipt.blockNumber}`);

  // Poll the prover directly. Its cache -- not the on-chain attested height -- decides readiness.
  let proof = null;
  for (let i = 0; i < 90 && !proof; i++) {
    proof = await fetchProof(txHash);
    if (!proof) {
      process.stdout.write(`\rwaiting for attestation… ${i * 20}s elapsed`);
      await sleep(20_000);
    }
  }
  if (!proof) throw new Error("Timed out waiting for Attestcoin to attest this block.");
  console.log(`\nproof      height ${proof.headerNumber}, txIndex ${proof.txIndex}`);

  const creditcoin = new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true });
  const wallet = new Wallet(pk, creditcoin);
  const core = new Contract(coreAddr, abi, wallet);

  console.log(`claiming as ${wallet.address}`);
  const args = [
    proof.headerNumber,
    proof.txBytes,
    { root: proof.merkleProof.root, siblings: proof.merkleProof.siblings },
    { lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest, roots: proof.continuityProof.roots },
    itemId,
    questIds.map((q) => BigInt(q)),
  ];

  // Estimates for the 0x0FD2 precompile call come back low on this chain, and an under-estimate
  // burns the whole limit as an out-of-gas failure. Pay for headroom instead.
  let gasLimit = 3_000_000n;
  try {
    gasLimit = ((await core.recordPurchase.estimateGas(...args)) * 200n) / 100n;
  } catch (e) {
    console.log(`  (gas estimation failed, using fallback limit: ${e.shortMessage ?? e.message})`);
  }
  console.log(`gas limit  ${gasLimit}`);

  const tx = await core.recordPurchase(...args, { gasLimit });
  console.log(`submitted  ${tx.hash}`);
  await tx.wait();

  const p = await core.profileOf(wallet.address);
  console.log("\n--- profile after claim ---");
  console.log(`level      ${p.level}`);
  console.log(`xp         ${p.xp}`);
  console.log(`spend      ${formatEther(p.verifiedSpendWei)} ETH verified`);
  console.log(`quests     ${p.questsCompleted}`);
  console.log(`cashback   ${formatEther(p.totalCashback)} CTC`);
};

main().catch((e) => {
  console.error(`\nfailed: ${e.shortMessage ?? e.message}`);
  process.exit(1);
});
